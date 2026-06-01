import { describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { createCanvasGenerationTools } from './canvas-generation-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'image-1',
        type: 'image',
        title: 'Image',
        position: { x: 0, y: 0 },
        data: {},
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'audio-1',
        type: 'audio',
        title: 'Audio',
        position: { x: 10, y: 0 },
        data: {},
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'text-1',
        type: 'text',
        title: 'Text',
        position: { x: 20, y: 0 },
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

function createDeps(canvas = createCanvas()): CanvasToolDeps {
  return {
    getCanvas: vi.fn(async () => canvas),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    renameNode: vi.fn(async () => undefined),
    renameCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    layoutNodes: vi.fn(async () => undefined),
    triggerGeneration: vi.fn(async () => undefined),
    cancelGeneration: vi.fn(async () => undefined),
    deleteNode: vi.fn(async () => undefined),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(async (_canvasId, nodeId, data) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      Object.assign(node.data as Record<string, unknown>, data);
    }),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
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

function getTool(name: string, deps: CanvasToolDeps) {
  const tool = createCanvasGenerationTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('canvas.setNodeRefs', () => {
  it('sets all ref types on an image node in one call', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setNodeRefs', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        characterRefs: [{ characterId: 'char-1', loadoutId: 'look-1' }],
        equipmentRefs: [{ equipmentId: 'eq-1' }],
        locationRefs: [{ locationId: 'loc-1' }],
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        characterRefs: [{ characterId: 'char-1', loadoutId: 'look-1' }],
        equipmentRefs: [{ equipmentId: 'eq-1' }],
        locationRefs: [{ locationId: 'loc-1' }],
      },
    });
  });

  it('clears refs by passing empty arrays', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setNodeRefs', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        characterRefs: [],
        equipmentRefs: [],
        locationRefs: [],
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        characterRefs: [],
        equipmentRefs: [],
        locationRefs: [],
      },
    });
  });

  it('updates only specified ref types', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setNodeRefs', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        characterRefs: [{ characterId: 'char-1' }],
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        characterRefs: [{ characterId: 'char-1', loadoutId: '' }],
      },
    });
  });

  it('rejects unsupported node types', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.setNodeRefs', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'text-1',
        locationRefs: [],
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Node type "text" does not support entity refs',
    });
  });

  it('requires at least one ref type', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.setNodeRefs', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'At least one of characterRefs, equipmentRefs, or locationRefs is required',
    });
  });
});
