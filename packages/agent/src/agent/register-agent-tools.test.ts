import { describe, it, expect, vi } from 'vitest';
import { deriveEntityMutatingToolNames, ToolRegistry } from './tool-registry.js';
import { EXCLUDED_TOOLS, registerAgentTools, type AllToolDeps } from './register-agent-tools.js';
import { ENTITY_REFRESH_TOOL_ENTITY } from '@lucid-fin/contracts';
import type { AssetRef, Equipment, PresetDefinition } from '@lucid-fin/contracts';

function createMockDeps(): AllToolDeps {
  return {
    // ScriptToolDeps
    loadScript: vi.fn(async () => null),
    saveScript: vi.fn(async () => undefined),
    parseScript: vi.fn(() => []),
    importScript: vi.fn(async () => ({ content: '', parsedScenes: [] })),
    // CharacterToolDeps
    listCharacters: vi.fn(async () => []),
    saveCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
    // CanvasToolDeps
    getCanvas: vi.fn(async () => ({
      id: 'canvas-1',
      name: 'Canvas',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 1,
      updatedAt: 1,
    })),
    deleteCanvas: vi.fn(async () => undefined),
    addNode: vi.fn(async () => undefined),
    moveNode: vi.fn(async () => undefined),
    renameNode: vi.fn(async () => undefined),
    connectNodes: vi.fn(async () => undefined),
    setNodePresets: vi.fn(async () => undefined),
    listPresets: vi.fn(async () => []),
    savePreset: vi.fn(async (preset: PresetDefinition) => preset),
    listShotTemplates: vi.fn(async () => []),
    saveShotTemplate: vi.fn(async (t) => t),
    deleteShotTemplate: vi.fn(async () => {}),
    getCanvasState: vi.fn(async () => ({
      id: 'canvas-1',
      name: 'Canvas',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 1,
      updatedAt: 1,
    })),
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
    renameCanvas: vi.fn(async () => undefined),
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
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
    updateNodeData: vi.fn(async () => undefined),
    removeCharacterRef: vi.fn(async () => undefined),
    removeEquipmentRef: vi.fn(async () => undefined),
    removeLocationRef: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
    importCanvasDocument: vi.fn(async () => ({
      id: 'canvas-1',
      name: 'Canvas',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 1,
      updatedAt: 1,
    })),
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
    deleteProviderKey: vi.fn(async () => undefined),
    // ColorStyleToolDeps
    listColorStyles: vi.fn(async () => []),
    saveColorStyle: vi.fn(async (style: Record<string, unknown>) => style),
    deleteColorStyle: vi.fn(async () => undefined),
    // EquipmentToolDeps
    listEquipment: vi.fn(async (): Promise<Equipment[]> => []),
    saveEquipment: vi.fn(async () => undefined),
    deleteEquipment: vi.fn(async () => undefined),
    // AssetToolDeps
    importAsset: vi.fn(async (): Promise<AssetRef> => ({
      hash: 'hash-1',
      type: 'image',
      format: 'png',
      path: '/tmp/hash-1.png',
    })),
    listAssets: vi.fn(async () => []),
    // PromptToolDeps
    listPrompts: vi.fn(async () => []),
    getPrompt: vi.fn(async () => null),
    setCustomPrompt: vi.fn(async () => undefined),
    clearCustomPrompt: vi.fn(async () => undefined),
    // PresetToolDeps
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
    // TaskListToolDeps
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
      gate: 'production_plan' as const,
      status: 'awaiting_approval' as const,
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
    // LocationToolDeps
    listLocations: vi.fn(async () => []),
    saveLocation: vi.fn(async () => undefined),
    deleteLocation: vi.fn(async () => undefined),
  };
}

