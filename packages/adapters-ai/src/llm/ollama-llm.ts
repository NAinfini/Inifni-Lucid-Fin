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

export class OllamaLLMAdapter implements LLMAdapter {
  readonly id = 'ollama-local';
  readonly name = 'Ollama (Local)';
  readonly capabilities: Capability[] = [
    'text-generation',
    'script-expand',
    'scene-breakdown',
    'character-extract',
    'prompt-enhance',
  ];
  readonly profile: ProviderProfile;

  private baseUrl = 'http://localhost:11434';
  private model = 'llama3';

  constructor() {
    this.profile = {
      providerId: this.id,
      charsPerToken: 3.5,
      sanitizeToolNames: false,
      maxUtilization: 0.85,
      outputReserveTokens: 2048,
    };
  }

  configure(_apiKey: string, options?: Record<string, unknown>): void {
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch { /* network error — Ollama server unreachable, report as invalid */
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: opts?.temperature ?? 0.7,
          num_predict: opts?.maxTokens ?? 4096,
          top_p: opts?.topP,
          stop: opts?.stop,
        },
      }),
    });
    if (!res.ok) this.throwError(res.status);
    const data = (await res.json()) as { message: { content: string } };
    return data.message?.content ?? '';
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        options: {
          temperature: opts?.temperature ?? 0.7,
          num_predict: opts?.maxTokens ?? 4096,
          top_p: opts?.topP,
          stop: opts?.stop,
        },
      }),
    });
    if (!res.ok) this.throwError(res.status);

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
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          if (json.message?.content) yield json.message.content;
        } catch { /* malformed NDJSON line from Ollama stream — skip and continue */
          /* skip */
        }
      }
    }
  }

  private throwError(status: number): never {
    if (status === 404)
      throw new LucidError(ErrorCode.NotFound, `Ollama model "${this.model}" not found`);
    throw new LucidError(ErrorCode.ServiceUnavailable, `Ollama error: ${status}`);
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<LLMCompletionResult> {
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
      stream: false,
      options: {
        temperature: opts?.temperature ?? 0.7,
        num_predict: opts?.maxTokens ?? 4096,
        top_p: opts?.topP,
        stop: opts?.stop,
      },
    };

    if (opts?.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) this.throwError(res.status);

    const data = (await res.json()) as {
      message: {
        content?: string;
        tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
      };
      done_reason?: string;
    };

    const toolCalls: LLMToolCall[] = (data.message?.tool_calls ?? []).map((tc, i) => ({
      id: `ollama-tc-${i}`,
      name: tc.function.name,
      arguments: tc.function.arguments ?? {},
    }));

    return {
      content: data.message?.content ?? '',
      toolCalls,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }
}
