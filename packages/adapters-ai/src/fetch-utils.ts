const DEFAULT_TIMEOUT_MS = 120_000;

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
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutSignal])
    : timeoutSignal;

  return fetch(input, { ...rest, signal });
}
