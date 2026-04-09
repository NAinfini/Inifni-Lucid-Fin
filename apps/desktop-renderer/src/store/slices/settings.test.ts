import { describe, expect, it } from 'vitest';
import { listBuiltinLLMProviderPresets } from '@lucid-fin/contracts';
import { PROVIDER_REGISTRY, settingsSlice } from './settings.js';

function toDefaultStateSummary(group: keyof typeof PROVIDER_REGISTRY) {
  return PROVIDER_REGISTRY[group].map(({ id, model, protocol, authStyle, baseUrl }) => ({
    id,
    model,
    protocol,
    authStyle,
    baseUrl,
  }));
}

describe('provider registry metadata', () => {
  it('defines provider metadata with docs, key links, and hub model guidance', () => {
    expect(PROVIDER_REGISTRY.llm.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['openai', 'claude', 'gemini', 'openrouter', 'ollama-local']),
    );
    expect(PROVIDER_REGISTRY.image.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['openai-image', 'google-image', 'replicate', 'together']),
    );
    expect(PROVIDER_REGISTRY.video.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['google-video', 'runway', 'replicate', 'together']),
    );
    expect(PROVIDER_REGISTRY.audio.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['openai-tts', 'elevenlabs', 'replicate', 'fal']),
    );

    for (const group of Object.values(PROVIDER_REGISTRY)) {
      for (const provider of group) {
        expect(provider.docsUrl).not.toBe('');
        expect(provider.keyUrl).not.toBe('');
      }
    }
  });

  it('ships non-empty model guidance for every hub provider', () => {
    for (const group of Object.values(PROVIDER_REGISTRY)) {
      for (const provider of group.filter((entry) => entry.kind === 'hub')) {
        expect(provider.model).not.toBe('');
        expect(provider.modelExample ?? provider.model).not.toBe('');
      }
    }
  });

  it('keeps llm settings presets aligned with runtime contracts', () => {
    const contractPresets = new Map(
      listBuiltinLLMProviderPresets().map((preset) => [preset.id, preset] as const),
    );

    for (const provider of PROVIDER_REGISTRY.llm) {
      const preset = contractPresets.get(provider.id);
      expect(preset, `missing runtime preset for ${provider.id}`).toBeDefined();
      expect({
        id: provider.id,
        baseUrl: provider.baseUrl,
        model: provider.model,
        protocol: provider.protocol,
        authStyle: provider.authStyle,
      }).toEqual({
        id: preset!.id,
        baseUrl: preset!.baseUrl,
        model: preset!.model,
        protocol: preset!.protocol,
        authStyle: preset!.authStyle,
      });
    }
  });
});