describe('registerAgentTools', () => {
  it('registers the exact stable tool set after explicit exclusions', () => {
    const registry = new ToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const names = registry.list().map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'canvas.configureNode',
        'canvas.connectNodes',
        'canvas.createNodes',
        'canvas.deleteNode',
        'canvas.duplicateNodes',
        'canvas.generation',
        'canvas.getInfo',
        'canvas.getNode',
        'canvas.layout',
        'canvas.listEdges',
        'canvas.listNodes',
        'canvas.manage',
        'canvas.manageEdge',
        'canvas.presetTracks',
        'canvas.previewPrompt',
        'canvas.selectVariant',
        'canvas.setMediaParams',
        'canvas.setNodeRefs',
        'canvas.setSettings',
        'canvas.setVideoFrames',
        'canvas.updateNodes',
        'colorStyle.manage',
        'commander.askUser',
        'agent.result',
        'agent.spawn',
        'agent.wait',
        'entity.create',
        'entity.delete',
        'entity.deleteRefImage',
        'entity.list',
        'entity.setRefImage',
        'entity.setRefImageFromNode',
        'entity.update',
        'guide.get',
        'preset.manage',
        'prompt.get',
        'provider.resolveResolution',
        'runChecklist.manage',
        'script.manage',
        'shotTemplate.manage',
        'task.audio',
        'task.delivery',
        'task.media',
        'task.mediaFeedback',
        'task.visual',
        'taskList.manage',
        'text.analyze',
        'tool.compact',
        'tool.get',
        'tool.program',
      ].sort(),
    );
    expect(registry.get('tool.get')).toBeDefined();
    expect(registry.get('guide.get')).toBeDefined();
    // Verify excluded tools are NOT registered
    expect(registry.get('canvas.undo')).toBeUndefined();
    expect(registry.get('canvas.redo')).toBeUndefined();
    expect(registry.get('canvas.importDocument')).toBeUndefined();
    expect(registry.get('canvas.deleteCanvas')).toBeUndefined();
    expect(registry.get('canvas.setNodeLayout')).toBeUndefined();
    expect(registry.get('logger.list')).toBeUndefined();
    expect(registry.get('script.import')).toBeUndefined();
    expect(registry.get('provider.setKey')).toBeUndefined();
    expect(registry.get('provider.addCustom')).toBeUndefined();
    expect(EXCLUDED_TOOLS.has('prompt.setCustom')).toBe(true);
  });

  it('registers at least one script. tool', () => {
    const registry = new ToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const scriptTools = registry.list().filter((t) => t.name.startsWith('script.'));
    expect(scriptTools.length).toBeGreaterThanOrEqual(1);
  });

  it('registers at least one entity. tool', () => {
    const registry = new ToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const entityTools = registry.list().filter((t) => t.name.startsWith('entity.'));
    expect(entityTools.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the same registry instance', () => {
    const registry = new ToolRegistry();
    const result = registerAgentTools(registry, createMockDeps());
    expect(result).toBe(registry);
  });

  it('registers canvas tools only in canvas context', () => {
    const registry = new ToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const canvasContextTools = registry.forContext('canvas');
    const canvasTools = canvasContextTools.filter((t) => t.name.startsWith('canvas.'));
    expect(canvasTools.length).toBeGreaterThanOrEqual(20);
    expect(canvasContextTools.some((t) => t.name === 'canvas.listNodes')).toBe(true);
    // logger.list is excluded from Commander AI
    expect(canvasContextTools.some((t) => t.name === 'logger.list')).toBe(false);

    const storyboardContextTools = registry.forContext('storyboard');
    expect(storyboardContextTools.some((t) => t.name.startsWith('canvas.'))).toBe(false);
  });

  it('every registered definition owns its runtime metadata', () => {
    const registry = new ToolRegistry();
    registerAgentTools(registry, createMockDeps());
    for (const tool of registry.list()) {
      expect(tool.name.trim()).not.toBe('');
      expect(tool.description.trim()).not.toBe('');
      expect(tool.process.trim()).not.toBe('');
      expect(['query', 'mutation', 'meta']).toContain(tool.category);
      expect([1, 2, 3, 4]).toContain(tool.tier);
      expect(['status_only', 'authority_reread', 'public_facts']).toContain(tool.contextReplay);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.outputSchema).toBeDefined();
      expect(tool.execute).toBeTypeOf('function');
    }
  });

  it('derives entity mutation and UI-effect views from registered definitions', () => {
    const registry = new ToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const definitionEntries: Record<string, string> = {};
    for (const tool of registry.list()) {
      const refresh = tool.uiEffects?.find((effect) => effect.kind === 'entity.refresh');
      if (refresh?.entity) definitionEntries[tool.name] = refresh.entity;
    }
    expect(definitionEntries).toEqual(ENTITY_REFRESH_TOOL_ENTITY);
    expect(deriveEntityMutatingToolNames(registry)).toEqual(
      new Set(Object.keys(ENTITY_REFRESH_TOOL_ENTITY)),
    );
  });
});
