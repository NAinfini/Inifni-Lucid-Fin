import { describe, expect, it } from 'vitest';
import { listBuiltinLLMProviderPresets } from '@lucid-fin/contracts';
import { enUSMessages } from '../../i18n.messages.en-US.js';
import { zhCNMessages } from '../../i18n.messages.zh-CN.js';
import {
  buildSparseSettings,
  getProviderMetadata,
  PROVIDER_REGISTRY,
  settingsSlice,
} from './settings.js';

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
        expect(
          metadata?.capabilities.length,
          `missing capabilities for ${group}:${provider.id}`,
        ).toBeGreaterThan(0);

        if (
          metadata?.capabilities.includes('image-to-image') ||
          metadata?.capabilities.includes('image-to-video')
        ) {
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

describe('usage stats reducers', () => {
  it('recordToolCall increments totalToolCalls and toolFrequency', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordToolCall({ toolName: 'search' }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordToolCall({ toolName: 'search' }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordToolCall({ toolName: 'write', error: true }),
    );

    expect(state.usage.totalToolCalls).toBe(3);
    expect(state.usage.toolFrequency['search']).toBe(2);
    expect(state.usage.toolFrequency['write']).toBe(1);
    expect(state.usage.toolErrors['write']).toBe(1);
    expect(state.usage.toolErrors['search']).toBeUndefined();
  });

  it('recordToolCall limits recentTools to 50 entries', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    for (let i = 0; i < 55; i++) {
      state = settingsSlice.reducer(
        state,
        settingsSlice.actions.recordToolCall({ toolName: `tool-${i}` }),
      );
    }

    expect(state.usage.recentTools).toHaveLength(50);
    expect(state.usage.recentTools[0]).toBe('tool-5');
    expect(state.usage.recentTools[49]).toBe('tool-54');
  });

  it('recordSession updates running averages and counters', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordSession({ durationMs: 1000, toolCount: 4, turnCount: 2 }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordSession({
        durationMs: 3000,
        toolCount: 8,
        turnCount: 6,
        cancelled: true,
      }),
    );

    expect(state.usage.sessionCount).toBe(2);
    expect(state.usage.totalSessionDurationMs).toBe(4000);
    expect(state.usage.cancelledSessions).toBe(1);
    expect(state.usage.failedSessions).toBe(0);
    expect(state.usage.avgToolsPerSession).toBe(6); // (4 + 8) / 2
    expect(state.usage.avgTurnsPerSession).toBe(4); // (2 + 6) / 2
  });

  it('recordGeneration tracks count, total time, and running success rate', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordGeneration({ type: 'image', success: true, durationMs: 500 }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordGeneration({ type: 'image', success: false, durationMs: 200 }),
    );

    expect(state.usage.generationCount['image']).toBe(2);
    expect(state.usage.totalGenerationTimeMs).toBe(700);
    // After first success (rate = 1): rate = 1 + (1 - 1) / 1 = 1
    // After second failure (rate = 1): rate = 1 + (0 - 1) / 2 = 0.5
    expect(state.usage.generationSuccessRate['image']).toBe(0.5);
  });

  it('recordProviderRequest updates provider usage stats with running average latency', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordProviderRequest({ providerId: 'openai', latencyMs: 100 }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordProviderRequest({
        providerId: 'openai',
        latencyMs: 300,
        error: true,
      }),
    );

    const openai = state.usage.providerUsage['openai'];
    expect(openai).toBeDefined();
    expect(openai.requestCount).toBe(2);
    expect(openai.errorCount).toBe(1);
    expect(openai.avgLatencyMs).toBe(200); // (100 + 300) / 2
    expect(openai.lastUsed).not.toBe('');
  });

  it('recordProjectActivity increments counters', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordProjectActivity({ nodesCreated: 3, edgesCreated: 2 }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordProjectActivity({ entitiesCreated: 5, snapshotsUsed: 1 }),
    );

    expect(state.usage.nodesCreated).toBe(3);
    expect(state.usage.edgesCreated).toBe(2);
    expect(state.usage.entitiesCreated).toBe(5);
    expect(state.usage.snapshotsUsed).toBe(1);
  });

  it('updateDailyActive accumulates minutes per date', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.updateDailyActive({ date: '2026-04-11', minutes: 30 }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.updateDailyActive({ date: '2026-04-11', minutes: 15 }),
    );
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.updateDailyActive({ date: '2026-04-10', minutes: 60 }),
    );

    expect(state.usage.dailyActiveMinutes['2026-04-11']).toBe(45);
    expect(state.usage.dailyActiveMinutes['2026-04-10']).toBe(60);
  });

  it('buildSparseSettings includes usage in persisted output', () => {
    let state = settingsSlice.reducer(undefined, { type: '@@INIT' });
    state = settingsSlice.reducer(
      state,
      settingsSlice.actions.recordToolCall({ toolName: 'search' }),
    );

    const sparse = buildSparseSettings(state);
    expect(sparse.usage).toBeDefined();
    expect(sparse.usage.totalToolCalls).toBe(1);
  });

  it('restore merges saved usage with initialUsageStats defaults', () => {
    const restored = settingsSlice.reducer(undefined, {
      type: settingsSlice.actions.restore.type,
      payload: {
        usage: { totalToolCalls: 42, sessionCount: 5 },
      },
    });

    expect(restored.usage.totalToolCalls).toBe(42);
    expect(restored.usage.sessionCount).toBe(5);
    // Fields not in saved usage fall back to defaults
    expect(restored.usage.toolFrequency).toEqual({});
    expect(restored.usage.nodesCreated).toBe(0);
  });
});

