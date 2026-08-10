import {
  type Capability,
  getBuiltinVideoProviderRuntimeMetadata,
  listBuiltinMediaProviders,
  type MediaProviderGroup,
  normalizeLLMProviderRuntimeConfig,
} from '@lucid-fin/contracts';
import type {
  APIGroup,
  BuiltinProviderConfig,
  PersistedSettingsState,
  ProviderConfig,
  ProviderCollectionConfig,
  ProviderMetadata,
  SettingsState,
} from './types.js';
import { DEFAULT_USAGE_STATS } from './telemetry-reducers.js';

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

type ProviderMetadataDefaults = Omit<ProviderMetadata, 'kind' | 'docsUrl' | 'keyUrl'>;
type ProviderDraft = Omit<ProviderConfig, 'hasKey' | 'isCustom'> &
  Pick<ProviderMetadata, 'kind' | 'docsUrl' | 'keyUrl'> &
  Partial<ProviderMetadataDefaults>;

// ---------------------------------------------------------------------------
// Default capability sets
// ---------------------------------------------------------------------------

const DEFAULT_LLM_CAPABILITIES: Capability[] = [
  'text-generation',
  'script-expand',
  'scene-breakdown',
  'character-extract',
  'prompt-enhance',
];

const HUB_MODEL_DEPENDENT_NOTE = 'Capabilities depend on selected model';

const DEFAULT_IMAGE_METADATA: ProviderMetadataDefaults = {
  capabilities: ['text-to-image'],
  defaultResolution: '1024x1024',
  outputFormats: ['png'],
};

const DEFAULT_VIDEO_METADATA: ProviderMetadataDefaults = {
  capabilities: ['text-to-video'],
  defaultDurationSeconds: 5,
  outputFormats: ['mp4'],
};

const DEFAULT_AUDIO_METADATA: ProviderMetadataDefaults = {
  capabilities: ['text-to-voice'],
  outputFormats: ['mp3'],
};

const DEFAULT_VISION_METADATA: ProviderMetadataDefaults = {
  capabilities: ['text-generation'],
};

// ---------------------------------------------------------------------------
// Provider factory helpers
// ---------------------------------------------------------------------------

function normalizeMetadata(
  provider: ProviderDraft,
  defaults: ProviderMetadataDefaults,
): ProviderMetadata {
  const capabilities = provider.capabilities ?? defaults.capabilities;
  const supportsReferenceImageByCapability =
    capabilities.includes('image-to-image') || capabilities.includes('image-to-video');
  const supportsReferenceImage =
    provider.supportsReferenceImage ??
    defaults.supportsReferenceImage ??
    supportsReferenceImageByCapability;

  return {
    kind: provider.kind,
    docsUrl: provider.docsUrl,
    keyUrl: provider.keyUrl,
    credentialMode: provider.credentialMode,
    oauthTarget: provider.oauthTarget,
    supportsVision: provider.capabilities?.includes('image-understanding'),
    modelExample: provider.modelExample,
    capabilities,
    supportsReferenceImage,
    supportsAudio: provider.supportsAudio,
    qualityTiers: provider.qualityTiers,
    defaultResolution: provider.defaultResolution ?? defaults.defaultResolution,
    defaultDurationSeconds: provider.defaultDurationSeconds ?? defaults.defaultDurationSeconds,
    outputFormats: provider.outputFormats ?? defaults.outputFormats,
    notes: provider.notes ?? (provider.kind === 'hub' ? HUB_MODEL_DEPENDENT_NOTE : defaults.notes),
  };
}

function createLLMProvider(provider: ProviderDraft): BuiltinProviderConfig {
  const capabilities = provider.capabilities ?? [
    ...DEFAULT_LLM_CAPABILITIES,
    ...(provider.supportsVision ? (['image-understanding'] as const) : []),
  ];
  const runtime = normalizeLLMProviderRuntimeConfig({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
    credentialMode: provider.credentialMode,
    oauthTarget: provider.oauthTarget,
    supportsVision: capabilities.includes('image-understanding'),
  });

  return {
    ...normalizeMetadata({ ...provider, capabilities }, { capabilities: DEFAULT_LLM_CAPABILITIES }),
    ...provider,
    protocol: runtime.protocol,
    authStyle: runtime.authStyle,
    supportsVision: runtime.supportsVision,
    hasKey: false,
    isCustom: false,
  };
}

