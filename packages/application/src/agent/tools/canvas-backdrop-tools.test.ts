import { describe, expect, it, vi } from 'vitest';
import type { Canvas } from '@lucid-fin/contracts';
import { createCanvasBackdropTools } from './canvas-backdrop-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'backdrop-1',
        type: 'backdrop',
        title: 'Backdrop',
        position: { x: 0, y: 0 },
        data: {
          color: '#111111',
          opacity: 50,
          collapsed: false,
          borderStyle: 'solid',
          titleSize: 'md',
          lockChildren: false,
        },
        status: 'idle',
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'text-1',
        type: 'text',
        title: 'Text',
        position: { x: 10, y: 10 },
        data: { content: 'hello' },
        status: 'idle',
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
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    getCanvasState: vi.fn(async () => canvas),
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

function getTool(name: string, deps: CanvasToolDeps) {
  const tool = createCanvasBackdropTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createCanvasBackdropTools', () => {
  it('defines backdrop styling tools', () => {
    const deps = createDeps();
    expect(createCanvasBackdropTools(deps).map((tool) => tool.name)).toEqual([
      'canvas.setBackdropOpacity',
      'canvas.setBackdropColor',
      'canvas.setBackdropBorderStyle',
      'canvas.setBackdropTitleSize',
      'canvas.setBackdropLockChildren',
      'canvas.toggleBackdropCollapse',
    ]);
  });

  it('updates backdrop style properties through updateNodeData', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(getTool('canvas.setBackdropOpacity', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      opacity: 75,
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'backdrop-1', opacity: 75 },
    });
    await expect(getTool('canvas.setBackdropColor', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      color: '#ffaa00',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'backdrop-1', color: '#ffaa00' },
    });
    await expect(getTool('canvas.setBackdropBorderStyle', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      borderStyle: 'dotted',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'backdrop-1', borderStyle: 'dotted' },
    });
    await expect(getTool('canvas.setBackdropTitleSize', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      titleSize: 'lg',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'backdrop-1', titleSize: 'lg' },
    });
    await expect(getTool('canvas.setBackdropLockChildren', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      locked: true,
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'backdrop-1', locked: true },
    });
    await expect(getTool('canvas.toggleBackdropCollapse', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'backdrop-1', collapsed: true },
    });
  });

  it('validates backdrop-specific parameters and node types', async () => {
    const deps = createDeps();

    await expect(getTool('canvas.setBackdropOpacity', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      opacity: Number.NaN,
    })).resolves.toEqual({
      success: false,
      error: 'opacity must be a finite number',
    });
    await expect(getTool('canvas.setBackdropBorderStyle', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      borderStyle: 'double',
    })).resolves.toEqual({
      success: false,
      error: 'borderStyle must be one of dashed, solid, or dotted',
    });
    await expect(getTool('canvas.setBackdropColor', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
      color: '#fff',
    })).resolves.toEqual({
      success: false,
      error: 'Node type "text" does not support backdrop styling',
    });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.updateNodeData).mockRejectedValueOnce(new Error('update failed'));

    await expect(getTool('canvas.setBackdropOpacity', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'backdrop-1',
      opacity: 25,
    })).resolves.toEqual({
      success: false,
      error: 'update failed',
    });
  });
});
