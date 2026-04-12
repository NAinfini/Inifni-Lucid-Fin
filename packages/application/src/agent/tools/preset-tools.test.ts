import { describe, expect, it, vi } from 'vitest';
import type { PresetDefinition } from '@lucid-fin/contracts';
import { createPresetTools, type PresetToolDeps } from './preset-tools.js';

const preset: PresetDefinition = {
  id: 'preset-1',
  category: 'camera',
  name: 'Push In',
  description: 'Slow push in',
  prompt: 'camera push in',
  builtIn: true,
  modified: false,
  params: [],
  defaults: {},
};

function createDeps(): PresetToolDeps {
  return {
    listPresets: vi.fn(async () => [preset]),
    savePreset: vi.fn(async (value: PresetDefinition) => value),
    deletePreset: vi.fn(async () => undefined),
    resetPreset: vi.fn(async () => ({ ...preset, id: 'preset-2' })),
    getPreset: vi.fn(async (presetId: string) => (presetId === preset.id ? preset : null)),
  };
}

function getTool(name: string, deps: PresetToolDeps) {
  const tool = createPresetTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createPresetTools', () => {
  it('defines the expected preset tool set', () => {
    const deps = createDeps();
    const tools = createPresetTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'preset.list',
      'preset.save',
      'preset.delete',
      'preset.reset',
      'preset.get',
    ]);
  });

  it('lists, saves, resets, deletes, and gets presets', async () => {
    const deps = createDeps();

    await expect(getTool('preset.list', deps).execute({
      category: 'camera',
      offset: 0,
      limit: 1,
    })).resolves.toEqual({
      success: true,
      data: { total: 1, offset: 0, limit: 1, presets: [preset] },
    });
    expect(deps.listPresets).toHaveBeenCalledWith('camera');

    await expect(getTool('preset.save', deps).execute({ preset })).resolves.toEqual({
      success: true,
      data: preset,
    });

    // Custom preset creation mode (individual fields)
    const customResult = await getTool('preset.save', deps).execute({
      name: 'Dreamy Blur',
      category: 'look',
      description: 'Soft dreamlike atmosphere',
      prompt: 'dreamy blur and glow',
    });
    expect(customResult.success).toBe(true);
    expect(customResult.data).toMatchObject({
      category: 'look',
      name: 'Dreamy Blur',
      description: 'Soft dreamlike atmosphere',
      prompt: 'dreamy blur and glow',
      builtIn: false,
    });
    expect((customResult.data as PresetDefinition).id).toMatch(/^custom-/);

    await expect(getTool('preset.reset', deps).execute({ presetId: 'preset-2', scope: 'params' })).resolves.toEqual({
      success: true,
      data: { ...preset, id: 'preset-2' },
    });
    await expect(getTool('preset.delete', deps).execute({ presetId: 'preset-3' })).resolves.toEqual({
      success: true,
      data: { presetId: 'preset-3' },
    });
    await expect(getTool('preset.get', deps).execute({ ids: 'preset-1' })).resolves.toEqual({
      success: true,
      data: preset,
    });
  });

  it('validates category, preset payload, reset scope, and missing preset cases', async () => {
    const deps = createDeps();

    await expect(getTool('preset.list', deps).execute({ category: 'invalid' })).resolves.toEqual({
      success: false,
      error: 'category must be one of camera, lens, look, scene, composition, emotion, flow, technical',
    });
    await expect(getTool('preset.save', deps).execute({ preset: [] })).resolves.toEqual({
      success: false,
      error: 'Provide either a "preset" object or individual fields (name, category, description, prompt)',
    });
    await expect(getTool('preset.reset', deps).execute({ presetId: 'preset-1', scope: 'bad' })).resolves.toEqual({
      success: false,
      error: 'scope must be one of all, prompt, or params',
    });
    await expect(getTool('preset.get', deps).execute({ ids: 'missing' })).resolves.toEqual({
      success: false,
      error: 'Preset not found: missing',
    });
  });

  it('wraps dependency failures', async () => {
    const deps = createDeps();
    vi.mocked(deps.deletePreset).mockRejectedValueOnce(new Error('delete failed'));

    await expect(getTool('preset.delete', deps).execute({ presetId: 'preset-1' })).resolves.toEqual({
      success: false,
      error: 'delete failed',
    });
  });

  describe('preset.list query and categories filter', () => {
    const cameraPreset: PresetDefinition = { ...preset, id: 'p-camera', category: 'camera', name: 'Push In', description: 'Slow push in' };
    const lensPreset: PresetDefinition = { ...preset, id: 'p-lens', category: 'lens', name: 'Wide Angle', description: 'A wide field of view' };
    const lookPreset: PresetDefinition = { ...preset, id: 'p-look', category: 'look', name: 'Noir Style', description: 'Dark moody look' };

    function createMultiDeps(): PresetToolDeps {
      return {
        listPresets: vi.fn(async (category?: string) => {
          if (category === 'camera') return [cameraPreset];
          if (category === 'lens') return [lensPreset];
          if (category === 'look') return [lookPreset];
          return [cameraPreset, lensPreset, lookPreset];
        }),
        savePreset: vi.fn(async (value: PresetDefinition) => value),
        deletePreset: vi.fn(async () => undefined),
        resetPreset: vi.fn(async () => cameraPreset),
        getPreset: vi.fn(async () => null),
      };
    }

    it('returns all presets when no filter is provided', async () => {
      const deps = createMultiDeps();
      const result = await getTool('preset.list', deps).execute({});
      expect(result).toMatchObject({ success: true, data: { total: 3 } });
    });

    it('backward compat: category string filters correctly', async () => {
      const deps = createMultiDeps();
      const result = await getTool('preset.list', deps).execute({ category: 'lens' });
      expect(result).toMatchObject({ success: true, data: { total: 1, presets: [expect.objectContaining({ id: 'p-lens' })] } });
    });

    it('categories array OR-matches multiple categories', async () => {
      const deps = createMultiDeps();
      const result = await getTool('preset.list', deps).execute({ categories: ['camera', 'lens'] });
      expect(result).toMatchObject({ success: true, data: { total: 2 } });
      const data = (result as { success: true; data: { presets: { id: string }[] } }).data;
      expect(data.presets.map((p) => p.id)).toEqual(expect.arrayContaining(['p-camera', 'p-lens']));
    });

    it('query filters by name (case-insensitive)', async () => {
      const deps = createMultiDeps();
      const result = await getTool('preset.list', deps).execute({ query: 'noir' });
      expect(result).toMatchObject({ success: true, data: { total: 1, presets: [expect.objectContaining({ id: 'p-look' })] } });
    });

    it('query filters by description (OR logic)', async () => {
      const deps = createMultiDeps();
      const result = await getTool('preset.list', deps).execute({ query: 'wide' });
      expect(result).toMatchObject({ success: true, data: { total: 1, presets: [expect.objectContaining({ id: 'p-lens' })] } });
    });

    it('returns empty when query matches nothing', async () => {
      const deps = createMultiDeps();
      const result = await getTool('preset.list', deps).execute({ query: 'xyz123' });
      expect(result).toMatchObject({ success: true, data: { total: 0, presets: [] } });
    });
  });

  describe('preset.get batch support', () => {
    const preset2: PresetDefinition = { ...preset, id: 'preset-2', name: 'Crane Up' };

    function createBatchDeps(): PresetToolDeps {
      const store = new Map<string, PresetDefinition>([
        ['preset-1', preset],
        ['preset-2', preset2],
      ]);
      return {
        listPresets: vi.fn(async () => [preset, preset2]),
        savePreset: vi.fn(async (value: PresetDefinition) => value),
        deletePreset: vi.fn(async () => undefined),
        resetPreset: vi.fn(async () => preset),
        getPreset: vi.fn(async (id: string) => store.get(id) ?? null),
      };
    }

    it('single string ID returns single preset (backward compat)', async () => {
      const deps = createBatchDeps();
      const result = await getTool('preset.get', deps).execute({ ids: 'preset-1' });
      expect(result).toEqual({ success: true, data: preset });
    });

    it('array of IDs returns array of presets', async () => {
      const deps = createBatchDeps();
      const result = await getTool('preset.get', deps).execute({ ids: ['preset-1', 'preset-2'] });
      expect(result.success).toBe(true);
      const data = result.data as PresetDefinition[];
      expect(data).toHaveLength(2);
      expect(data.map((p) => p.id)).toEqual(['preset-1', 'preset-2']);
    });

    it('missing ID in batch returns error for first missing', async () => {
      const deps = createBatchDeps();
      const result = await getTool('preset.get', deps).execute({ ids: ['preset-1', 'missing'] });
      expect(result).toEqual({ success: false, error: 'Preset not found: missing' });
    });
  });
});

