import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import { registerBackupHandlers } from './backup.handlers.js';

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

const mockCreateBackup = vi.hoisted(() => vi.fn());
const mockListBackups = vi.hoisted(() => vi.fn());
const mockRestoreBackup = vi.hoisted(() => vi.fn());

vi.mock('@lucid-fin/storage', () => ({
  createBackup: mockCreateBackup,
  listBackups: mockListBackups,
  restoreBackup: mockRestoreBackup,
}));

vi.mock('node:module', () => ({
  createRequire: () => () => class MockDatabase {},
}));

describe('registerBackupHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let db: SqliteIndex;

  beforeEach(() => {
    handlers = new Map();
    const ipcMain = {
      handle: (ch: string, fn: (...args: unknown[]) => unknown) => handlers.set(ch, fn),
    } as unknown as IpcMain;
    db = { rawDb: {}, dbPath: '/test/db.sqlite' } as unknown as SqliteIndex;

    registerBackupHandlers(ipcMain, db);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('db:createBackup', () => {
    it('returns result from createBackup on success', async () => {
      const result = {
        success: true,
        filename: 'backup-2026-05-16.sqlite',
        sizeBytes: 1024,
        durationMs: 42,
      };
      mockCreateBackup.mockReturnValue(result);

      const handler = handlers.get('db:createBackup')!;
      const response = await handler({});

      expect(response).toEqual(result);
      expect(mockCreateBackup).toHaveBeenCalledWith(db.rawDb, db.dbPath);
      expect(logger.info).toHaveBeenCalledWith(
        'IPC: db:createBackup requested',
        expect.objectContaining({ category: 'backup' }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'IPC: db:createBackup completed',
        expect.objectContaining({ category: 'backup', filename: 'backup-2026-05-16.sqlite' }),
      );
    });

    it('returns { success: false, error } when createBackup throws', async () => {
      mockCreateBackup.mockImplementation(() => {
        throw new Error('disk full');
      });

      const handler = handlers.get('db:createBackup')!;
      const response = await handler({});

      expect(response).toEqual({ success: false, error: 'Error: disk full' });
      expect(logger.error).toHaveBeenCalledWith(
        'IPC: db:createBackup threw',
        expect.objectContaining({ category: 'backup', error: 'Error: disk full' }),
      );
    });
  });

  describe('db:listBackups', () => {
    it('returns array from listBackups', async () => {
      const backups = [
        { filename: 'backup-1.sqlite', createdAt: '2026-05-15' },
        { filename: 'backup-2.sqlite', createdAt: '2026-05-16' },
      ];
      mockListBackups.mockReturnValue(backups);

      const handler = handlers.get('db:listBackups')!;
      const response = await handler({});

      expect(response).toEqual(backups);
      expect(mockListBackups).toHaveBeenCalledWith(db.dbPath);
    });

    it('returns empty array on throw', async () => {
      mockListBackups.mockImplementation(() => {
        throw new Error('read error');
      });

      const handler = handlers.get('db:listBackups')!;
      const response = await handler({});

      expect(response).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'IPC: db:listBackups threw',
        expect.objectContaining({ category: 'backup', error: 'Error: read error' }),
      );
    });
  });

  describe('db:restoreBackup', () => {
    it('returns error if filename arg is missing', async () => {
      const handler = handlers.get('db:restoreBackup')!;

      const response = await handler({}, {} as { filename: string });

      expect(response).toEqual({
        success: false,
        error: 'Missing backup filename',
        rolledBack: false,
      });
    });

    it('returns result from restoreBackup on success', async () => {
      const result = {
        success: true,
        restoredFrom: 'backup-1.sqlite',
        preRestoreBackup: 'pre-restore-backup.sqlite',
      };
      mockRestoreBackup.mockReturnValue(result);

      const handler = handlers.get('db:restoreBackup')!;
      const response = await handler({}, { filename: 'backup-1.sqlite' });

      expect(response).toEqual(result);
      expect(mockRestoreBackup).toHaveBeenCalledWith(
        db.rawDb,
        db.dbPath,
        'backup-1.sqlite',
        expect.anything(),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'IPC: db:restoreBackup completed — app restart required',
        expect.objectContaining({ category: 'backup', restoredFrom: 'backup-1.sqlite' }),
      );
    });

    it('returns { success: false, error, rolledBack: false } when restoreBackup throws', async () => {
      mockRestoreBackup.mockImplementation(() => {
        throw new Error('corruption detected');
      });

      const handler = handlers.get('db:restoreBackup')!;
      const response = await handler({}, { filename: 'backup-1.sqlite' });

      expect(response).toEqual({
        success: false,
        error: 'Error: corruption detected',
        rolledBack: false,
      });
      expect(logger.error).toHaveBeenCalledWith(
        'IPC: db:restoreBackup threw',
        expect.objectContaining({ category: 'backup', error: 'Error: corruption detected' }),
      );
    });
  });
});
