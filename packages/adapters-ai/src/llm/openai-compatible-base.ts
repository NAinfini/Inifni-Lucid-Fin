import { randomUUID } from 'node:crypto';
import type {
  LLMAdapter,
  LLMProviderAuthStyle,
  LLMMessage,
  LLMRequestOptions,
  LLMCompletionResult,
  LLMToolCall,
  Capability,
} from '@lucid-fin/contracts';
import { ErrorCategory, ErrorCode, LucidError } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { fetchWithTimeout } from '../fetch-utils.js';

export interface OpenAICompatibleConfig {
  id: string;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
  authStyle?: LLMProviderAuthStyle;
  capabilities?: Capability[];
}

interface OpenAIRequestResult {
  response: Response;
  endpoint: string;
  requestBody: Record<string, unknown>;
  requestId: string;
  streaming: boolean;
  hasTools: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value) && typeof value.value === 'string') {
    return value.value;
  }
  return '';
}

function joinNonEmpty(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('');
}

function extractContentText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return joinNonEmpty(value.map((entry) => extractContentText(entry)));
  }

  if (!isRecord(value)) {
    return '';
  }

  const type = typeof value.type === 'string' ? value.type : undefined;
  const directText = readTextValue(value.text);
  if (directText && (!type || type === 'text' || type === 'output_text' || type === 'input_text')) {
    return directText;
  }

  if (typeof value.output_text === 'string') {
    return value.output_text;
  }

  if (Array.isArray(value.parts)) {
    return joinNonEmpty(value.parts.map((entry) => extractContentText(entry)));
  }

  if (Array.isArray(value.content)) {
    return joinNonEmpty(value.content.map((entry) => extractContentText(entry)));
  }

  return '';
}

