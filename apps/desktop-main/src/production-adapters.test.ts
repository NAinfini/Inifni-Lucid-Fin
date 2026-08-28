import { describe, expect, it, vi } from 'vitest';
import type { CanonicalModelRequestV1, ProviderModel } from '@lucid-fin/contracts';
import type { PrivateModelContext } from '@lucid-fin/storage';
import {
  LOCAL_OLLAMA_PROVIDER_ID,
  RECOVERY_KEY_ACCOUNT,
  RECOVERY_KEY_SERVICE,
  ProviderNotConfiguredError,
  createOllamaModelAdapter,
  loadOrCreateRecoveryKey,
  systemRecoveryKeyStore,
  type RecoveryKeyStore,
} from './production-adapters.js';

const keytar = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock('keytar', () => ({ default: keytar }));

const provider: ProviderModel = {
  providerId: LOCAL_OLLAMA_PROVIDER_ID,
  model: 'qwen3:8b',
  reasoningStrength: null,
};
const request = {
  provider,
  limits: { maxInputTokens: 8_000, maxOutputTokens: 1_000 },
} as CanonicalModelRequestV1;
const privateContext = {
  parentDirections: [],
  spawnObjectives: [],
} as PrivateModelContext;

class MemoryKeyStore implements RecoveryKeyStore {
  readonly values = new Map<string, string>();
  readonly calls: Array<readonly [string, string]> = [];

  async getPassword(service: string, account: string): Promise<string | null> {
    this.calls.push([service, account]);
    return this.values.get(`${service}:${account}`) ?? null;
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    this.calls.push([service, account]);
    this.values.set(`${service}:${account}`, password);
  }
}

describe('production adapters', () => {
  it('uses the CommonJS keytar default export', async () => {
    keytar.getPassword.mockResolvedValue('stored');
    keytar.setPassword.mockResolvedValue(undefined);
    const store = await systemRecoveryKeyStore();

    await expect(store.getPassword('service', 'account')).resolves.toBe('stored');
    await expect(store.setPassword('service', 'account', 'password')).resolves.toBeUndefined();
    expect(keytar.getPassword).toHaveBeenCalledWith('service', 'account');
    expect(keytar.setPassword).toHaveBeenCalledWith('service', 'account', 'password');
  });

  it('owns only the canonical recovery-key service and account', async () => {
    const store = new MemoryKeyStore();
    const first = await loadOrCreateRecoveryKey(store);
    const second = await loadOrCreateRecoveryKey(store);

    expect(first).toEqual(second);
    expect(store.calls).toEqual([
      [RECOVERY_KEY_SERVICE, RECOVERY_KEY_ACCOUNT],
      [RECOVERY_KEY_SERVICE, RECOVERY_KEY_ACCOUNT],
      [RECOVERY_KEY_SERVICE, RECOVERY_KEY_ACCOUNT],
    ]);
  });

  it('uses only an exact local Ollama profile and loopback endpoint', async () => {
    const calls: Array<readonly [string, RequestInit | undefined]> = [];
    const adapter = createOllamaModelAdapter({
      provider,
      fetch: async (url, init) => {
        calls.push([String(url), init]);
        return new Response(
          JSON.stringify({
            message: { content: 'Ready.' },
            prompt_eval_count: 12,
            eval_count: 7,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await expect(adapter.quote(request, privateContext)).resolves.toMatchObject({
      cost: { state: 'known', value: '0', currency: 'USD' },
    });
    await expect(Array.fromAsync(adapter.stream(request, privateContext))).resolves.toEqual([
      { type: 'assistant_delta', publicText: 'Ready.' },
      {
        type: 'usage',
        usage: {
          inputTokens: { state: 'known', value: 12 },
          outputTokens: { state: 'known', value: 7 },
          cost: { state: 'known', value: '0', currency: 'USD' },
        },
      },
      { type: 'model_completed', finishReason: 'stop' },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('http://127.0.0.1:11434/api/chat');
  });

  it('does not fall back from another provider kind to Ollama', async () => {
    const fetch = async (): Promise<Response> => new Response(null, { status: 200 });
    const adapter = createOllamaModelAdapter({ provider, fetch });
    const foreignRequest = {
      ...request,
      provider: { ...provider, providerId: 'openai' },
    } as CanonicalModelRequestV1;

    await expect(adapter.quote(foreignRequest, privateContext)).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    expect(() =>
      createOllamaModelAdapter({ provider, endpoint: 'https://example.com', fetch }),
    ).toThrow(/loopback/u);
  });
});
