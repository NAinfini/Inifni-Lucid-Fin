import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import log from '../../logger.js';
import { startTrace } from '../../perf-trace.js';
import type { Canvas, CanvasId, CanvasPatch, OrderedDeliverySequence } from '@lucid-fin/contracts';
import { LRUCache } from '@lucid-fin/application';
import type { SqliteIndex } from '@lucid-fin/storage';
import { parseCanvasId } from '@lucid-fin/contracts-parse';
import { trackEvent } from '../../analytics.js';

function applyPatch(canvas: Canvas, patch: CanvasPatch): void {
  if (patch.canvasId !== canvas.id) {
    throw new Error(`Canvas patch target mismatch: expected ${canvas.id}, received ${patch.canvasId}`);
  }

  const existingNodeIds = new Set(canvas.nodes.map((node) => node.id));
  const existingEdgeIds = new Set(canvas.edges.map((edge) => edge.id));
  const removedNodeIds = new Set(patch.removedNodeIds ?? []);
  const removedEdgeIds = new Set(patch.removedEdgeIds ?? []);
  const addedNodeIds = new Set<string>();
  const addedEdgeIds = new Set<string>();

  for (const nodeId of removedNodeIds) {
    if (!existingNodeIds.has(nodeId)) throw new Error(`Node not found: ${nodeId}`);
  }
  for (const { id } of patch.updatedNodes ?? []) {
    if (!existingNodeIds.has(id) || removedNodeIds.has(id)) throw new Error(`Node not found: ${id}`);
  }
  for (const node of patch.addedNodes ?? []) {
    if (existingNodeIds.has(node.id) || addedNodeIds.has(node.id)) {
      throw new Error(`Duplicate node: ${node.id}`);
    }
    addedNodeIds.add(node.id);
  }
  for (const edgeId of removedEdgeIds) {
    if (!existingEdgeIds.has(edgeId)) throw new Error(`Edge not found: ${edgeId}`);
  }
  for (const { id } of patch.updatedEdges ?? []) {
    if (!existingEdgeIds.has(id) || removedEdgeIds.has(id)) throw new Error(`Edge not found: ${id}`);
  }
  for (const edge of patch.addedEdges ?? []) {
    if (existingEdgeIds.has(edge.id) || addedEdgeIds.has(edge.id)) {
      throw new Error(`Duplicate edge: ${edge.id}`);
    }
    addedEdgeIds.add(edge.id);
  }

  if (patch.nameChange !== undefined) {
    canvas.name = patch.nameChange;
  }

  if (removedNodeIds.size > 0) {
    canvas.nodes = canvas.nodes.filter((n) => !removedNodeIds.has(n.id));
  }

  if (patch.updatedNodes && patch.updatedNodes.length > 0) {
    const nodeMap = new Map(canvas.nodes.map((n) => [n.id, n]));
    for (const { id, changes } of patch.updatedNodes) {
      const node = nodeMap.get(id)!;
      const {
        __proto__: _p,
        constructor: _c,
        prototype: _pr,
        ...safeChanges
      } = changes as Record<string, unknown>;
      Object.assign(node, safeChanges);
    }
  }

  if (patch.addedNodes && patch.addedNodes.length > 0) {
    canvas.nodes.push(...patch.addedNodes);
  }

  if (removedEdgeIds.size > 0) {
    canvas.edges = canvas.edges.filter((e) => !removedEdgeIds.has(e.id));
  }

  if (patch.updatedEdges && patch.updatedEdges.length > 0) {
    const updateMap = new Map(patch.updatedEdges.map((u) => [u.id, u.edge]));
    canvas.edges = canvas.edges.map((e) => updateMap.get(e.id) ?? e);
  }

  if (patch.addedEdges && patch.addedEdges.length > 0) {
    canvas.edges.push(...patch.addedEdges);
  }

  const finalNodeIds = new Set(canvas.nodes.map((node) => node.id));
  for (const edge of canvas.edges) {
    if (!finalNodeIds.has(edge.source) || !finalNodeIds.has(edge.target)) {
      throw new Error(`Edge ${edge.id} references a missing node`);
    }
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
  archive(id: string): void;
  restore(id: string): void;
  deletePermanent(id: string): void;
  list(): Array<{ id: string; name: string; updatedAt: number; archivedAt?: number }>;
  listFull(): Canvas[];
  patchApply(id: string, patch: CanvasPatch): void;
  replaceDeliverySequence(id: CanvasId, deliverySequence: OrderedDeliverySequence): void;
}

export function createCanvasStore(db: SqliteIndex): CanvasStore {
  const cache = new LRUCache<string, Canvas>(50);
  const { canvases } = db.repos;

  return {
    get: (id) => {
      const canvasId = parseCanvasId(id);
      const cached = cache.get(canvasId);
      if (cached) return cached;
      const fromDb = canvases.get(canvasId);
      if (fromDb) cache.set(canvasId, fromDb);
      return fromDb;
    },
    save: (canvas) => {
      // Canonicalize before persistence so cache, DB, and subsequent
      // get()/lifecycle calls all key off the same normalized id.
      const canvasId = parseCanvasId(canvas.id);
      canvas.id = canvasId;
      const persisted = canvases.get(canvasId);
      const toSave = { ...canvas, deliverySequence: persisted?.deliverySequence };
      canvases.upsert(toSave);
      cache.set(canvasId, toSave);
    },
    archive: (id) => {
      const canvasId = parseCanvasId(id);
      canvases.archive(canvasId);
      cache.delete(canvasId);
    },
    restore: (id) => {
      const canvasId = parseCanvasId(id);
      canvases.restore(canvasId);
      cache.delete(canvasId);
    },
    deletePermanent: (id) => {
      const canvasId = parseCanvasId(id);
      canvases.deletePermanent(canvasId);
      cache.delete(canvasId);
    },
    list: () => canvases.list(),
    listFull: () => {
      const result = canvases.listFull();
      for (const canvas of result.rows) {
        const canvasId = parseCanvasId(canvas.id);
        canvas.id = canvasId;
        if (canvas.archivedAt === undefined) cache.set(canvasId, canvas);
        else cache.delete(canvasId);
      }
      return result.rows;
    },
    patchApply: (id, patch) => {
      const canvasId = parseCanvasId(id);
      const current = cache.get(canvasId) ?? canvases.get(canvasId);
      if (!current) throw new Error(`Canvas not found: ${canvasId}`);
      const next = structuredClone(current) as Canvas;
      applyPatch(next, patch);
      const updatedAt = patch.timestamp;
      next.updatedAt = updatedAt;
      const nodeMap = new Map(next.nodes.map((node, zIndex) => [node.id, { node, zIndex }]));
      const edgeMap = new Map(next.edges.map((edge, zIndex) => [edge.id, { edge, zIndex }]));

      canvases.patchApply(canvasId, {
        nameChange: patch.nameChange,
        addedNodes: patch.addedNodes?.flatMap((node) => {
          const entry = nodeMap.get(node.id);
          return entry ? [entry] : [];
        }),
        removedNodeIds: patch.removedNodeIds,
        updatedNodes: patch.updatedNodes?.flatMap(({ id: nodeId }) => {
          const entry = nodeMap.get(nodeId);
          return entry ? [entry] : [];
        }),
        addedEdges: patch.addedEdges?.flatMap((edge) => {
          const entry = edgeMap.get(edge.id);
          return entry ? [entry] : [];
        }),
        removedEdgeIds: patch.removedEdgeIds,
        updatedEdges: patch.updatedEdges?.flatMap(({ id: edgeId }) => {
          const entry = edgeMap.get(edgeId);
          return entry ? [entry] : [];
        }),
        updatedAt,
      });
      cache.set(canvasId, next);
    },
    replaceDeliverySequence: (id, deliverySequence) => {
      const current = cache.get(id) ?? canvases.get(id);
      if (!current) throw new Error(`Canvas not found: ${id}`);
      cache.set(id, { ...current, deliverySequence, updatedAt: deliverySequence.updatedAt });
    },
  };
}

export function registerCanvasHandlers(ipcMain: IpcMain, store: CanvasStore): void {
  ipcMain.handle('canvas:list', async () => {
    return store.list();
  });

  ipcMain.handle('canvas:loadAll', async () => {
    const trace = startTrace('canvas-load-all');
    const result = store.listFull();
    trace.addMeasurement('canvasCount', result.length);
    trace.finish();
    return result;
  });

  ipcMain.handle('canvas:load', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');

    const trace = startTrace('canvas-load', { canvasId: args.id });
    const canvas = store.get(args.id);

    if (!canvas) {
      trace.finish({ error: 'not-found' });
      throw new Error(`Canvas not found: ${args.id}`);
    }

    trace.addMeasurement('nodeCount', canvas.nodes.length);
    trace.addMeasurement('edgeCount', canvas.edges.length);
    trace.finish();

    trackEvent('canvas_opened', { nodeCount: canvas.nodes.length });

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
    trackEvent('canvas_created');
    return canvas;
  });

  ipcMain.handle('canvas:delete', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    store.archive(args.id);
    log.info('Canvas archived:', args.id);
  });

  ipcMain.handle('canvas:restore', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    store.restore(args.id);
    log.info('Canvas restored:', args.id);
  });

  ipcMain.handle('canvas:deletePermanent', async (_e, args: { id: string }) => {
    if (!args || typeof args.id !== 'string') throw new Error('id is required');
    store.deletePermanent(args.id);
    log.info('Canvas permanently deleted:', args.id);
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
    store.patchApply(args.canvasId, args.patch);
    log.debug('Canvas patched:', args.canvasId);
  });
}
