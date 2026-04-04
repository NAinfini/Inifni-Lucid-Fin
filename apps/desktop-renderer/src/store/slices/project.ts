import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ProjectManifest, ProviderConfig, StyleGuide, Snapshot } from '@lucid-fin/contracts';

export interface ProjectState {
  id: string;
  title: string;
  description: string;
  genre: string;
  resolution: [number, number];
  fps: number;
  aspectRatio: string;
  createdAt: number;
  updatedAt: number;
  seriesId?: string;
  aiProviders: ProviderConfig[];
  snapshots: Snapshot[];
  styleGuide: StyleGuide;
  path: string;
  loaded: boolean;
}

const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};

const initialState: ProjectState = {
  id: '',
  title: '',
  description: '',
  genre: '',
  resolution: [1920, 1080],
  fps: 24,
  aspectRatio: '16:9',
  createdAt: 0,
  updatedAt: 0,
  aiProviders: [],
  snapshots: [],
  styleGuide: DEFAULT_STYLE_GUIDE,
  path: '',
  loaded: false,
};

export const projectSlice = createSlice({
  name: 'project',
  initialState,
  reducers: {
    setProject(state, action: PayloadAction<ProjectManifest & { path: string }>) {
      const { path, ...manifest } = action.payload;
      Object.assign(state, manifest, { path, loaded: true });
    },
    clearProject() {
      return { ...initialState };
    },
    updateProjectTitle(state, action: PayloadAction<string>) {
      state.title = action.payload;
      state.updatedAt = Date.now();
    },
    updateProjectStyleGuide(state, action: PayloadAction<StyleGuide>) {
      state.styleGuide = action.payload;
      state.updatedAt = Date.now();
    },
    setAiProviders(state, action: PayloadAction<ProviderConfig[]>) {
      state.aiProviders = action.payload;
      state.updatedAt = Date.now();
    },
    addSnapshot(state, action: PayloadAction<Snapshot>) {
      state.snapshots.push(action.payload);
    },
    removeSnapshot(state, action: PayloadAction<string>) {
      state.snapshots = state.snapshots.filter((s) => s.id !== action.payload);
    },
  },
});

export const {
  setProject,
  clearProject,
  updateProjectTitle,
  updateProjectStyleGuide,
  setAiProviders,
  addSnapshot,
  removeSnapshot,
} = projectSlice.actions;
