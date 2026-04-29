import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchedDispatcher, type BatchedDeltaKind } from './batched-dispatcher.js';

/**
 * Injectable manual scheduler so tests can run rAF callbacks on demand.
 * Preserves insertion order across multiple pending requests, even though
 * the dispatcher itself only ever has one pending at a time.
 */
function manualScheduler() {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    request: (cb: () => void): number => {
      const id = next++;
      queue.set(id, cb);
      return id;
    },
    cancel: (handle: number): void => {
      queue.delete(handle);
    },
    runAll: (): void => {
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb();
    },
    pending: (): number => queue.size,
  };
}

describe('BatchedDispatcher', () => {
  let flushes: Array<{ kind: BatchedDeltaKind; key: string; joined: string }>;
  let coalescedBatchSizes: number[];

  beforeEach(() => {
    flushes = [];
    coalescedBatchSizes = [];
  });

  it('coalesces 50 same-kind deltas into one flush per frame', () => {
    const sched = manualScheduler();
    const d = new BatchedDispatcher({
      flush: (kind, key, joined) => flushes.push({ kind, key, joined }),
      onCoalesced: (n) => coalescedBatchSizes.push(n),
      scheduler: sched,
    });
    for (let i = 0; i < 50; i++) d.push('text_delta', '', 'a');
    expect(sched.pending()).toBe(1);
    expect(flushes).toHaveLength(0);

    sched.runAll();
    expect(flushes).toEqual([{ kind: 'text_delta', key: '', joined: 'a'.repeat(50) }]);
    expect(coalescedBatchSizes).toEqual([50]);
  });

  it('keeps different (kind, key) pairs in separate buffers', () => {
    const sched = manualScheduler();
    const d = new BatchedDispatcher({
      flush: (kind, key, joined) => flushes.push({ kind, key, joined }),
      scheduler: sched,
    });
    d.push('text_delta', '', 'Hello');
    d.push('thinking_delta', '', ' thinking');
    d.push('tool_call_args_delta', 'tc1', '{"a');
    d.push('tool_call_args_delta', 'tc1', '":1}');
    d.push('tool_call_args_delta', 'tc2', '{}');

    sched.runAll();
    expect(flushes).toContainEqual({ kind: 'text_delta', key: '', joined: 'Hello' });
    expect(flushes).toContainEqual({ kind: 'thinking_delta', key: '', joined: ' thinking' });
    expect(flushes).toContainEqual({ kind: 'tool_call_args_delta', key: 'tc1', joined: '{"a":1}' });
    expect(flushes).toContainEqual({ kind: 'tool_call_args_delta', key: 'tc2', joined: '{}' });
    expect(flushes).toHaveLength(4);
  });

  it('flushNow drains immediately and cancels the pending frame', () => {
    const sched = manualScheduler();
    const d = new BatchedDispatcher({
      flush: (kind, key, joined) => flushes.push({ kind, key, joined }),
      scheduler: sched,
    });
    d.push('text_delta', '', 'partial');
    expect(sched.pending()).toBe(1);
    d.flushNow();
    expect(flushes).toEqual([{ kind: 'text_delta', key: '', joined: 'partial' }]);
    expect(sched.pending()).toBe(0);

    // A second runAll must be a no-op — the scheduled callback was cancelled.
    sched.runAll();
    expect(flushes).toHaveLength(1);
  });

  it('dispose drops buffered deltas and ignores further pushes', () => {
    const sched = manualScheduler();
    const d = new BatchedDispatcher({
      flush: (kind, key, joined) => flushes.push({ kind, key, joined }),
      scheduler: sched,
    });
    d.push('text_delta', '', 'dropped');
    d.dispose();
    expect(sched.pending()).toBe(0);

    d.push('text_delta', '', 'also dropped');
    sched.runAll();
    expect(flushes).toHaveLength(0);
  });

  it('ignores empty deltas without scheduling a frame', () => {
    const sched = manualScheduler();
    const d = new BatchedDispatcher({
      flush: (kind, key, joined) => flushes.push({ kind, key, joined }),
      scheduler: sched,
    });
    d.push('text_delta', '', '');
    expect(sched.pending()).toBe(0);
    d.flushNow();
    expect(flushes).toHaveLength(0);
  });

  it('default scheduler falls back to setTimeout when rAF is absent', () => {
    vi.useFakeTimers();
    const origRAF = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame;
    try {
      const d = new BatchedDispatcher({
        flush: (kind, key, joined) => flushes.push({ kind, key, joined }),
      });
      d.push('text_delta', '', 'hello');
      expect(flushes).toHaveLength(0);
      vi.advanceTimersByTime(60);
      expect(flushes).toEqual([{ kind: 'text_delta', key: '', joined: 'hello' }]);
    } finally {
      if (origRAF)
        (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = origRAF;
      vi.useRealTimers();
    }
  });
});
