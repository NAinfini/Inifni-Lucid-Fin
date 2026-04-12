import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasNode,
  type PresetTrack,
  type PresetTrackSet,
} from '@lucid-fin/contracts';
import {
  CAMERA_DIRECTIONS,
  buildDefaultNodeData,
  buildDuplicatedNodes,
  clampIntensity,
  clonePresetTrackSet,
  createTrackSetWithPreset,
  fail,
  layoutCanvasNodes,
  normalizeTrackOrders,
  ok,
  parseOptionalCameraDirection,
  replaceNodePreservingEdges,
  requireBackdropBorderStyle,
  requireBackdropNode,
  requireBackdropTitleSize,
  requireBoolean,
  requireCameraDirection,
  requireCanvas,
  requireCanvasEdge,
  requireCanvasNodeById,
  requireCanvasNodeType,
  requireDirection,
  requireMediaNode,
  requireMoveDirection,
  requireNode,
  requireNumber,
  requirePosition,
  requirePresetCategory,
  requirePresetTrackEntry,
  requirePresetTrackEntryChanges,
  requireString,
  requireStringArray,
  requireText,
  requireVisualGenerationNode,
  selectEdgeHandles,
  type CanvasToolDeps,
} from './canvas-tool-utils.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'text-1',
        type: 'text',
        title: 'Text',
        position: { x: 0, y: 0 },
        width: 100,
        height: 60,
        data: { content: 'hello' },
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'image-1',
        type: 'image',
        title: 'Image',
        position: { x: 200, y: 20 },
        width: 120,
        height: 70,
        data: { presetTracks: createEmptyPresetTrackSet() },
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'backdrop-1',
        type: 'backdrop',
        title: 'Backdrop',
        position: { x: 0, y: 150 },
        width: 300,
        height: 200,
        data: { collapsed: false },
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        source: 'text-1',
        target: 'image-1',
        sourceHandle: 'right-50',
        targetHandle: 'tgt-left-50',
        data: { status: 'idle' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function createDeps(canvas = createCanvas()): CanvasToolDeps {
  return {
    getCanvas: vi.fn(async () => canvas),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async (_canvasId, node) => {
      canvas.nodes.push(node);
    }),
    moveNode: vi.fn(async (_canvasId, nodeId, position) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      node.position = position;
    }),
    renameNode: vi.fn(async () => undefined),
    renameCanvas: vi.fn(async () => undefined),
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async (_canvasId, edge) => {
      canvas.edges.push(edge);
    }),
    setNodePresets: vi.fn(async () => undefined),
    getCanvasState: vi.fn(async () => canvas),
    layoutNodes: vi.fn(async () => undefined),
    triggerGeneration: vi.fn(async () => undefined),
    cancelGeneration: vi.fn(async () => undefined),
    deleteNode: vi.fn(async (_canvasId, nodeId) => {
      canvas.nodes = canvas.nodes.filter((node) => node.id !== nodeId);
      canvas.edges = canvas.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    }),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(async () => undefined),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    removeCharacterRef: vi.fn(async () => undefined),
    removeEquipmentRef: vi.fn(async () => undefined),
    removeLocationRef: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
    importWorkflow: vi.fn(async () => canvas),
    exportWorkflow: vi.fn(async () => '{}'),
    setNodeColorTag: vi.fn(async () => undefined),
    toggleSeedLock: vi.fn(async () => undefined),
    selectVariant: vi.fn(async () => undefined),
    estimateCost: vi.fn(async () => ({ totalEstimatedCost: 0, currency: 'USD', nodeCosts: [] })),
    addNote: vi.fn(async () => ({ id: 'note-1', content: 'note', createdAt: 1, updatedAt: 1 })),
    getRecentLogs: vi.fn(async () => []),
    updateNote: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    undo: vi.fn(async () => undefined),
    redo: vi.fn(async () => undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canvas-tool-utils', () => {
  it('builds success and failure result objects', () => {
    expect(ok()).toEqual({ success: true });
    expect(ok({ value: 1 })).toEqual({ success: true, data: { value: 1 } });
    expect(fail(new Error('bad'))).toEqual({ success: false, error: 'bad' });
    expect(fail('plain')).toEqual({ success: false, error: 'plain' });
  });

  it('validates primitive and collection inputs', () => {
    expect(requireString({ key: '  value ' }, 'key')).toBe('value');
    expect(() => requireString({ key: '' }, 'key')).toThrow('key is required');

    expect(requireText({ key: '  keep  ' }, 'key')).toBe('  keep  ');
    expect(() => requireText({}, 'key')).toThrow('key is required');

    expect(requireStringArray({ ids: [' a ', 'b', 'a'] }, 'ids')).toEqual(['a', 'b']);
    expect(() => requireStringArray({ ids: [] }, 'ids')).toThrow('ids must be a non-empty array');
    expect(() => requireStringArray({ ids: ['a', ''] }, 'ids')).toThrow('ids[1] must be a non-empty string');

    expect(requireBoolean({ flag: true }, 'flag')).toBe(true);
    expect(() => requireBoolean({ flag: 'true' }, 'flag')).toThrow('flag must be a boolean');

    expect(requireNumber({ value: 3.2 }, 'value')).toBe(3.2);
    expect(() => requireNumber({ value: Infinity }, 'value')).toThrow('value must be a finite number');
  });

  it('validates direction, position, node type, and preset categories', () => {
    expect(requireDirection({ direction: 'horizontal' })).toBe('horizontal');
    expect(() => requireDirection({ direction: 'diagonal' })).toThrow('direction must be "horizontal", "vertical", or "auto"');

    expect(requirePosition({ position: { x: 1, y: 2 } })).toEqual({ x: 1, y: 2 });
    expect(() => requirePosition({ position: { x: 1 } })).toThrow('position with numeric x and y is required');

    expect(requireCanvasNodeType({ type: 'audio' })).toBe('audio');
    expect(requireCanvasNodeType({ type: 'backdrop' })).toBe('backdrop');
    expect(() => requireCanvasNodeType({ type: 'invalid' })).toThrow('type must be one of text, image, video, audio, or backdrop');

    expect(requirePresetCategory({ category: 'camera' })).toBe('camera');
    expect(() => requirePresetCategory({ category: 'bad' })).toThrow(
      'category must be one of camera, lens, look, scene, composition, emotion, flow, technical',
    );
  });

  it('handles camera directions and intensity helpers', () => {
    expect(CAMERA_DIRECTIONS).toContain('front');
    expect(clampIntensity(-2)).toBe(0);
    expect(clampIntensity(55.6)).toBe(56);
    expect(clampIntensity('bad')).toBeUndefined();

    expect(parseOptionalCameraDirection('left')).toBe('left');
    expect(parseOptionalCameraDirection('bad')).toBeUndefined();
    expect(requireCameraDirection('pov', 'direction')).toBe('pov');
    expect(() => requireCameraDirection('bad', 'direction')).toThrow('direction must be a valid camera direction');
  });

  it('validates backdrop and move enums', () => {
    expect(requireBackdropBorderStyle({ borderStyle: 'solid' })).toBe('solid');
    expect(() => requireBackdropBorderStyle({ borderStyle: 'double' })).toThrow(
      'borderStyle must be one of dashed, solid, or dotted',
    );

    expect(requireBackdropTitleSize({ titleSize: 'md' })).toBe('md');
    expect(() => requireBackdropTitleSize({ titleSize: 'xl' })).toThrow('titleSize must be one of sm, md, or lg');

    expect(requireMoveDirection({ direction: 'up' })).toBe('up');
    expect(() => requireMoveDirection({ direction: 'left' })).toThrow('direction must be "up" or "down"');
  });

  it('loads canvases, nodes, edges, and node categories', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(requireCanvas(deps, 'canvas-1')).resolves.toBe(canvas);
    await expect(requireNode(deps, 'canvas-1', 'image-1')).resolves.toEqual({
      canvas,
      node: canvas.nodes[1],
    });
    expect(requireCanvasEdge(canvas, 'edge-1')).toBe(canvas.edges[0]);
    expect(requireCanvasNodeById(canvas, 'text-1')).toBe(canvas.nodes[0]);

    expect(() => requireCanvasEdge(canvas, 'missing')).toThrow('Edge not found: missing');
    expect(() => requireCanvasNodeById(canvas, 'missing')).toThrow('Node not found: missing');
    await expect(requireNode(deps, 'canvas-1', 'missing')).rejects.toThrow('Node not found: missing');

    expect(() => requireMediaNode(canvas.nodes[0])).toThrow('Node type "text" does not support this operation');
    expect(() => requireVisualGenerationNode(canvas.nodes[0])).toThrow('Node type "text" does not support this operation');
    expect(() => requireBackdropNode(canvas.nodes[0])).toThrow('Node type "text" does not support backdrop styling');
  });

  it('selects edge handles based on relative node positions', () => {
    const source = createCanvas().nodes[0] as CanvasNode;
    const rightTarget = createCanvas().nodes[1] as CanvasNode;
    const bottomTarget = {
      ...rightTarget,
      position: { x: 20, y: 200 },
    };

    expect(selectEdgeHandles(source, rightTarget)).toEqual({
      sourceHandle: 'right-50',
      targetHandle: 'tgt-left-50',
    });
    expect(selectEdgeHandles(source, bottomTarget)).toEqual({
      sourceHandle: 'bottom-50',
      targetHandle: 'tgt-bottom-50',
    });
  });

  it('clones, normalizes, and validates preset track entries', () => {
    const canvas = createCanvas();
    const node = canvas.nodes[1] as CanvasNode;
    const tracks = clonePresetTrackSet(node);
    tracks.camera.entries.push({
      id: 'entry-1',
      category: 'camera',
      presetId: 'camera-push',
      params: {},
      order: 5,
    });
    const track = tracks.camera as PresetTrack;

    expect(requirePresetTrackEntry(track, 'entry-1')).toEqual(expect.objectContaining({ presetId: 'camera-push' }));
    expect(() => requirePresetTrackEntry(track, 'missing')).toThrow('Preset track entry not found: missing');

    normalizeTrackOrders(track);
    expect(track.entries[0]?.order).toBe(0);

    expect(requirePresetTrackEntryChanges({
      changes: {
        intensity: 45.6,
        presetId: ' preset-2 ',
        direction: 'front',
      },
    })).toEqual({
      intensity: 46,
      presetId: 'preset-2',
      direction: 'front',
    });
    expect(() => requirePresetTrackEntryChanges({ changes: [] })).toThrow('changes is required');
    expect(() => requirePresetTrackEntryChanges({ changes: { intensity: 'bad' } })).toThrow(
      'changes.intensity must be a finite number',
    );
  });

  it('replaces nodes while preserving connected edges', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    vi.spyOn(Date, 'now').mockReturnValue(999);

    const nextNode = await replaceNodePreservingEdges(deps, 'canvas-1', canvas.nodes[0] as CanvasNode, {
      bypassed: true,
      locked: true,
    });

    expect(nextNode).toEqual(expect.objectContaining({
      id: 'text-1',
      bypassed: true,
      locked: true,
      updatedAt: 999,
    }));
    expect(deps.deleteNode).toHaveBeenCalledWith('canvas-1', 'text-1');
    expect(deps.addNode).toHaveBeenCalledWith('canvas-1', expect.objectContaining({ id: 'text-1' }));
    expect(deps.connectNodes).toHaveBeenCalledWith('canvas-1', expect.objectContaining({ id: 'edge-1' }));
  });

  it('builds default node data and preset track sets', () => {
    expect(buildDefaultNodeData('text')).toEqual({ content: '' });
    expect(buildDefaultNodeData('image')).toEqual(expect.objectContaining({
      status: 'empty',
      variantCount: 1,
      seedLocked: false,
    }));
    expect(buildDefaultNodeData('video')).toEqual(expect.objectContaining({
      status: 'empty',
      variantCount: 1,
      seedLocked: false,
    }));
    expect(buildDefaultNodeData('audio')).toEqual(expect.objectContaining({
      status: 'empty',
      audioType: 'voice',
      variantCount: 1,
    }));

    vi.spyOn(crypto, 'randomUUID').mockReturnValue('preset-entry-1');
    const trackSet = createTrackSetWithPreset(undefined, 'camera', 'camera-push') as PresetTrackSet;
    expect(trackSet.camera.entries).toEqual([
      expect.objectContaining({
        id: 'preset-entry-1',
        category: 'camera',
        presetId: 'camera-push',
        order: 0,
      }),
    ]);
  });

  it('duplicates nodes and lays them out on the canvas', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('dup-1');
    vi.spyOn(Date, 'now').mockReturnValue(555);

    expect(buildDuplicatedNodes(canvas, ['text-1'])).toEqual([
      expect.objectContaining({
        id: 'dup-1',
        position: { x: 50, y: 50 },
        createdAt: 555,
        updatedAt: 555,
      }),
    ]);

    await expect(layoutCanvasNodes(deps, 'canvas-1', 'horizontal')).resolves.toEqual([
      { id: 'text-1', position: { x: 0, y: 0 } },
      { id: 'image-1', position: { x: 300, y: 0 } },
      { id: 'backdrop-1', position: { x: 600, y: 0 } },
    ]);
    await expect(layoutCanvasNodes(deps, 'canvas-1', 'vertical')).resolves.toEqual([
      { id: 'text-1', position: { x: 0, y: 0 } },
      { id: 'image-1', position: { x: 0, y: 250 } },
      { id: 'backdrop-1', position: { x: 0, y: 500 } },
    ]);
  });
});
