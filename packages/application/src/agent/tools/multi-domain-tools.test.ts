import { describe, expect, it, vi } from 'vitest';
import {
  createCanvasTools,
  type CanvasToolDeps,
  createColorStyleTools,
  createJobTools,
  createPresetTools,
  createProjectTools,
  createRenderTools,
  createScriptTools,
  createSeriesTools,
  createWorkflowTools,
} from '../../index.js';
import { createEmptyPresetTrackSet, type Canvas, type PresetDefinition } from '@lucid-fin/contracts';

function createCanvas(): Canvas {
  return {
    id: 'canvas-1',
    projectId: 'project-1',
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

function createCanvasDeps(canvas: Canvas): CanvasToolDeps {
  return {
    getCanvas: vi.fn(async () => canvas),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    renameNode: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    getCanvasState: vi.fn(async () => canvas),
    layoutNodes: vi.fn(async () => undefined),
    triggerGeneration: vi.fn(async () => undefined),
    renameCanvas: vi.fn(async (_canvasId: string, name: string) => {
      canvas.name = name;
    }),
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
    cancelGeneration: vi.fn(async () => undefined),
    deleteNode: vi.fn(async () => undefined),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(async (_canvasId: string, nodeId: string, data: Record<string, unknown>) => {
      const node = canvas.nodes.find((entry) => entry.id === nodeId);
      if (!node) throw new Error(`Node not found: ${nodeId}`);
      Object.assign(node.data as Record<string, unknown>, data);
    }),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset: PresetDefinition) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    removeCharacterRef: vi.fn(async (_canvasId: string, _nodeId: string, characterId: string) => {
      const node = canvas.nodes[0];
      const current = (node.data as { characterRefs?: Array<{ characterId: string }> }).characterRefs ?? [];
      (node.data as { characterRefs?: Array<{ characterId: string }> }).characterRefs = current.filter((entry) => entry.characterId !== characterId);
    }),
    removeEquipmentRef: vi.fn(async (_canvasId: string, _nodeId: string, equipmentId: string) => {
      const node = canvas.nodes[0];
      const current = (node.data as { equipmentRefs?: Array<{ equipmentId: string }> }).equipmentRefs ?? [];
      (node.data as { equipmentRefs?: Array<{ equipmentId: string }> }).equipmentRefs = current.filter((entry) => entry.equipmentId !== equipmentId);
    }),
    removeLocationRef: vi.fn(async (_canvasId: string, _nodeId: string, locationId: string) => {
      const node = canvas.nodes[0];
      const current = (node.data as { locationRefs?: Array<{ locationId: string }> }).locationRefs ?? [];
      (node.data as { locationRefs?: Array<{ locationId: string }> }).locationRefs = current.filter((entry) => entry.locationId !== locationId);
    }),
    listLLMProviders: vi.fn(async () => []),
    setActiveLLMProvider: vi.fn(async () => undefined),
    setLLMProviderApiKey: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
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
    deleteProviderKey: vi.fn(async () => undefined),
  };
}

function getTool<T extends { name: string; execute: (args: Record<string, unknown>) => Promise<unknown> }>(
  tools: T[],
  name: string,
): T {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('new agent tool groups', () => {
  it('canvas tools support rename/load/save and clearing refs via empty array', async () => {
    const canvas = createCanvas();
    const deps = createCanvasDeps(canvas);
    const tools = createCanvasTools(deps);

    await expect(getTool(tools, 'canvas.renameCanvas').execute({
      canvasId: 'canvas-1',
      name: 'Renamed Canvas',
    })).resolves.toEqual({ success: true, data: { canvasId: 'canvas-1', name: 'Renamed Canvas' } });
    await expect(getTool(tools, 'canvas.loadCanvas').execute({ canvasId: 'canvas-1' })).resolves.toEqual({
      success: true,
      data: { canvasId: 'canvas-1' },
    });
    await expect(getTool(tools, 'canvas.saveCanvas').execute({ canvasId: 'canvas-1' })).resolves.toEqual({
      success: true,
      data: { canvasId: 'canvas-1' },
    });

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
        projectId: 'project-1',
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

    await expect(getTool(tools, 'script.import').execute({ path: '/tmp/test.fountain' })).resolves.toEqual({
      success: true,
      data: { path: '/tmp/test.fountain' },
    });
    await expect(getTool(tools, 'script.import').execute({ content: 'INT. ROOM - DAY', format: 'fountain' })).resolves.toEqual({
      success: true,
      data: {
        content: 'INT. ROOM - DAY',
        parsedScenes: [],
        format: 'fountain',
      },
    });
  });

  it('job, project, render, preset, and workflow tools delegate to dependencies', async () => {
    const jobTools = createJobTools({
      listJobs: vi.fn(async () => []),
      cancelJob: vi.fn(async () => undefined),
      pauseJob: vi.fn(async () => undefined),
      resumeJob: vi.fn(async () => undefined),
    });
    const projectTools = createProjectTools({
      listProjects: vi.fn(async () => [{ id: 'project-1', title: 'Project', path: '/tmp/project', updatedAt: 1 }]),
      createSnapshot: vi.fn(async () => ({ id: 'snapshot-1' })),
      listSnapshots: vi.fn(async () => []),
      restoreSnapshot: vi.fn(async () => undefined),
    });
    const renderTools = createRenderTools({
      startRender: vi.fn(async () => ({ renderId: 'render-1' })),
      cancelRender: vi.fn(async () => undefined),
      exportBundle: vi.fn(async () => ({ path: '/tmp/out.fcpxml' })),
    });
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
    const workflowTools = createWorkflowTools({
      pauseWorkflow: vi.fn(async () => undefined),
      resumeWorkflow: vi.fn(async () => undefined),
      cancelWorkflow: vi.fn(async () => undefined),
      retryWorkflow: vi.fn(async () => undefined),
    });

    await expect(getTool(jobTools, 'job.control').execute({ jobId: 'job-1', action: 'cancel' })).resolves.toEqual({
      success: true,
      data: { jobId: 'job-1', action: 'cancel' },
    });
    await expect(getTool(projectTools, 'project.list').execute({})).resolves.toEqual({
      success: true,
      data: { total: 1, offset: 0, limit: 50, projects: [{ id: 'project-1', title: 'Project', path: '/tmp/project', updatedAt: 1 }] },
    });
    await expect(getTool(renderTools, 'render.control').execute({ canvasId: 'canvas-1', format: 'mp4', action: 'start' })).resolves.toEqual({
      success: true,
      data: { renderId: 'render-1' },
    });
    await expect(getTool(presetTools, 'preset.delete').execute({ presetId: 'preset-1' })).resolves.toEqual({
      success: true,
      data: { presetId: 'preset-1' },
    });
    await expect(getTool(workflowTools, 'workflow.control').execute({ id: 'wf-1', action: 'retry' })).resolves.toEqual({
      success: true,
      data: { id: 'wf-1', action: 'retry' },
    });
  });

  it('workflow tools return built-in structured idea expansion instructions', async () => {
    const workflowTools = createWorkflowTools({
      pauseWorkflow: vi.fn(async () => undefined),
      resumeWorkflow: vi.fn(async () => undefined),
      cancelWorkflow: vi.fn(async () => undefined),
      retryWorkflow: vi.fn(async () => undefined),
    });

    await expect(
      getTool(workflowTools, 'workflow.expandIdea').execute({ prompt: 'samurai travels through time' }),
    ).resolves.toEqual({
      success: true,
      data: {
        instructions:
          'Expand the idea "samurai travels through time" into a cinematic story with 3 acts and 2-4 scenes per act. For each scene: call canvas.addNode with type "text", title = scene name, data.content = 2-3 sentence scene summary. After all nodes are created, present the full outline to the user and ask if they want to proceed to entity generation.',
        outlineFormat: {
          title: '<story title>',
          genre: 'cinematic',
          logline: '<one sentence summary>',
          acts: [
            {
              name: 'Act 1',
              scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }],
            },
            {
              name: 'Act 2',
              scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }],
            },
            {
              name: 'Act 3',
              scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }],
            },
          ],
        },
      },
    });
  });

  it('workflow expandIdea succeeds without a delegated handler', async () => {
    const workflowTools = createWorkflowTools({
      pauseWorkflow: vi.fn(async () => undefined),
      resumeWorkflow: vi.fn(async () => undefined),
      cancelWorkflow: vi.fn(async () => undefined),
      retryWorkflow: vi.fn(async () => undefined),
    });

    await expect(getTool(workflowTools, 'workflow.expandIdea').execute({
      prompt: 'samurai travels through time',
      genre: 'anime',
      actCount: 2,
    }))
      .resolves.toEqual({
        success: true,
        data: {
          instructions:
            'Expand the idea "samurai travels through time" into a anime story with 2 acts and 2-4 scenes per act. For each scene: call canvas.addNode with type "text", title = scene name, data.content = 2-3 sentence scene summary. After all nodes are created, present the full outline to the user and ask if they want to proceed to entity generation.',
          outlineFormat: {
            title: '<story title>',
            genre: 'anime',
            logline: '<one sentence summary>',
            acts: [
              {
                name: 'Act 1',
                scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }],
              },
              {
                name: 'Act 2',
                scenes: [{ title: '<scene title>', summary: '<2-3 sentence summary>' }],
              },
            ],
          },
        },
      });
  });

  it('series and color style tools support compatible save/list/delete flows', async () => {
    const currentSeries = {
      id: 'series-1',
      title: 'Series',
      description: 'Desc',
      styleGuide: {
        global: {
          artStyle: '',
          colorPalette: { primary: '', secondary: '', forbidden: [] },
          lighting: 'natural' as const,
          texture: '',
          referenceImages: [],
          freeformDescription: '',
        },
        sceneOverrides: {},
      },
      episodeIds: [],
      createdAt: 1,
      updatedAt: 1,
    };
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
    const seriesTools = createSeriesTools({
      getSeries: vi.fn(async () => currentSeries),
      saveSeries: vi.fn(async (series: Record<string, unknown>) => series),
      listEpisodes: vi.fn(async () => [{ id: 'episode-1', title: 'Pilot', canvasId: 'canvas-1' }]),
      addEpisode: vi.fn(async () => ({ id: 'episode-2' })),
      removeEpisode: vi.fn(async () => undefined),
      reorderEpisodes: vi.fn(async () => []),
    });
    const colorStyleTools = createColorStyleTools({
      listColorStyles: vi.fn(async () => [{ id: 'style-1', name: 'Warm' }]),
      saveColorStyle: vi.fn(async (_style: Record<string, unknown>) => undefined),
      deleteColorStyle: vi.fn(async () => undefined),
    });

    await expect(getTool(seriesTools, 'series.save').execute({
      title: 'Updated Series',
      description: 'Updated Desc',
    })).resolves.toEqual({
      success: true,
      data: { ...currentSeries, title: 'Updated Series', description: 'Updated Desc' },
    });
    await expect(getTool(seriesTools, 'series.removeEpisode').execute({ episodeId: 'episode-1' })).resolves.toEqual({
      success: true,
      data: { episodeId: 'episode-1' },
    });

    await expect(getTool(colorStyleTools, 'colorStyle.list').execute({})).resolves.toEqual({
      success: true,
      data: { total: 1, offset: 0, limit: 50, colorStyles: [{ id: 'style-1', name: 'Warm' }] },
    });
    await expect(getTool(colorStyleTools, 'colorStyle.save').execute({
      style: colorStyle,
    })).resolves.toEqual({
      success: true,
      data: { style: colorStyle },
    });
    await expect(getTool(colorStyleTools, 'colorStyle.delete').execute({ id: 'style-2' })).resolves.toEqual({
      success: true,
      data: { id: 'style-2' },
    });
  });
});
