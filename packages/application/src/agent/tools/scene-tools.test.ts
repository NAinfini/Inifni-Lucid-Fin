import { describe, expect, it, vi } from 'vitest';
import type { KeyframeStatus, Scene } from '@lucid-fin/contracts';
import { createSceneTools, type SceneToolDeps } from './scene-tools.js';

function createScene(
  overrides: Partial<Scene> & { keyframeStatuses?: KeyframeStatus[] },
): Scene {
  const { keyframeStatuses = [], ...sceneOverrides } = overrides;
  return {
    id: 'scene-1',
    projectId: 'project-1',
    index: 0,
    title: 'Opening',
    description: 'First scene',
    location: 'Warehouse',
    timeOfDay: 'Night',
    characters: [],
    keyframes: keyframeStatuses.map((status, index) => ({
      id: `keyframe-${index + 1}`,
      sceneId: sceneOverrides.id ?? 'scene-1',
      index,
      prompt: `Prompt ${index + 1}`,
      status,
      variants: [],
      createdAt: 1,
      updatedAt: 1,
    })),
    segments: [],
    createdAt: 1,
    updatedAt: 1,
    ...sceneOverrides,
  };
}

function createDeps(scenes: Scene[]): SceneToolDeps {
  return {
    listScenes: vi.fn(async () => scenes),
    createScene: vi.fn(async () => undefined),
    updateScene: vi.fn(async () => undefined),
    deleteScene: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: SceneToolDeps) {
  const tool = createSceneTools(deps).find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }
  return tool;
}

describe('createSceneTools', () => {
  it('assigns expected tags and exposes scene.search', () => {
    const tools = createSceneTools(createDeps([]));

    expect(tools.find((tool) => tool.name === 'scene.list')?.tags).toEqual(['scene', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'scene.search')?.tags).toEqual(['scene', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'scene.create')?.tags).toEqual(['scene', 'mutate']);
    expect(tools.find((tool) => tool.name === 'scene.update')?.tags).toEqual(['scene', 'mutate']);
    expect(tools.find((tool) => tool.name === 'scene.delete')?.tags).toEqual(['scene', 'mutate']);
  });

  it('searches scenes by title substring and exact status', async () => {
    const deps = createDeps([
      createScene({ id: 'scene-1', title: 'Warehouse Arrival', keyframeStatuses: ['draft'] }),
      createScene({ id: 'scene-2', title: 'Warehouse Escape', keyframeStatuses: ['approved', 'approved'] }),
      createScene({ id: 'scene-3', title: 'Rooftop', keyframeStatuses: ['review'] }),
    ]);

    const result = await getTool('scene.search', deps).execute({
      query: 'warehouse',
      status: 'approved',
    });

    expect(result).toEqual({
      success: true,
      data: [{ id: 'scene-2', title: 'Warehouse Escape', status: 'approved' }],
    });
  });

  it('treats scenes without keyframes as draft summaries', async () => {
    const deps = createDeps([
      createScene({ id: 'scene-1', title: 'Empty Scene' }),
    ]);

    const result = await getTool('scene.search', deps).execute({
      status: 'draft',
    });

    expect(result).toEqual({
      success: true,
      data: [{ id: 'scene-1', title: 'Empty Scene', status: 'draft' }],
    });
  });
});
