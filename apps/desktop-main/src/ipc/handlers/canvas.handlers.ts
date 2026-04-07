import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import log from '../../logger.js';
import type { Canvas } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import { getCurrentProjectId } from '../project-context.js';

function requireProject(): { projectId: string } {
  const projectId = getCurrentProjectId();
  if (!projectId) throw new Error('No project open');
  return { projectId };
}

/**
 * Thin wrapper around SqliteIndex canvas methods that satisfies
 * the CanvasStore interface used by commander and generation handlers.
 *
 * Commander mutates canvas objects in-place then calls `save()` to persist.
 */
export interface CanvasStore {
  get(id: string): Canvas | undefined;
  save(canvas: Canvas): void;
  delete(id: string): void;
  listForProject(projectId: string): Array<{ id: string; name: string; updatedAt: number }>;
}

export function createCanvasStore(db: SqliteIndex): CanvasStore {
  return {
    get: (id) => db.getCanvas(id),
    save: (canvas) => db.upsertCanvas(canvas),
    delete: (id) => db.deleteCanvas(id),
    listForProject: (projectId) => db.listCanvases(projectId),
  };
}

export function registerCanvasHandlers(ipcMain: IpcMain, store: CanvasStore): void {
  ipcMain.handle('canvas:list', async () => {
    const { projectId } = requireProject();
    return store.listForProject(projectId);
  });

  ipcMain.handle('canvas:load', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const canvas = store.get(args.id);
    if (!canvas) throw new Error(`Canvas not found: ${args.id}`);
    return canvas;
  });

  ipcMain.handle('canvas:save', async (_e, data: Canvas) => {
    if (!data || typeof data.id !== 'string') throw new Error('canvas data with id is required');
    const { projectId } = requireProject();
    data.projectId = projectId;
    data.updatedAt = Date.now();
    store.save(data);
    log.info('Canvas saved:', data.id);
  });

  ipcMain.handle('canvas:create', async (_e, args: { name: string }) => {
    if (!args || typeof args.name !== 'string' || !args.name.trim()) {
      throw new Error('name is required');
    }
    const { projectId } = requireProject();
    const now = Date.now();
    const canvas: Canvas = {
      id: randomUUID(),
      projectId,
      name: args.name.trim(),
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: now,
      updatedAt: now,
    };
    store.save(canvas);
    log.info('Canvas created:', canvas.id, canvas.name);
    return canvas;
  });

  ipcMain.handle('canvas:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    store.delete(args.id);
    log.info('Canvas deleted:', args.id);
  });

  ipcMain.handle('canvas:rename', async (_e, args: { id: string; name: string }) => {
    if (!args || typeof args.id !== 'string' || typeof args.name !== 'string') {
      throw new Error('id and name are required');
    }
    const canvas = store.get(args.id);
    if (!canvas) throw new Error(`Canvas not found: ${args.id}`);
    canvas.name = args.name.trim();
    canvas.updatedAt = Date.now();
    store.save(canvas);
    log.info('Canvas renamed:', args.id, canvas.name);
  });
}
