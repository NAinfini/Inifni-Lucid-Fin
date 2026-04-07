import { describe, expect, it } from 'vitest';
import { PROVIDER_REGISTRY, settingsSlice } from './settings.js';

describe('provider registry metadata', () => {
  it('defines official providers and API hubs with docs and model guidance', () => {
    expect(
      PROVIDER_REGISTRY.llm.map(({ id, kind, keyUrl, modelExample }) => ({
        id,
        kind,
        hasKeyUrl: Boolean(keyUrl),
        modelExample: modelExample ?? null,
      })),
    ).toEqual([
      { id: 'openai', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'claude', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'gemini', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'grok', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'deepseek', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'mistral', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'cohere', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'openrouter', kind: 'hub', hasKeyUrl: true, modelExample: 'openai/gpt-4o' },
      {
        id: 'together',
        kind: 'hub',
        hasKeyUrl: true,
        modelExample: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      },
      { id: 'groq', kind: 'hub', hasKeyUrl: true, modelExample: 'llama-3.3-70b-versatile' },
      { id: 'qwen', kind: 'official', hasKeyUrl: true, modelExample: null },
      { id: 'ollama-local', kind: 'official', hasKeyUrl: true, modelExample: null },
    ]);

    expect(PROVIDER_REGISTRY.image.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'openai-image', kind: 'official' },
      { id: 'google-image', kind: 'official' },
      { id: 'flux', kind: 'hub' },
      { id: 'recraft', kind: 'official' },
      { id: 'ideogram', kind: 'official' },
      { id: 'replicate', kind: 'hub' },
      { id: 'fal', kind: 'hub' },
      { id: 'together', kind: 'hub' },
    ]);

    expect(
      PROVIDER_REGISTRY.video.map(({ id, kind, modelExample }) => ({
        id,
        kind,
        modelExample: modelExample ?? null,
      })),
    ).toEqual([
      { id: 'google-video', kind: 'official', modelExample: null },
      { id: 'runway', kind: 'official', modelExample: null },
      { id: 'luma', kind: 'official', modelExample: null },
      { id: 'minimax', kind: 'official', modelExample: null },
      { id: 'pika', kind: 'official', modelExample: null },
      { id: 'replicate', kind: 'hub', modelExample: 'minimax/video-01' },
      { id: 'fal', kind: 'hub', modelExample: 'fal-ai/minimax/video-01' },
      { id: 'together', kind: 'hub', modelExample: null },
    ]);

    expect(
      PROVIDER_REGISTRY.audio.map(({ id, kind, modelExample }) => ({
        id,
        kind,
        modelExample: modelExample ?? null,
      })),
    ).toEqual([
      { id: 'openai-tts', kind: 'official', modelExample: null },
      { id: 'elevenlabs', kind: 'official', modelExample: null },
      { id: 'cartesia', kind: 'official', modelExample: null },
      { id: 'playht', kind: 'official', modelExample: null },
      { id: 'fish-audio', kind: 'official', modelExample: null },
      { id: 'together', kind: 'hub', modelExample: null },
      { id: 'replicate', kind: 'hub', modelExample: 'suno-ai/bark' },
      { id: 'fal', kind: 'hub', modelExample: 'fal-ai/stable-audio' },
    ]);
  });
});

