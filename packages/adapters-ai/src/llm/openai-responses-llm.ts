import type {
  Capability,
  LLMAdapter,
  LLMStreamEvent,
  LLMMessage,
  LLMProviderAuthStyle,
  LLMRequestOptions,
  LLMToolCall,
} from '@lucid-fin/contracts';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { normalizeOpenAICompatibleBaseUrl } from './openai-compatible-base.js';
import { oneShotStream } from './one-shot-stream.js';
import { validateProviderUrl } from '../url-policy.js';

interface OpenAIResponsesCompletion {
  content: string;
  reasoning?: string;
  toolCalls: LLMToolCall[];
  finishReason: 'tool_calls' | 'length' | 'stop';
}

type OpenAIResponsesConfig = {
  id: string;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
  authStyle?: LLMProviderAuthStyle;
  capabilities?: Capability[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractTextFromResponse(response: Record<string, unknown>): string {
  const topLevel = typeof response.output_text === 'string' ? response.output_text.trim() : '';
  if (topLevel) {
    return topLevel;
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.output_text === 'string' && item.output_text.trim()) {
      chunks.push(item.output_text.trim());
      continue;
    }

    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (!isRecord(block)) {
        continue;
      }
      if (
        (block.type === 'output_text' || block.type === 'text') &&
        typeof block.text === 'string' &&
        block.text.trim()
      ) {
        chunks.push(block.text.trim());
      }
    }
  }

  return chunks.join('');
}

