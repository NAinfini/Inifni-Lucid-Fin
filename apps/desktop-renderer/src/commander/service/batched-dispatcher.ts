/**
 * `BatchedDispatcher` coalesces bursts of high-frequency delta events
 * (`text_delta`, `thinking_delta`, `tool_call_args_delta`) into a single
 * flush per kind+key, scheduled on the next animation frame (bounded by
 * a ~50ms soft floor).
 *
 * Purpose: a fast LLM can emit 50–100 deltas/second. Dispatching each one
 * through Redux + React causes layout thrash and janky typing cursors.
 * Merging them into one dispatch per frame keeps paint costs bounded
 * while preserving the live-typing UX.
 *
 * Semantics:
 *   - `push(kind, key, delta)` accumulates into a per-`(kind,key)` buffer.
 *   - A flush is scheduled via `rAF` on first push; subsequent pushes
 *     within the same frame piggyback on that flush.
 *   - `flushNow()` drains synchronously — used right before any terminal
 *     event (tool_call_args_complete, done, error) so the UI sees the
 *     complete text before the next state transition.
 *   - `dispose()` cancels the pending frame and drops buffered deltas.
 *
 * The `rAF` fallback chain is `requestAnimationFrame → setTimeout(50)`
 * because tests and non-browser contexts don't have rAF.
 */

export type BatchedDeltaKind = 'text_delta' | 'thinking_delta' | 'tool_call_args_delta';

export interface BatchedDispatcherDeps {
  /**
   * Flush callback — called with every kind+key that had buffered deltas
   * since the last flush. Called synchronously from a rAF/setTimeout
   * callback, so consumers should only do cheap Redux dispatches.
   */
  flush: (kind: BatchedDeltaKind, key: string, joined: string) => void;
  /** Optional telemetry hook — increments once per event pushed (post-dedup). */
  onCoalesced?: (batchSize: number) => void;
  /** Injectable scheduler so tests can run flushes deterministically. */
  scheduler?: {
    request: (cb: () => void) => number;
    cancel: (handle: number) => void;
  };
}

/**
 * The default scheduler prefers `requestAnimationFrame` when present
 * (browser). Falls back to a 50ms `setTimeout` — both in Node (tests,
 * jsdom) and in browser contexts where rAF is paused (background tab).
 *
 * Picking 50ms as the fallback floor matches the PRD: "coalesced in a
 * 50ms window per kind".
 */
function defaultScheduler(): NonNullable<BatchedDispatcherDeps['scheduler']> {
  const rAF =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame === 'function'
      ? (globalThis as unknown as {
          requestAnimationFrame: (cb: FrameRequestCallback) => number;
          cancelAnimationFrame: (handle: number) => void;
        })
      : null;
  if (rAF) {
    return {
      request: (cb) => rAF.requestAnimationFrame(cb),
      cancel: (handle) => rAF.cancelAnimationFrame(handle),
    };
  }
  return {
    request: (cb) => setTimeout(cb, 50) as unknown as number,
    cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
  };
}

interface Buffer {
  /** Concatenated delta string for this (kind, key). */
  joined: string;
  /** Number of raw pushes folded in — reported via `onCoalesced`. */
  count: number;
}

function bufferKey(kind: BatchedDeltaKind, key: string): string {
  return `${kind}\u0000${key}`;
}

export class BatchedDispatcher {
  private readonly buffers = new Map<string, Buffer>();
  private readonly scheduler: NonNullable<BatchedDispatcherDeps['scheduler']>;
  private handle: number | null = null;
  private disposed = false;

  constructor(private readonly deps: BatchedDispatcherDeps) {
    this.scheduler = deps.scheduler ?? defaultScheduler();
  }

  /**
   * Buffer a delta under `(kind, key)`. `key` is the stable identity for
   * this stream — `''` for text/thinking (one stream per run) and the
   * `toolCallId` for `tool_call_args_delta`.
   */
  push(kind: BatchedDeltaKind, key: string, delta: string): void {
    if (this.disposed || delta.length === 0) return;
    const k = bufferKey(kind, key);
    const existing = this.buffers.get(k);
    if (existing) {
      existing.joined += delta;
      existing.count += 1;
    } else {
      this.buffers.set(k, { joined: delta, count: 1 });
    }
    if (this.handle === null) {
      this.handle = this.scheduler.request(() => this.flushNow());
    }
  }

  /**
   * Drain all buffers synchronously. Call before any terminal event
   * (tool_call_args_complete / done / error) so downstream reducers see
   * the complete accumulated text before the state transition.
   */
  flushNow(): void {
    if (this.disposed) return;
    if (this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
    if (this.buffers.size === 0) return;
    const entries = [...this.buffers.entries()];
    this.buffers.clear();
    for (const [compound, buf] of entries) {
      const sep = compound.indexOf('\u0000');
      const kind = compound.slice(0, sep) as BatchedDeltaKind;
      const key = compound.slice(sep + 1);
      this.deps.flush(kind, key, buf.joined);
      this.deps.onCoalesced?.(buf.count);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
    this.buffers.clear();
  }
}
