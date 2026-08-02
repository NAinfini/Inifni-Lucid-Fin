import { describe, it, expect, vi } from 'vitest';
import {
  selectContextualToolSet,
  ALWAYS_LOADED_TOOLS,
  TIER_A_TOOLS,
  type ToolSelectionInput,
} from './context-manager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ToolSelectionInput> = {}): ToolSelectionInput {
  return {
    nodeCount: 0,
    entityCount: 0,
    hasStylePlate: false,
    hasSelectedNodes: false,
    userMessage: '',
    intentKind: 'execution',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('selectContextualToolSet', () => {
  it('always includes every TIER_A tool', () => {
    const result = selectContextualToolSet(makeInput());
    for (const name of TIER_A_TOOLS) {
      expect(result.has(name), `expected ${name} to be present`).toBe(true);
    }
  });

  it('ALWAYS_LOADED_TOOLS alias equals TIER_A_TOOLS', () => {
    expect(ALWAYS_LOADED_TOOLS).toBe(TIER_A_TOOLS);
  });

  it('returns exactly TIER_A_TOOLS count', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.size).toBe(TIER_A_TOOLS.length);
  });

  it('includes canvas read tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.getInfo')).toBe(true);
    expect(result.has('canvas.listNodes')).toBe(true);
    expect(result.has('canvas.getNode')).toBe(true);
    expect(result.has('canvas.listEdges')).toBe(true);
  });

  it('includes canvas write tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.createNodes')).toBe(true);
    expect(result.has('canvas.updateNodes')).toBe(true);
    expect(result.has('canvas.deleteNode')).toBe(true);
    expect(result.has('canvas.connectNodes')).toBe(true);
    expect(result.has('canvas.manage')).toBe(true);
    expect(result.has('canvas.setNodeRefs')).toBe(true);
    expect(result.has('canvas.configureNode')).toBe(true);
  });

  it('includes canvas generation tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('canvas.generation')).toBe(true);
    expect(result.has('canvas.setMediaParams')).toBe(true);
    expect(result.has('canvas.previewPrompt')).toBe(true);
    expect(result.has('canvas.presetTracks')).toBe(true);
  });

  it('includes entity tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('entity.list')).toBe(true);
    expect(result.has('entity.create')).toBe(true);
    expect(result.has('entity.update')).toBe(true);
    expect(result.has('entity.delete')).toBe(true);
    expect(result.has('entity.generateRefImage')).toBe(true);
  });

  it('includes meta tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('tool.get')).toBe(true);
    expect(result.has('commander.askUser')).toBe(true);
    expect(result.has('guide.get')).toBe(true);
  });

  it('includes domain manage tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('preset.manage')).toBe(true);
    expect(result.has('provider.manage')).toBe(true);
    expect(result.has('workflow.manage')).toBe(true);
    expect(result.has('workflow.visual')).toBe(true);
  });

  it('returns the same set regardless of input', () => {
    const empty = selectContextualToolSet(makeInput());
    const info = selectContextualToolSet(makeInput({ intentKind: 'informational' }));
    const full = selectContextualToolSet(
      makeInput({
        nodeCount: 100,
        entityCount: 50,
        hasStylePlate: true,
        hasSelectedNodes: true,
        userMessage: 'generate images for all nodes',
      }),
    );
    expect([...empty].sort()).toEqual([...info].sort());
    expect([...empty].sort()).toEqual([...full].sort());
  });

  it('does NOT include discoverable-only tools', () => {
    const result = selectContextualToolSet(makeInput());
    expect(result.has('render.start')).toBe(false);
    expect(result.has('render.cancel')).toBe(false);
    expect(result.has('series.get')).toBe(false);
    expect(result.has('job.list')).toBe(false);
    expect(result.has('asset.import')).toBe(false);
    expect(result.has('canvas.importWorkflow')).toBe(false);
    expect(result.has('canvas.undo')).toBe(false);
    expect(result.has('canvas.redo')).toBe(false);
    expect(result.has('logger.list')).toBe(false);
    expect(result.has('provider.setKey')).toBe(false);
    // Downgraded from Tier A to discoverable:
    expect(result.has('canvas.duplicateNodes')).toBe(false);
    expect(result.has('canvas.setVideoFrames')).toBe(false);
    expect(result.has('entity.deleteRefImage')).toBe(false);
    expect(result.has('tool.compact')).toBe(false);
    expect(result.has('todo.manage')).toBe(false);
    expect(result.has('canvas.manageEdge')).toBe(false);
    expect(result.has('canvas.layout')).toBe(false);
    expect(result.has('canvas.setSettings')).toBe(false);
    expect(result.has('canvas.selectVariant')).toBe(false);
    expect(result.has('entity.setRefImage')).toBe(false);
    expect(result.has('entity.setRefImageFromNode')).toBe(false);
    expect(result.has('shotTemplate.manage')).toBe(false);
    expect(result.has('script.manage')).toBe(false);
    expect(result.has('text.analyze')).toBe(false);
    expect(result.has('snapshot.create')).toBe(false);
    expect(result.has('snapshot.list')).toBe(false);
    expect(result.has('snapshot.restore')).toBe(false);
    expect(result.has('prompt.get')).toBe(false);
    expect(result.has('prompt.setCustom')).toBe(false);
  });
});

