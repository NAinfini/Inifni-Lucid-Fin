/**
 * Generic exponential-backoff retry utility for LLM adapter calls.
 *
 * Respects `retryable` and `retryAfter` metadata from LucidError details.
 * Standalone utility -- not yet wired into adapter code.
 */
import { LucidError } from '@lucid-fin/contracts';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000). */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000). */
  maxDelayMs?: number;
  /** Optional AbortSignal to cancel retries early. */
  signal?: AbortSignal;
}

/**
 * Execute `fn` with automatic retries on failure.
 *
 * - If the error is a `LucidError` with `retryable: false`, retries stop immediately.
 * - If the error has a `retryAfter` value (seconds), that delay is used instead of backoff.
 * - Exponential backoff: `baseDelay * 2^attempt`, capped at `maxDelay`.
 * - If `signal` is aborted, retries stop and the abort reason is thrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 1000;
  const maxDelay = options?.maxDelayMs ?? 30000;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      if (options?.signal?.aborted) break;

      // Only retry if the error is retryable
      if (error instanceof LucidError) {
        const details = error.details as Record<string, unknown> | undefined;
        if (details?.retryable === false) break;

        // Use retryAfter if provided (value is in seconds, convert to ms)
        const retryAfter = typeof details?.retryAfter === 'number'
          ? details.retryAfter * 1000
          : undefined;
        const delay = retryAfter ?? Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await sleep(delay, options?.signal);
      } else {
        // Non-LucidError: retry with backoff
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await sleep(delay, options?.signal);
      }
    }
  }
  throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
