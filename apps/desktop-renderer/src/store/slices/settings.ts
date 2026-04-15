import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { StyleGuide } from '@lucid-fin/contracts';

// Re-export types so all consumers can keep importing from this file
export type {
  APIGroup,
  BuiltinProviderConfig,
  PersistedSettingsState,
  ProductionConfig,
  ProviderCollectionConfig,
  ProviderConfig,
  ProviderKind,
  ProviderMetadata,
  SettingsState,
  UsageStats,
} from './settings/types.js';

import type { PersistedSettingsState, ProductionConfig, SettingsState } from './settings/types.js';

// Re-export provider-defaults helpers
export {
  getDefaultProviders,
  getProviderDefaults,
  getProviderMetadata,
  PROVIDER_REGISTRY,
} from './settings/provider-defaults.js';

// Re-export persistence
export { buildSparseSettings } from './settings/persistence.js';
export type { SparseSettingsState } from './settings/persistence.js';

// Re-export default usage stats
export { DEFAULT_USAGE_STATS } from './settings/telemetry-reducers.js';

// Import all reducer implementations
import * as providerReducers from './settings/provider-reducers.js';
import * as telemetryReducers from './settings/telemetry-reducers.js';
import { getDefaultProviders, mergeSavedSettings } from './settings/provider-defaults.js';
import { DEFAULT_USAGE_STATS } from './settings/telemetry-reducers.js';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function createInitialState(): SettingsState {
  return {
    llm: { providers: getDefaultProviders('llm') },
    image: { providers: getDefaultProviders('image') },
    video: { providers: getDefaultProviders('video') },
    audio: { providers: getDefaultProviders('audio') },
    vision: { providers: getDefaultProviders('vision') },
    renderPreset: 'standard',
    usage: DEFAULT_USAGE_STATS,
    availableUpdate: null,
    production: {
      title: 'Untitled',
      description: '',
      genre: '',
      resolution: [1920, 1080] as [number, number],
      fps: 24,
      aspectRatio: '16:9',
    },
    styleGuide: {
      global: {
        artStyle: '',
        colorPalette: { primary: '', secondary: '', forbidden: [] },
        lighting: 'natural',
        texture: '',
        referenceImages: [],
        freeformDescription: '',
      },
      sceneOverrides: {},
    },
    bootstrapped: false,
  };
}

const initialState = createInitialState();

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    // Provider reducers
    setProviderBaseUrl: providerReducers.setProviderBaseUrl,
    setProviderModel: providerReducers.setProviderModel,
    setProviderProtocol: providerReducers.setProviderProtocol,
    setProviderHasKey: providerReducers.setProviderHasKey,
    setProviderName: providerReducers.setProviderName,
    commitProvider: providerReducers.commitProvider,
    resetProviderToDefaults: providerReducers.resetProviderToDefaults,
    addCustomProvider: providerReducers.addCustomProvider,
    removeCustomProvider: providerReducers.removeCustomProvider,
    setDefaultProvider: providerReducers.setDefaultProvider,

    // Telemetry reducers
    recordToolCall: telemetryReducers.recordToolCall,
    recordSession: telemetryReducers.recordSession,
    recordGeneration: telemetryReducers.recordGeneration,
    recordProviderRequest: telemetryReducers.recordProviderRequest,
    recordProjectActivity: telemetryReducers.recordProjectActivity,
    updateDailyActive: telemetryReducers.updateDailyActive,
    recordPrompt: telemetryReducers.recordPrompt,
    recordEntityCreate: telemetryReducers.recordEntityCreate,
    recordEntityEdit: telemetryReducers.recordEntityEdit,
    recordPresetChange: telemetryReducers.recordPresetChange,
    recordShotCreate: telemetryReducers.recordShotCreate,
    recordSceneCreate: telemetryReducers.recordSceneCreate,
    recordExport: telemetryReducers.recordExport,
    recordUndo: telemetryReducers.recordUndo,
    recordRedo: telemetryReducers.recordRedo,
    recordFeatureUsed: telemetryReducers.recordFeatureUsed,
    recordError: telemetryReducers.recordError,
    recordTokenUsage: telemetryReducers.recordTokenUsage,

    // Production / app reducers (small enough to stay inline)
    setRenderPreset(state, action: PayloadAction<string>) {
      state.renderPreset = action.payload;
    },
    setAvailableUpdate(state, action: PayloadAction<string | null>) {
      state.availableUpdate = action.payload;
    },
    setProduction(state, action: PayloadAction<ProductionConfig>) {
      state.production = action.payload;
    },
    updateProduction(state, action: PayloadAction<Partial<ProductionConfig>>) {
      Object.assign(state.production, action.payload);
    },
    setStyleGuide(state, action: PayloadAction<StyleGuide>) {
      state.styleGuide = action.payload;
    },
    setBootstrapped(state) {
      state.bootstrapped = true;
    },

    // Legacy compat - keep slice compiling with old index.ts exports
    setActiveProvider() {},
    setProviders() {},
    toggleProvider() {},

    restore(_state, action: PayloadAction<PersistedSettingsState>) {
      return mergeSavedSettings(action.payload, initialState);
    },
  },
});

// ---------------------------------------------------------------------------
// Action exports -- SAME names as before
// ---------------------------------------------------------------------------

export const {
  commitProvider,
  setProviderBaseUrl,
  setProviderModel,
  setProviderProtocol,
  setProviderHasKey,
  setProviderName,
  resetProviderToDefaults,
  addCustomProvider,
  removeCustomProvider,
  setDefaultProvider,
  setRenderPreset,
  recordToolCall,
  recordSession,
  recordGeneration,
  recordProviderRequest,
  recordProjectActivity,
  updateDailyActive,
  recordPrompt,
  recordEntityCreate,
  recordEntityEdit,
  recordPresetChange,
  recordShotCreate,
  recordSceneCreate,
  recordExport,
  recordUndo,
  recordRedo,
  recordFeatureUsed,
  recordError,
  recordTokenUsage,
  setAvailableUpdate,
  setProduction,
  updateProduction,
  setStyleGuide,
  setBootstrapped,
  setProviders,
  toggleProvider,
  restore,
} = settingsSlice.actions;
