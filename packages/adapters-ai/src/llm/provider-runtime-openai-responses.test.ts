import { describe, it, expect, vi } from 'vitest';
import { buildRuntimeLLMAdapter } from './provider-runtime.js';

describe('buildRuntimeLLMAdapter openai-responses branch', () => {
  it('builds an OpenAIResponsesLLM and preserves auth metadata', () => {
    const adapter = buildRuntimeLLMAdapter({
      id: 'openai-responses',
      name: 'OpenAI Responses',
      protocol: 'openai-responses',
      authStyle: 'x-api-key',
      baseUrl: 'https://responses.example/v1',
      model: 'gpt-5.4',
      capabilities: ['text-generation'],
    });

    expect(adapter.constructor.name).toBe('OpenAIResponsesLLM');
    expect(adapter.id).toBe('openai-responses');
    expect(adapter.name).toBe('OpenAI Responses');
    expect(Reflect.get(adapter, 'authStyle')).toBe('x-api-key');
    expect(Reflect.get(adapter, 'model')).toBe('gpt-5.4');
  });

  it('falls back to the openai-compatible family for unknown protocols', () => {
    const adapter = buildRuntimeLLMAdapter({
      id: 'custom',
      name: 'Custom Gateway',
      protocol: 'unknown-protocol' as never,
      authStyle: 'bearer',
      baseUrl: 'https://gateway.example/v1',
      model: 'gpt-5.4',
      capabilities: ['text-generation'],
    });

    expect(adapter.constructor.name).toBe('OpenAICompatibleLLM');
    expect(adapter.id).toBe('custom');
    expect(Reflect.get(adapter, 'authStyle')).toBe('bearer');
  });
});
