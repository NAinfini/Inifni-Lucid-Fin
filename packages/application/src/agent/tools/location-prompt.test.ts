import type { Location } from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { buildLocationRefImagePrompt } from './location-prompt.js';

function createLocation(overrides?: Partial<Location>): Location {
  return {
    id: 'loc-1',
    name: 'Old Arcade',
    description: 'abandoned shopping arcade with cracked terrazzo floors',
    timeOfDay: 'dusk',
    mood: 'uneasy nostalgia',
    weather: 'recent rain',
    lighting: 'late sunlight through broken skylights',
    architectureStyle: 'art deco',
    dominantColors: ['oxidized green', 'amber'],
    keyFeatures: ['collapsed ticket booth', 'arched storefronts'],
    atmosphereKeywords: ['dusty', 'echoing'],
    tags: ['urban', 'decay'],
    referenceImages: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('buildLocationRefImagePrompt', () => {
  it('adds slot-specific atmosphere language while excluding characters', () => {
    const prompt = buildLocationRefImagePrompt(createLocation(), 'atmosphere');

    expect(prompt).toContain('light filters through dusty panes');
    expect(prompt).toContain('rain collects in gutter channels');
    expect(prompt).toContain('No characters, no people');
  });

  it('uses detail-oriented process language for close detail slots', () => {
    const prompt = buildLocationRefImagePrompt(createLocation(), 'interior-detail');

    expect(prompt).toContain('shadows pool in recessed doorways');
    expect(prompt).toContain('architectural close detail study');
    expect(prompt).toContain('No characters, no people');
  });
});
