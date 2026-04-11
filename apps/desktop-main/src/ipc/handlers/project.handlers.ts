import type { IpcMain } from 'electron';
import path from 'node:path';
import os from 'node:os';
import type { ProjectFS, SqliteIndex, CAS } from '@lucid-fin/storage';
import { setCurrentProject, getCurrentProjectPath } from '../project-context.js';
import { openProjectSession } from '../project-session.js';

const HOME = path.resolve(os.homedir());

export function registerProjectHandlers(
  ipcMain: IpcMain,
  projectFS: ProjectFS,
  db: SqliteIndex,
  cas: CAS,
): void {
  ipcMain.handle(
    'project:create',
    async (
      _e,
      config: {
        title: string;
        description?: string;
        genre?: string;
        resolution?: [number, number];
        fps?: number;
        basePath?: string;
      },
    ) => {
      if (!config.title || typeof config.title !== 'string') throw new Error('title is required');
      // Validate basePath stays within user home if provided
      if (config.basePath) {
        const resolved = path.resolve(config.basePath);
        if (!resolved.startsWith(HOME + path.sep) && resolved !== HOME)
          throw new Error('basePath must be within user home directory');
      }
      const { manifest, projectPath } = projectFS.createProject(config);
      setCurrentProject(manifest.id, projectPath);
      const session = openProjectSession(manifest.id, projectPath);
      cas.setProjectRoot(projectPath);
      db.upsertProject({
        id: manifest.id,
        title: manifest.title,
        path: projectPath,
        updatedAt: manifest.updatedAt,
      });
      return { ...manifest, sessionId: session.id };
    },
  );

  ipcMain.handle('project:open', async (_e, args: { path: string }) => {
    if (!args.path || typeof args.path !== 'string') throw new Error('path is required');
    const resolved = path.resolve(args.path);
    if (!resolved.startsWith(HOME + path.sep) && resolved !== HOME) throw new Error('path must be within user home directory');
    const manifest = projectFS.openProject(resolved);
    setCurrentProject(manifest.id, resolved);
    const session = openProjectSession(manifest.id, resolved);
    cas.setProjectRoot(resolved);
    db.upsertProject({
      id: manifest.id,
      title: manifest.title,
      path: resolved,
      updatedAt: manifest.updatedAt,
    });
    db.syncFromJson(resolved);
    return { ...manifest, sessionId: session.id };
  });

  ipcMain.handle('project:save', async () => {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) throw new Error('No project open');
    const manifest = projectFS.openProject(projectPath);
    projectFS.saveProject(projectPath, manifest);
  });

  ipcMain.handle('project:list', async () => {
    return projectFS.listRecentProjects();
  });

  ipcMain.handle('project:snapshot', async (_e, args: { name: string }) => {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) throw new Error('No project open');
    const snapshot = projectFS.createSnapshot(projectPath, args.name, db);
    return { id: snapshot.id };
  });

  ipcMain.handle('project:snapshot:list', async () => {
    const projectPath = getCurrentProjectPath();
    if (!projectPath) throw new Error('No project open');
    return projectFS.listSnapshots(projectPath);
  });

  ipcMain.handle('project:snapshot:restore', async (_e, args: { snapshotId: string }) => {
    if (!args.snapshotId || !/^[\w-]+$/.test(args.snapshotId))
      throw new Error('Invalid snapshotId');
    const projectPath = getCurrentProjectPath();
    if (!projectPath) throw new Error('No project open');
    projectFS.restoreSnapshot(projectPath, args.snapshotId, db);
  });
}
