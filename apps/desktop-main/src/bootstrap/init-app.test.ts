import { describe, expect, it, vi } from 'vitest';
import type { LLMAdapter } from '@lucid-fin/contracts';
import { selectConfiguredLLMAdapter } from './init-app.js';

function makeAdapter(id: string, configured: boolean): LLMAdapter {
  return {
    id,
    name: id,
    capabilities: [],
    configure: vi.fn(),
    validate: vi.fn().mockResolvedValue(configured),
    complete: vi.fn(),
    stream: vi.fn(),
    completeWithTools: vi.fn(),
  } as unknown as LLMAdapter;
}

describe('selectConfiguredLLMAdapter', () => {
  it('returns the first configured adapter, not the first registered one', async () => {
    const openai = makeAdapter('openai', false);
    const claude = makeAdapter('claude', true);

    await expect(selectConfiguredLLMAdapter([openai, claude])).resolves.toBe(claude);
  });

  it('throws when no adapter is configured', async () => {
    const openai = makeAdapter('openai', false);
    const claude = makeAdapter('claude', false);

    await expect(selectConfiguredLLMAdapter([openai, claude])).rejects.toThrow(
      'No configured LLM adapter',
    );
  });
});
