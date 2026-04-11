import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { OpenAIResponsesLLM } from './openai-responses-llm.js';

describe('OpenAIResponsesLLM', () => {
  it('normalizes responses endpoints and validates with the configured auth style', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://responses.example/v1/responses');
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        'x-api-key': 'sk-responses',
      });
      expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({
        model: 'gpt-5.4',
        input: 'hi',
        max_output_tokens: 1,
      });

      return new Response(JSON.stringify({ id: 'resp_1', output_text: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new OpenAIResponsesLLM({
        id: 'openai-responses',
        name: 'OpenAI Responses',
        defaultBaseUrl: 'https://responses.example/v1/responses',
        defaultModel: 'gpt-5.4',
        authStyle: 'x-api-key',
      });
      adapter.configure('sk-responses', {
        baseUrl: 'https://responses.example/v1/responses',
        model: 'gpt-5.4',
      });

      expect(adapter.id).toBe('openai-responses');
      expect(adapter.name).toBe('OpenAI Responses');
      expect(Reflect.get(adapter, 'baseUrl')).toBe('https://responses.example/v1');
      expect(Reflect.get(adapter, 'model')).toBe('gpt-5.4');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('builds responses API bodies and restores original tool names in tool calls', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'gpt-5.4',
        instructions: 'system rule',
        max_output_tokens: 128,
        temperature: 0.2,
        top_p: 0.9,
        tools: [
          {
            type: 'function',
            name: 'tool_search',
            description: 'Search',
          },
        ],
        tool_choice: {
          type: 'function',
          name: 'tool_search',
        },
      });
      expect(body.input).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'working' },
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'tool_search',
          arguments: '{"query":"moon"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: '{"answer":"moon"}',
        },
      ]);

      return new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'summary' }],
            },
            {
              type: 'function_call',
              call_id: 'call-2',
              name: 'tool_search',
              arguments: '{"followup":"stars"}',
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
      const adapter = new OpenAIResponsesLLM({
        id: 'openai-responses',
        name: 'OpenAI Responses',
        defaultBaseUrl: 'https://responses.example/v1',
        defaultModel: 'gpt-5.4',
      });
      adapter.configure('sk-responses');

      await expect(
        adapter.completeWithTools(
          [
            { role: 'system', content: 'system rule' },
            { role: 'user', content: 'hello' },
            {
              role: 'assistant',
              content: 'working',
              toolCalls: [{ id: 'call-1', name: 'tool.search', arguments: { query: 'moon' } }],
            },
            { role: 'tool', toolCallId: 'call-1', content: '{"answer":"moon"}' },
          ],
          {
            maxTokens: 128,
            temperature: 0.2,
            topP: 0.9,
            tools: [
              {
                name: 'tool.search',
                description: 'Search',
                parameters: { type: 'object', properties: {} },
              },
            ],
            toolChoice: { name: 'tool.search' },
          },
        ),
      ).resolves.toMatchObject({
        content: 'summary',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-2',
            name: 'tool.search',
            arguments: { followup: 'stars' },
          },
        ],
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('maps responses API status codes into LucidError codes', async () => {
    for (const testCase of [
      { status: 401, code: ErrorCode.AuthFailed, message: 'Invalid OpenAI Responses API key' },
      { status: 429, code: ErrorCode.RateLimited, message: 'OpenAI Responses rate limited' },
      { status: 400, code: ErrorCode.InvalidRequest, message: 'OpenAI Responses error: 400' },
      { status: 503, code: ErrorCode.ServiceUnavailable, message: 'OpenAI Responses error: 503' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(`status ${testCase.status}`, { status: testCase.status })),
      );

      const adapter = new OpenAIResponsesLLM({
        id: 'openai-responses',
        name: 'OpenAI Responses',
        defaultBaseUrl: 'https://responses.example/v1',
        defaultModel: 'gpt-5.4',
      });
      adapter.configure('sk-responses');

      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).rejects.toMatchObject<
        Partial<LucidError>
      >({
        code: testCase.code,
        message: testCase.message,
        details: expect.objectContaining({
          status: testCase.status,
          responseText: `status ${testCase.status}`,
        }),
      });

      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('throws a structured error when the responses payload has no text and no tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              output: [{ type: 'message', content: [{ type: 'reasoning', text: 'internal' }] }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
      ),
    );

    try {
      const adapter = new OpenAIResponsesLLM({
        id: 'openai-responses',
        name: 'OpenAI Responses',
        defaultBaseUrl: 'https://responses.example/v1',
        defaultModel: 'gpt-5.4',
      });
      adapter.configure('sk-responses');

      await expect(
        adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
      ).rejects.toMatchObject<Partial<LucidError>>({
        code: ErrorCode.ServiceUnavailable,
        message: 'OpenAI Responses returned a response without extractable content',
        details: expect.objectContaining({
          responseBody: expect.objectContaining({
            output: expect.any(Array),
          }),
        }),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
