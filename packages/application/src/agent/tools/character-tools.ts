import {
  STANDARD_ANGLE_SLOTS,
  type AudioNodeData,
  type Canvas,
  type Character,
  type ImageNodeData,
  type ReferenceImage,
  type VideoNodeData,
} from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface CharacterToolDeps {
  listCharacters: () => Promise<Character[]>;
  saveCharacter: (character: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

function ok(data?: unknown): ToolResult {
  return { success: true, data };
}

export function createCharacterTools(deps: CharacterToolDeps): AgentTool[] {
  const characterList: AgentTool = {
    name: 'character.list',
    description: 'List all characters in the current project.',
    tags: ['character', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args) {
      try {
        const characters = await deps.listCharacters();
        return { success: true, data: characters };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterCreate: AgentTool = {
    name: 'character.create',
    description: 'Create a new character in the current project.',
    tags: ['character', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The character name.' },
        role: {
          type: 'string',
          description: 'The character role.',
          enum: ['protagonist', 'antagonist', 'supporting', 'extra'],
        },
        description: { type: 'string', description: 'A brief description of the character.' },
        appearance: { type: 'string', description: 'Physical appearance description.' },
        personality: { type: 'string', description: 'Personality traits description.' },
      },
      required: ['name', 'role', 'description', 'appearance', 'personality'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const character: Character = {
          id: crypto.randomUUID(),
          name: args.name as string,
          role: args.role as Character['role'],
          description: args.description as string,
          appearance: args.appearance as string,
          personality: args.personality as string,
          costumes: [],
          referenceImages: [],
          loadouts: [],
          defaultLoadoutId: '',
          tags: [],
          createdAt: now,
          updatedAt: now,
        };
        await deps.saveCharacter(character);
        return { success: true, data: character };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterUpdate: AgentTool = {
    name: 'character.update',
    description: 'Update an existing character by ID.',
    tags: ['character', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID to update.' },
        name: { type: 'string', description: 'Updated character name.' },
        role: {
          type: 'string',
          description: 'Updated character role.',
          enum: ['protagonist', 'antagonist', 'supporting', 'extra'],
        },
        description: { type: 'string', description: 'Updated description.' },
        appearance: { type: 'string', description: 'Updated appearance description.' },
        personality: { type: 'string', description: 'Updated personality description.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const existing = characters.find((c) => c.id === args.id);
        if (!existing) {
          return { success: false, error: `Character not found: ${args.id}` };
        }
        const updated: Character = {
          ...existing,
          ...(args.name !== undefined && { name: args.name as string }),
          ...(args.role !== undefined && { role: args.role as Character['role'] }),
          ...(args.description !== undefined && { description: args.description as string }),
          ...(args.appearance !== undefined && { appearance: args.appearance as string }),
          ...(args.personality !== undefined && { personality: args.personality as string }),
          updatedAt: Date.now(),
        };
        await deps.saveCharacter(updated);
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterDelete: AgentTool = {
    name: 'character.delete',
    description: 'Delete a character by ID.',
    tags: ['character', 'mutate'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID to delete.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        await deps.deleteCharacter(args.id as string);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterGenerateReferenceImage: AgentTool = {
    name: 'character.generateReferenceImage',
    description: 'Generate a reference image for a character slot.',
    tags: ['character', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
        prompt: { type: 'string', description: 'Optional custom image generation prompt.' },
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const entity = characters.find((character) => character.id === args.id);
        if (!entity) {
          return { success: false, error: `Character not found: ${args.id}` };
        }
        if (!deps.generateImage) {
          return { success: false, error: 'Image generation not available' };
        }

        const slot = args.slot as string;
        const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
          ? args.prompt
          : `Character reference image: ${entity.name}. Appearance: ${entity.appearance}. ${entity.description}. Angle: ${slot}`;
        const result = await deps.generateImage(finalPrompt);
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = {
          slot,
          assetHash: result.assetHash,
          isStandard: STANDARD_ANGLE_SLOTS.includes(slot as Character['referenceImages'][number]['slot'] & (typeof STANDARD_ANGLE_SLOTS)[number]),
        };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await deps.saveCharacter(entity);

        return { success: true, data: { assetHash: result.assetHash, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterSetReferenceImage: AgentTool = {
    name: 'character.setReferenceImage',
    description: 'Set a reference image asset for a character slot.',
    tags: ['character', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
        assetHash: { type: 'string', description: 'The CAS asset hash to assign.' },
      },
      required: ['id', 'slot', 'assetHash'],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const entity = characters.find((character) => character.id === args.id);
        if (!entity) {
          return { success: false, error: `Character not found: ${args.id}` };
        }

        const slot = args.slot as string;
        const assetHash = args.assetHash as string;
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = {
          slot,
          assetHash,
          isStandard: STANDARD_ANGLE_SLOTS.includes(slot as Character['referenceImages'][number]['slot'] & (typeof STANDARD_ANGLE_SLOTS)[number]),
        };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await deps.saveCharacter(entity);

        return { success: true, data: { assetHash, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterDeleteReferenceImage: AgentTool = {
    name: 'character.deleteReferenceImage',
    description: 'Remove a reference image from a character slot.',
    tags: ['character', 'mutate'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const entity = characters.find((character) => character.id === args.id);
        if (!entity) {
          return { success: false, error: `Character not found: ${args.id}` };
        }

        const slot = args.slot as string;
        entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
        entity.updatedAt = Date.now();
        await deps.saveCharacter(entity);

        return { success: true, data: { id: entity.id, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterSearch: AgentTool = {
    name: 'character.search',
    description: 'Search characters by name or role. Returns lightweight summaries.',
    tags: ['character', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional name query. Matches character names case-insensitively.',
        },
        role: {
          type: 'string',
          description: 'Optional exact role match.',
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const role = typeof args.role === 'string' ? args.role : undefined;
        const matches = characters
          .filter((character) => (
            (query.length === 0 || character.name.toLowerCase().includes(query))
            && (role === undefined || character.role === role)
          ))
          .map(({ id, name, role: characterRole }) => ({ id, name, role: characterRole }));
        return ok(matches);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const characterSetReferenceImageFromNode: AgentTool = {
    name: 'character.setReferenceImageFromNode',
    description: 'Set a character reference image directly from a generated canvas image node.',
    tags: ['character', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID.' },
        slot: { type: 'string', description: 'The reference image slot.' },
        canvasId: { type: 'string', description: 'The canvas ID.' },
        nodeId: { type: 'string', description: 'The image node ID to pull the generated asset from.' },
      },
      required: ['id', 'slot', 'canvasId', 'nodeId'],
    },
    async execute(args) {
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
        const characters = await deps.listCharacters();
        const entity = characters.find((c) => c.id === args.id);
        if (!entity) return { success: false, error: `Character not found: ${args.id}` };
        const slot = String(args.slot);
        entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
        entity.referenceImages.push({
          slot,
          assetHash,
          isStandard: STANDARD_ANGLE_SLOTS.includes(
            slot as ReferenceImage['slot'] & (typeof STANDARD_ANGLE_SLOTS)[number],
          ),
        });
        entity.updatedAt = Date.now();
        await deps.saveCharacter(entity);
        return { success: true, data: { id: entity.id, slot, assetHash } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    characterList,
    characterSearch,
    characterCreate,
    characterUpdate,
    characterDelete,
    characterGenerateReferenceImage,
    characterSetReferenceImage,
    characterDeleteReferenceImage,
    characterSetReferenceImageFromNode,
  ];
}
