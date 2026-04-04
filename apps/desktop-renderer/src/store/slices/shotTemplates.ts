import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { BUILT_IN_SHOT_TEMPLATES, type ShotTemplate } from '@lucid-fin/contracts';

export interface ShotTemplatesState {
  builtIn: ShotTemplate[];
  custom: ShotTemplate[];
  loading: boolean;
}

const initialState: ShotTemplatesState = {
  builtIn: BUILT_IN_SHOT_TEMPLATES,
  custom: [],
  loading: false,
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
    removeCustomTemplate(state, action: PayloadAction<string>) {
      state.custom = state.custom.filter((t) => t.id !== action.payload);
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
  removeCustomTemplate,
} = shotTemplatesSlice.actions;
