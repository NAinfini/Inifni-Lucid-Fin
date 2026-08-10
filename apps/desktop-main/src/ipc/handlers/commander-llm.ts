/**
 * LLM adapter selection and history validation for Commander.
 *
 * Extracted from commander.handlers.ts to reduce that file's surface area.
 */
import log from '../../logger.js';
import type { LLMRegistry } from '@lucid-fin/adapters-ai';
import type { LLMProviderRuntimeConfig } from '@lucid-fin/contracts';
import type { Keychain } from '@lucid-fin/storage';
import type { HistoryEntry } from '@lucid-fin/application';
import {
  createConfiguredLLMAdapter,
  getLLMProviderLogFields,
  resolveLLMProviderRuntimeConfig,
  requiresLLMProviderApiKey,
} from '../../llm-provider-runtime.js';
import { isStoredKeyAllowedForBaseUrl } from './provider-host-allowlist.js';

// ---------------------------------------------------------------------------
// LLM adapter selection
// ---------------------------------------------------------------------------

export async function selectConfiguredAdapter(
  llmRegistry: LLMRegistry,
  keychain: Keychain,
  customProvider?: LLMProviderRuntimeConfig,
) {
  const logAttempt = (
    level: 'info' | 'warn' | 'error',
    message: string,
    detail: Record<string, unknown>,
  ) => {
    log[level](message, { category: 'provider', ...detail });
  };

  if (customProvider?.id) {
    if (!customProvider.baseUrl || !customProvider.model) {
      const runtimeConfig = resolveLLMProviderRuntimeConfig(customProvider);
      logAttempt('warn', 'Selected LLM provider is missing runtime connection fields', {
        ...getLLMProviderLogFields(runtimeConfig),
      });
      throw new Error(
        `Selected LLM provider "${runtimeConfig.name}" is missing a base URL or model.`,
      );
    }

    const runtimeConfig = resolveLLMProviderRuntimeConfig(customProvider);
    const isRegistered = !!llmRegistry.list().find((adapter) => adapter.id === runtimeConfig.id);
    // Security: for a registered provider (known canonical host), never send the
    // stored key to a renderer-supplied baseUrl that is not on its allowlist —
    // this prevents key exfiltration via a forged baseUrl. Custom user-added
    // providers legitimately use their own configured endpoint, so they are
    // exempt (the stored key belongs to that custom endpoint by definition).
    if (isRegistered && !isStoredKeyAllowedForBaseUrl(runtimeConfig.id, runtimeConfig.baseUrl)) {
      logAttempt('warn', 'Refusing stored key for registered LLM provider with untrusted baseUrl', {
        ...getLLMProviderLogFields(runtimeConfig),
        source: 'untrusted-baseurl',
      });
      throw new Error(
        `Provider "${runtimeConfig.name}" base URL is not permitted for its stored key.`,
      );
    }
    const apiKey = requiresLLMProviderApiKey(runtimeConfig)
      ? await keychain.getKey(runtimeConfig.id)
      : null;
    const configuredAdapter = createConfiguredLLMAdapter(llmRegistry, runtimeConfig, apiKey);
    const source = isRegistered ? 'selected-registered-provider' : 'selected-custom-provider';

    if (!apiKey && requiresLLMProviderApiKey(runtimeConfig)) {
      logAttempt('warn', 'Selected LLM provider has no stored API key', {
        ...getLLMProviderLogFields(runtimeConfig),
        source,
      });
      throw new Error(`Selected LLM provider "${runtimeConfig.name}" has no API key configured.`);
    }

    logAttempt('info', 'Selected LLM provider configured for commander chat', {
      ...getLLMProviderLogFields(runtimeConfig),
      source,
    });
    return configuredAdapter;
  }

  logAttempt('warn', 'Commander chat requested without a selected LLM provider runtime config', {
    source: 'missing-selected-provider',
  });
  throw new Error('No configured LLM adapter. Please configure an AI provider in Settings.');
}

// ---------------------------------------------------------------------------
// History validation
// ---------------------------------------------------------------------------

export function validateHistoryEntries(history: HistoryEntry[]): void {
  for (const entry of history) {
    if (!entry || typeof entry.content !== 'string') {
      throw new Error('history entries must contain a valid role and content');
    }
    if (entry.role === 'tool') {
      if (typeof (entry as { toolCallId?: unknown }).toolCallId !== 'string') {
        throw new Error('tool history entries must contain a toolCallId');
      }
    } else if (entry.role !== 'user' && entry.role !== 'assistant') {
      throw new Error('history entries must contain a valid role and content');
    }
  }
}
