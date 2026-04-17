import { describe, expect, it } from 'vitest';
import { computeContextUsage } from './context-usage.js';
import type {
  CommanderBackendContextUsage,
  CommanderMessage,
  CommanderToolCall,
} from './types.js';

const userMsg = (content: string): CommanderMessage => ({
  id: 'u',
  role: 'user',
  content,
  timestamp: 0,
});
const asstMsg = (content: string, toolCalls?: CommanderToolCall[]): CommanderMessage => ({
  id: 'a',
  role: 'assistant',
  content,
  toolCalls,
  timestamp: 0,
});
const tool = (args: Record<string, unknown>, result?: unknown): CommanderToolCall => ({
  name: 't',
  id: 't',
  arguments: args,
  startedAt: 0,
  status: 'done',
  result,
});

describe('computeContextUsage', () => {
  it('tallies user + assistant chars into breakdown buckets', () => {
    const usage = computeContextUsage({
      messages: [userMsg('hello'), asstMsg('world, a longer response')],
      currentStreamContent: '',
      currentToolCalls: [],
      maxTokens: 1000,
      backendContextUsage: null,
    });
    expect(usage.breakdown.user).toBeGreaterThan(0);
    expect(usage.breakdown.assistant).toBeGreaterThan(usage.breakdown.user);
    expect(usage.counts).toEqual({ user: 1, assistant: 1, toolCalls: 0 });
  });

  it('counts tool calls and results in separate buckets', () => {
    const usage = computeContextUsage({
      messages: [asstMsg('', [tool({ id: 'n1' }, { ok: true, data: [1, 2, 3] })])],
      currentStreamContent: '',
      currentToolCalls: [],
      maxTokens: 1000,
      backendContextUsage: null,
    });
    expect(usage.breakdown.toolCalls).toBeGreaterThan(0);
    expect(usage.breakdown.toolResults).toBeGreaterThan(0);
    expect(usage.counts.toolCalls).toBe(1);
  });

  it('includes in-flight stream content + tool calls in the tally', () => {
    const usage = computeContextUsage({
      messages: [],
      currentStreamContent: 'streaming chunk',
      currentToolCalls: [tool({ query: 'x' })],
      maxTokens: 1000,
      backendContextUsage: null,
    });
    expect(usage.breakdown.assistant).toBeGreaterThan(0);
    expect(usage.counts.toolCalls).toBe(1);
  });

  it('uses the backend context payload as the authoritative token count', () => {
    const backend: CommanderBackendContextUsage = {
      estimatedTokensUsed: 5000,
      contextWindowTokens: 10000,
      messageCount: 3,
      systemPromptChars: 100,
      toolSchemaChars: 200,
      messageChars: 50,
      cacheChars: 20,
      cacheEntryCount: 2,
      historyMessagesTrimmed: 1,
      utilizationRatio: 0.5,
    };
    const usage = computeContextUsage({
      messages: [],
      currentStreamContent: '',
      currentToolCalls: [],
      maxTokens: 1000,
      backendContextUsage: backend,
    });
    expect(usage.estimatedTokens).toBe(5000);
    expect(usage.ctxWindow).toBe(10000);
    expect(usage.pct).toBe(50);
    expect(usage.cache).toEqual({ chars: 20, entries: 2 });
    expect(usage.historyTrimmed).toBe(1);
  });

  it('clamps pct to 100', () => {
    const usage = computeContextUsage({
      messages: [],
      currentStreamContent: '',
      currentToolCalls: [],
      maxTokens: 10,
      backendContextUsage: {
        estimatedTokensUsed: 1000,
        contextWindowTokens: 10,
        messageCount: 0,
        systemPromptChars: 0,
        toolSchemaChars: 0,
        messageChars: 0,
        cacheChars: 0,
        cacheEntryCount: 0,
        historyMessagesTrimmed: 0,
        utilizationRatio: 0,
      },
    });
    expect(usage.pct).toBe(100);
  });

  it('guards divide-by-zero when maxTokens is 0 and no backend payload is present', () => {
    const usage = computeContextUsage({
      messages: [userMsg('hi')],
      currentStreamContent: '',
      currentToolCalls: [],
      maxTokens: 0,
      backendContextUsage: null,
    });
    expect(usage.pct).toBe(0);
    expect(Number.isFinite(usage.estimatedTokens)).toBe(true);
  });
});
