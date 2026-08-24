import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import type { LLMMessage, LLMRequestOptions } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { GeminiLLMAdapter } from './gemini-llm.js';
import { collectLLMStream } from './test-utils/collect-llm-stream.js';

function complete(adapter: GeminiLLMAdapter, messages: LLMMessage[], opts?: LLMRequestOptions) {
  return collectLLMStream(adapter.completeWithTools(messages, opts));
}

describe('GeminiLLMAdapter', () => {
  it('uses Gemini defaults and validates against the configured API root', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://gemini.example/v1beta/models');
      expect((init?.headers as Record<string, string> | undefined)?.['x-goog-api-key']).toBe(
        'sk-gemini',
      );
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

  it('sends configured reasoning strength and omits a blank value', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        requestBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    try {
      const adapter = new GeminiLLMAdapter();
      adapter.configure('sk-gemini', { reasoningEffort: 'HIGH' });
      await adapter.complete([{ role: 'user', content: 'hello' }]);

      adapter.configure('sk-gemini', { reasoningEffort: '   ' });
      await adapter.complete([{ role: 'user', content: 'hello again' }]);

      expect(requestBodies[0]).toMatchObject({
        generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } },
      });
      expect(requestBodies[1]).toMatchObject({ generationConfig: { maxOutputTokens: 4096 } });
      expect(requestBodies[1].generationConfig).not.toHaveProperty('thinkingConfig');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('uses main-process OAuth headers without an API key', async () => {
    const authorizationHeaders = vi.fn(async () => ({
      Authorization: 'Bearer access-token',
      'x-goog-user-project': 'quota-project',
    }));
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: 'Bearer access-token',
        'x-goog-user-project': 'quota-project',
      });
      expect(init?.headers).not.toHaveProperty('x-goog-api-key');
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OAuth works' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new GeminiLLMAdapter({
        id: 'gemini-oauth',
        credentialMode: 'oauth',
        oauthTarget: { provider: 'gemini', capability: 'llm' },
        authorizationHeaders,
      });
      adapter.configure('');

      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).resolves.toBe(
        'OAuth works',
      );
      expect(authorizationHeaders).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('builds Gemini request bodies and parses text plus function calls', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://gemini.example/v1beta/models/gemini-3.6-flash:generateContent',
      );
      expect((init?.headers as Record<string, string> | undefined)?.['x-goog-api-key']).toBe(
        'sk-gemini',
      );

      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({
        systemInstruction: {
          parts: [{ text: 'system rule' }],
        },
        generationConfig: {
          maxOutputTokens: 128,
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
      const generationConfig = body.generationConfig as Record<string, unknown>;
      expect(generationConfig).not.toHaveProperty('temperature');
      expect(generationConfig).not.toHaveProperty('topP');
      expect(body.contents).toEqual([
        {
          role: 'user',
          parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }, { text: 'hello' }],
        },
        {
          role: 'model',
          parts: [
            { text: 'working' },
            {
              functionCall: { name: 'lookup', args: { query: 'moon' } },
              thoughtSignature: 'signature-in',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'lookup',
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
                  {
                    thoughtSignature: 'signature-out',
                    functionCall: {
                      id: 'gemini-call-2',
                      name: 'lookup',
                      args: { followup: 'stars' },
                    },
                  },
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
        defaultModel: 'gemini-3.6-flash',
      });
      adapter.configure('sk-gemini');

      await expect(
        complete(
          adapter,
          [
            { role: 'system', content: 'system rule' },
            {
              role: 'user',
              content: 'hello',
              images: [{ mimeType: 'image/png', data: 'aGVsbG8=' }],
            },
            {
              role: 'assistant',
              content: 'working',
              toolCalls: [
                {
                  id: 'gemini-call-1',
                  name: 'lookup',
                  arguments: { query: 'moon' },
                  thoughtSignature: 'signature-in',
                },
              ],
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
            id: 'gemini-call-2',
            name: 'lookup',
            arguments: { followup: 'stars' },
            thoughtSignature: 'signature-out',
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

  it('identifies an OAuth authentication failure without mentioning an API key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );

    try {
      const adapter = new GeminiLLMAdapter({
        credentialMode: 'oauth',
        authorizationHeaders: async () => ({ Authorization: 'Bearer expired' }),
      });

      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
        code: ErrorCode.AuthFailed,
        message: 'Gemini OAuth authentication failed',
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
