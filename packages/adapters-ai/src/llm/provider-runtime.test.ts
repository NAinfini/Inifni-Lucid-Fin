import { describe, expect, it } from 'vitest';
import {
  buildRuntimeLLMAdapter,
  getBuiltinLLMProviderPreset,
  listBuiltinLLMProviderPresets,
} from './provider-runtime.js';

describe('provider runtime presets', () => {
  it('exposes the supported mainstream preset providers with protocol metadata', () => {
    expect(
      listBuiltinLLMProviderPresets().map(({ id, protocol, authStyle }) => ({
        id,
        protocol,
        authStyle,
      })),
    ).toEqual([
      { id: 'openai', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'claude', protocol: 'anthropic', authStyle: 'x-api-key' },
      { id: 'gemini', protocol: 'gemini', authStyle: 'x-goog-api-key' },
      { id: 'deepseek', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'grok', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'qwen', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'openrouter', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'together', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'groq', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'mistral', protocol: 'openai-compatible', authStyle: 'bearer' },
      { id: 'cohere', protocol: 'cohere', authStyle: 'bearer' },
      { id: 'ollama-local', protocol: 'openai-compatible', authStyle: 'none' },
    ]);
  });

  it('builds the correct adapter family for protocol-native providers', () => {
    const claude = buildRuntimeLLMAdapter(getBuiltinLLMProviderPreset('claude')!);
    const gemini = buildRuntimeLLMAdapter(getBuiltinLLMProviderPreset('gemini')!);
    const cohere = buildRuntimeLLMAdapter(getBuiltinLLMProviderPreset('cohere')!);

    expect(claude.constructor.name).toBe('ClaudeLLMAdapter');
    expect(gemini.constructor.name).toBe('GeminiLLMAdapter');
    expect(cohere.constructor.name).toBe('CohereLLMAdapter');
  });

  it('builds openai-compatible adapters for hosted compatible presets', () => {
    const together = buildRuntimeLLMAdapter(getBuiltinLLMProviderPreset('together')!);
    const mistral = buildRuntimeLLMAdapter(getBuiltinLLMProviderPreset('mistral')!);

    expect(together.id).toBe('together');
    expect(mistral.id).toBe('mistral');
    expect(together.constructor.name).toBe('OpenAICompatibleLLM');
    expect(mistral.constructor.name).toBe('OpenAICompatibleLLM');
  });
});
