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
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    getCanvasState: vi.fn(async () => {
      throw new Error('unused');
    }),
    layoutNodes: vi.fn(async () => undefined),
    triggerGeneration: vi.fn(async () => undefined),
    cancelGeneration: vi.fn(async () => undefined),
    deleteNode: vi.fn(async () => undefined),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(async () => undefined),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset) => preset),
    listShotTemplates: vi.fn(async () => []),
    removeCharacterRef: vi.fn(async () => undefined),
    removeEquipmentRef: vi.fn(async () => undefined),
    removeLocationRef: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
    importWorkflow: vi.fn(async () => {
      throw new Error('unused');
    }),
    exportWorkflow: vi.fn(async () => '{}'),
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
  it('defines logger.read and commander.askUser tools', () => {
    const deps = createDeps();
    const tools = createCanvasMetaTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual(['logger.read', 'commander.askUser']);
    expect(getTool('commander.askUser', deps).tags).toEqual(['meta', 'interaction']);
  });

  it('reads logs with normalized filters', async () => {
    const deps = createDeps();

    await expect(getTool('logger.read', deps).execute({
      level: ' error ',
      category: ' generation ',
      limit: 3.8,
    })).resolves.toEqual({
      success: true,
      data: [{ id: 'log-1', category: 'test', level: 'info' }],
    });
    expect(deps.getRecentLogs).toHaveBeenCalledWith('error', 'generation', 3);
  });

  it('returns waiting output for askUser and wraps logger failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.getRecentLogs).mockRejectedValueOnce(new Error('log read failed'));

    await expect(getTool('commander.askUser', deps).execute({
      question: 'Proceed?',
      options: [{ label: 'Yes' }],
    })).resolves.toEqual({
      success: true,
      data: 'Waiting for user response...',
    });
    await expect(getTool('logger.read', deps).execute({})).resolves.toEqual({
      success: false,
      error: 'log read failed',
    });
  });
});