import { ContextManager } from './context-manager.js';
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

describe('compactWithLLM post-compact reload', () => {
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

    const didCompact = await cm.compactWithLLM(messages, 40_000, 1);

    expect(didCompact).toBe(true);
    expect(llm.complete).not.toHaveBeenCalled();
    expect(messages.some((message) => message.content.includes('[Compacted block]'))).toBe(true);
  });

  it('reports no compaction when the LLM fails and rule-based pruning changed nothing', async () => {
    const llm = makeMockLlm();
    vi.mocked(llm.complete).mockRejectedValueOnce(new Error('summary provider unavailable'));
    const cm = new ContextManager(llm, () => 'system prompt');
    const messages = makeMessagesForCompaction();
    const before = messages.map((message) => message.content);

    const didCompact = await cm.compactWithLLM(messages, 20_000, 1);

    expect(didCompact).toBe(false);
    expect(messages.map((message) => message.content)).toEqual(before);
  });

  it('does not auto-compact twice within two turns or thirty seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00Z'));
    try {
      const llm = makeMockLlm();
      const cm = new ContextManager(llm, () => 'system prompt');
      const first = makeMessagesForCompaction();
      const second = makeMessagesForCompaction();

      expect(await cm.compactWithLLM(first, 20_000, 3)).toBe(true);
      vi.setSystemTime(new Date('2026-08-01T00:00:31Z'));
      expect(await cm.compactWithLLM(second, 20_000, 4)).toBe(false);
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

    const didCompact = await cm.compactWithLLM(messages, charBudget);

    expect(didCompact).toBe(true);
    expect(onPostCompact).toHaveBeenCalledOnce();
    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).toContain('WORKSPACE CONTEXT RELOAD');
    expect(compactedMsg!.content).toContain('Canvas: "test" (5 nodes)');
  });

  it('skips reload gracefully when onPostCompact is not provided', async () => {
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt');
    const messages = makeMessagesForCompaction();

    await cm.compactWithLLM(messages, 20000);

    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('skips reload when onPostCompact returns empty string', async () => {
    const onPostCompact = vi.fn().mockReturnValue('');
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();

    await cm.compactWithLLM(messages, 20000);

    expect(onPostCompact).toHaveBeenCalledOnce();
    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('skips reload when onPostCompact returns null', async () => {
    const onPostCompact = vi.fn().mockReturnValue(null);
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();

    await cm.compactWithLLM(messages, 20000);

    expect(onPostCompact).toHaveBeenCalledOnce();
    const compactedMsg = messages.find((m) => m.content.includes('Context compacted'));
    expect(compactedMsg).toBeDefined();
    expect(compactedMsg!.content).not.toContain('WORKSPACE CONTEXT RELOAD');
  });

  it('still commits the summary when the reload callback throws', async () => {
    const onPostCompact = vi.fn(() => {
      throw new Error('workspace unavailable');
    });
    const cm = new ContextManager(makeMockLlm(), () => 'system prompt', { onPostCompact });
    const messages = makeMessagesForCompaction();

    const didCompact = await cm.compactWithLLM(messages, 20_000, 1);

    expect(didCompact).toBe(true);
    expect(messages.some((message) => message.content.includes('Context compacted'))).toBe(true);
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

    await cm.compactNow(messages);

    expect(onPostCompact).toHaveBeenCalled();
    const reloadMsg = messages.find((m) => m.content.includes('Fresh state'));
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

    await cm.compactNow(messages);

    const reloadMsg = messages.find((m) => m.content.includes('WORKSPACE CONTEXT RELOAD'));
    expect(reloadMsg).toBeUndefined();
  });
});
