import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app, dialog, shell } from 'electron';
import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { CAS } from '@lucid-fin/storage';
import log from '../../logger.js';
import { assertWithinRoot } from '../validation.js';

const APP_ROOT = path.join(os.homedir(), '.lucid-fin');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dirSize(dirPath: string): Promise<number> {
  try {
    await fsp.access(dirPath);
  } catch {
    return 0;
  }
  let total = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      const st = await fsp.stat(full).catch(() => null);
      total += st?.size ?? 0;
    } else if (entry.isDirectory()) {
      total += await dirSize(full);
    }
  }
  return total;
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await fsp.stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function countFiles(dirPath: string): Promise<number> {
  try {
    await fsp.access(dirPath);
  } catch {
    return 0;
  }
  let count = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += await countFiles(path.join(dirPath, entry.name));
  }
  return count;
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerStorageHandlers(
  ipcMain: IpcMain,
  deps: { db: SqliteIndex; cas: CAS },
): void {
  // --- Storage overview ---
  ipcMain.handle('storage:getOverview', async () => {
    const dbPath = path.join(APP_ROOT, 'lucid-fin.db');
    const promptsDbPath = path.join(APP_ROOT, 'prompts.db');
    const globalAssetsPath = path.join(APP_ROOT, 'assets');
    const logsPath = path.join(APP_ROOT, 'logs');
    const userDataLogs = (() => {
      try {
        return path.join(app.getPath('userData'), 'logs');
      } catch { /* app.getPath failed in test/dev environment — fall back to local logs path */
        return logsPath;
      }
    })();

    const [dbSize1, dbSize2, globalAssetsSize, globalAssetCount, logsSize1, logsSize2] =
      await Promise.all([
        fileSize(dbPath),
        fileSize(promptsDbPath),
        dirSize(globalAssetsPath),
        countFiles(globalAssetsPath),
        dirSize(logsPath),
        dirSize(userDataLogs),
      ]);
    const dbSize = dbSize1 + dbSize2;
    const logsSize = logsSize1 + logsSize2;

    return {
      appRoot: APP_ROOT,
      dbSize,
      globalAssetsSize,
      globalAssetCount,
      logsSize,
      totalSize: dbSize + globalAssetsSize + logsSize,
      paths: {
        appRoot: APP_ROOT,
        database: dbPath,
        globalAssets: globalAssetsPath,
        logs: userDataLogs,
      },
    };
  });

  // --- Open folder in OS file manager ---
  ipcMain.handle('storage:openFolder', async (_event, args: { path: string }) => {
    if (!args?.path) return;
    assertWithinRoot(APP_ROOT, args.path);
    try {
      await fsp.access(args.path);
    } catch {
      await fsp.mkdir(args.path, { recursive: true });
    }
    shell.openPath(args.path);
  });

  // --- Open file in OS (e.g. database) ---
  ipcMain.handle('storage:showInFolder', async (_event, args: { path: string }) => {
    if (!args?.path) return;
    assertWithinRoot(APP_ROOT, args.path);
    try {
      await fsp.access(args.path);
      shell.showItemInFolder(args.path);
    } catch { /* path does not exist — nothing to show */ }
  });

  // --- Clear logs ---
  ipcMain.handle('storage:clearLogs', async () => {
    let cleared = 0;
    const logDirs = [
      path.join(APP_ROOT, 'logs'),
    ];
    try {
      logDirs.push(path.join(app.getPath('userData'), 'logs'));
    } catch { /* no-op */ }

    for (const logDir of logDirs) {
      let entries: string[];
      try {
        entries = await fsp.readdir(logDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const filePath = path.join(logDir, entry);
        try {
          await fsp.rm(filePath, { force: true });
          cleared++;
        } catch (err) {
          log.warn('[storage] clearLogs: failed to delete', { filePath, error: String(err) });
        }
      }
    }
    return { cleared };
  });

  // --- Clear semantic search index ---
  ipcMain.handle('storage:clearEmbeddings', async () => {
    try {
      deps.db.clearEmbeddings();
      return { success: true };
    } catch (err) {
      log.warn('[storage] clearEmbeddings failed', { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // --- Database VACUUM ---
  ipcMain.handle('storage:vacuumDatabase', async () => {
    try {
      deps.db.vacuum();
      return { success: true };
    } catch (err) {
      log.warn('[storage] vacuum failed', { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // --- Database backup ---
  ipcMain.handle('storage:backupDatabase', async (_event, args: { destPath: string }) => {
    const dbPath = path.join(APP_ROOT, 'lucid-fin.db');
    const resolvedDest = path.resolve(args.destPath);
    if (!resolvedDest || resolvedDest === dbPath) {
      return { success: false, error: 'Invalid destination path' };
    }
    try {
      await fsp.copyFile(dbPath, resolvedDest);
      const promptsDb = path.join(APP_ROOT, 'prompts.db');
      try {
        await fsp.access(promptsDb);
        const promptsDest = resolvedDest.replace(/\.db$/, '-prompts.db');
        await fsp.copyFile(promptsDb, promptsDest);
      } catch { /* prompts.db does not exist — skip */ }
      return { success: true };
    } catch (err) {
      log.warn('[storage] backup failed', { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // --- Database restore ---
  ipcMain.handle('storage:restoreDatabase', async (_event, args: { sourcePath: string }) => {
    const dbPath = path.join(APP_ROOT, 'lucid-fin.db');
    const resolvedSource = path.resolve(args.sourcePath);
    let sourceExists = false;
    try {
      await fsp.access(resolvedSource);
      sourceExists = true;
    } catch { /* not accessible */ }
    if (!resolvedSource || !sourceExists) {
      return { success: false, error: 'Source file not found' };
    }
    try {
      const backupPath = dbPath + '.pre-restore-backup';
      await fsp.copyFile(dbPath, backupPath);
      await fsp.copyFile(resolvedSource, dbPath);
      return { success: true, backupCreated: backupPath };
    } catch (err) {
      log.warn('[storage] restore failed', { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // --- File/folder pickers ---
  ipcMain.handle('storage:pickFolder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle('storage:pickSaveFile', async (_event, args: { defaultName: string }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: args.defaultName,
      filters: [{ name: 'Database', extensions: ['db'] }],
    });
    return result.canceled ? null : result.filePath ?? null;
  });

  ipcMain.handle('storage:pickOpenFile', async (_event, args: { extensions: string[] }) => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'Database', extensions: args.extensions }],
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
}
