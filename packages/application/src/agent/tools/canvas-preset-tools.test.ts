import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyPresetTrackSet,
  type Canvas,
  type PresetTrackSet,
} from '@lucid-fin/contracts';
import { createCanvasPresetTools } from './canvas-preset-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'image-1',
        type: 'image',
        title: 'Image',
        position: { x: 0, y: 0 },
        data: {
          prompt: 'A lone samurai at dusk',
          characterRefs: [{ characterId: 'char-1', loadoutId: 'look-1' }],
          locationRefs: [{ locationId: 'loc-1' }],
          presetTracks: createEmptyPresetTrackSet(),
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
        position: { x: 10, y: 0 },
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
    setNodePresets: vi.fn(async (_canvasId, nodeId, presetTracks) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      (node.data as { presetTracks?: PresetTrackSet }).presetTracks = presetTracks;
    }),
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
    listShotTemplates: vi.fn(async () => [
      {
        id: 'tmpl-1',
        name: 'Cinematic Sweep',
        description: 'A cinematic sweep template',
        builtIn: true,
        tracks: {
          camera: {
            category: 'camera',
            intensity: 55,
            entries: [
              {
                id: 'entry-template',
                category: 'camera',
                presetId: 'camera-sweep',
                params: {},
                order: 0,
              },
            ],
          },
        },
      },
    ]),
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
  const tool = createCanvasPresetTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createCanvasPresetTools', () => {
  it('defines the expected preset track tools', () => {
    const deps = createDeps();

    expect(createCanvasPresetTools(deps).map((tool) => tool.name)).toEqual([
      'canvas.readNodePresetTracks',
      'canvas.writeNodePresetTracks',
      'canvas.addPresetTrackEntry',
      'canvas.removePresetTrackEntry',
      'canvas.updatePresetTrackEntry',
      'canvas.movePresetTrackEntry',
      'canvas.applyShotTemplate',
      'canvas.autoFillEmptyTracks',
      'canvas.createCustomPreset',
      'shotTemplate.list',
      'shotTemplate.create',
      'shotTemplate.update',
      'shotTemplate.delete',
    ]);
  });

  it('reads and writes full preset tracks for visual nodes', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(getTool('canvas.readNodePresetTracks', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
    })).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        presetTracks: createEmptyPresetTrackSet(),
      },
    });

    await expect(getTool('canvas.writeNodePresetTracks', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      intensity: 120,
      entries: [
        { presetId: 'camera-push-in', intensity: 12.6, direction: 'left' },
      ],
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        nodeId: 'image-1',
        category: 'camera',
        track: expect.objectContaining({
          intensity: 100,
          entries: [
            expect.objectContaining({
              presetId: 'camera-push-in',
              intensity: 13,
              direction: 'left',
            }),
          ],
        }),
      }),
    });
  });

  it('adds, updates, moves, and removes single preset entries', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const addResult = await getTool('canvas.addPresetTrackEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      presetId: 'camera-push-in',
      intensity: 80,
    });
    expect(addResult).toEqual({
      success: true,
      data: expect.objectContaining({
        nodeId: 'image-1',
        category: 'camera',
        entry: expect.objectContaining({
          presetId: 'camera-push-in',
          intensity: 80,
        }),
      }),
    });

    await getTool('canvas.addPresetTrackEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      presetId: 'camera-crane',
    });
    const track = ((canvas.nodes[0].data as { presetTracks: PresetTrackSet }).presetTracks.camera);
    const [firstEntry, secondEntry] = track.entries;

    await expect(getTool('canvas.updatePresetTrackEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      entryId: firstEntry.id,
      changes: { intensity: 10, direction: 'right', presetId: 'camera-dolly' },
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', category: 'camera', entryId: firstEntry.id },
    });

    await expect(getTool('canvas.movePresetTrackEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      entryId: secondEntry.id,
      direction: 'up',
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', category: 'camera', entryId: secondEntry.id, direction: 'up' },
    });
    const movedTrack = ((canvas.nodes[0].data as { presetTracks: PresetTrackSet }).presetTracks.camera);
    expect(movedTrack.entries[0]?.id).toBe(secondEntry.id);
    expect(movedTrack.entries[1]).toEqual(expect.objectContaining({
      id: firstEntry.id,
      presetId: 'camera-dolly',
      intensity: 10,
      direction: 'right',
      order: 1,
    }));

    await expect(getTool('canvas.removePresetTrackEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      entryId: firstEntry.id,
    })).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', category: 'camera', entryId: firstEntry.id },
    });
    const removedTrack = ((canvas.nodes[0].data as { presetTracks: PresetTrackSet }).presetTracks.camera);
    expect(removedTrack.entries).toHaveLength(1);
  });

  it('applies templates, reports empty tracks, and creates custom presets', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-1');
    vi.spyOn(Date, 'now').mockReturnValue(123);

    await expect(getTool('canvas.applyShotTemplate', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      templateName: 'sweep',
    })).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        templateId: 'tmpl-1',
        templateName: 'Cinematic Sweep',
        appliedCategories: ['camera'],
      },
    });
    expect((canvas.nodes[0].data as Record<string, unknown>).appliedShotTemplateId).toBe('tmpl-1');

    await expect(getTool('canvas.autoFillEmptyTracks', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        nodeId: 'image-1',
        nodeType: 'image',
        prompt: 'A lone samurai at dusk',
        characterRefs: [{ characterId: 'char-1', loadoutId: 'look-1' }],
        locationRefs: [{ locationId: 'loc-1' }],
        filledCategories: ['camera'],
      }),
    });

    await expect(getTool('canvas.createCustomPreset', deps).execute({
      name: 'Dreamy Blur',
      category: 'look',
      description: 'Soft dreamlike atmosphere',
      prompt: 'dreamy blur and glow',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'custom-uuid-1',
        category: 'look',
        name: 'Dreamy Blur',
        createdAt: 123,
        updatedAt: 123,
      }),
    });
  });

  it('rejects invalid preset inputs and unsupported nodes', async () => {
    const deps = createDeps();

    await expect(getTool('canvas.writeNodePresetTracks', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      entries: [{ presetId: '' }],
    })).resolves.toEqual({
      success: false,
      error: 'entries[0].presetId is required',
    });
    await expect(getTool('canvas.updatePresetTrackEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      entryId: 'missing',
      changes: 'bad',
    })).resolves.toEqual({
      success: false,
      error: 'changes is required',
    });
    await expect(getTool('canvas.readNodePresetTracks', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
    })).resolves.toEqual({
      success: false,
      error: 'Node type "text" does not support presets',
    });
    await expect(getTool('canvas.applyShotTemplate', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      templateName: 'missing',
    })).resolves.toEqual({
      success: false,
      error: 'Shot template "missing" not found. Available: Cinematic Sweep',
    });
  });
});

