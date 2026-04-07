import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeLLMAdapter } from './claude-llm.js';

describe('ClaudeLLMAdapter.completeWithTools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes Anthropic tool names and maps tool_use names back to original names', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const tools = Array.isArray(body.tools) ? (body.tools as Array<Record<string, unknown>>) : [];
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({
        name: 'tool_search',
      });

      return new Response(
        JSON.stringify({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_123',
              name: 'tool_search',
              input: { query: 'character' },
            },
          ],
          stop_reason: 'tool_use',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ClaudeLLMAdapter({
      id: 'claude',
      name: 'Anthropic Claude',
      defaultBaseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    adapter.configure('test-key');

    await expect(
      adapter.completeWithTools(
        [{ role: 'user', content: 'hello' }],
        {
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
          toolChoice: 'auto',
        },
      ),
    ).resolves.toMatchObject({
      content: '',
      finishReason: 'tool_calls',
      toolCalls: [
        {
          id: 'toolu_123',
          name: 'tool.search',
          arguments: { query: 'character' },
        },
      ],
    });
  });

  it('normalizes configured anthropic message endpoints without appending v1/messages twice', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(String(input)).toBe('https://proxy.example/v1/messages');

      return new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'hello from claude' }],
          stop_reason: 'end_turn',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ClaudeLLMAdapter({
      id: 'claude',
      name: 'Anthropic Claude',
      defaultBaseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    adapter.configure('test-key', {
      baseUrl: 'https://proxy.example/v1/messages',
    });

    await expect(
      adapter.completeWithTools([{ role: 'user', content: 'hello' }], {
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
      }),
    ).resolves.toMatchObject({
      content: 'hello from claude',
      finishReason: 'stop',
      toolCalls: [],
    });
  });

  it('preserves anthropic HTTP error details for logging and diagnosis', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            type: 'service_unavailable_error',
            message: 'gateway overloaded',
          },
        }),
        {
          status: 503,
          statusText: 'Service Unavailable',
          headers: {
            'Content-Type': 'application/json',
            'request-id': 'anthropic-req-123',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ClaudeLLMAdapter({
      id: 'claude',
      name: 'Anthropic Claude',
      defaultBaseUrl: 'https://api.anthropic.com',
      defaultModel: 'claude-sonnet-4-20250514',
    });
    adapter.configure('test-key', {
      baseUrl: 'https://proxy.example/v1',
    });

    let thrown: unknown;
    try {
      await adapter.completeWithTools([{ role: 'user', content: 'hello' }], {
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
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(LucidError);
    expect((thrown as LucidError).code).toBe(ErrorCode.ServiceUnavailable);
    expect((thrown as LucidError).message).toBe('gateway overloaded');
    expect((thrown as LucidError).details).toMatchObject({
      status: 503,
      statusText: 'Service Unavailable',
      endpoint: 'https://proxy.example/v1/messages',
      provider: 'Anthropic Claude',
      providerId: 'claude',
      baseUrl: 'https://proxy.example/v1',
      model: 'claude-sonnet-4-20250514',
      responseBody: {
        error: {
          type: 'service_unavailable_error',
          message: 'gateway overloaded',
        },
      },
      upstreamRequestId: 'anthropic-req-123',
    });
    expect((thrown as LucidError).details?.requestBody).toMatchObject({
      model: 'claude-sonnet-4-20250514',
      tools: [
        {
          name: 'tool_search',
        },
      ],
    });
  });
});
