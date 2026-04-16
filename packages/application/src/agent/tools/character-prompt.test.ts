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

  it('builds a turnaround sheet for main/front slots', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), 'front');

    expect(prompt).toContain('Character turnaround sheet for production reference');
    expect(prompt).toContain('Wide landscape composition (3:2 aspect ratio)');
    expect(prompt).toContain('front view, left profile, right profile, rear view');
    expect(prompt).toContain('Two-row model sheet layout');
    expect(prompt).toContain('Full body visible in every body panel');
    expect(prompt).toContain('Do not collapse the sheet into a single portrait');
    expect(prompt).toContain('enlarged head studies');
    expect(prompt).toContain('Solid white background, even studio lighting, single character only');
  });

  it('treats default-like aliases as the main turnaround sheet slot', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), 'default');

    expect(prompt).toContain('Character turnaround sheet for production reference');
    expect(prompt).not.toContain('Single-view character reference');
    expect(prompt).not.toContain('default angle');
  });

  it('builds a back-view prompt for rear-facing slots', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), 'back');

    expect(prompt).toContain('Full-body rear view');
    expect(prompt).toContain('same costume from behind');
    expect(prompt).toContain('hair shape, cape, backpack, and back-fastening details');
    expect(prompt).toContain('Tall portrait composition (2:3 aspect ratio)');
  });

  it('builds a face close-up prompt with neutral expression', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), 'face-closeup');

    expect(prompt).toContain('Facial expression reference sheet');
    expect(prompt).toContain('Six head-and-shoulders panels');
    expect(prompt).toContain('neutral, happy, sad, angry, surprised, and determined expressions');
    expect(prompt).toContain('same face shape, same hairstyle, same colors, and same lighting');
    expect(prompt).toContain('Solid white background, even studio lighting, single character only');
  });

  it('falls back to a generic single-view prompt for unknown slots', () => {
    const prompt = buildCharacterRefImagePrompt(createCharacter(), 'three-quarter-high');

    expect(prompt).toContain('Single-view character reference');
    expect(prompt).toContain('three-quarter-high angle');
    expect(prompt).toContain('Tall portrait composition (2:3 aspect ratio)');
  });
});
