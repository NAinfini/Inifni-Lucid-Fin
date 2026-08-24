import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasEdge,
  type CanvasPatch,
  type PromptAssemblyOutputV1,
  type PromptAssemblyRecord,
} from '@lucid-fin/contracts';
import { createCanvasGenerationTools } from './canvas-generation-tools.js';
import type { CanvasToolDeps, MediaTaskView } from './canvas-tool-utils.js';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'text-1',
        type: 'text',
        title: 'Text',
        position: { x: 0, y: 0 },
        data: { content: 'hello' },
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

function preparedAssembly(nodeId: string, purpose: PromptAssemblyRecord['purpose'] = 'initial') {
  const assemblyId = `assembly-${nodeId}`;
  const input = {
    version: 1 as const,
    assemblyId,
    canvasId: 'canvas-1',
    nodeId,
    nodeUpdatedAt: 1,
    mediaType: nodeId.startsWith('video') ? ('video' as const) : ('image' as const),
    mode: nodeId.startsWith('video') ? ('text-to-video' as const) : ('text-to-image' as const),
    purpose,
    authority: { kind: 'canvas-draft' as const },
    sources: [
      {
        sourceId: 'node-prompt',
        sourceHash: 'source-hash',
        kind: 'node-prompt' as const,
        label: 'Node prompt',
        content: 'Scene intent',
        required: true,
      },
    ],
    conditioningManifest: [],
    providerProfile: { providerId: 'provider', capabilities: [] },
    hostConstraints: { immutable: ['providerId'] },
    inputHash: 'input-hash',
  };
  return {
    id: assemblyId,
    canvasId: 'canvas-1',
    nodeId,
    nodeUpdatedAt: 1,
    mediaType: input.mediaType,
    mode: input.mode,
    purpose,
    inputHash: input.inputHash,
    input,
    status: 'prepared' as const,
    rowVersion: 0,
    createdAt: 1,
    updatedAt: 1,
  } satisfies PromptAssemblyRecord;
}

function assemblyOutput(nodeId: string): PromptAssemblyOutputV1 {
  const prepared = preparedAssembly(nodeId);
  return {
    version: 1,
    assemblyId: prepared.id,
    inputHash: prepared.inputHash,
    finalPrompt: `Final prompt for ${nodeId}`,
    sourceDecisions: prepared.input.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      disposition: 'applied',
    })),
    summary: 'Reconciled all sources.',
    warnings: [],
  };
}

function mediaTask(nodeId: string, status = 'running'): MediaTaskView {
  return {
    id: `task-list-${nodeId}`,
    canvasId: 'canvas-1',
    nodeId,
    status,
    taskStatus: status === 'cancelled' ? 'cancelled' : 'awaiting_prompt_assembly',
    progress: 0,
    promptAssembly: preparedAssembly(nodeId),
  };
}

