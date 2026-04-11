import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  type Capability,
  getBuiltinVideoProviderRuntimeMetadata,
  normalizeLLMProviderRuntimeConfig,
  type LLMProviderAuthStyle,
  type LLMProviderProtocol,
} from '@lucid-fin/contracts';

export type APIGroup = 'llm' | 'image' | 'video' | 'audio' | 'vision';
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
  capabilities: Capability[];
  supportsReferenceImage?: boolean;
  supportsAudio?: boolean;
  qualityTiers?: string[];
  defaultResolution?: string;
  defaultDurationSeconds?: number;
  outputFormats?: string[];
  notes?: string;
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
  vision: ProviderCollectionConfig;
  renderPreset: string;
}

interface PersistedSettingsState {
  llm?: ProviderCollectionConfig & { activeProvider?: string };
  image?: ProviderCollectionConfig & { activeProvider?: string };
  video?: ProviderCollectionConfig & { activeProvider?: string };
  audio?: ProviderCollectionConfig & { activeProvider?: string };
  vision?: ProviderCollectionConfig & { activeProvider?: string };
  renderPreset?: string;
}

type ProviderMetadataDefaults = Omit<ProviderMetadata, 'kind' | 'docsUrl' | 'keyUrl'>;
type ProviderDraft = Omit<ProviderConfig, 'hasKey' | 'isCustom'> &
  Pick<ProviderMetadata, 'kind' | 'docsUrl' | 'keyUrl'> &
  Partial<ProviderMetadataDefaults>;

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

