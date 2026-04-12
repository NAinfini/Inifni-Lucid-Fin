import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PresetCategory, PresetDefinition } from '@lucid-fin/contracts';

export interface PresetsState {
  byId: Record<string, PresetDefinition>;
  allIds: string[];
  loading: boolean;
  search: string;
  selectedCategory: PresetCategory | 'all';
  managerSelectedPresetId: string | null;
  hiddenIds: string[];
}

const initialState: PresetsState = {
  byId: {},
  allIds: [],
  loading: false,
  search: '',
  selectedCategory: 'all',
  managerSelectedPresetId: null,
  hiddenIds: [],
};

export const presetsSlice = createSlice({
  name: 'presets',
  initialState,
  reducers: {
    setPresets(state, action: PayloadAction<PresetDefinition[]>) {
      state.byId = {};
      state.allIds = [];
      for (const preset of action.payload) {
        state.byId[preset.id] = preset;
        state.allIds.push(preset.id);
      }
      if (state.managerSelectedPresetId && !state.byId[state.managerSelectedPresetId]) {
        state.managerSelectedPresetId = state.allIds[0] ?? null;
      }
    },
    upsertPreset(state, action: PayloadAction<PresetDefinition>) {
      const preset = action.payload;
      const existing = state.byId[preset.id];
      state.byId[preset.id] = preset;
      if (!existing) {
        state.allIds.push(preset.id);
      }
      if (!state.managerSelectedPresetId) {
        state.managerSelectedPresetId = preset.id;
      }
    },
    removePreset(state, action: PayloadAction<string>) {
      const id = action.payload;
      delete state.byId[id];
      state.allIds = state.allIds.filter((item) => item !== id);
      if (state.managerSelectedPresetId === id) {
        state.managerSelectedPresetId = state.allIds[0] ?? null;
      }
    },
    setPresetsLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setPresetsSearch(state, action: PayloadAction<string>) {
      state.search = action.payload;
    },
    setPresetsCategoryFilter(state, action: PayloadAction<PresetCategory | 'all'>) {
      state.selectedCategory = action.payload;
    },
    selectManagerPreset(state, action: PayloadAction<string | null>) {
      state.managerSelectedPresetId = action.payload;
    },
    togglePresetHidden(state, action: PayloadAction<string>) {
      const id = action.payload;
      const idx = state.hiddenIds.indexOf(id);
      if (idx === -1) state.hiddenIds.push(id);
      else state.hiddenIds.splice(idx, 1);
    },
    restore(_state, action: PayloadAction<PresetsState>) {
      return action.payload;
    },
  },
});

export const {
  setPresets,
  upsertPreset,
  removePreset,
  setPresetsLoading,
  setPresetsSearch,
  setPresetsCategoryFilter,
  selectManagerPreset,
  togglePresetHidden,
} = presetsSlice.actions;

const selectPresetIds = (state: { presets: PresetsState }) => state.presets.allIds;
const selectPresetById = (state: { presets: PresetsState }) => state.presets.byId;

export const selectPresetList = createSelector(
  [selectPresetIds, selectPresetById],
  (allIds, byId) => {
    const presets: PresetDefinition[] = [];
    for (const id of allIds) {
      const preset = byId[id];
      if (preset) {
        presets.push(preset);
      }
    }
    return presets;
  },
);
