import { describe, expect, it, vi } from 'vitest';
import { createCharacterTools, type CharacterToolDeps } from './character-tools.js';

function createDeps(): CharacterToolDeps {
  return {
    listCharacters: vi.fn(async () => []),
    saveCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
  };
}

describe('createCharacterTools', () => {
  it('assigns expected tags to character tools', () => {
    const deps = createDeps();
    const tools = createCharacterTools(deps);

    expect(tools.find((tool) => tool.name === 'character.list')?.tags).toEqual(['character', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'character.create')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.update')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.delete')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.generateReferenceImage')?.tags).toEqual(['character', 'generation']);
    expect(tools.find((tool) => tool.name === 'character.setReferenceImage')?.tags).toEqual(['character', 'mutate']);
    expect(tools.find((tool) => tool.name === 'character.deleteReferenceImage')?.tags).toEqual(['character', 'mutate']);
  });
});
