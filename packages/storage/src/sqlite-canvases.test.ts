import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from './sqlite-index.js';
import type { Canvas, CanvasNode, CanvasEdge, CanvasViewport, CanvasNote } from '@lucid-fin/contracts';
import { parseCanvasId } from '@lucid-fin/contracts-parse';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvases-'));
}

function makeViewport(overrides?: Partial<CanvasViewport>): CanvasViewport {
  return { x: 0, y: 0, zoom: 1, ...overrides };
}

function makeImageNode(id: string): CanvasNode {
  return {
    id,
    type: 'image',
    position: { x: 100, y: 200 },
    data: {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
    },
    title: `Node ${id}`,
    status: 'idle',
    bypassed: false,
    locked: false,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeEdge(id: string, source: string, target: string): CanvasEdge {
  return {
    id,
    source,
    target,
    data: { status: 'idle' },
  };
}

function makeNote(id: string): CanvasNote {
  return {
    id,
    content: `Note ${id}`,
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeCanvas(overrides?: Partial<Canvas>): Canvas {
  return {
    id: 'canvas-1',
    name: 'My Canvas',
    nodes: [],
    edges: [],
    viewport: makeViewport(),
    notes: [],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe('sqlite-canvases', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // upsertCanvas / getCanvas
  // ---------------------------------------------------------------------------

  describe('upsertCanvas / getCanvas', () => {
    it('inserts a canvas and retrieves it by id', () => {
      const canvas = makeCanvas();
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('canvas-1');
      expect(retrieved!.name).toBe('My Canvas');
      expect(retrieved!.createdAt).toBe(1000);
      expect(retrieved!.updatedAt).toBe(2000);
      expect(retrieved).not.toHaveProperty('projectId');
    });

    it('returns undefined for a non-existent canvas id', () => {
      const result = db.repos.canvases.get(parseCanvasId('does-not-exist'));
      expect(result).toBeUndefined();
    });

    it('stores and restores nodes as JSON', () => {
      const node = makeImageNode('node-1');
      const canvas = makeCanvas({ nodes: [node] });
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.nodes).toHaveLength(1);
      expect(retrieved!.nodes[0].id).toBe('node-1');
      expect(retrieved!.nodes[0].type).toBe('image');
      expect(retrieved!.nodes[0].position).toEqual({ x: 100, y: 200 });
    });

    it('stores and restores edges as JSON', () => {
      const node1 = makeImageNode('n1');
      const node2 = makeImageNode('n2');
      const edge = makeEdge('edge-1', 'n1', 'n2');
      const canvas = makeCanvas({ nodes: [node1, node2], edges: [edge] });
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.edges).toHaveLength(1);
      expect(retrieved!.edges[0].id).toBe('edge-1');
      expect(retrieved!.edges[0].source).toBe('n1');
      expect(retrieved!.edges[0].target).toBe('n2');
    });

    it('stores and restores viewport', () => {
      const canvas = makeCanvas({ viewport: { x: 50, y: 75, zoom: 1.5 } });
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.viewport).toEqual({ x: 50, y: 75, zoom: 1.5 });
    });

    it('stores and restores notes as JSON', () => {
      const note = makeNote('note-1');
      const canvas = makeCanvas({ notes: [note] });
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.notes).toHaveLength(1);
      expect(retrieved!.notes[0].id).toBe('note-1');
      expect(retrieved!.notes[0].content).toBe('Note note-1');
    });

    it('defaults nodes/edges/notes to empty arrays when not provided', () => {
      const canvas = makeCanvas({ nodes: undefined, edges: undefined, notes: undefined });
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.nodes).toEqual([]);
      expect(retrieved!.edges).toEqual([]);
      expect(retrieved!.notes).toEqual([]);
    });

    it('defaults viewport to {x:0, y:0, zoom:1} when not provided', () => {
      const canvas = makeCanvas({ viewport: undefined });
      db.repos.canvases.upsert(canvas);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // upsert (conflict / update semantics)
  // ---------------------------------------------------------------------------

  describe('upsertCanvas -- update on conflict', () => {
    it('updates name and nodes when called again with the same id', () => {
      const original = makeCanvas({ name: 'Original', nodes: [] });
      db.repos.canvases.upsert(original);

      const updated = makeCanvas({
        name: 'Renamed',
        nodes: [makeImageNode('n1')],
        updatedAt: 9999,
      });
      db.repos.canvases.upsert(updated);

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.name).toBe('Renamed');
      expect(retrieved!.nodes).toHaveLength(1);
      expect(retrieved!.updatedAt).toBe(9999);
    });

    it('preserves createdAt from the original insert on conflict', () => {
      db.repos.canvases.upsert(makeCanvas({ createdAt: 100, updatedAt: 200 }));
      db.repos.canvases.upsert(makeCanvas({ createdAt: 999, updatedAt: 300 }));

      const retrieved = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(retrieved!.updatedAt).toBe(300);
    });

    it('does not duplicate canvases on repeated upserts', () => {
      db.repos.canvases.upsert(makeCanvas());
      db.repos.canvases.upsert(makeCanvas({ name: 'Second upsert' }));

      const all = db.repos.canvases.list();
      expect(all).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // listCanvases
  // ---------------------------------------------------------------------------

  describe('listCanvases', () => {
    it('returns empty array when no canvases exist', () => {
      const result = db.repos.canvases.list();
      expect(result).toEqual([]);
    });

    it('returns summary rows (id, name, updatedAt)', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1', name: 'Canvas A', updatedAt: 1000 }));

      const result = db.repos.canvases.list();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 'c1', name: 'Canvas A', updatedAt: 1000 });
    });

    it('returns all canvases', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1', name: 'P1 Canvas' }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c2', name: 'P2 Canvas' }));

      const result = db.repos.canvases.list();
      expect(result).toHaveLength(2);
    });

    it('returns canvases ordered by updatedAt descending', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1', name: 'Old', updatedAt: 100 }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c2', name: 'Newer', updatedAt: 300 }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c3', name: 'Middle', updatedAt: 200 }));

      const result = db.repos.canvases.list();
      expect(result.map((r) => r.id)).toEqual(['c2', 'c3', 'c1']);
    });

    it('summary rows do not include nodes, edges, or notes fields', () => {
      db.repos.canvases.upsert(makeCanvas({ nodes: [makeImageNode('n1')] }));
      const result = db.repos.canvases.list();
      const row = result[0] as Record<string, unknown>;
      expect(row.nodes).toBeUndefined();
      expect(row.edges).toBeUndefined();
      expect(row.notes).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // listCanvasesFull
  // ---------------------------------------------------------------------------

  describe('listCanvasesFull', () => {
    it('returns empty array when no canvases exist', () => {
      expect(db.repos.canvases.listFull().rows).toEqual([]);
    });

    it('returns full Canvas objects', () => {
      const node = makeImageNode('n1');
      db.repos.canvases.upsert(makeCanvas({ nodes: [node], notes: [makeNote('note-1')] }));

      const result = db.repos.canvases.listFull().rows;
      expect(result).toHaveLength(1);
      expect(result[0].nodes).toHaveLength(1);
      expect(result[0].nodes[0].id).toBe('n1');
      expect(result[0].notes).toHaveLength(1);
    });

    it('returns canvases ordered by updatedAt descending', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1', updatedAt: 100 }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c2', updatedAt: 500 }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c3', updatedAt: 300 }));

      const result = db.repos.canvases.listFull().rows;
      expect(result.map((r) => r.id)).toEqual(['c2', 'c3', 'c1']);
    });

    it('returns multiple full canvases with correct data', () => {
      const nodeA = makeImageNode('nA');
      const nodeB = makeImageNode('nB');
      db.repos.canvases.upsert(makeCanvas({ id: 'c1', name: 'Alpha', updatedAt: 200, nodes: [nodeA] }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c2', name: 'Beta', updatedAt: 100, nodes: [nodeB] }));

      const result = db.repos.canvases.listFull().rows;
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alpha');
      expect(result[0].nodes[0].id).toBe('nA');
      expect(result[1].name).toBe('Beta');
      expect(result[1].nodes[0].id).toBe('nB');
    });
  });

  // ---------------------------------------------------------------------------
  // deleteCanvas
  // ---------------------------------------------------------------------------

  describe('deleteCanvas', () => {
    it('removes a canvas so getCanvas returns undefined', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1' }));
      db.repos.canvases.delete(parseCanvasId('c1'));
      expect(db.repos.canvases.get(parseCanvasId('c1'))).toBeUndefined();
    });

    it('removes a canvas from list results', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1' }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c2' }));
      db.repos.canvases.delete(parseCanvasId('c1'));

      const list = db.repos.canvases.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('c2');
    });

    it('removes a canvas from listCanvasesFull results', () => {
      db.repos.canvases.upsert(makeCanvas({ id: 'c1' }));
      db.repos.canvases.upsert(makeCanvas({ id: 'c2' }));
      db.repos.canvases.delete(parseCanvasId('c1'));

      const full = db.repos.canvases.listFull().rows;
      expect(full).toHaveLength(1);
      expect(full[0].id).toBe('c2');
    });

    it('does not throw when deleting a non-existent canvas id', () => {
      expect(() => db.repos.canvases.delete(parseCanvasId('does-not-exist'))).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Round-trip fidelity -- complex node data
  // ---------------------------------------------------------------------------

  describe('round-trip fidelity', () => {
    it('preserves edge sourceHandle and targetHandle', () => {
      const edge: CanvasEdge = {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourceHandle: 'bottom',
        targetHandle: 'top',
        data: { label: 'flow', status: 'done', autoLabel: true },
      };
      db.repos.canvases.upsert(makeCanvas({ edges: [edge] }));

      const result = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(result!.edges[0].sourceHandle).toBe('bottom');
      expect(result!.edges[0].targetHandle).toBe('top');
      expect(result!.edges[0].data.label).toBe('flow');
      expect(result!.edges[0].data.autoLabel).toBe(true);
    });

    it('preserves multiple nodes with different types', () => {
      const imgNode = makeImageNode('img-1');
      const textNode: CanvasNode = {
        id: 'text-1',
        type: 'text',
        position: { x: 0, y: 0 },
        data: { content: 'hello world' },
        title: 'Text node',
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 500,
        updatedAt: 500,
      };
      db.repos.canvases.upsert(makeCanvas({ nodes: [imgNode, textNode] }));

      const result = db.repos.canvases.get(parseCanvasId('canvas-1'));
      expect(result!.nodes).toHaveLength(2);
      const types = result!.nodes.map((n) => n.type).sort();
      expect(types).toEqual(['image', 'text']);
    });

    it('preserves all canvas scalar fields through a round-trip', () => {
      const canvas = makeCanvas({
        id: 'c-rt',
        name: 'Round-trip Canvas',
        createdAt: 11111,
        updatedAt: 22222,
        viewport: { x: -50, y: 100, zoom: 0.75 },
      });
      db.repos.canvases.upsert(canvas);

      const result = db.repos.canvases.get(parseCanvasId('c-rt'));
      expect(result).toMatchObject({
        id: 'c-rt',
        name: 'Round-trip Canvas',
        createdAt: 11111,
        updatedAt: 22222,
        viewport: { x: -50, y: 100, zoom: 0.75 },
      });
    });
  });
});
