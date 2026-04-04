import type { Keyframe } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface StoryboardToolDeps {
  listKeyframes: (sceneId: string) => Promise<Keyframe[]>;
  updateKeyframe: (keyframe: Keyframe) => Promise<void>;
}

export function createStoryboardTools(deps: StoryboardToolDeps): AgentTool[] {
  const storyboardListKeyframes: AgentTool = {
    name: 'storyboard.listKeyframes',
    description: 'List all keyframes for a scene.',
    context: ['storyboard'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'The scene ID to list keyframes for.' },
      },
      required: ['sceneId'],
    },
    async execute(args) {
      try {
        const keyframes = await deps.listKeyframes(args.sceneId as string);
        return { success: true, data: keyframes };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const storyboardUpdateKeyframe: AgentTool = {
    name: 'storyboard.updateKeyframe',
    description: 'Update a keyframe prompt or properties.',
    context: ['storyboard'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'The scene ID containing the keyframe.' },
        id: { type: 'string', description: 'The keyframe ID to update.' },
        prompt: { type: 'string', description: 'Updated image generation prompt.' },
        negativePrompt: { type: 'string', description: 'Updated negative prompt.' },
        status: {
          type: 'string',
          description: 'Updated keyframe status.',
          enum: ['draft', 'generating', 'review', 'approved', 'rejected'],
        },
      },
      required: ['sceneId', 'id'],
    },
    async execute(args) {
      try {
        const keyframes = await deps.listKeyframes(args.sceneId as string);
        const existing = keyframes.find((k) => k.id === args.id);
        if (!existing) {
          return { success: false, error: `Keyframe not found: ${args.id}` };
        }
        const updated: Keyframe = {
          ...existing,
          ...(args.prompt !== undefined && { prompt: args.prompt as string }),
          ...(args.negativePrompt !== undefined && {
            negativePrompt: args.negativePrompt as string,
          }),
          ...(args.status !== undefined && { status: args.status as Keyframe['status'] }),
          updatedAt: Date.now(),
        };
        await deps.updateKeyframe(updated);
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [storyboardListKeyframes, storyboardUpdateKeyframe];
}
