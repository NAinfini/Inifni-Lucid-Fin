import { randomUUID } from 'node:crypto';
import type { Canvas, CanvasNode, CanvasEdge } from '@lucid-fin/contracts';
import log from '../logger.js';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
import { NotFoundError, ValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// CanvasPatch — moved from canvas.handlers.ts
// ---------------------------------------------------------------------------

export interface CanvasPatch {
  canvasId: string;
  timestamp: number;
  nameChange?: string;
  addedNodes?: CanvasNode[];
  removedNodeIds?: string[];
  updatedNodes?: Array<{ id: string; changes: Record<string, unknown> }>;
  addedEdges?: CanvasEdge[];
  removedEdgeIds?: string[];
  updatedEdges?: Array<{ id: string; edge: CanvasEdge }>;
}

function applyPatch(canvas: Canvas, patch: CanvasPatch): void {
  if (patch.nameChange !== undefined) {
    canvas.name = patch.nameChange;
  }

  if (patch.removedNodeIds && patch.removedNodeIds.length > 0) {
    const removedSet = new Set(patch.removedNodeIds);
    canvas.nodes = canvas.nodes.filter((n) => !removedSet.has(n.id));
  }

  if (patch.updatedNodes && patch.updatedNodes.length > 0) {
    const nodeMap = new Map(canvas.nodes.map((n) => [n.id, n]));
    for (const { id, changes } of patch.updatedNodes) {
      const node = nodeMap.get(id);
      if (node) {
        const {
          __proto__: _p,
          constructor: _c,
          prototype: _pr,
          ...safeChanges
        } = changes as Record<string, unknown>;
        Object.assign(node, safeChanges);
      }
    }
  }

  if (patch.addedNodes && patch.addedNodes.length > 0) {
    canvas.nodes.push(...patch.addedNodes);
  }

  if (patch.removedEdgeIds && patch.removedEdgeIds.length > 0) {
    const removedSet = new Set(patch.removedEdgeIds);
    canvas.edges = canvas.edges.filter((e) => !removedSet.has(e.id));
  }

  if (patch.updatedEdges && patch.updatedEdges.length > 0) {
    const updateMap = new Map(patch.updatedEdges.map((u) => [u.id, u.edge]));
    canvas.edges = canvas.edges.map((e) => updateMap.get(e.id) ?? e);
  }

  if (patch.addedEdges && patch.addedEdges.length > 0) {
    canvas.edges.push(...patch.addedEdges);
  }
}

// ---------------------------------------------------------------------------
// CanvasService — transport-agnostic business logic
// ---------------------------------------------------------------------------

/**
 * Domain service for canvas operations.
 *
 * Contains all business logic that was previously mixed into IPC handlers.
 * This class is transport-agnostic: it knows nothing about IPC or Electron.
 */
export class CanvasService {
  constructor(private readonly store: CanvasStore) {}

  listCanvases(): Array<{ id: string; name: string; updatedAt: number }> {
    return this.store.list();
  }

  loadCanvas(id: string): Canvas {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('id is required');
    }
    const canvas = this.store.get(id);
    if (!canvas) throw new NotFoundError(`Canvas not found: ${id}`);
    return canvas;
  }

  saveCanvas(data: Canvas): void {
    if (!data || typeof data.id !== 'string') {
      throw new ValidationError('canvas data with id is required');
    }
    data.updatedAt = Date.now();
    this.store.save(data);
    log.debug('Canvas saved:', data.id);
  }

  createCanvas(name: string): Canvas {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name is required');
    }
    const now = Date.now();
    const canvas: Canvas = {
      id: randomUUID(),
      name: name.trim(),
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: now,
      updatedAt: now,
    };
    this.store.save(canvas);
    log.info('Canvas created:', canvas.id, canvas.name);
    return canvas;
  }

  deleteCanvas(id: string): void {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('id is required');
    }
    this.store.delete(id);
    log.info('Canvas deleted:', id);
  }

  renameCanvas(id: string, name: string): void {
    if (!id || typeof id !== 'string' || typeof name !== 'string') {
      throw new ValidationError('id and name are required');
    }
    const canvas = this.store.get(id);
    if (!canvas) throw new NotFoundError(`Canvas not found: ${id}`);
    canvas.name = name.trim();
    canvas.updatedAt = Date.now();
    this.store.save(canvas);
    log.info('Canvas renamed:', id, canvas.name);
  }

  patchCanvas(canvasId: string, patch: CanvasPatch): void {
    if (!canvasId || typeof canvasId !== 'string') {
      throw new ValidationError('canvasId is required');
    }
    const canvas = this.store.get(canvasId);
    if (!canvas) throw new NotFoundError(`Canvas not found: ${canvasId}`);
    applyPatch(canvas, patch);
    canvas.updatedAt = Date.now();
    this.store.save(canvas);
    log.debug('Canvas patched:', canvasId);
  }
}
