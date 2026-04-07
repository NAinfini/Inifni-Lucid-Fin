import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  normalizeLLMProviderRuntimeConfig,
  type LLMProviderAuthStyle,
  type LLMProviderProtocol,
} from '@lucid-fin/contracts';

export type APIGroup = 'llm' | 'image' | 'video' | 'audio';
export type ProviderKind = 'official' | 'hub';

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  isCustom: boolean;
  protocol?: LLMProviderProtocol;
  authStyle?: LLMProviderAuthStyle;
}

export interface ProviderMetadata {
  kind: ProviderKind;
  docsUrl: string;
  keyUrl: string;
  modelExample?: string;
}

export type BuiltinProviderConfig = ProviderConfig & ProviderMetadata;

export interface ProviderCollectionConfig {
  providers: ProviderConfig[];
}

export interface SettingsState {
  llm: ProviderCollectionConfig;
  image: ProviderCollectionConfig;
  video: ProviderCollectionConfig;
  audio: ProviderCollectionConfig;
  renderPreset: string;
}

interface PersistedSettingsState {
  llm?: ProviderCollectionConfig & { activeProvider?: string };
  image?: ProviderCollectionConfig & { activeProvider?: string };
  video?: ProviderCollectionConfig & { activeProvider?: string };
  audio?: ProviderCollectionConfig & { activeProvider?: string };
  renderPreset?: string;
}

function createLLMProvider(
  provider: Omit<ProviderConfig, 'hasKey' | 'isCustom'> & ProviderMetadata,
): BuiltinProviderConfig {
  const runtime = normalizeLLMProviderRuntimeConfig({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
  });

  return {
    ...provider,
    protocol: runtime.protocol,
    authStyle: runtime.authStyle,
    hasKey: false,
    isCustom: false,
  };
}

function createProvider(
  provider: Omit<ProviderConfig, 'hasKey' | 'isCustom'> & ProviderMetadata,
): BuiltinProviderConfig {
  return {
    ...provider,
    hasKey: false,
    isCustom: false,
  };
}

