import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import type { Scene } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { getCurrentProjectId, getCurrentProjectPath } from '../project-context.js';

function requireProject(): { projectId: string; projectPath: string } {
  const projectId = getCurrentProjectId();
  const projectPath = getCurrentProjectPath();
  if (!projectId || !projectPath) throw new Error('No project open');
  return { projectId, projectPath };
}

export function registerSceneHandlers(ipcMain: IpcMain, db: SqliteIndex): void {
  ipcMain.handle('scene:list', async () => {
    const { projectId } = requireProject();
    return db.listScenes(projectId);
  });

  ipcMain.handle('scene:create', async (_e, args: Partial<Scene>) => {
    const { projectId } = requireProject();
    const now = Date.now();
    const existing = db.listScenes(projectId);
    const idx = typeof args?.index === 'number' ? args.index : existing.length;

    const scene: Scene = {
      id: randomUUID(),
      projectId,
      index: idx,
      title: typeof args?.title === 'string' && args.title.trim() ? args.title : `Scene ${idx + 1}`,
      description: typeof args?.description === 'string' ? args.description : '',
      location: typeof args?.location === 'string' ? args.location : '',
      timeOfDay: typeof args?.timeOfDay === 'string' ? args.timeOfDay : '',
      characters: Array.isArray(args?.characters)
        ? args.characters.filter((c): c is string => typeof c === 'string')
        : [],
      keyframes: [],
      segments: [],
      styleOverride: args?.styleOverride ?? undefined,
      createdAt: now,
      updatedAt: now,
    };

    db.upsertScene(scene);
    return scene;
  });

  ipcMain.handle('scene:update', async (_e, args: { id: string; data: Partial<Scene> }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const current = db.getScene(args.id);
    if (!current) throw new Error(`Scene not found: ${args.id}`);

    const data = args.data ?? {};
    const updated: Scene = {
      ...current,
      ...data,
      id: current.id,
      projectId: current.projectId,
      createdAt: current.createdAt,
      updatedAt: Date.now(),
      characters: Array.isArray(data.characters)
        ? data.characters.filter((c): c is string => typeof c === 'string')
        : current.characters,
      keyframes: Array.isArray(data.keyframes) ? data.keyframes : current.keyframes,
      segments: Array.isArray(data.segments) ? data.segments : current.segments,
    };

    db.upsertScene(updated);
    return updated;
  });

  ipcMain.handle('scene:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const existing = db.getScene(args.id);
    if (!existing) throw new Error(`Scene not found: ${args.id}`);
    db.deleteScene(args.id);
  });
}
