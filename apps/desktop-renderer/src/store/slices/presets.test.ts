import { describe, expect, it } from 'vitest';
import type { PresetDefinition } from '@lucid-fin/contracts';
import {
  presetsSlice,
  removePreset,
  selectManagerPreset,
  setPresets,
  setPresetsCategoryFilter,
  setPresetsSearch,
  upsertPreset,
} from './presets.js';

function makePreset(overrides: Partial<PresetDefinition>): PresetDefinition {
  return {
    id: overrides.id ?? 'preset-1',
    name: overrides.name ?? 'Cinematic',
    category: overrides.category ?? 'look',
    description: overrides.description ?? 'Cinematic style',
    prompt: overrides.prompt ?? 'cinematic style',
    builtIn: overrides.builtIn ?? true,
    modified: overrides.modified ?? false,
    params:
      overrides.params ?? [
        {
          key: 'stylization',
          label: 'Stylization',
          type: 'number',
          min: 0,
          max: 100,
          defaultValue: 65,
        },
      ],
    defaults: overrides.defaults ?? { stylization: 65 },
    ...overrides,
  };
}

describe('presetsSlice', () => {
  it('sets and upserts presets while preserving selection semantics', () => {
    const presetA = makePreset({ id: 'preset-a', name: 'Preset A' });
    const presetB = makePreset({ id: 'preset-b', name: 'Preset B', category: 'camera' });

    let state = presetsSlice.reducer(undefined, setPresets([presetA]));
    expect(state.allIds).toEqual(['preset-a']);
    expect(state.byId['preset-a']).toEqual(presetA);

    state = presetsSlice.reducer(state, selectManagerPreset('preset-a'));
    state = presetsSlice.reducer(state, upsertPreset(presetB));

    expect(state.allIds).toEqual(['preset-a', 'preset-b']);
    expect(state.byId['preset-b']).toEqual(presetB);
    expect(state.managerSelectedPresetId).toBe('preset-a');
  });

  it('removes presets and updates selected filter/search state', () => {
    const presetA = makePreset({ id: 'preset-a' });
    const presetB = makePreset({ id: 'preset-b', category: 'camera' });

    let state = presetsSlice.reducer(undefined, setPresets([presetA, presetB]));
    state = presetsSlice.reducer(state, selectManagerPreset('preset-b'));
    state = presetsSlice.reducer(state, setPresetsSearch('camera'));
    state = presetsSlice.reducer(state, setPresetsCategoryFilter('camera'));
    state = presetsSlice.reducer(state, removePreset('preset-b'));

    expect(state.byId['preset-b']).toBeUndefined();
    expect(state.allIds).toEqual(['preset-a']);
    expect(state.managerSelectedPresetId).toBe('preset-a');
    expect(state.search).toBe('camera');
    expect(state.selectedCategory).toBe('camera');
  });
});
