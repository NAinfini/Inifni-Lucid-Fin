export type LLMProviderProtocol =
  'openai-compatible' | 'openai-responses' | 'anthropic' | 'gemini' | 'cohere';

export type LLMProviderAuthStyle = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';

import type { OAuthProviderTarget } from './oauth-provider.js';

export interface LLMProviderRuntimeConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: LLMProviderProtocol;
  authStyle: LLMProviderAuthStyle;
  credentialMode?: 'api-key' | 'oauth' | 'none';
  oauthTarget?: OAuthProviderTarget;
  /** Explicit opt-in: the selected model accepts image inputs for visual analysis. */
  supportsVision?: boolean;
  /** User-configured context window in tokens. Overrides auto-detected value. */
  contextWindow?: number;
}

export type LLMProviderRuntimeInput = Pick<LLMProviderRuntimeConfig, 'id'> &
  Partial<Omit<LLMProviderRuntimeConfig, 'id'>>;

export interface LLMProviderPreset extends LLMProviderRuntimeConfig {
  keyUrl?: string;
}

export function getDefaultAuthStyleForProtocol(
  protocol: LLMProviderProtocol,
): LLMProviderAuthStyle {
  switch (protocol) {
    case 'anthropic':
      return 'x-api-key';
    case 'gemini':
      return 'x-goog-api-key';
    case 'cohere':
      return 'bearer';
    case 'openai-responses':
    case 'openai-compatible':
    default:
      return 'bearer';
  }
}

export function normalizeLLMProviderRuntimeConfig(
  config: Pick<LLMProviderRuntimeConfig, 'id' | 'name' | 'baseUrl' | 'model'> &
    Partial<
      Pick<
        LLMProviderRuntimeConfig,
        | 'protocol'
        | 'authStyle'
        | 'credentialMode'
        | 'oauthTarget'
        | 'supportsVision'
        | 'contextWindow'
      >
    >,
): LLMProviderRuntimeConfig {
  const protocol = config.protocol ?? 'openai-compatible';
  const authStyle = config.authStyle ?? getDefaultAuthStyleForProtocol(protocol);
  return {
    id: config.id,
    name: config.name,
    baseUrl: config.baseUrl,
    model: config.model,
    protocol,
    authStyle,
    credentialMode: config.credentialMode ?? (authStyle === 'none' ? 'none' : 'api-key'),
    ...(config.oauthTarget ? { oauthTarget: { ...config.oauthTarget } } : {}),
    ...(config.supportsVision != null ? { supportsVision: config.supportsVision } : {}),
    ...(config.contextWindow != null && { contextWindow: config.contextWindow }),
  };
}

export const BUILTIN_LLM_PROVIDER_PRESETS: readonly LLMProviderPreset[] = [
  {
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
    keyUrl: 'https://chatgpt.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-sol',
    protocol: 'openai-responses',
    authStyle: 'bearer',
    supportsVision: true,
    contextWindow: 1_050_000,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5',
    protocol: 'anthropic',
    authStyle: 'x-api-key',
    supportsVision: true,
    contextWindow: 1_000_000,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.6-flash',
    protocol: 'gemini',
    authStyle: 'x-goog-api-key',
    supportsVision: true,
    contextWindow: 1_048_576,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
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
    keyUrl: 'https://accounts.google.com',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_048_576,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'grok',
    name: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.5',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 500_000,
    keyUrl: 'https://console.x.ai/team/api-keys',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-max',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_000_000,
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_048_576,
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'doubao',
    name: 'Doubao (ByteDance)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-pro-260215',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 256_000,
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.2',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_000_000,
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot',
    name: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k3',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_000_000,
    keyUrl: 'https://platform.moonshot.ai/console',
  },
  {
    id: 'baichuan',
    name: 'Baichuan',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    model: 'Baichuan4-Turbo',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 32_000,
    keyUrl: 'https://platform.baichuan-ai.com/console/apikey',
  },
  {
    id: 'stepfun',
    name: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-3.5-flash',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 256_000,
    keyUrl: 'https://platform.stepfun.com/interface-key',
  },
  {
    id: 'volcengine-ark',
    name: '火山引擎',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-pro-260215',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 256_000,
    keyUrl: 'https://www.volcengine.com/experience/ark',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.6-sol',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_050_000,
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_048_576,
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 131_072,
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 128_000,
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/v2',
    model: 'command-a-plus-05-2026',
    protocol: 'cohere',
    authStyle: 'bearer',
    contextWindow: 128_000,
    keyUrl: 'https://dashboard.cohere.com/api-keys',
  },
  {
    id: 'ollama-local',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3.5:9b',
    protocol: 'openai-compatible',
    authStyle: 'none',
    contextWindow: 262_144,
  },
] as const;

