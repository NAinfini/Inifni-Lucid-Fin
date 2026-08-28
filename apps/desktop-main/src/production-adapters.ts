import { randomBytes } from 'node:crypto';
import {
  createAes256GcmPrivateRecoveryCodec,
  type PrivateModelContext,
  type PrivateRecoveryCodec,
} from '@lucid-fin/storage';
import type {
  CanonicalModelRequestV1,
  ModelAdapterEvent,
  ModelResourceQuoteV1,
  ProviderModel,
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
