import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { OpenAILLMAdapter } from './openai-llm.js';

describe('OpenAILLMAdapter', () => {
  it('uses OpenAI defaults and validates against the configured v1 base URL', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://proxy.example/v1/models');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer sk-openai',
      });
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new OpenAILLMAdapter();
      adapter.configure('sk-openai', {
        baseUrl: 'https://proxy.example/v1/models',
        model: 'gpt-5.4',
      });

      expect(adapter.id).toBe('openai');
      expect(adapter.name).toBe('OpenAI GPT');
      expect(Reflect.get(adapter, 'baseUrl')).toBe('https://proxy.example/v1');
      expect(Reflect.get(adapter, 'model')).toBe('gpt-5.4');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('surfaces provider metadata when OpenAI rejects a tool-enabled request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'bad openai key',
                code: 'invalid_api_key',
              },
            }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    try {
      const adapter = new OpenAILLMAdapter();
      adapter.configure('sk-openai', {
        baseUrl: 'https://proxy.example/v1',
        model: 'gpt-5.4',
      });

      await expect(
        adapter.completeWithTools([{ role: 'user', content: 'hello' }], {
          tools: [
            {
              name: 'tool.search',
              description: 'Search',
              parameters: { type: 'object', properties: {} },
            },
          ],
        }),
      ).rejects.toMatchObject<Partial<LucidError>>({
        code: ErrorCode.AuthFailed,
        message: 'bad openai key',
        details: expect.objectContaining({
          status: 401,
          endpoint: 'https://proxy.example/v1/chat/completions',
          provider: 'OpenAI GPT',
          providerId: 'openai',
          model: 'gpt-5.4',
          hasTools: true,
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
