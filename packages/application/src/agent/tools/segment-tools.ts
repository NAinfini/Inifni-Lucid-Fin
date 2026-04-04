import type { SceneSegment } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface SegmentToolDeps {
  listSegments: (sceneId: string) => Promise<SceneSegment[]>;
  saveSegment: (segment: SceneSegment) => Promise<void>;
  deleteSegment: (id: string) => Promise<void>;
}

export function createSegmentTools(deps: SegmentToolDeps): AgentTool[] {
  const segmentList: AgentTool = {
    name: 'segment.list',
    description: 'List all segments in a scene.',
    context: ['orchestrator'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'The scene ID to list segments for.' },
      },
      required: ['sceneId'],
    },
    async execute(args) {
      try {
        const segments = await deps.listSegments(args.sceneId as string);
        return { success: true, data: segments };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const segmentUpdate: AgentTool = {
    name: 'segment.update',
    description: 'Update properties of an existing segment.',
    context: ['orchestrator'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        sceneId: { type: 'string', description: 'The scene ID that contains the segment.' },
        id: { type: 'string', description: 'The segment ID to update.' },
        motion: {
          type: 'string',
          description: 'Motion preset for the segment.',
          enum: ['static', 'slow', 'medium', 'fast', 'dynamic'],
        },
        camera: {
          type: 'string',
          description: 'Camera movement preset.',
          enum: [
            'fixed',
            'pan-left',
            'pan-right',
            'tilt-up',
            'tilt-down',
            'zoom-in',
            'zoom-out',
            'dolly',
          ],
        },
        mood: {
          type: 'string',
          description: 'Mood preset for the segment.',
          enum: [
            'neutral',
            'happy',
            'sad',
            'tense',
            'romantic',
            'dramatic',
            'mysterious',
            'action',
          ],
        },
        moodIntensity: { type: 'number', description: 'Mood intensity from 0.0 to 1.0.' },
        duration: { type: 'number', description: 'Segment duration in seconds.' },
        negativePrompt: { type: 'string', description: 'Negative prompt for generation.' },
      },
      required: ['sceneId', 'id'],
    },
    async execute(args) {
      try {
        const segments = await deps.listSegments(args.sceneId as string);
        const existing = segments.find((s) => s.id === args.id);
        if (!existing) {
          return { success: false, error: `Segment not found: ${args.id}` };
        }
        const updated: SceneSegment = {
          ...existing,
          ...(args.motion !== undefined && { motion: args.motion as string }),
          ...(args.camera !== undefined && { camera: args.camera as string }),
          ...(args.mood !== undefined && { mood: args.mood as string }),
          ...(args.moodIntensity !== undefined && { moodIntensity: args.moodIntensity as number }),
          ...(args.duration !== undefined && { duration: args.duration as number }),
          ...(args.negativePrompt !== undefined && {
            negativePrompt: args.negativePrompt as string,
          }),
        };
        await deps.saveSegment(updated);
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [segmentList, segmentUpdate];
}