function stringifyUrl(url: URL): string {
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}${url.search}${url.hash}`;
}

function normalizeResponsesBaseUrl(baseUrl: string): string {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (!normalized) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    parsed.pathname = parsed.pathname.replace(/\/responses$/i, '') || '/';
    return stringifyUrl(parsed);
  } catch {
    /* malformed URL — fall back to string-based /responses stripping */
    return normalized.replace(/\/responses$/i, '');
  }
}

export class OpenAIResponsesLLM implements LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];

  private apiKey = '';
  private baseUrl: string;
  private model: string;
  private authStyle: LLMProviderAuthStyle;

  constructor(cfg: OpenAIResponsesConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.baseUrl = normalizeResponsesBaseUrl(cfg.defaultBaseUrl);
    this.model = cfg.defaultModel;
    this.authStyle = cfg.authStyle ?? 'bearer';
    this.capabilities = cfg.capabilities ?? [
      'text-generation',
      'script-expand',
      'scene-breakdown',
      'character-extract',
      'prompt-enhance',
    ];
  }

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = normalizeResponsesBaseUrl(options.baseUrl as string);
    }
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          input: 'hi',
          max_output_tokens: 1,
        }),
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const result = await this.request(messages, opts);
    return result.content;
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const result = await this.request(messages, opts);
    if (result.content) {
      yield result.content;
    }
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<AsyncIterable<LLMStreamEvent>> {
    const result = await this.request(messages, opts);
    return oneShotStream({
      content: result.content,
      reasoning: result.reasoning,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
    });
  }

  private headers(): Record<string, string> {
    switch (this.authStyle) {
      case 'none':
        return { 'Content-Type': 'application/json' };
      case 'x-api-key':
        return { 'Content-Type': 'application/json', 'x-api-key': this.apiKey };
      case 'x-goog-api-key':
        return { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey };
      case 'bearer':
      default:
        return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
    }
  }

  private buildRequestBody(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Record<string, unknown> {
    const instructions = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n')
      .trim();

    const input: Array<Record<string, unknown>> = [];
    for (const message of messages) {
      if (message.role === 'system') {
        continue;
      }

      if (message.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: message.content,
        });
        continue;
      }

      if (message.role === 'assistant' && message.toolCalls?.length) {
        if (message.content.trim()) {
          input.push({
            role: 'assistant',
            content: message.content,
          });
        }

        for (const toolCall of message.toolCalls) {
          input.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.name.replace(/\./g, '_'),
            arguments: JSON.stringify(toolCall.arguments),
          });
        }
        continue;
      }

      input.push({
        role: message.role,
        content: message.content,
      });
    }

    const body: Record<string, unknown> = {
      model: this.model,
      input,
      max_output_tokens: opts?.maxTokens ?? 4096,
    };

    if (instructions) {
      body.instructions = instructions;
    }

    if (opts?.temperature !== undefined) {
      body.temperature = opts.temperature;
    }
    if (opts?.topP !== undefined) {
      body.top_p = opts.topP;
    }

    if (opts?.tools?.length) {
      body.tools = opts.tools.map((tool) => ({
        type: 'function',
        name: tool.name.replace(/\./g, '_'),
        description: tool.description,
        parameters: tool.parameters,
      }));

      if (opts.toolChoice) {
        body.tool_choice =
          typeof opts.toolChoice === 'string'
            ? opts.toolChoice
            : { type: 'function', name: opts.toolChoice.name.replace(/\./g, '_') };
      }
    }

    return body;
  }

  private async request(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<OpenAIResponsesCompletion> {
    const body = this.buildRequestBody(messages, opts);
    const res = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    });

    if (!res.ok) {
      const responseText = await res.text();
      if (res.status === 401) {
        throw new LucidError(ErrorCode.AuthFailed, `Invalid ${this.name} API key`, {
          status: res.status,
          responseText: responseText.slice(0, 200),
        });
      }
      if (res.status === 429) {
        throw new LucidError(ErrorCode.RateLimited, `${this.name} rate limited`, {
          status: res.status,
          responseText: responseText.slice(0, 200),
        });
      }
      if (res.status === 400) {
        throw new LucidError(ErrorCode.InvalidRequest, `${this.name} error: 400`, {
          status: res.status,
          responseText: responseText.slice(0, 200),
        });
      }
      throw new LucidError(ErrorCode.ServiceUnavailable, `${this.name} error: ${res.status}`, {
        status: res.status,
        responseText: responseText.slice(0, 200),
      });
    }

    const data = (await res.json()) as Record<string, unknown>;
    const content = extractTextFromResponse(data);

    const toolNameMap = new Map<string, string>(
      (opts?.tools ?? []).map((tool) => [tool.name.replace(/\./g, '_'), tool.name]),
    );
    const output = Array.isArray(data.output) ? data.output : [];

    // Extract reasoning from reasoning output items
    let reasoning = '';
    for (const item of output) {
      if (isRecord(item) && item.type === 'reasoning') {
        const summary = Array.isArray(item.summary) ? item.summary : [];
        for (const part of summary) {
          if (isRecord(part) && part.type === 'summary_text' && typeof part.text === 'string') {
            reasoning += part.text;
          }
        }
      }
    }

    const toolCalls: LLMToolCall[] = output
      .filter(
        (item): item is Record<string, unknown> => isRecord(item) && item.type === 'function_call',
      )
      .map((item, index) => {
        const rawName = typeof item.name === 'string' ? item.name : `tool_${index}`;
        const rawArguments = item.arguments;
        let parsedArguments: Record<string, unknown> = {};

        if (typeof rawArguments === 'string' && rawArguments.trim()) {
          try {
            const parsed = JSON.parse(rawArguments) as unknown;
            parsedArguments = isRecord(parsed) ? parsed : {};
          } catch {
            /* malformed JSON tool arguments — pass raw string for caller to handle */
            parsedArguments = { raw: rawArguments };
          }
        } else if (isRecord(rawArguments)) {
          parsedArguments = rawArguments;
        }

        return {
          id: typeof item.call_id === 'string' ? item.call_id : `tool-call-${index}`,
          name: toolNameMap.get(rawName) ?? rawName,
          arguments: parsedArguments,
        };
      });

    if (!content && toolCalls.length === 0 && !reasoning) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `${this.name} returned a response without extractable content`,
        {
          responseBody: data,
        },
      );
    }

    return {
      content,
      toolCalls,
      reasoning: reasoning || undefined,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    } satisfies OpenAIResponsesCompletion;
  }
}