export const PROVIDER_REGISTRY: Record<APIGroup, BuiltinProviderConfig[]> = {
  llm: [
    createLLMProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createLLMProvider({
      id: 'claude',
      name: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      protocol: 'anthropic',
      authStyle: 'x-api-key',
      kind: 'official',
      docsUrl: 'https://docs.anthropic.com/en/api/messages',
      keyUrl: 'https://console.anthropic.com/settings/keys',
    }),
    createLLMProvider({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      protocol: 'gemini',
      authStyle: 'x-goog-api-key',
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createLLMProvider({
      id: 'grok',
      name: 'xAI',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-3',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://docs.x.ai/docs/guides/chat-completions',
      keyUrl: 'https://console.x.ai/team/api-keys',
    }),
    createLLMProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://api-docs.deepseek.com/api/create-chat-completion',
      keyUrl: 'https://platform.deepseek.com/api_keys',
    }),
    createLLMProvider({
      id: 'mistral',
      name: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-large-latest',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://docs.mistral.ai/api',
      keyUrl: 'https://console.mistral.ai/api-keys/',
    }),
    createLLMProvider({
      id: 'cohere',
      name: 'Cohere',
      baseUrl: 'https://api.cohere.com/v2',
      model: 'command-a-03-2025',
      protocol: 'cohere',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://docs.cohere.com/',
      keyUrl: 'https://dashboard.cohere.com/api-keys',
    }),
    createLLMProvider({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-4o',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://openrouter.ai/docs/api-reference/chat-completion',
      keyUrl: 'https://openrouter.ai/settings/keys',
      modelExample: 'openai/gpt-4o',
    }),
    createLLMProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    }),
    createLLMProvider({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://console.groq.com/docs/openai',
      keyUrl: 'https://console.groq.com/keys',
      modelExample: 'llama-3.3-70b-versatile',
    }),
    createLLMProvider({
      id: 'qwen',
      name: 'Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
      keyUrl: 'https://bailian.console.aliyun.com/',
    }),
    createLLMProvider({
      id: 'ollama-local',
      name: 'Ollama (Local)',
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      protocol: 'openai-compatible',
      authStyle: 'none',
      kind: 'official',
      docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
      keyUrl: 'http://localhost:11434',
    }),
  ],
  image: [
    createProvider({
      id: 'openai-image',
      name: 'OpenAI GPT Image',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-1',
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createProvider({
      id: 'google-image',
      name: 'Google Imagen 4',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'imagen-4.0-generate-001',
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/imagen',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createProvider({
      id: 'recraft',
      name: 'Recraft',
      baseUrl: 'https://external.api.recraft.ai/v1',
      model: 'recraftv4',
      kind: 'official',
      docsUrl: 'https://developer.recraft.ai/',
      keyUrl: 'https://www.recraft.ai/account',
    }),
    createProvider({
      id: 'ideogram',
      name: 'Ideogram',
      baseUrl: 'https://api.ideogram.ai',
      model: 'ideogram-v3',
      kind: 'official',
      docsUrl: 'https://developer.ideogram.ai/',
      keyUrl: 'https://developer.ideogram.ai/',
    }),
    createProvider({
      id: 'replicate',
      name: 'Replicate',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'black-forest-labs/flux-1.1-pro',
      kind: 'hub',
      docsUrl: 'https://docs.replicate.com/get-started/http-api',
      keyUrl: 'https://replicate.com/account/api-tokens',
      modelExample: 'black-forest-labs/flux-1.1-pro',
    }),
    createProvider({
      id: 'fal',
      name: 'fal',
      baseUrl: 'https://fal.run/fal-ai/flux-pro/v1.1',
      model: 'fal-ai/flux-pro/v1.1',
      kind: 'hub',
      docsUrl: 'https://docs.fal.ai/model-apis',
      keyUrl: 'https://fal.ai/dashboard/keys',
      modelExample: 'fal-ai/flux-pro/v1.1',
    }),
    createProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'black-forest-labs/FLUX.1-schnell',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'black-forest-labs/FLUX.1-schnell',
    }),
  ],
  video: [
    createProvider({
      id: 'google-video',
      name: 'Google Veo',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'veo-3.0-generate-001',
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/video',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createProvider({
      id: 'runway',
      name: 'Runway',
      baseUrl: 'https://api.dev.runwayml.com/v1',
      model: 'gen4.5',
      kind: 'official',
      docsUrl: 'https://docs.dev.runwayml.com/api',
      keyUrl: 'https://docs.dev.runwayml.com/',
    }),
    createProvider({
      id: 'luma',
      name: 'Luma',
      baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
      model: 'ray-2',
      kind: 'official',
      docsUrl: 'https://docs.lumalabs.ai/docs/api',
      keyUrl: 'https://lumalabs.ai/dream-machine/api',
    }),
    createProvider({
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v1',
      model: 'T2V-02',
      kind: 'official',
      docsUrl: 'https://platform.minimax.io/docs/guides/video-generation',
      keyUrl: 'https://platform.minimaxi.com/api-key',
    }),
    createProvider({
      id: 'pika',
      name: 'Pika',
      baseUrl: 'https://api.pika.art/v1',
      model: 'pika-2.5',
      kind: 'official',
      docsUrl: 'https://pika.art/api',
      keyUrl: 'https://dev.pika.art/',
    }),
    createProvider({
      id: 'replicate',
      name: 'Replicate',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'minimax/video-01',
      kind: 'hub',
      docsUrl: 'https://docs.replicate.com/get-started/http-api',
      keyUrl: 'https://replicate.com/account/api-tokens',
      modelExample: 'minimax/video-01',
    }),
    createProvider({
      id: 'fal',
      name: 'fal',
      baseUrl: 'https://fal.run/fal-ai/minimax/video-01',
      model: 'fal-ai/minimax/video-01',
      kind: 'hub',
      docsUrl: 'https://docs.fal.ai/model-apis',
      keyUrl: 'https://fal.ai/dashboard/keys',
      modelExample: 'fal-ai/minimax/video-01',
    }),
    createProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: '',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
      keyUrl: 'https://api.together.ai/settings/api-keys',
    }),
  ],
  audio: [
    createProvider({
      id: 'openai-tts',
      name: 'OpenAI TTS',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-tts',
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createProvider({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      baseUrl: 'https://api.elevenlabs.io/v1',
      model: 'eleven_v3',
      kind: 'official',
      docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech',
      keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    }),
    createProvider({
      id: 'cartesia',
      name: 'Cartesia',
      baseUrl: 'https://api.cartesia.ai',
      model: 'sonic-3',
      kind: 'official',
      docsUrl: 'https://docs.cartesia.ai/api-reference/tts/sse',
      keyUrl: 'https://play.cartesia.ai/keys',
    }),
    createProvider({
      id: 'playht',
      name: 'PlayHT',
      baseUrl: 'https://api.play.ht/api/v2',
      model: 'PlayDialog',
      kind: 'official',
      docsUrl: 'https://docs.play.ht/',
      keyUrl: 'https://play.ht/studio/api-access',
    }),
    createProvider({
      id: 'fish-audio',
      name: 'Fish Audio',
      baseUrl: 'https://api.fish.audio/v1',
      model: 's2-pro',
      kind: 'official',
      docsUrl: 'https://docs.fish.audio/',
      keyUrl: 'https://fish.audio/dashboard',
    }),
    createProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: '',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
      keyUrl: 'https://api.together.ai/settings/api-keys',
    }),
    createProvider({
      id: 'replicate',
      name: 'Replicate',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'suno-ai/bark',
      kind: 'hub',
      docsUrl: 'https://docs.replicate.com/get-started/http-api',
      keyUrl: 'https://replicate.com/account/api-tokens',
      modelExample: 'suno-ai/bark',
    }),
    createProvider({
      id: 'fal',
      name: 'fal',
      baseUrl: 'https://fal.run/fal-ai/stable-audio',
      model: 'fal-ai/stable-audio',
      kind: 'hub',
      docsUrl: 'https://docs.fal.ai/model-apis',
      keyUrl: 'https://fal.ai/dashboard/keys',
      modelExample: 'fal-ai/stable-audio',
    }),
  ],
};

