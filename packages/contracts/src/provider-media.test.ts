import { describe, expect, it } from 'vitest';
import {
  getBuiltinProviderCapabilityProfile,
  listBuiltinAudioGenerationProviders,
  listBuiltinVideoProvidersWithAudio,
} from './provider-media.js';

describe('provider media metadata', () => {
  it('resolves capability profiles through canonical ids and aliases', () => {
    expect(getBuiltinProviderCapabilityProfile('google-veo-2')).toMatchObject({
      type: 'video',
      supportsAudio: true,
      durationRange: [3, 10],
    });
    expect(getBuiltinProviderCapabilityProfile('google-video')).toMatchObject({
      type: 'video',
      supportsAudio: true,
      durationRange: [3, 10],
    });
    expect(getBuiltinProviderCapabilityProfile('seedance')).toMatchObject({
      type: 'video',
      supportsAudio: true,
      durationRange: [5, 15],
    });
    expect(getBuiltinProviderCapabilityProfile('pixverse')).toMatchObject({
      type: 'video',
      supportsAudio: true,
      durationRange: [1, 15],
    });
    expect(getBuiltinProviderCapabilityProfile('alibaba-wan-video')).toMatchObject({
      type: 'video',
      supportsAudio: true,
      durationRange: [2, 15],
    });
    expect(getBuiltinProviderCapabilityProfile('openai-image')).toMatchObject({
      type: 'image',
      qualityTiers: ['low', 'medium', 'high', 'auto'],
    });
    expect(getBuiltinProviderCapabilityProfile('codex-imagegen')).toMatchObject({
      type: 'image',
      resolutions: ['1024x1024'],
      maxDimension: 1024,
    });
    expect(getBuiltinProviderCapabilityProfile('recraft')).toMatchObject({
      type: 'image',
    });
    expect(getBuiltinProviderCapabilityProfile('bria')).toMatchObject({
      type: 'image',
      qualityTiers: ['1MP', '4MP'],
    });
  });

  it('lists runtime and settings IDs for audio-capable video providers without duplicates', () => {
    expect(listBuiltinVideoProvidersWithAudio()).toEqual(
      expect.arrayContaining([
        'google-veo-2',
        'google-video',
        'kling-v1',
        'minimax',
        'pixverse',
        'alibaba-wan-video',
        'segmind',
      ]),
    );
    const providers = listBuiltinVideoProvidersWithAudio();
    expect(new Set(providers).size).toBe(providers.length);
  });

  it('lists built-in audio generation providers by type', () => {
    expect(listBuiltinAudioGenerationProviders('voice')).toEqual([
      { id: 'elevenlabs-v2', name: 'ElevenLabs', type: 'voice' },
      { id: 'openai-tts-1-hd', name: 'OpenAI TTS', type: 'voice' },
      { id: 'fish-audio-v1', name: 'Fish Audio', type: 'voice' },
    ]);
    expect(listBuiltinAudioGenerationProviders('music')).toEqual([
      { id: 'suno-v4', name: 'Suno AI', type: 'music' },
      { id: 'udio-v1', name: 'Udio', type: 'music' },
    ]);
    expect(listBuiltinAudioGenerationProviders('sfx')).toEqual([
      { id: 'stability-audio-v2', name: 'Stability Audio', type: 'sfx' },
    ]);
  });
});
