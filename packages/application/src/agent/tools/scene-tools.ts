import type { Scene } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface SceneToolDeps {
  listScenes: () => Promise<Scene[]>;
  createScene: (scene: Scene) => Promise<void>;
  updateScene: (scene: Scene) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
}

export function createSceneTools(deps: SceneToolDeps): AgentTool[] {
  const sceneList: AgentTool = {
    name: 'scene.list',
    description: 'List all scenes in the current project.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args) {
      try {
        const scenes = await deps.listScenes();
        return { success: true, data: scenes };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const sceneCreate: AgentTool = {
    name: 'scene.create',
    description: 'Create a new scene in the current project.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID this scene belongs to.' },
        title: { type: 'string', description: 'The scene title.' },
        description: { type: 'string', description: 'A brief description of the scene.' },
        location: { type: 'string', description: 'The scene location.' },
        timeOfDay: { type: 'string', description: 'Time of day for the scene.' },
        characters: {
          type: 'array',
          description: 'List of character IDs in this scene.',
          items: { type: 'string', description: 'Character ID' },
        },
      },
      required: ['projectId', 'title', 'description', 'location', 'timeOfDay'],
    },
    async execute(args) {
      try {
        const scenes = await deps.listScenes();
        const now = Date.now();
        const scene: Scene = {
          id: crypto.randomUUID(),
          projectId: args.projectId as string,
          index: scenes.length,
          title: args.title as string,
          description: args.description as string,
          location: args.location as string,
          timeOfDay: args.timeOfDay as string,
          characters: (args.characters as string[]) ?? [],
          keyframes: [],
          segments: [],
          createdAt: now,
          updatedAt: now,
        };
        await deps.createScene(scene);
        return { success: true, data: scene };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const sceneUpdate: AgentTool = {
    name: 'scene.update',
    description: 'Update an existing scene by ID.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The scene ID to update.' },
        title: { type: 'string', description: 'Updated scene title.' },
        description: { type: 'string', description: 'Updated scene description.' },
        location: { type: 'string', description: 'Updated scene location.' },
        timeOfDay: { type: 'string', description: 'Updated time of day.' },
        characters: {
          type: 'array',
          description: 'Updated list of character IDs.',
          items: { type: 'string', description: 'Character ID' },
        },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const scenes = await deps.listScenes();
        const existing = scenes.find((s) => s.id === args.id);
        if (!existing) {
          return { success: false, error: `Scene not found: ${args.id}` };
        }
        const updated: Scene = {
          ...existing,
          ...(args.title !== undefined && { title: args.title as string }),
          ...(args.description !== undefined && { description: args.description as string }),
          ...(args.location !== undefined && { location: args.location as string }),
          ...(args.timeOfDay !== undefined && { timeOfDay: args.timeOfDay as string }),
          ...(args.characters !== undefined && { characters: args.characters as string[] }),
          updatedAt: Date.now(),
        };
        await deps.updateScene(updated);
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const sceneDelete: AgentTool = {
    name: 'scene.delete',
    description: 'Delete a scene by ID.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The scene ID to delete.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        await deps.deleteScene(args.id as string);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [sceneList, sceneCreate, sceneUpdate, sceneDelete];
}
