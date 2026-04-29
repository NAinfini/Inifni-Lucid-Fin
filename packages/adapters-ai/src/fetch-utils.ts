import { withRetry } from './llm/llm-retry.js';

const DEFAULT_TIMEOUT_MS = 120_000;

const RETRYABLE_STATUS_CODES = new Set([429, 503, 502]);

/**
 * Wrapper around fetch that adds an AbortSignal timeout.
 * Accepts the same arguments as global fetch plus an optional timeout in ms.
 *
 * Uses AbortSignal.any() + AbortSignal.timeout() (Node 20+) so no manual
 * listener registration or cleanup is needed — no listener leaks.
 */
export function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const ms = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { timeoutMs: _, signal: callerSignal, ...rest } = init ?? {};

  const timeoutSignal = AbortSignal.timeout(ms);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;

  return fetch(input, { ...rest, signal });
}

/**
 * fetchWithTimeout + automatic retry on transient failures (429, 502, 503,
 * ECONNRESET). Uses exponential backoff capped at 30 seconds.
 */
export function fetchWithRetry(
  input: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number; maxRetries?: number },
): Promise<Response> {
  const { maxRetries, ...fetchInit } = init ?? {};
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(input, fetchInit);
      if (RETRYABLE_STATUS_CODES.has(res.status)) {
        const err: Error & { retryAfter?: number } = new Error(`HTTP ${res.status}`);
        const retryAfter = res.headers.get('retry-after');
        err.retryAfter = retryAfter ? parseInt(retryAfter, 10) || undefined : undefined;
        throw err;
      }
      return res;
    },
    { maxRetries: maxRetries ?? 2, signal: fetchInit?.signal ?? undefined },
  );
}
