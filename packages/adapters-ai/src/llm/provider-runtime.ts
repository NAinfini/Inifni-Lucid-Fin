import type { LLMAdapter, LLMProviderRuntimeConfig } from '@lucid-fin/contracts';
import {
  getBuiltinLLMProviderPreset as getBuiltinLLMProviderPresetFromContracts,
  listBuiltinLLMProviderPresets as listBuiltinLLMProviderPresetsFromContracts,
} from '@lucid-fin/contracts';
import { ClaudeLLMAdapter } from './claude-llm.js';
import { CohereLLMAdapter } from './cohere-llm.js';
import { GeminiLLMAdapter } from './gemini-llm.js';
import { OpenAICompatibleLLM } from './openai-compatible-base.js';
import { OpenAIResponsesLLM } from './openai-responses-llm.js';

export function listBuiltinLLMProviderPresets() {
  return listBuiltinLLMProviderPresetsFromContracts();
}

export function getBuiltinLLMProviderPreset(providerId: string) {
  return getBuiltinLLMProviderPresetFromContracts(providerId);
}

export function buildRuntimeLLMAdapter(config: LLMProviderRuntimeConfig): LLMAdapter {
  switch (config.protocol) {
    case 'anthropic':
      return new ClaudeLLMAdapter({
        id: config.id,
        name: config.name,
        defaultBaseUrl: config.baseUrl,
        defaultModel: config.model,
      });
    case 'gemini':
      return new GeminiLLMAdapter({
        id: config.id,
        name: config.name,
        defaultBaseUrl: config.baseUrl,
        defaultModel: config.model,
      });
    case 'cohere':
      return new CohereLLMAdapter({
        id: config.id,
        name: config.name,
        defaultBaseUrl: config.baseUrl,
        defaultModel: config.model,
      });
    case 'openai-responses':
      return new OpenAIResponsesLLM({
        id: config.id,
        name: config.name,
        defaultBaseUrl: config.baseUrl,
        defaultModel: config.model,
        authStyle: config.authStyle,
      });
    case 'openai-compatible':
    default:
      return new OpenAICompatibleLLM({
        id: config.id,
        name: config.name,
        defaultBaseUrl: config.baseUrl,
        defaultModel: config.model,
        authStyle: config.authStyle,
      });
  }
}
