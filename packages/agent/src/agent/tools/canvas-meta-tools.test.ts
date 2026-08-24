import { describe, expect, it, vi } from 'vitest';
import { createCanvasMetaTools } from './canvas-meta-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

function createDeps(): CanvasToolDeps {
  return {
    getCanvas: vi.fn(async () => {
      throw new Error('unused');
    }),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    renameNode: vi.fn(async () => undefined),
    renameCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    layoutNodes: vi.fn(async () => undefined),
    prepareMediaTask: vi.fn(async (input) => ({
      id: 'task-list-1', canvasId: input.canvasId, nodeId: input.nodeId,
      status: 'running', taskStatus: 'awaiting_prompt_assembly', progress: 0,
    })),
    getMediaTask: vi.fn(async (id) => ({
      id, canvasId: 'canvas-1', nodeId: 'node-1',
      status: 'running', taskStatus: 'awaiting_prompt_assembly', progress: 0,
    })),
    submitMediaPrompt: vi.fn(async (input) => ({
      id: input.taskListId, canvasId: 'canvas-1', nodeId: 'node-1',
      status: 'running', taskStatus: 'awaiting_provider', progress: 0,
    })),
    cancelMediaTask: vi.fn(async (id) => ({
      id, canvasId: 'canvas-1', nodeId: 'node-1',
      status: 'cancelled', taskStatus: 'cancelled', progress: 0,
    })),
    retryMediaEvaluation: vi.fn(async (id) => ({
      id, canvasId: 'canvas-1', nodeId: 'node-1',
      status: 'running', taskStatus: 'evaluating', progress: 0,
    })),
    deleteNode: vi.fn(async () => undefined),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(async () => undefined),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    importCanvasDocument: vi.fn(async () => {
      throw new Error('unused');
    }),
    exportCanvasDocument: vi.fn(async () => '{}'),
    setNodeColorTag: vi.fn(async () => undefined),
    toggleSeedLock: vi.fn(async () => undefined),
    selectVariant: vi.fn(async () => undefined),
    estimateCost: vi.fn(async () => ({ totalEstimatedCost: 0, currency: 'USD', nodeCosts: [] })),
    addNote: vi.fn(async () => ({ id: 'note-1', content: 'note', createdAt: 1, updatedAt: 1 })),
    getRecentLogs: vi.fn(async () => [{ id: 'log-1', category: 'test', level: 'info' }]),
    updateNote: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    undo: vi.fn(async () => undefined),
    redo: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: CanvasToolDeps) {
  const tool = createCanvasMetaTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createCanvasMetaTools', () => {
  it('defines logger.list and commander.askUser tools', () => {
    const deps = createDeps();
    const tools = createCanvasMetaTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual(['logger.list', 'commander.askUser']);
    expect(getTool('commander.askUser', deps).tags).toEqual(['meta', 'interaction']);
  });

  it('exposes AskUser free-text choice without prescribing model behavior or option count', () => {
    const tool = getTool('commander.askUser', createDeps());
    const inputSchema = tool.inputSchema;

    expect(tool.description).toContain('when their input is needed');
    expect(tool.description).not.toMatch(/MUST|2[–-]4|2-6/);
    if ('anyOf' in inputSchema || 'const' in inputSchema || inputSchema.type !== 'object') {
      throw new Error('commander.askUser must expose an object input schema');
    }
    expect(inputSchema.properties.allowFreeText).toMatchObject({ type: 'boolean' });
    expect(inputSchema.properties.options?.description).not.toMatch(/\d/);
    expect(inputSchema.required).toEqual(['question']);
    const options = inputSchema.properties.options;
    if (!options || 'anyOf' in options || 'const' in options || options.type !== 'array') {
      throw new Error('commander.askUser options must expose an array schema');
    }
    const option = options.items;
    if ('anyOf' in option || 'const' in option || option.type !== 'object') {
      throw new Error('commander.askUser option must expose an object schema');
    }
    expect(option.properties.previewAssetHash).toMatchObject({
      type: 'string',
    });
  });

  it('reads logs with normalized filters', async () => {
    const deps = createDeps();

    await expect(
      getTool('logger.list', deps).execute({
        level: ' error ',
        category: ' generation ',
        limit: 3.8,
      }),
    ).resolves.toEqual({
      success: true,
      data: [{ id: 'log-1', category: 'test', level: 'info' }],
    });
    expect(deps.getRecentLogs).toHaveBeenCalledWith('error', 'generation', 3);
  });

  it('returns waiting output for askUser and wraps logger failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.getRecentLogs).mockRejectedValueOnce(new Error('log read failed'));

    await expect(
      getTool('commander.askUser', deps).execute({
        question: 'Proceed?',
        options: [{ label: 'Yes' }],
      }),
    ).resolves.toEqual({
      success: true,
      data: 'Waiting for user response...',
    });
    await expect(getTool('logger.list', deps).execute({})).resolves.toEqual({
      success: false,
      error: 'log read failed',
    });
  });
});
