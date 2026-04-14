// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Canvas, CanvasNode } from '@lucid-fin/contracts';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '../../i18n.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas.js';
import { uiSlice } from '../../store/slices/ui.js';
import { addCustomProvider, settingsSlice } from '../../store/slices/settings.js';
import { getAPI } from '../../utils/api.js';
import { GenerationQueuePanel } from './GenerationQueuePanel.js';

vi.mock('../../utils/api.js', () => ({
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

function renderPanel({
  canvases = [createCanvas()],
  activeCanvasId = 'canvas-1',
}: {
  canvases?: Canvas[];
  activeCanvasId?: string | null;
} = {}) {
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      ui: uiSlice.reducer,
      settings: settingsSlice.reducer,
    },
  });

  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas(activeCanvasId));

  const view = render(
    <Provider store={store}>
      <GenerationQueuePanel />
    </Provider>,
  );

  return { store, ...view };
}

describe('GenerationQueuePanel', () => {
  beforeEach(() => {
    vi.mocked(getAPI).mockReset();
    setLocale('en-US');
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the empty state when the preload API is unavailable', () => {
    vi.mocked(getAPI).mockReturnValue(undefined);

    renderPanel();

    expect(screen.getByText(t('generation.noJobs'))).toBeTruthy();
  });

  it('does not subscribe to progress when no active canvas is selected', () => {
    const onProgress = vi.fn(() => () => {});

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress,
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderPanel({ activeCanvasId: null });

    expect(onProgress).not.toHaveBeenCalled();
  });

  it('subscribes to progress updates, applies active-canvas progress, and unsubscribes on unmount', async () => {
    let progressCallback:
      | ((data: { canvasId: string; nodeId: string; progress: number; currentStep?: string }) => void)
      | undefined;
    const unsubscribe = vi.fn();

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn((cb) => {
          progressCallback = cb;
          return unsubscribe;
        }),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store, unmount } = renderPanel({
      canvases: [
        createCanvas([
          createCanvasNode({
            data: {
              status: 'generating',
              progress: 5,
              variants: [],
              selectedVariantIndex: 0,
            },
          }),
        ]),
      ],
    });

    progressCallback?.({
      canvasId: 'other-canvas',
      nodeId: 'node-1',
      progress: 15,
      currentStep: 'Ignored',
    });
    progressCallback?.({
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      progress: 48,
      currentStep: 'Rendering frames',
    });

    await waitFor(() => {
      const node = store.getState().canvas.canvases.entities['canvas-1']?.nodes[0];
      expect(node?.data).toEqual(
        expect.objectContaining({
          progress: 48,
          currentStep: 'Rendering frames',
        }),
      );
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes when the active canvas changes', async () => {
    const unsubscribes = [vi.fn(), vi.fn()];
    const progressCallbacks: Array<
      (data: { canvasId: string; nodeId: string; progress: number; currentStep?: string }) => void
    > = [];

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn((cb) => {
          progressCallbacks.push(cb);
          return unsubscribes[progressCallbacks.length - 1] ?? vi.fn();
        }),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const { store } = renderPanel({
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
        {
          ...createCanvas([
            createCanvasNode({
              id: 'node-2',
              title: 'Second Frame',
              data: {
                status: 'generating',
                progress: 0,
                variants: [],
                selectedVariantIndex: 0,
              },
            }),
          ]),
          id: 'canvas-2',
          name: 'Second Shot',
        },
      ],
    });

    store.dispatch(setActiveCanvas('canvas-2'));

    await waitFor(() => {
      expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
      expect(progressCallbacks).toHaveLength(2);
    });

    act(() => {
      progressCallbacks[1]?.({
        canvasId: 'canvas-2',
        nodeId: 'node-2',
        progress: 88,
        currentStep: 'Upscaling',
      });
    });

    await waitFor(() => {
      const canvas = store.getState().canvas.canvases.entities['canvas-2'];
      expect(canvas?.nodes[0]?.data).toEqual(
        expect.objectContaining({
          progress: 88,
          currentStep: 'Upscaling',
        }),
      );
    });
  });

  it('cancels an in-flight generation task from the queue', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      canvasGeneration: {
        onProgress: vi.fn(() => () => {}),
        cancel,
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderPanel({
      canvases: [
        createCanvas([
          createCanvasNode({
            data: {
              status: 'generating',
              progress: 33,
              variants: [],
              selectedVariantIndex: 0,
            },
          }),
        ]),
      ],
    });

    fireEvent.click(screen.getByLabelText(t('generation.cancel')));

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith('canvas-1', 'node-1');
    });
  });

  it('clears completed generation status when removing a finished task', async () => {
    vi.mocked(getAPI).mockReturnValue(undefined);

    const { store } = renderPanel({
      canvases: [
        createCanvas([
          createCanvasNode({
            data: {
              status: 'done',
              progress: 100,
              variants: ['asset-1'],
              selectedVariantIndex: 0,
            },
          }),
        ]),
      ],
    });

    fireEvent.click(screen.getByLabelText(t('generation.remove')));

    await waitFor(() => {
      const node = store.getState().canvas.canvases.entities['canvas-1']?.nodes[0];
      expect(node?.data).toEqual(
        expect.objectContaining({
          status: 'empty',
          progress: undefined,
          currentStep: undefined,
          jobId: undefined,
        }),
      );
      expect(node?.status).toBe('idle');
    });
  });

  it('resolves provider names in expanded task details', async () => {
    vi.mocked(getAPI).mockReturnValue(undefined);

    const { store } = renderPanel({
      canvases: [
        createCanvas([
          createCanvasNode({
            type: 'video',
            title: 'Shot 1',
            data: {
              status: 'done',
              progress: 100,
              variants: ['asset-video-1'],
              selectedVariantIndex: 0,
              providerId: 'custom-video-provider',
              jobId: 'job-123',
            },
          }),
        ]),
      ],
    });

    store.dispatch(
      addCustomProvider({
        group: 'video',
        id: 'custom-video-provider',
        name: 'Cinema Hub',
        baseUrl: 'https://video.example/v1',
        model: 'cinema-pro',
      }),
    );

    fireEvent.click(screen.getByLabelText(t('generation.expand')));

    expect(await screen.findByText('Cinema Hub')).toBeTruthy();
    expect(screen.getByText(t('canvas.nodeType.video'))).toBeTruthy();
  });

  it('localizes expanded generation details in zh-CN', () => {
    setLocale('zh-CN');
    vi.mocked(getAPI).mockReturnValue(undefined);

    renderPanel({
      canvases: [
        createCanvas([
          createCanvasNode({
            type: 'video',
            title: 'Shot 1',
            data: {
              status: 'done',
              progress: 100,
              variants: ['asset-video-1'],
              selectedVariantIndex: 0,
              providerId: 'replicate',
              jobId: 'job-123',
            },
          }),
        ]),
      ],
    });

    fireEvent.click(screen.getByLabelText(t('generation.expand')));

    expect(screen.getAllByText(`${t('generation.type')}:`).length).toBeGreaterThan(0);
    expect(screen.getByText(t('canvas.nodeType.video'))).toBeTruthy();
    expect(screen.getAllByText(`${t('generation.nodeId')}:`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${t('generation.provider')}:`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${t('generation.jobId')}:`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${t('generation.status')}:`).length).toBeGreaterThan(0);
    expect(screen.getByText(t('generation.completed'))).toBeTruthy();
    expect(screen.queryByText('generation.type')).toBeNull();
    expect(screen.queryByText('video')).toBeNull();
    expect(screen.queryByText('done')).toBeNull();
  });
});
