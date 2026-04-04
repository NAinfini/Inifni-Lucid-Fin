import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout } from '../src/fetch-utils.js';

describe('fetchWithTimeout', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls fetch with the provided URL and options', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse);

    const res = await fetchWithTimeout('https://example.com', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
  });

  it('does not pass timeoutMs to underlying fetch', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('ok'));

    await fetchWithTimeout('https://example.com', { timeoutMs: 5000 });
    const callArgs = vi.mocked(globalThis.fetch).mock.calls[0][1] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty('timeoutMs');
  });

  it('aborts on timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation((_input, init) => {
      return new Promise((_resolve, reject) => {
        (init?.signal as AbortSignal)?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const promise = fetchWithTimeout('https://example.com', { timeoutMs: 100 });
    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toThrow('Aborted');
    vi.useRealTimers();
  });
});
