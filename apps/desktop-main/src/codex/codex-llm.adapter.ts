import type {
  Capability,
  LLMAdapter,
  LLMMessage,
  LLMRequestOptions,
  LLMStreamEvent,
  OAuthCapability,
  ProviderProfile,
} from '@lucid-fin/contracts';
import type { CodexRuntime } from './codex-runtime.js';

export class CodexLLMAdapter implements LLMAdapter {
  readonly credentialMode = 'oauth' as const;
  readonly toolLoopMode = 'provider-managed' as const;
  readonly capabilities: Capability[] = [
    'text-generation',
    'image-understanding',
    'script-expand',
    'scene-breakdown',
    'character-extract',
    'prompt-enhance',
  ];
  readonly oauthTarget;
  readonly profile: ProviderProfile;
  readonly contextWindow = 1_050_000;

  constructor(
    readonly id: string,
    readonly name: string,
    capability: Extract<OAuthCapability, 'llm' | 'vision'>,
    private readonly runtime: CodexRuntime,
  ) {
    this.oauthTarget = { provider: 'chatgpt', capability } as const;
    this.profile = {
      providerId: id,
      charsPerToken: 4,
      sanitizeToolNames: true,
      maxUtilization: 0.85,
      outputReserveTokens: 8192,
      reasoningModel: true,
    };
  }

  configure(_apiKey: string, options: Record<string, unknown> = {}): void {
    this.runtime.configureLLM({
      model: options.model,
      reasoningEffort: options.reasoningEffort,
    });
  }

  async validate(): Promise<boolean> {
    await this.runtime.start().catch(() => undefined);
    return this.runtime.getStatus().state === 'ready';
  }

  async complete(messages: LLMMessage[], options?: LLMRequestOptions): Promise<string> {
    let content = '';
    for await (const event of await this.completeWithTools(messages, {
      ...options,
      tools: undefined,
      providerToolBridge: undefined,
    })) {
      if (event.kind === 'text_delta') content += event.delta;
    }
    return content;
  }

  async *stream(messages: LLMMessage[], options?: LLMRequestOptions): AsyncIterable<string> {
    for await (const event of await this.completeWithTools(messages, {
      ...options,
      tools: undefined,
      providerToolBridge: undefined,
    })) {
      if (event.kind === 'text_delta') yield event.delta;
    }
  }

  completeWithTools(
    messages: LLMMessage[],
    options?: LLMRequestOptions,
  ): Promise<AsyncIterable<LLMStreamEvent>> {
    return this.runtime.completeWithTools(messages, options);
  }
}
