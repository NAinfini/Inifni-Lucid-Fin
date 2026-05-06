import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupTestDb,
  createFakeIpcMain,
  createTestDb,
  invoke,
  type FakeIpcMain,
  type TestDb,
} from './ipc-test-harness.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { registerSettingsHandlers } from '../../handlers/settings.handlers.js';

describe('app settings SQL integration', () => {
  let testDb: TestDb;
  let ipcMain: FakeIpcMain;

  beforeEach(() => {
    testDb = createTestDb();
    ipcMain = createFakeIpcMain();
    registerSettingsHandlers(ipcMain as never, testDb.db);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
    vi.clearAllMocks();
  });

  it('loads null before save and persists settings in project_settings', async () => {
    await expect(invoke(ipcMain, 'settings:load')).resolves.toBeNull();

    const payload = {
      renderPreset: 'film',
      providers: { image: { id: 'flux' } },
      lipsync: { backend: 'cloud', cloudEndpoint: 'https://example.test/lipsync' },
    };
    await invoke(ipcMain, 'settings:save', payload);

    await expect(invoke(ipcMain, 'settings:load')).resolves.toEqual(payload);
    const row = testDb.db.rawDb
      .prepare('SELECT value FROM project_settings WHERE key = ?')
      .get('appSettings') as { value: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.value)).toEqual(payload);
  });

  it('rejects non-object save payloads', async () => {
    await expect(invoke(ipcMain, 'settings:save', null)).rejects.toThrow(
      /requires an object payload/i,
    );
    await expect(invoke(ipcMain, 'settings:save', [])).rejects.toThrow(
      /requires an object payload/i,
    );
  });

  it('throws on corrupt stored SQL settings instead of silently using defaults', async () => {
    testDb.db.repos.projectSettings.set('appSettings', '{broken');

    await expect(invoke(ipcMain, 'settings:load')).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to load app settings from SQL',
      expect.objectContaining({ error: expect.any(String) }),
    );
  });
});
