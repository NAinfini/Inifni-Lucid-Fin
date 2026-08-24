import { buildRuntimeLLMAdapter, type LLMRegistry } from '@lucid-fin/adapters-ai';
import {
  assertLLMProviderConfiguration,
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
  const presetRuntime = preset ? normalizeLLMProviderRuntimeConfig(preset) : undefined;

  return normalizeLLMProviderRuntimeConfig({
    id: config.id,
    name: config.name ?? preset?.name ?? config.id,
    baseUrl: config.baseUrl ?? preset?.baseUrl ?? '',
    model: config.model ?? preset?.model ?? '',
    protocol: config.protocol ?? preset?.protocol,
    authStyle: config.authStyle ?? preset?.authStyle,
    credentialMode: config.credentialMode ?? preset?.credentialMode,
    oauthTarget: config.oauthTarget ?? preset?.oauthTarget,
    supportsModelOverride:
      presetRuntime?.supportsModelOverride ?? config.supportsModelOverride,
    supportsReasoningEffort:
      presetRuntime?.supportsReasoningEffort ?? config.supportsReasoningEffort,
    reasoningEffortsByModel:
      presetRuntime?.reasoningEffortsByModel ?? config.reasoningEffortsByModel,
    reasoningEffort: config.reasoningEffort,
    supportsVision: config.supportsVision ?? preset?.supportsVision,
    contextWindow: config.contextWindow,
  });
}

export function hasLLMProviderConnectionFields(config: LLMProviderRuntimeConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.model.trim().length > 0;
}

export function requiresLLMProviderApiKey(config: LLMProviderRuntimeConfig): boolean {
  return config.credentialMode !== 'oauth' && config.authStyle !== 'none';
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
    credentialMode: config.credentialMode,
    oauthTarget: config.oauthTarget,
    supportsModelOverride: config.supportsModelOverride,
    supportsReasoningEffort: config.supportsReasoningEffort,
    reasoningEffort: config.reasoningEffort,
  };
}

export function createConfiguredLLMAdapter(
  llmRegistry: Pick<LLMRegistry, 'list'>,
  config: LLMProviderRuntimeConfig,
  apiKey: string | null,
): LLMAdapter {
  assertLLMProviderConfiguration(config);
  const adapter =
    llmRegistry.list().find((entry) => entry.id === config.id) ?? buildRuntimeLLMAdapter(config);

  adapter.configure(apiKey ?? '', {
    baseUrl: config.baseUrl,
    model: config.model,
    supportsModelOverride: config.supportsModelOverride,
    supportsReasoningEffort: config.supportsReasoningEffort,
    reasoningEffortsByModel: config.reasoningEffortsByModel,
    reasoningEffort: config.reasoningEffort,
    ...(config.contextWindow && { contextWindow: config.contextWindow }),
  });

  return adapter;
}
