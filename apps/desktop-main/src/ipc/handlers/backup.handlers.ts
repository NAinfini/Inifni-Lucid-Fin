/**
 * IPC handlers for database backup operations (R24).
 *
 * Channels:
 *   db:createBackup  — trigger a manual backup
 *   db:listBackups   — list available backups
 *   db:restoreBackup — restore from a specific backup (destructive)
 */

import { createRequire } from 'node:module';
import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import { createBackup, listBackups, restoreBackup } from '@lucid-fin/storage';
import type BetterSqlite3 from 'better-sqlite3';
import log from '../../logger.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

export function registerBackupHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  // --- Create a manual backup ---
  ipcMain.handle('db:createBackup', async () => {
    log.info('IPC: db:createBackup requested', { category: 'backup' });
    try {
      const result = createBackup(db.rawDb, db.dbPath);
      if (result.success) {
        log.info('IPC: db:createBackup completed', {
          category: 'backup',
          filename: result.filename,
          sizeBytes: result.sizeBytes,
          durationMs: result.durationMs,
        });
      } else {
        log.warn('IPC: db:createBackup failed', {
          category: 'backup',
          error: result.error,
        });
      }
      return result;
    } catch (err) {
      log.error('IPC: db:createBackup threw', {
        category: 'backup',
        error: String(err),
      });
      return { success: false, error: String(err) };
    }
  });

  // --- List available backups ---
  ipcMain.handle('db:listBackups', async () => {
    try {
      return listBackups(db.dbPath);
    } catch (err) {
      log.error('IPC: db:listBackups threw', {
        category: 'backup',
        error: String(err),
      });
      return [];
    }
  });

  // --- Restore from a backup (requires confirmation from renderer) ---
  ipcMain.handle('db:restoreBackup', async (_event, args: { filename: string }) => {
    if (!args?.filename) {
      return { success: false, error: 'Missing backup filename', rolledBack: false };
    }

    log.info('IPC: db:restoreBackup requested', {
      category: 'backup',
      filename: args.filename,
    });

    try {
      const result = restoreBackup(db.rawDb, db.dbPath, args.filename, Database);

      if (result.success) {
        log.info('IPC: db:restoreBackup completed — app restart required', {
          category: 'backup',
          restoredFrom: result.restoredFrom,
          preRestoreBackup: result.preRestoreBackup,
        });
      } else {
        log.error('IPC: db:restoreBackup failed', {
          category: 'backup',
          error: result.error,
          rolledBack: result.rolledBack,
        });
      }

      return result;
    } catch (err) {
      log.error('IPC: db:restoreBackup threw', {
        category: 'backup',
        error: String(err),
      });
      return { success: false, error: String(err), rolledBack: false };
    }
  });
}
