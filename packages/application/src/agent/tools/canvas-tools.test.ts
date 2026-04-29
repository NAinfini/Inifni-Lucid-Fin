import { describe, expect, it, vi } from 'vitest';
import {
  BUILT_IN_SHOT_TEMPLATES,
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type PresetDefinition,
  type PresetTrackSet,
} from '@lucid-fin/contracts';
import { createCanvasTools, type CanvasToolDeps } from './canvas-tools.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'text-1',
        type: 'text',
        title: 'Text 1',
        position: { x: 10, y: 20 },
        data: { content: 'hello' },
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'image-1',
        type: 'image',
        title: 'Image 1',
        position: { x: 50, y: 80 },
        data: {
          status: 'empty',
          variants: [],
          selectedVariantIndex: 0,
          presetTracks: createEmptyPresetTrackSet(),
        },
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'backdrop-1',
        type: 'backdrop',
        title: 'Backdrop 1',
        position: { x: 120, y: 140 },
        data: {
          color: '#111111',
          opacity: 50,
          collapsed: false,
          borderStyle: 'solid',
          titleSize: 'md',
          lockChildren: false,
        },
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

function createDeps(canvas: Canvas): CanvasToolDeps {
  const store = new Map<string, Canvas>([[canvas.id, canvas]]);
  return {
    getCanvas: vi.fn(async (canvasId: string) => {
      const item = store.get(canvasId);
      if (!item) throw new Error(`Canvas not found: ${canvasId}`);
      return item;
    }),
    deleteCanvas: vi.fn(async (canvasId: string) => {
      if (!store.has(canvasId)) throw new Error(`Canvas not found: ${canvasId}`);
      store.delete(canvasId);
    }),
    addNode: vi.fn(async (canvasId: string, node: CanvasNode) => {
      const current = store.get(canvasId);
      if (!current) throw new Error(`Canvas not found: ${canvasId}`);
      current.nodes.push(node);
      current.updatedAt = Date.now();
    }),
    moveNode: vi.fn(
      async (canvasId: string, nodeId: string, position: { x: number; y: number }) => {
        const current = store.get(canvasId);
        if (!current) throw new Error(`Canvas not found: ${canvasId}`);
        const node = current.nodes.find((entry) => entry.id === nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);
        node.position = position;
        node.updatedAt = Date.now();
      },
    ),
    renameNode: vi.fn(async (canvasId: string, nodeId: string, title: string) => {
      const current = store.get(canvasId);
      if (!current) throw new Error(`Canvas not found: ${canvasId}`);
      const node = current.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      node.title = title;
      node.updatedAt = Date.now();
    }),
    connectNodes: vi.fn(async (canvasId: string, edge: CanvasEdge) => {
      const current = store.get(canvasId);
      if (!current) throw new Error(`Canvas not found: ${canvasId}`);
      current.edges.push(edge);
    }),
    setNodePresets: vi.fn(
      async (canvasId: string, nodeId: string, presetTracks: PresetTrackSet) => {
        const current = store.get(canvasId);
        if (!current) throw new Error(`Canvas not found: ${canvasId}`);
        const node = current.nodes.find((entry) => entry.id === nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);
        (node.data as { presetTracks?: PresetTrackSet }).presetTracks = presetTracks;
      },
    ),
    renameCanvas: vi.fn(async (canvasId: string, name: string) => {
      const current = store.get(canvasId);
      if (!current) throw new Error(`Canvas not found: ${canvasId}`);
      current.name = name;
      current.updatedAt = Date.now();
    }),
    layoutNodes: vi.fn(async () => undefined),
    triggerGeneration: vi.fn(async () => undefined),
    cancelGeneration: vi.fn(async () => undefined),
    deleteNode: vi.fn(async (canvasId: string, nodeId: string) => {
      const current = store.get(canvasId);
      if (!current) throw new Error(`Canvas not found: ${canvasId}`);
      current.nodes = current.nodes.filter((entry) => entry.id !== nodeId);
      current.edges = current.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      );
      current.updatedAt = Date.now();
    }),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(
      async (canvasId: string, nodeId: string, data: Record<string, unknown>) => {
        const current = store.get(canvasId);
        if (!current) throw new Error(`Canvas not found: ${canvasId}`);
        const node = current.nodes.find((entry) => entry.id === nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);
        Object.assign(node.data as Record<string, unknown>, data);
        node.updatedAt = Date.now();
      },
    ),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset: PresetDefinition) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    importWorkflow: vi.fn(async () => canvas),
    exportWorkflow: vi.fn(async () => '{}'),
    setNodeColorTag: vi.fn(async () => undefined),
    toggleSeedLock: vi.fn(async () => undefined),
    selectVariant: vi.fn(async () => undefined),
    estimateCost: vi.fn(async () => ({
      totalEstimatedCost: 0,
      currency: 'USD',
      nodeCosts: [],
    })),
    addNote: vi.fn(async () => ({
      id: 'note-1',
      content: 'test',
      createdAt: 1,
      updatedAt: 1,
    })),
    getRecentLogs: vi.fn(async () => []),
    updateNote: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    undo: vi.fn(async () => undefined),
    redo: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: CanvasToolDeps) {
  const tool = createCanvasTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool ${name}`);
  return tool;
}

describe('createCanvasTools', () => {
  it('addNode creates node with correct defaults', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const result = await getTool('canvas.addNode', deps).execute({
      canvasId: 'canvas-1',
      type: 'image',
      title: 'Generated Image',
      position: { x: 100, y: 200 },
    });

    expect(result.success).toBe(true);
    const node = canvas.nodes.at(-1);
    expect(node).toEqual(
      expect.objectContaining({
        type: 'image',
        title: 'Generated Image',
        bypassed: false,
        locked: false,
        position: { x: 100, y: 200 },
      }),
    );
    expect(node?.data).toEqual(
      expect.objectContaining({
        status: 'empty',
        variants: [],
        selectedVariantIndex: 0,
      }),
    );
  });

  it('updateNodes moves node position via setNodeLayout', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const result = await getTool('canvas.setNodeLayout', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
      set: { position: { x: 220, y: 330 } },
    });

    expect(result).toEqual({
      success: true,
      data: { nodeId: 'text-1', updated: { position: { x: 220, y: 330 } } },
    });
    expect(deps.moveNode).toHaveBeenCalledWith('canvas-1', 'text-1', { x: 220, y: 330 });
  });

  it('updateNodes renames node via title field', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const result = await getTool('canvas.updateNodes', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'text-1',
      set: { title: 'Narration' },
    });

    expect(result).toEqual({
      success: true,
      data: { nodeId: 'text-1', updated: { title: 'Narration' } },
    });
    expect(deps.renameNode).toHaveBeenCalledWith('canvas-1', 'text-1', 'Narration');
  });

  it('deleteCanvas removes the canvas by ID', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const result = await getTool('canvas.deleteCanvas', deps).execute({
      canvasId: 'canvas-1',
    });

    expect(result).toEqual({ success: true, data: { canvasId: 'canvas-1' } });
    expect(deps.deleteCanvas).toHaveBeenCalledWith('canvas-1');
  });

  it('connectNodes creates edge with generated ID', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const result = await getTool('canvas.connectNodes', deps).execute({
      canvasId: 'canvas-1',
      sourceId: 'text-1',
      targetId: 'image-1',
      label: 'prompt',
    });

    expect(result.success).toBe(true);
    expect(canvas.edges).toHaveLength(1);
    expect(canvas.edges[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        source: 'text-1',
        target: 'image-1',
        data: { label: 'prompt', status: 'idle' },
      }),
    );
  });

  it('getState returns full canvas', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const result = await getTool('canvas.getState', deps).execute({ canvasId: 'canvas-1' });

    expect(result).toEqual({
      success: true,
      data: {
        id: 'canvas-1',
        name: 'Canvas',
        nodeCount: 3,
        edgeCount: 0,
        edges: [],
      },
    });
  });

  it('layout repositions nodes with correct spacing', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const horizontal = await getTool('canvas.layout', deps).execute({
      canvasId: 'canvas-1',
      direction: 'horizontal',
    });

    expect(horizontal.success).toBe(true);
    expect(canvas.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(canvas.nodes[1].position).toEqual({ x: 300, y: 0 });

    const vertical = await getTool('canvas.layout', deps).execute({
      canvasId: 'canvas-1',
      direction: 'vertical',
    });

    expect(vertical.success).toBe(true);
    expect(canvas.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(canvas.nodes[1].position).toEqual({ x: 0, y: 250 });
  });

  it('generate delegates to trigger function', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    // Mock triggerGeneration to also mark the node as done (since generate now polls)
    deps.triggerGeneration = vi.fn(async (_canvasId: string, nodeId: string) => {
      const node = canvas.nodes.find((n) => n.id === nodeId);
      if (node) (node.data as Record<string, unknown>).status = 'done';
    });

    const result = await getTool('canvas.generate', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      providerId: 'runway',
      variantCount: 4,
      wait: true,
    });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).nodeId).toBe('image-1');
    expect((result.data as Record<string, unknown>).status).toBe('done');
    expect(deps.triggerGeneration).toHaveBeenCalledWith('canvas-1', 'image-1', 'runway', 4);
  });

  it('returns error for missing canvas', async () => {
    const deps = createDeps(createCanvas());

    const result = await getTool('canvas.getState', deps).execute({ canvasId: 'missing' });

    expect(result).toEqual({ success: false, error: 'Canvas not found: missing' });
  });

  it('returns error for missing node', async () => {
    const deps = createDeps(createCanvas());

    const result = await getTool('canvas.setNodeLayout', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'missing-node',
      set: { position: { x: 1, y: 2 } },
    });

    expect(result).toEqual({ success: false, error: 'Node not found: missing-node' });
  });

  it('updates backdrop style fields through updateBackdrop', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.updateBackdrop', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'backdrop-1',
        set: {
          opacity: 72,
          color: '#ff00aa',
          borderStyle: 'dotted',
          titleSize: 'lg',
          lockChildren: true,
          toggleCollapse: true,
        },
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'backdrop-1',
        opacity: 72,
        color: '#ff00aa',
        borderStyle: 'dotted',
        titleSize: 'lg',
        lockChildren: true,
        collapsed: true,
      },
    });

    expect(canvas.nodes[2].data).toEqual(
      expect.objectContaining({
        color: '#ff00aa',
        opacity: 72,
        collapsed: true,
        borderStyle: 'dotted',
        titleSize: 'lg',
        lockChildren: true,
      }),
    );
  });

  it('manages single preset track entries on image nodes', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    const addResult = await getTool('canvas.addPresetEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      presetId: 'builtin-camera-push-in',
      intensity: 88,
    });

    expect(addResult.success).toBe(true);
    const tracksAfterAdd = (canvas.nodes[1].data as { presetTracks: PresetTrackSet }).presetTracks;
    expect(tracksAfterAdd.camera.entries).toHaveLength(1);
    const entryId = tracksAfterAdd.camera.entries[0].id;

    await expect(
      getTool('canvas.updatePresetEntry', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        category: 'camera',
        entryId,
        changes: { intensity: 60, direction: 'left' },
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        category: 'camera',
        entryId,
      },
    });

    await getTool('canvas.addPresetEntry', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      category: 'camera',
      presetId: 'builtin-camera-crane-up',
    });
    const tracksAfterSecondAdd = (canvas.nodes[1].data as { presetTracks: PresetTrackSet })
      .presetTracks;
    const secondEntryId = tracksAfterSecondAdd.camera.entries[1].id;

    await expect(
      getTool('canvas.removePresetEntry', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        category: 'camera',
        entryId,
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        nodeId: 'image-1',
        category: 'camera',
        entryId,
      },
    });

    const tracksAfterRemove = (canvas.nodes[1].data as { presetTracks: PresetTrackSet })
      .presetTracks;
    expect(tracksAfterRemove.camera.entries).toHaveLength(1);
    expect(tracksAfterRemove.camera.entries[0].id).toBe(secondEntryId);
    expect(tracksAfterRemove.camera.entries[0].order).toBe(0);
  });

  it('applyShotTemplate stores applied template metadata on the node', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    vi.mocked(deps.listShotTemplates).mockResolvedValueOnce(BUILT_IN_SHOT_TEMPLATES);

    const result = await getTool('canvas.applyShotTemplate', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      templateName: 'Horror Suspense',
    });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        nodeId: 'image-1',
        templateId: 'builtin-tmpl-horror-suspense',
        templateName: 'Horror Suspense',
      }),
    });
    expect(deps.updateNodeData).toHaveBeenCalledWith('canvas-1', 'image-1', {
      appliedShotTemplateId: 'builtin-tmpl-horror-suspense',
      appliedShotTemplateName: 'Horror Suspense',
    });
    expect(
      (
        canvas.nodes[1]?.data as {
          appliedShotTemplateId?: string;
          appliedShotTemplateName?: string;
        }
      ).appliedShotTemplateId,
    ).toBe('builtin-tmpl-horror-suspense');
    expect(
      (
        canvas.nodes[1]?.data as {
          appliedShotTemplateId?: string;
          appliedShotTemplateName?: string;
        }
      ).appliedShotTemplateName,
    ).toBe('Horror Suspense');
  });

  it('reads recent logs through logger.list', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);
    vi.mocked(deps.getRecentLogs).mockResolvedValueOnce([
      {
        id: 'log-1',
        timestamp: 123,
        level: 'error',
        category: 'generation',
        message: 'Failed: Image 1',
      },
    ]);

    const result = await getTool('logger.list', deps).execute({
      level: 'error',
      category: 'generation',
      limit: 10,
    });

    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 'log-1',
          timestamp: 123,
          level: 'error',
          category: 'generation',
          message: 'Failed: Image 1',
        },
      ],
    });
    expect(deps.getRecentLogs).toHaveBeenCalledWith('error', 'generation', 10);
  });

  describe('canvas.listNodes query and types filter', () => {
    function createCanvasWithNodes(): Canvas {
      return {
        id: 'canvas-1',
        name: 'Canvas',
        nodes: [
          {
            id: 'img-1',
            type: 'image',
            title: 'Sunset Shot',
            position: { x: 0, y: 0 },
            data: {
              prompt: 'golden hour sunset',
              status: 'empty',
              variants: [],
              selectedVariantIndex: 0,
            },
            bypassed: false,
            locked: false,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'vid-1',
            type: 'video',
            title: 'Action Clip',
            position: { x: 300, y: 0 },
            data: {
              prompt: 'fast car chase',
              status: 'empty',
              variants: [],
              selectedVariantIndex: 0,
            },
            bypassed: false,
            locked: false,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'txt-1',
            type: 'text',
            title: 'Scene Notes',
            position: { x: 600, y: 0 },
            data: { content: 'notes about sunset' },
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

    it('returns all nodes when no filter is provided', async () => {
      const canvas = createCanvasWithNodes();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.listNodes', deps).execute({ canvasId: 'canvas-1' });
      expect(result).toMatchObject({ success: true, data: { total: 3 } });
    });

    it('filters by types array (OR-matched)', async () => {
      const canvas = createCanvasWithNodes();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.listNodes', deps).execute({
        canvasId: 'canvas-1',
        types: ['image', 'video'],
      });
      expect(result).toMatchObject({ success: true, data: { total: 2 } });
      const data = (result as { success: true; data: { nodes: { id: string }[] } }).data;
      expect(data.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['img-1', 'vid-1']));
    });

    it('filters by query against title', async () => {
      const canvas = createCanvasWithNodes();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.listNodes', deps).execute({
        canvasId: 'canvas-1',
        query: 'action',
      });
      expect(result).toMatchObject({ success: true, data: { total: 1 } });
      const data = (result as { success: true; data: { nodes: { id: string }[] } }).data;
      expect(data.nodes[0].id).toBe('vid-1');
    });

    it('filters by query against prompt (OR logic)', async () => {
      const canvas = createCanvasWithNodes();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.listNodes', deps).execute({
        canvasId: 'canvas-1',
        query: 'sunset',
      });
      expect(result).toMatchObject({ success: true, data: { total: 1 } });
      const data = (result as { success: true; data: { nodes: { id: string }[] } }).data;
      expect(data.nodes[0].id).toBe('img-1');
    });

    it('combines query and types with AND logic', async () => {
      const canvas = createCanvasWithNodes();
      const deps = createDeps(canvas);
      // types=['image','video'] AND query='sunset' → only img-1 (video has 'fast car' prompt, not 'sunset')
      const result = await getTool('canvas.listNodes', deps).execute({
        canvasId: 'canvas-1',
        types: ['image', 'video'],
        query: 'sunset',
      });
      expect(result).toMatchObject({ success: true, data: { total: 1 } });
      const data = (result as { success: true; data: { nodes: { id: string }[] } }).data;
      expect(data.nodes[0].id).toBe('img-1');
    });

    it('returns empty when query matches nothing', async () => {
      const canvas = createCanvasWithNodes();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.listNodes', deps).execute({
        canvasId: 'canvas-1',
        query: 'xyz123',
      });
      expect(result).toMatchObject({ success: true, data: { total: 0, nodes: [] } });
    });
  });

  describe('canvas.getNode batch support', () => {
    it('single string ID returns single node (backward compat)', async () => {
      const canvas = createCanvas();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.getNode', deps).execute({
        canvasId: 'canvas-1',
        nodeIds: 'text-1',
      });
      expect(result.success).toBe(true);
      expect((result.data as { id: string }).id).toBe('text-1');
    });

    it('array of IDs returns array of nodes', async () => {
      const canvas = createCanvas();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.getNode', deps).execute({
        canvasId: 'canvas-1',
        nodeIds: ['text-1', 'image-1'],
      });
      expect(result.success).toBe(true);
      const nodes = result.data as { id: string }[];
      expect(nodes).toHaveLength(2);
      expect(nodes.map((n) => n.id)).toEqual(['text-1', 'image-1']);
    });

    it('missing ID in batch returns error for first missing', async () => {
      const canvas = createCanvas();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.getNode', deps).execute({
        canvasId: 'canvas-1',
        nodeIds: ['text-1', 'missing-node'],
      });
      expect(result).toEqual({ success: false, error: 'Node not found: missing-node' });
    });
  });

  describe('canvas.batchCreate empty-arg validation (04-19 fake-user-study fix)', () => {
    it('rejects empty args and teaches the model what to send next', async () => {
      const canvas = createCanvas();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.batchCreate', deps).execute({});
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain('canvas.batchCreate');
        expect(result.error).toContain('"nodes"');
        expect(result.error).toContain('must be a non-empty array');
        expect(result.error).toContain('You called it with: {}');
        expect(result.error).toContain('canvas.addNode');
        expect(result.error).toContain('canvas.connectNodes');
        expect(result.errorClass).toBe('validation');
      }
    });

    it('rejects edges-only payload with the same teaching error', async () => {
      const canvas = createCanvas();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.batchCreate', deps).execute({
        canvasId: 'canvas-1',
        edges: [{ fromIndex: 0, toIndex: 1 }],
      });
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toContain('"nodes"');
        expect(result.error).toContain('must be a non-empty array');
        expect(result.error).toContain('canvas.connectNodes');
      }
    });

    it('accepts a minimal valid payload', async () => {
      const canvas = createCanvas();
      const deps = createDeps(canvas);
      const result = await getTool('canvas.batchCreate', deps).execute({
        canvasId: 'canvas-1',
        nodes: [{ type: 'text', title: 'Scene 1', content: 'Opening' }],
      });
      expect(result.success).toBe(true);
    });
  });
});
