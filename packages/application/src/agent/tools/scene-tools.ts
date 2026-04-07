import type {
  AudioNodeData,
  Canvas,
  ImageNodeData,
  KeyframeStatus,
  ReferenceImage,
  Scene,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface SceneToolDeps {
  listScenes: () => Promise<Scene[]>;
  createScene: (scene: Scene) => Promise<void>;
  updateScene: (scene: Scene) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

type SceneWithReferenceImages = Scene & { referenceImages?: ReferenceImage[] };

function ok(data?: unknown): ToolResult {
  return { success: true, data };
}

function deriveSceneStatus(scene: Scene): KeyframeStatus {
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

  const sceneSearch: AgentTool = {
    name: 'scene.search',
    description: 'Search scenes by title or status. Returns lightweight summaries.',
    tags: ['scene', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional title query. Matches scene titles case-insensitively.',
        },
        status: {
          type: 'string',
          description: 'Optional exact status match.',
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const scenes = await deps.listScenes();
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const status = typeof args.status === 'string' ? args.status : undefined;
        const matches = scenes
          .map((scene) => ({
            id: scene.id,
            title: scene.title,
            status: deriveSceneStatus(scene),
          }))
          .filter((scene) => (
            (query.length === 0 || scene.title.toLowerCase().includes(query))
            && (status === undefined || scene.status === status)
          ));
        return ok(matches);
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
    tags: ['scene', 'mutate'],
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

  return [sceneList, sceneSearch, sceneCreate, sceneUpdate, sceneDelete, {
    name: 'scene.setReferenceImageFromNode',
    description: 'Set a scene reference image directly from a generated canvas image node.',
    tags: ['scene', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const, description: 'The scene ID.' },
        slot: { type: 'string' as const, description: 'The reference image slot.' },
        canvasId: { type: 'string' as const, description: 'The canvas ID.' },
        nodeId: { type: 'string' as const, description: 'The image node ID.' },
      },
      required: ['id', 'slot', 'canvasId', 'nodeId'],
    },
    async execute(args: Record<string, unknown>) {
      try {
        if (!deps.getCanvas) return { success: false, error: 'getCanvas not available' };
        const canvas = await deps.getCanvas(String(args.canvasId));
        const node = canvas.nodes.find((n) => n.id === args.nodeId);
        if (!node) return { success: false, error: `Node not found: ${args.nodeId}` };
        if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
          return { success: false, error: `Node type does not support reference images: ${node.type}` };
        }
        const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
        const variants = Array.isArray(data.variants) ? data.variants : [];
        const idx = typeof data.selectedVariantIndex === 'number' ? data.selectedVariantIndex : 0;
        const assetHash = variants[idx] ?? data.assetHash;
        if (typeof assetHash !== 'string' || !assetHash) return { success: false, error: 'No generated asset on node' };
        const scenes = await deps.listScenes();
        const entity = scenes.find((s) => s.id === args.id);
        if (!entity) return { success: false, error: `Scene not found: ${args.id}` };
        const slot = String(args.slot);
        const sceneWithRefs = entity as SceneWithReferenceImages;
        sceneWithRefs.referenceImages = (sceneWithRefs.referenceImages ?? []).filter((image) => image.slot !== slot);
        sceneWithRefs.referenceImages.push({ slot, assetHash, isStandard: false });
        sceneWithRefs.updatedAt = Date.now();
        await deps.updateScene(sceneWithRefs);
        return { success: true, data: { id: entity.id, slot, assetHash } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  } as AgentTool];
}
