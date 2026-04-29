import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { BUILT_IN_SHOT_TEMPLATES, type ShotTemplate } from '@lucid-fin/contracts';

export interface ShotTemplatesState {
  builtIn: ShotTemplate[];
  custom: ShotTemplate[];
  loading: boolean;
  hiddenIds: string[];
}

const initialState: ShotTemplatesState = {
  builtIn: BUILT_IN_SHOT_TEMPLATES,
  custom: [],
  loading: false,
  hiddenIds: [],
};

export const shotTemplatesSlice = createSlice({
  name: 'shotTemplates',
  initialState,
  reducers: {
    setCustomTemplates(state, action: PayloadAction<ShotTemplate[]>) {
      state.custom = action.payload;
    },
    addCustomTemplate(state, action: PayloadAction<ShotTemplate>) {
      state.custom.push(action.payload);
    },
    updateCustomTemplate(
      state,
      action: PayloadAction<{
        id: string;
        changes: Partial<Pick<ShotTemplate, 'name' | 'description'>>;
      }>,
    ) {
      const template = state.custom.find((item) => item.id === action.payload.id);
      if (!template) return;
      Object.assign(template, action.payload.changes);
    },
    removeCustomTemplate(state, action: PayloadAction<string>) {
      state.custom = state.custom.filter((t) => t.id !== action.payload);
    },
    updateCustomTemplateTracks(
      state,
      action: PayloadAction<{ id: string; tracks: ShotTemplate['tracks'] }>,
    ) {
      const template = state.custom.find((t) => t.id === action.payload.id);
      if (template) template.tracks = action.payload.tracks;
    },
    toggleTemplateHidden(state, action: PayloadAction<string>) {
      const id = action.payload;
      const idx = state.hiddenIds.indexOf(id);
      if (idx === -1) state.hiddenIds.push(id);
      else state.hiddenIds.splice(idx, 1);
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    restore(_state, action: PayloadAction<ShotTemplatesState>) {
      return action.payload;
    },
  },
});

export const {
  setCustomTemplates,
  addCustomTemplate,
  updateCustomTemplate,
  updateCustomTemplateTracks,
  removeCustomTemplate,
  toggleTemplateHidden,
} = shotTemplatesSlice.actions;
