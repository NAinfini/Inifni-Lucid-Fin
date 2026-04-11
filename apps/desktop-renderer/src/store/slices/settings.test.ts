import { describe, expect, it } from 'vitest';
import { listBuiltinLLMProviderPresets } from '@lucid-fin/contracts';
import { enUSMessages } from '../../i18n.messages.en-US.js';
import { zhCNMessages } from '../../i18n.messages.zh-CN.js';
import { buildSparseSettings, getProviderMetadata, PROVIDER_REGISTRY, settingsSlice } from './settings.js';

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

  it('defines capability metadata for every built-in provider', () => {
    for (const [group, providers] of Object.entries(PROVIDER_REGISTRY)) {
      for (const provider of providers) {
        const metadata = getProviderMetadata(group as keyof typeof PROVIDER_REGISTRY, provider.id);
        expect(metadata, `missing metadata for ${group}:${provider.id}`).toBeDefined();
        expect(metadata?.capabilities.length, `missing capabilities for ${group}:${provider.id}`).toBeGreaterThan(0);

        if (metadata?.capabilities.includes('image-to-image') || metadata?.capabilities.includes('image-to-video')) {
          expect(metadata.supportsReferenceImage).toBe(true);
        }

        if (provider.kind === 'hub') {
          expect(metadata?.notes).toBeTruthy();
        }
      }
    }
  });

  it('captures default output expectations for representative providers', () => {
    expect(getProviderMetadata('llm', 'openrouter')).toMatchObject({
      capabilities: [
        'text-generation',
        'script-expand',
        'scene-breakdown',
        'character-extract',
        'prompt-enhance',
      ],
      notes: 'Capabilities depend on selected model',
    });

    expect(getProviderMetadata('image', 'openai-image')).toMatchObject({
      capabilities: ['text-to-image'],
      defaultResolution: '1024x1024',
      outputFormats: ['png', 'jpeg', 'webp'],
    });

    expect(getProviderMetadata('video', 'runway')).toMatchObject({
      capabilities: ['text-to-video', 'image-to-video'],
      supportsReferenceImage: true,
      defaultResolution: '1920x1080',
      defaultDurationSeconds: 5,
      outputFormats: ['mp4'],
    });
    expect(getProviderMetadata('video', 'google-video')).toMatchObject({
      supportsAudio: true,
    });
    expect(getProviderMetadata('video', 'kling')).toMatchObject({
      supportsAudio: true,
      qualityTiers: ['std', 'pro'],
    });

    expect(getProviderMetadata('audio', 'openai-tts')).toMatchObject({
      capabilities: ['text-to-voice'],
      outputFormats: ['mp3'],
    });
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

describe('provider capability i18n', () => {
  it('defines capability and output labels in both supported locales', () => {
    expect(enUSMessages.settings.providerCard.capabilitiesTitle).toBeTruthy();
    expect(enUSMessages.settings.providerCard.capabilityLabels.textToVideo).toBe('Text to Video');
    expect(enUSMessages.settings.providerCard.capabilityBadges.t2v).toBe('T2V');
    expect(enUSMessages.settings.providerCard.outputLabels.resolution).toBe('Resolution');
    expect(enUSMessages.settings.providerCard.outputLabels.duration).toBe('Duration');
    expect(enUSMessages.settings.providerCard.outputLabels.formats).toBe('Format');
    expect(enUSMessages.settings.providerCard.outputLabels.referenceImage).toBe('Ref Image');
    expect(enUSMessages.settings.providerCard.outputLabels.notes).toBe('Note');
    expect(enUSMessages.settings.providerCard.capabilityNotes.modelDependent).toBe(
      'Capabilities depend on selected model',
    );

    expect(zhCNMessages.settings.providerCard.capabilitiesTitle).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.capabilityLabels.textToVideo).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.capabilityBadges.t2v).toBe('T2V');
    expect(zhCNMessages.settings.providerCard.outputLabels.resolution).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.outputLabels.duration).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.outputLabels.formats).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.outputLabels.referenceImage).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.outputLabels.notes).toBeTruthy();
    expect(zhCNMessages.settings.providerCard.capabilityNotes.modelDependent).toBeTruthy();
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
              model: 'gpt-5.4',
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
              model: 'gpt-5.4-mini-tts',
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
      'gpt-5.4',
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

  it('preserves built-in provider endpoint and model overrides while keeping registry names', () => {
    const restored = settingsSlice.reducer(undefined, {
      type: settingsSlice.actions.restore.type,
      payload: {
        llm: {
          providers: [
            {
              id: 'openai',
              name: 'Renamed OpenAI',
              baseUrl: 'https://proxy.example.com/v1',
              model: 'gpt-5.4-mini',
              hasKey: false,
              isCustom: false,
            },
          ],
        },
      },
    });

    expect(restored.llm.providers.find((provider) => provider.id === 'openai')).toMatchObject({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-5.4-mini',
      isCustom: false,
    });
  });

  it('resets built-in providers back to registry defaults', () => {
    let state = settingsSlice.reducer(
      undefined,
      settingsSlice.actions.setProviderBaseUrl({
        group: 'llm',
        provider: 'openai',
        url: 'https://proxy.example.com/v1',
      }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.setProviderModel({
        group: 'llm',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.resetProviderToDefaults({
        group: 'llm',
        provider: 'openai',
      }),
    );

    expect(state.llm.providers.find((provider) => provider.id === 'openai')).toMatchObject({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
      protocol: 'openai-compatible',
      authStyle: 'bearer',
    });
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

  it('commits all provider config fields atomically via commitProvider', () => {
    const state = settingsSlice.reducer(
      undefined,
      settingsSlice.actions.commitProvider({
        group: 'llm',
        providerId: 'openai',
        config: {
          baseUrl: 'https://proxy.example.com/v1',
          model: 'gpt-5.4-mini',
        },
      }),
    );

    expect(state.llm.providers.find((p) => p.id === 'openai')).toMatchObject({
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-5.4-mini',
      name: 'OpenAI',
    });
  });

  it('commitProvider normalizes protocol and authStyle for LLM providers', () => {
    let state = settingsSlice.reducer(
      undefined,
      settingsSlice.actions.addCustomProvider({
        group: 'llm',
        id: 'custom-commit-test',
        name: 'Test',
      }),
    );

    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.commitProvider({
        group: 'llm',
        providerId: 'custom-commit-test',
        config: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'gemini-2.5-flash',
          protocol: 'gemini',
          name: 'Gemini Custom',
        },
      }),
    );

    const provider = state.llm.providers.find((p) => p.id === 'custom-commit-test');
    expect(provider).toMatchObject({
      protocol: 'gemini',
      authStyle: 'x-goog-api-key',
      name: 'Gemini Custom',
    });
  });

  it('commitProvider only updates name for custom providers', () => {
    const state = settingsSlice.reducer(
      undefined,
      settingsSlice.actions.commitProvider({
        group: 'llm',
        providerId: 'openai',
        config: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          name: 'Should Not Change',
        },
      }),
    );

    expect(state.llm.providers.find((p) => p.id === 'openai')?.name).toBe('OpenAI');
  });
});

