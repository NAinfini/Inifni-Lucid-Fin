import { describe, it, expect, vi } from 'vitest';
import {
  ContextManager,
  pruneHistory,
  truncateOldToolResults,
} from './context-manager.js';
import type { LLMAdapter, LLMMessage } from '@lucid-fin/contracts';

function makeMockLlm(response = '[done] summary'): LLMAdapter {
  return {
    complete: vi.fn().mockResolvedValue(response),
    completeWithTools: vi.fn(),
    id: 'mock',
    contextWindow: 200000,
    effectiveContextWindow: 200000,
    profile: {} as unknown as LLMAdapter['profile'],
  } as unknown as LLMAdapter;
}

function makeMessagesForCompaction(count = 16, charsEach = 10000): LLMMessage[] {
  return [
    { role: 'system', content: 'system prompt' },
    ...Array.from({ length: count }, (_, i) => ({
      role: (i % 2 === 0 ? 'assistant' : 'user') as 'assistant' | 'user',
      content: 'x'.repeat(charsEach),
    })),
    { role: 'user', content: 'latest message' },
  ];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as unknown as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function makeToolMessagesForCompaction(): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: 'system', content: 'system prompt' }];
  for (let group = 0; group < 10; group++) {
    messages.push({
      role: 'assistant',
      content: `query ${group}`,
      toolCalls: [
        {
          id: `query-${group}`,
          name: 'canvas.listNodes',
          arguments: { payload: 'x'.repeat(500) },
        },
      ],
    });
    messages.push({
      role: 'tool',
      content: 'x'.repeat(8_000),
      toolCallId: `query-${group}`,
    });
  }
  messages.push({ role: 'user', content: 'latest message' });
  return messages;
}

describe('immutable compaction views', () => {
  it('derives truncation without changing content or tool arguments in the source', () => {
    const messages = makeToolMessagesForCompaction();
    const before = structuredClone(messages);
    const source: readonly LLMMessage[] = deepFreeze(messages);

    const result = truncateOldToolResults(source);

    expect(source).toEqual(before);
    expect(result.truncated).toBeGreaterThan(0);
    expect(result.view).not.toBe(source);
    expect(result.view).not.toEqual(before);
  });

  it('returns a derived LLM summary view while leaving a frozen source unchanged', async () => {
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt');
    const messages = makeMessagesForCompaction();
    const before = structuredClone(messages);
    const source: readonly LLMMessage[] = deepFreeze(messages);

    const result = await cm.compactWithLLMResult(source, 20_000, 1);

    expect(source).toEqual(before);
    expect(result.changed).toBe(true);
    expect(result.view.some((message) => message.content.includes('Context compacted'))).toBe(true);
  });

  it('returns the original-equivalent view after a low-yield Phase 1 attempt', () => {
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt');
    const messages = makeMessagesForCompaction(2, 100);
    const before = structuredClone(messages);
    const source: readonly LLMMessage[] = deepFreeze(messages);

    const result = cm.compactPhase1(source, 1);

    expect(source).toEqual(before);
    expect(result).toMatchObject({ changed: false, truncated: 0, attempted: true });
    expect(result.view).toEqual(before);
    expect(result.view).not.toBe(source);
  });

  it('returns an empty derived view when compactNow has no input', async () => {
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt');

    await expect(cm.compactNow(null)).resolves.toEqual({
      freedChars: 0,
      messageCount: 0,
      toolCount: 0,
      view: [],
    });
  });
});

describe('ContextManager guide retention', () => {
  it('retains only task-list-critical guides after the opening steps', () => {
    const manager = new ContextManager(makeMockLlm(), () => 'system prompt');
    const prompt = manager.buildSystemPrompt(
      {
        page: 'canvas',
        extra: {
          autoInjectGuides: [
            { name: 'Turn Guide', content: 'turn-only-content', retention: 'turn' },
            {
              name: 'Task-list Guide',
              content: 'task-list-critical-content',
              retention: 'task_list',
            },
          ],
        },
      },
      6,
    );

    expect(prompt).toContain('task-list-critical-content');
    expect(prompt).not.toContain('turn-only-content');
  });
});