function createProvider(
  provider: ProviderDraft,
  defaults: ProviderMetadataDefaults,
): BuiltinProviderConfig {
  return {
    ...normalizeMetadata(provider, defaults),
    ...provider,
    hasKey: false,
    isCustom: false,
  };
}

function createImageProvider(provider: ProviderDraft): BuiltinProviderConfig {
  return createProvider(provider, DEFAULT_IMAGE_METADATA);
}

function createVideoProvider(provider: ProviderDraft): BuiltinProviderConfig {
  const runtimeMetadata = getBuiltinVideoProviderRuntimeMetadata(provider.id);
  return createProvider(
    {
      ...provider,
      supportsAudio: provider.supportsAudio ?? runtimeMetadata?.supportsAudio,
      qualityTiers: provider.qualityTiers ?? runtimeMetadata?.qualityTiers,
    },
    DEFAULT_VIDEO_METADATA,
  );
}

function createCatalogMediaProviders(group: MediaProviderGroup): BuiltinProviderConfig[] {
  return listBuiltinMediaProviders(group).map((provider) => {
    const draft: ProviderDraft = {
      id: provider.providerId,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      kind: provider.kind,
      credentialMode: provider.access === 'managed' ? 'oauth' : 'api-key',
      oauthTarget: provider.oauthTarget,
      docsUrl: provider.docsUrl,
      keyUrl: provider.keyUrl,
      modelExample: provider.modelExample,
      capabilities: [...provider.capabilities],
      supportsReferenceImage: provider.supportsReferenceImage,
      supportsAudio: provider.supportsAudio,
      qualityTiers: provider.qualityTiers ? [...provider.qualityTiers] : undefined,
      defaultResolution: provider.defaultResolution,
      defaultDurationSeconds: provider.defaultDurationSeconds,
      outputFormats: [...provider.outputFormats],
      notes: provider.notes,
    };
    return group === 'image' ? createImageProvider(draft) : createVideoProvider(draft);
  });
}

function createAudioProvider(provider: ProviderDraft): BuiltinProviderConfig {
  return createProvider(provider, DEFAULT_AUDIO_METADATA);
}

