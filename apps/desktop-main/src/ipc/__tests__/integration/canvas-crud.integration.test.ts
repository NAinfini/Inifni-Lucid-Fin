/**
 * Canvas CRUD integration tests.
 *
 * Exercises the full handler -> CanvasService -> CanvasStore -> CanvasRepository
 * -> SQLite chain using a real in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  createFakeIpcMain,
  createTestDb,
  cleanupTestDb,
  invoke,
  type FakeIpcMain,
  type TestDb,
} from './ipc-test-harness.js';

// Mock the logger to avoid console noise during tests.
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

describe('Canvas CRUD integration', () => {
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

  it('create -> load -> list -> save -> delete full lifecycle', async () => {
    // 1. Create a canvas
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'Test Storyboard' });
    expect(created.id).toBeTypeOf('string');
    expect(created.name).toBe('Test Storyboard');
    expect(created.nodes).toEqual([]);
    expect(created.edges).toEqual([]);
    expect(created.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(created.createdAt).toBeTypeOf('number');
    expect(created.updatedAt).toBeTypeOf('number');

    // 2. Load the canvas
    const loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.id).toBe(created.id);
    expect(loaded.name).toBe('Test Storyboard');

    // 3. List canvases
    const list = await invoke<Array<{ id: string; name: string; updatedAt: number }>>(
      ipcMain,
      'canvas:list',
    );
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].name).toBe('Test Storyboard');

    // 4. Save (update) the canvas
    const updated = { ...loaded, name: 'Updated Name' };
    await invoke(ipcMain, 'canvas:save', updated);
    const reloaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(reloaded.name).toBe('Updated Name');
    expect(reloaded.updatedAt).toBeGreaterThanOrEqual(loaded.updatedAt);

    // 5. Delete the canvas
    await invoke(ipcMain, 'canvas:delete', { id: created.id });
    const listAfterDelete = await invoke<Array<{ id: string }>>(ipcMain, 'canvas:list');
    expect(listAfterDelete).toHaveLength(0);
  });

  it('load throws for non-existent canvas', async () => {
    await expect(invoke(ipcMain, 'canvas:load', { id: 'nonexistent-id' })).rejects.toThrow(
      /not found/i,
    );
  });

  it('create rejects empty name', async () => {
    await expect(invoke(ipcMain, 'canvas:create', { name: '' })).rejects.toThrow();
    await expect(invoke(ipcMain, 'canvas:create', { name: '   ' })).rejects.toThrow();
  });

  it('rename updates the canvas name in the DB', async () => {
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'Original' });
    await invoke(ipcMain, 'canvas:rename', { id: created.id, name: 'Renamed' });

    const loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.name).toBe('Renamed');
  });

  it('patch adds nodes and edges, then removes them', async () => {
    const created = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'PatchTest' });
    const now = Date.now();

    // Add a node
    await invoke(ipcMain, 'canvas:patch', {
      canvasId: created.id,
      patch: {
        canvasId: created.id,
        timestamp: now,
        addedNodes: [
          {
            id: 'node-1',
            type: 'scene',
            position: { x: 100, y: 200 },
            data: {},
            title: '',
            bypassed: false,
            locked: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        addedEdges: [
          {
            id: 'edge-1',
            source: 'node-1',
            target: 'node-1',
            data: { status: 'idle' },
          },
        ],
      },
    });

    let loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].id).toBe('node-1');
    expect(loaded.edges).toHaveLength(1);

    // Remove the node and edge
    await invoke(ipcMain, 'canvas:patch', {
      canvasId: created.id,
      patch: {
        canvasId: created.id,
        timestamp: now + 1,
        removedNodeIds: ['node-1'],
        removedEdgeIds: ['edge-1'],
      },
    });

    loaded = await invoke<Canvas>(ipcMain, 'canvas:load', { id: created.id });
    expect(loaded.nodes).toHaveLength(0);
    expect(loaded.edges).toHaveLength(0);
  });

  it('multiple canvases list in updatedAt descending order', async () => {
    const c1 = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'First' });
    const c2 = await invoke<Canvas>(ipcMain, 'canvas:create', { name: 'Second' });
    // Update c1 so its updatedAt is newer
    await invoke(ipcMain, 'canvas:save', { ...c1, updatedAt: Date.now() + 5000 });

    const list = await invoke<Array<{ id: string; name: string }>>(ipcMain, 'canvas:list');
    expect(list).toHaveLength(2);
    // c1 was updated last, so it should be first
    expect(list[0].id).toBe(c1.id);
    expect(list[1].id).toBe(c2.id);
  });
});
