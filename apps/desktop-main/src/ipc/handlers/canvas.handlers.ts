import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import log from '../../logger.js';
import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';
import { LRUCache } from '@lucid-fin/application';
import type { SqliteIndex } from '@lucid-fin/storage';

interface CanvasPatch {
  canvasId: string;
  timestamp: number;
  nameChange?: string;
  addedNodes?: CanvasNode[];
  removedNodeIds?: string[];
  updatedNodes?: Array<{ id: string; changes: Record<string, unknown> }>;
  addedEdges?: CanvasEdge[];
  removedEdgeIds?: string[];
}

function applyPatch(canvas: Canvas, patch: CanvasPatch): void {
  if (patch.nameChange !== undefined) {
    canvas.name = patch.nameChange;
  }

  if (patch.removedNodeIds && patch.removedNodeIds.length > 0) {
    const removedSet = new Set(patch.removedNodeIds);
    canvas.nodes = canvas.nodes.filter(n => !removedSet.has(n.id));
  }

  if (patch.updatedNodes && patch.updatedNodes.length > 0) {
    const nodeMap = new Map(canvas.nodes.map(n => [n.id, n]));
    for (const { id, changes } of patch.updatedNodes) {
      const node = nodeMap.get(id);
      if (node) {
        Object.assign(node, changes);
      }
    }
  }

  if (patch.addedNodes && patch.addedNodes.length > 0) {
    canvas.nodes.push(...patch.addedNodes);
  }

  if (patch.removedEdgeIds && patch.removedEdgeIds.length > 0) {
    const removedSet = new Set(patch.removedEdgeIds);
    canvas.edges = canvas.edges.filter(e => !removedSet.has(e.id));
  }

  if (patch.addedEdges && patch.addedEdges.length > 0) {
    canvas.edges.push(...patch.addedEdges);
  }
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
  list(): Array<{ id: string; name: string; updatedAt: number }>;
}

export function createCanvasStore(db: SqliteIndex): CanvasStore {
  const cache = new LRUCache<string, Canvas>(50);

  return {
    get: (id) => {
      const cached = cache.get(id);
      if (cached) return cached;
      const fromDb = db.getCanvas(id);
      if (fromDb) cache.set(id, fromDb);
      return fromDb;
    },
    save: (canvas) => {
      cache.set(canvas.id, canvas);
      db.upsertCanvas(canvas);
    },
    delete: (id) => {
      cache.delete(id);
      db.deleteCanvas(id);
    },
    list: () => db.listCanvases(),
  };
}

export function registerCanvasHandlers(ipcMain: IpcMain, store: CanvasStore): void {
  ipcMain.handle('canvas:list', async () => {
    return store.list();
  });

  ipcMain.handle('canvas:load', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    const canvas = store.get(args.id);
    if (!canvas) throw new Error(`Canvas not found: ${args.id}`);
    return canvas;
  });

  ipcMain.handle('canvas:save', async (_e, data: Canvas) => {
    if (!data || typeof data.id !== 'string') throw new Error('canvas data with id is required');
    data.updatedAt = Date.now();
    store.save(data);
    log.debug('Canvas saved:', data.id);
  });

  ipcMain.handle('canvas:create', async (_e, args: { name: string }) => {
    if (!args || typeof args.name !== 'string' || !args.name.trim()) {
      throw new Error('name is required');
    }
    const now = Date.now();
    const canvas: Canvas = {
      id: randomUUID(),
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

  ipcMain.handle('canvas:patch', async (_e, args: { canvasId: string; patch: CanvasPatch }) => {
    if (!args || typeof args.canvasId !== 'string') throw new Error('canvasId is required');
    const canvas = store.get(args.canvasId);
    if (!canvas) throw new Error(`Canvas not found: ${args.canvasId}`);
    applyPatch(canvas, args.patch);
    canvas.updatedAt = Date.now();
    store.save(canvas);
    log.debug('Canvas patched:', args.canvasId);
  });
}