function toProviderConfig(provider: BuiltinProviderConfig): ProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    hasKey: false,
    isCustom: false,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
  };
}

function getDefaultProviders(group: APIGroup): ProviderConfig[] {
  return PROVIDER_REGISTRY[group].map((provider) => ({ ...toProviderConfig(provider) }));
}

function createInitialState(): SettingsState {
  return {
    llm: { providers: getDefaultProviders('llm') },
    image: { providers: getDefaultProviders('image') },
    video: { providers: getDefaultProviders('video') },
    audio: { providers: getDefaultProviders('audio') },
    renderPreset: 'standard',
  };
}

const initialState = createInitialState();

export function getProviderMetadata(
  group: APIGroup,
  providerId: string,
): ProviderMetadata | undefined {
  const provider = PROVIDER_REGISTRY[group].find((entry) => entry.id === providerId);
  if (!provider) {
    return undefined;
  }

  return {
    kind: provider.kind,
    docsUrl: provider.docsUrl,
    keyUrl: provider.keyUrl,
    modelExample: provider.modelExample,
  };
}

function findProvider(
  groupState: ProviderCollectionConfig,
  providerId: string,
): ProviderConfig | undefined {
  return groupState.providers.find((provider) => provider.id === providerId);
}

function cloneProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map((provider) => ({ ...provider }));
}

function normalizeSavedProvider(group: APIGroup, provider: ProviderConfig): ProviderConfig {
  if (group !== 'llm') {
    return { ...provider };
  }

  const runtime = normalizeLLMProviderRuntimeConfig({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
  });

  return {
    ...provider,
    protocol: runtime.protocol,
    authStyle: runtime.authStyle,
  };
}

function mergeProviderDefaults(
  group: APIGroup,
  savedGroup?: ProviderCollectionConfig & { activeProvider?: string },
): ProviderCollectionConfig {
  const defaults = getDefaultProviders(group);
  const savedProviders = savedGroup?.providers ?? [];
  const customProviders = savedProviders
    .filter((provider) => provider.isCustom)
    .filter((provider, index, all) => all.findIndex((entry) => entry.id === provider.id) === index)
    .filter((provider) => !defaults.some((entry) => entry.id === provider.id))
    .map((provider) => normalizeSavedProvider(group, provider));
  const providers = [...cloneProviders(defaults), ...customProviders];

  return { providers };
}