function normalizeMetadata(
  provider: ProviderDraft,
  defaults: ProviderMetadataDefaults,
): ProviderMetadata {
  const capabilities = provider.capabilities ?? defaults.capabilities;
  const supportsReferenceImageByCapability =
    capabilities.includes('image-to-image') || capabilities.includes('image-to-video');
  const supportsReferenceImage =
    provider.supportsReferenceImage
    ?? defaults.supportsReferenceImage
    ?? supportsReferenceImageByCapability;

  return {
    kind: provider.kind,
    docsUrl: provider.docsUrl,
    keyUrl: provider.keyUrl,
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

function createLLMProvider(
  provider: ProviderDraft,
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
    ...normalizeMetadata(provider, { capabilities: DEFAULT_LLM_CAPABILITIES }),
    ...provider,
    protocol: runtime.protocol,
    authStyle: runtime.authStyle,
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

function createAudioProvider(provider: ProviderDraft): BuiltinProviderConfig {
  return createProvider(provider, DEFAULT_AUDIO_METADATA);
}

function createVisionProvider(provider: ProviderDraft): BuiltinProviderConfig {
  return createProvider(provider, DEFAULT_VISION_METADATA);
}

export const PROVIDER_REGISTRY: Record<APIGroup, BuiltinProviderConfig[]> = {
  llm: [
    createLLMProvider({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
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
      model: 'openai/gpt-5.4',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://openrouter.ai/docs/api-reference/chat-completion',
      keyUrl: 'https://openrouter.ai/settings/keys',
      modelExample: 'openai/gpt-5.4',
    }),
    createLLMProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
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
      id: 'siliconflow',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V3',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.siliconflow.cn',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      modelExample: 'deepseek-ai/DeepSeek-V3',
    }),
    createLLMProvider({
      id: 'doubao',
      name: 'Doubao (ByteDance)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-1.5-pro-256k',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://www.volcengine.com/docs/82379/1263482',
      keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    }),
    createLLMProvider({
      id: 'zhipu',
      name: 'Zhipu GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-plus',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://open.bigmodel.cn/dev/api/normal-model/glm-4',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    }),
    createLLMProvider({
      id: 'moonshot',
      name: 'Moonshot / Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.5',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.moonshot.ai/docs/overview',
      keyUrl: 'https://platform.moonshot.ai/console',
    }),
    createLLMProvider({
      id: 'baichuan',
      name: 'Baichuan',
      baseUrl: 'https://api.baichuan-ai.com/v1',
      model: 'Baichuan-M3-235B',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.baichuan-ai.com/docs/assistants',
      keyUrl: 'https://platform.baichuan-ai.com/console/apikey',
    }),
    createLLMProvider({
      id: 'stepfun',
      name: 'StepFun',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-2-16k',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.stepfun.com/docs/overview/quickstart',
      keyUrl: 'https://platform.stepfun.com/interface-key',
    }),
    createLLMProvider({
      id: 'volcengine-ark',
      name: '火山引擎',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-1.5-pro-256k',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://www.volcengine.com/docs/82379/1263482',
      keyUrl: 'https://www.volcengine.com/experience/ark',
      modelExample: 'doubao-1.5-pro-256k',
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
    createImageProvider({
      id: 'openai-image',
      name: 'OpenAI GPT Image',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-image-1',
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
      keyUrl: 'https://platform.openai.com/api-keys',
      outputFormats: ['png', 'jpeg', 'webp'],
    }),
    createImageProvider({
      id: 'google-image',
      name: 'Google Imagen 4',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'imagen-4.0-generate-001',
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/imagen',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createImageProvider({
      id: 'recraft',
      name: 'Recraft',
      baseUrl: 'https://external.api.recraft.ai/v1',
      model: 'recraftv4',
      kind: 'official',
      docsUrl: 'https://developer.recraft.ai/',
      keyUrl: 'https://www.recraft.ai/account',
    }),
    createImageProvider({
      id: 'ideogram',
      name: 'Ideogram',
      baseUrl: 'https://api.ideogram.ai',
      model: 'ideogram-v3',
      kind: 'official',
      docsUrl: 'https://developer.ideogram.ai/',
      keyUrl: 'https://developer.ideogram.ai/',
    }),
    createImageProvider({
      id: 'replicate',
      name: 'Replicate',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'black-forest-labs/flux-1.1-pro',
      kind: 'hub',
      docsUrl: 'https://docs.replicate.com/get-started/http-api',
      keyUrl: 'https://replicate.com/account/api-tokens',
      modelExample: 'black-forest-labs/flux-1.1-pro',
      capabilities: ['text-to-image', 'image-to-image'],
      outputFormats: ['png', 'jpg', 'webp'],
    }),
    createImageProvider({
      id: 'fal',
      name: 'fal',
      baseUrl: 'https://fal.run/fal-ai/flux-pro/v1.1',
      model: 'fal-ai/flux-pro/v1.1',
      kind: 'hub',
      docsUrl: 'https://docs.fal.ai/model-apis',
      keyUrl: 'https://fal.ai/dashboard/keys',
      modelExample: 'fal-ai/flux-pro/v1.1',
      capabilities: ['text-to-image', 'image-to-image'],
      outputFormats: ['png', 'jpg', 'webp'],
    }),
    createImageProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'black-forest-labs/FLUX.1-schnell',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/image-generation-overview',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'black-forest-labs/FLUX.1-schnell',
      capabilities: ['text-to-image', 'image-to-image'],
      outputFormats: ['png', 'jpg', 'webp'],
    }),
    createImageProvider({
      id: 'siliconflow-image',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'black-forest-labs/FLUX.1-schnell',
      kind: 'hub',
      docsUrl: 'https://docs.siliconflow.cn',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      modelExample: 'black-forest-labs/FLUX.1-schnell',
      capabilities: ['text-to-image', 'image-to-image'],
      outputFormats: ['png', 'jpg', 'webp'],
    }),
    createImageProvider({
      id: 'zhipu-image',
      name: 'Zhipu CogView',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'cogview-4',
      kind: 'official',
      docsUrl: 'https://docs.bigmodel.cn',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    }),
    createImageProvider({
      id: 'tongyi-wanxiang',
      name: 'Tongyi Wanxiang (Alibaba)',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'wanx-v1',
      kind: 'official',
      docsUrl: 'https://help.aliyun.com/document_detail/2975674.html',
      keyUrl: 'https://bailian.console.aliyun.com/',
    }),
    createImageProvider({
      id: 'kolors',
      name: 'Kolors (Kuaishou)',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'kwai-kolors/kolors',
      kind: 'official',
      docsUrl: 'https://replicate.com/kwai-kolors/kolors',
      keyUrl: 'https://replicate.com/account/api-tokens',
    }),
    createImageProvider({
      id: 'stepfun-image',
      name: 'StepFun Image',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-1x-medium',
      kind: 'official',
      docsUrl: 'https://platform.stepfun.com/docs/api-reference/images/image',
      keyUrl: 'https://platform.stepfun.com/interface-key',
    }),
    createImageProvider({
      id: 'volcengine-image',
      name: 'Volcengine Seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'seedream-3.0',
      kind: 'official',
      docsUrl: 'https://www.volcengine.com/experience/ark',
      keyUrl: 'https://www.volcengine.com/experience/ark',
    }),
  ],
  video: [
    createVideoProvider({
      id: 'google-video',
      name: 'Google Veo',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'veo-3.0-generate-001',
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/video',
      keyUrl: 'https://aistudio.google.com/apikey',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'runway',
      name: 'Runway',
      baseUrl: 'https://api.dev.runwayml.com/v1',
      model: 'gen4.5',
      kind: 'official',
      docsUrl: 'https://docs.dev.runwayml.com/api',
      keyUrl: 'https://docs.dev.runwayml.com/',
      capabilities: ['text-to-video', 'image-to-video'],
      defaultResolution: '1920x1080',
    }),
    createVideoProvider({
      id: 'luma',
      name: 'Luma',
      baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
      model: 'ray-2',
      kind: 'official',
      docsUrl: 'https://docs.lumalabs.ai/docs/api',
      keyUrl: 'https://lumalabs.ai/dream-machine/api',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.chat/v1',
      model: 'T2V-02',
      kind: 'official',
      docsUrl: 'https://platform.minimax.io/docs/guides/video-generation',
      keyUrl: 'https://platform.minimaxi.com/api-key',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'pika',
      name: 'Pika',
      baseUrl: 'https://api.pika.art/v1',
      model: 'pika-2.5',
      kind: 'official',
      docsUrl: 'https://pika.art/api',
      keyUrl: 'https://dev.pika.art/',
      capabilities: ['text-to-video', 'image-to-video'],
      defaultResolution: '1280x720',
    }),
    createVideoProvider({
      id: 'replicate',
      name: 'Replicate',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'minimax/video-01',
      kind: 'hub',
      docsUrl: 'https://docs.replicate.com/get-started/http-api',
      keyUrl: 'https://replicate.com/account/api-tokens',
      modelExample: 'minimax/video-01',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'fal',
      name: 'fal',
      baseUrl: 'https://fal.run/fal-ai/minimax/video-01',
      model: 'fal-ai/minimax/video-01',
      kind: 'hub',
      docsUrl: 'https://docs.fal.ai/model-apis',
      keyUrl: 'https://fal.ai/dashboard/keys',
      modelExample: 'fal-ai/minimax/video-01',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'together',
      name: 'Together AI',
      baseUrl: 'https://api.together.xyz/v1',
      model: 'Wan-AI/wan2.7-t2v',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/video-generation-overview',
      keyUrl: 'https://api.together.ai/settings/api-keys',
      modelExample: 'Wan-AI/wan2.7-t2v',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'kling',
      name: 'Kling AI',
      baseUrl: 'https://api.klingai.com/v1',
      model: 'kling-v1-5',
      kind: 'official',
      docsUrl: 'https://docs.klingai.com',
      keyUrl: 'https://platform.klingai.com',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'wan',
      name: 'Wan (Alibaba)',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'wan-2.1',
      kind: 'official',
      docsUrl: 'https://replicate.com/wan-ai',
      keyUrl: 'https://replicate.com/account/api-tokens',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'seedance',
      name: 'Seedance (ByteDance)',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'seedance-2',
      kind: 'official',
      docsUrl: 'https://replicate.com/bytedance',
      keyUrl: 'https://replicate.com/account/api-tokens',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'hunyuan',
      name: 'HunyuanVideo (Tencent)',
      baseUrl: 'https://api.replicate.com/v1',
      model: 'hunyuan-video',
      kind: 'official',
      docsUrl: 'https://replicate.com/tencent',
      keyUrl: 'https://replicate.com/account/api-tokens',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'zhipu-video',
      name: 'Zhipu CogVideoX',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'cogvideox',
      kind: 'official',
      docsUrl: 'https://docs.bigmodel.cn',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    }),
    createVideoProvider({
      id: 'vidu',
      name: 'Vidu (Shengshu)',
      baseUrl: 'https://api.vidu.com/v1',
      model: 'vidu-q3-pro',
      kind: 'official',
      docsUrl: 'https://platform.vidu.com',
      keyUrl: 'https://www.vidu.com/',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'siliconflow-video',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Wan-AI/Wan2.1-T2V-14B',
      kind: 'hub',
      docsUrl: 'https://docs.siliconflow.cn/cn/userguide/capabilities/video',
      keyUrl: 'https://cloud.siliconflow.cn/account/ak',
      modelExample: 'Wan-AI/Wan2.1-T2V-14B',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
    createVideoProvider({
      id: 'stepfun-video',
      name: 'StepFun Video',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-video-t2v',
      kind: 'official',
      docsUrl: 'https://platform.stepfun.com/docs/guide/video_chat',
      keyUrl: 'https://platform.stepfun.com/interface-key',
    }),
    createVideoProvider({
      id: 'volcengine-video',
      name: 'Volcengine Seedance',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'seedance-2.0',
      kind: 'official',
      docsUrl: 'https://www.volcengine.com/experience/ark',
      keyUrl: 'https://www.volcengine.com/experience/ark',
      capabilities: ['text-to-video', 'image-to-video'],
    }),
  ],
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
      id: 'openai-vision',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.openai.com/docs/guides/vision',
      keyUrl: 'https://platform.openai.com/api-keys',
    }),
    createVisionProvider({
      id: 'gemini-vision',
      name: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      protocol: 'gemini',
      authStyle: 'x-goog-api-key',
      kind: 'official',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/vision',
      keyUrl: 'https://aistudio.google.com/apikey',
    }),
    createVisionProvider({
      id: 'claude-vision',
      name: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-20250514',
      protocol: 'anthropic',
      authStyle: 'x-api-key',
      kind: 'official',
      docsUrl: 'https://docs.anthropic.com/en/docs/build-with-claude/vision',
      keyUrl: 'https://console.anthropic.com/settings/keys',
    }),
    createVisionProvider({
      id: 'qwen-vision',
      name: 'Qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-vl-max',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/qwen-vl-api',
      keyUrl: 'https://dashscope.aliyun.com/api-key',
    }),
    createVisionProvider({
      id: 'openrouter-vision',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.4',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://openrouter.ai/docs/requests',
      keyUrl: 'https://openrouter.ai/settings/keys',
    }),
    createVisionProvider({
      id: 'siliconflow-vision',
      name: 'SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct',
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
      model: 'meta-llama/Llama-Vision-Free',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'hub',
      docsUrl: 'https://docs.together.ai/docs/vision',
      keyUrl: 'https://api.together.ai/settings/api-keys',
    }),
    createVisionProvider({
      id: 'deepseek-vision',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://api-docs.deepseek.com/guides/vision',
      keyUrl: 'https://platform.deepseek.com/api_keys',
    }),
    createVisionProvider({
      id: 'grok-vision',
      name: 'Grok (xAI)',
      baseUrl: 'https://api.x.ai/v1',
      model: 'grok-2-vision-1212',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://docs.x.ai/docs/guides/vision',
      keyUrl: 'https://console.x.ai/team/api-keys',
    }),
    createVisionProvider({
      id: 'mistral-vision',
      name: 'Mistral',
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'pixtral-large-latest',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://docs.mistral.ai/capabilities/vision/',
      keyUrl: 'https://console.mistral.ai/api-keys/',
    }),
    createVisionProvider({
      id: 'doubao-vision',
      name: 'Doubao (ByteDance)',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-vision-pro-32k',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://www.volcengine.com/docs/82379/1298454',
      keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
    }),
    createVisionProvider({
      id: 'zhipu-vision',
      name: 'Zhipu GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4v-plus',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://open.bigmodel.cn/dev/howuse/glm-4v',
      keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    }),
    createVisionProvider({
      id: 'moonshot-vision',
      name: 'Moonshot / Kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.5',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      kind: 'official',
      docsUrl: 'https://platform.moonshot.ai/docs',
      keyUrl: 'https://platform.moonshot.ai/console',
    }),
    createVisionProvider({
      id: 'stepfun-vision',
      name: 'StepFun',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-1v-8k',
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
      model: 'llama3.2-vision',
      protocol: 'openai-compatible',
      authStyle: 'none',
      kind: 'official',
      docsUrl: 'https://ollama.com/blog/vision-models',
      keyUrl: 'http://localhost:11434',
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

function getBuiltinProvider(
  group: APIGroup,
  providerId: string,
): BuiltinProviderConfig | undefined {
  return PROVIDER_REGISTRY[group].find((entry) => entry.id === providerId);
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
    vision: { providers: getDefaultProviders('vision') },
    renderPreset: 'standard',
  };
}

const initialState = createInitialState();

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

function findProvider(
  groupState: ProviderCollectionConfig,
  providerId: string,
): ProviderConfig | undefined {
  return groupState.providers.find((provider) => provider.id === providerId);
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

  // Only preserve saved baseUrl/model if they differ from BOTH the current
  // defaults AND the saved values are non-empty — indicating intentional
  // customization. If saved values match defaults, always use the latest defaults
  // (handles default updates like model version bumps).
  const savedBaseUrl =
    savedProvider.baseUrl && savedProvider.baseUrl !== defaults.baseUrl
      ? savedProvider.baseUrl
      : defaults.baseUrl;
  const savedModel =
    savedProvider.model && savedProvider.model !== defaults.model
      ? savedProvider.model
      : defaults.model;

  // Check if the user actually customized — if savedProvider values were just
  // old defaults that we've since updated, detect by checking if the saved
  // baseUrl matches defaults (provider hasn't changed endpoints, just models).
  // Use default model when baseUrl matches (user didn't change the endpoint,
  // so they likely want the latest model too).
  const userCustomizedEndpoint = savedBaseUrl !== defaults.baseUrl;
  const effectiveModel = userCustomizedEndpoint ? savedModel : defaults.model;

  const merged: ProviderConfig = {
    ...defaults,
    baseUrl: savedBaseUrl,
    model: effectiveModel,
    hasKey: savedProvider.hasKey,
    isCustom: false,
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

  return { providers };
}

function mergeSavedSettings(saved: PersistedSettingsState): SettingsState {
  return {
    llm: mergeProviderDefaults('llm', saved.llm),
    image: mergeProviderDefaults('image', saved.image),
    video: mergeProviderDefaults('video', saved.video),
    audio: mergeProviderDefaults('audio', saved.audio),
    vision: mergeProviderDefaults('vision', saved.vision),
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
      if (action.payload.group !== 'llm' && action.payload.group !== 'vision') {
        return;
      }

      const provider = findProvider(state[action.payload.group], action.payload.provider);
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
    commitProvider(
      state,
      action: PayloadAction<{
        group: APIGroup;
        providerId: string;
        config: {
          baseUrl: string;
          model: string;
          protocol?: LLMProviderProtocol;
          authStyle?: LLMProviderAuthStyle;
          name?: string;
        };
      }>,
    ) {
      const { group, providerId, config } = action.payload;
      const provider = findProvider(state[group], providerId);
      if (!provider) return;

      provider.baseUrl = config.baseUrl;
      provider.model = config.model;

      if (group === 'llm' || group === 'vision') {
        const runtime = normalizeLLMProviderRuntimeConfig({
          id: provider.id,
          name: config.name ?? provider.name,
          baseUrl: config.baseUrl,
          model: config.model,
          protocol: config.protocol,
          authStyle: config.authStyle,
        });
        provider.protocol = runtime.protocol;
        provider.authStyle = runtime.authStyle;
      }

      if (config.name !== undefined && provider.isCustom) {
        provider.name = config.name;
      }
    },
    resetProviderToDefaults(
      state,
      action: PayloadAction<{ group: APIGroup; provider: string }>,
    ) {
      const defaults = getProviderDefaults(action.payload.group, action.payload.provider);
      const provider = findProvider(state[action.payload.group], action.payload.provider);
      if (!provider || provider.isCustom || !defaults) {
        return;
      }

      provider.name = defaults.name;
      provider.baseUrl = defaults.baseUrl;
      provider.model = defaults.model;
      provider.protocol = defaults.protocol;
      provider.authStyle = defaults.authStyle;
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
  commitProvider,
  setProviderBaseUrl,
  setProviderModel,
  setProviderProtocol,
  setProviderHasKey,
  setProviderName,
  resetProviderToDefaults,
  addCustomProvider,
  removeCustomProvider,
  setRenderPreset,
  setProviders,
  toggleProvider,
  restore,
} = settingsSlice.actions;

// ---------------------------------------------------------------------------
// Sparse persistence — only persist providers the user has actually configured
// ---------------------------------------------------------------------------

interface SparseProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isCustom: boolean;
  hasKey: boolean;
  protocol?: LLMProviderProtocol;
  authStyle?: LLMProviderAuthStyle;
}

interface SparseSettingsState {
  llm: { providers: SparseProviderConfig[] };
  image: { providers: SparseProviderConfig[] };
  video: { providers: SparseProviderConfig[] };
  audio: { providers: SparseProviderConfig[] };
  vision: { providers: SparseProviderConfig[] };
  renderPreset: string;
}

function isProviderConfigured(group: APIGroup, provider: ProviderConfig): boolean {
  if (provider.isCustom) return true;
  if (provider.hasKey) return true;

  const defaults = getProviderDefaults(group, provider.id);
  if (!defaults) return true; // unknown provider — preserve it

  return (
    provider.baseUrl !== defaults.baseUrl ||
    provider.model !== defaults.model ||
    provider.protocol !== defaults.protocol ||
    provider.authStyle !== defaults.authStyle
  );
}

function toSparseProvider(provider: ProviderConfig): SparseProviderConfig {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    isCustom: provider.isCustom,
    hasKey: provider.hasKey,
    protocol: provider.protocol,
    authStyle: provider.authStyle,
  };
}

export function buildSparseSettings(state: SettingsState): SparseSettingsState {
  const groups = ['llm', 'image', 'video', 'audio', 'vision'] as const;
  const sparse = {} as Record<string, { providers: SparseProviderConfig[] }>;

  for (const group of groups) {
    sparse[group] = {
      providers: state[group].providers
        .filter((p) => isProviderConfigured(group, p))
        .map(toSparseProvider),
    };
  }

  return {
    ...sparse,
    renderPreset: state.renderPreset,
  } as SparseSettingsState;
}
