import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import {
  normalizeOpenAICompatibleBaseUrl,
  OpenAICompatibleLLM,
} from './openai-compatible-base.js';

describe('OpenAICompatibleLLM.validate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts providers that expose chat completions even when /models is unavailable', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/models')) {
        return new Response('not found', { status: 404 });
      }

      if (url.endsWith('/chat/completions')) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'ok' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleLLM({
      id: 'custom-local',
      name: 'Custom Local',
      defaultBaseUrl: 'http://127.0.0.1:37123/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });

    await expect(adapter.validate()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:37123/v1/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:37123/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});

describe('OpenAICompatibleLLM.completeWithTools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts assistant text from output_text content parts returned by OpenAI-compatible gateways', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    {
                      type: 'output_text',
                      text: 'hello from gateway',
                    },
                  ],
                },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const adapter = new OpenAICompatibleLLM({
      id: 'custom-local',
      name: 'Custom Local',
      defaultBaseUrl: 'http://127.0.0.1:37123/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
    ).resolves.toMatchObject({
      content: 'hello from gateway',
      finishReason: 'stop',
    });
  });

  it('throws a structured error when the provider returns JSON without extractable content or tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [{ type: 'reasoning', text: 'internal only' }],
                },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const adapter = new OpenAICompatibleLLM({
      id: 'custom-local',
      name: 'Custom Local',
      defaultBaseUrl: 'http://127.0.0.1:37123/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
    ).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.ServiceUnavailable,
      message: 'Custom Local returned JSON without extractable assistant content',
      details: expect.objectContaining({
        endpoint: 'http://127.0.0.1:37123/v1/chat/completions',
        model: 'gpt-5.4',
        provider: 'Custom Local',
        finishReason: 'stop',
        choiceCount: 1,
        toolCallCount: 0,
        messageContentTypes: ['reasoning'],
      }),
    });
  });

  it('surfaces upstream status, endpoint, model, and response body when the provider rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'Unsupported parameter: tools',
              code: 'unsupported_parameter',
            },
            trace_id: 'trace-123',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const adapter = new OpenAICompatibleLLM({
      id: 'custom-local',
      name: 'Custom Local',
      defaultBaseUrl: 'http://127.0.0.1:37123/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools(
        [{ role: 'user', content: 'hello' }],
        {
          tools: [
            {
              name: 'listNodes',
              description: 'List nodes',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      ),
    ).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.InvalidRequest,
      message: 'Unsupported parameter: tools',
      details: expect.objectContaining({
        status: 400,
        endpoint: 'http://127.0.0.1:37123/v1/chat/completions',
        model: 'gpt-5.4',
        provider: 'Custom Local',
        hasTools: true,
        responseText: expect.stringContaining('Unsupported parameter: tools'),
      }),
    });
  });

  it('throws a structured LucidError when a successful response returns HTML instead of JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<!doctype html><html><body>proxy page</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      ),
    );

    const adapter = new OpenAICompatibleLLM({
      id: 'custom-local',
      name: 'Custom Local',
      defaultBaseUrl: 'http://127.0.0.1:37123/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
    ).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.ServiceUnavailable,
      message: 'Custom Local returned a non-JSON response',
      details: expect.objectContaining({
        status: 200,
        endpoint: 'http://127.0.0.1:37123/v1/chat/completions',
        model: 'gpt-5.4',
        provider: 'Custom Local',
        contentType: 'text/html; charset=utf-8',
        responseTextSnippet: expect.stringContaining('<!doctype html>'),
      }),
    });
  });

  it('retries against /v1 when the configured root URL serves an HTML dashboard', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === 'https://code.b886.top/chat/completions') {
        return new Response('<!doctype html><html><body>dashboard</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      if (url === 'https://code.b886.top/v1/chat/completions') {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: 'hello from api' },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleLLM({
      id: 'openai',
      name: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'https://code.b886.top',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
    ).resolves.toMatchObject({
      content: 'hello from api',
      finishReason: 'stop',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://code.b886.top/chat/completions');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe('https://code.b886.top/v1/chat/completions');
  });

  it('extracts assistant text when message.content uses OpenAI-style output_text parts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    { type: 'output_text', text: 'Hello' },
                    { type: 'output_text', text: ' world' },
                  ],
                },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const adapter = new OpenAICompatibleLLM({
      id: 'openai',
      name: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'https://code.b886.top',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
    ).resolves.toMatchObject({
      content: 'Hello world',
      finishReason: 'stop',
      toolCalls: [],
    });
  });

  it('throws a structured error when a 200 JSON response contains no assistant text and no tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            id: 'chatcmpl-empty',
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: [],
                },
                finish_reason: 'stop',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    );

    const adapter = new OpenAICompatibleLLM({
      id: 'custom-local',
      name: 'Custom Local',
      defaultBaseUrl: 'http://127.0.0.1:37123/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'http://127.0.0.1:37123/v1',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }]),
    ).rejects.toMatchObject<Partial<LucidError>>({
      code: ErrorCode.ServiceUnavailable,
      message: 'Custom Local returned JSON without extractable assistant content',
      details: expect.objectContaining({
        status: 200,
        endpoint: 'http://127.0.0.1:37123/v1/chat/completions',
        model: 'gpt-5.4',
        provider: 'Custom Local',
        responseBody: expect.objectContaining({
          id: 'chatcmpl-empty',
        }),
      }),
    });
  });

  it('uses GPT-5 chat-completions compatibility params from OpenAI docs', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;

      expect(body).toMatchObject({
        model: 'gpt-5.4',
        max_completion_tokens: 4096,
        stream: false,
      });
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('temperature');

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'compat ok' },
              finish_reason: 'stop',
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

    const adapter = new OpenAICompatibleLLM({
      id: 'openai',
      name: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModel: 'gpt-5.4',
    });
    adapter.configure('test-key', {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    });

    await expect(
      adapter.completeWithTools(
        [{ role: 'user', content: 'hello' }],
        {
          temperature: 0.7,
          maxTokens: 4096,
          tools: [
            {
              name: 'tool.search',
              description: 'Search tools',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          ],
        },
      ),
    ).resolves.toMatchObject({
      content: 'compat ok',
      finishReason: 'stop',
    });
  });
});

describe('normalizeOpenAICompatibleBaseUrl', () => {
  it('strips pasted endpoint suffixes while preserving the API base', () => {
    expect(normalizeOpenAICompatibleBaseUrl('https://example.com/chat/completions')).toBe(
      'https://example.com',
    );
    expect(normalizeOpenAICompatibleBaseUrl('https://example.com/v1/models')).toBe(
      'https://example.com/v1',
    );
  });
});
