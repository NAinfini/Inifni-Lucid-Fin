import type { PayloadAction } from '@reduxjs/toolkit';
import {
  normalizeLLMProviderRuntimeConfig,
  type LLMProviderAuthStyle,
  type LLMProviderProtocol,
} from '@lucid-fin/contracts';
import type { APIGroup, ProviderCollectionConfig, ProviderConfig, SettingsState } from './types.js';
import { getProviderDefaults } from './provider-defaults.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findProvider(
  groupState: ProviderCollectionConfig,
  providerId: string,
): ProviderConfig | undefined {
  return groupState.providers.find((provider) => provider.id === providerId);
}

// ---------------------------------------------------------------------------
// Provider mutation reducers
// ---------------------------------------------------------------------------

export function setProviderBaseUrl(
  state: SettingsState,
  action: PayloadAction<{ group: APIGroup; provider: string; url: string }>,
) {
  const provider = findProvider(state[action.payload.group], action.payload.provider);
  if (provider) {
    provider.baseUrl = action.payload.url;
  }
}

export function setProviderModel(
  state: SettingsState,
  action: PayloadAction<{ group: APIGroup; provider: string; model: string }>,
) {
  const provider = findProvider(state[action.payload.group], action.payload.provider);
  if (provider) {
    provider.model = action.payload.model;
  }
}

export function setProviderProtocol(
  state: SettingsState,
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
}

export function setProviderHasKey(
  state: SettingsState,
  action: PayloadAction<{ group: APIGroup; provider: string; hasKey: boolean }>,
) {
  const provider = findProvider(state[action.payload.group], action.payload.provider);
  if (provider) {
    provider.hasKey = action.payload.hasKey;
  }
}

export function setProviderName(
  state: SettingsState,
  action: PayloadAction<{ group: APIGroup; provider: string; name: string }>,
) {
  const provider = findProvider(state[action.payload.group], action.payload.provider);
  if (provider?.isCustom) {
    provider.name = action.payload.name;
  }
}

export function commitProvider(
  state: SettingsState,
  action: PayloadAction<{
    group: APIGroup;
    providerId: string;
    config: {
      baseUrl: string;
      model: string;
      protocol?: LLMProviderProtocol;
      authStyle?: LLMProviderAuthStyle;
      name?: string;
      contextWindow?: number;
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

  if (config.contextWindow !== undefined) {
    provider.contextWindow = config.contextWindow || undefined;
  }
}

export function resetProviderToDefaults(
  state: SettingsState,
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
}

export function addCustomProvider(
  state: SettingsState,
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
    ...(action.payload.group === 'llm' ? { contextWindow: 128_000 } : {}),
  });
}

export function removeCustomProvider(
  state: SettingsState,
  action: PayloadAction<{ group: APIGroup; provider: string }>,
) {
  const groupState = state[action.payload.group];
  const provider = findProvider(groupState, action.payload.provider);
  if (!provider?.isCustom) {
    return;
  }

  groupState.providers = groupState.providers.filter(
    (entry) => entry.id !== action.payload.provider,
  );
}

export function setDefaultProvider(
  state: SettingsState,
  action: PayloadAction<{ group: APIGroup; provider: string | undefined }>,
) {
  state[action.payload.group].defaultProviderId = action.payload.provider;
}
