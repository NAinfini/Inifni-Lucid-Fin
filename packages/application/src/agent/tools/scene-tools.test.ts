import { describe, expect, it, vi } from 'vitest';
import type { Scene } from '@lucid-fin/contracts';
import { createSceneTools, type SceneToolDeps } from './scene-tools.js';

function createDeps(scenes: Scene[]): SceneToolDeps {
  return {
    listScenes: vi.fn(async () => scenes),
    createScene: vi.fn(async () => undefined),
    updateScene: vi.fn(async () => undefined),
    deleteScene: vi.fn(async () => undefined),
  };
}

const baseScene: Omit<Scene, 'id' | 'title' | 'description'> = {
  projectId: 'p1',
  index: 0,
  location: 'somewhere',
  timeOfDay: 'day',
  characters: [],
  keyframes: [],
  segments: [],
  createdAt: 0,
  updatedAt: 0,
};

describe('createSceneTools', () => {
  it('assigns expected tags to scene tools', () => {
    const tools = createSceneTools(createDeps([]));

    expect(tools.find((tool) => tool.name === 'scene.list')?.tags).toEqual(['scene', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'scene.create')?.tags).toEqual(['scene', 'mutate']);
    expect(tools.find((tool) => tool.name === 'scene.update')?.tags).toEqual(['scene', 'mutate']);
    expect(tools.find((tool) => tool.name === 'scene.delete')?.tags).toEqual(['scene', 'mutate']);
  });

  describe('scene.list query filter', () => {
    const scenes: Scene[] = [
      { ...baseScene, id: '1', title: 'Opening Act', description: 'hero arrives in the city' },
      { ...baseScene, id: '2', title: 'Chase Scene', description: 'villain pursues the protagonist' },
      { ...baseScene, id: '3', title: 'Resolution', description: 'a quiet moment of reflection' },
    ];

    it('returns all scenes when no query is provided', async () => {
      const tool = createSceneTools(createDeps(scenes)).find((t) => t.name === 'scene.list')!;
      const result = await tool.execute({});
      expect(result).toMatchObject({ success: true, data: { total: 3 } });
    });

    it('filters by title (case-insensitive)', async () => {
      const tool = createSceneTools(createDeps(scenes)).find((t) => t.name === 'scene.list')!;
      const result = await tool.execute({ query: 'chase' });
      expect(result).toMatchObject({ success: true, data: { total: 1, scenes: [expect.objectContaining({ id: '2' })] } });
    });

    it('filters by description (OR logic)', async () => {
      const tool = createSceneTools(createDeps(scenes)).find((t) => t.name === 'scene.list')!;
      const result = await tool.execute({ query: 'reflection' });
      expect(result).toMatchObject({ success: true, data: { total: 1, scenes: [expect.objectContaining({ id: '3' })] } });
    });

    it('returns empty when query matches nothing', async () => {
      const tool = createSceneTools(createDeps(scenes)).find((t) => t.name === 'scene.list')!;
      const result = await tool.execute({ query: 'xyz123' });
      expect(result).toMatchObject({ success: true, data: { total: 0, scenes: [] } });
    });
  });
});

