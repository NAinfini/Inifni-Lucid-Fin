import { describe, expect, it, vi } from 'vitest';
import { createCanvasSettingsTools } from './canvas-settings-tools.js';
import type { CanvasToolDeps } from './canvas-tool-utils.js';

function createDeps(overrides: Partial<CanvasToolDeps> = {}): CanvasToolDeps {
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
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
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
    getRecentLogs: vi.fn(async () => []),
    updateNote: vi.fn(async () => undefined),
    deleteNote: vi.fn(async () => undefined),
    undo: vi.fn(async () => undefined),
    redo: vi.fn(async () => undefined),
    setLLMProviderApiKey: vi.fn(async () => undefined),
    ...overrides,
  };
}

function getTool(deps: CanvasToolDeps) {
  const tool = createCanvasSettingsTools(deps).find((entry) => entry.name === 'settings.setProviderKey');
  if (!tool) throw new Error('Missing settings.setProviderKey');
  return tool;
}

describe('createCanvasSettingsTools', () => {
  it('defines the provider key tool', () => {
    const tool = getTool(createDeps());

    expect(tool.name).toBe('settings.setProviderKey');
    expect(tool.parameters.required).toEqual(['providerId', 'apiKey']);
    expect(tool.tier).toBe(4);
  });

  it('stores provider API keys through the dependency', async () => {
    const deps = createDeps();

    await expect(getTool(deps).execute({
      providerId: ' openai ',
      apiKey: ' sk-test ',
    })).resolves.toEqual({
      success: true,
      data: { providerId: 'openai', message: 'API key set for openai' },
    });
    expect(deps.setLLMProviderApiKey).toHaveBeenCalledWith('openai', 'sk-test');
  });

  it('handles unavailable management, validation errors, and dependency failures', async () => {
    await expect(getTool(createDeps({ setLLMProviderApiKey: undefined })).execute({
      providerId: 'openai',
      apiKey: 'sk-test',
    })).resolves.toEqual({
      success: false,
      error: 'API key management not available',
    });

    const deps = createDeps();
    vi.mocked(deps.setLLMProviderApiKey).mockRejectedValueOnce(new Error('store failed'));

    await expect(getTool(deps).execute({ providerId: '', apiKey: 'sk-test' })).resolves.toEqual({
      success: false,
      error: 'providerId is required',
    });
    await expect(getTool(deps).execute({ providerId: 'openai', apiKey: 'sk-test' })).resolves.toEqual({
      success: false,
      error: 'store failed',
    });
  });
});