function applyCanvasPatch(canvas: Canvas, patch: CanvasPatch): void {
  if (patch.nameChange !== undefined) canvas.name = patch.nameChange;

  const removedNodeIds = new Set(patch.removedNodeIds ?? []);
  const removedEdgeIds = new Set(patch.removedEdgeIds ?? []);
  if (removedNodeIds.size > 0) {
    canvas.nodes = canvas.nodes.filter((node) => !removedNodeIds.has(node.id));
    canvas.edges = canvas.edges.filter(
      (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    );
  }
  if (removedEdgeIds.size > 0) {
    canvas.edges = canvas.edges.filter((edge) => !removedEdgeIds.has(edge.id));
  }

  const nodesById = new Map(canvas.nodes.map((node) => [node.id, node]));
  for (const update of patch.updatedNodes ?? []) {
    const node = nodesById.get(update.id);
    if (!node) throw new Error(`Node not found: ${update.id}`);
    Object.assign(node, update.changes);
  }
  canvas.nodes.push(...(patch.addedNodes ?? []));

  const edgesById = new Map(canvas.edges.map((edge) => [edge.id, edge]));
  for (const update of patch.updatedEdges ?? []) {
    const edge = edgesById.get(update.id);
    if (!edge) throw new Error(`Edge not found: ${update.id}`);
    Object.assign(edge, update.edge);
  }
  canvas.edges.push(...(patch.addedEdges ?? []));
  canvas.updatedAt = patch.timestamp;
}

function createDeps(canvas = createCanvas()): CanvasToolDeps {
  return {
    getCanvas: vi.fn(async () => canvas),
    patchCanvas: vi.fn(async (_canvasId, patch) => applyCanvasPatch(canvas, patch)),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    renameNode: vi.fn(async () => undefined),
    renameCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async (_canvasId, edge: CanvasEdge) => {
      canvas.edges.push(edge);
    }),
    setNodePresets: vi.fn(async () => undefined),
    layoutNodes: vi.fn(async () => undefined),
    prepareMediaTask: vi.fn(async (input) => mediaTask(input.nodeId)),
    getMediaTask: vi.fn(async (taskListId) => ({ ...mediaTask('image-1'), id: taskListId })),
    getPromptAssembly: vi.fn(async (assemblyId) => ({
      ...preparedAssembly('image-1'),
      id: assemblyId,
      input: { ...preparedAssembly('image-1').input, assemblyId },
    })),
    submitMediaPrompt: vi.fn(async (input) => ({
      ...mediaTask('image-1'),
      id: input.taskListId,
      taskStatus: 'awaiting_provider',
    })),
    cancelMediaTask: vi.fn(async (taskListId) => ({
      ...mediaTask('image-1', 'cancelled'),
      id: taskListId,
    })),
    retryMediaEvaluation: vi.fn(async (taskListId) => ({
      ...mediaTask('image-1'),
      id: taskListId,
      taskStatus: 'evaluating',
    })),
    deleteNode: vi.fn(async (_canvasId, nodeId) => {
      canvas.nodes = canvas.nodes.filter((node) => node.id !== nodeId);
      canvas.edges = canvas.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      );
    }),
    deleteEdge: vi.fn(async (_canvasId, edgeId) => {
      canvas.edges = canvas.edges.filter((edge) => edge.id !== edgeId);
    }),
    updateNodeData: vi.fn(async (_canvasId, nodeId, data) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      Object.assign(node.data as Record<string, unknown>, data);
    }),
    clearNodeDataFields: vi.fn(async (_canvasId, nodeId, fields) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      const data = node.data as Record<string, unknown>;
      for (const field of fields) delete data[field];
    }),
    preflightResolution: vi.fn(async () => ({
      supported: true,
      plan: {
        providerId: 'test-image',
        mediaType: 'image',
        source: 'node',
        requested: { mode: 'tier', tier: '2K' },
        tier: '2K',
        outputKnown: false,
      },
      currency: 'USD',
      estimatedCostUsd: 0.04,
      warnings: ['Provider does not guarantee exact output pixels'],
    })),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    importCanvasDocument: vi.fn(async () => canvas),
    exportCanvasDocument: vi.fn(async () => '{}'),
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
      nodeCosts: (nodeIds ?? ['image-1', 'video-1', 'audio-1']).map((nodeId) => ({
        nodeId,
        estimatedCost: 1,
      })),
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

