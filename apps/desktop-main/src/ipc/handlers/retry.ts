/**
 * Retry-with-exponential-backoff for transient provider errors.
 *
 * Retries only on HTTP 429 (rate limited) and 503 (service unavailable).
 * All other errors are re-thrown immediately.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1_000,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if ((status === 429 || status === 503) && attempt < maxAttempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      throw err;
    }
  }
  // Unreachable — TypeScript requires an explicit throw after the loop
  throw new Error('withRetry: unreachable');
}
