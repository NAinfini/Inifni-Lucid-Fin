// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { Canvas, CanvasNode } from '@lucid-fin/contracts';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasSlice, setActiveCanvas } from '../store/slices/canvas.js';
import { loggerSlice } from '../store/slices/logger.js';
import { settingsSlice, setProviderBaseUrl, setProviderModel } from '../store/slices/settings.js';
import { getAPI } from '../utils/api.js';
import { useCanvasGeneration } from './useCanvasGeneration.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

function createCanvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'image',
    title: 'Opening Frame',
    position: { x: 0, y: 0 },
    status: 'idle',
    bypassed: false,
    locked: false,
    width: 320,
    height: 180,
    createdAt: 1,
    updatedAt: 1,
    data: {
      status: 'empty',
      progress: 0,
      variants: [],
      selectedVariantIndex: 0,
    },
    ...overrides,
  };
}

function createCanvas(nodes: CanvasNode[] = []): Canvas {
  return {
    id: 'canvas-1',
    name: 'Opening Shot',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function renderHookHarness({
  canvases = [createCanvas([createCanvasNode()])],
  activeCanvasId = 'canvas-1',
}: {
  canvases?: Canvas[];
  activeCanvasId?: string | null;
} = {}) {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      logger: loggerSlice.reducer,
      settings: settingsSlice.reducer,
    },
  });

  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas(activeCanvasId));

  let apiRef: ReturnType<typeof useCanvasGeneration> | undefined;

  function HookHarness() {
    apiRef = useCanvasGeneration();
    return null;
  }

  const view = render(
    <Provider store={store}>
      <HookHarness />
    </Provider>,
  );

  return {
    store,
    getHook: () => {
      if (!apiRef) {
        throw new Error('Hook API unavailable');
      }
      return apiRef;
    },
    ...view,
  };
}

