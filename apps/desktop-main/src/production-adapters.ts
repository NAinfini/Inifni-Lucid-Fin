import { randomBytes } from 'node:crypto';
import {
  createAes256GcmPrivateRecoveryCodec,
  type PrivateModelContext,
  type PrivateRecoveryCodec,
} from '@lucid-fin/storage';
import type {
  CanonicalModelRequestV1,
  MessageBlock,
  ModelAdapterEvent,
  ModelResourceQuoteV1,
  ProviderModel,
  ToolId,
} from '@lucid-fin/contracts';
import type { ModelAdapter } from '@lucid-fin/runtime';

export const RECOVERY_KEY_SERVICE = 'lucid-fin-v1' as const;
export const RECOVERY_KEY_ACCOUNT = 'recovery-key-v1' as const;
export const LOCAL_OLLAMA_PROVIDER_ID = 'ollama-local' as const;
const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';

export interface RecoveryKeyStore {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}

export class ProviderNotConfiguredError extends Error {
  readonly code = 'provider_not_configured' as const;

  constructor(providerId: string) {
    super(`The ${providerId} provider is not configured for this desktop profile.`);
    this.name = 'ProviderNotConfiguredError';
  }
}

function decodeRecoveryKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, 'base64url');
  if (key.byteLength !== 32 || key.toString('base64url') !== encoded) {
    throw new Error('The canonical recovery key is invalid.');
  }
  return key;
}

export async function loadOrCreateRecoveryKey(store: RecoveryKeyStore): Promise<Buffer> {
  const stored = await store.getPassword(RECOVERY_KEY_SERVICE, RECOVERY_KEY_ACCOUNT);
  if (stored !== null) return decodeRecoveryKey(stored);
  const key = randomBytes(32);
  await store.setPassword(RECOVERY_KEY_SERVICE, RECOVERY_KEY_ACCOUNT, key.toString('base64url'));
  return key;
}

export async function createCanonicalRecoveryCodec(
  store: RecoveryKeyStore,
): Promise<PrivateRecoveryCodec> {
  return createAes256GcmPrivateRecoveryCodec({
    encryptionKeyId: RECOVERY_KEY_ACCOUNT,
    encryptionKey: await loadOrCreateRecoveryKey(store),
  });
}

export async function systemRecoveryKeyStore(): Promise<RecoveryKeyStore> {
  const { default: keytar } = (await import('keytar')) as unknown as {
    readonly default: RecoveryKeyStore;
  };
  return Object.freeze({
    getPassword: (service: string, account: string) => keytar.getPassword(service, account),
    setPassword: (service: string, account: string, password: string) =>
      keytar.setPassword(service, account, password),
  });
}

export interface OllamaModelAdapterOptions {
  readonly provider: ProviderModel;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface OpenAIResponsesModelAdapterOptions {
  readonly provider: ProviderModel;
  readonly apiKey: string;
  readonly endpoint?: string;
  readonly fetch?: typeof globalThis.fetch;
}

function loopbackEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new Error('Ollama endpoint must be an unauthenticated loopback HTTP URL.');
  }
  return endpoint.href.replace(/\/$/u, '');
}

function sameProvider(left: ProviderModel, right: ProviderModel): boolean {
  return (
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.reasoningStrength === right.reasoningStrength
  );
}

function openAIResponsesEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new Error('OpenAI Responses endpoint must be an authenticated HTTPS URL.');
  }
  const pathname = endpoint.pathname.replace(/\/+$/u, '').replace(/\/responses$/u, '');
  endpoint.pathname = `${pathname || '/v1'}/responses`;
  return endpoint.href;
}

