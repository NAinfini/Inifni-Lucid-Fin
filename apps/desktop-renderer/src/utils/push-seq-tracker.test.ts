import { describe, expect, it, vi } from 'vitest';
import { createPushSeqTracker } from './push-seq-tracker.js';
import type { PushEnvelope } from './push-seq-types.js';

function envelope(channel: string, seq: number, data: unknown = {}): PushEnvelope {
  return { seq, channel, data };
}

describe('PushSeqTracker', () => {
  it('accepts events with sequential seq numbers', () => {
    const tracker = createPushSeqTracker();
    expect(tracker.accept(envelope('ch:a', 1))).toBe(true);
    expect(tracker.accept(envelope('ch:a', 2))).toBe(true);
    expect(tracker.accept(envelope('ch:a', 3))).toBe(true);
  });

  it('rejects duplicate events (seq <= lastProcessed)', () => {
    const onDuplicate = vi.fn();
    const tracker = createPushSeqTracker({ onDuplicate });

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 2));

    // Duplicate
    expect(tracker.accept(envelope('ch:a', 2))).toBe(false);
    expect(onDuplicate).toHaveBeenCalledWith({ channel: 'ch:a', seq: 2 });

    // Old event
    expect(tracker.accept(envelope('ch:a', 1))).toBe(false);
    expect(onDuplicate).toHaveBeenCalledTimes(2);
  });

  it('detects gaps and calls onGap', () => {
    const onGap = vi.fn();
    const tracker = createPushSeqTracker({ onGap });

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 2));
    // Gap: expected 3, got 5
    tracker.accept(envelope('ch:a', 5));

    expect(onGap).toHaveBeenCalledWith({
      channel: 'ch:a',
      expected: 3,
      received: 5,
      gap: 2,
    });
  });

  it('does not fire onGap when events are in order', () => {
    const onGap = vi.fn();
    const tracker = createPushSeqTracker({ onGap });

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 2));
    tracker.accept(envelope('ch:a', 3));

    expect(onGap).not.toHaveBeenCalled();
  });

  it('isolates channels — no cross-channel interference', () => {
    const onGap = vi.fn();
    const tracker = createPushSeqTracker({ onGap });

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:b', 1));
    tracker.accept(envelope('ch:a', 2));
    tracker.accept(envelope('ch:b', 2));

    expect(onGap).not.toHaveBeenCalled();
  });

  it('triggers re-sync strategy on gap detection', () => {
    const resyncFn = vi.fn();
    const tracker = createPushSeqTracker();
    tracker.registerResync('ch:a', resyncFn);

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 5)); // gap

    expect(resyncFn).toHaveBeenCalledOnce();
  });

  it('does not trigger re-sync when no strategy is registered', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tracker = createPushSeqTracker();

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 5)); // gap, no strategy

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no re-sync strategy registered'));
    warnSpy.mockRestore();
  });

  it('prevents re-sync storms (no concurrent re-sync for same channel)', () => {
    let resolveFn!: () => void;
    const resyncFn = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveFn = r;
        }),
    );
    const tracker = createPushSeqTracker();
    tracker.registerResync('ch:a', resyncFn);

    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 5)); // triggers re-sync (async)
    tracker.accept(envelope('ch:a', 10)); // another gap while first re-sync in flight

    // Only called once because first is still in flight
    expect(resyncFn).toHaveBeenCalledOnce();

    // Resolve the first re-sync
    resolveFn();
  });

  it('getLastSeqs returns current state', () => {
    const tracker = createPushSeqTracker();
    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 2));
    tracker.accept(envelope('ch:b', 1));

    expect(tracker.getLastSeqs()).toEqual({
      'ch:a': 2,
      'ch:b': 1,
    });
  });

  it('reset clears all state', () => {
    const tracker = createPushSeqTracker();
    tracker.accept(envelope('ch:a', 1));
    tracker.accept(envelope('ch:a', 2));

    tracker.reset();

    expect(tracker.getLastSeqs()).toEqual({});
    // After reset, seq 1 is accepted again
    expect(tracker.accept(envelope('ch:a', 1))).toBe(true);
  });

  it('still accepts the event even when a gap is detected (for eventual consistency)', () => {
    const tracker = createPushSeqTracker();

    tracker.accept(envelope('ch:a', 1));
    // Gap: seq 2, 3, 4 missing
    const accepted = tracker.accept(envelope('ch:a', 5));

    expect(accepted).toBe(true);
    expect(tracker.getLastSeqs()).toEqual({ 'ch:a': 5 });
  });
});