describe('shotTemplate.list', () => {
  it('lists all shot templates', async () => {
    const deps = createDeps();
    const result = await getTool('shotTemplate.list', deps).execute({});
    expect((result as { success: boolean }).success).toBe(true);
    const data = (result as { success: true; data: { total: number; templates: unknown[] } }).data;
    expect(data.total).toBeGreaterThan(0);
  });

  it('filters by query', async () => {
    const deps = createDeps();
    const result = await getTool('shotTemplate.list', deps).execute({ query: 'dramatic' });
    expect((result as { success: boolean }).success).toBe(true);
    const data = (result as { success: true; data: { total: number } }).data;
    expect(data.total).toBe(0);
  });
});

describe('shotTemplate.create', () => {
  it('creates a custom shot template', async () => {
    const deps = createDeps();
    const result = await getTool('shotTemplate.create', deps).execute({
      name: 'test-template',
      description: 'A test template',
      entries: [
        { category: 'camera', presetId: 'builtin-camera-dolly-in', intensity: 80 },
        { category: 'scene', presetId: 'builtin-scene-low-key', intensity: 70 },
      ],
    });
    expect((result as { success: boolean }).success).toBe(true);
    const data = (result as { success: true; data: { name: string; categories: string[] } }).data;
    expect(data.name).toBe('test-template');
    expect(data.categories).toContain('camera');
    expect(data.categories).toContain('scene');
    expect(deps.saveShotTemplate).toHaveBeenCalled();
  });

  it('rejects empty entries', async () => {
    const deps = createDeps();
    const result = await getTool('shotTemplate.create', deps).execute({
      name: 'test-template',
      description: 'A test template',
      entries: [],
    });
    expect((result as { success: boolean }).success).toBe(false);
  });
});

describe('shotTemplate.update', () => {
  it('rejects built-in templates', async () => {
    const deps = createDeps();
    const result = await getTool('shotTemplate.update', deps).execute({ templateId: 'tmpl-1' });
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe('Cannot modify built-in templates.');
  });
});

describe('shotTemplate.delete', () => {
  it('rejects deletion of built-in templates', async () => {
    const deps = createDeps();
    const result = await getTool('shotTemplate.delete', deps).execute({ templateId: 'tmpl-1' });
    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { success: false; error: string }).error).toBe('Cannot delete built-in templates.');
  });

  it('calls deleteShotTemplate for custom templates', async () => {
    const deps = createDeps();
    vi.mocked(deps.listShotTemplates).mockResolvedValueOnce([
      { id: 'custom-tmpl-1', name: 'My Custom', description: 'custom', builtIn: false, tracks: {} },
    ]);
    const result = await getTool('shotTemplate.delete', deps).execute({ templateId: 'custom-tmpl-1' });
    expect((result as { success: boolean }).success).toBe(true);
    expect(deps.deleteShotTemplate).toHaveBeenCalledWith('custom-tmpl-1');
  });
});