function openAIToolName(toolId: ToolId): string {
  return `lucid_${toolId.replace(/\./gu, '_')}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageBlockText(block: MessageBlock): string {
  if (block.type === 'text') return block.text;
  if (block.type === 'project_object') {
    return `[${block.authority} reference ${block.objectId} at revision ${block.revision}]`;
  }
  if (block.type === 'project_media') {
    return `[project media ${block.projectMediaRefId}]`;
  }
  return `[generated result ${block.resultId}]`;
}

function privateToolArguments(
  fact: Extract<CanonicalModelRequestV1['facts'][number], { type: 'tool_call' }>,
  privateContext: PrivateModelContext,
): Record<string, unknown> {
  if (fact.toolId === 'agent.spawn') {
    const recovery = privateContext.spawnObjectives.find(
      ({ dispatchOperationId }) => dispatchOperationId === fact.dispatchOperationId,
    );
    return recovery === undefined
      ? fact.canonicalArguments
      : { ...fact.canonicalArguments, objective: recovery.objective };
  }
  if (fact.toolId === 'agent.send') {
    const recovery = privateContext.sentDirections?.find(
      ({ dispatchOperationId }) => dispatchOperationId === fact.dispatchOperationId,
    );
    return recovery === undefined
      ? fact.canonicalArguments
      : { ...fact.canonicalArguments, message: recovery.message };
  }
  return fact.canonicalArguments;
}

function openAIInput(
  request: CanonicalModelRequestV1,
  privateContext: PrivateModelContext,
): readonly Record<string, unknown>[] {
  const privateDirections = new Map(
    privateContext.parentDirections.map((direction) => [direction.inboxMessageId, direction]),
  );
  return request.facts.flatMap((fact): readonly Record<string, unknown>[] => {
    if (fact.type === 'message') {
      return [
        {
          role: fact.role,
          content: fact.blocks.map(messageBlockText).join('\n\n'),
        },
      ];
    }
    if (fact.type === 'tool_call') {
      return [
        {
          type: 'function_call',
          call_id: fact.providerCallId,
          name: openAIToolName(fact.toolId),
          arguments: JSON.stringify(privateToolArguments(fact, privateContext)),
        },
      ];
    }
    if (fact.type === 'tool_result') {
      return [
        {
          type: 'function_call_output',
          call_id: fact.providerCallId,
          output: JSON.stringify(fact.outcome),
        },
      ];
    }
    if (fact.type === 'parent_direction') {
      const direction = privateDirections.get(fact.inboxMessageId);
      const text = direction?.message ?? direction?.objective;
      return text === undefined ? [] : [{ role: 'user', content: text }];
    }
    return [
      {
        role: 'user',
        content: `A scoped local delivery destination is available until ${fact.expiresAt}.`,
      },
    ];
  });
}

function openAIInstructions(request: CanonicalModelRequestV1): string {
  const skills = request.skillIndex
    .map(({ id, name, description, version }) => `${id}@${version} (${name}): ${description}`)
    .join('\n');
  const compaction = request.compactionView?.summary;
  return [
    "You are Lucid Fin Commander. Advance the user's production by calling the supplied tools.",
    'Use only supplied tools and exact arguments. Never claim that work succeeded before a tool result proves it.',
    'Keep public assistant text concise. Ask the user only when an authorization or creative decision is genuinely required.',
    `Locale: ${request.locale}. Time zone: ${request.timeZone}.`,
    compaction === undefined || compaction === null
      ? ''
      : `Prior compacted context:\n${compaction}`,
    skills.length === 0
      ? ''
      : `Available skills (load one before relying on its full instructions):\n${skills}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
}

interface OpenAIResponsesPayload {
  readonly output_text?: unknown;
  readonly output?: unknown;
  readonly usage?: unknown;
  readonly status?: unknown;
  readonly incomplete_details?: unknown;
}

function openAIText(payload: OpenAIResponsesPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text;
  }
  if (!Array.isArray(payload.output)) return '';
  return payload.output
    .flatMap((item) => {
      if (!isObject(item) || !Array.isArray(item.content)) return [];
      return item.content.flatMap((part) =>
        isObject(part) && part.type === 'output_text' && typeof part.text === 'string'
          ? [part.text]
          : [],
      );
    })
    .join('');
}

function openAIUsage(payload: OpenAIResponsesPayload): ModelResourceQuoteV1 {
  const usage = isObject(payload.usage) ? payload.usage : {};
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? ({ state: 'known', value } as const)
      : ({ state: 'unknown' } as const);
  return {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cost: { state: 'unknown', currency: 'USD' },
  };
}

function openAIToolCalls(
  payload: OpenAIResponsesPayload,
  request: CanonicalModelRequestV1,
): readonly Extract<ModelAdapterEvent, { type: 'tool_call' }>[] | null {
  if (!Array.isArray(payload.output)) return [];
  const byProviderName = new Map(
    request.materializedTools.map((tool) => [openAIToolName(tool.id), tool.id]),
  );
  const calls: Extract<ModelAdapterEvent, { type: 'tool_call' }>[] = [];
  for (const item of payload.output) {
    if (!isObject(item) || item.type !== 'function_call') continue;
    const toolId = typeof item.name === 'string' ? byProviderName.get(item.name) : undefined;
    if (
      toolId === undefined ||
      typeof item.call_id !== 'string' ||
      item.call_id.length === 0 ||
      typeof item.arguments !== 'string'
    ) {
      return null;
    }
    let canonicalArguments: unknown;
    try {
      canonicalArguments = JSON.parse(item.arguments) as unknown;
    } catch {
      return null;
    }
    if (!isObject(canonicalArguments)) return null;
    calls.push({
      type: 'tool_call',
      providerCallId: item.call_id,
      toolId,
      canonicalArguments: canonicalArguments as Extract<
        ModelAdapterEvent,
        { type: 'tool_call' }
      >['canonicalArguments'],
    });
  }
  return calls;
}

