import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { QwenLLMAdapter } from './qwen-llm.js';

describe('QwenLLMAdapter', () => {
  it('normalizes configured endpoints and validates with the compatible-mode base URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/models');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer sk-qwen',
      });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new QwenLLMAdapter();
      adapter.configure('sk-qwen', {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen-max',
      });

      expect(adapter.id).toBe('qwen');
      expect(adapter.name).toBe('Qwen');
      expect(Reflect.get(adapter, 'baseUrl')).toBe(
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
      );
      expect(Reflect.get(adapter, 'model')).toBe('qwen-max');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('surfaces invalid request details from Qwen-compatible gateways', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'unsupported tool choice',
                code: 'invalid_request_error',
              },
            }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    try {
      const adapter = new QwenLLMAdapter();
      adapter.configure('sk-qwen');

      await expect(
        adapter.completeWithTools([{ role: 'user', content: 'hello' }], {
          tools: [
            {
              name: 'tool.search',
              description: 'Search',
              parameters: { type: 'object', properties: {} },
            },
          ],
          toolChoice: { name: 'tool.search' },
        }),
      ).rejects.toMatchObject<Partial<LucidError>>({
        code: ErrorCode.InvalidRequest,
        message: 'unsupported tool choice',
        details: expect.objectContaining({
          status: 400,
          endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
          provider: 'Qwen',
          providerId: 'qwen',
          hasTools: true,
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
