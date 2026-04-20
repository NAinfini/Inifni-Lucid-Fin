import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import type { LLMMessage, LLMRequestOptions } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { GrokLLMAdapter } from './grok-llm.js';
import { collectLLMStream } from './test-utils/collect-llm-stream.js';

function complete(adapter: GrokLLMAdapter, messages: LLMMessage[], opts?: LLMRequestOptions) {
  return collectLLMStream(adapter.completeWithTools(messages, opts));
}

describe('GrokLLMAdapter', () => {
  it('uses xAI defaults and preserves original tool names in tool call results', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'grok-3',
        tools: [
          {
            type: 'function',
            function: expect.objectContaining({
              name: 'tool_search',
            }),
          },
        ],
      });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    id: 'call-1',
                    function: {
                      name: 'tool_search',
                      arguments: '{"query":"mars"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new GrokLLMAdapter();
      adapter.configure('sk-grok');

      expect(adapter.id).toBe('grok');
      expect(adapter.name).toBe('Grok');
      expect(Reflect.get(adapter, 'baseUrl')).toBe('https://api.x.ai/v1');

      await expect(
        complete(adapter, [{ role: 'user', content: 'search' }], {
          tools: [
            {
              name: 'tool.search',
              description: 'Search',
              parameters: { type: 'object', properties: {} },
            },
          ],
        }),
      ).resolves.toMatchObject({
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-1',
            name: 'tool.search',
            arguments: { query: 'mars' },
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('throws a structured error when Grok returns HTML instead of JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>gateway</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
      ),
    );

    try {
      const adapter = new GrokLLMAdapter();
      adapter.configure('sk-grok');

      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).rejects.toMatchObject<
        Partial<LucidError>
      >({
        code: ErrorCode.ServiceUnavailable,
        message: 'Grok returned a non-JSON response',
        details: expect.objectContaining({
          endpoint: 'https://api.x.ai/v1/chat/completions',
          provider: 'Grok',
          providerId: 'grok',
          contentType: 'text/html; charset=utf-8',
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
