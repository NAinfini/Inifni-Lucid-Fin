import { describe, it, expect, vi } from 'vitest';
import { LLMRegistry } from './llm-registry.js';
import { OpenAILLMAdapter } from './openai-llm.js';
import { ClaudeLLMAdapter } from './claude-llm.js';
import { GeminiLLMAdapter } from './gemini-llm.js';
import { OllamaLLMAdapter } from './ollama-llm.js';
import type { LLMAdapter } from '@lucid-fin/contracts';

function mockLLM(id = 'mock-llm'): LLMAdapter {
  return {
    id,
    name: `Mock ${id}`,
    capabilities: ['text-generation'],
    configure: vi.fn(),
    validate: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue('hello'),
    stream: vi.fn(async function* () {
      yield 'hello';
    }),
    completeWithTools: vi
      .fn()
      .mockResolvedValue({ content: 'hello', toolCalls: [], finishReason: 'stop' }),
  };
}

describe('LLMRegistry', () => {
  it('registers and retrieves', () => {
    const reg = new LLMRegistry();
    const llm = mockLLM('openai');
    reg.register(llm);
    expect(reg.get('openai')).toBe(llm);
  });

  it('returns undefined for unknown', () => {
    const reg = new LLMRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('lists all adapters', () => {
    const reg = new LLMRegistry();
    reg.register(mockLLM('a'));
    reg.register(mockLLM('b'));
    expect(reg.list()).toHaveLength(2);
  });

  it('unregisters', () => {
    const reg = new LLMRegistry();
    reg.register(mockLLM('a'));
    expect(reg.unregister('a')).toBe(true);
    expect(reg.get('a')).toBeUndefined();
    expect(reg.unregister('a')).toBe(false);
  });
});

describe('LLMAdapter completeWithTools', () => {
  it('OpenAILLMAdapter has completeWithTools method', () => {
    const adapter = new OpenAILLMAdapter();
    expect(typeof adapter.completeWithTools).toBe('function');
  });

  it('ClaudeLLMAdapter has completeWithTools method', () => {
    const adapter = new ClaudeLLMAdapter();
    expect(typeof adapter.completeWithTools).toBe('function');
  });

  it('GeminiLLMAdapter has completeWithTools method', () => {
    const adapter = new GeminiLLMAdapter();
    expect(typeof adapter.completeWithTools).toBe('function');
  });

  it('OllamaLLMAdapter has completeWithTools method', () => {
    const adapter = new OllamaLLMAdapter();
    expect(typeof adapter.completeWithTools).toBe('function');
  });
});
