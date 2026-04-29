import type {
  Capability,
  LLMAdapter,
  LLMStreamEvent,
  LLMMessage,
  LLMRequestOptions,
  LLMToolCall,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { oneShotStream } from './one-shot-stream.js';
import { validateProviderUrl } from '../url-policy.js';

type CohereAdapterConfig = {
  id?: string;
  name?: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
};

export class CohereLLMAdapter implements LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[] = [
    'text-generation',
    'script-expand',
    'scene-breakdown',
    'character-extract',
    'prompt-enhance',
  ];
  readonly profile: ProviderProfile;

  private apiKey = '';
  private baseUrl: string;
  private model: string;

  constructor(cfg: CohereAdapterConfig = {}) {
    this.id = cfg.id ?? 'cohere';
    this.name = cfg.name ?? 'Cohere';
    this.baseUrl = cfg.defaultBaseUrl ?? 'https://api.cohere.com/v2';
    this.model = cfg.defaultModel ?? 'command-a-03-2025';
    this.profile = {
      providerId: this.id,
      charsPerToken: 4.0,
      sanitizeToolNames: false,
      maxUtilization: 0.9,
      outputReserveTokens: 4096,
    };
  }

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(messages, opts)),
    });
    if (!res.ok) this.throwError(res.status);
    const data = (await res.json()) as { message?: { content?: Array<{ text?: string }> } };
    return data.message?.content?.map((entry) => entry.text ?? '').join('') ?? '';
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const content = await this.complete(messages, opts);
    if (content) {
      yield content;
    }
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<AsyncIterable<LLMStreamEvent>> {
    const res = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.buildBody(messages, opts)),
      signal: opts?.signal,
    });
    if (!res.ok) this.throwError(res.status);

    const data = (await res.json()) as {
      message?: {
        content?: Array<{ text?: string }>;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string | Record<string, unknown> };
        }>;
      };
      finish_reason?: string;
    };

    const toolCalls: LLMToolCall[] = (data.message?.tool_calls ?? []).map((toolCall, index) => ({
      id: toolCall.id ?? `cohere-tc-${index}`,
      name: toolCall.function?.name ?? `tool-${index}`,
      arguments:
        typeof toolCall.function?.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : (toolCall.function?.arguments ?? {}),
    }));

    const finishReason: 'tool_calls' | 'length' | 'stop' =
      toolCalls.length > 0 ? 'tool_calls' : data.finish_reason === 'MAX_TOKENS' ? 'length' : 'stop';

    return oneShotStream({
      content: data.message?.content?.map((entry) => entry.text ?? '').join('') ?? '',
      toolCalls,
      finishReason,
    });
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private buildBody(messages: LLMMessage[], opts?: LLMRequestOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((message) => {
        if (message.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: message.toolCallId,
            content: message.content,
          };
        }

        const payload: Record<string, unknown> = {
          role: message.role,
          content: message.content,
        };

        if (message.toolCalls?.length) {
          payload.tool_calls = message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.arguments),
            },
          }));
        }

        return payload;
      }),
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 4096,
      p: opts?.topP,
      stop_sequences: opts?.stop,
    };

    if (opts?.tools?.length) {
      body.tools = opts.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    return body;
  }

  private throwError(status: number): never {
    if (status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Cohere API key');
    if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Cohere rate limited');
    throw new LucidError(ErrorCode.ServiceUnavailable, `Cohere error: ${status}`);
  }
}
