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

describe('createSceneTools', () => {
  it('assigns expected tags to scene tools', () => {
    const tools = createSceneTools(createDeps([]));

    expect(tools.find((tool) => tool.name === 'scene.list')?.tags).toEqual(['scene', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'scene.create')?.tags).toEqual(['scene', 'mutate']);
    expect(tools.find((tool) => tool.name === 'scene.update')?.tags).toEqual(['scene', 'mutate']);
    expect(tools.find((tool) => tool.name === 'scene.delete')?.tags).toEqual(['scene', 'mutate']);
  });
});
