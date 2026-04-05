import type {
  LLMAdapter,
  LLMMessage,
  LLMRequestOptions,
  LLMCompletionResult,
  LLMToolCall,
  Capability,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';

export class ClaudeLLMAdapter implements LLMAdapter {
  readonly id = 'claude';
  readonly name = 'Anthropic Claude';
  readonly capabilities: Capability[] = [
    'text-generation',
    'script-expand',
    'scene-breakdown',
    'character-extract',
    'prompt-enhance',
  ];

  private apiKey = '';
  private baseUrl = 'https://api.anthropic.com';
  private model = 'claude-sonnet-4-6';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      // Send a minimal request to check key validity
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const { system, msgs } = this.splitSystem(messages);
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? 0.7,
        top_p: opts?.topP,
        stop_sequences: opts?.stop,
        system,
        messages: msgs,
      }),
    });
    if (!res.ok) this.throwError(res.status);
    const data = (await res.json()) as { content: Array<{ text: string }> };
    return data.content[0]?.text ?? '';
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const { system, msgs } = this.splitSystem(messages);
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts?.maxTokens ?? 4096,
        temperature: opts?.temperature ?? 0.7,
        top_p: opts?.topP,
        stop_sequences: opts?.stop,
        system,
        messages: msgs,
        stream: true,
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
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.slice(6)) as { type: string; delta?: { text?: string } };
          if (json.type === 'content_block_delta' && json.delta?.text) {
            yield json.delta.text;
          }
        } catch {
          /* skip */
        }
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
            content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
          }
          return { role: 'assistant', content };
        }
        return { role: m.role, content: m.content };
      });
    return { system: systemMsgs.map((m) => m.content).join('\n') || undefined, msgs };
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<LLMCompletionResult> {
    const { system, msgs } = this.splitSystem(messages);
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
      body.tools = opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      if (opts.toolChoice) {
        body.tool_choice =
          typeof opts.toolChoice === 'string'
            ? opts.toolChoice === 'auto'
              ? { type: 'auto' }
              : { type: 'none' }
            : { type: 'tool', name: opts.toolChoice.name };
      }
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) this.throwError(res.status);

    const data = (await res.json()) as {
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: string;
    };

    let content = '';
    const toolCalls: LLMToolCall[] = [];
    for (const block of data.content) {
      if (block.type === 'text') content += block.text ?? '';
      if (block.type === 'tool_use') {
        toolCalls.push({ id: block.id!, name: block.name!, arguments: block.input ?? {} });
      }
    }

    return {
      content,
      toolCalls,
      finishReason:
        data.stop_reason === 'tool_use'
          ? 'tool_calls'
          : data.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop',
    };
  }

  private throwError(status: number): never {
    if (status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Anthropic API key');
    if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Claude rate limited');
    throw new LucidError(ErrorCode.ServiceUnavailable, `Claude error: ${status}`);
  }
}
