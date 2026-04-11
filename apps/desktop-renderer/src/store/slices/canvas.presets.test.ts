import { describe, expect, it } from 'vitest';
import { BUILT_IN_SHOT_TEMPLATES, type Canvas } from '@lucid-fin/contracts';
import {
  addNode,
  addNodePresetTrackEntry,
  applyNodeShotTemplate,
  canvasSlice,
  moveNodePresetTrackEntry,
  removeNodePresetTrackEntry,
  setActiveCanvas,
  setCanvases,
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
            entries: Array<{
              id: string;
              durationMs?: number;
            }>;
          }
        >;
      };
    };
    const cameraTrack = imageNode.data.presetTracks.camera;

    expect(cameraTrack.entries).toHaveLength(1);
    expect(cameraTrack.entries[0].id).toBe('entry-b');
    expect(cameraTrack.entries[0].durationMs).toBe(3000);
  });

  it('stores the applied shot template on the node and clears it after manual track edits', () => {
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

    const template = BUILT_IN_SHOT_TEMPLATES.find((entry) => entry.id === 'builtin-tmpl-horror-suspense');
    if (!template) {
      throw new Error('Expected built-in shot template to exist');
    }

    state = canvasSlice.reducer(
      state,
      applyNodeShotTemplate({
        nodeId: 'node-1',
        template,
      }),
    );

    const imageNode = state.canvases[0]?.nodes[0] as {
      data: {
        appliedShotTemplateId?: string;
        appliedShotTemplateName?: string;
        presetTracks: Record<string, { entries: Array<{ presetId: string }> }>;
      };
    };

    expect(imageNode.data.appliedShotTemplateId).toBe(template.id);
    expect(imageNode.data.appliedShotTemplateName).toBe(template.name);
    expect(imageNode.data.presetTracks.emotion.entries[0]?.presetId).toBe('builtin-emotion-ominous');

    state = canvasSlice.reducer(
      state,
      addNodePresetTrackEntry({
        id: 'node-1',
        category: 'camera',
        entry: {
          id: 'entry-extra',
          category: 'camera',
          presetId: 'builtin-camera-crane-up',
          params: {},
          order: 1,
        },
      }),
    );

    const nodeData = state.canvases[0]?.nodes[0]?.data as unknown as Record<string, unknown>;

    expect(nodeData.appliedShotTemplateId).toBeUndefined();
    expect(nodeData.appliedShotTemplateName).toBeUndefined();
  });
});
