import { app, BrowserWindow, ipcMain, Menu, protocol, net, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  startClipboardWatcher,
  stopClipboardWatcher,
  setClipboardWatcherEnabled,
} from './clipboard-watcher.js';
import {
  createAgentOrchestratorForRun,
  JobQueue,
  WorkflowEngine,
  WorkflowRecovery,
  registerDefaultWorkflows,
} from '@lucid-fin/application';
import { createStyleWorkflowHandlers } from './workflow/style-workflow-handlers.js';
import { createRefImageWorkflowHandlers } from './workflow/ref-image-workflow-handlers.js';
import { initDb } from './bootstrap/init-db.js';
import { initIpc } from './bootstrap/init-ipc.js';
import { initApp, restoreAdapterKeys, selectConfiguredLLMAdapter } from './bootstrap/init-app.js';
import { startApiServer, stopApiServer } from './api-server.js';
import log, { getBufferedLogs, initLogger, setLogForwarder } from './logger.js';
import { initCrashReporter } from './crash-reporter.js';
import { mark, logStartupMetrics } from './startup-metrics.js';
import { configureUserDataPath } from './user-data-path.js';
import { updateSettingsCache } from './ipc/settings-cache.js';
import { createRendererPushGateway } from './features/ipc/push-gateway.js';
import { registerInvoke } from './features/ipc/registrar.js';
import {
  appInitErrorChannel,
  appReadyChannel,
  appRestartChannel,
  loggerEntryChannel,
  pingChannel,
  healthPingChannel,
} from '@lucid-fin/contracts-parse';
import {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus,
} from './auto-updater.js';
import { startSessionCleanup, stopSessionCleanup } from './ipc/handlers/commander-registry.js';

// Explicitly pin Electron userData to %APPDATA%\Lucid Fin and migrate legacy Electron data.
configureUserDataPath(app);

// Early init: logger + crash reporter (before anything else)
initLogger(app.isPackaged ? 'info' : 'debug');
initCrashReporter();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let earlyIpcRegistered = false;
let appDb: import('@lucid-fin/storage').SqliteIndex | null = null;
let appJobQueue: import('@lucid-fin/application').JobQueue | null = null;

// Module-scope gateway bound to the current `mainWindow`. Used for the
// app-level push channels (`app:ready`, `app:init-error`) that fire during
// boot/teardown. `logger:entry` uses its own short-lived gateway per
// `attachWindowLogForwarder` call because it captures a specific window.
const mainWindowGateway = createRendererPushGateway({
  getWindow: () => mainWindow,
});