describe('buildSparseSettings', () => {
  it('excludes untouched default providers', () => {
    const state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    const sparse = buildSparseSettings(state);

    expect(sparse.llm.providers).toHaveLength(0);
    expect(sparse.image.providers).toHaveLength(0);
    expect(sparse.video.providers).toHaveLength(0);
    expect(sparse.audio.providers).toHaveLength(0);
    expect(sparse.vision.providers).toHaveLength(0);
    expect(sparse.renderPreset).toBe('standard');
  });

  it('includes providers with hasKey set', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.setProviderHasKey({ group: 'llm', provider: 'openai', hasKey: true }),
    );

    const sparse = buildSparseSettings(state);
    expect(sparse.llm.providers).toHaveLength(1);
    expect(sparse.llm.providers[0].id).toBe('openai');
  });

  it('includes providers with customized baseUrl', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.setProviderBaseUrl({
        group: 'image',
        provider: 'openai-image',
        url: 'https://proxy.example.com/v1',
      }),
    );

    const sparse = buildSparseSettings(state);
    expect(sparse.image.providers).toHaveLength(1);
    expect(sparse.image.providers[0].baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('includes custom providers', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.addCustomProvider({
        group: 'llm',
        id: 'custom-sparse-test',
        name: 'Sparse Test',
      }),
    );

    const sparse = buildSparseSettings(state);
    expect(sparse.llm.providers).toHaveLength(1);
    expect(sparse.llm.providers[0].id).toBe('custom-sparse-test');
  });

  it('preserves hasKey in persisted output', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.setProviderHasKey({ group: 'llm', provider: 'openai', hasKey: true }),
    );

    const sparse = buildSparseSettings(state);
    expect(sparse.llm.providers[0]).toHaveProperty('hasKey', true);
  });

  it('preserves renderPreset', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(state, settingsSlice.actions.setRenderPreset('cinematic'));

    const sparse = buildSparseSettings(state);
    expect(sparse.renderPreset).toBe('cinematic');
  });
});