function stringifyUrl(url: URL): string {
  const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.origin}${pathname}${url.search}${url.hash}`;
}

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed.replace(/\/+$/, '');
  }

  const normalizedPath = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');

  parsed.pathname = normalizedPath || '/';
  return stringifyUrl(parsed);
}

function buildOpenAICompatibleBaseUrlCandidates(baseUrl: string): string[] {
  const normalized = normalizeOpenAICompatibleBaseUrl(baseUrl);
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);

  try {
    const parsed = new URL(normalized);
    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = '/v1';
      candidates.add(stringifyUrl(parsed));
    }
  } catch {
    return [normalized];
  }

  return Array.from(candidates);
}

function usesOpenAIReasoningChatCompatibility(model: string): boolean {
  return /^(gpt-5|o1|o3|o4)/i.test(model.trim());
}

/**
 * Base class for all OpenAI-compatible LLM adapters.
 * DeepSeek, Qwen, Grok, and OpenAI itself all share this chat/completions format.
 */
export class OpenAICompatibleLLM implements LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];
  /** Auto-detected from /models endpoint. */
  contextWindow?: number;
  /** User-configured override, always takes priority. */
  userContextWindow?: number;
  /** Effective context window: user override if set, else auto-detected. */
  get effectiveContextWindow(): number | undefined {
    return this.userContextWindow ?? this.contextWindow;
  }

  protected apiKey = '';
  protected baseUrl: string;
  protected model: string;
  protected authStyle: LLMProviderAuthStyle;

  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.baseUrl = normalizeOpenAICompatibleBaseUrl(cfg.defaultBaseUrl);
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
    if (options?.baseUrl) this.baseUrl = normalizeOpenAICompatibleBaseUrl(options.baseUrl as string);
    if (options?.model) this.model = options.model as string;
    if (typeof options?.contextWindow === 'number' && options.contextWindow > 0) {
      this.userContextWindow = options.contextWindow as number;
    }
  }

  async validate(): Promise<boolean> {
    const candidates = this.getBaseUrlCandidates();

    for (const candidate of candidates) {
      try {
        const res = await fetchWithTimeout(`${candidate}/models`, {
          headers: this.authHeaders(),
          timeoutMs: 10_000,
        });
        if (res.ok) {
          this.baseUrl = candidate;
          this.tryExtractContextWindow(res).catch(() => {});
          return true;
        }

      const fallback = await fetchWithTimeout(`${candidate}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.authHeaders(),
          },
          body: JSON.stringify(
            usesOpenAIReasoningChatCompatibility(this.model)
              ? {
                  model: this.model,
                  messages: [{ role: 'user', content: 'hi' }],
                  max_completion_tokens: 1,
                }
              : {
                  model: this.model,
                  messages: [{ role: 'user', content: 'hi' }],
                  max_tokens: 1,
                },
          ),
          timeoutMs: 10_000,
        });
        if (fallback.ok) {
          this.baseUrl = candidate;
          return true;
        }
      } catch {
        // Continue to the next candidate base URL before declaring failure.
      }
    }

    return false;
  }

  /**
   * Parse the /models response to find the current model's context window.
   * Supports OpenAI (`context_window`), LiteLLM/OneAPI (`context_length`),
   * and `max_model_len` (vLLM).
   */
  private async tryExtractContextWindow(modelsResponse: Response): Promise<void> {
    try {
      const body = await modelsResponse.json() as Record<string, unknown>;
      const models = Array.isArray(body.data) ? body.data : Array.isArray(body) ? body : [];
      const modelId = this.model.toLowerCase();

      for (const entry of models) {
        if (!isRecord(entry)) continue;
        const id = typeof entry.id === 'string' ? entry.id.toLowerCase() : '';
        if (id !== modelId) continue;

        const ctxWindow = entry.context_window ?? entry.context_length ?? entry.max_model_len;
        if (typeof ctxWindow === 'number' && ctxWindow > 0) {
          this.contextWindow = ctxWindow;
        }
        break;
      }
    } catch {
      // Non-critical — context window discovery is best-effort
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const result = await this.request(messages, opts, false);
    const data = await this.parseJsonResponse<Record<string, unknown>>(result);
    const choice = Array.isArray(data.choices) ? (data.choices[0] as Record<string, unknown> | undefined) : undefined;
    return this.extractAssistantText(data, choice);
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const result = await this.request(messages, opts, true);
    const reader = result.response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
        try {
          const json = JSON.parse(line.slice(6)) as {
            choices: Array<{ delta: { content?: string } }>;
          };
          const chunk = json.choices[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch {
          /* skip malformed */
        }
      }
    }
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<LLMCompletionResult> {
    const result = await this.request(messages, opts, false);
    const data = await this.parseJsonResponse<Record<string, unknown>>(result);
    const raw = isRecord(data) ? data : {};
    const choice = Array.isArray(raw.choices) && isRecord(raw.choices[0]) ? raw.choices[0] : undefined;
    const extractedContent = this.extractAssistantText(raw, choice);

    const toolNameMap = new Map<string, string>(
      (opts?.tools ?? []).map((t) => [t.name.replace(/\./g, '_'), t.name]),
    );
    const message = isRecord(choice?.message) ? choice.message : undefined;
    const rawToolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const toolCalls: LLMToolCall[] = rawToolCalls
      .filter((toolCall): toolCall is Record<string, unknown> => isRecord(toolCall))
      .map((toolCall, index) => {
        const fn = isRecord(toolCall.function) ? toolCall.function : undefined;
        const rawName = typeof fn?.name === 'string' ? fn.name : `tool_${index}`;
        const rawArguments = fn?.arguments;
        let parsedArguments: Record<string, unknown> = {};

        if (typeof rawArguments === 'string' && rawArguments.trim()) {
          try {
            const parsedCandidate = JSON.parse(rawArguments) as unknown;
            parsedArguments = isRecord(parsedCandidate) ? parsedCandidate : {};
          } catch {
            parsedArguments = { raw: rawArguments };
          }
        } else if (isRecord(rawArguments)) {
          parsedArguments = rawArguments;
        }

        return {
          id: typeof toolCall.id === 'string' ? toolCall.id : `tool-call-${index}`,
          name: toolNameMap.get(rawName) ?? rawName,
          arguments: parsedArguments,
        };
      });

    const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;

    if (!extractedContent && toolCalls.length === 0 && finishReason === 'stop' && opts?.tools?.length) {
      let streamedContent = '';
      for await (const chunk of this.stream(messages, { ...opts, tools: undefined, toolChoice: undefined })) {
        streamedContent += chunk;
      }
      if (streamedContent) {
        return { content: streamedContent, toolCalls: [], finishReason: 'stop' };
      }
    }

    if (!extractedContent && toolCalls.length === 0) {
      throw this.buildEmptyAssistantResponseError(result, raw, finishReason, toolCalls.length);
    }

    return {
      content: extractedContent,
      toolCalls,
      finishReason:
        finishReason === 'tool_calls'
          ? 'tool_calls'
          : finishReason === 'length'
            ? 'length'
            : toolCalls.length > 0
              ? 'tool_calls'
              : 'stop',
    };
  }

  protected async request(
    messages: LLMMessage[],
    opts: LLMRequestOptions | undefined,
    streaming: boolean,
  ): Promise<OpenAIRequestResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        }
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name.replace(/\./g, '_'), arguments: JSON.stringify(tc.arguments) },
          }));
        }
        return msg;
      }),
      stream: streaming,
    };
    const usesReasoningCompatibility = usesOpenAIReasoningChatCompatibility(this.model);
    if (usesReasoningCompatibility) {
      body.max_completion_tokens = opts?.maxTokens ?? 4096;
    } else {
      body.max_tokens = opts?.maxTokens ?? 4096;
      body.temperature = opts?.temperature ?? 0.7;
      if (opts?.topP !== undefined) body.top_p = opts.topP;
    }
    if (opts?.stop !== undefined) body.stop = opts.stop;

    // OpenAI-compatible APIs require tool names matching ^[a-zA-Z0-9_-]+$
    // Build a reverse map from sanitized name → original name for response parsing
    const toolNameMap = new Map<string, string>();
    if (opts?.tools?.length) {
      body.tools = opts.tools.map((t) => {
        const sanitized = t.name.replace(/\./g, '_');
        toolNameMap.set(sanitized, t.name);
        return { type: 'function', function: { name: sanitized, description: t.description, parameters: t.parameters } };
      });
      if (opts.toolChoice) {
        body.tool_choice =
          typeof opts.toolChoice === 'string'
            ? opts.toolChoice
            : { type: 'function', function: { name: opts.toolChoice.name.replace(/\./g, '_') } };
      }
    }

    const hasTools = Boolean(opts?.tools?.length);
    const candidates = this.getBaseUrlCandidates();
    let lastTransportError: LucidError | undefined;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      const endpoint = `${candidate}/chat/completions`;
      const requestId = randomUUID();
      const headers = {
        'Content-Type': 'application/json',
        'X-Client-Request-Id': requestId,
        ...this.authHeaders(),
      };

      let res: Response;
      try {
        res = await fetchWithTimeout(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (error) {
        lastTransportError = this.buildTransportError(
          error,
          endpoint,
          body,
          streaming,
          hasTools,
          requestId,
        );
        continue;
      }

      if (!res.ok) {
        if (index < candidates.length - 1 && this.shouldTryAlternateCandidate(res)) {
          continue;
        }
        throw await this.buildHttpError(res, endpoint, body, streaming, hasTools, requestId);
      }

      if (index < candidates.length - 1 && this.isLikelyHtmlResponse(res)) {
        continue;
      }

      this.baseUrl = candidate;
      return {
        response: res,
        endpoint,
        requestBody: body,
        requestId,
        streaming,
        hasTools,
      };
    }

    if (lastTransportError) {
      throw lastTransportError;
    }

    const endpoint = `${this.baseUrl}/chat/completions`;
    const requestId = randomUUID();
    throw new LucidError(ErrorCode.ServiceUnavailable, `${this.name} request failed`, {
      endpoint,
      requestId,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      authStyle: this.authStyle,
      streaming,
      hasTools,
      ...this.measureRequestDiagnostics(body),
      requestBody: body,
    });
  }

  protected authHeaders(): Record<string, string> {
    switch (this.authStyle) {
      case 'none':
        return {};
      case 'x-api-key':
        return { 'x-api-key': this.apiKey };
      case 'x-goog-api-key':
        return { 'x-goog-api-key': this.apiKey };
      case 'bearer':
      default:
        return {
          Authorization: `Bearer ${this.apiKey}`,
        };
    }
  }

  private async buildHttpError(
    res: Response,
    endpoint: string,
    requestBody: Record<string, unknown>,
    streaming: boolean,
    hasTools: boolean,
    requestId: string,
  ): Promise<LucidError> {
    const responseText = await res.text();
    const responseBody = this.tryParseJson(responseText);
    const requestDiagnostics = this.measureRequestDiagnostics(requestBody);
    const normalized = parseAdapterError({
      provider: this.name,
      status: res.status,
      error: responseBody ?? responseText ?? this.defaultStatusMessage(res.status),
    });
    const lucid = adapterErrorToLucidError(normalized);

    return new LucidError(this.resolveErrorCode(res.status, lucid.code), this.resolveErrorMessage(normalized.message, res.status), {
      retryable: normalized.retryable,
      retryAfter: normalized.retryAfter,
      providerCode: normalized.providerCode,
      status: res.status,
      statusText: res.statusText,
      endpoint,
      requestId,
      upstreamRequestId: res.headers.get('x-request-id') ?? undefined,
      upstreamTraceId: res.headers.get('x-trace-id') ?? res.headers.get('trace-id') ?? undefined,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      authStyle: this.authStyle,
      streaming,
      hasTools,
      ...requestDiagnostics,
      requestBody,
      responseText: responseText || undefined,
      responseBody,
    });
  }

  private async parseJsonResponse<T>(result: OpenAIRequestResult): Promise<T> {
    const responseText = await result.response.text();
    const parsed = this.tryParseJson(responseText);
    if (parsed !== undefined) {
      return parsed as T;
    }

    throw this.buildInvalidJsonResponseError(result, responseText);
  }

  private buildTransportError(
    error: unknown,
    endpoint: string,
    requestBody: Record<string, unknown>,
    streaming: boolean,
    hasTools: boolean,
    requestId: string,
  ): LucidError {
    const normalized = parseAdapterError({
      provider: this.name,
      error,
      fallbackCategory: this.isAbortError(error) ? ErrorCategory.Timeout : ErrorCategory.ServiceError,
    });
    const lucid = adapterErrorToLucidError(normalized);
    const transportError = this.serializeError(error);
    const requestDiagnostics = this.measureRequestDiagnostics(requestBody);

    return new LucidError(lucid.code, this.resolveErrorMessage(normalized.message, undefined), {
      retryable: normalized.retryable,
      retryAfter: normalized.retryAfter,
      providerCode: normalized.providerCode,
      endpoint,
      requestId,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      authStyle: this.authStyle,
      streaming,
      hasTools,
      ...requestDiagnostics,
      requestBody,
      transportError,
    });
  }

  private buildInvalidJsonResponseError(
    result: OpenAIRequestResult,
    responseText: string,
  ): LucidError {
    const contentType = result.response.headers.get('content-type') ?? undefined;
    const requestDiagnostics = this.measureRequestDiagnostics(result.requestBody);

    return new LucidError(ErrorCode.ServiceUnavailable, `${this.name} returned a non-JSON response`, {
      status: result.response.status,
      statusText: result.response.statusText,
      endpoint: result.endpoint,
      requestId: result.requestId,
      upstreamRequestId: result.response.headers.get('x-request-id') ?? undefined,
      upstreamTraceId:
        result.response.headers.get('x-trace-id') ?? result.response.headers.get('trace-id') ?? undefined,
      provider: this.name,
      providerId: this.id,
      baseUrl: this.baseUrl,
      model: this.model,
      authStyle: this.authStyle,
      streaming: result.streaming,
      hasTools: result.hasTools,
      contentType,
      responseBytes: Buffer.byteLength(responseText, 'utf8'),
      ...requestDiagnostics,
      requestBody: result.requestBody,
      responseText: responseText || undefined,
      responseTextSnippet: this.truncateForDiagnostics(responseText),
    });
  }

  private extractAssistantText(
    raw: Record<string, unknown>,
    choice: Record<string, unknown> | undefined,
  ): string {
    const message = isRecord(choice?.message) ? choice.message : undefined;
    const candidates = [
      message?.content,
      message?.output_text,
      choice?.text,
      raw.output_text,
      isRecord(raw.response) ? raw.response.output_text : undefined,
      isRecord(raw.data) ? raw.data.output_text : undefined,
      raw.output,
      raw.response,
      raw.data,
    ];

    for (const candidate of candidates) {
      const text = extractContentText(candidate).trim();
      if (text) {
        return text;
      }
    }

    return '';
  }

  private buildEmptyAssistantResponseError(
    result: OpenAIRequestResult,
    responseBody: Record<string, unknown>,
    finishReason: unknown,
    toolCallCount: number,
  ): LucidError {
    const choice = Array.isArray(responseBody.choices) && isRecord(responseBody.choices[0])
      ? responseBody.choices[0]
      : undefined;
    const message = isRecord(choice?.message) ? choice.message : undefined;
    const messageContentTypes = Array.isArray(message?.content)
      ? message.content
          .map((entry) => (isRecord(entry) && typeof entry.type === 'string' ? entry.type : typeof entry))
          .filter((entry): entry is string => Boolean(entry))
      : [];

    return new LucidError(
      ErrorCode.ServiceUnavailable,
      `${this.name} returned JSON without extractable assistant content`,
      {
        status: result.response.status,
        statusText: result.response.statusText,
        endpoint: result.endpoint,
        requestId: result.requestId,
        upstreamRequestId: result.response.headers.get('x-request-id') ?? undefined,
        upstreamTraceId:
          result.response.headers.get('x-trace-id') ?? result.response.headers.get('trace-id') ?? undefined,
        provider: this.name,
        providerId: this.id,
        baseUrl: this.baseUrl,
        model: this.model,
        authStyle: this.authStyle,
        streaming: result.streaming,
        hasTools: result.hasTools,
        finishReason: typeof finishReason === 'string' ? finishReason : undefined,
        choiceCount: Array.isArray(responseBody.choices) ? responseBody.choices.length : 0,
        toolCallCount,
        responseKeys: Object.keys(responseBody),
        choiceKeys: choice ? Object.keys(choice) : [],
        messageKeys: message ? Object.keys(message) : [],
        messageContentTypes,
        responseBody,
        ...this.measureRequestDiagnostics(result.requestBody),
        requestBody: result.requestBody,
      },
    );
  }

  private resolveErrorCode(status: number, fallback: ErrorCode): ErrorCode {
    if (status === 404) {
      return ErrorCode.NotFound;
    }
    return fallback;
  }

  private resolveErrorMessage(message: string, status: number | undefined): string {
    if (message !== `${this.name} request failed`) {
      return message;
    }
    return this.defaultStatusMessage(status);
  }

  private getBaseUrlCandidates(): string[] {
    const candidates = buildOpenAICompatibleBaseUrlCandidates(this.baseUrl);
    return candidates.length > 0 ? candidates : [this.baseUrl];
  }

  private shouldTryAlternateCandidate(response: Response): boolean {
    return response.status === 404 || response.status === 405 || this.isLikelyHtmlResponse(response);
  }

  private isLikelyHtmlResponse(response: Response): boolean {
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    return contentType.includes('text/html');
  }

  private defaultStatusMessage(status: number | undefined): string {
    if (status === 401) {
      return `Invalid ${this.name} API key`;
    }
    if (status === 429) {
      return `${this.name} rate limited`;
    }
    if (status === 404) {
      return `${this.name} resource not found`;
    }
    return `${this.name} error: ${status ?? 'request failed'}`;
  }

  private tryParseJson(value: string): unknown {
    if (!value.trim()) {
      return undefined;
    }

    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  private serializeError(error: unknown): Record<string, unknown> | string {
    if (error instanceof Error) {
      const serialized: Record<string, unknown> = {
        name: error.name,
        message: error.message,
      };
      if (error.stack) {
        serialized.stack = error.stack;
      }
      return serialized;
    }
    return typeof error === 'string' ? error : JSON.stringify(error);
  }

  private measureRequestDiagnostics(requestBody: Record<string, unknown>): Record<string, unknown> {
    const messages = Array.isArray(requestBody.messages)
      ? requestBody.messages as Array<Record<string, unknown>>
      : [];
    const tools = Array.isArray(requestBody.tools)
      ? requestBody.tools as Array<Record<string, unknown>>
      : [];
    const systemPromptChars = messages
      .filter((message) => message.role === 'system' && typeof message.content === 'string')
      .reduce((sum, message) => sum + String(message.content).length, 0);

    return {
      requestBytes: Buffer.byteLength(JSON.stringify(requestBody), 'utf8'),
      messageCount: messages.length,
      toolCount: tools.length,
      systemPromptChars,
    };
  }

  private truncateForDiagnostics(value: string, maxChars = 4000): string {
    if (value.length <= maxChars) {
      return value;
    }
    return `${value.slice(0, maxChars)}...`;
  }
}
