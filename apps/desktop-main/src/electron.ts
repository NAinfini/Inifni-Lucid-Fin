import electron from 'electron';
import type { BrowserWindow } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  startClipboardWatcher,
  stopClipboardWatcher,
  setClipboardWatcherEnabled,
} from './clipboard-watcher.js';
import { TaskExecutionEngine, registerDefaultTaskLists } from '@lucid-fin/application';
import { createStyleTaskHandlers } from './task-execution/style-task-handlers.js';
import { createAudioTaskHandler } from './task-execution/audio-task-handler.js';
import { createMediaTaskHandler } from './task-execution/media-task-handler.js';
import { createAudioTaskService } from './services/audio-task.service.js';
import { createMediaTaskService } from './services/media-task.service.js';
import { MediaGenerationService } from './services/media-generation.service.js';
import { MediaEvaluationService } from './services/media-evaluation.service.js';
import { createVisualAnalyzer } from './services/visual-analyzer.service.js';
import { createPromptAssemblyService } from './services/prompt-assembly.service.js';
import { resolveAdapter } from './ipc/handlers/generation-context.js';
import { createCanvasStore } from './ipc/handlers/canvas.handlers.js';
import { projectPresetCatalog } from './ipc/handlers/preset.handlers.js';
import { initDb } from './bootstrap/init-db.js';
import { initIpc } from './bootstrap/init-ipc.js';
import { initApp, registerOAuthAdapters, restoreAdapterKeys } from './bootstrap/init-app.js';
import log, { getBufferedLogs, initLogger, setLogForwarder } from './logger.js';
import { initCrashReporter } from './crash-reporter.js';
import { startTrace } from './perf-trace.js';
import { mark, logStartupMetrics } from './startup-metrics.js';
import { configureUserDataPath } from './user-data-path.js';
import { createRendererPushGateway } from './features/ipc/push-gateway.js';
import { registerInvoke } from './features/ipc/registrar.js';
import {
  appInitErrorChannel,
  appReadyChannel,
  appRestartChannel,
  loggerEntryChannel,
  pingChannel,
  healthPingChannel,
  parseTaskId,
} from '@lucid-fin/contracts-parse';
import {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  getUpdateStatus,
} from './auto-updater.js';
import { initUpdateSafety, stopUpdateSafety } from './update-safety.js';
import { startSessionCleanup, stopSessionCleanup } from './ipc/handlers/commander-registry.js';
import { registerSettingsHandlers } from './ipc/handlers/settings.handlers.js';
import { ProviderOAuthManager } from './oauth/provider-oauth-manager.js';
import { completeGracefulShutdown, waitForRendererFlush } from './graceful-shutdown.js';

const { app, BrowserWindow: BrowserWindowCtor, ipcMain, Menu, protocol, net, shell } = electron;

// Explicitly pin Electron userData to %APPDATA%\Lucid Fin and migrate legacy Electron data.
configureUserDataPath(app);

// Early init: logger + crash reporter (before anything else)
initLogger(app.isPackaged ? 'info' : 'debug');
initCrashReporter();
initUpdateSafety();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let earlyIpcRegistered = false;
let appDb: import('@lucid-fin/storage').SqliteIndex | null = null;
let appAudioTaskService: import('./services/audio-task.service.js').AudioTaskService | null = null;
let appMediaTaskService: import('./services/media-task.service.js').MediaTaskService | null = null;
let appOAuthManager: ProviderOAuthManager | null = null;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | null = null;

// Module-scope gateway bound to the current `mainWindow`. Used for the
// app-level push channels (`app:ready`, `app:init-error`) that fire during
// boot/teardown. `logger:entry` uses its own short-lived gateway per
// `attachWindowLogForwarder` call because it captures a specific window.
const mainWindowGateway = createRendererPushGateway({
  getWindow: () => mainWindow,
});

type AppInitializationNotification =
  | { status: 'ready' }
  | { status: 'error'; message: string };

let rendererDidFinishLoad = false;
let pendingAppInitializationNotification: AppInitializationNotification | null = null;

function flushAppInitializationNotification(): void {
  if (!rendererDidFinishLoad || !pendingAppInitializationNotification) return;
  const notification = pendingAppInitializationNotification;
  pendingAppInitializationNotification = null;
  if (notification.status === 'ready') {
    mainWindowGateway.emit(appReadyChannel, undefined);
  } else {
    mainWindowGateway.emit(appInitErrorChannel, notification.message);
  }
}

