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
      durationRange: [5, 8],
    });
    expect(getBuiltinProviderCapabilityProfile('google-video')).toMatchObject({
      type: 'video',
      supportsAudio: true,
      durationRange: [5, 8],
    });
    expect(getBuiltinProviderCapabilityProfile('openai-image')).toMatchObject({
      type: 'image',
      qualityTiers: ['standard', 'hd'],
    });
    expect(getBuiltinProviderCapabilityProfile('recraft')).toMatchObject({
      type: 'image',
    });
  });

  it('lists canonical audio-capable video providers', () => {
    expect(listBuiltinVideoProvidersWithAudio()).toEqual(
      expect.arrayContaining(['google-veo-2', 'kling-v1']),
    );
    expect(listBuiltinVideoProvidersWithAudio()).not.toContain('google-video');
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
