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
    await expect(getTool('preset.reset', deps).execute({ presetId: 'preset-2', scope: 'params' })).resolves.toEqual({
      success: true,
      data: { ...preset, id: 'preset-2' },
    });
    await expect(getTool('preset.delete', deps).execute({ presetId: 'preset-3' })).resolves.toEqual({
      success: true,
      data: { presetId: 'preset-3' },
    });
    await expect(getTool('preset.get', deps).execute({ presetId: 'preset-1' })).resolves.toEqual({
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
      error: 'preset is required',
    });
    await expect(getTool('preset.reset', deps).execute({ presetId: 'preset-1', scope: 'bad' })).resolves.toEqual({
      success: false,
      error: 'scope must be one of all, prompt, or params',
    });
    await expect(getTool('preset.get', deps).execute({ presetId: 'missing' })).resolves.toEqual({
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
});
