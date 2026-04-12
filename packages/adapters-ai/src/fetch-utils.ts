const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Wrapper around fetch that adds an AbortSignal timeout.
 * Accepts the same arguments as global fetch plus an optional timeout in ms.
 */
export function fetchWithTimeout(
  input: string | URL | Request,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const ms = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  // Merge caller's signal if provided
  const existingSignal = init?.signal;
  if (existingSignal) {
    existingSignal.addEventListener('abort', () => controller.abort());
  }

  const { timeoutMs: _, ...rest } = init ?? {};

  return fetch(input, { ...rest, signal: controller.signal }).finally(() => clearTimeout(timer));
}
