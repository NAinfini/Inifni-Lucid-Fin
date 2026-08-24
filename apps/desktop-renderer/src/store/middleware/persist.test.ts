// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNode,
  archiveCanvas,
  canvasReducer,
  removeNodes,
  restoreCanvas,
  setActiveCanvas,
  setCanvases,
} from '../slices/canvas/canvas.js';
import { loggerSlice } from '../slices/logger.js';
import {
  settingsSlice,
  setRenderPreset,
  restore as restoreSettings,
  setBootstrapped,
} from '../slices/settings.js';
import { toastSlice } from '../slices/toast.js';

function createCanvas(id = 'canvas-1') {
  return {
    id,
    name: id,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createImageNode(id: string) {
  return {
    id,
    type: 'image' as const,
    title: `Node ${id}`,
    position: { x: 0, y: 0 },
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      assetHash: `${id}-hash`,
      status: 'done',
      variants: [`${id}-hash`],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: {
        camera: [],
        lens: [],
        composition: [],
        lighting: [],
        motion: [],
        pacing: [],
        transition: [],
        emotion: [],
        style: [],
        color: [],
        texture: [],
        environment: [],
        'aspect-ratio': [],
        quality: [],
      },
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function loadPersistModule(_options: Record<string, never> = {}) {
  vi.resetModules();
  return import('./persist.js');
}

describe('persistMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('persists settings independently of project state', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      canvas: {
        save: vi.fn(),
        patch: vi.fn(),
      },
      settings: {
        save: vi.fn(async () => undefined),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    // Signal that settings have been loaded from disk (required before persist kicks in)
    store.dispatch(restoreSettings({} as never));

    store.dispatch(setRenderPreset('film'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({
        renderPreset: 'film',
      }),
    );
  });

  it('uses canvas patch saves when the patch is preferred', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      canvas: {
        save: vi.fn(async () => undefined),
        patch: vi.fn(async () => undefined),
      },
      settings: {
        save: vi.fn(),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setBootstrapped());
    store.dispatch(setCanvases([createCanvas() as never]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(addNode(createImageNode('node-1') as never));

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.canvas.save).toHaveBeenCalledTimes(1);

    store.dispatch(removeNodes(['node-1']));

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.canvas.patch).toHaveBeenCalledTimes(1);
    expect(api.canvas.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: 'canvas-1',
        patch: expect.objectContaining({
          canvasId: 'canvas-1',
          removedNodeIds: ['node-1'],
        }),
      }),
    );
  });

  it('keeps a delayed save bound to the canvas edited before a canvas switch', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      canvas: {
        save: vi.fn(async () => undefined),
        patch: vi.fn(async () => undefined),
      },
      settings: { save: vi.fn() },
    };
    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setBootstrapped());
    store.dispatch(
      setCanvases([createCanvas('canvas-a') as never, createCanvas('canvas-b') as never]),
    );
    store.dispatch(setActiveCanvas('canvas-a'));
    store.dispatch(addNode(createImageNode('node-a') as never));
    store.dispatch(setActiveCanvas('canvas-b'));

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.canvas.save).toHaveBeenCalledOnce();
    expect(api.canvas.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'canvas-a',
        nodes: [expect.objectContaining({ id: 'node-a' })],
      }),
    );
  });

  it('does not route Canvas archive or restore through generic content persistence', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      canvas: {
        save: vi.fn(async () => undefined),
        patch: vi.fn(async () => undefined),
      },
      settings: { save: vi.fn() },
    };
    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setBootstrapped());
    store.dispatch(setCanvases([createCanvas('canvas-a') as never]));
    store.dispatch(setActiveCanvas('canvas-a'));
    store.dispatch(archiveCanvas({ id: 'canvas-a', archivedAt: 10 }));
    store.dispatch(restoreCanvas('canvas-a'));

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.canvas.save).not.toHaveBeenCalled();
    expect(api.canvas.patch).not.toHaveBeenCalled();
  });

  it('flushes and awaits debounced, in-flight, and newly queued canvas and settings saves', async () => {
    const { flushPendingPersistence, persistMiddleware } = await loadPersistModule();
    const firstCanvas = deferred();
    const secondCanvas = deferred();
    const firstSettings = deferred();
    const secondSettings = deferred();
    const api = {
      canvas: {
        save: vi.fn(() => firstCanvas.promise),
        patch: vi.fn(() => secondCanvas.promise),
      },
      settings: {
        save: vi
          .fn()
          .mockImplementationOnce(() => firstSettings.promise)
          .mockImplementationOnce(() => secondSettings.promise),
      },
    };
    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(restoreSettings({} as never));
    store.dispatch(setBootstrapped());
    store.dispatch(setCanvases([createCanvas() as never]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(addNode(createImageNode('node-1') as never));
    store.dispatch(setRenderPreset('film'));

    let finished = false;
    const flush = flushPendingPersistence().then(() => {
      finished = true;
    });
    await flushPromises();

    expect(api.canvas.save).toHaveBeenCalledOnce();
    expect(api.settings.save).toHaveBeenCalledOnce();
    expect(finished).toBe(false);

    store.dispatch(addNode(createImageNode('node-2') as never));
    store.dispatch(setRenderPreset('draft'));
    firstCanvas.resolve();
    firstSettings.resolve();
    await vi.waitFor(() => {
      expect(api.canvas.patch).toHaveBeenCalledOnce();
      expect(api.settings.save).toHaveBeenCalledTimes(2);
    });
    expect(finished).toBe(false);

    secondCanvas.resolve();
    secondSettings.resolve();
    await flush;
    expect(finished).toBe(true);
  });

  it('falls back to a full canvas save when patch persistence fails', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      canvas: {
        patch: vi.fn(async () => {
          throw new Error('patch failed');
        }),
        save: vi.fn(async () => undefined),
      },
      settings: {
        save: vi.fn(),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setBootstrapped());
    store.dispatch(setCanvases([createCanvas() as never]));
    store.dispatch(setActiveCanvas('canvas-1'));
    store.dispatch(addNode(createImageNode('node-1') as never));

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.canvas.save).toHaveBeenCalledTimes(1);

    store.dispatch(removeNodes(['node-1']));

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    await flushPromises();

    expect(api.canvas.patch).toHaveBeenCalledTimes(1);
    expect(api.canvas.save).toHaveBeenCalledTimes(2);
    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          category: 'persistence',
          message: 'Canvas patch failed, falling back to full save',
        }),
      ]),
    );
  });
});
