import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { dialog, shell } from 'electron';
import type { IpcMain } from 'electron';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { CAS } from '@lucid-fin/storage';
import log from '../../logger.js';

const APP_ROOT = path.join(os.homedir(), '.lucid-fin');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      total += fs.statSync(full).size;
    } else if (entry.isDirectory()) {
      total += dirSize(full);
    }
  }
  return total;
}

function fileSize(filePath: string): number {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function countFiles(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let count = 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += countFiles(path.join(dirPath, entry.name));
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
    const projectsPath = path.join(APP_ROOT, 'projects');
    const logsPath = path.join(APP_ROOT, 'logs');
    const userDataLogs = (() => {
      try {
        const { app } = require('electron');
        return path.join(app.getPath('userData'), 'logs');
      } catch {
        return logsPath;
      }
    })();

    const dbSize = fileSize(dbPath) + fileSize(promptsDbPath);
    const globalAssetsSize = dirSize(globalAssetsPath);
    const globalAssetCount = countFiles(globalAssetsPath);
    const projectsSize = dirSize(projectsPath);
    const logsSize = dirSize(logsPath) + dirSize(userDataLogs);

    // Per-project breakdown
    const projects: Array<{ name: string; path: string; size: number }> = [];
    if (fs.existsSync(projectsPath)) {
      for (const entry of fs.readdirSync(projectsPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const pPath = path.join(projectsPath, entry.name);
          projects.push({
            name: entry.name.replace(/\.lucid$/, ''),
            path: pPath,
            size: dirSize(pPath),
          });
        }
      }
    }

    return {
      appRoot: APP_ROOT,
      dbSize,
      globalAssetsSize,
      globalAssetCount,
      projectsSize,
      logsSize,
      totalSize: dbSize + globalAssetsSize + projectsSize + logsSize,
      projects,
      paths: {
        appRoot: APP_ROOT,
        database: dbPath,
        globalAssets: globalAssetsPath,
        projects: projectsPath,
        logs: userDataLogs,
      },
    };
  });

  // --- Open folder in OS file manager ---
  ipcMain.handle('storage:openFolder', async (_event, args: { path: string }) => {
    if (!args?.path) return;
    if (!fs.existsSync(args.path)) {
      fs.mkdirSync(args.path, { recursive: true });
    }
    shell.openPath(args.path);
  });

  // --- Open file in OS (e.g. database) ---
  ipcMain.handle('storage:showInFolder', async (_event, args: { path: string }) => {
    if (!args?.path) return;
    if (fs.existsSync(args.path)) {
      shell.showItemInFolder(args.path);
    }
  });

  // --- Clear logs ---
  ipcMain.handle('storage:clearLogs', async () => {
    let cleared = 0;
    const logDirs = [
      path.join(APP_ROOT, 'logs'),
    ];
    try {
      const { app } = require('electron');
      logDirs.push(path.join(app.getPath('userData'), 'logs'));
    } catch { /* no-op */ }

    for (const logDir of logDirs) {
      if (!fs.existsSync(logDir)) continue;
      for (const entry of fs.readdirSync(logDir)) {
        const filePath = path.join(logDir, entry);
        try {
          fs.rmSync(filePath, { force: true });
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
    try {
      fs.copyFileSync(dbPath, args.destPath);
      // Also backup prompts.db
      const promptsDb = path.join(APP_ROOT, 'prompts.db');
      if (fs.existsSync(promptsDb)) {
        const promptsDest = args.destPath.replace(/\.db$/, '-prompts.db');
        fs.copyFileSync(promptsDb, promptsDest);
      }
      return { success: true };
    } catch (err) {
      log.warn('[storage] backup failed', { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // --- Database restore ---
  ipcMain.handle('storage:restoreDatabase', async (_event, args: { sourcePath: string }) => {
    const dbPath = path.join(APP_ROOT, 'lucid-fin.db');
    try {
      // Create backup of current before restoring
      const backupPath = dbPath + '.pre-restore-backup';
      fs.copyFileSync(dbPath, backupPath);
      fs.copyFileSync(args.sourcePath, dbPath);
      return { success: true, backupCreated: backupPath };
    } catch (err) {
      log.warn('[storage] restore failed', { error: String(err) });
      return { success: false, error: String(err) };
    }
  });

  // --- Get/Set default project path ---
  ipcMain.handle('storage:getProjectsPath', async () => {
    return path.join(APP_ROOT, 'projects');
  });

  ipcMain.handle('storage:setProjectsPath', async (_event, args: { path: string }) => {
    // Store custom projects path in a config file
    const configPath = path.join(APP_ROOT, 'storage-config.json');
    try {
      let config: Record<string, unknown> = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
      config.projectsPath = args.path;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch (err) {
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
