import { describe, expect, it } from 'vitest';
import { createDraft } from './utils.js';
import type { Character } from '@lucid-fin/contracts';

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    name: 'Alice',
    role: 'protagonist',
    description: 'A hero',
    appearance: 'Tall',
    personality: 'Brave',
    costumes: [],
    tags: [],
    referenceImages: [],
    loadouts: [],
    defaultLoadoutId: '',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('createDraft', () => {
  it('maps core fields directly', () => {
    const char = makeCharacter({
      id: 'c2',
      name: 'Bob',
      role: 'antagonist',
      description: 'A villain',
      appearance: 'Short',
      personality: 'Cunning',
    });
    const draft = createDraft(char);
    expect(draft.id).toBe('c2');
    expect(draft.name).toBe('Bob');
    expect(draft.role).toBe('antagonist');
    expect(draft.description).toBe('A villain');
    expect(draft.appearance).toBe('Short');
    expect(draft.personality).toBe('Cunning');
  });

  it('joins tags array into comma-separated string', () => {
    const char = makeCharacter({ tags: ['action', 'drama', 'sci-fi'] });
    expect(createDraft(char).tags).toBe('action, drama, sci-fi');
  });

  it('converts age number to string', () => {
    const char = makeCharacter({ age: 30 });
    expect(createDraft(char).age).toBe('30');
  });

  it('sets age to empty string when age is undefined', () => {
    const char = makeCharacter({ age: undefined });
    expect(createDraft(char).age).toBe('');
  });

  it('uses gender value when present', () => {
    const char = makeCharacter({ gender: 'female' });
    expect(createDraft(char).gender).toBe('female');
  });

  it('sets gender to empty string when gender is undefined', () => {
    const char = makeCharacter({ gender: undefined });
    expect(createDraft(char).gender).toBe('');
  });

  it('uses voice when present', () => {
    const char = makeCharacter({ voice: 'deep' });
    expect(createDraft(char).voice).toBe('deep');
  });

  it('sets voice to empty string when voice is undefined', () => {
    expect(createDraft(makeCharacter()).voice).toBe('');
  });

  it('maps face object', () => {
    const face = { eyeColor: 'blue', noseType: 'button' };
    const char = makeCharacter({ face });
    expect(createDraft(char).face).toEqual(face);
  });

  it('defaults face to empty object when undefined', () => {
    expect(createDraft(makeCharacter({ face: undefined })).face).toEqual({});
  });

  it('maps hair object', () => {
    const hair = { color: 'brown', style: 'curly' };
    const char = makeCharacter({ hair });
    expect(createDraft(char).hair).toEqual(hair);
  });

  it('defaults hair to empty object when undefined', () => {
    expect(createDraft(makeCharacter({ hair: undefined })).hair).toEqual({});
  });

  it('maps skinTone', () => {
    expect(createDraft(makeCharacter({ skinTone: 'olive' })).skinTone).toBe('olive');
  });

  it('defaults skinTone to empty string when undefined', () => {
    expect(createDraft(makeCharacter({ skinTone: undefined })).skinTone).toBe('');
  });

  it('maps body object', () => {
    const body = { height: 'tall', build: 'athletic' };
    expect(createDraft(makeCharacter({ body })).body).toEqual(body);
  });

  it('defaults body to empty object when undefined', () => {
    expect(createDraft(makeCharacter({ body: undefined })).body).toEqual({});
  });

  it('joins distinctTraits array into comma-separated string', () => {
    const char = makeCharacter({ distinctTraits: ['scar', 'tattoo'] });
    expect(createDraft(char).distinctTraits).toBe('scar, tattoo');
  });

  it('defaults distinctTraits to empty string when undefined', () => {
    expect(createDraft(makeCharacter({ distinctTraits: undefined })).distinctTraits).toBe('');
  });

  it('maps vocalTraits object', () => {
    const vocalTraits = { pitch: 'high', accent: 'British' };
    expect(createDraft(makeCharacter({ vocalTraits })).vocalTraits).toEqual(vocalTraits);
  });

  it('defaults vocalTraits to empty object when undefined', () => {
    expect(createDraft(makeCharacter({ vocalTraits: undefined })).vocalTraits).toEqual({});
  });

  it('handles empty tags array', () => {
    expect(createDraft(makeCharacter({ tags: [] })).tags).toBe('');
  });
});
