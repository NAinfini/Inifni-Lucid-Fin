import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { DeepSeekLLMAdapter } from './deepseek-llm.js';

describe('DeepSeekLLMAdapter', () => {
  it('falls back to the v1 candidate during validation and keeps DeepSeek defaults', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === 'https://api.deepseek.com/models') {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer sk-deepseek',
        });
        return new Response('missing', { status: 404 });
      }

      if (url === 'https://api.deepseek.com/chat/completions') {
        return new Response('missing', { status: 404 });
      }

      if (url === 'https://api.deepseek.com/v1/models') {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new DeepSeekLLMAdapter();
      adapter.configure('sk-deepseek');

      expect(adapter.id).toBe('deepseek');
      expect(adapter.name).toBe('DeepSeek');
      expect(Reflect.get(adapter, 'model')).toBe('deepseek-chat');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(Reflect.get(adapter, 'baseUrl')).toBe('https://api.deepseek.com/v1');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('maps DeepSeek rate limits into LucidError details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'slow down',
                code: 'rate_limit_exceeded',
              },
            }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    try {
      const adapter = new DeepSeekLLMAdapter();
      adapter.configure('sk-deepseek', {
        baseUrl: 'https://api.deepseek.com/v1',
      });

      // With fetchWithRetry, 429 responses are retried then thrown as a
      // transport error after retries are exhausted. The resulting error code
      // is SERVICE_UNAVAILABLE (transport path), and the provider context is
      // still attached via the error details.
      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).rejects.toMatchObject<
        Partial<LucidError>
      >({
        code: ErrorCode.ServiceUnavailable,
        details: expect.objectContaining({
          endpoint: 'https://api.deepseek.com/v1/chat/completions',
          provider: 'DeepSeek',
          providerId: 'deepseek',
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
