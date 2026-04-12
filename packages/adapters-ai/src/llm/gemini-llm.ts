import type {
  LLMAdapter,
  LLMMessage,
  LLMRequestOptions,
  LLMCompletionResult,
  LLMToolCall,
  Capability,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';

type GeminiAdapterConfig = {
  id?: string;
  name?: string;
  defaultBaseUrl?: string;
  defaultModel?: string;
};

export class GeminiLLMAdapter implements LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[] = [
    'text-generation',
    'script-expand',
    'scene-breakdown',
    'character-extract',
    'prompt-enhance',
  ];

  private apiKey = '';
  private baseUrl: string;
  private model: string;

  constructor(cfg: GeminiAdapterConfig = {}) {
    this.id = cfg.id ?? 'gemini';
    this.name = cfg.name ?? 'Google Gemini';
    this.baseUrl = cfg.defaultBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    this.model = cfg.defaultModel ?? 'gemini-2.5-flash';
  }

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models?key=${this.apiKey}`);
      return res.ok;
    } catch { /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string> {
    const body = this.buildBody(messages, opts);
    const res = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) this.throwError(res.status);
    const data = (await res.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  async *stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string> {
    const body = this.buildBody(messages, opts);
    const res = await fetch(
      `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
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
          const json = JSON.parse(line.slice(6)) as {
            candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
          };
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) yield text;
        } catch { /* malformed SSE line — skip and continue streaming */
          /* skip */
        }
      }
    }
  }

  private buildBody(messages: LLMMessage[], opts?: LLMRequestOptions): Record<string, unknown> {
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [{ functionResponse: { name: m.toolCallId ?? '', response: { content: m.content } } }],
          };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          const parts: unknown[] = [];
          if (m.content) parts.push({ text: m.content });
          for (const tc of m.toolCalls) {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
          return { role: 'model', parts };
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        };
      });

    const body: Record<string, unknown> = {
      ...(systemMsgs.length > 0 && {
        systemInstruction: { parts: [{ text: systemMsgs.map((m) => m.content).join('\n') }] },
      }),
      contents,
      generationConfig: {
        temperature: opts?.temperature ?? 0.7,
        maxOutputTokens: opts?.maxTokens ?? 4096,
        topP: opts?.topP,
        stopSequences: opts?.stop,
      },
    };

    if (opts?.tools?.length) {
      body.tools = [
        {
          functionDeclarations: opts.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    return body;
  }

  async completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<LLMCompletionResult> {
    const body = this.buildBody(messages, opts);
    const res = await fetch(
      `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) this.throwError(res.status);

    const data = (await res.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{
            text?: string;
            functionCall?: { name: string; args: Record<string, unknown> };
          }>;
        };
        finishReason: string;
      }>;
    };

    const candidate = data.candidates?.[0];
    let content = '';
    const toolCalls: LLMToolCall[] = [];
    let callIdx = 0;

    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini-tc-${callIdx++}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    return {
      content,
      toolCalls,
      finishReason:
        toolCalls.length > 0
          ? 'tool_calls'
          : candidate?.finishReason === 'MAX_TOKENS'
            ? 'length'
            : 'stop',
    };
  }

  private throwError(status: number): never {
    if (status === 401 || status === 403)
      throw new LucidError(ErrorCode.AuthFailed, 'Invalid Gemini API key');
    if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Gemini rate limited');
    throw new LucidError(ErrorCode.ServiceUnavailable, `Gemini error: ${status}`);
  }
}
