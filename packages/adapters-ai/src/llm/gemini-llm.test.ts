import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { GeminiLLMAdapter } from './gemini-llm.js';

describe('GeminiLLMAdapter', () => {
  it('uses Gemini defaults and validates against the configured API root', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe('https://gemini.example/v1beta/models?key=sk-gemini');
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new GeminiLLMAdapter();
      adapter.configure('sk-gemini', {
        baseUrl: 'https://gemini.example/v1beta',
        model: 'gemini-2.5-pro',
      });

      expect(adapter.id).toBe('gemini');
      expect(adapter.name).toBe('Google Gemini');
      expect(Reflect.get(adapter, 'model')).toBe('gemini-2.5-pro');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('builds Gemini request bodies and parses text plus function calls', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://gemini.example/v1beta/models/gemini-2.5-pro:generateContent?key=sk-gemini',
      );

      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({
        systemInstruction: {
          parts: [{ text: 'system rule' }],
        },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 128,
          topP: 0.9,
          stopSequences: ['halt'],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'lookup',
                description: 'Lookup data',
              },
            ],
          },
        ],
      });
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'hello' }] },
        {
          role: 'model',
          parts: [
            { text: 'working' },
            { functionCall: { name: 'lookup', args: { query: 'moon' } } },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'gemini-call-1',
                response: { content: '{"answer":"moon"}' },
              },
            },
          ],
        },
      ]);

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'summary' },
                  { functionCall: { name: 'lookup', args: { followup: 'stars' } } },
                ],
              },
              finishReason: 'STOP',
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
      const adapter = new GeminiLLMAdapter({
        defaultBaseUrl: 'https://gemini.example/v1beta',
        defaultModel: 'gemini-2.5-pro',
      });
      adapter.configure('sk-gemini');

      await expect(
        adapter.completeWithTools(
          [
            { role: 'system', content: 'system rule' },
            { role: 'user', content: 'hello' },
            {
              role: 'assistant',
              content: 'working',
              toolCalls: [{ id: 'gemini-call-1', name: 'lookup', arguments: { query: 'moon' } }],
            },
            { role: 'tool', toolCallId: 'gemini-call-1', content: '{"answer":"moon"}' },
          ],
          {
            temperature: 0.2,
            maxTokens: 128,
            topP: 0.9,
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
            id: 'gemini-tc-0',
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

  it('streams SSE text chunks and skips malformed frames', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n'),
            );
            controller.enqueue(encoder.encode('data: not-json\n'));
            controller.enqueue(
              encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\n'),
            );
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    try {
      const adapter = new GeminiLLMAdapter();
      adapter.configure('sk-gemini');

      const chunks: string[] = [];
      for await (const chunk of adapter.stream([{ role: 'user', content: 'hello' }])) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello', ' world']);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('maps Gemini status codes into LucidError codes', async () => {
    for (const testCase of [
      { status: 401, code: ErrorCode.AuthFailed, message: 'Invalid Gemini API key' },
      { status: 403, code: ErrorCode.AuthFailed, message: 'Invalid Gemini API key' },
      { status: 429, code: ErrorCode.RateLimited, message: 'Gemini rate limited' },
      { status: 500, code: ErrorCode.ServiceUnavailable, message: 'Gemini error: 500' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: testCase.status })),
      );

      const adapter = new GeminiLLMAdapter();
      adapter.configure('sk-gemini');

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
