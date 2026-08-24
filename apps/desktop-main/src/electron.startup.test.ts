import { beforeAll, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock, getBufferedLogsMock, setLogForwarderMock, logger, markMock } = vi.hoisted(
  () => ({
    ipcHandleMock: vi.fn(),
    getBufferedLogsMock: vi.fn(() => []),
    setLogForwarderMock: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
    markMock: vi.fn(),
  }),
);
const updateSafetyMock = vi.hoisted(() => ({
  initUpdateSafety: vi.fn(),
  stopUpdateSafety: vi.fn(),
}));

vi.mock('electron', () => {
  const electronMock = {
    app: {
      isPackaged: false,
      whenReady: vi.fn(() => ({ then: vi.fn() })),
      on: vi.fn(),
      getPath: vi.fn(() => 'C:/temp'),
      quit: vi.fn(),
    },
    BrowserWindow: vi.fn(),
    Menu: { setApplicationMenu: vi.fn() },
    ipcMain: { handle: ipcHandleMock },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: vi.fn(),
    },
    net: { fetch: vi.fn() },
    shell: { openExternal: vi.fn() },
    clipboard: { readText: vi.fn(() => '') },
  };
  return { ...electronMock, default: electronMock };
});

vi.mock('./logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
  log: vi.fn(),
  initLogger: vi.fn(),
  getBufferedLogs: getBufferedLogsMock,
  setLogForwarder: setLogForwarderMock,
}));

vi.mock('./startup-metrics.js', () => ({
  mark: markMock,
  logStartupMetrics: vi.fn(),
}));

vi.mock('./user-data-path.js', () => ({
  configureUserDataPath: vi.fn(),
}));

vi.mock('./crash-reporter.js', () => ({
  initCrashReporter: vi.fn(),
}));

vi.mock('./bootstrap/init-db.js', () => ({
  initDb: vi.fn(),
}));

vi.mock('./bootstrap/init-ipc.js', () => ({
  initIpc: vi.fn(),
}));

vi.mock('./bootstrap/init-app.js', () => ({
  initApp: vi.fn(),
  restoreAdapterKeys: vi.fn(),
  selectConfiguredLLMAdapter: vi.fn(),
}));

vi.mock('./task-execution/style-task-handlers.js', () => ({
  createStyleTaskHandlers: vi.fn(() => []),
}));

vi.mock('./auto-updater.js', () => ({
  initAutoUpdater: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdateStatus: vi.fn(),
}));

vi.mock('./update-safety.js', () => ({
  initUpdateSafety: updateSafetyMock.initUpdateSafety,
  stopUpdateSafety: updateSafetyMock.stopUpdateSafety,
}));

vi.mock('@lucid-fin/application', () => ({
  AgentOrchestrator: class {},
  TaskExecutionEngine: class {},
  registerDefaultTaskLists: vi.fn(() => ({})),
}));

async function loadModule() {
  vi.resetModules();
  return import('./electron.js');
}

let startupModule: Awaited<ReturnType<typeof loadModule>>;

beforeAll(async () => {
  vi.clearAllMocks();
  startupModule = await loadModule();
});

describe('electron startup observability', () => {
  it('registers logger:getRecent as an early IPC handler on module load', () => {
    expect(ipcHandleMock).toHaveBeenCalledWith('logger:getRecent', expect.any(Function));
    expect(logger.debug).toHaveBeenCalledWith(
      'Registered early IPC handlers',
      expect.objectContaining({
        category: 'ipc',
        channels: [
          'logger:getRecent',
          'updater:*',
          'app:version',
          'ipc:ping',
          'health:ping',
          'app:restart',
        ],
      }),
    );
  });

  it('initializes update safety on module load for production update health tracking', () => {
    expect(updateSafetyMock.initUpdateSafety).toHaveBeenCalledOnce();
  });

  it('logs and marks when the main window is created', () => {
    startupModule.logWindowCreated();

    expect(markMock).toHaveBeenCalledWith('window-created');
    expect(logger.debug).toHaveBeenCalledWith(
      'Main window created',
      expect.objectContaining({
        category: 'startup',
      }),
    );
  });

  it('attaches a logger forwarder that streams entries to the current window', () => {
    const send = vi.fn();

    startupModule.attachWindowLogForwarder({
      isDestroyed: () => false,
      webContents: { send },
    } as never);

    expect(setLogForwarderMock).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledWith(
      'Logger forwarder attached',
      expect.objectContaining({
        category: 'startup',
      }),
    );

    const forwarder = setLogForwarderMock.mock.calls[0]?.[0] as
      ((entry: { id: string }) => void) | undefined;
    expect(forwarder).toBeTypeOf('function');

    forwarder?.({
      id: 'log-1',
      timestamp: 1_700_000_000_000,
      level: 'info',
      category: 'startup',
      message: 'hello',
    } as never);
    expect(send).toHaveBeenCalledWith('logger:entry', expect.objectContaining({ id: 'log-1' }));
  });

  it('logs the task execution engine recovery milestone', () => {
    startupModule.logTaskExecutionEngineRecovered();
    expect(logger.info).toHaveBeenCalledWith(
      'Task execution engine recovered',
      expect.objectContaining({
        category: 'startup',
      }),
    );
  });
});
