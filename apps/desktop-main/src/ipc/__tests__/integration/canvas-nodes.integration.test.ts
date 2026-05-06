/**
 * Canvas nodes integration tests.
 *
 * Verifies that canvas nodes are stored as individual DB rows (via
 * CanvasNodeRepository) rather than as a JSON blob in the canvases table,
 * and that they round-trip correctly through the full handler chain.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Canvas, CanvasEdge, CanvasNode } from '@lucid-fin/contracts';
import {
  createFakeIpcMain,
  createTestDb,
  cleanupTestDb,
  invoke,
  type FakeIpcMain,
  type TestDb,
} from './ipc-test-harness.js';

// Mock the logger.
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { createCanvasStore, registerCanvasHandlers } from '../../handlers/canvas.handlers.js';

function makeNode(id: string, type: string = 'scene', x = 0, y = 0): CanvasNode {
  const now = Date.now();
  return {
    id,
    type: type as CanvasNode['type'],
    position: { x, y },
    data: {} as CanvasNode['data'],
    title: `Node ${id}`,
    bypassed: false,
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makeEdge(id: string, source: string, target: string): CanvasEdge {
  return {
    id,
    source,
    target,
    data: {
      label: `Edge ${id}`,
      status: 'idle',
      autoLabel: false,
    },
  };
}

describe('Canvas nodes integration', () => {
  let testDb: TestDb;
  let ipcMain: FakeIpcMain;

  beforeEach(() => {
    testDb = createTestDb();
    ipcMain = createFakeIpcMain();

    const canvasStore = createCanvasStore(testDb.db);
    registerCanvasHandlers(ipcMain, canvasStore);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
    vi.clearAllMocks();
  });

  it('nodes round-trip through save/load with DB row storage', async () => {
    // Create a canvas
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'NodeTest' });
    expect(created.nodes).toHaveLength(0);

    // Save the canvas with nodes
    const nodes = [
      makeNode('n1', 'scene', 100, 200),
      makeNode('n2', 'image', 300, 400),
      makeNode('n3', 'text', 500, 600),
    ];
    const edges = [makeEdge('e1', 'n1', 'n2'), makeEdge('e2', 'n2', 'n3')];
    const withNodes: Canvas = {
      ...created,
      nodes,
      edges,
    };
    await invoke(ipcMain, 'canvas:save', withNodes);

    // Load and verify nodes came back
    const loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.nodes).toHaveLength(3);
    expect(loaded.edges).toHaveLength(2);

    // Verify each node's identity and position
    const nodeMap = new Map(loaded.nodes.map((n) => [n.id, n]));
    expect(nodeMap.has('n1')).toBe(true);
    expect(nodeMap.has('n2')).toBe(true);
    expect(nodeMap.has('n3')).toBe(true);

    const n1 = nodeMap.get('n1')!;
    expect(n1.type).toBe('scene');
    expect(n1.position).toEqual({ x: 100, y: 200 });

    const n2 = nodeMap.get('n2')!;
    expect(n2.type).toBe('image');
    expect(n2.position).toEqual({ x: 300, y: 400 });

    const n3 = nodeMap.get('n3')!;
    expect(n3.type).toBe('text');
    expect(n3.position).toEqual({ x: 500, y: 600 });

    // Verify nodes are stored in the canvas_nodes table (DB rows, not JSON blob)
    const canvasCols = testDb.db.rawDb.pragma('table_info(canvases)') as Array<{ name: string }>;
    expect(canvasCols.map((col) => col.name)).not.toContain('nodes');
    expect(canvasCols.map((col) => col.name)).not.toContain('edges');

    // Verify nodes exist in the canvas_nodes table
    const nodeRows = testDb.db.rawDb
      .prepare('SELECT id, type, position_x, position_y FROM canvas_nodes WHERE canvas_id = ?')
      .all(created.id) as Array<{
      id: string;
      type: string;
      position_x: number;
      position_y: number;
    }>;
    expect(nodeRows).toHaveLength(3);
    const nodeRowMap = new Map(nodeRows.map((r) => [r.id, r]));
    expect(nodeRowMap.get('n1')?.type).toBe('scene');
    expect(nodeRowMap.get('n1')?.position_x).toBe(100);
    expect(nodeRowMap.get('n2')?.type).toBe('image');
    expect(nodeRowMap.get('n3')?.type).toBe('text');

    const edgeRows = testDb.db.rawDb
      .prepare('SELECT id, source, target, label FROM canvas_edges WHERE canvas_id = ? ORDER BY z_index ASC')
      .all(created.id) as Array<{
      id: string;
      source: string;
      target: string;
      label: string;
    }>;
    expect(edgeRows).toEqual([
      { id: 'e1', source: 'n1', target: 'n2', label: 'Edge e1' },
      { id: 'e2', source: 'n2', target: 'n3', label: 'Edge e2' },
    ]);
  });

  it('deleting a canvas cascades to canvas_nodes', async () => {
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'CascadeTest' });
    const withNodes: Canvas = {
      ...created,
      nodes: [makeNode('cn1'), makeNode('cn2')],
    };
    await invoke(ipcMain, 'canvas:save', withNodes);

    // Verify nodes exist
    const nodeCount = testDb.db.rawDb
      .prepare('SELECT COUNT(*) as cnt FROM canvas_nodes WHERE canvas_id = ?')
      .get(created.id) as { cnt: number };
    expect(nodeCount.cnt).toBe(2);

    // Delete the canvas
    await invoke(ipcMain, 'canvas:delete', { id: created.id });

    // Nodes should be cascade-deleted
    const nodeCountAfter = testDb.db.rawDb
      .prepare('SELECT COUNT(*) as cnt FROM canvas_nodes WHERE canvas_id = ?')
      .get(created.id) as { cnt: number };
    expect(nodeCountAfter.cnt).toBe(0);
  });

  it('updating canvas replaces stale nodes', async () => {
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'ReplaceTest' });

    // Save with 2 nodes
    await invoke(ipcMain, 'canvas:save', {
      ...created,
      nodes: [makeNode('old1'), makeNode('old2')],
    });

    let loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.nodes).toHaveLength(2);

    // Save with different nodes (replace old ones)
    await invoke(ipcMain, 'canvas:save', {
      ...loaded,
      nodes: [makeNode('new1', 'image', 10, 20)],
    });

    loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].id).toBe('new1');
    expect(loaded.nodes[0].type).toBe('image');
  });

  it('canvas with no nodes loads correctly', async () => {
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'EmptyNodes' });
    const loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.nodes).toEqual([]);
  });
});
