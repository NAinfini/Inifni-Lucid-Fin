import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import {
  addEdge,
  addNode,
  canvasSlice,
  reconnectCanvasEdge,
  setActiveCanvas,
  setCanvases,
} from './canvas.js';

function makeCanvas(): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Main',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  };
}

function setup() {
  let state = canvasSlice.reducer(undefined, setCanvases([makeCanvas()]));
  state = canvasSlice.reducer(state, setActiveCanvas('canvas-1'));
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'text-1', type: 'text', position: { x: 0, y: 0 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'image-1', type: 'image', position: { x: 120, y: 0 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'video-1', type: 'video', position: { x: 240, y: 0 } }),
  );
  state = canvasSlice.reducer(
    state,
    addNode({ id: 'audio-1', type: 'audio', position: { x: 360, y: 0 } }),
  );
  return state;
}

describe('canvas edge reconnect reducers', () => {
  it('updates the source endpoint and source handle when reconnecting from the source side', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addEdge({
        id: 'edge-1',
        source: 'text-1',
        target: 'video-1',
        sourceHandle: 'top-20',
        targetHandle: 'tgt-left-50',
        data: { status: 'idle' },
      }),
    );

    state = canvasSlice.reducer(
      state,
      reconnectCanvasEdge({
        edgeId: 'edge-1',
        connection: {
          source: 'image-1',
          target: 'video-1',
          sourceHandle: 'right-62',
          targetHandle: 'tgt-left-50',
        },
      }),
    );

    const edge = state.canvases[0].edges.find((item) => item.id === 'edge-1');
    expect(edge).toEqual(
      expect.objectContaining({
        source: 'image-1',
        target: 'video-1',
        sourceHandle: 'right-62',
        targetHandle: 'tgt-left-50',
      }),
    );
    expect(edge?.data.label).toBe(t('edge.animate'));
  });

  it('updates the target endpoint and target handle when reconnecting from the target side', () => {
    let state = setup();
    state = canvasSlice.reducer(
      state,
      addEdge({
        id: 'edge-2',
        source: 'text-1',
        target: 'image-1',
        sourceHandle: 'top-20',
        targetHandle: 'tgt-left-50',
        data: { status: 'idle' },
      }),
    );

    state = canvasSlice.reducer(
      state,
      reconnectCanvasEdge({
        edgeId: 'edge-2',
        connection: {
          source: 'text-1',
          target: 'audio-1',
          sourceHandle: 'top-20',
          targetHandle: 'tgt-bottom-74',
        },
      }),
    );

    const edge = state.canvases[0].edges.find((item) => item.id === 'edge-2');
    expect(edge).toEqual(
      expect.objectContaining({
        source: 'text-1',
        target: 'audio-1',
        sourceHandle: 'top-20',
        targetHandle: 'tgt-bottom-74',
      }),
    );
    expect(edge?.data.label).toBe(t('edge.narrate'));
  });
});
