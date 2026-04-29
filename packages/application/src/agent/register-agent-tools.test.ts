import { describe, it, expect, vi } from 'vitest';
import { AgentToolRegistry } from './tool-registry.js';
import { registerAgentTools, type AllToolDeps } from './register-agent-tools.js';
import { ToolCatalog } from './tool-catalog.js';
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
    triggerGeneration: vi.fn(async () => undefined),
    renameCanvas: vi.fn(async () => undefined),
    loadCanvas: vi.fn(async () => undefined),
    saveCanvas: vi.fn(async () => undefined),
    cancelGeneration: vi.fn(async () => undefined),
    deleteNode: vi.fn(async () => undefined),
    deleteEdge: vi.fn(async () => undefined),
    updateNodeData: vi.fn(async () => undefined),
    removeCharacterRef: vi.fn(async () => undefined),
    removeEquipmentRef: vi.fn(async () => undefined),
    removeLocationRef: vi.fn(async () => undefined),
    clearSelection: vi.fn(async () => undefined),
    importWorkflow: vi.fn(async () => ({
      id: 'canvas-1',
      name: 'Canvas',
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 1,
      updatedAt: 1,
    })),
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
    // JobToolDeps
    listJobs: vi.fn(async () => []),
    cancelJob: vi.fn(async () => undefined),
    pauseJob: vi.fn(async () => undefined),
    resumeJob: vi.fn(async () => undefined),
    // SeriesToolDeps
    getSeries: vi.fn(async () => null),
    saveSeries: vi.fn(async (series: Record<string, unknown>) => series),
    listEpisodes: vi.fn(async () => []),
    addEpisode: vi.fn(async () => ({
      id: 'episode-1',
      seriesId: 'series-1',
      title: 'Episode 1',
      order: 0,
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    })),
    removeEpisode: vi.fn(async () => undefined),
    reorderEpisodes: vi.fn(async () => []),
    // ColorStyleToolDeps
    listColorStyles: vi.fn(async () => []),
    saveColorStyle: vi.fn(async (style: Record<string, unknown>) => style),
    deleteColorStyle: vi.fn(async () => undefined),
    // EquipmentToolDeps
    listEquipment: vi.fn(async (): Promise<Equipment[]> => []),
    saveEquipment: vi.fn(async () => undefined),
    deleteEquipment: vi.fn(async () => undefined),
    // AssetToolDeps
    importAsset: vi.fn(
      async (): Promise<AssetRef> => ({
        hash: 'hash-1',
        type: 'image',
        format: 'png',
        path: '/tmp/hash-1.png',
      }),
    ),
    listAssets: vi.fn(async () => []),
    // PromptToolDeps
    listPrompts: vi.fn(async () => []),
    getPrompt: vi.fn(async () => null),
    setCustomPrompt: vi.fn(async () => undefined),
    clearCustomPrompt: vi.fn(async () => undefined),
    // RenderToolDeps
    startRender: vi.fn(async () => ({ renderId: 'render-1' })),
    cancelRender: vi.fn(async () => undefined),
    exportBundle: vi.fn(async () => ({ path: '/tmp/export.fcpxml' })),
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
    // WorkflowToolDeps
    pauseWorkflow: vi.fn(async () => undefined),
    resumeWorkflow: vi.fn(async () => undefined),
    cancelWorkflow: vi.fn(async () => undefined),
    retryWorkflow: vi.fn(async () => undefined),
    // LocationToolDeps
    listLocations: vi.fn(async () => []),
    saveLocation: vi.fn(async () => undefined),
    deleteLocation: vi.fn(async () => undefined),
  };
}

describe('registerAgentTools', () => {
  it('registers the full expected tool set', () => {
    const registry = new AgentToolRegistry();
    registerAgentTools(registry, createMockDeps());
    expect(registry.list().length).toBeGreaterThanOrEqual(80);
    expect(registry.get('tool.get')).toBeDefined();
    expect(registry.get('guide.get')).toBeDefined();
  });

  it('registers at least one script. tool', () => {
    const registry = new AgentToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const scriptTools = registry.list().filter((t) => t.name.startsWith('script.'));
    expect(scriptTools.length).toBeGreaterThanOrEqual(1);
  });

  it('registers at least one character. tool', () => {
    const registry = new AgentToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const characterTools = registry.list().filter((t) => t.name.startsWith('character.'));
    expect(characterTools.length).toBeGreaterThanOrEqual(1);
  });

  it('registers at least one equipment. tool', () => {
    const registry = new AgentToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const equipmentTools = registry.list().filter((t) => t.name.startsWith('equipment.'));
    expect(equipmentTools.length).toBeGreaterThanOrEqual(1);
  });

  it('returns the same registry instance', () => {
    const registry = new AgentToolRegistry();
    const result = registerAgentTools(registry, createMockDeps());
    expect(result).toBe(registry);
  });

  it('registers canvas tools only in canvas context', () => {
    const registry = new AgentToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const canvasContextTools = registry.forContext('canvas');
    const canvasTools = canvasContextTools.filter((t) => t.name.startsWith('canvas.'));
    expect(canvasTools.length).toBeGreaterThanOrEqual(30);
    expect(canvasContextTools.some((t) => t.name === 'canvas.listNodes')).toBe(true);
    expect(canvasContextTools.some((t) => t.name === 'logger.list')).toBe(true);

    const storyboardContextTools = registry.forContext('storyboard');
    expect(storyboardContextTools.some((t) => t.name.startsWith('canvas.'))).toBe(false);
  });

  it('every registered tool has a matching ToolCatalog entry', () => {
    // Cross-check: the master ToolCatalog metadata must cover every tool the
    // legacy `registerAgentTools` wires up. If this fails, a new tool was
    // added to the registry without a matching `defineToolMeta` entry in
    // `tool-catalog.ts` — and catalog-derived views (byProcess, mutatingKeys,
    // uiEffectsByKey) would silently miss it.
    const registry = new AgentToolRegistry();
    registerAgentTools(registry, createMockDeps());
    const registeredNames = registry.list().map((t) => t.name);
    const catalogNames = new Set(Object.keys(ToolCatalog.byKey));
    const missing = registeredNames.filter((name) => !catalogNames.has(name));
    expect(missing).toEqual([]);
  });

  it('ENTITY_REFRESH_TOOL_ENTITY matches catalog uiEffects', () => {
    // The renderer consumes a pure-data map (`ENTITY_REFRESH_TOOL_ENTITY`)
    // instead of pulling the full catalog through the main-only
    // `@lucid-fin/application` package. The two must stay in lock-step.
    const uiEffectsByKey = ToolCatalog.uiEffectsByKey as Readonly<
      Record<string, readonly { kind: string; entity?: string }[]>
    >;
    const catalogEntries: Record<string, string> = {};
    for (const [name, effects] of Object.entries(uiEffectsByKey)) {
      const refresh = effects.find((e) => e.kind === 'entity.refresh');
      if (refresh?.entity) catalogEntries[name] = refresh.entity;
    }
    expect(catalogEntries).toEqual(ENTITY_REFRESH_TOOL_ENTITY);
  });
});