function openAIFinishReason(
  payload: OpenAIResponsesPayload,
  hasToolCalls: boolean,
): Extract<ModelAdapterEvent, { type: 'model_completed' }>['finishReason'] {
  if (hasToolCalls) return 'tool_calls';
  const details = isObject(payload.incomplete_details) ? payload.incomplete_details : {};
  if (details.reason === 'content_filter') return 'content_filter';
  if (payload.status === 'incomplete') return 'length';
  return 'stop';
}

export function createOpenAIResponsesModelAdapter(
  options: OpenAIResponsesModelAdapterOptions,
): ModelAdapter {
  const apiKey = options.apiKey.trim();
  if (apiKey.length === 0) throw new ProviderNotConfiguredError(options.provider.providerId);
  const endpoint = openAIResponsesEndpoint(options.endpoint ?? 'https://api.openai.com/v1');
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function')
    throw new Error('Fetch is unavailable for OpenAI Responses.');

  const assertProfile = (request: CanonicalModelRequestV1) => {
    if (!sameProvider(request.provider, options.provider)) {
      throw new ProviderNotConfiguredError(request.provider.providerId);
    }
  };

  return Object.freeze<ModelAdapter>({
    provider: options.provider,
    async quote(request, privateContext) {
      assertProfile(request);
      return {
        inputTokens: {
          state: 'estimated',
          value: Math.ceil(JSON.stringify({ request, privateContext }).length / 4),
        },
        outputTokens: { state: 'estimated', value: request.limits.maxOutputTokens },
        cost: { state: 'unknown', currency: 'USD' },
      };
    },
    async *stream(request, privateContext, signal) {
      assertProfile(request);
      const tools = request.materializedTools.map((tool) => ({
        type: 'function',
        name: openAIToolName(tool.id),
        description: tool.description,
        parameters: JSON.parse(tool.inputSchema.canonicalJson) as unknown,
      }));
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal,
          body: JSON.stringify({
            model: options.provider.model,
            instructions: openAIInstructions(request),
            input: openAIInput(request, privateContext),
            max_output_tokens: request.limits.maxOutputTokens,
            parallel_tool_calls: true,
            ...(request.reasoningStrength === null
              ? {}
              : { reasoning: { effort: request.reasoningStrength } }),
            ...(tools.length === 0 ? {} : { tools }),
          }),
        });
      } catch {
        yield {
          type: 'usage',
          usage: {
            inputTokens: { state: 'unknown' },
            outputTokens: { state: 'unknown' },
            cost: { state: 'unknown', currency: 'USD' },
          },
        };
        yield {
          type: 'model_failed',
          typedCode: signal?.aborted ? 'cancelled' : 'provider_state_unknown',
          retrySafety: signal?.aborted ? 'never' : 'receipt_reconcile_only',
          providerState: 'unknown',
        };
        return;
      }

      if (!response.ok) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: { state: 'unknown' },
            outputTokens: { state: 'unknown' },
            cost: { state: 'unknown', currency: 'USD' },
          },
        };
        yield {
          type: 'model_failed',
          typedCode: response.status >= 500 ? 'provider_unavailable' : 'provider_rejected',
          retrySafety: 'safe',
          providerState: 'terminal',
        };
        return;
      }

      let payload: OpenAIResponsesPayload;
      try {
        payload = (await response.json()) as OpenAIResponsesPayload;
      } catch {
        yield { type: 'usage', usage: openAIUsage({}) };
        yield {
          type: 'model_failed',
          typedCode: 'provider_failed',
          retrySafety: 'never',
          providerState: 'terminal',
        };
        return;
      }
      const calls = openAIToolCalls(payload, request);
      const usage = openAIUsage(payload);
      if (calls === null) {
        yield { type: 'usage', usage };
        yield {
          type: 'model_failed',
          typedCode: 'provider_failed',
          retrySafety: 'never',
          providerState: 'terminal',
        };
        return;
      }
      const text = openAIText(payload);
      if (text.length === 0 && calls.length === 0 && payload.status !== 'incomplete') {
        yield { type: 'usage', usage };
        yield {
          type: 'model_failed',
          typedCode: 'provider_failed',
          retrySafety: 'never',
          providerState: 'terminal',
        };
        return;
      }
      if (text.length > 0) yield { type: 'assistant_delta', publicText: text };
      for (const call of calls) yield call;
      yield { type: 'usage', usage };
      yield {
        type: 'model_completed',
        finishReason: openAIFinishReason(payload, calls.length > 0),
      };
    },
  });
}

