import { app, BrowserWindow, ipcMain, Menu, protocol, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AgentOrchestrator,
  JobQueue,
  WorkflowEngine,
  WorkflowRecovery,
  registerDefaultWorkflows,
} from '@lucid-fin/application';
import { createStyleWorkflowHandlers } from './workflow/style-workflow-handlers.js';
import { createStoryboardWorkflowHandlers } from './workflow/storyboard-workflow-handlers.js';
import { initDb } from './bootstrap/init-db.js';
import { initIpc } from './bootstrap/init-ipc.js';
import { initApp, restoreAdapterKeys, selectConfiguredLLMAdapter } from './bootstrap/init-app.js';
import log, { getBufferedLogs, initLogger, setLogForwarder } from './logger.js';
import { initCrashReporter } from './crash-reporter.js';
import { mark, logStartupMetrics } from './startup-metrics.js';
import { configureUserDataPath } from './user-data-path.js';
import {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus,
} from './auto-updater.js';

// Explicitly pin Electron userData to %APPDATA%\Lucid Fin and migrate legacy Electron data.
configureUserDataPath(app);

// Early init: logger + crash reporter (before anything else)
initLogger(app.isPackaged ? 'info' : 'debug');
initCrashReporter();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let earlyIpcRegistered = false;

function registerEarlyIpcHandlers(): void {
  if (earlyIpcRegistered) return;
  earlyIpcRegistered = true;
  ipcMain.handle('logger:getRecent', () => getBufferedLogs());
  log.debug('Registered early IPC handler', {
    category: 'ipc',
    channel: 'logger:getRecent',
  });
}

function createWindow(): BrowserWindow {
  // Hide the default menu bar — navigation is handled by the in-app Navbar
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0a0a',
      symbolColor: '#f2f2f2',
      height: 40,
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Skeleton-first: show window as soon as DOM is ready
  win.once('ready-to-show', () => win.show());

  const isDev = !app.isPackaged;
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'bottom' });
  } else {
    // Load built renderer HTML (works for both dev and production)
    const rendererPath = isDev
      ? path.resolve(__dirname, '..', '..', 'desktop-renderer', 'dist', 'index.html')
      : path.join(process.resourcesPath, 'renderer', 'index.html');
    win.loadFile(rendererPath);
    if (isDev) win.webContents.openDevTools({ mode: 'bottom' });
  }

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

// Register custom protocol scheme for asset loading (must be before app.whenReady)
protocol.registerSchemesAsPrivileged([
  { scheme: 'lucid-asset', privileges: { standard: true, supportFetchAPI: true, stream: true } },
]);

registerEarlyIpcHandlers();

app.whenReady().then(async () => {
  log.info('Lucid Fin starting...');

  // 1. Create window immediately (skeleton-first for <3s boot)
  mainWindow = createWindow();
  setLogForwarder((entry) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('logger:entry', entry);
  });
  mark('window-created');

  // 2. Background async initialization
  try {
    const {
      db,
      projectFS,
      cas,
      keychain,
      adapterRegistry,
      llmRegistry,
      promptStore,
      toolRegistry,
    } = initApp();
    initDb(db);

    // Register custom protocol to serve assets from CAS
    protocol.handle('lucid-asset', async (request) => {
      try {
        const url = new URL(request.url);
        const parts = url.pathname.replace(/^\/+/, '').split('/');
        const hash = url.hostname;
        const assetType = (parts[0] || 'image') as 'image' | 'video' | 'audio';
        const requestedExt = parts[1] || 'png';

        // Read meta.json to get the actual stored format
        let ext = requestedExt;
        try {
          const metaPath = cas.getAssetPath(hash, assetType, 'meta.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { format?: string };
          if (meta.format) ext = meta.format;
        } catch {
          // meta.json not found — use requested ext
        }

        const filePath = cas.getAssetPath(hash, assetType, ext);
        return net.fetch(pathToFileURL(filePath).href);
      } catch (err) {
        log.error('lucid-asset protocol error:', err);
        return new Response('Not found', { status: 404 });
      }
    });

    // Restore saved API keys to adapters
    await restoreAdapterKeys(keychain, adapterRegistry, llmRegistry);
    let llmAdapter: import('@lucid-fin/contracts').LLMAdapter | null = null;
    try {
      llmAdapter = await selectConfiguredLLMAdapter(llmRegistry.list());
    } catch {
      log.warn(
        'No configured LLM adapter — AI features will be unavailable until an API key is set',
      );
    }
    const agent = llmAdapter
      ? new AgentOrchestrator(llmAdapter, toolRegistry, (code: string) => promptStore.resolve(code))
      : null;

    // Single JobQueue instance — shared across recovery and IPC handlers
    const jobQueue = new JobQueue(db, adapterRegistry);
    await jobQueue.recover();
    jobQueue.start();
    log.info('Job queue recovered and started');

    const workflowRegistry = registerDefaultWorkflows();
    const workflowEngine = new WorkflowEngine({
      db,
      registry: workflowRegistry,
      handlers: [
        ...createStyleWorkflowHandlers({
          cas,
          llmRegistry,
        }),
        ...createStoryboardWorkflowHandlers({
          cas,
          adapterRegistry,
        }),
      ],
    });
    const workflowRecovery = new WorkflowRecovery(workflowEngine);
    await workflowRecovery.recover();
    log.info('Workflow engine recovered');

    initIpc(
      () => mainWindow,
      db,
      projectFS,
      cas,
      keychain,
      adapterRegistry,
      jobQueue,
      llmRegistry,
      workflowEngine,
      agent,
      promptStore,
    );

    // Auto-updater init + IPC handlers
    await initAutoUpdater(mainWindow);
    ipcMain.handle('updater:check', () => checkForUpdates());
    ipcMain.handle('updater:download', () => downloadUpdate());
    ipcMain.handle('updater:install', () => installUpdate());
    ipcMain.handle('updater:status', () => getUpdateStatus());
    ipcMain.handle('app:version', () => app.getVersion());

    // Auto-check for updates 10s after startup (non-blocking)
    setTimeout(() => { void checkForUpdates(); }, 10_000);
    ipcMain.handle('shell:openExternal', (_e, args: { url: string }) => {
      if (args.url.startsWith('https://')) return shell.openExternal(args.url);
    });

    // Settings persistence (app-level, not project-level)
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    ipcMain.handle('settings:load', async () => {
      try {
        if (fs.existsSync(settingsPath)) {
          return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
      } catch { /* corrupt file — return null to use defaults */ }
      return null;
    });
    ipcMain.handle('settings:save', async (_e, data: unknown) => {
      fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf-8');
    });

    // Notify renderer that backend is ready
    mark('fully-loaded');
    mainWindow.webContents.send('app:ready');
    log.info('Lucid Fin initialized successfully');
    logStartupMetrics();
  } catch (err) {
    log.error('Initialization failed:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app:init-error', String(err));
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createWindow();
  }
});
