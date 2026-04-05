import { describe, expect, it, vi } from 'vitest';
import type { LLMAdapter } from '@lucid-fin/contracts';
import type { Keychain } from '@lucid-fin/storage';
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

describe('selectConfiguredLLMAdapter', () => {
  it('returns the first configured adapter, not the first registered one', async () => {
    const openai = makeAdapter('openai', false);
    const claude = makeAdapter('claude', true);

    await expect(selectConfiguredLLMAdapter([openai, claude])).resolves.toBe(claude);
  });

  it('throws when no adapter is configured', async () => {
    const openai = makeAdapter('openai', false);
    const claude = makeAdapter('claude', false);

    await expect(selectConfiguredLLMAdapter([openai, claude])).rejects.toThrow(
      'No configured LLM adapter',
    );
  });
});

describe('createAdapterRegistry', () => {
  it('registers every built-in media adapter used by settings', () => {
    const registry = createAdapterRegistry();

    expect(registry.list().map((adapter) => adapter.id).sort()).toEqual([
      'cartesia-sonic',
      'elevenlabs-v2',
      'elevenlabs-sfx',
      'fish-audio-v1',
      'flux',
      'google-imagen3',
      'google-veo-2',
      'hunyuan-video',
      'ideogram',
      'kling-v1',
      'luma-ray2',
      'minimax-video01',
      'openai-dalle',
      'openai-tts-1-hd',
      'pika-v2',
      'playht-3',
      'recraft-v3',
      'runway-gen4',
      'seedance-2',
      'stability-audio-v2',
      'wan-2.1',
    ]);
  });
});

describe('createLLMRegistry', () => {
  it('registers every supported hosted and local llm adapter', () => {
    const llmRegistry = createLLMRegistry();

    expect(llmRegistry.list().map((adapter) => adapter.id).sort()).toEqual([
      'claude',
      'deepseek',
      'gemini',
      'grok',
      'ollama-local',
      'openai',
      'qwen',
    ]);
  });
});

describe('restoreAdapterKeys', () => {
  it('restores media keys saved under legacy settings ids onto the registered adapters', async () => {
    const registry = createAdapterRegistry();
    const llmRegistry = createLLMRegistry();
    const openaiImageAdapter = registry.get('openai-dalle');
    const recraftAdapter = registry.get('recraft-v3');
    const elevenlabsAdapter = registry.get('elevenlabs-v2');
    const openAITtsAdapter = registry.get('openai-tts-1-hd');
    const deepSeekAdapter = llmRegistry.get('deepseek');

    expect(openaiImageAdapter).toBeDefined();
    expect(recraftAdapter).toBeDefined();
    expect(elevenlabsAdapter).toBeDefined();
    expect(openAITtsAdapter).toBeDefined();
    expect(deepSeekAdapter).toBeDefined();

    const openaiConfigure = vi.spyOn(openaiImageAdapter!, 'configure');
    const recraftConfigure = vi.spyOn(recraftAdapter!, 'configure');
    const elevenlabsConfigure = vi.spyOn(elevenlabsAdapter!, 'configure');
    const openAITtsConfigure = vi.spyOn(openAITtsAdapter!, 'configure');
    const deepSeekConfigure = vi.spyOn(deepSeekAdapter!, 'configure');

    const keychain = {
      getKey: vi.fn(async (provider: string) => {
        return (
          {
            'openai-image': 'sk-image',
            'recraft-v4': 'sk-recraft',
            elevenlabs: 'sk-elevenlabs',
            'openai-tts': 'sk-openai-tts',
            deepseek: 'sk-deepseek',
          }[provider] ?? null
        );
      }),
    } as Pick<Keychain, 'getKey'> as Keychain;

    await restoreAdapterKeys(keychain, registry, llmRegistry);

    expect(openaiConfigure).toHaveBeenCalledWith('sk-image');
    expect(recraftConfigure).toHaveBeenCalledWith('sk-recraft');
    expect(elevenlabsConfigure).toHaveBeenCalledWith('sk-elevenlabs');
    expect(openAITtsConfigure).toHaveBeenCalledWith('sk-openai-tts');
    expect(deepSeekConfigure).toHaveBeenCalledWith('sk-deepseek');
  });
});
