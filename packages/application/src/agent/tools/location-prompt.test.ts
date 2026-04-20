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
  it('builds a five-frame bible composite for the default view', () => {
    const prompt = buildLocationRefImagePrompt(createLocation(), { kind: 'bible' });

    expect(prompt).toContain('Environment concept art bible');
    expect(prompt).toContain('Five-frame composite on one image');
    expect(prompt).toContain('wide establishing shot');
    expect(prompt).toContain('interior detail study');
    expect(prompt).toContain('atmosphere study');
    expect(prompt).toContain('primary key camera angle');
    expect(prompt).toContain('alternate key camera angle');
    expect(prompt).toContain('No characters, no people');
    expect(prompt).toContain('Architecture: art deco');
  });

  it('builds an 8-panel fake-360 pseudo-panorama', () => {
    const prompt = buildLocationRefImagePrompt(createLocation(), { kind: 'fake-360' });

    expect(prompt).toContain('pseudo-panorama');
    expect(prompt).toContain('Eight panels arranged in a 4x2 grid');
    expect(prompt).toContain('0°, 45°, 90°, 135°');
    expect(prompt).toContain('180°, 225°, 270°, 315°');
    expect(prompt).toContain('No characters, no people');
  });

  it('builds an extra-angle prompt with the angle label', () => {
    const prompt = buildLocationRefImagePrompt(createLocation(), {
      kind: 'extra-angle',
      angle: 'low-angle wide',
    });

    expect(prompt).toContain('low-angle wide camera angle');
    expect(prompt).toContain('No characters, no people');
  });

  it('prepends stylePlate to every view kind', () => {
    const bible = buildLocationRefImagePrompt(
      createLocation(),
      { kind: 'bible' },
      'neo-noir watercolor',
    );
    expect(bible.indexOf('Style: neo-noir watercolor')).toBe(0);

    const f360 = buildLocationRefImagePrompt(
      createLocation(),
      { kind: 'fake-360' },
      'muted teal palette',
    );
    expect(f360.indexOf('Style: muted teal palette')).toBe(0);
  });
});
