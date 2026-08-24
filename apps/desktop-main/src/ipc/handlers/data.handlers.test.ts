import { describe, expect, it, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

const showOpenDialog = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
    getVersion: vi.fn().mockReturnValue('1.0.0-test'),
  },
  dialog: {
    showOpenDialog: showOpenDialog,
  },
}));

const mockExportAllData = vi.hoisted(() => vi.fn());
const mockEstimateExportSize = vi.hoisted(() => vi.fn());

vi.mock('../../data-export.js', () => ({
  exportAllData: mockExportAllData,
  estimateExportSize: mockEstimateExportSize,
}));

const mockWipeAllData = vi.hoisted(() => vi.fn());

vi.mock('../../data-wipe.js', () => ({
  wipeAllData: mockWipeAllData,
  WIPE_CONFIRMATION_TOKEN: 'DELETE',
}));

import { registerDataHandlers } from './data.handlers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for channel: ${channel}`);
      return handler({}, ...args);
    },
    handlers,
  };
}

function createMockDeps() {
  return {
    db: {
      rawDb: { pragma: vi.fn() },
      close: vi.fn(),
      dbPath: '/mock/.lucid-fin/lucid-fin.db',
    },
    cas: {
      getAssetsRoot: vi.fn().mockReturnValue('/mock/.lucid-fin/assets'),
    },
    keychain: {},
    stopBackgroundTasks: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerDataHandlers', () => {
  it('registers all three channels', () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    expect(ipcMain.handle).toHaveBeenCalledWith('data:estimateExportSize', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('data:export', expect.any(Function));
    expect(ipcMain.handle).toHaveBeenCalledWith('data:wipe', expect.any(Function));
  });
});

describe('data:estimateExportSize', () => {
  it('returns estimated size', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    mockEstimateExportSize.mockResolvedValue(12345);
    const result = await ipcMain.invoke('data:estimateExportSize');
    expect(result).toEqual({ totalBytes: 12345 });
  });

  it('returns 0 on error', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    mockEstimateExportSize.mockRejectedValue(new Error('disk failure'));
    const result = await ipcMain.invoke('data:estimateExportSize');
    expect(result).toEqual({ totalBytes: 0, error: expect.stringContaining('disk failure') });
  });
});

describe('data:export', () => {
  it('returns cancelled when user cancels directory picker', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await ipcMain.invoke('data:export');
    expect(result).toEqual({ success: false, error: 'cancelled' });
  });

  it('calls exportAllData with correct args when picker succeeds', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    const destBase = path.join(os.tmpdir(), 'export-dest');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [destBase] });
    mockExportAllData.mockResolvedValue({ success: true, exportDir: destBase });

    const result = await ipcMain.invoke('data:export');
    expect(result.success).toBe(true);
    expect(mockExportAllData).toHaveBeenCalledTimes(1);

    const [exportDir, exportPaths, rawDb, appVersion] = mockExportAllData.mock.calls[0];
    expect(exportDir).toContain('lucid-fin-export-');
    expect(exportDir).toContain(destBase);
    expect(exportPaths.dbPath).toEqual(expect.any(String));
    expect(exportPaths.assetsRoot).toEqual(expect.any(String));
    expect(exportPaths).not.toHaveProperty('settingsPath');
    expect(rawDb).toBe(deps.db.rawDb);
    expect(appVersion).toBe('1.0.0-test');
  });
});

describe('data:wipe', () => {
  it('rejects when confirmation token is missing', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    const result = await ipcMain.invoke('data:wipe', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('confirmation');
    expect(mockWipeAllData).not.toHaveBeenCalled();
  });

  it('rejects when confirmation token is wrong', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    const result = await ipcMain.invoke('data:wipe', { confirmationToken: 'WRONG' });
    expect(result.success).toBe(false);
    expect(mockWipeAllData).not.toHaveBeenCalled();
  });

  it('proceeds when confirmation token is correct', async () => {
    const ipcMain = createMockIpcMain();
    const deps = createMockDeps();
    registerDataHandlers(ipcMain as never, deps as never);

    mockWipeAllData.mockResolvedValue({ success: true, steps: [] });

    const result = await ipcMain.invoke('data:wipe', { confirmationToken: 'DELETE' });
    expect(result.success).toBe(true);
    expect(mockWipeAllData).toHaveBeenCalledTimes(1);

    // Verify deps are wired correctly
    const [, wipeDeps] = mockWipeAllData.mock.calls[0];
    expect(typeof wipeDeps.stopBackgroundTasks).toBe('function');
    expect(typeof wipeDeps.flushPendingSaves).toBe('function');
    expect(typeof wipeDeps.closeDb).toBe('function');
  });
});
