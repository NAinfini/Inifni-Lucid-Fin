import { ErrorCode, LucidError } from '@lucid-fin/contracts';

/**
 * Wraps an `AsyncIterable<T>` with a watchdog: if the source produces no
 * event within `stallMs`, the wrapper throws a SERVICE_UNAVAILABLE
 * `LucidError` and calls `iterator.return?.()` so the underlying fetch
 * is drained and cancelled.
 *
 * Why this lives here and not in the orchestrator: a slow or dead SSE
 * socket looks like a hang in `iterator.next()` — the application layer
 * has no visibility into whether the socket is producing bytes. The
 * adapter owns the byte-level stream, so the watchdog has to sit there.
 *
 * Honors a caller-supplied `AbortSignal` by short-circuiting as soon as
 * it fires; the signal's abort reason is wrapped into a LucidError so
 * callers don't have to branch on `err.name === 'AbortError'`.
 *
 * Usage (inside an adapter's streaming body):
 *
 *   yield* withStallTimeout(rawSseIterator, { stallMs: 20_000, signal });
 */
export interface StallTimeoutOptions {
  /** ms with no events before we give up. Defaults to 20s. */
  stallMs?: number;
  /** External abort signal. Abort ends the iterator immediately. */
  signal?: AbortSignal;
  /** Human-readable adapter name included in the error message. */
  adapterName?: string;
}

export async function* withStallTimeout<T>(
  source: AsyncIterable<T>,
  opts: StallTimeoutOptions = {},
): AsyncIterable<T> {
  const stallMs = opts.stallMs ?? 20_000;
  const signal = opts.signal;
  const adapterName = opts.adapterName ?? 'LLM';

  if (signal?.aborted) {
    throw new LucidError(ErrorCode.Cancelled, `${adapterName} request aborted before start`, {
      reason: signal.reason,
    });
  }

  const iterator = source[Symbol.asyncIterator]();
  let abortListener: (() => void) | undefined;
  try {
    while (true) {
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      const nextPromise = iterator.next();

      const stallPromise = new Promise<never>((_resolve, reject) => {
        stallTimer = setTimeout(
          () =>
            reject(
              new LucidError(
                ErrorCode.ServiceUnavailable,
                `${adapterName} stream stalled: no byte for ${Math.floor(stallMs / 1000)}s`,
                { timeoutMs: stallMs, adapterName },
              ),
            ),
          stallMs,
        );
      });

      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (!signal) return;
        if (signal.aborted) {
          reject(
            new LucidError(ErrorCode.Cancelled, `${adapterName} request aborted`, {
              reason: signal.reason,
            }),
          );
          return;
        }
        abortListener = () =>
          reject(
            new LucidError(ErrorCode.Cancelled, `${adapterName} request aborted`, {
              reason: signal.reason,
            }),
          );
        signal.addEventListener('abort', abortListener, { once: true });
      });

      let result: IteratorResult<T>;
      try {
        result = await Promise.race([nextPromise, stallPromise, abortPromise]);
      } finally {
        if (stallTimer !== null) clearTimeout(stallTimer);
        if (signal && abortListener) {
          signal.removeEventListener('abort', abortListener);
          abortListener = undefined;
        }
      }

      if (result.done) return;
      yield result.value;
    }
  } finally {
    // Best-effort cleanup: if we bailed out (stall, abort, downstream
    // threw) tell the source it can release the underlying socket.
    // We DON'T await — some producers (pathologically-hung sources, dead
    // sockets that never resolve) would deadlock a synchronous return().
    // Fire-and-forget with a `.catch()` means the caller's `throw`
    // escapes immediately while the generator drops out of scope.
    iterator.return?.()?.catch(() => {
      /* swallow — cleanup only */
    });
  }
}