function createVisionProvider(provider: ProviderDraft): BuiltinProviderConfig {
  return createProvider(provider, DEFAULT_VISION_METADATA);
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export const PROVIDER_REGISTRY: Record<APIGroup, BuiltinProviderConfig[]> = {
  llm: [
    createLLMProvider({
      id: 'chatgpt-oauth',
      name: 'ChatGPT (OAuth)',
      baseUrl: 'https://chatgpt.com',
      model: 'codex',
      protocol: 'openai-responses',
      authStyle: 'none',
      credentialMode: 'oauth',
      oauthTarget: { provider: 'chatgpt', capability: 'llm' },
      supportsVision: true,
      contextWindow: 1_050_000,
      kind: 'official',
      docsUrl: 'https://github.com/openai/codex/tree/main/codex-rs/app-server',
      keyUrl: 'https://chatgpt.com',
    }),
    createLLMProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      protocol: 'openai-responses',
      authStyle: 'bearer',
      supportsVision: true,
      contextWindow: 1_050_000,
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createLLMProvider({
      id: 'claude',
      name: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5',
      protocol: 'anthropic',
      authStyle: 'x-api-key',
      supportsVision: true,
      contextWindow: 1_000_000,
      kind: 'official',
      docsUrl: 'https://docs.anthropic.com/en/api/messages',
      keyUrl: 'https://console.anthropic.com/settings/keys',
    }),
    createLLMProvider({
      id: 'gemini',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.6-flash',
      protocol: 'gemini',
      authStyle: 'x-goog-api-key',
      supportsVision: true,
      contextWindow: 1_048_576,
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createLLMProvider({
      id: 'gemini-oauth',
      name: 'Google Gemini (OAuth)',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.6-flash',
      protocol: 'gemini',
      authStyle: 'none',
      credentialMode: 'oauth',
      oauthTarget: { provider: 'gemini', capability: 'llm' },
      supportsVision: true,
      contextWindow: 1_048_576,
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/oauth',
      keyUrl: 'https://accounts.google.com',
    }),
    createLLMProvider({
      id: 'grok',
      name: 'xAI',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-4.5',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      contextWindow: 500_000,
      kind: 'official',
      docsUrl: 'https://docs.x.ai/docs/guides/chat-completions',
      keyUrl: 'https://console.x.ai/team/api-keys',
    }),
    createLLMProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      contextWindow: 1_048_576,
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
      contextWindow: 128_000,
      kind: 'official',
      docsUrl: 'https://docs.mistral.ai/api',
      keyUrl: 'https://console.mistral.ai/api-keys/',
    }),
    createLLMProvider({
      id: 'cohere',
      name: 'Cohere',
      baseUrl: 'https://api.cohere.com/v2',
      model: 'command-a-plus-05-2026',
      protocol: 'cohere',
      authStyle: 'bearer',
      contextWindow: 128_000,
      kind: 'official',
      docsUrl: 'https://docs.cohere.com/',
      keyUrl: 'https://dashboard.cohere.com/api-keys',
    }),
    createLLMProvider({
      id: 'openrouter',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.6-sol',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://openrouter.ai/docs/api-reference/chat-completion',
      keyUrl: 'https://openrouter.ai/settings/keys',
      modelExample: 'openai/gpt-5.6-sol',
      contextWindow: 1_050_000,
    }),
    createLLMProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'deepseek-ai/DeepSeek-V4-Pro',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'deepseek-ai/DeepSeek-V4-Pro',
      contextWindow: 1_048_576,
    }),
    createLLMProvider({
      id: 'groq',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-120b',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://console.groq.com/docs/openai',
      keyUrl: 'https://console.groq.com/keys',
      modelExample: 'openai/gpt-oss-120b',
      contextWindow: 131_072,
    }),
    createLLMProvider({
      id: 'qwen',
      name: 'Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.7-max',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      contextWindow: 1_000_000,
      kind: 'official',
      docsUrl:
        'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
      keyUrl: 'https://bailian.console.aliyun.com/',
    }),
    createLLMProvider({
      id: 'siliconflow',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V4-Pro',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.siliconflow.cn',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      modelExample: 'deepseek-ai/DeepSeek-V4-Pro',
      contextWindow: 1_048_576,
    }),
    createLLMProvider({
      id: 'doubao',
      name: 'Doubao (ByteDance)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-0-pro-260215',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      contextWindow: 256_000,
      kind: 'official',
      docsUrl: 'https://www.volcengine.com/docs/82379/1263482',
      keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    }),
    createLLMProvider({
      id: 'zhipu',
      name: 'Zhipu GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5.2',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      contextWindow: 1_000_000,
      kind: 'official',
      docsUrl: 'https://open.bigmodel.cn/dev/api/normal-model/glm-4',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    }),
    createLLMProvider({
      id: 'moonshot',
      name: 'Moonshot / Kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      model: 'kimi-k3',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 1_000_000,
      docsUrl: 'https://platform.moonshot.ai/docs/overview',
      keyUrl: 'https://platform.moonshot.ai/console',
    }),
    createLLMProvider({
      id: 'baichuan',
      name: 'Baichuan',
      baseUrl: 'https://api.baichuan-ai.com/v1',
      model: 'Baichuan4-Turbo',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 32_000,
      docsUrl: 'https://platform.baichuan-ai.com/docs/assistants',
      keyUrl: 'https://platform.baichuan-ai.com/console/apikey',
    }),
    createLLMProvider({
      id: 'stepfun',
      name: 'StepFun',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-3.5-flash',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 256_000,
      docsUrl: 'https://platform.stepfun.com/docs/overview/quickstart',
      keyUrl: 'https://platform.stepfun.com/interface-key',
    }),
    createLLMProvider({
      id: 'volcengine-ark',
      name: '火山引擎',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-0-pro-260215',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://www.volcengine.com/docs/82379/1263482',
      keyUrl: 'https://www.volcengine.com/experience/ark',
      modelExample: 'doubao-seed-2-0-pro-260215',
      contextWindow: 256_000,
    }),
    createLLMProvider({
      id: 'ollama-local',
      name: 'Ollama (Local)',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3.5:9b',
      protocol: 'openai-compatible',
      authStyle: 'none',
      kind: 'official',
      contextWindow: 262_144,
      docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
      keyUrl: 'http://localhost:11434',
    }),
  ],
  image: createCatalogMediaProviders('image'),
  video: createCatalogMediaProviders('video'),
  audio: [
    createAudioProvider({
      id: 'openai-tts',
      name: 'OpenAI TTS',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-tts',
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/guides/text-to-speech',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createAudioProvider({
      id: 'elevenlabs',
      name: 'ElevenLabs',
      baseUrl: 'https://api.elevenlabs.io/v1',
      model: 'eleven_v3',
      kind: 'official',
      docsUrl: 'https://elevenlabs.io/docs/api-reference/text-to-speech',
      keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    }),
    createAudioProvider({
      id: 'cartesia',
      name: 'Cartesia',
      baseUrl: 'https://api.cartesia.ai',
      model: 'sonic-3',
      kind: 'official',
      docsUrl: 'https://docs.cartesia.ai/api-reference/tts/sse',
      keyUrl: 'https://play.cartesia.ai/keys',
    }),
    createAudioProvider({
      id: 'playht',
      name: 'PlayHT',
      baseUrl: 'https://api.play.ht/api/v2',
      model: 'PlayDialog',
      kind: 'official',
      docsUrl: 'https://docs.play.ht/',
      keyUrl: 'https://play.ht/studio/api-access',
    }),
    createAudioProvider({
      id: 'fish-audio',
      name: 'Fish Audio',
      baseUrl: 'https://api.fish.audio/v1',
      model: 's2-pro',
      kind: 'official',
      docsUrl: 'https://docs.fish.audio/',
      keyUrl: 'https://fish.audio/dashboard',
    }),
    createAudioProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'canopylabs/orpheus-3b-0.1-ft',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/audio-overview',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'canopylabs/orpheus-3b-0.1-ft',
    }),
    createAudioProvider({
      id: 'replicate',
      name: 'Replicate',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'suno-ai/bark',
      kind: 'hub',
      docsUrl: 'https://docs.replicate.com/get-started/http-api',
      keyUrl: 'https://replicate.com/account/api-tokens',
      modelExample: 'suno-ai/bark',
    }),
    createAudioProvider({
      id: 'fal',
      name: 'fal',
      baseUrl: 'https://fal.run/fal-ai/stable-audio',
      model: 'fal-ai/stable-audio',
      kind: 'hub',
      docsUrl: 'https://docs.fal.ai/model-apis',
      keyUrl: 'https://fal.ai/dashboard/keys',
      modelExample: 'fal-ai/stable-audio',
    }),
    createAudioProvider({
      id: 'cosyvoice',
      name: 'CosyVoice (Alibaba)',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'cosyvoice-v3.5-plus',
      kind: 'official',
      docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/text-to-speech',
      keyUrl: 'https://bailian.console.aliyun.com/',
    }),
    createAudioProvider({
      id: 'doubao-tts',
      name: 'Doubao TTS (ByteDance)',
      baseUrl: 'https://openspeech.bytedance.com/api/v1',
      model: 'doubao-tts',
      kind: 'official',
      docsUrl: 'https://www.volcengine.com/docs/6561/79823',
      keyUrl: 'https://console.volcengine.com/speech/app',
    }),
    createAudioProvider({
      id: 'minimax-tts',
      name: 'MiniMax Speech',
      baseUrl: 'https://api.minimax.chat/v1',
      model: 'speech-02-hd',
      kind: 'official',
      docsUrl: 'https://platform.minimax.io/docs/api-reference/speech-generation',
      keyUrl: 'https://platform.minimaxi.com/api-key',
    }),
    createAudioProvider({
      id: 'siliconflow-tts',
      name: 'SiliconFlow TTS',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'fishaudio/fish-speech-1.5',
      kind: 'hub',
      docsUrl: 'https://docs.siliconflow.cn/cn/userguide/capabilities/text-to-speech',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      modelExample: 'fishaudio/fish-speech-1.5',
    }),
  ],
  vision: [
    createVisionProvider({
      id: 'chatgpt-vision-oauth',
      name: 'ChatGPT (OAuth)',
      baseUrl: 'https://chatgpt.com',
      model: 'codex',
      protocol: 'openai-responses',
      authStyle: 'none',
      credentialMode: 'oauth',
      oauthTarget: { provider: 'chatgpt', capability: 'vision' },
      kind: 'official',
      contextWindow: 1_050_000,
      docsUrl: 'https://github.com/openai/codex/tree/main/codex-rs/app-server',
      keyUrl: 'https://chatgpt.com',
    }),
    createVisionProvider({
      id: 'openai-vision',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6-sol',
      protocol: 'openai-responses',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 1_050_000,
      docsUrl: 'https://platform.openai.com/docs/guides/vision',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createVisionProvider({
      id: 'gemini-vision',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.6-flash',
      protocol: 'gemini',
      authStyle: 'x-goog-api-key',
      kind: 'official',
      contextWindow: 1_048_576,
      docsUrl: 'https://ai.google.dev/gemini-api/docs/vision',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createVisionProvider({
      id: 'gemini-vision-oauth',
      name: 'Google Gemini (OAuth)',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.6-flash',
      protocol: 'gemini',
      authStyle: 'none',
      credentialMode: 'oauth',
      oauthTarget: { provider: 'gemini', capability: 'vision' },
      kind: 'official',
      contextWindow: 1_048_576,
      docsUrl: 'https://ai.google.dev/gemini-api/docs/oauth',
      keyUrl: 'https://accounts.google.com',
    }),
    createVisionProvider({
      id: 'claude-vision',
      name: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-5',
      protocol: 'anthropic',
      authStyle: 'x-api-key',
      kind: 'official',
      contextWindow: 1_000_000,
      docsUrl: 'https://docs.anthropic.com/en/docs/build-with-claude/vision',
      keyUrl: 'https://console.anthropic.com/settings/keys',
    }),
    createVisionProvider({
      id: 'qwen-vision',
      name: 'Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.7-plus',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 1_000_000,
      docsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/qwen-vl-api',
      keyUrl: 'https://dashscope.aliyun.com/api-key',
    }),
    createVisionProvider({
      id: 'openrouter-vision',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.6-sol',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      contextWindow: 1_050_000,
      docsUrl: 'https://openrouter.ai/docs/requests',
      keyUrl: 'https://openrouter.ai/settings/keys',
    }),
    createVisionProvider({
      id: 'siliconflow-vision',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen3-VL-32B-Instruct',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.siliconflow.cn/quickstart',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    }),
    createVisionProvider({
      id: 'together-vision',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'Qwen/Qwen3.5-9B',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/vision',
      keyUrl: 'https://api.together.ai/settings/api-keys',
    }),
    createVisionProvider({
      id: 'grok-vision',
      name: 'Grok (xAI)',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-4.5',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 500_000,
      docsUrl: 'https://docs.x.ai/docs/guides/vision',
      keyUrl: 'https://console.x.ai/team/api-keys',
    }),
    createVisionProvider({
      id: 'mistral-vision',
      name: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-large-latest',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 128_000,
      docsUrl: 'https://docs.mistral.ai/capabilities/vision/',
      keyUrl: 'https://console.mistral.ai/api-keys/',
    }),
    createVisionProvider({
      id: 'doubao-vision',
      name: 'Doubao (ByteDance)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-2-0-pro-260215',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 256_000,
      docsUrl: 'https://www.volcengine.com/docs/82379/1298454',
      keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    }),
    createVisionProvider({
      id: 'zhipu-vision',
      name: 'Zhipu GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-5v-turbo',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://open.bigmodel.cn/dev/howuse/glm-4v',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    }),
    createVisionProvider({
      id: 'moonshot-vision',
      name: 'Moonshot / Kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      model: 'kimi-k3',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      contextWindow: 1_000_000,
      docsUrl: 'https://platform.moonshot.ai/docs',
      keyUrl: 'https://platform.moonshot.ai/console',
    }),
    createVisionProvider({
      id: 'stepfun-vision',
      name: 'StepFun',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-3',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.stepfun.com/docs/overview',
      keyUrl: 'https://platform.stepfun.com/interface-key',
    }),
    createVisionProvider({
      id: 'ollama-vision',
      name: 'Ollama (Local)',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen3.5:9b',
      protocol: 'openai-compatible',
      authStyle: 'none',
      kind: 'official',
      contextWindow: 262_144,
      docsUrl: 'https://ollama.com/blog/vision-models',
      keyUrl: 'http://localhost:11434',
    }),
  ],
};

// ---------------------------------------------------------------------------
// Lookup and conversion helpers
// ---------------------------------------------------------------------------

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
    credentialMode: provider.credentialMode,
    oauthTarget: provider.oauthTarget,
    ...(provider.contextWindow ? { contextWindow: provider.contextWindow } : {}),
  };
}

function getBuiltinProvider(
  group: APIGroup,
  providerId: string,
): BuiltinProviderConfig | undefined {
  return PROVIDER_REGISTRY[group].find((entry) => entry.id === providerId);
}

export function getDefaultProviders(group: APIGroup): ProviderConfig[] {
  return PROVIDER_REGISTRY[group].map((provider) => ({ ...toProviderConfig(provider) }));
}

export function getProviderMetadata(
  group: APIGroup,
  providerId: string,
): ProviderMetadata | undefined {
  const provider = getBuiltinProvider(group, providerId);
  if (!provider) {
    return undefined;
  }

  return {
    kind: provider.kind,
    docsUrl: provider.docsUrl,
    keyUrl: provider.keyUrl,
    credentialMode: provider.credentialMode,
    oauthTarget: provider.oauthTarget,
    modelExample: provider.modelExample,
    capabilities: provider.capabilities,
    supportsReferenceImage: provider.supportsReferenceImage,
    supportsAudio: provider.supportsAudio,
    qualityTiers: provider.qualityTiers,
    defaultResolution: provider.defaultResolution,
    defaultDurationSeconds: provider.defaultDurationSeconds,
    outputFormats: provider.outputFormats,
    notes: provider.notes,
  };
}

export function getProviderDefaults(
  group: APIGroup,
  providerId: string,
): ProviderConfig | undefined {
  const provider = getBuiltinProvider(group, providerId);
  return provider ? toProviderConfig(provider) : undefined;
}

// ---------------------------------------------------------------------------
// Merge helpers (restore from persisted settings)
// ---------------------------------------------------------------------------

type LegacyBuiltinDefaults = {
  models?: readonly string[];
  baseUrls?: readonly string[];
  contextWindows?: readonly number[];
};

/**
 * Values shipped as built-in defaults before the 2026-08 provider refresh.
 * Exact matches migrate forward; values not listed here remain user overrides.
 */
const LEGACY_BUILTIN_DEFAULTS: Partial<Record<APIGroup, Record<string, LegacyBuiltinDefaults>>> = {
  llm: {
    openai: { models: ['gpt-5.4'], contextWindows: [1_000_000] },
    claude: { models: ['claude-sonnet-4-20250514'], contextWindows: [200_000] },
    gemini: { models: ['gemini-2.5-flash'], contextWindows: [1_000_000] },
    grok: { models: ['grok-3'], contextWindows: [131_072] },
    deepseek: { models: ['deepseek-chat'], contextWindows: [128_000] },
    mistral: { models: ['mistral-large-latest'] },
    cohere: { models: ['command-a-03-2025'], contextWindows: [256_000] },
    openrouter: { models: ['openai/gpt-5.4'] },
    together: { models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
    groq: { models: ['llama-3.3-70b-versatile'] },
    qwen: { models: ['qwen-plus'], contextWindows: [131_072] },
    siliconflow: { models: ['deepseek-ai/DeepSeek-V3'] },
    doubao: { models: ['doubao-1.5-pro-256k'] },
    zhipu: { models: ['glm-4-plus'], contextWindows: [128_000] },
    moonshot: {
      models: ['kimi-k2.5'],
      baseUrls: ['https://api.moonshot.cn/v1'],
    },
    baichuan: { models: ['Baichuan-M3-235B'] },
    stepfun: { models: ['step-2-16k'] },
    'volcengine-ark': { models: ['doubao-1.5-pro-256k'] },
  },
  image: {
    recraft: { models: ['recraftv4'] },
    'zhipu-image': { models: ['cogview-4-250304'] },
    fal: { models: ['fal-ai/flux-pro/v1.1'] },
  },
  video: {
    replicate: { models: ['minimax/video-01'] },
  },
  vision: {
    'openai-vision': { models: ['gpt-5.4'] },
    'gemini-vision': { models: ['gemini-2.5-flash'] },
    'claude-vision': { models: ['claude-sonnet-4-20250514'] },
    'qwen-vision': { models: ['qwen-vl-max'] },
    'openrouter-vision': { models: ['openai/gpt-5.4'] },
    'siliconflow-vision': { models: ['Pro/Qwen/Qwen2.5-VL-7B-Instruct'] },
    'together-vision': { models: ['meta-llama/Llama-Vision-Free'] },
    'grok-vision': { models: ['grok-2-vision-1212'] },
    'mistral-vision': { models: ['pixtral-large-latest'] },
    'doubao-vision': { models: ['doubao-vision-pro-32k'] },
    'zhipu-vision': { models: ['glm-4v-plus'] },
    'moonshot-vision': {
      models: ['kimi-k2.5'],
      baseUrls: ['https://api.moonshot.cn/v1'],
    },
    'stepfun-vision': { models: ['step-1v-8k'] },
  },
};

function isLegacyBuiltinValue(
  group: APIGroup,
  providerId: string,
  field: keyof LegacyBuiltinDefaults,
  value: string | number | undefined,
): boolean {
  if (value == null) return false;
  return (
    (
      LEGACY_BUILTIN_DEFAULTS[group]?.[providerId]?.[field] as
        readonly (string | number)[] | undefined
    )?.includes(value) ?? false
  );
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

function mergeBuiltinProvider(
  group: APIGroup,
  defaults: ProviderConfig,
  savedProvider: ProviderConfig | undefined,
): ProviderConfig {
  if (!savedProvider || savedProvider.isCustom) {
    return { ...defaults };
  }

  const savedBaseUrl =
    savedProvider.baseUrl &&
    savedProvider.baseUrl !== defaults.baseUrl &&
    !isLegacyBuiltinValue(group, defaults.id, 'baseUrls', savedProvider.baseUrl)
      ? savedProvider.baseUrl
      : defaults.baseUrl;
  const savedModel =
    savedProvider.model &&
    savedProvider.model !== defaults.model &&
    !isLegacyBuiltinValue(group, defaults.id, 'models', savedProvider.model)
      ? savedProvider.model
      : defaults.model;
  const savedContextWindow =
    savedProvider.contextWindow &&
    !isLegacyBuiltinValue(group, defaults.id, 'contextWindows', savedProvider.contextWindow)
      ? savedProvider.contextWindow
      : defaults.contextWindow;

  const merged: ProviderConfig = {
    ...defaults,
    baseUrl: savedBaseUrl,
    model: savedModel,
    // Never restore a stale OAuth readiness bit. The capability-scoped
    // providerOAuth status call is the only authority after startup.
    hasKey: defaults.credentialMode === 'oauth' ? false : savedProvider.hasKey,
    isCustom: false,
    ...(savedContextWindow ? { contextWindow: savedContextWindow } : {}),
  };

  return normalizeSavedProvider(group, merged);
}

function mergeProviderDefaults(
  group: APIGroup,
  savedGroup?: ProviderCollectionConfig & { activeProvider?: string },
): ProviderCollectionConfig {
  const defaults = getDefaultProviders(group);
  const savedProviders = savedGroup?.providers ?? [];
  const mergedDefaults = defaults.map((provider) =>
    mergeBuiltinProvider(
      group,
      provider,
      savedProviders.find((savedProvider) => savedProvider.id === provider.id),
    ),
  );
  const customProviders = savedProviders
    .filter((provider) => provider.isCustom)
    .filter((provider, index, all) => all.findIndex((entry) => entry.id === provider.id) === index)
    .filter((provider) => !defaults.some((entry) => entry.id === provider.id))
    .map((provider) => normalizeSavedProvider(group, provider));
  const providers = [...mergedDefaults, ...customProviders];

  return {
    providers,
  };
}

export function mergeSavedSettings(
  saved: PersistedSettingsState,
  initialState: SettingsState,
): SettingsState {
  const result: SettingsState = {
    llm: mergeProviderDefaults('llm', saved.llm),
    image: mergeProviderDefaults('image', saved.image),
    video: mergeProviderDefaults('video', saved.video),
    audio: mergeProviderDefaults('audio', saved.audio),
    vision: mergeProviderDefaults('vision', saved.vision),
    renderPreset: saved.renderPreset ?? initialState.renderPreset,
    usage: saved.usage ? { ...DEFAULT_USAGE_STATS, ...saved.usage } : DEFAULT_USAGE_STATS,
    availableUpdate: null,
    production: { ...initialState.production },
    styleGuide: { ...initialState.styleGuide },
    bootstrapped: false,
    crashReporting: saved.crashReporting ?? false,
    analyticsEnabled: saved.analyticsEnabled ?? false,
  };

  if (saved.production) {
    result.production = { ...result.production, ...saved.production };
  }
  if (saved.styleGuide) {
    result.styleGuide = saved.styleGuide;
  }

  return result;
}