function mergeSavedSettings(saved: PersistedSettingsState): SettingsState {
  return {
    llm: mergeProviderDefaults('llm', saved.llm),
    image: mergeProviderDefaults('image', saved.image),
    video: mergeProviderDefaults('video', saved.video),
    audio: mergeProviderDefaults('audio', saved.audio),
    renderPreset: saved.renderPreset ?? initialState.renderPreset,
  };
}

export const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setProviderBaseUrl(
      state,
      action: PayloadAction<{ group: APIGroup; provider: string; url: string }>,
    ) {
      const provider = findProvider(state[action.payload.group], action.payload.provider);
      if (provider) {
        provider.baseUrl = action.payload.url;
      }
    },
    setProviderModel(
      state,
      action: PayloadAction<{ group: APIGroup; provider: string; model: string }>,
    ) {
      const provider = findProvider(state[action.payload.group], action.payload.provider);
      if (provider) {
        provider.model = action.payload.model;
      }
    },
    setProviderProtocol(
      state,
      action: PayloadAction<{
        group: APIGroup;
        provider: string;
        protocol: LLMProviderProtocol;
      }>,
    ) {
      if (action.payload.group !== 'llm') {
        return;
      }

      const provider = findProvider(state.llm, action.payload.provider);
      if (!provider) {
        return;
      }

      const runtime = normalizeLLMProviderRuntimeConfig({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        model: provider.model,
        protocol: action.payload.protocol,
      });

      provider.protocol = runtime.protocol;
      provider.authStyle = runtime.authStyle;
    },
    setProviderHasKey(
      state,
      action: PayloadAction<{ group: APIGroup; provider: string; hasKey: boolean }>,
    ) {
      const provider = findProvider(state[action.payload.group], action.payload.provider);
      if (provider) {
        provider.hasKey = action.payload.hasKey;
      }
    },
    setProviderName(
      state,
      action: PayloadAction<{ group: APIGroup; provider: string; name: string }>,
    ) {
      const provider = findProvider(state[action.payload.group], action.payload.provider);
      if (provider?.isCustom) {
        provider.name = action.payload.name;
      }
    },
    addCustomProvider(
      state,
      action: PayloadAction<{
        group: APIGroup;
        id: string;
        name: string;
        baseUrl?: string;
        model?: string;
      }>,
    ) {
      const runtime =
        action.payload.group === 'llm'
          ? normalizeLLMProviderRuntimeConfig({
              id: action.payload.id,
              name: action.payload.name,
              baseUrl: action.payload.baseUrl ?? '',
              model: action.payload.model ?? '',
            })
          : undefined;

      state[action.payload.group].providers.push({
        id: action.payload.id,
        name: action.payload.name,
        baseUrl: action.payload.baseUrl ?? '',
        model: action.payload.model ?? '',
        hasKey: false,
        isCustom: true,
        protocol: runtime?.protocol,
        authStyle: runtime?.authStyle,
      });
    },
    removeCustomProvider(state, action: PayloadAction<{ group: APIGroup; provider: string }>) {
      const groupState = state[action.payload.group];
      const provider = findProvider(groupState, action.payload.provider);
      if (!provider?.isCustom) {
        return;
      }

      groupState.providers = groupState.providers.filter(
        (entry) => entry.id !== action.payload.provider,
      );
    },
    setRenderPreset(state, action: PayloadAction<string>) {
      state.renderPreset = action.payload;
    },
    // Legacy compat - keep slice compiling with old index.ts exports
    setActiveProvider() {},
    setProviders() {},
    toggleProvider() {},
    restore(_state, action: PayloadAction<PersistedSettingsState>) {
      return mergeSavedSettings(action.payload);
    },
  },
});

export const {
  setProviderBaseUrl,
  setProviderModel,
  setProviderProtocol,
  setProviderHasKey,
  setProviderName,
  addCustomProvider,
  removeCustomProvider,
  setRenderPreset,
  setProviders,
  toggleProvider,
  restore,
} = settingsSlice.actions;
