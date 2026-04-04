import { describe, expect, it } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import {
  addNode,
  addNodePresetTrackEntry,
  canvasSlice,
  moveNodePresetTrackEntry,
  removeNodePresetTrackEntry,
  setActiveCanvas,
  setCanvases,
  setNodeTrackAiDecide,
  updateNodePresetTrackEntry,
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

describe('canvas preset tracks', () => {
  it('supports ai-decide and track entry lifecycle', () => {
    let state = canvasSlice.reducer(undefined, setCanvases([makeCanvas()]));
    state = canvasSlice.reducer(state, setActiveCanvas('canvas-1'));
    state = canvasSlice.reducer(
      state,
      addNode({
        id: 'node-1',
        type: 'image',
        position: { x: 10, y: 10 },
      }),
    );

    state = canvasSlice.reducer(
      state,
      setNodeTrackAiDecide({
        id: 'node-1',
        category: 'camera',
        aiDecide: true,
      }),
    );

    state = canvasSlice.reducer(
      state,
      addNodePresetTrackEntry({
        id: 'node-1',
        category: 'camera',
        entry: {
          id: 'entry-a',
          category: 'camera',
          presetId: 'builtin-camera-zoom-in',
          params: {},
          durationMs: 1000,
          order: 0,
        },
      }),
    );

    state = canvasSlice.reducer(
      state,
      addNodePresetTrackEntry({
        id: 'node-1',
        category: 'camera',
        entry: {
          id: 'entry-b',
          category: 'camera',
          presetId: 'builtin-camera-pan-left',
          params: {},
          durationMs: 2000,
          order: 1,
        },
      }),
    );

    state = canvasSlice.reducer(
      state,
      updateNodePresetTrackEntry({
        id: 'node-1',
        category: 'camera',
        entryId: 'entry-b',
        changes: {
          durationMs: 3000,
        },
      }),
    );

    state = canvasSlice.reducer(
      state,
      moveNodePresetTrackEntry({
        id: 'node-1',
        category: 'camera',
        entryId: 'entry-b',
        direction: 'up',
      }),
    );

    state = canvasSlice.reducer(
      state,
      removeNodePresetTrackEntry({
        id: 'node-1',
        category: 'camera',
        entryId: 'entry-a',
      }),
    );

    const canvas = state.canvases[0];
    const imageNode = canvas.nodes[0] as {
      data: {
        presetTracks: Record<
          string,
          {
            category: string;
            aiDecide: boolean;
            entries: Array<{
              id: string;
              durationMs?: number;
            }>;
          }
        >;
      };
    };
    const cameraTrack = imageNode.data.presetTracks.camera;

    expect(cameraTrack.aiDecide).toBe(true);
    expect(cameraTrack.entries).toHaveLength(1);
    expect(cameraTrack.entries[0].id).toBe('entry-b');
    expect(cameraTrack.entries[0].durationMs).toBe(3000);
  });
});
