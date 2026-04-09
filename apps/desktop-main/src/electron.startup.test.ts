import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  ipcHandleMock,
  getBufferedLogsMock,
  setLogForwarderMock,
  logger,
  markMock,
} = vi.hoisted(() => ({
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
}));

vi.mock('electron', () => ({
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
}));

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

vi.mock('./workflow/style-workflow-handlers.js', () => ({
  createStyleWorkflowHandlers: vi.fn(() => []),
}));

vi.mock('./workflow/storyboard-workflow-handlers.js', () => ({
  createStoryboardWorkflowHandlers: vi.fn(() => []),
}));

vi.mock('./auto-updater.js', () => ({
  initAutoUpdater: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  getUpdateStatus: vi.fn(),
}));

vi.mock('@lucid-fin/application', () => ({
  AgentOrchestrator: class {},
  JobQueue: class {},
  WorkflowEngine: class {},
  WorkflowRecovery: class {},
  registerDefaultWorkflows: vi.fn(() => ({})),
}));

async function loadModule() {
  vi.resetModules();
  return import('./electron.js');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('electron startup observability', () => {
  it('registers logger:getRecent as an early IPC handler on module load', async () => {
    await loadModule();

    expect(ipcHandleMock).toHaveBeenCalledWith('logger:getRecent', expect.any(Function));
    expect(logger.debug).toHaveBeenCalledWith(
      'Registered early IPC handler',
      expect.objectContaining({
        category: 'ipc',
        channel: 'logger:getRecent',
      }),
    );
  });

  it('logs and marks when the main window is created', async () => {
    const module = await loadModule();

    module.logWindowCreated();

    expect(markMock).toHaveBeenCalledWith('window-created');
    expect(logger.debug).toHaveBeenCalledWith(
      'Main window created',
      expect.objectContaining({
        category: 'startup',
      }),
    );
  });

  it('attaches a logger forwarder that streams entries to the current window', async () => {
    const module = await loadModule();
    const send = vi.fn();

    module.attachWindowLogForwarder({
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
      | ((entry: { id: string }) => void)
      | undefined;
    expect(forwarder).toBeTypeOf('function');

    forwarder?.({ id: 'log-1' } as never);
    expect(send).toHaveBeenCalledWith('logger:entry', expect.objectContaining({ id: 'log-1' }));
  });

  it('logs startup recovery milestones for the job queue and workflow engine', async () => {
    const module = await loadModule();

    module.logJobQueueRecovered();
    module.logWorkflowEngineRecovered();

    expect(logger.info).toHaveBeenCalledWith(
      'Job queue recovered and started',
      expect.objectContaining({
        category: 'startup',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow engine recovered',
      expect.objectContaining({
        category: 'startup',
      }),
    );
  });
});
