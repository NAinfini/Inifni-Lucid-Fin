import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listBuiltinMediaProviders,
  listBuiltinVisionProviderPresets,
  type LLMAdapter,
} from '@lucid-fin/contracts';
import type { Keychain } from '@lucid-fin/storage';
import { AdapterRegistry, LLMRegistry, listBuiltinLLMProviderPresets } from '@lucid-fin/adapters-ai';
import type { ProviderOAuthManager } from '../oauth/provider-oauth-manager.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import {
  createAdapterRegistry,
  createLLMRegistry,
  registerOAuthAdapters,
  restoreAdapterKeys,
  selectConfiguredLLMAdapter,
} from './init-app.js';

function makeAdapter(id: string, configured: boolean): LLMAdapter {
  return {
    id,
    name: id,
    capabilities: [],
    configure: vi.fn(),
    validate: vi.fn().mockResolvedValue(configured),
    complete: vi.fn(),
    stream: vi.fn(),
    completeWithTools: vi.fn(),
  } as unknown as LLMAdapter;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('selectConfiguredLLMAdapter', () => {
  it('returns the first configured adapter, not the first registered one', async () => {
    const openai = makeAdapter('openai', false);
    const claude = makeAdapter('claude', true);

    await expect(selectConfiguredLLMAdapter([openai, claude])).resolves.toBe(claude);
    expect(logger.info).toHaveBeenCalledWith(
      'Selected configured LLM adapter',
      expect.objectContaining({
        category: 'provider',
        adapterId: 'claude',
      }),
    );
  });

  it('throws when no adapter is configured', async () => {
    const openai = makeAdapter('openai', false);
    const claude = makeAdapter('claude', false);

    await expect(selectConfiguredLLMAdapter([openai, claude])).rejects.toThrow(
      'No configured LLM adapter',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'No configured LLM adapters found',
      expect.objectContaining({
        category: 'provider',
        adapterCount: 2,
      }),
    );
  });

  it('logs validate exceptions with provider category and keeps searching', async () => {
    const openai = makeAdapter('openai', false);
    openai.validate = vi.fn().mockRejectedValue(new Error('boom'));
    const claude = makeAdapter('claude', true);

    await expect(selectConfiguredLLMAdapter([openai, claude])).resolves.toBe(claude);

    expect(logger.warn).toHaveBeenCalledWith(
      'adapter.validate() threw',
      expect.objectContaining({
        category: 'provider',
        adapterId: 'openai',
        error: 'Error: boom',
      }),
    );
  });
});

describe('createAdapterRegistry', () => {
  it('registers every built-in media adapter used by settings', () => {
    const registry = createAdapterRegistry();

    for (const provider of listBuiltinMediaProviders().filter(
      (entry) => entry.access !== 'managed',
    )) {
      expect(
        registry.resolve(provider.providerId, provider.group)?.id,
        `missing ${provider.group}:${provider.providerId}`,
      ).toBe(provider.adapterId);
    }
  });
});

describe('createLLMRegistry', () => {
  it('registers every supported hosted and local llm adapter', () => {
    const llmRegistry = createLLMRegistry();

    expect(
      llmRegistry
        .list()
        .map((adapter) => adapter.id)
        .sort(),
    ).toEqual(
      [...listBuiltinLLMProviderPresets(), ...listBuiltinVisionProviderPresets()]
        .map((preset) => preset.id)
        .sort(),
    );
  });
});

describe('registerOAuthAdapters', () => {
  it('registers ChatGPT OAuth only and leaves Google providers on API-key runtimes', () => {
    const adapterRegistry = new AdapterRegistry();
    const llmRegistry = new LLMRegistry();
    const manager = {
      getCodexRuntime: vi.fn(() => ({})),
      getGoogleAuthorizationHeaders: vi.fn(),
    } as unknown as ProviderOAuthManager;

    registerOAuthAdapters(manager, adapterRegistry, llmRegistry);

    expect(adapterRegistry.list().map((adapter) => adapter.id)).toEqual(['codex-imagegen']);
    expect(llmRegistry.list().map((adapter) => adapter.id)).toEqual([
      'chatgpt-oauth',
      'chatgpt-vision-oauth',
    ]);
  });
});

describe('restoreAdapterKeys', () => {
  it('does not query the API-key keychain for OAuth adapters', async () => {
    const registry = new AdapterRegistry();
    registry.register({
      id: 'oauth-image',
      name: 'OAuth image',
      type: 'image',
      capabilities: ['text-to-image'],
      maxConcurrent: 1,
      credentialMode: 'oauth',
      configure: vi.fn(),
      validate: vi.fn().mockResolvedValue(true),
      generate: vi.fn(),
      estimateCost: vi.fn(),
      checkStatus: vi.fn(),
      cancel: vi.fn(),
    } as never);
    const keychain = { getKey: vi.fn() } as Pick<Keychain, 'getKey'> as Keychain;
    const emptyLLMRegistry = { list: () => [] } as never;

    await restoreAdapterKeys(keychain, registry, emptyLLMRegistry);

    expect(keychain.getKey).not.toHaveBeenCalled();
  });

  it('restores media keys saved under registry ids onto the registered adapters', async () => {
    const registry = createAdapterRegistry();
    const llmRegistry = createLLMRegistry();
    const openaiImageAdapter = registry.get('openai-dalle');
    const googleImageAdapter = registry.get('google-imagen3');
    const googleVideoAdapter = registry.get('google-veo-2');
    const recraftAdapter = registry.get('recraft-v4');
    const elevenlabsAdapter = registry.get('elevenlabs-v2');
    const openAITtsAdapter = registry.get('openai-tts-1-hd');
    const deepSeekAdapter = llmRegistry.get('deepseek');

    expect(openaiImageAdapter).toBeDefined();
    expect(googleImageAdapter).toBeDefined();
    expect(googleVideoAdapter).toBeDefined();
    expect(recraftAdapter).toBeDefined();
    expect(elevenlabsAdapter).toBeDefined();
    expect(openAITtsAdapter).toBeDefined();
    expect(deepSeekAdapter).toBeDefined();

    const openaiConfigure = vi.spyOn(openaiImageAdapter!, 'configure');
    const googleImageConfigure = vi.spyOn(googleImageAdapter!, 'configure');
    const googleVideoConfigure = vi.spyOn(googleVideoAdapter!, 'configure');
    const recraftConfigure = vi.spyOn(recraftAdapter!, 'configure');
    const elevenlabsConfigure = vi.spyOn(elevenlabsAdapter!, 'configure');
    const openAITtsConfigure = vi.spyOn(openAITtsAdapter!, 'configure');
    const deepSeekConfigure = vi.spyOn(deepSeekAdapter!, 'configure');

    const keychain = {
      getKey: vi.fn(async (provider: string) => {
        return (
          {
            'openai-dalle': 'sk-openai-image',
            'google-imagen3': 'sk-google-image',
            'google-veo-2': 'sk-google-video',
            'recraft-v4': 'sk-recraft',
            'elevenlabs-v2': 'sk-elevenlabs',
            'openai-tts-1-hd': 'sk-openai-tts',
            deepseek: 'sk-deepseek',
          }[provider] ?? null
        );
      }),
    } as Pick<Keychain, 'getKey'> as Keychain;

    await restoreAdapterKeys(keychain, registry, llmRegistry);

    expect(openaiConfigure).toHaveBeenCalledWith('sk-openai-image');
    expect(googleImageConfigure).toHaveBeenCalledWith('sk-google-image');
    expect(googleVideoConfigure).toHaveBeenCalledWith('sk-google-video');
    expect(recraftConfigure).toHaveBeenCalledWith('sk-recraft');
    expect(elevenlabsConfigure).toHaveBeenCalledWith('sk-elevenlabs');
    expect(openAITtsConfigure).toHaveBeenCalledWith('sk-openai-tts');
    expect(deepSeekConfigure).toHaveBeenCalledWith('sk-deepseek');
  });
});
