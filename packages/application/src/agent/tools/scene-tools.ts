import type {
  Canvas,
  KeyframeStatus,
  ReferenceImage,
  Scene,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { createRefImageTool } from './ref-image-factory.js';
import { extractSet, warnExtraKeys } from './tool-result-helpers.js';

export interface SceneToolDeps {
  listScenes: () => Promise<Scene[]>;
  createScene: (scene: Scene) => Promise<void>;
  updateScene: (scene: Scene) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

type SceneWithReferenceImages = Scene & { referenceImages?: ReferenceImage[] };

function _deriveSceneStatus(scene: Scene): KeyframeStatus {
  if (scene.keyframes.some((keyframe) => keyframe.status === 'generating')) {
    return 'generating';
  }
  if (scene.keyframes.some((keyframe) => keyframe.status === 'review')) {
    return 'review';
  }
  if (scene.keyframes.some((keyframe) => keyframe.status === 'rejected')) {
    return 'rejected';
  }
  if (scene.keyframes.length > 0 && scene.keyframes.every((keyframe) => keyframe.status === 'approved')) {
    return 'approved';
  }
  return 'draft';
}

export function createSceneTools(deps: SceneToolDeps): AgentTool[] {
  const sceneList: AgentTool = {
    name: 'scene.list',
    description: 'List all scenes in the current project.',
    tags: ['scene', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search query. Matches against title or description (case-insensitive OR logic).' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const scenes = await deps.listScenes();
        const query = typeof args.query === 'string' && args.query.length > 0
          ? args.query.toLowerCase()
          : undefined;
        let filtered = scenes;
        if (query) {
          filtered = filtered.filter((s) =>
            s.title?.toLowerCase().includes(query) ||
            s.description?.toLowerCase().includes(query),
          );
        }
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return { success: true, data: { total: filtered.length, offset, limit, scenes: filtered.slice(offset, offset + limit) } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const sceneCreate: AgentTool = {
    name: 'scene.create',
    description: 'Create a new scene in the current project.',
    tags: ['scene', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
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
      required: ['title', 'description', 'location', 'timeOfDay'],
    },
    async execute(args) {
      try {
        const scenes = await deps.listScenes();
        const now = Date.now();
        const scene: Scene = {
          id: crypto.randomUUID(),
          index: scenes.length,
          title: args.title as string,
          description: args.description as string,
          location: args.location as string,
          timeOfDay: args.timeOfDay as string,
          characters: Array.isArray(args.characters)
            ? (args.characters as unknown[]).filter((c): c is string => typeof c === 'string')
            : [],
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
    description: 'Update an existing scene by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched.',
    tags: ['scene', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The scene ID to update.' },
        set: {
          type: 'object',
          description: 'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
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
        },
      },
      required: ['id', 'set'],
    },
    async execute(args) {
      try {
        const scenes = await deps.listScenes();
        const existing = scenes.find((s) => s.id === args.id);
        if (!existing) {
          return { success: false, error: `Scene not found: ${args.id}` };
        }
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);
        const updated: Scene = {
          ...existing,
          ...(set.title !== undefined && { title: set.title as string }),
          ...(set.description !== undefined && { description: set.description as string }),
          ...(set.location !== undefined && { location: set.location as string }),
          ...(set.timeOfDay !== undefined && { timeOfDay: set.timeOfDay as string }),
          ...(set.characters !== undefined && { characters: set.characters as string[] }),
          updatedAt: Date.now(),
        };
        await deps.updateScene(updated);
        return { success: true, data: updated, ...(warnings.length > 0 && { warnings }) };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const sceneDelete: AgentTool = {
    name: 'scene.delete',
    description: 'Delete a scene by ID.',
    tags: ['scene', 'mutate'],
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

  const sceneRefImage = createRefImageTool<SceneWithReferenceImages>({
    toolName: 'scene.refImage',
    entityLabel: 'scene',
    tags: ['scene', 'mutate'],
    description: 'Manage scene reference images. action=set: assign an existing asset hash to a slot, action=delete: remove a slot, action=setFromNode: set from a generated canvas image node.',
    getEntity: async (id) => {
      const scenes = await deps.listScenes();
      const scene = scenes.find((s) => s.id === id);
      if (!scene) return null;
      const sceneWithRefs = scene as SceneWithReferenceImages;
      sceneWithRefs.referenceImages = sceneWithRefs.referenceImages ?? [];
      return sceneWithRefs;
    },
    saveEntity: (entity) => deps.updateScene(entity),
    generateImage: undefined,
    getCanvas: deps.getCanvas,
    buildPrompt: () => '',
    isStandardSlot: () => false,
  });

  return [sceneList, sceneCreate, sceneUpdate, sceneDelete, sceneRefImage];
}