describe('settings defaults', () => {
  it('uses the registry-driven provider shortlist for each model group', () => {
    const state = settingsSlice.reducer(undefined, { type: '@@INIT' });

    expect('activeProvider' in state.llm).toBe(false);
    expect(
      state.llm.providers.map(({ id, model, protocol, authStyle }) => ({
        id,
        model,
        protocol,
        authStyle,
      })),
    ).toEqual([
      { id: 'openai', model: 'gpt-4.1', protocol: 'openai-compatible', authStyle: 'bearer' },
      {
        id: 'claude',
        model: 'claude-sonnet-4-20250514',
        protocol: 'anthropic',
        authStyle: 'x-api-key',
      },
      { id: 'gemini', model: 'gemini-2.5-flash', protocol: 'gemini', authStyle: 'x-goog-api-key' },
      { id: 'grok', model: 'grok-3', protocol: 'openai-compatible', authStyle: 'bearer' },
      {
        id: 'deepseek',
        model: 'deepseek-chat',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      },
      {
        id: 'mistral',
        model: 'mistral-large-latest',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      },
      { id: 'cohere', model: 'command-a-03-2025', protocol: 'cohere', authStyle: 'bearer' },
      {
        id: 'openrouter',
        model: 'openai/gpt-4o',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      },
      {
        id: 'together',
        model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      },
      {
        id: 'groq',
        model: 'llama-3.3-70b-versatile',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      },
      {
        id: 'qwen',
        model: 'qwen-plus',
        protocol: 'openai-compatible',
        authStyle: 'bearer',
      },
      {
        id: 'ollama-local',
        model: 'llama3.1',
        protocol: 'openai-compatible',
        authStyle: 'none',
      },
    ]);

    expect('activeProvider' in state.image).toBe(false);
    expect(state.image.providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual(
      [
        { id: 'openai-image', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1' },
        {
          id: 'google-image',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'imagen-4.0-generate-001',
        },
        {
          id: 'flux',
          baseUrl: 'https://api.replicate.com/v1',
          model: 'black-forest-labs/flux-schnell',
        },
        { id: 'recraft', baseUrl: 'https://external.api.recraft.ai/v1', model: 'recraftv4' },
        { id: 'ideogram', baseUrl: 'https://api.ideogram.ai', model: 'ideogram-v3' },
        {
          id: 'replicate',
          baseUrl: 'https://api.replicate.com/v1',
          model: 'black-forest-labs/flux-1.1-pro',
        },
        {
          id: 'fal',
          baseUrl: 'https://fal.run/fal-ai/flux-pro/v1.1',
          model: 'fal-ai/flux-pro/v1.1',
        },
        {
          id: 'together',
          baseUrl: 'https://api.together.xyz/v1',
          model: 'black-forest-labs/FLUX.1-schnell',
        },
      ],
    );

    expect('activeProvider' in state.video).toBe(false);
    expect(state.video.providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual(
      [
        {
          id: 'google-video',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          model: 'veo-3.0-generate-001',
        },
        { id: 'runway', baseUrl: 'https://api.dev.runwayml.com/v1', model: 'gen4.5' },
        { id: 'luma', baseUrl: 'https://api.lumalabs.ai/dream-machine/v1', model: 'ray-2' },
        { id: 'minimax', baseUrl: 'https://api.minimax.chat/v1', model: 'T2V-02' },
        { id: 'pika', baseUrl: 'https://api.pika.art/v1', model: 'pika-2.5' },
        { id: 'replicate', baseUrl: 'https://api.replicate.com/v1', model: 'minimax/video-01' },
        {
          id: 'fal',
          baseUrl: 'https://fal.run/fal-ai/minimax/video-01',
          model: 'fal-ai/minimax/video-01',
        },
        { id: 'together', baseUrl: 'https://api.together.xyz/v1', model: '' },
      ],
    );

    expect('activeProvider' in state.audio).toBe(false);
    expect(state.audio.providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual(
      [
        { id: 'openai-tts', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' },
        { id: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', model: 'eleven_v3' },
        { id: 'cartesia', baseUrl: 'https://api.cartesia.ai', model: 'sonic-3' },
        { id: 'playht', baseUrl: 'https://api.play.ht/api/v2', model: 'PlayDialog' },
        { id: 'fish-audio', baseUrl: 'https://api.fish.audio/v1', model: 's2-pro' },
        { id: 'together', baseUrl: 'https://api.together.xyz/v1', model: '' },
        { id: 'replicate', baseUrl: 'https://api.replicate.com/v1', model: 'suno-ai/bark' },
        { id: 'fal', baseUrl: 'https://fal.run/fal-ai/stable-audio', model: 'fal-ai/stable-audio' },
      ],
    );
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
      'openai',
      'claude',
      'gemini',
      'grok',
      'deepseek',
      'mistral',
      'cohere',
      'openrouter',
      'together',
      'groq',
      'qwen',
      'ollama-local',
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
      'google-video',
      'runway',
      'luma',
      'minimax',
      'pika',
      'replicate',
      'fal',
      'together',
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