describe('pruneHistory', () => {
  it('keeps a large retained suffix in its original order', () => {
    const history = Array.from({ length: 2_000 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index}`,
    }));

    const result = pruneHistory(deepFreeze(history), 1_000_000);

    expect(result).toEqual(history);
    expect(result[0]).not.toBe(history[0]);
  });
});

describe('compactWithLLM post-compact reload', () => {
  it('distinguishes a throttled no-op from an attempted compaction failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    try {
      const onBeforeCompact = vi.fn().mockReturnValue(false);
      const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onBeforeCompact });
      const first = makeMessagesForCompaction();
      const second = makeMessagesForCompaction();

      const failed = await cm.compactWithLLMResult(first, 20_000, 3);
      const throttled = await cm.compactWithLLMResult(second, 20_000, 4);

      expect(failed).toMatchObject({ attempted: true, changed: false });
      expect(throttled).toMatchObject({ attempted: false, changed: false });
      expect(onBeforeCompact).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs rule-based pruning in the same compaction attempt before calling the LLM', async () => {
    const llm = makeMockLlm();
    const cm = new ContextManager(llm, () => 'system prompt');
    const messages: LLMMessage[] = [{ role: 'system', content: 'system prompt' }];
    for (let group = 0; group < 10; group++) {
      messages.push({
        role: 'assistant',
        content: `query ${group}`,
        toolCalls: [{ id: `query-${group}`, name: 'canvas.listNodes', arguments: {} }],
      });
      messages.push({
        role: 'tool',
        content: 'x'.repeat(8_000),
        toolCallId: `query-${group}`,
      });
    }
    messages.push({ role: 'user', content: 'latest message' });

    const result = await cm.compactWithLLM(messages, 40_000, 1);

    expect(result.changed).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(result.view.some((message) => message.content.includes('[Compacted block]'))).toBe(true);
  });

  it('reports no compaction when the LLM fails and rule-based pruning changed nothing', async () => {
    const llm = makeMockLlm();
    vi.mocked(llm.complete).mockRejectedValueOnce(new Error('summary provider unavailable'));
    const cm = new ContextManager(llm, () => 'system prompt');
    const messages = makeMessagesForCompaction();
    const before = structuredClone(messages);
    const source: readonly LLMMessage[] = deepFreeze(messages);

    const result = await cm.compactWithLLM(source, 20_000, 1);

    expect(result.changed).toBe(false);
    expect(result.view).toEqual(before);
    expect(source).toEqual(before);
  });

  it('does not auto-compact twice within two turns or thirty seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    try {
      const llm = makeMockLlm();
      const cm = new ContextManager(llm, () => 'system prompt');
      const first = makeMessagesForCompaction();
      const second = makeMessagesForCompaction();

      expect((await cm.compactWithLLM(first, 20_000, 3)).changed).toBe(true);
      vi.setSystemTime(new Date('2026-08-01T00:00:31Z'));
      expect((await cm.compactWithLLM(second, 20_000, 4)).changed).toBe(false);
      expect(llm.complete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('appends onPostCompact output after LLM summary', async () => {
    const onPostCompact = vi.fn().mockReturnValue('## Workspace Reload\nCanvas: "test" (5 nodes)');
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();
    const charBudget = 20000;

    const result = await cm.compactWithLLM(messages, charBudget);

    expect(result.changed).toBe(true);
    expect(onPostCompact).toHaveBeenCalledOnce();
    const compactedMsg = result.view.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).toContain('WORKSPACE CONTEXT RELOAD');
    expect(compactedMsg!.content).toContain('Canvas: "test" (5 nodes)');
  });

  it('skips reload gracefully when onPostCompact is not provided', async () => {
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt');
    const messages = makeMessagesForCompaction();

    const result = await cm.compactWithLLM(messages, 20000);

    const compactedMsg = result.view.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('skips reload when onPostCompact returns empty string', async () => {
    const onPostCompact = vi.fn().mockReturnValue('');
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();

    const result = await cm.compactWithLLM(messages, 20000);

    expect(onPostCompact).toHaveBeenCalledOnce();
    const compactedMsg = result.view.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('skips reload when onPostCompact returns null', async () => {
    const onPostCompact = vi.fn().mockReturnValue(null);
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();

    const result = await cm.compactWithLLM(messages, 20000);

    expect(onPostCompact).toHaveBeenCalledOnce();
    const compactedMsg = result.view.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('fails compaction when the authoritative workspace reload throws', async () => {
    const onPostCompact = vi.fn(() => {
      throw new Error('workspace unavailable');
    });
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();
    const before = structuredClone(messages);
    const source: readonly LLMMessage[] = deepFreeze(messages);

    await expect(cm.compactWithLLM(source, 20_000, 1)).rejects.toThrow('workspace unavailable');
    expect(source).toEqual(before);
  });
});

describe('compactNow post-compact reload (Phase 1 only)', () => {
  it('injects reload when Phase 1 frees enough and onPostCompact is provided', async () => {
    const onPostCompact = vi.fn().mockReturnValue('## Reload\nFresh state');
    const cm = new ContextManager(makeMockLlm(), () => 'sys', { onPostCompact });

    // Build messages with >4 tool call groups so Phase 1 truncation
    // can actually free old query results (only the last 4 groups are kept).
    // Use large tool results so >50% of chars are freed by Phase 1 alone.
    const messages: LLMMessage[] = [{ role: 'system', content: 'system prompt' }];
    for (let g = 0; g < 10; g++) {
      messages.push({
        role: 'assistant',
        content: `step ${g}`,
        toolCalls: [{ id: `tc-${g}`, name: 'canvas.listNodes', arguments: {} }],
      });
      messages.push({
        role: 'tool',
        content: 'x'.repeat(8000),
        toolCallId: `tc-${g}`,
      });
    }
    messages.push({ role: 'user', content: 'latest' });

    const before = structuredClone(messages);
    const source: readonly LLMMessage[] = deepFreeze(messages);
    const result = await cm.compactNow(source);

    expect(onPostCompact).toHaveBeenCalled();
    expect(source).toEqual(before);
    const reloadMsg = result.view.find((m) => m.content.includes('Fresh state'));
    expect(reloadMsg).toBeDefined();
    expect(reloadMsg!.content).toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('skips reload in compactNow when onPostCompact is not provided', async () => {
    const cm = new ContextManager(makeMockLlm(), () => 'sys');

    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'assistant',
        content: 'checking',
        toolCalls: [{ id: 'tc-1', name: 'canvas.listNodes', arguments: {} }],
      },
      { role: 'tool', content: 'x'.repeat(5000), toolCallId: 'tc-1' },
      { role: 'user', content: 'latest' },
    ];

    const result = await cm.compactNow(messages);

    const reloadMsg = result.view.find((m) => m.content.includes('WORKSPACE CONTEXT RELOAD'));
    expect(reloadMsg).toBeUndefined();
  });
});
