// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Canvas } from '@lucid-fin/contracts';
import type { ReactFlowInstance } from '@xyflow/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasReducer, setActiveCanvas, setCanvases } from '../store/slices/canvas.js';
import { getAPI } from '../utils/api.js';
import { createNodePayloadFromAsset, useCanvasDragDrop } from './useCanvasDragDrop.js';

vi.mock('../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

function createCanvas(): Canvas {
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

function createWrapper() {
  const store = configureStore({
    reducer: {
      canvas: canvasReducer,
    },
  });

  store.dispatch(setCanvases([createCanvas() as never]));
  store.dispatch(setActiveCanvas('canvas-1'));

  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(Provider, { store, children });
  }

  return { store, Wrapper };
}

function createReactFlowRef(
  screenToFlowPosition: ReactFlowInstance['screenToFlowPosition'],
): React.RefObject<ReactFlowInstance | null> {
  return {
    current: { screenToFlowPosition } as unknown as ReactFlowInstance,
  };
}

function createDragEvent({
  data = {},
  files = [],
  types = [],
}: {
  data?: Record<string, string>;
  files?: File[];
  types?: string[];
}) {
  return {
    preventDefault: vi.fn(),
    clientX: 120,
    clientY: 180,
    dataTransfer: {
      getData: (type: string) => data[type] ?? '',
      files,
      types,
      dropEffect: 'none',
    },
  };
}

describe('createNodePayloadFromAsset', () => {
  it('creates correct node payloads for each supported asset type', () => {
    expect(createNodePayloadFromAsset({ hash: 'image-hash', name: 'Image', type: 'image' })).toEqual(
      expect.objectContaining({
        type: 'image',
        title: 'Image',
        data: expect.objectContaining({
          assetHash: 'image-hash',
          status: 'done',
          variantCount: 1,
        }),
      }),
    );

    expect(createNodePayloadFromAsset({ hash: 'video-hash', name: 'Video', type: 'video' })).toEqual(
      expect.objectContaining({
        type: 'video',
        title: 'Video',
      }),
    );

    expect(createNodePayloadFromAsset({ hash: 'audio-hash', name: 'Audio', type: 'audio' })).toEqual(
      expect.objectContaining({
        type: 'audio',
        title: 'Audio',
        data: expect.objectContaining({
          assetHash: 'audio-hash',
          audioType: 'voice',
        }),
      }),
    );
  });
});

describe('useCanvasDragDrop', () => {
  beforeEach(() => {
    vi.mocked(getAPI).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts supported drag types and sets copy drop effect', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useCanvasDragDrop({ current: null }),
      { wrapper: Wrapper },
    );

    const event = createDragEvent({ types: ['Files'] });
    result.current.handleDragOver(event as never);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.dataTransfer.dropEffect).toBe('copy');
  });

  it('adds a node when a canvas asset payload is dropped', () => {
    const { store, Wrapper } = createWrapper();
    const screenToFlowPosition = vi.fn(({ x, y }: { x: number; y: number }) => ({
      x: x - 20,
      y: y - 30,
    }));
    const { result } = renderHook(
      () => useCanvasDragDrop(createReactFlowRef(screenToFlowPosition)),
      { wrapper: Wrapper },
    );

    const event = createDragEvent({
      data: {
        'application/x-lucid-asset': JSON.stringify({
          hash: 'asset-hash',
          name: 'Reference Still',
          type: 'image',
        }),
      },
    });

    act(() => {
      result.current.handleDrop(event as never);
    });

    expect(store.getState().canvas.canvases[0]?.nodes).toEqual([
      expect.objectContaining({
        type: 'image',
        title: 'Reference Still',
        position: { x: 100, y: 150 },
        data: expect.objectContaining({ assetHash: 'asset-hash' }),
      }),
    ]);
  });

  it('creates a text node for dropped markdown files', async () => {
    const { store, Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useCanvasDragDrop(
          createReactFlowRef(({ x, y }: { x: number; y: number }) => ({ x, y })),
        ),
      { wrapper: Wrapper },
    );

    const file = new File(['Hello canvas'], 'notes.md', { type: 'text/markdown' });
    const event = createDragEvent({ files: [file] });

    act(() => {
      result.current.handleDrop(event as never);
    });

    await waitFor(() => {
      expect(store.getState().canvas.canvases[0]?.nodes).toEqual([
        expect.objectContaining({
          type: 'text',
          title: 'notes',
          data: { content: 'Hello canvas' },
        }),
      ]);
    });
  });

  it('imports dropped image files through IPC buffer import', async () => {
    const importBuffer = vi.fn(async () => ({ hash: 'imported-image-hash' }));
    vi.mocked(getAPI).mockReturnValue({
      asset: {
        importBuffer,
      },
    } as never);

    const { store, Wrapper } = createWrapper();
    const { result } = renderHook(
      () =>
        useCanvasDragDrop(
          createReactFlowRef(({ x, y }: { x: number; y: number }) => ({ x, y })),
        ),
      { wrapper: Wrapper },
    );

    const file = new File(['binary'], 'photo.png', { type: 'image/png' });
    const event = createDragEvent({ files: [file] });

    act(() => {
      result.current.handleDrop(event as never);
    });

    await waitFor(() => {
      expect(store.getState().canvas.canvases[0]?.nodes).toEqual([
        expect.objectContaining({
          type: 'image',
          title: 'photo',
          data: expect.objectContaining({ assetHash: 'imported-image-hash' }),
        }),
      ]);
    });

    expect(importBuffer).toHaveBeenCalledTimes(1);
  });
});
