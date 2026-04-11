import {
  STANDARD_ANGLE_SLOTS,
  type AudioNodeData,
  type Canvas,
  type Character,
  type ImageNodeData,
  type ReferenceImage,
  type VideoNodeData,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface CharacterToolDeps {
  listCharacters: () => Promise<Character[]>;
  saveCharacter: (character: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

export function createCharacterTools(deps: CharacterToolDeps): AgentTool[] {
  const characterList: AgentTool = {
    name: 'character.list',
    description: 'List all characters in the current project.',
    tags: ['character', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional search query. Matches against name, role, or description (case-insensitive OR logic).' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const query = typeof args.query === 'string' && args.query.length > 0
          ? args.query.toLowerCase()
          : undefined;
        let filtered = characters;
        if (query) {
          filtered = filtered.filter((c) =>
            c.name?.toLowerCase().includes(query) ||
            c.role?.toLowerCase().includes(query) ||
            c.description?.toLowerCase().includes(query),
          );
        }
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return { success: true, data: { total: filtered.length, offset, limit, characters: filtered.slice(offset, offset + limit) } };
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
        age: { type: 'number', description: 'Character age.' },
        gender: { type: 'string', description: 'Gender.', enum: ['male', 'female', 'non-binary', 'other'] },
        voice: { type: 'string', description: 'Voice description (e.g. warm alto, gravelly baritone).' },
        face: {
          type: 'object',
          description: 'Structured face description for prompt compilation.',
          properties: {
            eyeShape: { type: 'string', description: 'Eye shape (e.g. almond, round, hooded).' },
            eyeColor: { type: 'string', description: 'Eye color.' },
            noseType: { type: 'string', description: 'Nose type (e.g. straight, aquiline, button).' },
            lipShape: { type: 'string', description: 'Lip shape (e.g. full, thin, cupid bow).' },
            jawline: { type: 'string', description: 'Jawline shape (e.g. oval, square, pointed).' },
            definingFeatures: { type: 'string', description: 'Additional defining facial features.' },
          },
        },
        hair: {
          type: 'object',
          description: 'Structured hair description.',
          properties: {
            color: { type: 'string', description: 'Hair color.' },
            style: { type: 'string', description: 'Hair style (e.g. bob, braids, undercut).' },
            length: { type: 'string', description: 'Hair length (e.g. shoulder-length, waist-length).' },
            texture: { type: 'string', description: 'Hair texture (e.g. straight, curly, coily).' },
          },
        },
        skinTone: { type: 'string', description: 'Skin tone description (e.g. warm olive, deep brown).' },
        body: {
          type: 'object',
          description: 'Body type description.',
          properties: {
            height: { type: 'string', description: 'Height.' },
            build: { type: 'string', description: 'Body build (e.g. athletic, slender, stocky).' },
            proportions: { type: 'string', description: 'Body proportions (e.g. 8-head body).' },
          },
        },
        distinctTraits: {
          type: 'array',
          description: 'Distinctive physical traits (scars, tattoos, piercings, etc.).',
          items: { type: 'string', description: 'A distinctive trait.' },
        },
        vocalTraits: {
          type: 'object',
          description: 'Voice characteristics for audio generation.',
          properties: {
            pitch: { type: 'string', description: 'Voice pitch (e.g. alto, tenor, baritone).' },
            accent: { type: 'string', description: 'Accent (e.g. British RP, Southern US).' },
            cadence: { type: 'string', description: 'Speaking cadence (e.g. measured, rapid-fire).' },
          },
        },
        tags: { type: 'array', description: 'Tags for organizing characters.', items: { type: 'string', description: 'A tag.' } },
      },
      required: ['name', 'role', 'description', 'appearance', 'personality'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const face = typeof args.face === 'object' && args.face !== null ? args.face as Record<string, unknown> : undefined;
        const hair = typeof args.hair === 'object' && args.hair !== null ? args.hair as Record<string, unknown> : undefined;
        const skinTone = typeof args.skinTone === 'string' ? args.skinTone : undefined;
        const body = typeof args.body === 'object' && args.body !== null ? args.body as Record<string, unknown> : undefined;
        const distinctTraits = Array.isArray(args.distinctTraits) ? args.distinctTraits.filter((t): t is string => typeof t === 'string') : undefined;
        const vocalTraits = typeof args.vocalTraits === 'object' && args.vocalTraits !== null ? args.vocalTraits as Record<string, unknown> : undefined;
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
          tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [],
          ...(typeof args.age === 'number' && { age: args.age }),
          ...(typeof args.gender === 'string' && args.gender && { gender: args.gender as Character['gender'] }),
          ...(typeof args.voice === 'string' && args.voice && { voice: args.voice }),
          ...(face !== undefined && { face }),
          ...(hair !== undefined && { hair }),
          ...(skinTone !== undefined && { skinTone }),
          ...(body !== undefined && { body }),
          ...(distinctTraits !== undefined && { distinctTraits }),
          ...(vocalTraits !== undefined && { vocalTraits }),
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
        age: { type: 'number', description: 'Character age.' },
        gender: { type: 'string', description: 'Gender.', enum: ['male', 'female', 'non-binary', 'other'] },
        voice: { type: 'string', description: 'Voice description.' },
        face: {
          type: 'object',
          description: 'Structured face description for prompt compilation.',
          properties: {
            eyeShape: { type: 'string', description: 'Eye shape (e.g. almond, round, hooded).' },
            eyeColor: { type: 'string', description: 'Eye color.' },
            noseType: { type: 'string', description: 'Nose type (e.g. straight, aquiline, button).' },
            lipShape: { type: 'string', description: 'Lip shape (e.g. full, thin, cupid bow).' },
            jawline: { type: 'string', description: 'Jawline shape (e.g. oval, square, pointed).' },
            definingFeatures: { type: 'string', description: 'Additional defining facial features.' },
          },
        },
        hair: {
          type: 'object',
          description: 'Structured hair description.',
          properties: {
            color: { type: 'string', description: 'Hair color.' },
            style: { type: 'string', description: 'Hair style (e.g. bob, braids, undercut).' },
            length: { type: 'string', description: 'Hair length (e.g. shoulder-length, waist-length).' },
            texture: { type: 'string', description: 'Hair texture (e.g. straight, curly, coily).' },
          },
        },
        skinTone: { type: 'string', description: 'Skin tone description (e.g. warm olive, deep brown).' },
        body: {
          type: 'object',
          description: 'Body type description.',
          properties: {
            height: { type: 'string', description: 'Height.' },
            build: { type: 'string', description: 'Body build (e.g. athletic, slender, stocky).' },
            proportions: { type: 'string', description: 'Body proportions (e.g. 8-head body).' },
          },
        },
        distinctTraits: {
          type: 'array',
          description: 'Distinctive physical traits (scars, tattoos, piercings, etc.).',
          items: { type: 'string', description: 'A distinctive trait.' },
        },
        vocalTraits: {
          type: 'object',
          description: 'Voice characteristics for audio generation.',
          properties: {
            pitch: { type: 'string', description: 'Voice pitch (e.g. alto, tenor, baritone).' },
            accent: { type: 'string', description: 'Accent (e.g. British RP, Southern US).' },
            cadence: { type: 'string', description: 'Speaking cadence (e.g. measured, rapid-fire).' },
          },
        },
        tags: { type: 'array', description: 'Tags for organizing characters.', items: { type: 'string', description: 'A tag.' } },
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
        const face = typeof args.face === 'object' && args.face !== null ? args.face as Record<string, unknown> : undefined;
        const hair = typeof args.hair === 'object' && args.hair !== null ? args.hair as Record<string, unknown> : undefined;
        const skinTone = typeof args.skinTone === 'string' ? args.skinTone : undefined;
        const body = typeof args.body === 'object' && args.body !== null ? args.body as Record<string, unknown> : undefined;
        const distinctTraits = Array.isArray(args.distinctTraits) ? args.distinctTraits.filter((t): t is string => typeof t === 'string') : undefined;
        const vocalTraits = typeof args.vocalTraits === 'object' && args.vocalTraits !== null ? args.vocalTraits as Record<string, unknown> : undefined;
        const updated: Character = {
          ...existing,
          ...(args.name !== undefined && { name: args.name as string }),
          ...(args.role !== undefined && { role: args.role as Character['role'] }),
          ...(args.description !== undefined && { description: args.description as string }),
          ...(args.appearance !== undefined && { appearance: args.appearance as string }),
          ...(args.personality !== undefined && { personality: args.personality as string }),
          ...(typeof args.age === 'number' && { age: args.age }),
          ...(typeof args.gender === 'string' && { gender: args.gender as Character['gender'] }),
          ...(typeof args.voice === 'string' && { voice: args.voice }),
          ...(face !== undefined && { face }),
          ...(hair !== undefined && { hair }),
          ...(skinTone !== undefined && { skinTone }),
          ...(body !== undefined && { body }),
          ...(distinctTraits !== undefined && { distinctTraits }),
          ...(vocalTraits !== undefined && { vocalTraits }),
          ...(Array.isArray(args.tags) && { tags: args.tags.filter((t): t is string => typeof t === 'string') }),
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
    description: 'Generate a reference image for a character slot. Each slot produces a specific view with plain background and no scene elements.',
    tags: ['character', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID.' },
        slot: {
          type: 'string',
          description: 'Reference image slot. front/back/left-side/right-side = full body views; face-closeup = detailed portrait; top-down = overhead view.',
          enum: ['front', 'back', 'left-side', 'right-side', 'face-closeup', 'top-down'],
        },
        prompt: { type: 'string', description: 'Optional custom prompt. Default auto-generates a character-only reference prompt with neutral background.' },
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
        const slotDescriptions: Record<string, string> = {
          'front': 'full body front view, neutral standing pose, facing camera directly, head to toe visible, arms slightly away from body',
          'back': 'full body back view, neutral standing pose, facing away from camera, head to toe visible, showing hair and costume details from behind',
          'left-side': 'full body left side profile view, neutral standing pose, clean silhouette, head to toe visible',
          'right-side': 'full body right side profile view, neutral standing pose, clean silhouette, head to toe visible',
          'face-closeup': 'close-up portrait of face, head and shoulders framing, highly detailed facial features, detailed eyes and skin texture, multiple subtle expressions showing emotional range, neutral and slight smile',
          'top-down': 'top-down overhead view looking straight down, full body visible, arms slightly spread for shape clarity',
        };
        const slotDesc = slotDescriptions[slot] ?? `${slot} angle view`;
        const appearance = entity.appearance ? `Appearance: ${entity.appearance}. ` : '';
        const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
          ? args.prompt
          : `Character design reference, solid white background, even studio lighting, no environment, no scene, no props, no other characters. `
            + `Subject: ${entity.name}. ${slotDesc}. ${appearance}`
            + `Single character only, clean edges, high detail, consistent proportions, professional character concept art.`;
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
    characterCreate,
    characterUpdate,
    characterDelete,
    characterGenerateReferenceImage,
    characterSetReferenceImage,
    characterDeleteReferenceImage,
    characterSetReferenceImageFromNode,
  ];
}
