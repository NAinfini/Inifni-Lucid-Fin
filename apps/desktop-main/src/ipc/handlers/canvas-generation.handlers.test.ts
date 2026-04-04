import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESET_LIBRARY, createEmptyPresetTrackSet, type StyleGuide } from '@lucid-fin/contracts';
import {
  applyStyleGuideDefaultsToEmptyTracks,
  canonicalizeCanvasProviderId,
} from './canvas-generation.handlers.js';

function makeStyleGuide(overrides?: Partial<StyleGuide['global']>): StyleGuide {
  return {
    global: {
      artStyle: '',
      colorPalette: { primary: '', secondary: '', forbidden: [] },
      lighting: 'natural',
      texture: '',
      referenceImages: [],
      freeformDescription: '',
      ...overrides,
    },
    sceneOverrides: {},
  };
}

describe('applyStyleGuideDefaultsToEmptyTracks', () => {
  it('fills empty look and scene tracks from style guide defaults', () => {
    const tracks = createEmptyPresetTrackSet();

    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({
        artStyle: 'cinematic realism',
        lighting: 'dramatic',
      }),
      BUILT_IN_PRESET_LIBRARY,
    );

    expect(result.look.aiDecide).toBe(false);
    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('builtin-look-cinematic-realism');
    expect(result.scene.aiDecide).toBe(false);
    expect(result.scene.entries).toHaveLength(1);
    expect(result.scene.entries[0]?.presetId).toBe('scene:low-key');
  });

  it('preserves existing tracks and only fills empty ones', () => {
    const tracks = createEmptyPresetTrackSet();
    tracks.look = {
      category: 'look',
      aiDecide: false,
      entries: [
        {
          id: 'existing-look',
          category: 'look',
          presetId: 'look:anime-cel',
          params: {},
          order: 0,
        },
      ],
    };

    const result = applyStyleGuideDefaultsToEmptyTracks(
      tracks,
      makeStyleGuide({
        artStyle: 'cinematic realism',
        lighting: 'neon',
      }),
      BUILT_IN_PRESET_LIBRARY,
    );

    expect(result.look.entries).toHaveLength(1);
    expect(result.look.entries[0]?.presetId).toBe('look:anime-cel');
    expect(result.scene.entries[0]?.presetId).toBe('scene:neon-noir');
  });
});

describe('canonicalizeCanvasProviderId', () => {
  it('maps legacy provider ids to the current adapter ids', () => {
    expect(canonicalizeCanvasProviderId('runway')).toBe('runway-gen4');
    expect(canonicalizeCanvasProviderId('veo')).toBe('google-veo-2');
    expect(canonicalizeCanvasProviderId('pika')).toBe('pika-v2');
    expect(canonicalizeCanvasProviderId('openai-dalle')).toBe('openai-image');
    expect(canonicalizeCanvasProviderId('fish-audio')).toBe('fish-audio-v1');
  });

  it('passes through already-canonical ids', () => {
    expect(canonicalizeCanvasProviderId('runway-gen4')).toBe('runway-gen4');
    expect(canonicalizeCanvasProviderId('google-veo-2')).toBe('google-veo-2');
    expect(canonicalizeCanvasProviderId(undefined)).toBeUndefined();
  });
});