describe('useCanvasGeneration', () => {
  beforeEach(() => {
    vi.mocked(getAPI).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('stores currentStep from active-canvas progress events', async () => {
    let progressCallback:
      | ((data: { canvasId: string; nodeId: string; progress: number; currentStep?: string }) => void)
      | undefined;

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn((cb) => {
          progressCallback = cb;
          return () => {};
        }),
        onComplete: vi.fn(() => () => {}),
        onFailed: vi.fn(() => () => {}),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store } = renderHookHarness({
      canvases: [
        createCanvas([
          createCanvasNode({
            data: {
              status: 'generating',
              progress: 10,
              variants: [],
              selectedVariantIndex: 0,
            },
          }),
        ]),
      ],
    });

    act(() => {
      progressCallback?.({
        canvasId: 'other-canvas',
        nodeId: 'node-1',
        progress: 22,
        currentStep: 'Ignored',
      });
      progressCallback?.({
        canvasId: 'canvas-1',
        nodeId: 'node-1',
        progress: 64,
        currentStep: 'Uploading source',
      });
    });

    await waitFor(() => {
      const node = store.getState().canvas.canvases.entities['canvas-1']?.nodes[0];
      expect(node?.data).toEqual(
        expect.objectContaining({
          progress: 64,
          currentStep: 'Uploading source',
        }),
      );
    });
  });

  it('logs and marks the node failed when generation request rejects', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('provider down'));

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn(() => () => {}),
        onComplete: vi.fn(() => () => {}),
        onFailed: vi.fn(() => () => {}),
        generate,
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, getHook } = renderHookHarness();

    await expect(getHook().generate('node-1', 'openai-image', 2, 42)).rejects.toThrow('provider down');

    const node = store.getState().canvas.canvases.entities['canvas-1']?.nodes[0];
    expect(node?.data).toEqual(
      expect.objectContaining({
        status: 'failed',
        error: 'provider down',
      }),
    );
    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          category: 'generation',
          message: 'Canvas generation failed',
        }),
      ]),
    );
  });

  it('logs accepted jobs and stores the returned job id', async () => {
    const generate = vi.fn().mockResolvedValue({ jobId: 'job-789' });

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn(() => () => {}),
        onComplete: vi.fn(() => () => {}),
        onFailed: vi.fn(() => () => {}),
        generate,
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, getHook } = renderHookHarness();

    await act(async () => {
      await getHook().generate('node-1', 'openai-image', 3, 7);
    });

    const node = store.getState().canvas.canvases.entities['canvas-1']?.nodes[0];
    expect(node?.data).toEqual(
      expect.objectContaining({
        status: 'generating',
        jobId: 'job-789',
      }),
    );
    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'info',
          category: 'generation',
          message: 'Canvas generation requested',
        }),
        expect.objectContaining({
          level: 'info',
          category: 'generation',
          message: 'Canvas generation queued',
        }),
      ]),
    );
  });

  it('passes the configured provider override through generate and estimate requests', async () => {
    const generate = vi.fn().mockResolvedValue({ jobId: 'job-321' });
    const estimateCost = vi.fn().mockResolvedValue({ estimatedCost: 0.25, currency: 'USD' });

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn(() => () => {}),
        onComplete: vi.fn(() => () => {}),
        onFailed: vi.fn(() => () => {}),
        generate,
        estimateCost,
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { getHook } = renderHookHarness({
      canvases: [
        createCanvas([
          createCanvasNode({
            data: {
              status: 'empty',
              progress: 0,
              variants: [],
              selectedVariantIndex: 0,
              providerId: 'replicate',
            },
          }),
        ]),
      ],
    });

    await act(async () => {
      await getHook().generate('node-1');
    });
    await act(async () => {
      await getHook().estimateCost('node-1', 'replicate');
    });

    expect(generate).toHaveBeenCalledWith(
      'canvas-1',
      'node-1',
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        baseUrl: expect.any(String),
        model: expect.any(String),
      }),
    );
    expect(estimateCost).toHaveBeenCalledWith(
      'canvas-1',
      'node-1',
      'replicate',
      expect.objectContaining({
        baseUrl: expect.any(String),
        model: expect.any(String),
      }),
    );
  });

  it('resolves provider overrides from the node media group when provider ids overlap', async () => {
    const generate = vi.fn().mockResolvedValue({ jobId: 'job-video-1' });
    const estimateCost = vi.fn().mockResolvedValue({ estimatedCost: 0.5, currency: 'USD' });

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn(() => () => {}),
        onComplete: vi.fn(() => () => {}),
        onFailed: vi.fn(() => () => {}),
        generate,
        estimateCost,
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, getHook } = renderHookHarness({
      canvases: [
        createCanvas([
          createCanvasNode({
            type: 'video',
            data: {
              status: 'empty',
              progress: 0,
              duration: 5,
              variants: [],
              selectedVariantIndex: 0,
              providerId: 'replicate',
            },
          }),
        ]),
      ],
    });

    store.dispatch(setProviderBaseUrl({ group: 'image', provider: 'replicate', url: 'https://image.example/api' }));
    store.dispatch(setProviderModel({ group: 'image', provider: 'replicate', model: 'flux-image' }));
    store.dispatch(setProviderBaseUrl({ group: 'video', provider: 'replicate', url: 'https://video.example/api' }));
    store.dispatch(setProviderModel({ group: 'video', provider: 'replicate', model: 'minimax-video' }));

    await act(async () => {
      await getHook().generate('node-1');
    });
    await act(async () => {
      await getHook().estimateCost('node-1', 'replicate');
    });

    expect(generate).toHaveBeenCalledWith(
      'canvas-1',
      'node-1',
      undefined,
      undefined,
      undefined,
      expect.objectContaining({
        baseUrl: 'https://video.example/api',
        model: 'minimax-video',
      }),
    );
    expect(estimateCost).toHaveBeenCalledWith(
      'canvas-1',
      'node-1',
      'replicate',
      expect.objectContaining({
        baseUrl: 'https://video.example/api',
        model: 'minimax-video',
      }),
    );
  });
});