function publishAppInitializationNotification(notification: AppInitializationNotification): void {
  pendingAppInitializationNotification = notification;
  flushAppInitializationNotification();
}

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
  ipcMain.handle('app:version', async () => {
    // app.getVersion() returns Electron version in dev; read package.json directly
    try {
      const pkgPath = path.join(__dirname, '..', 'package.json');
      const raw = await fsp.readFile(pkgPath, 'utf-8');
      return (JSON.parse(raw) as { version?: string }).version ?? app.getVersion();
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

export function logTaskExecutionEngineRecovered(): void {
  log.info('Task execution engine recovered', {
    category: 'startup',
  });
}

function createWindow(): BrowserWindow {
  // Hide the default menu bar — navigation is handled by the in-app Navbar
  Menu.setApplicationMenu(null);

  const win = new BrowserWindowCtor({
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
  rendererDidFinishLoad = false;
  win.webContents.once('did-finish-load', () => {
    rendererDidFinishLoad = true;
    setTimeout(flushAppInitializationNotification, 0);
  });

  const isDev = !app.isPackaged;
  const shouldOpenDevTools = isDev && process.env.ELECTRON_IS_E2E !== '1';
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    if (shouldOpenDevTools) win.webContents.openDevTools({ mode: 'bottom' });
  } else {
    // Load built renderer HTML (works for both dev and production)
    const rendererPath = isDev
      ? path.resolve(__dirname, '..', '..', 'desktop-renderer', 'dist', 'index.html')
      : path.join(process.resourcesPath, 'renderer', 'index.html');
    win.loadFile(rendererPath);
    if (shouldOpenDevTools) win.webContents.openDevTools({ mode: 'bottom' });
  }

  win.on('closed', () => {
    rendererDidFinishLoad = false;
    mainWindow = null;
  });

  if (process.platform !== 'darwin') {
    win.on('close', (event) => {
      if (shutdownComplete) return;
      event.preventDefault();
      app.quit();
    });
  }

  return win;
}

// Register custom protocol scheme for asset loading (must be before app.whenReady)
protocol.registerSchemesAsPrivileged([
  { scheme: 'lucid-asset', privileges: { standard: true, supportFetchAPI: true, stream: true } },
]);

registerEarlyIpcHandlers();

app.whenReady().then(async () => {
  log.info('Lucid Fin starting...');

  // Performance trace: measure total startup time (app.ready -> did-finish-load)
  const startupTrace = startTrace('app-startup');

  // 1. Create window immediately (skeleton-first for <3s boot)
  mainWindow = createWindow();
  attachWindowLogForwarder(mainWindow);
  logWindowCreated();

  // Finish startup trace when the renderer finishes loading
  mainWindow.webContents.once('did-finish-load', () => {
    startupTrace.finish();
  });

  // Clipboard watcher — monitors clipboard when app is not focused
  startClipboardWatcher(mainWindow);
  ipcMain.handle('clipboard:setEnabled', (_e, args: { enabled: boolean }) => {
    setClipboardWatcherEnabled(args.enabled);
  });

  // 2. Background async initialization
  try {
    const { db, cas, keychain, adapterRegistry, llmRegistry, promptStore, processPromptStore } =
      initApp();
    const oauthManager = new ProviderOAuthManager({
      userDataPath: app.getPath('userData'),
      keychain,
    });
    appOAuthManager = oauthManager;
    registerOAuthAdapters(oauthManager, adapterRegistry, llmRegistry);
    initDb(db);

    // Register custom protocol to serve assets from CAS
    async function fileExists(filePath: string): Promise<boolean> {
      try {
        await fsp.access(filePath);
        return true;
      } catch {
        return false;
      }
    }

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
          const meta = JSON.parse(await fsp.readFile(metaPath, 'utf-8')) as { format?: string };
          if (meta.format) ext = meta.format;
        } catch {
          /* meta.json not found or unreadable — use the originally requested extension */
          // meta.json not found — use requested ext
        }

        let filePath = cas.getAssetPath(hash, assetType, ext);
        if (!(await fileExists(filePath))) {
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
            if (await fileExists(tryPath)) {
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
                if (await fileExists(tryPath)) {
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
    appDb = db;

    const canvasStore = createCanvasStore(db);
    const taskListRegistry = registerDefaultTaskLists();
    const promptAssemblyService = createPromptAssemblyService({ db });
    const visualAnalyzer = createVisualAnalyzer({ cas, llmRegistry });
    const mediaGenerationService = new MediaGenerationService({
      db,
      cas,
      promptAssemblyService,
      resolveAdapter: async (attempt) => {
        const task = db.repos.taskLists.getTask(parseTaskId(attempt.taskId));
        const rawConfig = task?.input.providerConfig;
        const providerConfigRecord =
          rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
            ? (rawConfig as Record<string, unknown>)
            : undefined;
        const providerConfig = providerConfigRecord
          ? {
              baseUrl:
                typeof providerConfigRecord.baseUrl === 'string'
                  ? providerConfigRecord.baseUrl.trim()
                  : '',
              model:
                typeof providerConfigRecord.model === 'string'
                  ? providerConfigRecord.model.trim()
                  : '',
            }
          : undefined;
        if (providerConfig && (!providerConfig.baseUrl || !providerConfig.model)) {
          throw new Error('Stored media provider configuration is incomplete');
        }
        return resolveAdapter(
          adapterRegistry,
          attempt.providerId,
          attempt.mediaType,
          attempt.generationSpec.operation,
          providerConfig,
          keychain,
          cas,
        );
      },
    });
    const mediaEvaluationService = new MediaEvaluationService({
      db,
      cas,
      visualAnalyzer,
    });
    const taskExecutionEngine = new TaskExecutionEngine({
      db,
      registry: taskListRegistry,
      handlers: [
        ...createStyleTaskHandlers({
          cas,
          llmRegistry,
        }),
        createAudioTaskHandler({
          cas,
          promptAssemblyService,
          resolveAdapter: ({ providerId, subtype, providerConfig }) =>
            resolveAdapter(
              adapterRegistry,
              providerId,
              subtype,
              subtype,
              providerConfig,
              keychain,
              cas,
            ),
          resolveProcessPrompt: (processKey) =>
            processPromptStore.getEffectiveValue(processKey) ?? undefined,
        }),
        createMediaTaskHandler({
          generationDeps: {
            adapterRegistry,
            cas,
            db,
            canvasStore,
            keychain,
            getWindow: () => mainWindow,
            resolvePresetCatalog: projectPresetCatalog.list,
            promptAssemblyService,
            resolveProcessPrompt: (processKey) =>
              processPromptStore.getEffectiveValue(processKey) ?? undefined,
          },
          mediaGenerationService,
        }),
      ],
    });
    await taskExecutionEngine.recover();
    logTaskExecutionEngineRecovered();
    const audioTaskService = createAudioTaskService({
      db,
      taskExecutionEngine,
      promptAssemblyService,
    });
    audioTaskService.resumePending();
    appAudioTaskService = audioTaskService;
    const mediaTaskService = createMediaTaskService({
      db,
      canvasStore,
      taskExecutionEngine,
      promptAssemblyService,
      mediaGenerationService,
      mediaEvaluationService,
    });
    mediaTaskService.resumePending();
    appMediaTaskService = mediaTaskService;

    await initIpc(() => mainWindow, {
      db,
      cas,
      keychain,
      registry: adapterRegistry,
      llmRegistry,
      taskExecutionEngine,
      promptStore,
      processPromptStore,
      oauthManager,
      promptAssemblyService,
      audioTaskService,
      mediaTaskService,
      mediaGenerationService,
      mediaEvaluationService,
      visualAnalyzer,
      canvasStore,
    });

    startSessionCleanup();

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

    registerSettingsHandlers(ipcMain, db);

    ipcMain.handle('settings:set-analytics-enabled', async (_e, args: { enabled: boolean }) => {
      if (!args || typeof args.enabled !== 'boolean') {
        throw new Error('enabled (boolean) is required');
      }
      const { setAnalyticsEnabled } = await import('./analytics.js');
      setAnalyticsEnabled(args.enabled);
    });

    // Notify renderer that backend is ready
    mark('fully-loaded');
    publishAppInitializationNotification({ status: 'ready' });
    log.info('Lucid Fin initialized successfully');
    logStartupMetrics();
  } catch (err) {
    log.error('Initialization failed:', err);
    publishAppInitializationNotification({ status: 'error', message: String(err) });
  }
});

app.on('window-all-closed', () => {
  stopClipboardWatcher();
  stopSessionCleanup();
  stopUpdateSafety();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownPromise) return;

  shutdownPromise = completeGracefulShutdown({
    flushRenderer: async () => {
      const window = mainWindow;
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      await waitForRendererFlush({
        subscribe: (complete) => {
          const listener = (): void => complete();
          ipcMain.once('app:flush-complete', listener);
          return () => ipcMain.removeListener('app:flush-complete', listener);
        },
        request: () => window.webContents.send('app:flush-before-quit'),
      });
    },
    stopOAuth: async () => {
      const manager = appOAuthManager;
      appOAuthManager = null;
      await manager?.stop();
    },
    stopBackgroundTasks: () => {
      const audioTasks = appAudioTaskService;
      appAudioTaskService = null;
      audioTasks?.stop();
      const mediaTasks = appMediaTaskService;
      appMediaTaskService = null;
      mediaTasks?.stop();
    },
    closeDb: () => {
      const db = appDb;
      appDb = null;
      db?.close();
    },
    log,
  }).finally(() => {
    stopUpdateSafety();
    shutdownComplete = true;
    app.quit();
  });
});

app.on('activate', () => {
  if (mainWindow === null) {
    mainWindow = createWindow();
    attachWindowLogForwarder(mainWindow);
    logWindowCreated();
  }
});
