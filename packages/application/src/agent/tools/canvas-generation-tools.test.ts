import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasEdge,
} from '@lucid-fin/contracts';
import { createCanvasGenerationTools } from './canvas-generation-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

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
        position: { x: 10, y: 0 },
        data: {
          status: 'empty',
          variants: [],
          selectedVariantIndex: 0,
          presetTracks: createEmptyPresetTrackSet(),
        },
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'video-1',
        type: 'video',
        title: 'Video',
        position: { x: 20, y: 0 },
        data: {
          status: 'empty',
          variants: [],
          selectedVariantIndex: 0,
          presetTracks: createEmptyPresetTrackSet(),
        },
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'audio-1',
        type: 'audio',
        title: 'Audio',
        position: { x: 30, y: 0 },
        data: {
          status: 'empty',
          variants: [],
          selectedVariantIndex: 0,
        },
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
      {
        id: 'edge-2',
        source: 'image-1',
        target: 'video-1',
        sourceHandle: 'right-50',
        targetHandle: 'tgt-left-50',
        data: { status: 'idle' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [{ id: 'note-1', content: 'draft', createdAt: 1, updatedAt: 1 }],
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
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async (_canvasId, edge: CanvasEdge) => {
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
    deleteEdge: vi.fn(async (_canvasId, edgeId) => {
      canvas.edges = canvas.edges.filter((edge) => edge.id !== edgeId);
    }),
    updateNodeData: vi.fn(async (_canvasId, nodeId, data) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      Object.assign(node.data as Record<string, unknown>, data);
    }),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset) => preset),
    listShotTemplates: vi.fn(async () => []),
    removeCharacterRef: vi.fn(async () => undefined),
    removeEquipmentRef: vi.fn(async () => undefined),
    removeLocationRef: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
    importWorkflow: vi.fn(async () => canvas),
    exportWorkflow: vi.fn(async () => '{}'),
    setNodeColorTag: vi.fn(async (_canvasId, nodeId, color) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      (node.data as Record<string, unknown>).colorTag = color;
    }),
    toggleSeedLock: vi.fn(async (_canvasId, nodeId) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const data = node.data as Record<string, unknown>;
      data.seedLocked = !(data.seedLocked as boolean | undefined);
    }),
    selectVariant: vi.fn(async (_canvasId, nodeId, index) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      (node.data as Record<string, unknown>).selectedVariantIndex = index;
    }),
    estimateCost: vi.fn(async (_canvasId, nodeIds) => ({
      totalEstimatedCost: nodeIds?.length ?? 3,
      currency: 'USD',
      nodeCosts: (nodeIds ?? ['image-1', 'video-1', 'audio-1']).map((nodeId) => ({ nodeId, estimatedCost: 1 })),
    })),
    addNote: vi.fn(async (_canvasId, content) => {
      const note = { id: `note-${canvas.notes.length + 1}`, content, createdAt: 2, updatedAt: 2 };
      canvas.notes.push(note);
      return note;
    }),
    getRecentLogs: vi.fn(async () => []),
    updateNote: vi.fn(async (_canvasId, noteId, content) => {
      const note = canvas.notes.find((entry) => entry.id === noteId);
      if (!note) throw new Error(`Note not found: ${noteId}`);
      note.content = content;
    }),
    deleteNote: vi.fn(async (_canvasId, noteId) => {
      canvas.notes = canvas.notes.filter((note) => note.id !== noteId);
    }),
    undo: vi.fn(async () => undefined),
    redo: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: CanvasToolDeps) {
  const tool = createCanvasGenerationTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createCanvasGenerationTools', () => {
  it('defines the expected generation tool suite', () => {
    const deps = createDeps();

    expect(createCanvasGenerationTools(deps).map((tool) => tool.name)).toEqual([
      'canvas.generate',
      'canvas.cancelGeneration',
      'canvas.setSeed',
      'canvas.setVariantCount',
      'canvas.setNodeColorTag',
      'canvas.toggleSeedLock',
      'canvas.selectVariant',
      'canvas.estimateCost',
      'canvas.addNote',
      'canvas.updateNote',
      'canvas.deleteNote',
      'canvas.undo',
      'canvas.redo',
      'canvas.generateAll',
      'canvas.deleteNode',
      'canvas.deleteEdge',
      'canvas.swapEdgeDirection',
      'canvas.disconnectNode',
      'canvas.editNodeContent',
      'canvas.setNodeProvider',
      'canvas.setNodeMediaConfig',
      'canvas.setVideoFrames',
    ]);
  });

  it('waits for generate completion and returns failed generations as structured output', async () => {
    vi.useFakeTimers();
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    vi.mocked(deps.triggerGeneration).mockImplementationOnce(async () => {
      const image = canvas.nodes.find((node) => node.id === 'image-1');
      if (image) {
        Object.assign(image.data as Record<string, unknown>, {
          status: 'done',
          variants: [{ assetHash: 'hash-1' }],
          assetHash: 'hash-1',
        });
      }
    }).mockImplementationOnce(async () => {
      const video = canvas.nodes.find((node) => node.id === 'video-1');
      if (video) {
        Object.assign(video.data as Record<string, unknown>, {
          status: 'failed',
          error: 'provider failed',
        });
      }
    });

    const donePromise = getTool('canvas.generate', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      providerId: 'runway',
      variantCount: 4,
    });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(donePromise).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        status: 'done',
        variants: [{ assetHash: 'hash-1' }],
        assetHash: 'hash-1',
      },
    });

    const failedPromise = getTool('canvas.generate', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'video-1',
    });
    await vi.advanceTimersByTimeAsync(3000);
    await expect(failedPromise).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'video-1',
        status: 'failed',
        error: 'provider failed',
      },
    });
  });

  it('delegates generation configuration and selection updates', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(getTool('canvas.cancelGeneration', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
    })).resolves.toEqual({ success: true, data: { nodeId: 'image-1' } });

    await expect(getTool('canvas.setSeed', deps).execute({
      canvasId: 'canvas-1',
      nodeIds: ['image-1', 'audio-1', 'image-1'],
      seed: 9.6,
    })).resolves.toEqual({
      success: true,
      data: { nodeIds: ['image-1', 'audio-1'], seed: 10 },
    });
    expect((canvas.nodes[1].data as Record<string, unknown>).seed).toBe(10);
    expect((canvas.nodes[3].data as Record<string, unknown>).seed).toBe(10);

    await expect(getTool('canvas.setVariantCount', deps).execute({
      canvasId: 'canvas-1',
      nodeIds: ['image-1', 'video-1'],
      count: 4,
    })).resolves.toEqual({
      success: true,
      data: { nodeIds: ['image-1', 'video-1'], count: 4 },
    });

    await expect(getTool('canvas.setNodeColorTag', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      color: 'gold',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', color: 'gold' },
    });

    await expect(getTool('canvas.toggleSeedLock', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'audio-1',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'audio-1' },
    });

    await expect(getTool('canvas.selectVariant', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      index: 2.4,
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', index: 2 },
    });
  });

  it('estimates cost, manages notes, and supports undo/redo', async () => {
    const deps = createDeps();

    await expect(getTool('canvas.estimateCost', deps).execute({
      canvasId: 'canvas-1',
      nodeIds: ['image-1', 'video-1'],
    })).resolves.toEqual({
      success: true,
      data: {
        totalEstimatedCost: 2,
        currency: 'USD',
        nodeCosts: [
          { nodeId: 'image-1', estimatedCost: 1 },
          { nodeId: 'video-1', estimatedCost: 1 },
        ],
      },
    });
    await expect(getTool('canvas.addNote', deps).execute({
      canvasId: 'canvas-1',
      content: ' keep spacing ',
    })).resolves.toEqual({
      success: true,
      data: { id: 'note-2', content: ' keep spacing ', createdAt: 2, updatedAt: 2 },
    });
    await expect(getTool('canvas.updateNote', deps).execute({
      canvasId: 'canvas-1',
      noteId: 'note-1',
      content: 'updated',
    })).resolves.toEqual({
      success: true,
      data: { noteId: 'note-1', content: 'updated' },
    });
    await expect(getTool('canvas.deleteNote', deps).execute({
      canvasId: 'canvas-1',
      noteId: 'note-1',
    })).resolves.toEqual({
      success: true,
      data: { noteId: 'note-1' },
    });
    await expect(getTool('canvas.undo', deps).execute({ canvasId: 'canvas-1' })).resolves.toEqual({
      success: true,
      data: { canvasId: 'canvas-1' },
    });
    await expect(getTool('canvas.redo', deps).execute({ canvasId: 'canvas-1' })).resolves.toEqual({
      success: true,
      data: { canvasId: 'canvas-1' },
    });
  });

  it('generates all media nodes and performs edge and node mutations', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(getTool('canvas.generateAll', deps).execute({
      canvasId: 'canvas-1',
      providerId: 'runway',
    })).resolves.toEqual({
      success: true,
      data: { nodeIds: ['image-1', 'video-1'], providerId: 'runway', count: 2 },
    });
    expect(deps.triggerGeneration).toHaveBeenNthCalledWith(1, 'canvas-1', 'image-1', 'runway');
    expect(deps.triggerGeneration).toHaveBeenNthCalledWith(2, 'canvas-1', 'video-1', 'runway');

    await expect(getTool('canvas.swapEdgeDirection', deps).execute({
      canvasId: 'canvas-1',
      edgeId: 'edge-1',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'edge-1',
        source: 'image-1',
        target: 'text-1',
        sourceHandle: 'left-50',
        targetHandle: 'tgt-right-50',
      }),
    });

    await expect(getTool('canvas.disconnectNode', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', edgeIds: ['edge-2', 'edge-1'], count: 2 },
    });

    await expect(getTool('canvas.deleteNode', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'audio-1',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'audio-1' },
    });
    await expect(getTool('canvas.deleteEdge', deps).execute({
      canvasId: 'canvas-1',
      edgeId: 'edge-2',
    })).resolves.toEqual({
      success: true,
      data: { edgeId: 'edge-2' },
    });
  });

  it('edits content, providers, media config, and video frame references', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(getTool('canvas.editNodeContent', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
      content: 'rewritten',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'text-1', content: 'rewritten' },
    });
    await expect(getTool('canvas.editNodeContent', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      prompt: 'new image prompt',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', prompt: 'new image prompt' },
    });

    await expect(getTool('canvas.setNodeProvider', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'video-1',
      providerId: 'kling-v1',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'video-1', providerId: 'kling-v1' },
    });

    await expect(getTool('canvas.setNodeMediaConfig', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'video-1',
      width: 1920,
      height: 1080,
      duration: 5,
      audio: true,
      quality: 'pro',
    })).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'video-1',
        width: 1920,
        height: 1080,
        duration: 5,
        audio: true,
        quality: 'pro',
      },
    });

    await expect(getTool('canvas.setVideoFrames', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'video-1',
      firstFrameNodeId: 'image-1',
      lastFrameAssetHash: 'asset-last',
    })).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'video-1',
        firstFrameNodeId: 'image-1',
        firstFrameAssetHash: undefined,
        lastFrameAssetHash: 'asset-last',
        lastFrameNodeId: undefined,
      },
    });
  });

  it('validates unsupported node types and bad parameters', async () => {
    const deps = createDeps();

    await expect(getTool('canvas.setVariantCount', deps).execute({
      canvasId: 'canvas-1',
      nodeIds: ['image-1'],
      count: 3,
    })).resolves.toEqual({
      success: false,
      error: 'count must be one of 1, 2, 4, or 9',
    });
    await expect(getTool('canvas.generateAll', deps).execute({
      canvasId: 'canvas-1',
      nodeIds: ['text-1'],
    })).resolves.toEqual({
      success: false,
      error: 'Node type "text" does not support generation',
    });
    await expect(getTool('canvas.editNodeContent', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
      prompt: 'wrong field',
    })).resolves.toEqual({
      success: false,
      error: 'content is required for text nodes',
    });
    await expect(getTool('canvas.setNodeProvider', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
      providerId: 'runway',
    })).resolves.toEqual({
      success: false,
      error: 'Node type "text" does not support providers',
    });
    await expect(getTool('canvas.setNodeMediaConfig', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'audio-1',
    })).resolves.toEqual({
      success: false,
      error: 'Node type "audio" does not support media config',
    });
    await expect(getTool('canvas.setVideoFrames', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
    })).resolves.toEqual({
      success: false,
      error: 'Node type "image" is not a video node',
    });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.deleteEdge).mockRejectedValueOnce(new Error('edge delete failed'));

    await expect(getTool('canvas.deleteEdge', deps).execute({
      canvasId: 'canvas-1',
      edgeId: 'edge-1',
    })).resolves.toEqual({
      success: false,
      error: 'edge delete failed',
    });
  });
});
