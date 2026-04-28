import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMAdapter } from '@lucid-fin/contracts';
import type { Keychain } from '@lucid-fin/storage';
import { listBuiltinLLMProviderPresets } from '@lucid-fin/adapters-ai';

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

    expect(registry.list().map((adapter) => adapter.id).sort()).toEqual([
      'cartesia-sonic',
      'comfyui-local',
      'elevenlabs-sfx',
      'elevenlabs-v2',
      'fish-audio-v1',
      'google-imagen3',
      'google-veo-2',
      'higgsfield-v1',
      'hunyuan-video',
      'ideogram',
      'kling-v1',
      'leonardo-v2',
      'luma-ray2',
      'minimax-video01',
      'musicgen-local',
      'ollama-local',
      'openai-dalle',
      'openai-tts-1-hd',
      'pika-v2',
      'playht-3',
      'recraft-v3',
      'replicate',
      'runway-gen4',
      'sd-webui-local',
      'seedance-2',
      'stability-audio-v2',
      'suno-v4',
      'udio',
      'wan-2.1',
    ]);
  });
});

describe('createLLMRegistry', () => {
  it('registers every supported hosted and local llm adapter', () => {
    const llmRegistry = createLLMRegistry();

    expect(llmRegistry.list().map((adapter) => adapter.id).sort()).toEqual(
      listBuiltinLLMProviderPresets()
        .map((preset) => preset.id)
        .sort(),
    );
  });
});

describe('restoreAdapterKeys', () => {
  it('restores media keys saved under registry ids onto the registered adapters', async () => {
    const registry = createAdapterRegistry();
    const llmRegistry = createLLMRegistry();
    const openaiImageAdapter = registry.get('openai-dalle');
    const googleImageAdapter = registry.get('google-imagen3');
    const googleVideoAdapter = registry.get('google-veo-2');
    const recraftAdapter = registry.get('recraft-v3');
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
            'recraft-v3': 'sk-recraft',
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
