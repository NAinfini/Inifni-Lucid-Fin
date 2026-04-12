// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import type { ProjectManifest } from '@lucid-fin/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.js';
import {
  addNode,
  canvasReducer,
  removeNodes,
  setActiveCanvas,
  setCanvases,
} from '../slices/canvas.js';
import { loggerSlice } from '../slices/logger.js';
import { setProject, projectSlice } from '../slices/project.js';
import { setRenderPreset, settingsSlice, restore as restoreSettings } from '../slices/settings.js';
import { scriptSlice, updateContent } from '../slices/script.js';
import { toastSlice } from '../slices/toast.js';

function createCanvas() {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Canvas',
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
    status: 'idle' as const,
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

function createProjectPayload(): ProjectManifest & { path: string } {
  return {
    id: 'project-1',
    title: 'Project',
    description: '',
    genre: '',
    resolution: [1920, 1080] as [number, number],
    fps: 24,
    aspectRatio: '16:9',
    createdAt: 1,
    updatedAt: 1,
    aiProviders: [],
    snapshots: [],
    styleGuide: {
      global: {
        artStyle: '',
        colorPalette: { primary: '', secondary: '', forbidden: [] },
        lighting: 'natural',
        texture: '',
        referenceImages: [],
        freeformDescription: '',
      },
      sceneOverrides: {},
    },
    path: 'project-path',
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function loadPersistModule(
  _options: Record<string, never> = {},
) {
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

  it('debounces project autosaves and escalates repeated failures to warning toasts', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      project: {
        save: vi.fn(async () => {
          throw new Error('disk full');
        }),
      },
      canvas: {
        save: vi.fn(),
        patch: vi.fn(),
      },
      settings: {
        save: vi.fn(),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        project: projectSlice.reducer,
        script: scriptSlice.reducer,
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setProject(createProjectPayload()));
    store.dispatch(updateContent('v1'));
    store.dispatch(updateContent('v2'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(api.project.save).toHaveBeenCalledTimes(1);

    store.dispatch(updateContent('v3'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    store.dispatch(updateContent('v4'));
    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();

    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: t('toast.error.autosaveFailed'),
        message: 'disk full',
      }),
      expect.objectContaining({
        variant: 'error',
        title: t('toast.error.autosaveFailed'),
        message: 'disk full',
      }),
      expect.objectContaining({
        variant: 'warning',
        title: t('toast.error.autosaveRepeatedFailed'),
        message: 'disk full',
      }),
    ]);
  });

  it('persists settings independently of project state', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      project: {
        save: vi.fn(async () => undefined),
      },
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
        project: projectSlice.reducer,
        script: scriptSlice.reducer,
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
      project: {
        save: vi.fn(async () => undefined),
      },
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
        project: projectSlice.reducer,
        script: scriptSlice.reducer,
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setProject(createProjectPayload()));
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

  it('falls back to a full canvas save when patch persistence fails', async () => {
    const { persistMiddleware } = await loadPersistModule();
    const api = {
      project: {
        save: vi.fn(async () => undefined),
      },
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
        project: projectSlice.reducer,
        script: scriptSlice.reducer,
        canvas: canvasReducer,
        settings: settingsSlice.reducer,
        logger: loggerSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(persistMiddleware),
    });

    store.dispatch(setProject(createProjectPayload()));
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