describe('provider merge on restore', () => {
  function restoreWith(saved: Parameters<typeof settingsSlice.actions.restore>[0]) {
    return settingsSlice.reducer(undefined, settingsSlice.actions.restore(saved));
  }

  it('preserves user-customized model when baseUrl is unchanged', () => {
    const state = restoreWith({
      image: {
        providers: [
          {
            id: 'openai-image',
            name: 'OpenAI GPT Image',
            baseUrl: 'https://api.openai.com/v1',
            model: 'dall-e-3',
            hasKey: true,
            isCustom: false,
          },
        ],
      },
    });
    const provider = state.image.providers.find((p) => p.id === 'openai-image');
    expect(provider).toBeDefined();
    expect(provider!.model).toBe('dall-e-3');
    expect(provider!.hasKey).toBe(true);
  });

  it('preserves user-customized model AND baseUrl together', () => {
    const state = restoreWith({
      llm: {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://my-proxy.example.com/v1',
            model: 'gpt-4o',
            hasKey: true,
            isCustom: false,
          },
        ],
      },
    });
    const provider = state.llm.providers.find((p) => p.id === 'openai');
    expect(provider!.baseUrl).toBe('https://my-proxy.example.com/v1');
    expect(provider!.model).toBe('gpt-4o');
  });

  it('uses default model when saved model matches defaults', () => {
    const defaultProvider = PROVIDER_REGISTRY.llm.find((p) => p.id === 'openai');
    const state = restoreWith({
      llm: {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: defaultProvider!.baseUrl,
            model: defaultProvider!.model,
            hasKey: false,
            isCustom: false,
          },
        ],
      },
    });
    const provider = state.llm.providers.find((p) => p.id === 'openai');
    expect(provider!.model).toBe(defaultProvider!.model);
  });

  it('restores custom providers alongside built-in ones', () => {
    const state = restoreWith({
      llm: {
        providers: [
          {
            id: 'my-custom-llm',
            name: 'My LLM',
            baseUrl: 'https://custom.example.com',
            model: 'custom-model',
            hasKey: true,
            isCustom: true,
          },
        ],
      },
    });
    const custom = state.llm.providers.find((p) => p.id === 'my-custom-llm');
    expect(custom).toBeDefined();
    expect(custom!.isCustom).toBe(true);
    expect(custom!.model).toBe('custom-model');
  });

  it('adds new built-in providers that did not exist in saved state', () => {
    const state = restoreWith({
      llm: { providers: [] },
    });
    expect(state.llm.providers.length).toBeGreaterThan(0);
    expect(state.llm.providers.every((p) => !p.isCustom)).toBe(true);
  });
});
