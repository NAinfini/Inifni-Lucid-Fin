import { describe, it, expect } from 'vitest';
import {
  assembleKeyframePrompt,
  assembleSegmentPrompt,
  assembleNegativePrompt,
} from '../src/prompt-assembler.js';
import type { Scene, Character, StyleGuide, Keyframe, SceneSegment } from '@lucid-fin/contracts';

function makeScene(overrides?: Partial<Scene>): Scene {
  return {
    id: 's1',
    index: 0,
    title: 'Test Scene',
    description: 'A dark alley',
    location: 'Alley',
    timeOfDay: 'Night',
    characters: ['c1'],
    keyframes: [],
    segments: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeChar(overrides?: Partial<Character>): Character {
  return {
    id: 'c1',
    name: 'Hero',
    role: 'protagonist',
    description: 'Brave',
    appearance: 'tall, dark hair',
    personality: 'bold',
    costumes: [],
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeStyle(overrides?: Partial<StyleGuide>): StyleGuide {
  return {
    global: {
      artStyle: 'cinematic',
      lighting: 'dramatic',
      texture: 'film grain',
      colorPalette: { primary: '#000', secondary: '#fff', forbidden: [] },
      referenceImages: [],
      freeformDescription: '',
    },
    sceneOverrides: {},
    ...overrides,
  };
}

function makeKeyframe(overrides?: Partial<Keyframe>): Keyframe {
  return {
    id: 'k1',
    sceneId: 's1',
    index: 0,
    prompt: 'hero walks forward',
    status: 'draft',
    variants: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeSegment(overrides?: Partial<SceneSegment>): SceneSegment {
  return {
    id: 'seg1',
    sceneId: 's1',
    startKeyframeId: 'k1',
    endKeyframeId: 'k2',
    motion: 'walking',
    camera: 'tracking shot',
    mood: 'tense',
    duration: 5,
    ...overrides,
  };
}

describe('assembleKeyframePrompt', () => {
  it('includes scene context, character, keyframe prompt, and style', () => {
    const result = assembleKeyframePrompt(makeScene(), [makeChar()], makeStyle(), makeKeyframe());
    expect(result).toContain('Scene: Test Scene');
    expect(result).toContain('Location: Alley');
    expect(result).toContain('Time: Night');
    expect(result).toContain('Hero — tall, dark hair');
    expect(result).toContain('hero walks forward');
    expect(result).toContain('Style: cinematic');
    expect(result).toContain('Lighting: dramatic');
  });

  it('omits missing optional fields', () => {
    const scene = makeScene({ location: '', timeOfDay: '', description: '' });
    const result = assembleKeyframePrompt(scene, [], makeStyle(), makeKeyframe());
    expect(result).not.toContain('Location:');
    expect(result).not.toContain('Time:');
    expect(result).not.toContain('Characters:');
  });

  it('applies scene style overrides', () => {
    const style = makeStyle({ sceneOverrides: { s1: { artStyle: 'anime' } } });
    const result = assembleKeyframePrompt(makeScene(), [], style, makeKeyframe());
    expect(result).toContain('Style: anime');
    expect(result).not.toContain('Style: cinematic');
  });

  it('matches characters by name as well as id', () => {
    const scene = makeScene({ characters: ['Hero'] });
    const result = assembleKeyframePrompt(scene, [makeChar()], makeStyle(), makeKeyframe());
    expect(result).toContain('Hero — tall, dark hair');
  });
});

describe('assembleSegmentPrompt', () => {
  it('includes motion, camera, mood, and duration', () => {
    const result = assembleSegmentPrompt(makeSegment(), makeScene(), [makeChar()], makeStyle());
    expect(result).toContain('Motion: walking');
    expect(result).toContain('Camera: tracking shot');
    expect(result).toContain('Mood: tense');
    expect(result).toContain('Duration: 5s');
  });

  it('omits missing segment fields', () => {
    const seg = makeSegment({ motion: '', camera: '', mood: '' });
    const result = assembleSegmentPrompt(seg, makeScene(), [], makeStyle());
    expect(result).not.toContain('Motion:');
    expect(result).not.toContain('Camera:');
    expect(result).not.toContain('Mood:');
  });
});

describe('assembleNegativePrompt', () => {
  it('combines global and segment negatives', () => {
    expect(assembleNegativePrompt('blurry', 'text')).toBe('blurry, text');
  });

  it('handles missing parts', () => {
    expect(assembleNegativePrompt('blurry')).toBe('blurry');
    expect(assembleNegativePrompt(undefined, 'text')).toBe('text');
    expect(assembleNegativePrompt()).toBe('');
  });
});
