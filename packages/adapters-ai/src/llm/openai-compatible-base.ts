import type {
  LLMAdapter,
  LLMMessage,
  LLMRequestOptions,
  LLMCompletionResult,
  LLMToolCall,
  Capability,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';

export interface OpenAICompatibleConfig {
  id: string;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
  capabilities?: Capability[];
}

/**
 * Base class for all OpenAI-compatible LLM adapters.
 * DeepSeek, Qwen, Grok, and OpenAI itself all share this chat/completions format.
 */
export class OpenAICompatibleLLM implements LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];

  protected apiKey = '';
  protected baseUrl: string;
  protected model: string;

  constructor(private readonly cfg: OpenAICompatibleConfig) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.baseUrl = cfg.defaultBaseUrl;
    this.model = cfg.defaultModel;
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
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const res = await this.request(messages, opts, false);
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const res = await this.request(messages, opts, true);
    const reader = res.body?.getReader();
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
    const res = await this.request(messages, opts, false);
    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason: string;
      }>;
    };

    const choice = data.choices[0];
    const toolCalls: LLMToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice?.message?.content ?? '',
      toolCalls,
      finishReason:
        choice?.finish_reason === 'tool_calls'
          ? 'tool_calls'
          : choice?.finish_reason === 'length'
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
  ): Promise<Response> {
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
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        return msg;
      }),
      temperature: opts?.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? 4096,
      top_p: opts?.topP,
      stop: opts?.stop,
      stream: streaming,
    };

    if (opts?.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      if (opts.toolChoice) {
        body.tool_choice =
          typeof opts.toolChoice === 'string'
            ? opts.toolChoice
            : { type: 'function', function: { name: opts.toolChoice.name } };
      }
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const status = res.status;
      if (status === 401)
        throw new LucidError(ErrorCode.AuthFailed, `Invalid ${this.name} API key`);
      if (status === 429)
        throw new LucidError(ErrorCode.RateLimited, `${this.name} rate limited`);
      throw new LucidError(ErrorCode.ServiceUnavailable, `${this.name} error: ${status}`);
    }
    return res;
  }
}
