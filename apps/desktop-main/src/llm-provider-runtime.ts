import { buildRuntimeLLMAdapter, type LLMRegistry } from '@lucid-fin/adapters-ai';
import {
  getBuiltinLLMProviderPreset,
  normalizeLLMProviderRuntimeConfig,
  type LLMAdapter,
  type LLMProviderRuntimeConfig,
  type LLMProviderRuntimeInput,
} from '@lucid-fin/contracts';

export function resolveLLMProviderRuntimeConfig(
  config: LLMProviderRuntimeInput,
): LLMProviderRuntimeConfig {
  const preset = getBuiltinLLMProviderPreset(config.id);

  return normalizeLLMProviderRuntimeConfig({
    id: config.id,
    name: config.name ?? preset?.name ?? config.id,
    baseUrl: config.baseUrl ?? preset?.baseUrl ?? '',
    model: config.model ?? preset?.model ?? '',
    protocol: config.protocol ?? preset?.protocol,
    authStyle: config.authStyle ?? preset?.authStyle,
  });
}

export function hasLLMProviderConnectionFields(config: LLMProviderRuntimeConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.model.trim().length > 0;
}

export function requiresLLMProviderApiKey(config: LLMProviderRuntimeConfig): boolean {
  return config.authStyle !== 'none';
}

export function getLLMProviderLogFields(
  config: Partial<LLMProviderRuntimeConfig> | null | undefined,
): Record<string, unknown> {
  if (!config) {
    return {};
  }

  return {
    providerId: config.id,
    providerName: config.name,
    baseUrl: config.baseUrl,
    model: config.model,
    protocol: config.protocol,
    authStyle: config.authStyle,
  };
}

export function createConfiguredLLMAdapter(
  llmRegistry: Pick<LLMRegistry, 'list'>,
  config: LLMProviderRuntimeConfig,
  apiKey: string | null,
): LLMAdapter {
  const adapter = llmRegistry.list().find((entry) => entry.id === config.id) ?? buildRuntimeLLMAdapter(config);

  adapter.configure(apiKey ?? '', {
    baseUrl: config.baseUrl,
    model: config.model,
    ...(config.contextWindow && { contextWindow: config.contextWindow }),
  });

  return adapter;
}
