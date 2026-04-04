import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PresetCategory, PresetDefinition } from '@lucid-fin/contracts';

export interface PresetsState {
  byId: Record<string, PresetDefinition>;
  allIds: string[];
  loading: boolean;
  search: string;
  selectedCategory: PresetCategory | 'all';
  managerSelectedPresetId: string | null;
}

const initialState: PresetsState = {
  byId: {},
  allIds: [],
  loading: false,
  search: '',
  selectedCategory: 'all',
  managerSelectedPresetId: null,
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
} = presetsSlice.actions;

