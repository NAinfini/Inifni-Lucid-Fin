import { randomUUID } from 'node:crypto';
import type {
  LLMAdapter,
  LLMProviderAuthStyle,
  LLMMessage,
  LLMRequestOptions,
  LLMStreamEvent,
  LLMToolCall,
  Capability,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { ErrorCategory, ErrorCode, LucidError } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { fetchWithTimeout } from '../fetch-utils.js';
import { parseSseStream } from './sse-parser.js';
import { withStallTimeout } from './utils/stall-timeout.js';
import {
  tryParseJson,
  serializeError,
  measureRequestDiagnostics,
  truncateForDiagnostics,
  resolveErrorCode,
} from './llm-error-builder.js';

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

/** Extract a reasoning_content value that may be a string or an array of text objects. */
function extractReasoningContent(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value) {
      if (typeof entry === 'string') { parts.push(entry); continue; }
      if (isRecord(entry)) {
        const text = readTextValue(entry.text);
        if (text) parts.push(text);
      }
    }
    const joined = parts.join('\n').trim();
    if (joined) return joined;
  }
  return undefined;
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
  } catch { /* malformed URL — return stripped string as-is */
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
  } catch { /* malformed URL — return the single non-parsed candidate */
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
  readonly profile: ProviderProfile;
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
    const isReasoning = usesOpenAIReasoningChatCompatibility(cfg.defaultModel);
    this.profile = {
      providerId: cfg.id,
      charsPerToken: 4.0,
      sanitizeToolNames: true,
      maxUtilization: isReasoning ? 0.80 : 0.95,
      outputReserveTokens: isReasoning ? 8192 : 4096,
      reasoningModel: isReasoning,
    };
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
          this.tryExtractContextWindow(res).catch(() => { /* best-effort context window detection */ });
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
      } catch { /* network error — continue to the next candidate base URL before declaring failure */
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
    } catch { /* models response unreadable — context window discovery is best-effort */
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
    for await (const json of parseSseStream(result.response)) {
      const chunk = (json as { choices: Array<{ delta: { content?: string } }> })
        .choices?.[0]?.delta?.content;
      if (chunk) yield chunk;
    }
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<AsyncIterable<LLMStreamEvent>> {
    const toolNameMap = new Map<string, string>(
      (opts?.tools ?? []).map((t) => [t.name.replace(/\./g, '_'), t.name]),
    );

    // Request with `stream:true` — most OpenAI-compatible providers honor
    // this for tool calls as well. Servers that don't stream simply return
    // JSON with a different content-type; we detect that below and use the
    // non-streaming parser.
    const requestResult = await this.request(messages, opts, true);

    const contentType = requestResult.response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/event-stream')) {
      return this.oneShotFromResponse(requestResult, toolNameMap);
    }

    return this.streamEvents(requestResult.response, toolNameMap, messages, opts);
  }

  /**
   * Parse a non-streaming JSON response body into the LLMStreamEvent
   * sequence. Used when the server ignores `stream:true` and returns a
   * plain JSON chat-completion object (common with OpenAI-compat proxies
   * and with tool-call requests).
   */
  private async *oneShotFromResponse(
    result: OpenAIRequestResult,
    toolNameMap: Map<string, string>,
  ): AsyncIterable<LLMStreamEvent> {
    const data = await this.parseJsonResponse<Record<string, unknown>>(result);
    const raw = isRecord(data) ? data : {};
    const choice = Array.isArray(raw.choices) && isRecord(raw.choices[0]) ? raw.choices[0] : undefined;
    const extractedContent = this.extractAssistantText(raw, choice);

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

    const reasoning =
      extractReasoningContent(message ? (message as Record<string, unknown>).reasoning : undefined) ??
      extractReasoningContent(message?.reasoning_content) ??
      extractReasoningContent(choice?.reasoning_content);

    const finishReasonRaw = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;

    if (!extractedContent && toolCalls.length === 0 && !reasoning) {
      throw this.buildEmptyAssistantResponseError(result, raw, finishReasonRaw, toolCalls.length);
    }

    if (reasoning) yield { kind: 'reasoning_delta', delta: reasoning };
    if (extractedContent) yield { kind: 'text_delta', delta: extractedContent };
    for (const tc of toolCalls) {
      yield { kind: 'tool_call_started', id: tc.id, name: tc.name };
      yield { kind: 'tool_call_args_delta', id: tc.id, delta: JSON.stringify(tc.arguments) };
      yield { kind: 'tool_call_complete', id: tc.id, name: tc.name, arguments: tc.arguments };
    }

    const usage = isRecord(raw.usage) ? raw.usage : undefined;
    if (usage) {
      const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : undefined;
      yield {
        kind: 'usage',
        promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
        completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
        reasoningTokens: typeof details?.reasoning_tokens === 'number' ? details.reasoning_tokens : undefined,
      };
    }

    yield {
      kind: 'finished',
      finishReason:
        finishReasonRaw === 'tool_calls'
          ? 'tool_calls'
          : finishReasonRaw === 'length'
            ? 'length'
            : toolCalls.length > 0
              ? 'tool_calls'
              : 'stop',
    };
  }

  /**
   * Consume the SSE stream and yield LLMStreamEvents in real time.
   * - `choices[0].delta.content` → text_delta
   * - `choices[0].delta.reasoning_content` / `reasoning` → reasoning_delta
   * - `choices[0].delta.tool_calls[i].function.{name, arguments}` → tool_call_started + tool_call_args_delta
   * - `choices[0].finish_reason` → finished
   * - `usage` → usage
   */
  private async *streamEvents(
    response: Response,
    toolNameMap: Map<string, string>,
    messages: LLMMessage[],
    opts: LLMRequestOptions | undefined,
  ): AsyncIterable<LLMStreamEvent> {
    interface ToolAccum {
      id: string;
      originalName: string;
      argBuffer: string;
      started: boolean;
      argsEmittedLen: number;
    }
    const toolsByIndex = new Map<number, ToolAccum>();
    let anyTextEmitted = false;
    let anyReasoningEmitted = false;
    let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
    let sawFinish = false;
    let usagePromptTokens: number | undefined;
    let usageCompletionTokens: number | undefined;
    let usageReasoningTokens: number | undefined;

    try {
      for await (const json of withStallTimeout(parseSseStream(response), {
        stallMs: 20_000,
        signal: opts?.signal,
        adapterName: this.name,
      })) {
        if (opts?.signal?.aborted) break;
        if (!isRecord(json)) continue;

        const choices = Array.isArray(json.choices) ? json.choices : [];
        const choice = isRecord(choices[0]) ? choices[0] : undefined;
        const delta = isRecord(choice?.delta) ? choice.delta : undefined;

        if (delta) {
          const contentDelta = typeof delta.content === 'string' ? delta.content : '';
          if (contentDelta) {
            anyTextEmitted = true;
            yield { kind: 'text_delta', delta: contentDelta };
          }

          const reasoningDelta =
            typeof delta.reasoning_content === 'string'
              ? delta.reasoning_content
              : typeof delta.reasoning === 'string'
                ? delta.reasoning
                : '';
          if (reasoningDelta) {
            anyReasoningEmitted = true;
            yield { kind: 'reasoning_delta', delta: reasoningDelta };
          }

          const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
          for (const tc of toolCalls) {
            if (!isRecord(tc)) continue;
            const idx = typeof tc.index === 'number' ? tc.index : 0;
            let accum = toolsByIndex.get(idx);
            if (!accum) {
              accum = {
                id: typeof tc.id === 'string' ? tc.id : `tool-call-${idx}`,
                originalName: '',
                argBuffer: '',
                started: false,
                argsEmittedLen: 0,
              };
              toolsByIndex.set(idx, accum);
            }
            if (typeof tc.id === 'string' && tc.id) accum.id = tc.id;

            const fn = isRecord(tc.function) ? tc.function : undefined;
            if (fn) {
              if (typeof fn.name === 'string' && fn.name) {
                accum.originalName = toolNameMap.get(fn.name) ?? fn.name;
              }
              if (typeof fn.arguments === 'string' && fn.arguments) {
                accum.argBuffer += fn.arguments;
              }
            }

            if (!accum.started && accum.originalName) {
              accum.started = true;
              yield { kind: 'tool_call_started', id: accum.id, name: accum.originalName };
            }

            if (accum.started && accum.argBuffer.length > accum.argsEmittedLen) {
              const pending = accum.argBuffer.slice(accum.argsEmittedLen);
              accum.argsEmittedLen = accum.argBuffer.length;
              yield { kind: 'tool_call_args_delta', id: accum.id, delta: pending };
            }
          }
        }

        if (choice && typeof choice.finish_reason === 'string') {
          const reason = choice.finish_reason;
          finishReason =
            reason === 'tool_calls'
              ? 'tool_calls'
              : reason === 'length'
                ? 'length'
                : 'stop';
          sawFinish = true;
        }

        const usage = isRecord(json.usage) ? json.usage : undefined;
        if (usage) {
          if (typeof usage.prompt_tokens === 'number') usagePromptTokens = usage.prompt_tokens;
          if (typeof usage.completion_tokens === 'number') usageCompletionTokens = usage.completion_tokens;
          const details = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : undefined;
          if (details && typeof details.reasoning_tokens === 'number') {
            usageReasoningTokens = details.reasoning_tokens;
          }
        }
      }
    } catch (err) {
      yield {
        kind: 'finished',
        finishReason: 'error',
      };
      throw err;
    }

    // Finalize each streamed tool call with the parsed arguments.
    const collectedToolCalls: LLMToolCall[] = [];
    const sortedAccums = Array.from(toolsByIndex.entries()).sort((a, b) => a[0] - b[0]);
    for (const [, accum] of sortedAccums) {
      if (!accum.started) continue;
      let args: Record<string, unknown> = {};
      const trimmed = accum.argBuffer.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          args = isRecord(parsed) ? parsed : {};
        } catch {
          args = { raw: accum.argBuffer };
        }
      }
      collectedToolCalls.push({ id: accum.id, name: accum.originalName, arguments: args });
      yield {
        kind: 'tool_call_complete',
        id: accum.id,
        name: accum.originalName,
        arguments: args,
      };
    }

    if (usagePromptTokens !== undefined || usageCompletionTokens !== undefined || usageReasoningTokens !== undefined) {
      yield {
        kind: 'usage',
        promptTokens: usagePromptTokens,
        completionTokens: usageCompletionTokens,
        reasoningTokens: usageReasoningTokens,
      };
    }

    // If the stream produced nothing at all AND we asked for tools, retry
    // without tools (mirrors the legacy non-streaming salvage path).
    if (!anyTextEmitted && !anyReasoningEmitted && collectedToolCalls.length === 0 && finishReason === 'stop' && opts?.tools?.length) {
      let salvageContent = '';
      try {
        for await (const chunk of this.stream(messages, { ...opts, tools: undefined, toolChoice: undefined })) {
          if (chunk) {
            anyTextEmitted = true;
            salvageContent += chunk;
            yield { kind: 'text_delta', delta: chunk };
          }
        }
      } catch {
        // salvage attempt failed — fall through to the empty-response error
      }
      if (!salvageContent) {
        // Stream AND fallback both empty — surface as a typed error so
        // callers can distinguish "model had nothing to say" from a
        // transient upstream issue.
        throw new LucidError(
          ErrorCode.ServiceUnavailable,
          `${this.name} returned JSON without extractable assistant content`,
          {
            endpoint: `${this.baseUrl}/chat/completions`,
            provider: this.name,
            providerId: this.id,
            baseUrl: this.baseUrl,
            model: this.model,
            streaming: true,
            hasTools: true,
            finishReason,
            toolCallCount: 0,
            requestBody: { stream: true, tools: opts.tools },
          },
        );
      }
    }

    const effectiveFinish: LLMStreamEvent & { kind: 'finished' } = {
      kind: 'finished',
      finishReason: collectedToolCalls.length > 0 ? 'tool_calls' : sawFinish ? finishReason : 'stop',
    };
    yield effectiveFinish;
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
          timeoutMs: 300_000, // 5 min — tool-calling requests with large context can take several minutes
          signal: opts?.signal,
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
      ...measureRequestDiagnostics(body),
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
    const responseBody = tryParseJson(responseText);
    const requestDiagnostics = measureRequestDiagnostics(requestBody);
    // When the response is HTML (e.g. Cloudflare error pages), don't use it as the
    // error message -- it produces unreadable log spam and broken UI. Fall through to
    // the defaultStatusMessage instead.
    const isHtml = responseText.trimStart().startsWith('<!') || responseText.trimStart().startsWith('<html');
    const errorInput = isHtml ? undefined : (responseBody ?? responseText);
    const normalized = parseAdapterError({
      provider: this.name,
      status: res.status,
      error: errorInput ?? this.defaultStatusMessage(res.status),
    });
    const lucid = adapterErrorToLucidError(normalized);

    return new LucidError(resolveErrorCode(res.status, lucid.code), this.resolveErrorMessage(normalized.message, res.status), {
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
      // Never store raw HTML in error details -- truncate to a short snippet for diagnostics
      responseText: isHtml ? responseText.slice(0, 200) + '... (HTML truncated)' : (responseText || undefined),
      responseBody,
    });
  }

  private async parseJsonResponse<T>(result: OpenAIRequestResult): Promise<T> {
    const responseText = await result.response.text();
    const parsed = tryParseJson(responseText);
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
    const transportError = serializeError(error);
    const requestDiagnostics = measureRequestDiagnostics(requestBody);

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
    const requestDiagnostics = measureRequestDiagnostics(result.requestBody);

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
      responseTextSnippet: truncateForDiagnostics(responseText),
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
        ...measureRequestDiagnostics(result.requestBody),
        requestBody: result.requestBody,
      },
    );
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

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }
}
