import { describe, expect, it } from 'vitest';
import { settingsSlice } from './settings.js';

describe('settings defaults', () => {
  it('uses the curated provider shortlist for each model group', () => {
    const state = settingsSlice.reducer(undefined, { type: '@@INIT' });

    expect(state.llm.activeProvider).toBe('openai');
    expect(state.llm.providers.map(({ id, model }) => ({ id, model }))).toEqual([
      { id: 'openai', model: 'gpt-4.1' },
      { id: 'claude', model: 'claude-opus-4-6' },
      { id: 'gemini', model: 'gemini-2.5-flash' },
      { id: 'deepseek', model: 'deepseek-chat' },
      { id: 'grok', model: 'grok-4.20' },
    ]);

    expect(state.image.activeProvider).toBe('openai-image');
    expect(state.image.providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual([
      { id: 'openai-image', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5' },
      { id: 'google-imagen3', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'imagen-4.0-ultra-generate-001' },
      { id: 'flux', baseUrl: 'https://api.replicate.com/v1', model: 'FLUX.2-pro' },
      { id: 'recraft-v4', baseUrl: 'https://external.api.recraft.ai/v1', model: 'recraftv4' },
      { id: 'ideogram', baseUrl: 'https://api.ideogram.ai', model: 'ideogram-v3' },
    ]);

    expect(state.video.activeProvider).toBe('google-veo-2');
    expect(state.video.providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual([
      { id: 'google-veo-2', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'veo-3.1-generate-preview' },
      { id: 'runway-gen4', baseUrl: 'https://api.dev.runwayml.com/v1', model: 'gen4.5' },
      { id: 'luma-ray2', baseUrl: 'https://api.lumalabs.ai/dream-machine/v1', model: 'ray-3' },
      { id: 'minimax-video01', baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Hailuo-2.3' },
      { id: 'pika-v2', baseUrl: 'https://api.pika.art/v1', model: 'pika-2.5' },
    ]);

    expect(state.audio.activeProvider).toBe('elevenlabs');
    expect(state.audio.providers.map(({ id, baseUrl, model }) => ({ id, baseUrl, model }))).toEqual([
      { id: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io/v1', model: 'eleven_v3' },
      { id: 'fish-audio-v1', baseUrl: 'https://api.fish.audio/v1', model: 's2-pro' },
      { id: 'cartesia-sonic', baseUrl: 'https://api.cartesia.ai', model: 'sonic-3' },
      { id: 'playht-3', baseUrl: 'https://api.play.ht/api/v2', model: 'PlayDialog' },
      { id: 'openai-tts', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts' },
    ]);
  });

  it('migrates saved settings onto the current shortlist while preserving custom providers', () => {
    const restored = settingsSlice.reducer(undefined, {
      type: settingsSlice.actions.restore.type,
      payload: {
        llm: {
          providers: [
            { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', hasKey: false, isCustom: false },
            { id: 'qwen', name: 'Qwen (Alibaba)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hasKey: false, isCustom: false },
            { id: 'custom-llm-1', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/awesome', hasKey: true, isCustom: true },
          ],
          activeProvider: 'custom-llm-1',
        },
        image: {
          providers: [
            { id: 'openai-image', name: 'OpenAI GPT Image', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1.5', hasKey: false, isCustom: false },
          ],
          activeProvider: 'openai-image',
        },
        video: {
          providers: [
            { id: 'kling', name: 'Kling AI', baseUrl: 'https://api.klingai.com/v1', model: 'kling-v2.1', hasKey: false, isCustom: false },
            { id: 'custom-video-1', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'alibaba/wan-2.6', hasKey: true, isCustom: true },
          ],
          activeProvider: 'kling',
        },
        audio: {
          providers: [
            { id: 'elevenlabs', name: 'ElevenLabs TTS', baseUrl: 'https://api.elevenlabs.io', model: 'eleven_multilingual_v2', hasKey: false, isCustom: false },
          ],
          activeProvider: 'elevenlabs',
        },
        renderPreset: 'high',
      },
    });

    expect(restored.llm.providers.map((provider) => provider.id)).toEqual([
      'openai',
      'claude',
      'gemini',
      'deepseek',
      'grok',
      'custom-llm-1',
    ]);
    expect(restored.llm.providers.find((provider) => provider.id === 'openai')?.model).toBe('gpt-4.1');
    expect(restored.llm.providers.find((provider) => provider.id === 'custom-llm-1')).toMatchObject({
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openrouter/awesome',
      isCustom: true,
    });
    expect(restored.llm.activeProvider).toBe('custom-llm-1');

    expect(restored.video.providers.map((provider) => provider.id)).toEqual([
      'google-veo-2',
      'runway-gen4',
      'luma-ray2',
      'minimax-video01',
      'pika-v2',
      'custom-video-1',
    ]);
    expect(restored.video.activeProvider).toBe('google-veo-2');
    expect(restored.renderPreset).toBe('high');
  });
});
