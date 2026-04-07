import { describe, expect, it, vi } from 'vitest';
import type { Character } from '@lucid-fin/contracts';
import { createCharacterTools, type CharacterToolDeps } from './character-tools.js';

function createCharacter(overrides: Partial<Character>): Character {
  return {
    id: 'char-1',
    name: 'Alice',
    role: 'protagonist',
    description: 'Lead character',
    appearance: 'Tall',
    personality: 'Focused',
    costumes: [],
    tags: [],
    referenceImages: [],
    loadouts: [],
    defaultLoadoutId: '',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createDeps(characters: Character[]): CharacterToolDeps {
  return {
    listCharacters: vi.fn(async () => characters),
    saveCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: CharacterToolDeps) {
  const tool = createCharacterTools(deps).find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }
  return tool;
}

describe('createCharacterTools', () => {
  it('assigns expected tags to character tools', () => {
    const deps = createDeps([]);
    const tools = createCharacterTools(deps);

    expect(tools.find((tool) => tool.name === 'character.list')?.tags).toEqual(['character', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'character.create')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.update')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.delete')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.generateReferenceImage')?.tags).toEqual(['character', 'generation']);
    expect(tools.find((tool) => tool.name === 'character.setReferenceImage')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.deleteReferenceImage')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.search')?.tags).toEqual(['character', 'read', 'search']);
  });

  it('searches characters by name substring and exact role', async () => {
    const deps = createDeps([
      createCharacter({ id: 'char-1', name: 'Alice', role: 'protagonist' }),
      createCharacter({ id: 'char-2', name: 'Alicia', role: 'supporting' }),
      createCharacter({ id: 'char-3', name: 'Bob', role: 'supporting' }),
    ]);

    const result = await getTool('character.search', deps).execute({
      query: 'ali',
      role: 'supporting',
    });

    expect(result).toEqual({
      success: true,
      data: [{ id: 'char-2', name: 'Alicia', role: 'supporting' }],
    });
  });
});