export function listBuiltinLLMProviderPresets(): LLMProviderPreset[] {
  return BUILTIN_LLM_PROVIDER_PRESETS.map((preset) => ({ ...preset }));
}

export function getBuiltinLLMProviderPreset(providerId: string): LLMProviderPreset | undefined {
  const preset = BUILTIN_LLM_PROVIDER_PRESETS.find((entry) => entry.id === providerId);
  return preset ? { ...preset } : undefined;
}

// ---------------------------------------------------------------------------
// Vision provider presets (image-understanding models)
// ---------------------------------------------------------------------------

export interface VisionProviderPreset extends LLMProviderRuntimeConfig {
  keyUrl?: string;
}

export const BUILTIN_VISION_PROVIDER_PRESETS: readonly VisionProviderPreset[] = [
  {
    id: 'chatgpt-vision-oauth',
    name: 'ChatGPT (OAuth)',
    baseUrl: 'https://chatgpt.com',
    model: 'codex',
    protocol: 'openai-responses',
    authStyle: 'none',
    credentialMode: 'oauth',
    oauthTarget: { provider: 'chatgpt', capability: 'vision' },
    supportsVision: true,
    contextWindow: 1_050_000,
    keyUrl: 'https://chatgpt.com',
  },
  {
    id: 'openai-vision',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-sol',
    protocol: 'openai-responses',
    authStyle: 'bearer',
    supportsVision: true,
    contextWindow: 1_050_000,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini-vision',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.6-flash',
    protocol: 'gemini',
    authStyle: 'x-goog-api-key',
    supportsVision: true,
    contextWindow: 1_048_576,
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'gemini-vision-oauth',
    name: 'Google Gemini (OAuth)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.6-flash',
    protocol: 'gemini',
    authStyle: 'none',
    credentialMode: 'oauth',
    oauthTarget: { provider: 'gemini', capability: 'vision' },
    supportsVision: true,
    contextWindow: 1_048_576,
    keyUrl: 'https://accounts.google.com',
  },
  {
    id: 'claude-vision',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5',
    protocol: 'anthropic',
    authStyle: 'x-api-key',
    supportsVision: true,
    contextWindow: 1_000_000,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'qwen-vision',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_000_000,
    keyUrl: 'https://dashscope.aliyun.com/api-key',
  },
  {
    id: 'openrouter-vision',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.6-sol',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_050_000,
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'siliconflow-vision',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-VL-32B-Instruct',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'together-vision',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'Qwen/Qwen3.5-9B',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'grok-vision',
    name: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.5',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 500_000,
    keyUrl: 'https://console.x.ai/team/api-keys',
  },
  {
    id: 'mistral-vision',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 128_000,
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'doubao-vision',
    name: 'Doubao (ByteDance)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2-0-pro-260215',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 256_000,
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  },
  {
    id: 'zhipu-vision',
    name: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5v-turbo',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot-vision',
    name: 'Moonshot / Kimi',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k3',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    contextWindow: 1_000_000,
    keyUrl: 'https://platform.moonshot.ai/console',
  },
  {
    id: 'stepfun-vision',
    name: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    model: 'step-3',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://platform.stepfun.com/interface-key',
  },
  {
    id: 'ollama-vision',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3.5:9b',
    protocol: 'openai-compatible',
    authStyle: 'none',
    contextWindow: 262_144,
  },
] as const;

export function listBuiltinVisionProviderPresets(): VisionProviderPreset[] {
  return BUILTIN_VISION_PROVIDER_PRESETS.map((preset) => ({ ...preset }));
}

export function getBuiltinVisionProviderPreset(
  providerId: string,
): VisionProviderPreset | undefined {
  const preset = BUILTIN_VISION_PROVIDER_PRESETS.find((entry) => entry.id === providerId);
  return preset ? { ...preset } : undefined;
}