function registerEarlyIpcHandlers(): void {
  if (earlyIpcRegistered) return;
  earlyIpcRegistered = true;
  const registrarDeps = { ipcMain, getWindow: () => mainWindow };
  ipcMain.handle('logger:getRecent', () => getBufferedLogs());

  // Updater + app version — must be available before renderer loads
  ipcMain.handle('updater:check', () => checkForUpdates());
  ipcMain.handle('updater:download', () => downloadUpdate());
  ipcMain.handle('updater:install', () => installUpdate());
  ipcMain.handle('updater:status', () => getUpdateStatus());
  ipcMain.handle('app:version', () => {
    // app.getVersion() returns Electron version in dev; read package.json directly
    try {
      const pkgPath = path.join(__dirname, '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version ?? app.getVersion();
    } catch {
      return app.getVersion();
    }
  });

  // IPC health check — lightweight ping/pong for connection monitoring
  registerInvoke(registrarDeps, pingChannel, async () => 'pong' as const);

  // Contract-based health check for generated preload alignment
  registerInvoke(registrarDeps, healthPingChannel, async () => ({
    ok: true as const,
    uptime: process.uptime(),
  }));

  // App restart — used after DB restore to avoid stale WAL state
  registerInvoke(registrarDeps, appRestartChannel, async () => {
    app.relaunch();
    app.exit(0);
  });

  log.debug('Registered early IPC handlers', {
    category: 'ipc',
    channels: [
      'logger:getRecent',
      'updater:*',
      'app:version',
      'ipc:ping',
      'health:ping',
      'app:restart',
    ],
  });
}

export function logWindowCreated(): void {
  mark('window-created');
  log.debug('Main window created', {
    category: 'startup',
  });
}

export function attachWindowLogForwarder(window: BrowserWindow | null): void {
  // Route `logger:entry` pushes through the typed gateway so payload drift
  // surfaces loudly in main rather than in the renderer.
  const gateway = createRendererPushGateway({ getWindow: () => window });
  setLogForwarder((entry) => {
    gateway.emit(loggerEntryChannel, entry);
  });
  log.debug('Logger forwarder attached', {
    category: 'startup',
  });
}

export function logJobQueueRecovered(): void {
  log.info('Job queue recovered and started', {
    category: 'startup',
  });
}

export function logWorkflowEngineRecovered(): void {
  log.info('Workflow engine recovered', {
    category: 'startup',
  });
}

function createWindow(): BrowserWindow {
  // Hide the default menu bar — navigation is handled by the in-app Navbar
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '..', 'build', 'icon.png'),
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
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Security: prevent renderer from navigating to non-local URLs
  win.webContents.on('will-navigate', (event, url) => {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const allowed = url.startsWith('file://') || (devServerUrl && url.startsWith(devServerUrl));
    if (!allowed) {
      event.preventDefault();
    }
  });

  // Security: block all new-window requests from renderer
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
  attachWindowLogForwarder(mainWindow);
  logWindowCreated();

  // Clipboard watcher — monitors clipboard when app is not focused
  startClipboardWatcher(mainWindow);
  ipcMain.handle('clipboard:setEnabled', (_e, args: { enabled: boolean }) => {
    setClipboardWatcherEnabled(args.enabled);
  });

  // 2. Background async initialization
  try {
    const {
      db,
      cas,
      keychain,
      adapterRegistry,
      llmRegistry,
      promptStore,
      processPromptStore,
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
          /* meta.json not found or unreadable — use the originally requested extension */
          // meta.json not found — use requested ext
        }

        let filePath = cas.getAssetPath(hash, assetType, ext);
        if (!fs.existsSync(filePath)) {
          // Fallback: try common extensions for this asset type
          const fallbackExts: Record<string, string[]> = {
            image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
            video: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'bin'],
            audio: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'],
          };
          const candidates = fallbackExts[assetType] ?? [];
          let found = false;
          for (const tryExt of candidates) {
            if (tryExt === ext) continue;
            const tryPath = cas.getAssetPath(hash, assetType, tryExt);
            if (fs.existsSync(tryPath)) {
              filePath = tryPath;
              found = true;
              break;
            }
          }
          if (!found) {
            // Try other asset type directories
            for (const tryType of ['image', 'video', 'audio'] as const) {
              if (tryType === assetType) continue;
              const tryExts = fallbackExts[tryType] ?? [];
              for (const tryExt of tryExts) {
                const tryPath = cas.getAssetPath(hash, tryType, tryExt);
                if (fs.existsSync(tryPath)) {
                  filePath = tryPath;
                  found = true;
                  break;
                }
              }
              if (found) break;
            }
          }
          if (!found) {
            log.warn('lucid-asset: file not found', { hash, assetType, ext });
            return new Response('Not found', { status: 404 });
          }
        }
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
      /* no configured LLM adapter — AI features degrade gracefully until a key is set */
      log.warn(
        'No configured LLM adapter — AI features will be unavailable until an API key is set',
      );
    }
    const agent = llmAdapter
      ? createAgentOrchestratorForRun({
          variant: 'production',
          llmAdapter,
          toolRegistry,
          resolvePrompt: (code: string) => promptStore.resolve(code),
          resolveProcessPrompt: (processKey: string) =>
            processPromptStore.getEffectiveValue(processKey),
          // No canvasStore here: this is the non-canvas AI orchestrator
          // consumed by `registerAiHandlers`. Canvas-aware resolvers stay
          // dormant; canvas-state-driven ProcessPromptSpecs are a no-op.
        })
      : null;

    // Single JobQueue instance — shared across recovery and IPC handlers
    const jobQueue = new JobQueue(() => db.repos.jobs, adapterRegistry);
    await jobQueue.recover();
    jobQueue.start();
    logJobQueueRecovered();

    appDb = db;
    appJobQueue = jobQueue;

    const workflowRegistry = registerDefaultWorkflows();
    const workflowEngine = new WorkflowEngine({
      db,
      registry: workflowRegistry,
      handlers: [
        ...createStyleWorkflowHandlers({
          cas,
          llmRegistry,
        }),
        ...createRefImageWorkflowHandlers({
          adapterRegistry,
          cas,
        }),
      ],
    });
    const workflowRecovery = new WorkflowRecovery(workflowEngine);
    await workflowRecovery.recover();
    logWorkflowEngineRecovered();

    initIpc(() => mainWindow, {
      db,
      cas,
      keychain,
      registry: adapterRegistry,
      jobQueue,
      llmRegistry,
      workflowEngine,
      agent,
      promptStore,
      processPromptStore,
    });

    startSessionCleanup();

    startApiServer({ db });

    // Auto-updater init (hooks into already-registered IPC handlers)
    await initAutoUpdater(mainWindow);

    // Auto-check for updates 10s after startup (non-blocking)
    setTimeout(() => {
      void checkForUpdates();
    }, 10_000);
    ipcMain.handle('shell:openExternal', (_e, args: { url: string }) => {
      let parsed: URL;
      try {
        parsed = new URL(args.url);
      } catch {
        throw new Error('Invalid URL');
      }
      if (parsed.protocol !== 'https:') throw new Error('Only https: URLs are allowed');
      return shell.openExternal(parsed.href);
    });

    // Settings persistence (app-level, not project-level)
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    ipcMain.handle('settings:load', async () => {
      try {
        const raw = await fs.promises
          .readFile(settingsPath, 'utf-8')
          .catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') return null;
            throw err;
          });
        if (raw === null) return null;
        const loaded = JSON.parse(raw);
        if (loaded && typeof loaded === 'object') {
          updateSettingsCache(loaded as Record<string, unknown>);
        }
        return loaded;
      } catch (err) {
        log.warn('Settings file corrupt, using defaults', { error: String(err) });
      }
      return null;
    });
    ipcMain.handle('settings:save', async (_e, data: unknown) => {
      try {
        await fs.promises.writeFile(settingsPath, JSON.stringify(data, null, 2), 'utf-8');
        if (data && typeof data === 'object') {
          updateSettingsCache(data as Record<string, unknown>);
        }
      } catch (err) {
        log.error('Failed to save settings', { error: String(err) });
        throw err;
      }
    });

    // Notify renderer that backend is ready
    mark('fully-loaded');
    mainWindowGateway.emit(appReadyChannel, undefined);
    log.info('Lucid Fin initialized successfully');
    logStartupMetrics();
  } catch (err) {
    log.error('Initialization failed:', err);
    mainWindowGateway.emit(appInitErrorChannel, String(err));
  }
});

app.on('window-all-closed', () => {
  stopClipboardWatcher();
  stopApiServer();
  stopSessionCleanup();
  if (process.platform !== 'darwin') {
    if (appJobQueue) {
      appJobQueue.stop();
      appJobQueue = null;
    }
    if (appDb) {
      appDb.close();
      appDb = null;
    }
    app.quit();
  }
});

app.on('before-quit', () => {
  if (appJobQueue) {
    appJobQueue.stop();
    appJobQueue = null;
  }
  if (appDb) {
    appDb.close();
    appDb = null;
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createWindow();
    attachWindowLogForwarder(mainWindow);
    logWindowCreated();
  }
});
