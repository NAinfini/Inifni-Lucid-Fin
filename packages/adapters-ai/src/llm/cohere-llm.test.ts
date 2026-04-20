import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import type { LLMMessage, LLMRequestOptions } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { CohereLLMAdapter } from './cohere-llm.js';
import { collectLLMStream } from './test-utils/collect-llm-stream.js';

function complete(adapter: CohereLLMAdapter, messages: LLMMessage[], opts?: LLMRequestOptions) {
  return collectLLMStream(adapter.completeWithTools(messages, opts));
}

describe('CohereLLMAdapter', () => {
  it('uses Cohere defaults and validates with bearer auth', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://cohere.example/v2/chat');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer sk-cohere',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({
        model: 'command-r-plus',
        max_tokens: 1,
      });

      return new Response(JSON.stringify({ id: 'chat_1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new CohereLLMAdapter();
      adapter.configure('sk-cohere', {
        baseUrl: 'https://cohere.example/v2',
        model: 'command-r-plus',
      });

      expect(adapter.id).toBe('cohere');
      expect(adapter.name).toBe('Cohere');
      expect(Reflect.get(adapter, 'model')).toBe('command-r-plus');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('builds Cohere tool bodies and parses stringified tool arguments', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'command-r-plus',
        temperature: 0.1,
        max_tokens: 256,
        p: 0.8,
        stop_sequences: ['halt'],
        tools: [
          {
            type: 'function',
            function: {
              name: 'lookup',
              description: 'Lookup data',
            },
          },
        ],
      });
      expect(body.messages).toEqual([
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: 'working',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'lookup',
                arguments: '{"query":"moon"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call-1',
          content: '{"answer":"moon"}',
        },
      ]);

      return new Response(
        JSON.stringify({
          message: {
            content: [{ text: 'summary' }],
            tool_calls: [
              {
                id: 'cohere-call-1',
                function: {
                  name: 'lookup',
                  arguments: '{"followup":"stars"}',
                },
              },
            ],
          },
          finish_reason: 'COMPLETE',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new CohereLLMAdapter({
        defaultBaseUrl: 'https://cohere.example/v2',
        defaultModel: 'command-r-plus',
      });
      adapter.configure('sk-cohere');

      await expect(
        complete(adapter,
          [
            { role: 'user', content: 'hello' },
            {
              role: 'assistant',
              content: 'working',
              toolCalls: [{ id: 'call-1', name: 'lookup', arguments: { query: 'moon' } }],
            },
            { role: 'tool', toolCallId: 'call-1', content: '{"answer":"moon"}' },
          ],
          {
            temperature: 0.1,
            maxTokens: 256,
            topP: 0.8,
            stop: ['halt'],
            tools: [
              {
                name: 'lookup',
                description: 'Lookup data',
                parameters: { type: 'object', properties: {} },
              },
            ],
          },
        ),
      ).resolves.toMatchObject({
        content: 'summary',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'cohere-call-1',
            name: 'lookup',
            arguments: { followup: 'stars' },
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('streams by yielding the completed Cohere content once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: {
                content: [{ text: 'Hello' }, { text: ' world' }],
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    try {
      const adapter = new CohereLLMAdapter();
      adapter.configure('sk-cohere');

      const chunks: string[] = [];
      for await (const chunk of adapter.stream([{ role: 'user', content: 'hello' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello world']);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('maps Cohere status codes into LucidError codes', async () => {
    for (const testCase of [
      { status: 401, code: ErrorCode.AuthFailed, message: 'Invalid Cohere API key' },
      { status: 429, code: ErrorCode.RateLimited, message: 'Cohere rate limited' },
      { status: 500, code: ErrorCode.ServiceUnavailable, message: 'Cohere error: 500' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: testCase.status })),
      );

      const adapter = new CohereLLMAdapter();
      adapter.configure('sk-cohere');

      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).rejects.toMatchObject<
        Partial<LucidError>
      >({
        code: testCase.code,
        message: testCase.message,
      });

      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
