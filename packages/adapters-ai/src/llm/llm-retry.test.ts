import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { withRetry } from './llm-retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns value on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to maxRetries times on generic errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
    // Prevent unhandled rejection warning while timers flush
    promise.catch(() => {});

    // Total delay = 100 + 200 + 400 = 700ms across 3 retries
    await vi.advanceTimersByTimeAsync(700);

    await expect(promise).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('stops retrying when LucidError has retryable: false', async () => {
    const error = new LucidError(ErrorCode.AuthFailed, 'not retryable', { retryable: false });
    const fn = vi.fn(async () => {
      throw error;
    });

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });

    await expect(promise).rejects.toBe(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses retryAfter from LucidError details (seconds converted to ms)', async () => {
    const error = new LucidError(ErrorCode.RateLimited, 'rate limited', { retryAfter: 5 });
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw error;
      return 'done';
    });

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });

    // First failure -> wait 5000ms (retryAfter = 5 seconds)
    // Second failure -> wait 5000ms again
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff capped at maxDelay', async () => {
    const fn = vi.fn(async () => {
      throw new Error('fail');
    });

    const promise = withRetry(fn, { maxRetries: 4, baseDelayMs: 1000, maxDelayMs: 5000 });
    promise.catch(() => {});

    // attempt 0 -> delay = min(1000 * 2^0, 5000) = 1000
    // attempt 1 -> delay = min(1000 * 2^1, 5000) = 2000
    // attempt 2 -> delay = min(1000 * 2^2, 5000) = 4000
    // attempt 3 -> delay = min(1000 * 2^3, 5000) = 5000 (capped at maxDelay)
    // Total = 1000 + 2000 + 4000 + 5000 = 12000
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(promise).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(5); // initial + 4 retries
  });

  it('stops when AbortSignal is aborted', async () => {
    const controller = new AbortController();
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('fail');
      return 'ok';
    });

    const promise = withRetry(fn, { maxRetries: 5, baseDelayMs: 100, signal: controller.signal });
    promise.catch(() => {});

    // Let the first call fail and enter sleep
    await vi.advanceTimersByTimeAsync(0);

    // Abort during the sleep
    controller.abort(new Error('aborted'));

    // Advance past the sleep duration to let it settle
    await vi.advanceTimersByTimeAsync(100);

    await expect(promise).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error after exhausting retries', async () => {
    const errors = [new Error('err1'), new Error('err2'), new Error('last')];
    let callIdx = 0;
    const fn = vi.fn(async () => {
      throw errors[Math.min(callIdx++, errors.length - 1)];
    });

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 50 });
    promise.catch(() => {});

    // attempt 0 -> delay 50, attempt 1 -> delay 100, total 150ms
    await vi.advanceTimersByTimeAsync(150);

    await expect(promise).rejects.toThrow('last');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
