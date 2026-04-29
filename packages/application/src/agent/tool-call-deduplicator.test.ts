/**
 * Phase G — deduplicator unit tests.
 *
 * Covers argsHash determinism, per-run record lifecycle, and the
 * windowSteps eviction rule.
 */

import { describe, expect, it } from 'vitest';
import { ToolCallDeduplicator, argsHash } from './tool-call-deduplicator.js';

const ref = { domain: 'canvas', action: 'list' };

describe('argsHash', () => {
  it('is stable across key-order permutations', () => {
    expect(argsHash({ a: 1, b: 2 })).toBe(argsHash({ b: 2, a: 1 }));
  });

  it('treats undefined values as absent (mirrors LLM adapter behavior)', () => {
    expect(argsHash({ a: 1, b: undefined } as Record<string, unknown>)).toBe(argsHash({ a: 1 }));
  });

  it('differs when values change', () => {
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });

  it('handles nested objects deterministically', () => {
    expect(argsHash({ a: { x: 1, y: 2 } })).toBe(argsHash({ a: { y: 2, x: 1 } }));
  });
});

describe('ToolCallDeduplicator', () => {
  it('returns null for a key never registered', () => {
    const d = new ToolCallDeduplicator();
    expect(d.check(ref, {}, 1)).toBeNull();
  });

  it('returns the prior record for an identical call within the window', () => {
    const d = new ToolCallDeduplicator(3);
    d.register(ref, { id: 'x' }, { toolCallId: 'tc-1', step: 2, wasError: false });
    const prior = d.check(ref, { id: 'x' }, 4);
    expect(prior).toEqual({ toolCallId: 'tc-1', step: 2, wasError: false });
  });

  it('evicts records older than windowSteps', () => {
    const d = new ToolCallDeduplicator(3);
    d.register(ref, { id: 'x' }, { toolCallId: 'tc-1', step: 2, wasError: false });
    expect(d.check(ref, { id: 'x' }, 10)).toBeNull();
    // Eviction removes it on the miss — size drops.
    expect(d.size()).toBe(0);
  });

  it('distinguishes calls that differ only in toolRef', () => {
    const d = new ToolCallDeduplicator();
    d.register(ref, { id: 'x' }, { toolCallId: 'tc-1', step: 1, wasError: false });
    expect(d.check({ domain: 'canvas', action: 'get' }, { id: 'x' }, 2)).toBeNull();
  });

  it('reset clears all records', () => {
    const d = new ToolCallDeduplicator();
    d.register(ref, {}, { toolCallId: 'tc-1', step: 1, wasError: false });
    d.reset();
    expect(d.size()).toBe(0);
    expect(d.check(ref, {}, 2)).toBeNull();
  });

  it('preserves wasError flag across hits', () => {
    const d = new ToolCallDeduplicator();
    d.register(ref, {}, { toolCallId: 'tc-1', step: 1, wasError: true });
    const prior = d.check(ref, {}, 2);
    expect(prior?.wasError).toBe(true);
  });
});
