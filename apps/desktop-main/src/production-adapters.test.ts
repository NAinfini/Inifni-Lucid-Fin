import { describe, expect, it, vi } from 'vitest';
import type { CanonicalModelRequestV1, ProviderModel } from '@lucid-fin/contracts';
import type { PrivateModelContext } from '@lucid-fin/storage';
import {
  LOCAL_OLLAMA_PROVIDER_ID,
  RECOVERY_KEY_ACCOUNT,
  RECOVERY_KEY_SERVICE,
  ProviderNotConfiguredError,
  createOllamaModelAdapter,
  createOpenAIResponsesModelAdapter,
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

const openAIProvider: ProviderModel = {
  providerId: 'provider.openai.commander',
  model: 'gpt-5.4',
  reasoningStrength: 'medium',
};

const openAIRequest = {
  provider: openAIProvider,
  limits: { maxInputTokens: 8_000, maxOutputTokens: 1_000 },
  locale: 'en-US',
  timeZone: 'America/New_York',
  reasoningStrength: 'medium',
  compactionView: null,
  skillIndex: [],
  materializedTools: [
    {
      id: 'project.get',
      description: 'Read one project.',
      inputSchema: {
        canonicalJson:
          '{"additionalProperties":false,"properties":{"projectId":{"type":"string"}},"required":["projectId"],"type":"object"}',
      },
    },
  ],
  facts: [
    {
      type: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'Build the first scene.' }],
    },
  ],
} as CanonicalModelRequestV1;

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

  it('maps OpenAI Responses tool calls into canonical Harness events', async () => {
    const calls: Array<readonly [string, RequestInit | undefined]> = [];
    const adapter = createOpenAIResponsesModelAdapter({
      provider: openAIProvider,
      apiKey: 'sk-private',
      endpoint: 'https://api.openai.test/v1/responses',
      fetch: async (url, init) => {
        calls.push([String(url), init]);
        return new Response(
          JSON.stringify({
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: 'I will inspect the project.' }],
              },
              {
                type: 'function_call',
                call_id: 'call_project_1',
                name: 'lucid_project_get',
                arguments: '{"projectId":"project.1"}',
              },
            ],
            usage: { input_tokens: 84, output_tokens: 17 },
            status: 'completed',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });

    await expect(adapter.quote(openAIRequest, privateContext)).resolves.toMatchObject({
      inputTokens: { state: 'estimated' },
      outputTokens: { state: 'estimated', value: 1_000 },
      cost: { state: 'unknown', currency: 'USD' },
    });
    await expect(Array.fromAsync(adapter.stream(openAIRequest, privateContext))).resolves.toEqual([
      { type: 'assistant_delta', publicText: 'I will inspect the project.' },
      {
        type: 'tool_call',
        providerCallId: 'call_project_1',
        toolId: 'project.get',
        canonicalArguments: { projectId: 'project.1' },
      },
      {
        type: 'usage',
        usage: {
          inputTokens: { state: 'known', value: 84 },
          outputTokens: { state: 'known', value: 17 },
          cost: { state: 'unknown', currency: 'USD' },
        },
      },
      { type: 'model_completed', finishReason: 'tool_calls' },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://api.openai.test/v1/responses');
    expect(calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer sk-private',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-5.4',
      max_output_tokens: 1_000,
      parallel_tool_calls: true,
      reasoning: { effort: 'medium' },
      input: [{ role: 'user', content: 'Build the first scene.' }],
      tools: [
        {
          type: 'function',
          name: 'lucid_project_get',
          description: 'Read one project.',
        },
      ],
    });
  });

  it('fails closed for unsafe endpoints, profile mismatches, and rejected requests', async () => {
    expect(() =>
      createOpenAIResponsesModelAdapter({
        provider: openAIProvider,
        apiKey: 'sk-private',
        endpoint: 'http://api.openai.test/v1',
      }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      createOpenAIResponsesModelAdapter({ provider: openAIProvider, apiKey: ' ' }),
    ).toThrow(ProviderNotConfiguredError);

    const adapter = createOpenAIResponsesModelAdapter({
      provider: openAIProvider,
      apiKey: 'sk-private',
      fetch: async () => new Response('unauthorized', { status: 401 }),
    });
    const foreign = {
      ...openAIRequest,
      provider: { ...openAIProvider, providerId: 'provider.other' },
    } as CanonicalModelRequestV1;
    await expect(adapter.quote(foreign, privateContext)).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    await expect(Array.fromAsync(adapter.stream(openAIRequest, privateContext))).resolves.toEqual([
      {
        type: 'usage',
        usage: {
          inputTokens: { state: 'unknown' },
          outputTokens: { state: 'unknown' },
          cost: { state: 'unknown', currency: 'USD' },
        },
      },
      {
        type: 'model_failed',
        typedCode: 'provider_rejected',
        retrySafety: 'safe',
        providerState: 'terminal',
      },
    ]);
  });
});
