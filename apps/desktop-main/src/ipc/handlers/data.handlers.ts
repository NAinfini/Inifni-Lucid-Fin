/**
 * IPC handlers for full data export and account wipe (R19).
 *
 * Channels:
 *   data:estimateExportSize — returns estimated bytes
 *   data:export             — opens directory picker, exports everything
 *   data:wipe               — requires confirmation token, wipes all user data
 */

import path from 'node:path';
import os from 'node:os';
import type { IpcMain } from 'electron';
import * as electron from 'electron';
import type { SqliteIndex, CAS, Keychain } from '@lucid-fin/storage';
import log from '../../logger.js';
import { exportAllData, estimateExportSize, type ExportPaths } from '../../data-export.js';
import { wipeAllData, WIPE_CONFIRMATION_TOKEN, type WipePaths } from '../../data-wipe.js';

const APP_ROOT = path.join(os.homedir(), '.lucid-fin');
const { app, dialog } = electron;

function resolveExportPaths(): ExportPaths {
  let logsDir: string;
  try {
    logsDir = path.join(app.getPath('userData'), 'logs');
  } catch {
    logsDir = path.join(APP_ROOT, 'logs');
  }

  return {
    dbPath: path.join(APP_ROOT, 'lucid-fin.db'),
    promptsDbPath: path.join(APP_ROOT, 'prompts.db'),
    assetsRoot: path.join(APP_ROOT, 'assets'),
    logsDir,
  };
}

function resolveWipePaths(): WipePaths {
  const exportPaths = resolveExportPaths();
  const logDirs = [path.join(APP_ROOT, 'logs')];
  try {
    const userDataLogs = path.join(app.getPath('userData'), 'logs');
    if (userDataLogs !== logDirs[0]) {
      logDirs.push(userDataLogs);
    }
  } catch {
    /* app.getPath may fail in test — ignore */
  }

  return {
    dbPath: exportPaths.dbPath,
    promptsDbPath: exportPaths.promptsDbPath,
    assetsRoot: exportPaths.assetsRoot,
    logDirs,
  };
}

export interface DataHandlerDeps {
  db: SqliteIndex;
  cas: CAS;
  keychain: Keychain;
  stopBackgroundTasks: () => void;
}

export function registerDataHandlers(ipcMain: IpcMain, deps: DataHandlerDeps): void {
  // --- Estimate export size ---
  ipcMain.handle('data:estimateExportSize', async () => {
    const paths = resolveExportPaths();
    try {
      const totalBytes = await estimateExportSize(paths);
      return { totalBytes };
    } catch (err) {
      log.error('[data-handlers] estimateExportSize failed', {
        category: 'export',
        error: String(err),
      });
      return { totalBytes: 0, error: String(err) };
    }
  });

  // --- Full data export ---
  ipcMain.handle('data:export', async () => {
    log.info('[data-handlers] data:export requested', { category: 'export' });

    const pickerResult = await dialog.showOpenDialog({
      title: 'Choose Export Destination',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (pickerResult.canceled || pickerResult.filePaths.length === 0) {
      log.info('[data-handlers] data:export cancelled by user', { category: 'export' });
      return { success: false, error: 'cancelled' };
    }

    const destBase = pickerResult.filePaths[0];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const exportDir = path.join(destBase, `lucid-fin-export-${timestamp}`);

    const paths = resolveExportPaths();

    let appVersion = '0.0.0';
    try {
      appVersion = app.getVersion();
    } catch {
      /* fallback */
    }

    return exportAllData(exportDir, paths, deps.db.rawDb, appVersion);
  });

  // --- Full data wipe ---
  ipcMain.handle('data:wipe', async (_event, args: { confirmationToken: string }) => {
    if (!args?.confirmationToken || args.confirmationToken !== WIPE_CONFIRMATION_TOKEN) {
      log.warn('[data-handlers] data:wipe rejected — invalid confirmation token', {
        category: 'wipe',
      });
      return {
        success: false,
        steps: [],
        error: 'Invalid confirmation token. You must send the exact confirmation string.',
      };
    }

    log.warn('[data-handlers] data:wipe confirmed — beginning full data wipe', {
      category: 'wipe',
    });

    const paths = resolveWipePaths();

    return wipeAllData(paths, {
      stopBackgroundTasks: deps.stopBackgroundTasks,
      flushPendingSaves: async () => {
        // Best-effort WAL checkpoint before closing
        try {
          deps.db.rawDb.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          /* best-effort */
        }
      },
      closeDb: () => {
        try {
          deps.db.close();
        } catch {
          /* may already be closed */
        }
      },
    });
  });
}
