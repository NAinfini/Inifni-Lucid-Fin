import { describe, expect, it, vi } from 'vitest';
import type { Keyframe } from '@lucid-fin/contracts';
import { createStoryboardTools, type StoryboardToolDeps } from './storyboard-tools.js';

const keyframes: Keyframe[] = [
  {
    id: 'kf-1',
    sceneId: 'scene-1',
    prompt: 'opening shot',
    negativePrompt: 'blur',
    imageAssetId: null,
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
  },
];

function createDeps(): StoryboardToolDeps {
  return {
    listKeyframes: vi.fn(async () => keyframes),
    updateKeyframe: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: StoryboardToolDeps) {
  const tool = createStoryboardTools(deps).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

describe('createStoryboardTools', () => {
  it('defines storyboard tools scoped to storyboard context', () => {
    const deps = createDeps();
    const tools = createStoryboardTools(deps);

    expect(tools.map((tool) => tool.name)).toEqual([
      'storyboard.listKeyframes',
      'storyboard.updateKeyframe',
    ]);
    expect(tools.every((tool) => tool.context?.includes('storyboard'))).toBe(true);
  });

  it('lists keyframes and updates an existing keyframe', async () => {
    const deps = createDeps();

    await expect(getTool('storyboard.listKeyframes', deps).execute({ sceneId: 'scene-1' })).resolves.toEqual({
      success: true,
      data: keyframes,
    });
    await expect(getTool('storyboard.updateKeyframe', deps).execute({
      sceneId: 'scene-1',
      id: 'kf-1',
      prompt: 'updated shot',
      status: 'approved',
    })).resolves.toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'kf-1',
        prompt: 'updated shot',
        status: 'approved',
      }),
    });
    expect(deps.updateKeyframe).toHaveBeenCalledWith(expect.objectContaining({
      id: 'kf-1',
      prompt: 'updated shot',
      status: 'approved',
    }));
  });

  it('returns not-found and dependency errors', async () => {
    const deps = createDeps();

    await expect(getTool('storyboard.updateKeyframe', deps).execute({
      sceneId: 'scene-1',
      id: 'missing',
    })).resolves.toEqual({
      success: false,
      error: 'Keyframe not found: missing',
    });
    vi.mocked(deps.listKeyframes).mockRejectedValueOnce(new Error('list failed'));
    await expect(getTool('storyboard.listKeyframes', deps).execute({ sceneId: 'scene-1' })).resolves.toEqual({
      success: false,
      error: 'list failed',
    });
  });
});