describe('createCanvasGenerationTools', () => {
  it('defines the expected generation tool suite', () => {
    const deps = createDeps();

    expect(createCanvasGenerationTools(deps).map((tool) => tool.name)).toEqual([
      'canvas.generation',
      'canvas.updateNodes',
      'canvas.setNodeLayout',
      'canvas.configureNode',
      'canvas.setMediaParams',
      'provider.resolveResolution',
      'canvas.selectVariant',
      'canvas.previewPrompt',
      'canvas.addNote',
      'canvas.updateNote',
      'canvas.deleteNote',
      'canvas.deleteNode',
      'canvas.manageEdge',
      'canvas.setVideoFrames',
      'canvas.setNodeRefs',
    ]);
  });

  it('prepares a durable media Task List and returns its Prompt Assembly', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        providerId: 'custom-image',
        providerConfig: { baseUrl: 'https://provider.example/v1', model: 'image-model' },
        intent: 'Make the afternoon light warmer',
        parentAttemptId: 'attempt-1',
        feedback: 'Keep the composition, brighten the subject.',
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        taskListId: 'task-list-image-1',
        promptAssembly: preparedAssembly('image-1'),
      },
    });
    expect(deps.prepareMediaTask).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      providerId: 'custom-image',
      providerConfig: { baseUrl: 'https://provider.example/v1', model: 'image-model' },
      intent: 'Make the afternoon light warmer',
      parentAttemptId: 'attempt-1',
      feedback: 'Keep the composition, brighten the subject.',
    });
  });

  it('submits, reads, and cancels through taskListId', async () => {
    const deps = createDeps();
    const assembly = assemblyOutput('image-1');

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'submit',
        taskListId: 'task-list-image-1',
        assemblyId: assembly.assemblyId,
        assembly,
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        ...mediaTask('image-1'),
        id: 'task-list-image-1',
        taskStatus: 'awaiting_provider',
      },
    });
    expect(deps.submitMediaPrompt).toHaveBeenCalledWith({
      taskListId: 'task-list-image-1',
      assemblyId: assembly.assemblyId,
      assembly,
    });

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'status',
        taskListId: 'task-list-image-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: { ...mediaTask('image-1'), id: 'task-list-image-1' },
    });
    expect(deps.getMediaTask).toHaveBeenCalledWith('task-list-image-1');

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'cancel',
        taskListId: 'task-list-image-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: { ...mediaTask('image-1', 'cancelled'), id: 'task-list-image-1' },
    });
    expect(deps.cancelMediaTask).toHaveBeenCalledWith('task-list-image-1');

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'retryEvaluation',
        taskListId: 'task-list-image-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: { ...mediaTask('image-1'), id: 'task-list-image-1', taskStatus: 'evaluating' },
    });
    expect(deps.retryMediaEvaluation).toHaveBeenCalledWith('task-list-image-1');

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'inspectAssembly',
        assemblyId: 'assembly-image-1',
      }),
    ).resolves.toMatchObject({
      success: true,
      data: { id: 'assembly-image-1', canvasId: 'canvas-1', nodeId: 'image-1' },
    });
    expect(deps.getPromptAssembly).toHaveBeenCalledWith('assembly-image-1');
  });

  it('uses previewPrompt as the prepare alias', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.previewPrompt', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'video-1',
        intent: 'Slow orbit around the subject',
      }),
    ).resolves.toEqual({
      success: true,
      data: { taskListId: 'task-list-video-1', promptAssembly: preparedAssembly('video-1') },
    });
    expect(deps.prepareMediaTask).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      nodeId: 'video-1',
      intent: 'Slow orbit around the subject',
    });
  });

  it('requires paired refinement values and complete safe provider config', async () => {
    const deps = createDeps();
    const generation = getTool('canvas.generation', deps);

    await expect(
      generation.execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        parentAttemptId: 'attempt-1',
      }),
    ).resolves.toMatchObject({ success: false, errorClass: 'validation' });
    await expect(
      generation.execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        providerConfig: { baseUrl: 'https://provider.example/v1' },
      }),
    ).resolves.toMatchObject({ success: false, errorClass: 'validation' });
    await expect(
      generation.execute({
        action: 'prepare',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        providerConfig: {
          baseUrl: 'https://provider.example/v1',
          model: 'image-model',
          apiKey: 'never-persist-this',
        },
      }),
    ).resolves.toMatchObject({ success: false, errorClass: 'validation' });
    expect(deps.prepareMediaTask).not.toHaveBeenCalled();
  });

  it('exposes only durable Task List actions and rejects legacy actions', async () => {
    const deps = createDeps();
    const generateTool = getTool('canvas.generation', deps);

    expect(generateTool.inputSchema.properties.action).toEqual(
      expect.objectContaining({
        enum: [
          'prepare',
          'submit',
          'inspectAssembly',
          'status',
          'cancel',
          'retryEvaluation',
          'estimate',
        ],
      }),
    );
    expect(generateTool.inputSchema.properties).not.toHaveProperty('wait');
    expect(generateTool.inputSchema.properties).not.toHaveProperty('variantCount');

    await expect(generateTool.execute({ action: 'start' })).resolves.toEqual({
      success: false,
      error:
        'Unknown action "start". Must be one of: prepare, submit, inspectAssembly, status, cancel, retryEvaluation, estimate.',
    });
  });

  it('delegates content/prompt updates via updateNodes and selection via selectVariant', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    // updateNodes: set prompt on media node
    await expect(
      getTool('canvas.updateNodes', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        set: { prompt: 'new image prompt' },
      }),
    ).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', updated: { prompt: 'new image prompt' } },
    });

    // updateNodes: set content on text node
    await expect(
      getTool('canvas.updateNodes', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'text-1',
        set: { content: 'rewritten' },
      }),
    ).resolves.toEqual({
      success: true,
      data: { nodeId: 'text-1', updated: { content: 'rewritten' } },
    });

    // selectVariant
    await expect(
      getTool('canvas.selectVariant', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        index: 2.4,
      }),
    ).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', index: 2 },
    });
  });

  it('commits a large batch with one canvas read and one atomic patch', async () => {
    const canvas = createCanvas();
    canvas.nodes = Array.from({ length: 1_000 }, (_, index) => ({
      id: `text-${index}`,
      type: 'text' as const,
      title: `Text ${index}`,
      position: { x: index, y: 0 },
      data: { content: `old-${index}` },
      bypassed: false,
      locked: false,
      createdAt: 1,
      updatedAt: 1,
    }));
    canvas.edges = [];
    const deps = createDeps(canvas);

    const result = await getTool('canvas.updateNodes', deps).execute({
      canvasId: 'canvas-1',
      nodes: canvas.nodes.map((node, index) => ({
        nodeId: node.id,
        set: { content: `new-${index}` },
      })),
    });

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(deps.getCanvas).toHaveBeenCalledTimes(1);
    expect(deps.patchCanvas).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.patchCanvas).mock.calls[0]?.[1].updatedNodes).toHaveLength(1_000);
    expect((canvas.nodes[999].data as { content: string }).content).toBe('new-999');
  });

  it('sets provider via configureNode', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.configureNode', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'video-1',
        set: { providerId: 'kling-v1' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ nodeId: 'video-1' }),
      }),
    );
    expect((canvas.nodes[2].data as Record<string, unknown>).providerId).toBe('kling-v1');
  });

  it('sets reference-image purpose only on image nodes', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.configureNode', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        set: { generationPurpose: 'reference-image' },
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    expect((canvas.nodes[1].data as Record<string, unknown>).generationPurpose).toBe(
      'reference-image',
    );

    await expect(
      getTool('canvas.configureNode', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'video-1',
        set: { generationPurpose: 'reference-image' },
      }),
    ).resolves.toEqual({
      success: false,
      error: 'generationPurpose is only valid for image nodes',
    });
  });

  it('sets seed and variantCount via configureNode', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.configureNode', deps).execute({
        canvasId: 'canvas-1',
        nodeIds: ['image-1', 'audio-1'],
        set: { seed: 9.6 },
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    expect((canvas.nodes[1].data as Record<string, unknown>).seed).toBe(10);
    expect((canvas.nodes[3].data as Record<string, unknown>).seed).toBe(10);

    // configureNode: set variantCount
    await expect(
      getTool('canvas.configureNode', deps).execute({
        canvasId: 'canvas-1',
        nodeIds: ['image-1', 'video-1'],
        set: { variantCount: 4 },
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });

  it('validates variantCount via configureNode', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.configureNode', deps).execute({
        canvasId: 'canvas-1',
        nodeIds: ['image-1'],
        set: { variantCount: 3 },
      }),
    ).resolves.toEqual({
      success: false,
      error: 'variantCount must be one of 1, 2, 4, 9, or 25',
    });
  });

  it('estimates cost, manages notes, and supports undo/redo', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.generation', deps).execute({
        action: 'estimate',
        canvasId: 'canvas-1',
        nodeIds: ['image-1', 'video-1'],
      }),
    ).resolves.toEqual({
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
    await expect(
      getTool('canvas.addNote', deps).execute({
        canvasId: 'canvas-1',
        content: ' keep spacing ',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'note-2', content: ' keep spacing ', createdAt: 2, updatedAt: 2 },
    });
    await expect(
      getTool('canvas.updateNote', deps).execute({
        canvasId: 'canvas-1',
        noteId: 'note-1',
        content: 'updated',
      }),
    ).resolves.toEqual({
      success: true,
      data: { noteId: 'note-1', content: 'updated' },
    });
    await expect(
      getTool('canvas.deleteNote', deps).execute({
        canvasId: 'canvas-1',
        noteId: 'note-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: { noteId: 'note-1' },
    });
  });

  it('performs edge and node mutations', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.manageEdge', deps).execute({
        action: 'swap',
        canvasId: 'canvas-1',
        edgeId: 'edge-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'edge-1',
        source: 'image-1',
        target: 'text-1',
        sourceHandle: 'left-50',
        targetHandle: 'tgt-right-50',
      }),
    });

    await expect(
      getTool('canvas.manageEdge', deps).execute({
        action: 'delete',
        canvasId: 'canvas-1',
        edgeId: 'edge-2',
      }),
    ).resolves.toEqual({
      success: true,
      data: { edgeId: 'edge-2' },
    });

    await expect(
      getTool('canvas.manageEdge', deps).execute({
        action: 'disconnect',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: { nodeId: 'image-1', edgeIds: ['edge-1'], count: 1 },
    });

    await expect(
      getTool('canvas.deleteNode', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'audio-1',
      }),
    ).resolves.toEqual({
      success: true,
      data: { nodeId: 'audio-1' },
    });
  });

  it('sets video params via setMediaParams', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setMediaParams', deps).execute({
        mediaType: 'video',
        canvasId: 'canvas-1',
        nodeId: 'video-1',
        set: { duration: 5, audio: true, quality: 'pro' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ nodeId: 'video-1' }),
      }),
    );
  });

  it('sets image params via setMediaParams', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setMediaParams', deps).execute({
        mediaType: 'image',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        set: { width: 1920, height: 1080 },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ nodeId: 'image-1' }),
      }),
    );
    expect(canvas.nodes[1].data).toEqual(
      expect.objectContaining({
        width: 1920,
        height: 1080,
        resolutionIntent: { mode: 'exact', width: 1920, height: 1080 },
      }),
    );
  });

  it('sets provider tiers, clears legacy pixels, and restores Canvas inheritance', async () => {
    const canvas = createCanvas();
    let imageData = canvas.nodes[1].data as Record<string, unknown>;
    Object.assign(imageData, { width: 1024, height: 1024 });
    const deps = createDeps(canvas);
    const tool = getTool('canvas.setMediaParams', deps);

    await expect(
      tool.execute({
        mediaType: 'image',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        set: { resolution: { mode: 'tier', tier: '2K', aspectRatio: '16:9' } },
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    imageData = canvas.nodes[1].data as Record<string, unknown>;
    expect(imageData.resolutionIntent).toEqual({
      mode: 'tier',
      tier: '2K',
      aspectRatio: '16:9',
    });
    expect(imageData).not.toHaveProperty('width');
    expect(imageData).not.toHaveProperty('height');

    await expect(
      tool.execute({
        mediaType: 'image',
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        set: { clearResolutionOverride: true },
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
    imageData = canvas.nodes[1].data as Record<string, unknown>;
    expect(imageData).not.toHaveProperty('resolutionIntent');
  });

  it('preflights a candidate resolution without creating a media Task List', async () => {
    const deps = createDeps();
    const result = await getTool('provider.resolveResolution', deps).execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      resolution: { mode: 'tier', tier: '2K' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ supported: true, estimatedCostUsd: 0.04 }),
      }),
    );
    expect(deps.preflightResolution).toHaveBeenCalledWith('canvas-1', 'image-1', {
      mode: 'tier',
      tier: '2K',
    });
    expect(deps.prepareMediaTask).not.toHaveBeenCalled();
  });

  it('sets video frame references', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setVideoFrames', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'video-1',
        firstFrameNodeId: 'image-1',
        lastFrameAssetHash: 'asset-last',
      }),
    ).resolves.toEqual({
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

  it('rejects setVideoFrames on non-video nodes', async () => {
    const deps = createDeps();

    await expect(
      getTool('canvas.setVideoFrames', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'Node "image-1" type "image" is not a video node',
    });
  });

  it('sets audioType via setMediaParams', async () => {
    const canvas = createCanvas();
    const deps = createDeps(canvas);

    await expect(
      getTool('canvas.setMediaParams', deps).execute({
        mediaType: 'audio',
        canvasId: 'canvas-1',
        nodeId: 'audio-1',
        set: { audioType: 'voice' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ nodeId: 'audio-1' }),
      }),
    );
    expect((canvas.nodes[3].data as Record<string, unknown>).audioType).toBe('voice');
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.patchCanvas).mockRejectedValueOnce(new Error('edge delete failed'));

    await expect(
      getTool('canvas.manageEdge', deps).execute({
        action: 'delete',
        canvasId: 'canvas-1',
        edgeId: 'edge-1',
      }),
    ).resolves.toEqual({
      success: false,
      error: 'edge delete failed',
    });
  });

  it('requires set object and rejects data fields at top level', async () => {
    const deps = createDeps();

    // Missing set → error
    await expect(
      getTool('canvas.updateNodes', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        prompt: 'this should fail',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('"set" object is required'),
      }),
    );

    // Valid set → success
    await expect(
      getTool('canvas.updateNodes', deps).execute({
        canvasId: 'canvas-1',
        nodeId: 'image-1',
        set: { prompt: 'this works' },
      }),
    ).resolves.toEqual(expect.objectContaining({ success: true }));
  });
});
