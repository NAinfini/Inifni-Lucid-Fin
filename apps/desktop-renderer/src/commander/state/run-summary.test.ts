import { describe, expect, it } from 'vitest';
import { buildRunSummary } from './run-summary.js';
import type { CommanderToolCall, MessageSegment } from './types.js';

function tc(status: CommanderToolCall['status']): CommanderToolCall {
  return { name: 'x', id: 'id', arguments: {}, startedAt: 0, status };
}

describe('buildRunSummary', () => {
  it('excerpts short text verbatim', () => {
    const s = buildRunSummary('completed', 'hello world', undefined, [], 0, 50);
    expect(s.excerpt).toBe('hello world');
    expect(s.toolCount).toBe(0);
    expect(s.durationMs).toBe(50);
  });

  it('collapses whitespace in excerpts', () => {
    const s = buildRunSummary('completed', 'hello\n\nworld   ok', undefined, [], 0, 10);
    expect(s.excerpt).toBe('hello world ok');
  });

  it('truncates long excerpts to 320 chars with an ellipsis char', () => {
    const longText = 'a'.repeat(400);
    const s = buildRunSummary('completed', longText, undefined, [], 0, 0);
    expect(s.excerpt).toHaveLength(320);
    expect(s.excerpt.endsWith('…')).toBe(true);
  });

  it('falls back to tool-call count when content is empty', () => {
    const s = buildRunSummary('completed', '', undefined, [tc('done'), tc('done')], 0, 0);
    expect(s.excerpt).toBe('Completed 2 tool calls.');
    expect(s.toolCount).toBe(2);
    expect(s.failedToolCount).toBe(0);
  });

  it('counts failed tool calls and adjusts the fallback excerpt on failure', () => {
    const s = buildRunSummary('failed', '', undefined, [tc('error')], 0, 0);
    expect(s.excerpt).toBe('Attempted 1 tool call.');
    expect(s.failedToolCount).toBe(1);
  });

  it('falls back to the error message when content and tools are empty', () => {
    const s = buildRunSummary('failed', '', undefined, [], 0, 0, 'network down');
    expect(s.excerpt).toBe('network down');
  });

  it('falls back to a generic message when everything is empty', () => {
    const completed = buildRunSummary('completed', '', undefined, [], 0, 0);
    const failed = buildRunSummary('failed', '', undefined, [], 0, 0);
    expect(completed.excerpt).toBe('Run completed.');
    expect(failed.excerpt).toBe('Run failed before producing output.');
  });

  it('never produces a negative duration', () => {
    // completedAt before startedAt (clock skew) should clamp to zero
    const s = buildRunSummary('completed', '', undefined, [], 100, 50);
    expect(s.durationMs).toBe(0);
  });

  it('prefers the last text segment as the excerpt, not the first', () => {
    // Simulates a run that first says "Let me check…", then runs tools, then
    // delivers the real answer. The collapsed card should show the answer.
    const segments: MessageSegment[] = [
      { type: 'text', content: 'Let me look into that for you.' },
      { type: 'tool', toolCall: tc('done') },
      { type: 'text', content: 'The answer is 42.' },
    ];
    const s = buildRunSummary(
      'completed',
      'Let me look into that for you. The answer is 42.',
      segments,
      [tc('done')],
      0,
      0,
    );
    expect(s.excerpt).toBe('The answer is 42.');
  });

  it('falls back to content when the final segment is a tool call', () => {
    const segments: MessageSegment[] = [
      { type: 'text', content: 'Starting work.' },
      { type: 'tool', toolCall: tc('done') },
    ];
    const s = buildRunSummary('completed', 'Starting work.', segments, [tc('done')], 0, 0);
    // Most recent text segment wins even if a tool segment follows it.
    expect(s.excerpt).toBe('Starting work.');
  });
});
