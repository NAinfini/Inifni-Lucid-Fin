import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import type { LLMMessage, LLMRequestOptions } from '@lucid-fin/contracts';
import { describe, it, expect, vi } from 'vitest';
import { OllamaLLMAdapter } from './ollama-llm.js';
import { collectLLMStream } from './test-utils/collect-llm-stream.js';

function complete(adapter: OllamaLLMAdapter, messages: LLMMessage[], opts?: LLMRequestOptions) {
  return collectLLMStream(adapter.completeWithTools(messages, opts));
}

describe('OllamaLLMAdapter', () => {
  it('uses local defaults and validates against the configured Ollama host', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe('http://ollama.local:11434/api/tags');
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new OllamaLLMAdapter();
      adapter.configure('', {
        baseUrl: 'http://ollama.local:11434',
        model: 'qwen3:14b',
      });

      expect(adapter.id).toBe('ollama-local');
      expect(adapter.name).toBe('Ollama (Local)');
      expect(Reflect.get(adapter, 'model')).toBe('qwen3:14b');

      await expect(adapter.validate()).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });

  it('builds tool-enabled chat requests and parses returned tool calls', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('http://ollama.local:11434/api/chat');

      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      expect(body).toMatchObject({
        model: 'qwen3:14b',
        stream: false,
        options: {
          temperature: 0.4,
          num_predict: 64,
          top_p: 0.9,
          stop: ['halt'],
        },
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
            content: 'summary',
            tool_calls: [
              {
                function: {
                  name: 'lookup',
                  arguments: { followup: 'stars' },
                },
              },
            ],
          },
          done_reason: 'stop',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const adapter = new OllamaLLMAdapter();
      adapter.configure('', {
        baseUrl: 'http://ollama.local:11434',
        model: 'qwen3:14b',
      });

      await expect(
        complete(
          adapter,
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
            temperature: 0.4,
            maxTokens: 64,
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
            id: 'ollama-tc-0',
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

  it('streams newline-delimited JSON chunks and ignores malformed lines', async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"message":{"content":"Hello"}}\n'));
            controller.enqueue(encoder.encode('not-json\n'));
            controller.enqueue(encoder.encode('{"message":{"content":" world"}}\n'));
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      }),
    );

    try {
      const adapter = new OllamaLLMAdapter();

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

  it('throws a model-specific not found error for missing Ollama models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );

    try {
      const adapter = new OllamaLLMAdapter();
      adapter.configure('', { model: 'mistral:latest' });

      await expect(adapter.complete([{ role: 'user', content: 'hello' }])).rejects.toMatchObject<
        Partial<LucidError>
      >({
        code: ErrorCode.NotFound,
        message: 'Ollama model "mistral:latest" not found',
      });
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
