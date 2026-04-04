import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type APIGroup = 'llm' | 'image' | 'video' | 'audio';

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  isCustom: boolean;
}

export interface APIGroupConfig {
  providers: ProviderConfig[];
  activeProvider: string;
}

export interface SettingsState {
  llm: APIGroupConfig;
  image: APIGroupConfig;
  video: APIGroupConfig;
  audio: APIGroupConfig;
  renderPreset: string;
}

const DEFAULT_ACTIVE_PROVIDERS: Record<APIGroup, string> = {
  llm: 'openai',
  image: 'openai-image',
  video: 'google-veo-2',
  audio: 'elevenlabs',
};

const DEFAULT_PROVIDERS: Record<APIGroup, ProviderConfig[]> = {
  llm: [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.4', hasKey: false, isCustom: false },
    { id: 'claude', name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-4-6', hasKey: false, isCustom: false },
    { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', hasKey: false, isCustom: false },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', hasKey: false, isCustom: false },
    { id: 'grok', name: 'Grok (xAI)', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.20', hasKey: false, isCustom: false },
  ],
  image: [
    { id: 'openai-image', name: 'OpenAI GPT Image', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5', hasKey: false, isCustom: false },
    { id: 'google-imagen3', name: 'Google Imagen 4', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'imagen-4.0-ultra-generate-001', hasKey: false, isCustom: false },
    { id: 'flux', name: 'FLUX.2 Pro (BFL)', baseUrl: 'https://api.bfl.ml', model: 'FLUX.2-pro', hasKey: false, isCustom: false },
    { id: 'recraft-v4', name: 'Recraft V4', baseUrl: 'https://external.api.recraft.ai/v1', model: 'recraftv4', hasKey: false, isCustom: false },
    { id: 'stability-image', name: 'Stability Image Core', baseUrl: 'https://api.stability.ai', model: 'stable-image-core', hasKey: false, isCustom: false },
  ],
  video: [
    { id: 'google-veo-2', name: 'Google Veo 3.1', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'veo-3.1-generate-preview', hasKey: false, isCustom: false },
    { id: 'runway-gen4', name: 'Runway Gen-4.5', baseUrl: 'https://api.dev.runwayml.com/v1', model: 'gen4.5', hasKey: false, isCustom: false },
    { id: 'luma-ray2', name: 'Luma Ray 2', baseUrl: 'https://api.lumalabs.ai/dream-machine/v1', model: 'ray-2', hasKey: false, isCustom: false },
    { id: 'minimax-video01', name: 'MiniMax Hailuo 2.3', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Hailuo-2.3', hasKey: false, isCustom: false },
    { id: 'pika-v2', name: 'Pika 2.5', baseUrl: 'https://api.pika.art/v1', model: 'pika-2.5', hasKey: false, isCustom: false },
  ],
  audio: [
    { id: 'elevenlabs', name: 'ElevenLabs', baseUrl: 'https://api.elevenlabs.io', model: 'eleven_v3', hasKey: false, isCustom: false },
    { id: 'fish-audio-v1', name: 'Fish Audio', baseUrl: 'https://api.fish.audio/v1', model: 's2-pro', hasKey: false, isCustom: false },
    { id: 'cartesia-sonic', name: 'Cartesia Sonic', baseUrl: 'https://api.cartesia.ai', model: 'sonic-3', hasKey: false, isCustom: false },
    { id: 'playht-3', name: 'PlayAI', baseUrl: 'https://api.play.ht/api/v2', model: 'PlayDialog', hasKey: false, isCustom: false },
    { id: 'openai-tts', name: 'OpenAI TTS', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', hasKey: false, isCustom: false },
  ],
};

const initialState: SettingsState = {
  llm: { providers: DEFAULT_PROVIDERS.llm, activeProvider: 'openai' },
  image: { providers: DEFAULT_PROVIDERS.image, activeProvider: 'openai-image' },
  video: { providers: DEFAULT_PROVIDERS.video, activeProvider: 'google-veo-2' },
  audio: { providers: DEFAULT_PROVIDERS.audio, activeProvider: 'elevenlabs' },
  renderPreset: 'standard',
};

function findProvider(groupState: APIGroupConfig, providerId: string): ProviderConfig | undefined {
  return groupState.providers.find((p) => p.id === providerId);
}

function cloneProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map((provider) => ({ ...provider }));
}

function mergeGroupDefaults(
  group: APIGroup,
  savedGroup?: APIGroupConfig,
): APIGroupConfig {
  const defaults = cloneProviders(DEFAULT_PROVIDERS[group]);
  const savedProviders = savedGroup?.providers ?? [];
  const customProviders = savedProviders
    .filter((provider) => provider.isCustom)
    .filter((provider, index, all) => all.findIndex((entry) => entry.id === provider.id) === index)
    .map((provider) => ({ ...provider }));
  const providers = [...defaults, ...customProviders];
  const activeProvider = providers.some((provider) => provider.id === savedGroup?.activeProvider)
    ? (savedGroup?.activeProvider as string)
    : DEFAULT_ACTIVE_PROVIDERS[group];

  return { providers, activeProvider };
}

function mergeSavedSettings(saved: SettingsState): SettingsState {
  return {
    llm: mergeGroupDefaults('llm', saved.llm),
    image: mergeGroupDefaults('image', saved.image),
    video: mergeGroupDefaults('video', saved.video),
    audio: mergeGroupDefaults('audio', saved.audio),
    renderPreset: saved.renderPreset ?? initialState.renderPreset,
  };
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setActiveProvider(state, action: PayloadAction<{ group: APIGroup; provider: string }>) {
      state[action.payload.group].activeProvider = action.payload.provider;
    },
    setProviderBaseUrl(state, action: PayloadAction<{ group: APIGroup; provider: string; url: string }>) {
      const p = findProvider(state[action.payload.group], action.payload.provider);
      if (p) p.baseUrl = action.payload.url;
    },
    setProviderModel(state, action: PayloadAction<{ group: APIGroup; provider: string; model: string }>) {
      const p = findProvider(state[action.payload.group], action.payload.provider);
      if (p) p.model = action.payload.model;
    },
    setProviderHasKey(state, action: PayloadAction<{ group: APIGroup; provider: string; hasKey: boolean }>) {
      const p = findProvider(state[action.payload.group], action.payload.provider);
      if (p) p.hasKey = action.payload.hasKey;
    },
    setProviderName(state, action: PayloadAction<{ group: APIGroup; provider: string; name: string }>) {
      const p = findProvider(state[action.payload.group], action.payload.provider);
      if (p?.isCustom) p.name = action.payload.name;
    },
    addCustomProvider(state, action: PayloadAction<{ group: APIGroup; id: string; name: string }>) {
      state[action.payload.group].providers.push({
        id: action.payload.id,
        name: action.payload.name,
        baseUrl: '',
        model: '',
        hasKey: false,
        isCustom: true,
      });
    },
    removeCustomProvider(state, action: PayloadAction<{ group: APIGroup; provider: string }>) {
      const groupState = state[action.payload.group];
      const p = findProvider(groupState, action.payload.provider);
      if (!p?.isCustom) return;
      groupState.providers = groupState.providers.filter((x) => x.id !== action.payload.provider);
      if (groupState.activeProvider === action.payload.provider) {
        groupState.activeProvider = groupState.providers[0]?.id ?? '';
      }
    },
    setRenderPreset(state, action: PayloadAction<string>) {
      state.renderPreset = action.payload;
    },
    // Legacy compat — keep slice compiling with old index.ts exports
    setProviders() {},
    toggleProvider() {},
    restore(_state, action: PayloadAction<SettingsState>) {
      return mergeSavedSettings(action.payload);
    },
  },
});

export const {
  setActiveProvider,
  setProviderBaseUrl,
  setProviderModel,
  setProviderHasKey,
  setProviderName,
  addCustomProvider,
  removeCustomProvider,
  setRenderPreset,
  setProviders,
  toggleProvider,
  restore,
} = settingsSlice.actions;
