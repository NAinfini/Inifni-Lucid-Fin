import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import type { Canvas } from '@lucid-fin/contracts';
import { createCanvasStore, registerCanvasHandlers } from './canvas.handlers.js';

function canvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'node-1',
        type: 'text',
        title: 'Original',
        position: { x: 0, y: 0 },
        data: { content: 'hello' },
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('registerCanvasHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
    vi.clearAllMocks();
  });

  it('logs canvas saves at debug level', async () => {
    const store = {
      get: vi.fn(),
      save: vi.fn(),
      archive: vi.fn(),
      list: vi.fn(() => []),
    };

    registerCanvasHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      store as never,
    );

    const saveCanvas = handlers.get('canvas:save');
    expect(saveCanvas).toBeTypeOf('function');

    await saveCanvas?.(
      {},
      {
        id: 'canvas-1',
        name: 'Storyboard',
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        notes: [],
        createdAt: 1,
        updatedAt: 1,
      },
    );

    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'canvas-1',
      }),
    );
    expect(logger.debug).toHaveBeenCalledWith('Canvas saved:', 'canvas-1');
    expect(logger.info).not.toHaveBeenCalledWith('Canvas saved:', 'canvas-1');
  });

  it('delegates an atomic patch without preloading the canvas', async () => {
    const store = {
      get: vi.fn(),
      save: vi.fn(),
      archive: vi.fn(),
      list: vi.fn(() => []),
      patchApply: vi.fn(),
    };
    registerCanvasHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      store as never,
    );

    const patch = {
      canvasId: 'canvas-1',
      timestamp: 10,
      operations: ['updateNode'],
      updatedNodes: [{ id: 'node-1', changes: { title: 'Updated' } }],
    };
    await handlers.get('canvas:patch')?.({}, { canvasId: 'canvas-1', patch });

    expect(store.get).not.toHaveBeenCalled();
    expect(store.patchApply).toHaveBeenCalledTimes(1);
    expect(store.patchApply).toHaveBeenCalledWith('canvas-1', patch);
  });

  it('routes archive, restore, and permanent delete through distinct store operations', async () => {
    const store = {
      get: vi.fn(),
      save: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      deletePermanent: vi.fn(),
      list: vi.fn(() => []),
      listFull: vi.fn(() => []),
      patchApply: vi.fn(),
    };
    registerCanvasHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      store as never,
    );

    await handlers.get('canvas:delete')?.({}, { id: 'canvas-1' });
    await handlers.get('canvas:restore')?.({}, { id: 'canvas-1' });
    await handlers.get('canvas:deletePermanent')?.({}, { id: 'canvas-1' });

    expect(store.archive).toHaveBeenCalledWith('canvas-1');
    expect(store.restore).toHaveBeenCalledWith('canvas-1');
    expect(store.deletePermanent).toHaveBeenCalledWith('canvas-1');
  });

  it('never serves an archived Canvas from the active CanvasStore cache', () => {
    const archived = { ...canvas(), archivedAt: 10 };
    const canvases = {
      get: vi.fn(() => undefined),
      getIncludingArchived: vi.fn(() => archived),
      patchApply: vi.fn(),
      upsert: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      deletePermanent: vi.fn(),
      list: vi.fn(() => []),
      listFull: vi.fn(() => ({ rows: [archived], degradedCount: 0 })),
    };
    const store = createCanvasStore({ repos: { canvases } } as never);

    expect(store.listFull()).toEqual([archived]);
    expect(store.get('canvas-1')).toBeUndefined();
    expect(canvases.get).toHaveBeenCalledWith('canvas-1');
  });

  it('validates the full patch and leaves cache and DB untouched on failure', () => {
    const stored = canvas();
    const canvases = {
      get: vi.fn(() => stored),
      patchApply: vi.fn(),
      upsert: vi.fn(),
      archive: vi.fn(),
      list: vi.fn(() => []),
      listFull: vi.fn(() => ({ rows: [], degradedCount: 0 })),
    };
    const store = createCanvasStore({ repos: { canvases } } as never);
    expect(store.get('canvas-1')).toBe(stored);

    expect(() =>
      store.patchApply('canvas-1', {
        canvasId: 'canvas-1',
        timestamp: 2,
        operations: ['updateNode'],
        updatedNodes: [{ id: 'missing', changes: { title: 'Never written' } }],
      }),
    ).toThrow('Node not found: missing');

    expect(canvases.patchApply).not.toHaveBeenCalled();
    expect(store.get('canvas-1')?.nodes[0]?.title).toBe('Original');
  });

  it('does not update the cache when the repository transaction fails', () => {
    const stored = canvas();
    const canvases = {
      get: vi.fn(() => stored),
      patchApply: vi.fn(() => {
        throw new Error('transaction failed');
      }),
      upsert: vi.fn(),
      archive: vi.fn(),
      list: vi.fn(() => []),
      listFull: vi.fn(() => ({ rows: [], degradedCount: 0 })),
    };
    const store = createCanvasStore({ repos: { canvases } } as never);
    store.get('canvas-1');

    expect(() =>
      store.patchApply('canvas-1', {
        canvasId: 'canvas-1',
        timestamp: 2,
        operations: ['updateNode'],
        updatedNodes: [{ id: 'node-1', changes: { title: 'Updated' } }],
      }),
    ).toThrow('transaction failed');

    expect(canvases.patchApply).toHaveBeenCalledTimes(1);
    expect(store.get('canvas-1')?.nodes[0]?.title).toBe('Original');
  });
});
