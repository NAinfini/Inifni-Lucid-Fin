export type LLMProviderProtocol =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic'
  | 'gemini'
  | 'cohere';

export type LLMProviderAuthStyle = 'bearer' | 'x-api-key' | 'x-goog-api-key' | 'none';

export interface LLMProviderRuntimeConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: LLMProviderProtocol;
  authStyle: LLMProviderAuthStyle;
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
    Partial<Pick<LLMProviderRuntimeConfig, 'protocol' | 'authStyle'>>,
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
  };
}

export const BUILTIN_LLM_PROVIDER_PRESETS: readonly LLMProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
    protocol: 'anthropic',
    authStyle: 'x-api-key',
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    protocol: 'gemini',
    authStyle: 'x-goog-api-key',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'grok',
    name: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://console.x.ai/team/api-keys',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    protocol: 'openai-compatible',
    authStyle: 'bearer',
    keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'cohere',
    name: 'Cohere',
    baseUrl: 'https://api.cohere.com/v2',
    model: 'command-a-03-2025',
    protocol: 'cohere',
    authStyle: 'bearer',
    keyUrl: 'https://dashboard.cohere.com/api-keys',
  },
  {
    id: 'ollama-local',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    protocol: 'openai-compatible',
    authStyle: 'none',
  },
] as const;

export function listBuiltinLLMProviderPresets(): LLMProviderPreset[] {
  return BUILTIN_LLM_PROVIDER_PRESETS.map((preset) => ({ ...preset }));
}

export function getBuiltinLLMProviderPreset(providerId: string): LLMProviderPreset | undefined {
  const preset = BUILTIN_LLM_PROVIDER_PRESETS.find((entry) => entry.id === providerId);
  return preset ? { ...preset } : undefined;
}
