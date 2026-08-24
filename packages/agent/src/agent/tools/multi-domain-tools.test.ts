import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasTools,
  type CanvasToolDeps,
  createColorStyleTools,
  createPresetTools,
  createScriptTools,
  createTaskListTools,
} from '../../index.js';
import {
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasPatch,
  type PresetDefinition,
} from '@lucid-fin/contracts';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'image-1',
        type: 'image',
        title: 'Image 1',
        position: { x: 0, y: 0 },
        data: {
          status: 'empty',
          variants: [],
          selectedVariantIndex: 0,
          presetTracks: createEmptyPresetTrackSet(),
          characterRefs: [{ characterId: 'char-1', loadoutId: '' }],
          equipmentRefs: [{ equipmentId: 'eq-1' }],
          locationRefs: [{ locationId: 'loc-1' }],
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

function applyCanvasPatch(canvas: Canvas, patch: CanvasPatch): void {
  for (const update of patch.updatedNodes ?? []) {
    const node = canvas.nodes.find((entry) => entry.id === update.id);
    if (!node) throw new Error(`Node not found: ${update.id}`);
    Object.assign(node, structuredClone(update.changes));
  }
}

function createCanvasDeps(canvas: Canvas): CanvasToolDeps {
  return {
    getCanvas: vi.fn(async () => canvas),
    patchCanvas: vi.fn(async (_canvasId, patch) => applyCanvasPatch(canvas, patch)),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    renameNode: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    layoutNodes: vi.fn(async () => undefined),
    prepareMediaTask: vi.fn(async (input) => ({
      id: 'task-list-1',
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      status: 'running',
      taskStatus: 'awaiting_prompt_assembly',
      progress: 0,
    })),
    getMediaTask: vi.fn(async (id) => ({
      id,
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      status: 'running',
      taskStatus: 'awaiting_prompt_assembly',
      progress: 0,
    })),
    submitMediaPrompt: vi.fn(async (input) => ({
      id: input.taskListId,
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      status: 'running',
      taskStatus: 'awaiting_provider',
      progress: 0,
    })),
    renameCanvas: vi.fn(async (_canvasId: string, name: string) => {
      canvas.name = name;
    }),
    cancelMediaTask: vi.fn(async (id) => ({
      id,
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      status: 'cancelled',
      taskStatus: 'cancelled',
      progress: 0,
    })),
    retryMediaEvaluation: vi.fn(async (id) => ({
      id,
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      status: 'running',
      taskStatus: 'evaluating',
      progress: 0,
    })),
    deleteNode: vi.fn(async () => undefined),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(
      async (_canvasId: string, nodeId: string, data: Record<string, unknown>) => {
        const node = canvas.nodes.find((entry) => entry.id === nodeId);
        if (!node) throw new Error(`Node not found: ${nodeId}`);
        Object.assign(node.data as Record<string, unknown>, data);
      },
    ),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset: PresetDefinition) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    importCanvasDocument: vi.fn(async () => canvas),
    exportCanvasDocument: vi.fn(async () => '{}'),
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

function getTool<
  T extends { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> },
>(tools: T[], name: string): T {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('new agent tool groups', () => {
  it('canvas tools support rename and clearing refs via empty array', async () => {
    const canvas = createCanvas();
    const deps = createCanvasDeps(canvas);
    const tools = createCanvasTools(deps);

    await expect(
      getTool(tools, 'canvas.manage').execute({
        action: 'rename',
        canvasId: 'canvas-1',
        name: 'Renamed Canvas',
      }),
    ).resolves.toEqual({ success: true, data: { canvasId: 'canvas-1', name: 'Renamed Canvas' } });
    await getTool(tools, 'canvas.setNodeRefs').execute({
      canvasId: 'canvas-1',
      nodeId: 'image-1',
      characterRefs: [],
      equipmentRefs: [],
      locationRefs: [],
    });

    expect(canvas.name).toBe('Renamed Canvas');
    expect((canvas.nodes[0].data as { characterRefs?: unknown[] }).characterRefs).toEqual([]);
    expect((canvas.nodes[0].data as { equipmentRefs?: unknown[] }).equipmentRefs).toEqual([]);
    expect((canvas.nodes[0].data as { locationRefs?: unknown[] }).locationRefs).toEqual([]);
  });

  it('script tools support load and import', async () => {
    const tools = createScriptTools({
      loadScript: vi.fn(async () => ({
        id: 'script-1',
        content: 'INT. ROOM - DAY',
        format: 'fountain',
        parsedScenes: [],
        createdAt: 1,
        updatedAt: 1,
      })),
      saveScript: vi.fn(async () => undefined),
      parseScript: vi.fn(() => []),
      importScript: vi.fn(async (content: string, format?: string) => ({
        content,
        parsedScenes: [],
        format,
      })),
    });

    await expect(
      getTool(tools, 'script.import').execute({ path: '/tmp/test.fountain' }),
    ).resolves.toEqual({
      success: true,
      data: { path: '/tmp/test.fountain' },
    });
    await expect(
      getTool(tools, 'script.import').execute({ content: 'INT. ROOM - DAY', format: 'fountain' }),
    ).resolves.toEqual({
      success: true,
      data: {
        content: 'INT. ROOM - DAY',
        parsedScenes: [],
        format: 'fountain',
      },
    });
  });

  it('preset and task-list tools delegate to dependencies', async () => {
    const presetTools = createPresetTools({
      listPresets: vi.fn(async () => []),
      savePreset: vi.fn(async (preset: PresetDefinition) => preset),
      deletePreset: vi.fn(async () => undefined),
      resetPreset: vi.fn(async (presetId: string) => ({
        id: presetId,
        category: 'camera',
        name: 'Preset',
        description: '',
        prompt: 'prompt',
        builtIn: true,
        modified: false,
        params: [],
        defaults: {},
      })),
      getPreset: vi.fn(async () => null),
    });
    const taskListTools = createTaskListTools({
      pauseTaskList: vi.fn(async () => undefined),
      resumeTaskList: vi.fn(async () => undefined),
      cancelTaskList: vi.fn(async () => undefined),
      retryTaskList: vi.fn(async () => undefined),
      decidePendingGate: vi.fn(async () => ({})),
      prepareAudioTask: vi.fn(async () => ({}) as never),
      getAudioTask: vi.fn(async () => ({}) as never),
      submitAudioPrompt: vi.fn(async () => ({}) as never),
      createProductionPlan: vi.fn(async () => ({
        taskListId: 'task-list-plan-1',
        gate: 'production_plan',
        status: 'awaiting_approval',
        revision: 1,
        contentHash: 'plan-hash-1',
      })),
      createVisualAuditions: vi.fn(async () => ({
        taskListId: 'task-list-plan-1',
        status: 'complete' as const,
        revision: 1,
        contentHash: 'visual-hash-1',
        recommendedCandidateId: 'candidate-1',
        candidates: [],
      })),
      produceMedia: vi.fn(async () => ({ status: 'accepted' })),
      refineMedia: vi.fn(async () => ({ status: 'accepted' })),
      prepareDelivery: vi.fn(async () => ({}) as never),
    });
    await expect(
      getTool(presetTools, 'preset.manage').execute({ action: 'delete', presetId: 'preset-1' }),
    ).resolves.toEqual({
      success: true,
      data: { presetId: 'preset-1' },
    });
    await expect(
      getTool(taskListTools, 'taskList.manage').execute({
        action: 'control',
        id: 'task-list-1',
        controlAction: 'retry',
      }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'task-list-1', action: 'retry' },
    });
  });

  it('task-list tools persist a structured production plan behind the first approval gate', async () => {
    const createProductionPlan = vi.fn(async () => ({
      taskListId: 'task-list-plan-1',
      gate: 'production_plan' as const,
      status: 'awaiting_approval' as const,
      revision: 1,
      contentHash: 'plan-hash-1',
    }));
    const taskListTools = createTaskListTools({
      pauseTaskList: vi.fn(async () => undefined),
      resumeTaskList: vi.fn(async () => undefined),
      cancelTaskList: vi.fn(async () => undefined),
      retryTaskList: vi.fn(async () => undefined),
      decidePendingGate: vi.fn(async () => ({})),
      prepareAudioTask: vi.fn(async () => ({}) as never),
      getAudioTask: vi.fn(async () => ({}) as never),
      submitAudioPrompt: vi.fn(async () => ({}) as never),
      createProductionPlan,
      createVisualAuditions: vi.fn(async () => ({
        taskListId: 'task-list-plan-1',
        status: 'complete' as const,
        revision: 1,
        contentHash: 'visual-hash-1',
        recommendedCandidateId: 'candidate-1',
        candidates: [],
      })),
      produceMedia: vi.fn(async () => ({ status: 'accepted' })),
      refineMedia: vi.fn(async () => ({ status: 'accepted' })),
      prepareDelivery: vi.fn(async () => ({}) as never),
    });

    const plan = {
      title: 'Chrono Ronin',
      logline: 'A samurai is thrown into a city that remembers his future crimes.',
      synopsis:
        'He must expose the time fracture before the city executes him for an unwritten act.',
      genre: 'anime science fiction',
      tone: 'kinetic and melancholic',
      targetAudience: 'teen and adult animation audience',
      format: { targetDurationSeconds: 120, aspectRatio: '16:9' },
      story: {
        acts: [
          {
            name: 'Act 1',
            purpose: 'Displace the hero and reveal the accusation.',
            scenes: [
              {
                title: 'Neon Arrival',
                summary: 'The samurai lands in a future city and is immediately hunted.',
                storyBeat: 'inciting incident',
                dialogueIntent: 'Confusion against institutional certainty.',
              },
            ],
          },
        ],
      },
      assumptions: ['One protagonist', 'Short-form runtime'],
      budget: {
        maxTotalCostUsd: 30,
        styleAuditionCostUsd: 4,
        maxAttemptsPerShot: 3,
        maxRegenerations: 10,
      },
      visualDirections: ['graphic cel animation', 'cinematic anime realism'],
    };

    await expect(
      getTool(taskListTools, 'taskList.manage').execute({
        action: 'createProductionPlan',
        canvasId: 'canvas-1',
        idea: 'samurai travels through time',
        plan,
      }),
    ).resolves.toEqual({
      success: true,
      data: {
        taskListId: 'task-list-plan-1',
        gate: 'production_plan',
        status: 'awaiting_approval',
        revision: 1,
        contentHash: 'plan-hash-1',
      },
    });
    expect(createProductionPlan).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      idea: 'samurai travels through time',
      plan,
    });
  });

  it('color style tools support compatible save/list/delete flows', async () => {
    const colorStyle = {
      id: 'style-2',
      name: 'Cool',
      sourceType: 'manual' as const,
      palette: [{ hex: '#112233', weight: 1 }],
      gradients: [],
      exposure: {
        brightness: 0,
        contrast: 0,
        highlights: 0,
        shadows: 0,
        temperature: 6500,
        tint: 0,
      },
      tags: ['cool'],
      createdAt: 1,
      updatedAt: 1,
    };
    const colorStyleTools = createColorStyleTools({
      listColorStyles: vi.fn(async () => [{ id: 'style-1', name: 'Warm' }]),
      saveColorStyle: vi.fn(async (_style: Record<string, unknown>) => undefined),
      deleteColorStyle: vi.fn(async () => undefined),
    });

    await expect(
      getTool(colorStyleTools, 'colorStyle.manage').execute({ action: 'list' }),
    ).resolves.toEqual({
      success: true,
      data: { total: 1, offset: 0, limit: 50, colorStyles: [{ id: 'style-1', name: 'Warm' }] },
    });
    await expect(
      getTool(colorStyleTools, 'colorStyle.manage').execute({
        action: 'save',
        style: colorStyle,
      }),
    ).resolves.toEqual({
      success: true,
      data: { style: colorStyle },
    });
    await expect(
      getTool(colorStyleTools, 'colorStyle.manage').execute({ action: 'delete', id: 'style-2' }),
    ).resolves.toEqual({
      success: true,
      data: { id: 'style-2' },
    });
  });
});
