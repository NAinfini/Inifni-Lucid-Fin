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

  describe('character.list query filter', () => {
    const characters = [
      { id: '1', name: 'Alice', role: 'protagonist', description: 'a brave hero', appearance: '', personality: '', costumes: [], referenceImages: [], loadouts: [], defaultLoadoutId: '', tags: [], createdAt: 0, updatedAt: 0 },
      { id: '2', name: 'Bob', role: 'antagonist', description: 'a villain', appearance: '', personality: '', costumes: [], referenceImages: [], loadouts: [], defaultLoadoutId: '', tags: [], createdAt: 0, updatedAt: 0 },
      { id: '3', name: 'Carol', role: 'supporting', description: 'a mentor figure', appearance: '', personality: '', costumes: [], referenceImages: [], loadouts: [], defaultLoadoutId: '', tags: [], createdAt: 0, updatedAt: 0 },
    ];

    function createDepsWithData() {
      const deps = createDeps();
      vi.mocked(deps.listCharacters).mockResolvedValue(characters as never);
      return deps;
    }

    it('returns all characters when no query is provided', async () => {
      const deps = createDepsWithData();
      const tool = createCharacterTools(deps).find((t) => t.name === 'character.list')!;
      const result = await tool.execute({});
      expect(result).toMatchObject({ success: true, data: { total: 3 } });
    });

    it('filters by name (case-insensitive)', async () => {
      const deps = createDepsWithData();
      const tool = createCharacterTools(deps).find((t) => t.name === 'character.list')!;
      const result = await tool.execute({ query: 'alice' });
      expect(result).toMatchObject({ success: true, data: { total: 1, characters: [expect.objectContaining({ id: '1' })] } });
    });

    it('filters by role (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createCharacterTools(deps).find((t) => t.name === 'character.list')!;
      const result = await tool.execute({ query: 'antagonist' });
      expect(result).toMatchObject({ success: true, data: { total: 1, characters: [expect.objectContaining({ id: '2' })] } });
    });

    it('filters by description (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createCharacterTools(deps).find((t) => t.name === 'character.list')!;
      const result = await tool.execute({ query: 'mentor' });
      expect(result).toMatchObject({ success: true, data: { total: 1, characters: [expect.objectContaining({ id: '3' })] } });
    });

    it('returns empty when query matches nothing', async () => {
      const deps = createDepsWithData();
      const tool = createCharacterTools(deps).find((t) => t.name === 'character.list')!;
      const result = await tool.execute({ query: 'xyz123' });
      expect(result).toMatchObject({ success: true, data: { total: 0, characters: [] } });
    });
  });
});

