import type { Character } from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildCharacterAppearancePrompt,
  buildCharacterRefImagePrompt,
} from './character-prompt.js';

function createCharacter(overrides?: Partial<Character>): Character {
  return {
    id: 'char-1',
    name: 'Captain Mire',
    role: 'protagonist',
    description: 'battle-scarred expedition leader',
    appearance: 'weathered explorer with a disciplined stance',
    personality: 'focused and calm',
    costumes: [
      {
        id: 'costume-1',
        name: 'Field Coat',
        description:
          'waxed canvas coat with matte brass buckles, layered wool scarf, reinforced leather straps',
      },
    ],
    tags: ['explorer'],
    age: 42,
    gender: 'female',
    face: {
      eyeShape: 'almond',
      eyeColor: 'hazel',
      noseType: 'straight',
      lipShape: 'full',
      jawline: 'square',
      definingFeatures: 'small scar through left eyebrow',
    },
    hair: {
      color: 'black',
      length: 'shoulder-length',
      style: 'braided',
      texture: 'wavy',
    },
    skinTone: 'warm olive',
    body: {
      height: 'tall',
      build: 'athletic',
      proportions: 'long-limbed silhouette',
    },
    distinctTraits: ['weathered hands', 'compass tattoo on wrist'],
    referenceImages: [],
    loadouts: [],
    defaultLoadoutId: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('character prompt builders', () => {
  it('builds a structured appearance prompt with material-aware costume language', () => {
    const prompt = buildCharacterAppearancePrompt(createCharacter());

    expect(prompt).toContain('Face: almond eyes, hazel irises');
    expect(prompt).toContain('Hair: black hair, shoulder-length length, braided style, wavy texture');
    expect(prompt).toContain('Costume materials and textures:');
    expect(prompt).toContain('Field Coat');
    expect(prompt).toContain('waxed canvas coat with matte brass buckles');
  });

  it('builds a full-sheet composite prompt for the default view', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), { kind: 'full-sheet' });

    expect(prompt).toContain('Character turnaround and expression sheet');
    expect(prompt).toContain('three horizontal bands');
    expect(prompt).toContain('front, left profile, right profile, and rear');
    expect(prompt).toContain('six head-and-shoulders expression panels');
    expect(prompt).toContain('neutral, happy, sad, angry, surprised, and determined');
    expect(prompt).toContain('Solid white background, even studio lighting, single character only');
  });

  it('builds an extra-angle prompt with the angle label', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), {
      kind: 'extra-angle',
      angle: 'three-quarter overhead',
    });

    expect(prompt).toContain('Full-body three-quarter overhead character reference');
    expect(prompt).toContain('solid white background');
    expect(prompt).not.toContain('turnaround and expression sheet');
  });

  it('prepends stylePlate as the first prompt segment for full-sheet', () => {
    const prompt = buildCharacterRefImagePrompt(
      createCharacter(),
      { kind: 'full-sheet' },
      'neo-noir watercolor, muted teal palette',
    );

    // Style prompt must appear before the "Character turnaround" header.
    const styleIdx = prompt.indexOf('Style: neo-noir watercolor, muted teal palette');
    const sheetIdx = prompt.indexOf('Character turnaround and expression sheet');
    expect(styleIdx).toBeGreaterThanOrEqual(0);
    expect(sheetIdx).toBeGreaterThan(styleIdx);
  });

  it('prepends stylePlate for extra-angle views too', () => {
    const prompt = buildCharacterRefImagePrompt(
      createCharacter(),
      { kind: 'extra-angle', angle: 'action pose' },
      'soft chiaroscuro lighting',
    );
    expect(prompt.indexOf('Style: soft chiaroscuro lighting')).toBe(0);
  });
});