describe('settings defaults', () => {
  it('uses the registry-driven provider list for each model group', () => {
    const state = settingsSlice.reducer(undefined, { type: '@@INIT' });

    expect('activeProvider' in state.llm).toBe(false);
    expect(
      state.llm.providers.map(({ id, model, protocol, authStyle, baseUrl }) => ({
        id,
        model,
        protocol,
        authStyle,
        baseUrl,
      })),
    ).toEqual(toDefaultStateSummary('llm'));

    expect('activeProvider' in state.image).toBe(false);
    expect(
      state.image.providers.map(({ id, baseUrl, model, protocol, authStyle }) => ({
        id,
        baseUrl,
        model,
        protocol,
        authStyle,
      })),
    ).toEqual(toDefaultStateSummary('image'));

    expect('activeProvider' in state.video).toBe(false);
    expect(
      state.video.providers.map(({ id, baseUrl, model, protocol, authStyle }) => ({
        id,
        baseUrl,
        model,
        protocol,
        authStyle,
      })),
    ).toEqual(toDefaultStateSummary('video'));

    expect('activeProvider' in state.audio).toBe(false);
    expect(
      state.audio.providers.map(({ id, baseUrl, model, protocol, authStyle }) => ({
        id,
        baseUrl,
        model,
        protocol,
        authStyle,
      })),
    ).toEqual(toDefaultStateSummary('audio'));
  });

  it('migrates saved settings onto the current registry while preserving custom providers', () => {
    const restored = settingsSlice.reducer(undefined, {
      type: settingsSlice.actions.restore.type,
      payload: {
        llm: {
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o',
              hasKey: false,
              isCustom: false,
            },
            {
              id: 'qwen',
              name: 'Qwen (Alibaba)',
              baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
              model: 'qwen-plus',
              hasKey: false,
              isCustom: false,
            },
            {
              id: 'custom-llm-1',
              name: 'OpenRouter',
              baseUrl: 'https://openrouter.ai/api/v1',
              model: 'openrouter/awesome',
              hasKey: true,
              isCustom: true,
            },
          ],
          activeProvider: 'custom-llm-1',
        },
        image: {
          providers: [
            {
              id: 'openai-image',
              name: 'OpenAI GPT Image',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-image-1',
              hasKey: false,
              isCustom: false,
            },
            {
              id: 'recraft-v4',
              name: 'Recraft V4',
              baseUrl: 'https://external.api.recraft.ai/v1',
              model: 'recraftv4',
              hasKey: false,
              isCustom: false,
            },
          ],
          activeProvider: 'recraft-v4',
        },
        video: {
          providers: [
            {
              id: 'google-veo-2',
              name: 'Google Veo 3.1',
              baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
              model: 'veo-3.0-generate-001',
              hasKey: false,
              isCustom: false,
            },
            {
              id: 'custom-video-1',
              name: 'OpenRouter',
              baseUrl: 'https://openrouter.ai/api/v1',
              model: 'alibaba/wan-2.6',
              hasKey: true,
              isCustom: true,
            },
          ],
          activeProvider: 'google-veo-2',
        },
        audio: {
          providers: [
            {
              id: 'openai-tts',
              name: 'OpenAI TTS',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini-tts',
              hasKey: false,
              isCustom: false,
            },
            {
              id: 'fish-audio-v1',
              name: 'Fish Audio',
              baseUrl: 'https://api.fish.audio/v1',
              model: 's2-pro',
              hasKey: false,
              isCustom: false,
            },
          ],
          activeProvider: 'openai-tts',
        },
        renderPreset: 'high',
      },
    });

    expect(restored.llm.providers.map((provider) => provider.id)).toEqual([
      ...PROVIDER_REGISTRY.llm.map((provider) => provider.id),
      'custom-llm-1',
    ]);
    expect(restored.llm.providers.find((provider) => provider.id === 'openai')?.model).toBe(
      'gpt-4.1',
    );
    expect(restored.llm.providers.find((provider) => provider.id === 'custom-llm-1')).toMatchObject(
      {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openrouter/awesome',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
        isCustom: true,
      },
    );
    expect('activeProvider' in restored.llm).toBe(false);

    expect('activeProvider' in restored.image).toBe(false);
    expect(restored.video.providers.map((provider) => provider.id)).toEqual([
      ...PROVIDER_REGISTRY.video.map((provider) => provider.id),
      'custom-video-1',
    ]);
    expect('activeProvider' in restored.video).toBe(false);
    expect('activeProvider' in restored.audio).toBe(false);
    expect(restored.renderPreset).toBe('high');
  });

  it('defaults newly added custom llm providers to openai-compatible runtime metadata', () => {
    const state = settingsSlice.reducer(
      undefined,
      settingsSlice.actions.addCustomProvider({
        group: 'llm',
        id: 'custom-llm-2',
        name: 'Custom Hosted',
        baseUrl: 'https://custom.example/v1',
        model: 'custom-model',
      }),
    );

    expect(state.llm.providers.find((provider) => provider.id === 'custom-llm-2')).toMatchObject({
      id: 'custom-llm-2',
      name: 'Custom Hosted',
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
      isCustom: true,
    });
  });
});
