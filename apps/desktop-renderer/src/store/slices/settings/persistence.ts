import type { LLMProviderAuthStyle, LLMProviderProtocol } from '@lucid-fin/contracts';
import type { APIGroup, ProviderConfig, SettingsState, UsageStats, ProductionConfig } from './types.js';
import { getProviderDefaults } from './provider-defaults.js';

// ---------------------------------------------------------------------------
// Sparse persistence types
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
  contextWindow?: number;
}

export interface SparseSettingsState {
  llm: { providers: SparseProviderConfig[]; defaultProviderId?: string };
  image: { providers: SparseProviderConfig[]; defaultProviderId?: string };
  video: { providers: SparseProviderConfig[]; defaultProviderId?: string };
  audio: { providers: SparseProviderConfig[]; defaultProviderId?: string };
  vision: { providers: SparseProviderConfig[]; defaultProviderId?: string };
  renderPreset: string;
  usage: UsageStats;
  production: ProductionConfig;
  styleGuide: import('@lucid-fin/contracts').StyleGuide;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isProviderConfigured(group: APIGroup, provider: ProviderConfig): boolean {
  if (provider.isCustom) return true;
  if (provider.hasKey) return true;

  const defaults = getProviderDefaults(group, provider.id);
  if (!defaults) return true; // unknown provider -- preserve it

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
    ...(provider.contextWindow ? { contextWindow: provider.contextWindow } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildSparseSettings(state: SettingsState): SparseSettingsState {
  const groups = ['llm', 'image', 'video', 'audio', 'vision'] as const;
  const sparse = {} as Record<string, { providers: SparseProviderConfig[] }>;

  for (const group of groups) {
    sparse[group] = {
      providers: state[group].providers
        .filter((p) => isProviderConfigured(group, p))
        .map(toSparseProvider),
      ...(state[group].defaultProviderId ? { defaultProviderId: state[group].defaultProviderId } : {}),
    };
  }

  return {
    ...sparse,
    renderPreset: state.renderPreset,
    usage: state.usage,
    production: state.production,
    styleGuide: state.styleGuide,
  } as SparseSettingsState;
}
