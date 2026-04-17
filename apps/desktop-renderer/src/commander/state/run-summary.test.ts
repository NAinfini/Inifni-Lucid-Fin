import { describe, expect, it } from 'vitest';
import { buildRunSummary } from './run-summary.js';
import type { CommanderToolCall } from './types.js';

function tc(status: CommanderToolCall['status']): CommanderToolCall {
  return { name: 'x', id: 'id', arguments: {}, startedAt: 0, status };
}

describe('buildRunSummary', () => {
  it('excerpts short text verbatim', () => {
    const s = buildRunSummary('completed', 'hello world', [], 0, 50);
    expect(s.excerpt).toBe('hello world');
    expect(s.toolCount).toBe(0);
    expect(s.durationMs).toBe(50);
  });

  it('collapses whitespace in excerpts', () => {
    const s = buildRunSummary('completed', 'hello\n\nworld   ok', [], 0, 10);
    expect(s.excerpt).toBe('hello world ok');
  });

  it('truncates long excerpts to 160 chars with ellipsis', () => {
    const longText = 'a'.repeat(200);
    const s = buildRunSummary('completed', longText, [], 0, 0);
    expect(s.excerpt).toHaveLength(160);
    expect(s.excerpt.endsWith('...')).toBe(true);
  });

  it('falls back to tool-call count when content is empty', () => {
    const s = buildRunSummary('completed', '', [tc('done'), tc('done')], 0, 0);
    expect(s.excerpt).toBe('Completed 2 tool calls.');
    expect(s.toolCount).toBe(2);
    expect(s.failedToolCount).toBe(0);
  });

  it('counts failed tool calls and adjusts the fallback excerpt on failure', () => {
    const s = buildRunSummary('failed', '', [tc('error')], 0, 0);
    expect(s.excerpt).toBe('Attempted 1 tool call.');
    expect(s.failedToolCount).toBe(1);
  });

  it('falls back to the error message when content and tools are empty', () => {
    const s = buildRunSummary('failed', '', [], 0, 0, 'network down');
    expect(s.excerpt).toBe('network down');
  });

  it('falls back to a generic message when everything is empty', () => {
    const completed = buildRunSummary('completed', '', [], 0, 0);
    const failed = buildRunSummary('failed', '', [], 0, 0);
    expect(completed.excerpt).toBe('Run completed.');
    expect(failed.excerpt).toBe('Run failed before producing output.');
  });

  it('never produces a negative duration', () => {
    // completedAt before startedAt (clock skew) should clamp to zero
    const s = buildRunSummary('completed', '', [], 100, 50);
    expect(s.durationMs).toBe(0);
  });
});