function quoteFor(request: CanonicalModelRequestV1): ModelResourceQuoteV1 {
  return {
    inputTokens: { state: 'estimated', value: Math.ceil(JSON.stringify(request).length / 4) },
    outputTokens: { state: 'estimated', value: request.limits.maxOutputTokens },
    cost: { state: 'known', value: '0', currency: 'USD' },
  };
}

function usageFor(payload: {
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
}): ModelResourceQuoteV1 {
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? { state: 'known' as const, value }
      : { state: 'unknown' as const };
  return {
    inputTokens: count(payload.prompt_eval_count),
    outputTokens: count(payload.eval_count),
    cost: { state: 'known', value: '0', currency: 'USD' },
  };
}

interface OllamaChatResponse {
  readonly message?: { readonly content?: unknown };
  readonly prompt_eval_count?: unknown;
  readonly eval_count?: unknown;
}

export function createOllamaModelAdapter(options: OllamaModelAdapterOptions): ModelAdapter {
  if (options.provider.providerId !== LOCAL_OLLAMA_PROVIDER_ID) {
    throw new ProviderNotConfiguredError(options.provider.providerId);
  }
  const endpoint = loopbackEndpoint(options.endpoint ?? DEFAULT_OLLAMA_ENDPOINT);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function')
    throw new Error('Fetch is unavailable for the local Ollama provider.');

  const assertProfile = (request: CanonicalModelRequestV1) => {
    if (!sameProvider(request.provider, options.provider)) {
      throw new ProviderNotConfiguredError(request.provider.providerId);
    }
  };

  const adapter: ModelAdapter = {
    provider: options.provider,
    quote: async (request: CanonicalModelRequestV1) => {
      assertProfile(request);
      return quoteFor(request);
    },
    async *stream(
      request: CanonicalModelRequestV1,
      privateContext: PrivateModelContext,
      signal?: AbortSignal,
    ) {
      assertProfile(request);
      let response: Response;
      try {
        response = await fetchImpl(`${endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model: options.provider.model,
            stream: false,
            messages: [
              {
                role: 'system',
                content:
                  'You are the Lucid Fin local commander. Return a concise response. Do not invent tool calls.',
              },
              {
                role: 'user',
                content: JSON.stringify({ request, privateContext }),
              },
            ],
            options: { num_predict: request.limits.maxOutputTokens },
          }),
        });
      } catch {
        yield {
          type: 'usage',
          usage: {
            inputTokens: { state: 'unknown' },
            outputTokens: { state: 'unknown' },
            cost: { state: 'known', value: '0', currency: 'USD' },
          },
        } satisfies ModelAdapterEvent;
        yield {
          type: 'model_failed',
          typedCode: signal?.aborted ? 'cancelled' : 'provider_unavailable',
          retrySafety: 'before_submission',
          providerState: 'not_submitted',
        } satisfies ModelAdapterEvent;
        return;
      }

      if (!response.ok) {
        yield {
          type: 'usage',
          usage: {
            inputTokens: { state: 'unknown' },
            outputTokens: { state: 'unknown' },
            cost: { state: 'known', value: '0', currency: 'USD' },
          },
        } satisfies ModelAdapterEvent;
        yield {
          type: 'model_failed',
          typedCode: response.status === 404 ? 'provider_rejected' : 'provider_unavailable',
          retrySafety: 'before_submission',
          providerState: 'not_submitted',
        } satisfies ModelAdapterEvent;
        return;
      }

      const payload = (await response.json()) as OllamaChatResponse;
      const content =
        typeof payload.message?.content === 'string' ? payload.message.content.trim() : '';
      if (content.length > 0) yield { type: 'assistant_delta' as const, publicText: content };
      yield { type: 'usage' as const, usage: usageFor(payload) };
      yield { type: 'model_completed' as const, finishReason: 'stop' };
    },
  };
  return Object.freeze(adapter);
}
