import { randomUUID } from 'node:crypto';
import type {
  LLMAdapter,
  LLMMessage,
  LLMRequestOptions,
  LLMCompletionResult,
  LLMToolCall,
  Capability,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { parseSseStream } from './sse-parser.js';
import {
  tryParseJson,
  serializeError,
  measureRequestDiagnostics,
  truncateForDiagnostics,
  resolveErrorCode,
} from './llm-error-builder.js';

type ClaudeAdapterConfig = {
  id?: string;
  name?: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
};

interface ClaudeRequestResult {
  response: Response;
  endpoint: string;
  requestBody: Record<string, unknown>;
  requestId: string;
  streaming: boolean;
  hasTools: boolean;
}

function sanitizeClaudeToolName(name: string): string {
  return name.replace(/\./g, '_');
}

function stringifyUrl(url: URL): string {
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}${url.search}${url.hash}`;
}

function normalizeClaudeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname
      .replace(/\/+$/, '')
      .replace(/\/messages$/i, '');

    parsed.pathname = normalizedPath || '/';
    return stringifyUrl(parsed);
  } catch { /* malformed URL — fall back to string-based path stripping */
    return trimmed.replace(/\/+$/, '').replace(/\/messages$/i, '');
  }
}

function buildClaudeMessagesEndpoint(baseUrl: string): string {
  const normalized = normalizeClaudeBaseUrl(baseUrl);
  if (!normalized) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = /\/v1$/i.test(pathname)
      ? `${pathname}/messages`
      : `${pathname || ''}/v1/messages`;
    return stringifyUrl(parsed);
  } catch { /* malformed URL — fall back to string-based endpoint construction */
    return /\/v1$/i.test(normalized) ? `${normalized}/messages` : `${normalized}/v1/messages`;
  }
}

export class ClaudeLLMAdapter implements LLMAdapter {
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

  constructor(cfg: ClaudeAdapterConfig = {}) {
    this.id = cfg.id ?? 'claude';
    this.name = cfg.name ?? 'Anthropic Claude';
    this.baseUrl = normalizeClaudeBaseUrl(cfg.defaultBaseUrl ?? 'https://api.anthropic.com');
    this.model = cfg.defaultModel ?? 'claude-sonnet-4-20250514';
    this.profile = {
      providerId: this.id,
      charsPerToken: 3.5,
      sanitizeToolNames: true,
      maxUtilization: 0.90,
      outputReserveTokens: 4096,
    };
  }

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = normalizeClaudeBaseUrl(options.baseUrl as string);
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      // Send a minimal request to check key validity
      const res = await fetch(buildClaudeMessagesEndpoint(this.baseUrl), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return res.ok;
    } catch { /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const { system, msgs } = this.splitSystem(messages);
    const result = await this.request(
      {
        model: this.model,
        max_tokens: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? 0.7,
        top_p: opts?.topP,
        stop_sequences: opts?.stop,
        system,
        messages: msgs,
      },
      {
        hasTools: false,
        streaming: false,
      },
    );
    const data = await this.parseJsonResponse<{ content: Array<{ type?: string; text?: string }> }>(
      result,
    );
    return data.content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('') ?? '';
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const { system, msgs } = this.splitSystem(messages);
    const result = await this.request(
      {
        model: this.model,
        max_tokens: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? 0.7,
        top_p: opts?.topP,
        stop_sequences: opts?.stop,
        system,
        messages: msgs,
        stream: true,
      },
      {
        hasTools: false,
        streaming: true,
      },
    );

    for await (const json of parseSseStream(result.response)) {
      const event = json as { type: string; delta?: { text?: string } };
      if (event.type === 'content_block_delta' && event.delta?.text) {
        yield event.delta.text;
      }
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private async request(
    body: Record<string, unknown>,
    options: { hasTools: boolean; streaming: boolean },
  ): Promise<ClaudeRequestResult> {
    const endpoint = buildClaudeMessagesEndpoint(this.baseUrl);
    const requestId = randomUUID();

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'X-Client-Request-Id': requestId,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw this.buildTransportError(error, endpoint, body, options);
    }

    if (!response.ok) {
      throw await this.buildHttpError(response, endpoint, body, requestId, options);
    }

    return {
      response,
      endpoint,
      requestBody: body,
      requestId,
      streaming: options.streaming,
      hasTools: options.hasTools,
    };
  }

  private splitSystem(messages: LLMMessage[]): {
    system: string | undefined;
    msgs: Array<{ role: string; content: unknown }>;
  } {
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const msgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          const content: unknown[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const tc of m.toolCalls) {
            content.push({ type: 'tool_use', id: tc.id, name: sanitizeClaudeToolName(tc.name), input: tc.arguments });
          }
          return { role: 'assistant', content };
        }
        return { role: m.role, content: m.content };
      });
    return { system: systemMsgs.map((m) => m.content).join('\n') || undefined, msgs };
  }

  private async parseJsonResponse<T>(result: ClaudeRequestResult): Promise<T> {
    const responseText = await result.response.text();
    const parsed = tryParseJson(responseText);
    if (parsed !== undefined) {
      return parsed as T;
    }

    throw this.buildInvalidJsonResponseError(result, responseText);
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<LLMCompletionResult> {
    const { system, msgs } = this.splitSystem(messages);
    const toolNameMap = new Map<string, string>();
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0.7,
      top_p: opts?.topP,
      stop_sequences: opts?.stop,
      system,
      messages: msgs,
    };

    if (opts?.tools?.length) {
      body.tools = opts.tools.map((t) => {
        const sanitized = sanitizeClaudeToolName(t.name);
        toolNameMap.set(sanitized, t.name);
        return {
          name: sanitized,
          description: t.description,
          input_schema: t.parameters,
        };
      });
      if (opts.toolChoice) {
        body.tool_choice =
          typeof opts.toolChoice === 'string'
            ? opts.toolChoice === 'auto'
              ? { type: 'auto' }
              : { type: 'none' }
            : { type: 'tool', name: sanitizeClaudeToolName(opts.toolChoice.name) };
      }
    }

    const result = await this.request(body, {
      hasTools: Boolean(opts?.tools?.length),
      streaming: false,
    });
    const data = await this.parseJsonResponse<{
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: string;
    }>(result);

    let content = '';
    let reasoning = '';
    const toolCalls: LLMToolCall[] = [];
    const blocks = Array.isArray(data.content) ? data.content : [];
    for (const block of blocks) {
      if (block.type === 'text') content += block.text ?? '';
      if (block.type === 'thinking') reasoning += (block as { thinking?: string }).thinking ?? '';
      if (block.type === 'tool_use') {
        const rawName = block.name ?? '';
        toolCalls.push({
          id: block.id!,
          name: toolNameMap.get(rawName) ?? rawName,
          arguments: block.input ?? {},
        });
      }
    }

    if (!content.trim() && toolCalls.length === 0 && !reasoning) {
      throw this.buildEmptyAssistantResponseError(result, data);
    }

    return {
      content,
      toolCalls,
      reasoning: reasoning || undefined,
      finishReason:
        data.stop_reason === 'tool_use'
          ? 'tool_calls'
          : data.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop',
    };
  }

  private async buildHttpError(
    response: Response,
    endpoint: string,
    requestBody: Record<string, unknown>,
    requestId: string,
    options: { hasTools: boolean; streaming: boolean },
  ): Promise<LucidError> {
    const responseText = await response.text();
    const responseBody = tryParseJson(responseText);
    const normalized = parseAdapterError({
      provider: this.name,
      status: response.status,
      error: responseBody ?? responseText ?? this.defaultStatusMessage(response.status),
    });
    const lucid = adapterErrorToLucidError(normalized);

    return new LucidError(resolveErrorCode(response.status, lucid.code), this.resolveErrorMessage(normalized.message, response.status), {
      retryable: normalized.retryable,
      retryAfter: normalized.retryAfter,
      providerCode: normalized.providerCode,
      status: response.status,
      statusText: response.statusText,
      endpoint,
      requestId,
      upstreamRequestId:
        response.headers.get('request-id')
        ?? response.headers.get('x-request-id')
        ?? undefined,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      streaming: options.streaming,
      hasTools: options.hasTools,
      ...measureRequestDiagnostics(requestBody),
      requestBody,
      responseText: responseText || undefined,
      responseBody,
    });
  }

  private buildTransportError(
    error: unknown,
    endpoint: string,
    requestBody: Record<string, unknown>,
    options: { hasTools: boolean; streaming: boolean },
  ): LucidError {
    const normalized = parseAdapterError({
      provider: this.name,
      error,
    });
    const lucid = adapterErrorToLucidError(normalized);

    return new LucidError(lucid.code, this.resolveErrorMessage(normalized.message, undefined), {
      retryable: normalized.retryable,
      retryAfter: normalized.retryAfter,
      providerCode: normalized.providerCode,
      endpoint,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      streaming: options.streaming,
      hasTools: options.hasTools,
      ...measureRequestDiagnostics(requestBody),
      requestBody,
      transportError: serializeError(error),
    });
  }

  private buildInvalidJsonResponseError(
    result: ClaudeRequestResult,
    responseText: string,
  ): LucidError {
    return new LucidError(ErrorCode.ServiceUnavailable, `${this.name} returned a non-JSON response`, {
      status: result.response.status,
      statusText: result.response.statusText,
      endpoint: result.endpoint,
      requestId: result.requestId,
      upstreamRequestId:
        result.response.headers.get('request-id')
        ?? result.response.headers.get('x-request-id')
        ?? undefined,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      streaming: result.streaming,
      hasTools: result.hasTools,
      contentType: result.response.headers.get('content-type') ?? undefined,
      responseBytes: Buffer.byteLength(responseText, 'utf8'),
      ...measureRequestDiagnostics(result.requestBody),
      requestBody: result.requestBody,
      responseText: responseText || undefined,
      responseTextSnippet: truncateForDiagnostics(responseText),
    });
  }

  private buildEmptyAssistantResponseError(
    result: ClaudeRequestResult,
    responseBody: Record<string, unknown>,
  ): LucidError {
    const content = Array.isArray(responseBody.content)
      ? responseBody.content.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      : [];
    const messageContentTypes = content
      .map((entry) => (typeof entry.type === 'string' ? entry.type : typeof entry))
      .filter((entry): entry is string => Boolean(entry));

    return new LucidError(
      ErrorCode.ServiceUnavailable,
      `${this.name} returned JSON without extractable assistant content`,
      {
        status: result.response.status,
        statusText: result.response.statusText,
        endpoint: result.endpoint,
        requestId: result.requestId,
        upstreamRequestId:
          result.response.headers.get('request-id')
          ?? result.response.headers.get('x-request-id')
          ?? undefined,
        provider: this.name,
        providerId: this.id,
        baseUrl: this.baseUrl,
        model: this.model,
        streaming: result.streaming,
        hasTools: result.hasTools,
        finishReason: typeof responseBody.stop_reason === 'string' ? responseBody.stop_reason : undefined,
        choiceCount: 1,
        toolCallCount: 0,
        responseKeys: Object.keys(responseBody),
        messageContentTypes,
        responseBody,
        ...measureRequestDiagnostics(result.requestBody),
        requestBody: result.requestBody,
      },
    );
  }

  private resolveErrorMessage(message: string, status: number | undefined): string {
    return message !== `${this.name} request failed` ? message : this.defaultStatusMessage(status);
  }

  private defaultStatusMessage(status: number | undefined): string {
    if (status === 401 || status === 403) {
      return 'Invalid Anthropic API key';
    }
    if (status === 429) {
      return 'Claude rate limited';
    }
    if (status === 404) {
      return 'Claude resource not found';
    }
    if (status === 400) {
      return 'Claude invalid request';
    }
    return `Claude error: ${status ?? 'request failed'}`;
  }
}
