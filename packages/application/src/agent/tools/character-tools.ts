import {
  STANDARD_ANGLE_SLOTS,
  type Canvas,
  type Character,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { createRefImageTool } from './ref-image-factory.js';
import { extractSet, warnExtraKeys } from './tool-result-helpers.js';

export interface GenerateImageOptions {
  providerId?: string;
  width?: number;
  height?: number;
}

export interface CharacterToolDeps {
  listCharacters: () => Promise<Character[]>;
  saveCharacter: (character: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  generateImage?: (prompt: string, options?: GenerateImageOptions) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

export function createCharacterTools(deps: CharacterToolDeps): AgentTool[] {

  /** Build a compact appearance string from structured fields + freeform appearance text. */
  function buildAppearancePrompt(entity: Character): string {
    const parts: string[] = [];

    // Age and gender
    const ageGender: string[] = [];
    if (entity.age) ageGender.push(`${entity.age} years old`);
    if (entity.gender) ageGender.push(entity.gender);
    if (ageGender.length > 0) parts.push(ageGender.join(', '));

    // Face
    const face = entity.face;
    if (face) {
      const faceParts: string[] = [];
      if (face.eyeShape) faceParts.push(`${face.eyeShape} eyes`);
      if (face.eyeColor) faceParts.push(`${face.eyeColor} eye color`);
      if (face.noseType) faceParts.push(`${face.noseType} nose`);
      if (face.lipShape) faceParts.push(`${face.lipShape} lips`);
      if (face.jawline) faceParts.push(`${face.jawline} jawline`);
      if (face.definingFeatures) faceParts.push(face.definingFeatures);
      if (faceParts.length > 0) parts.push(`Face: ${faceParts.join(', ')}`);
    }

    // Hair
    const hair = entity.hair;
    if (hair) {
      const hairParts: string[] = [];
      if (hair.color) hairParts.push(hair.color);
      if (hair.length) hairParts.push(hair.length);
      if (hair.style) hairParts.push(hair.style);
      if (hair.texture) hairParts.push(hair.texture);
      if (hairParts.length > 0) parts.push(`Hair: ${hairParts.join(', ')}`);
    }

    // Skin
    if (entity.skinTone) parts.push(`Skin tone: ${entity.skinTone}`);

    // Body
    const body = entity.body;
    if (body) {
      const bodyParts: string[] = [];
      if (body.height) bodyParts.push(body.height);
      if (body.build) bodyParts.push(`${body.build} build`);
      if (body.proportions) bodyParts.push(body.proportions);
      if (bodyParts.length > 0) parts.push(`Body: ${bodyParts.join(', ')}`);
    }

    // Distinct traits
    if (entity.distinctTraits && entity.distinctTraits.length > 0) {
      parts.push(`Distinctive: ${entity.distinctTraits.join(', ')}`);
    }

    // Freeform appearance as supplement (only if structured fields are empty)
    if (entity.appearance && parts.length === 0) {
      parts.push(entity.appearance);
    } else if (entity.appearance && parts.length > 0) {
      // Append freeform as extra details
      parts.push(`Additional: ${entity.appearance}`);
    }

    return parts.join('. ');
  }
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
    description: 'Update an existing character by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched.',
    tags: ['character', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The character ID to update.' },
        set: {
          type: 'object',
          description: 'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
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
        },
      },
      required: ['id', 'set'],
    },
    async execute(args) {
      try {
        const characters = await deps.listCharacters();
        const existing = characters.find((c) => c.id === args.id);
        if (!existing) {
          return { success: false, error: `Character not found: ${args.id}` };
        }
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);
        const face = typeof set.face === 'object' && set.face !== null ? set.face as Record<string, unknown> : undefined;
        const hair = typeof set.hair === 'object' && set.hair !== null ? set.hair as Record<string, unknown> : undefined;
        const skinTone = typeof set.skinTone === 'string' ? set.skinTone : undefined;
        const body = typeof set.body === 'object' && set.body !== null ? set.body as Record<string, unknown> : undefined;
        const distinctTraits = Array.isArray(set.distinctTraits) ? set.distinctTraits.filter((t): t is string => typeof t === 'string') : undefined;
        const vocalTraits = typeof set.vocalTraits === 'object' && set.vocalTraits !== null ? set.vocalTraits as Record<string, unknown> : undefined;
        const updated: Character = {
          ...existing,
          ...(set.name !== undefined && { name: set.name as string }),
          ...(set.role !== undefined && { role: set.role as Character['role'] }),
          ...(set.description !== undefined && { description: set.description as string }),
          ...(set.appearance !== undefined && { appearance: set.appearance as string }),
          ...(set.personality !== undefined && { personality: set.personality as string }),
          ...(typeof set.age === 'number' && { age: set.age }),
          ...(typeof set.gender === 'string' && { gender: set.gender as Character['gender'] }),
          ...(typeof set.voice === 'string' && { voice: set.voice }),
          ...(face !== undefined && { face }),
          ...(hair !== undefined && { hair }),
          ...(skinTone !== undefined && { skinTone }),
          ...(body !== undefined && { body }),
          ...(distinctTraits !== undefined && { distinctTraits }),
          ...(vocalTraits !== undefined && { vocalTraits }),
          ...(Array.isArray(set.tags) && { tags: set.tags.filter((t): t is string => typeof t === 'string') }),
          updatedAt: Date.now(),
        };
        await deps.saveCharacter(updated);
        return { success: true, data: updated, ...(warnings.length > 0 && { warnings }) };
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

  const characterRefImage = createRefImageTool<Character>({
    toolName: 'character.refImage',
    entityLabel: 'character',
    tags: ['character', 'generation'],
    description: 'Manage a character reference image. Use action=generate to generate a turnaround ref sheet, action=set to assign an existing asset, action=delete to remove a slot, action=setFromNode to pull an asset from a canvas node.',
    getEntity: async (id) => {
      const characters = await deps.listCharacters();
      return characters.find((c) => c.id === id) ?? null;
    },
    saveEntity: deps.saveCharacter,
    generateImage: deps.generateImage,
    getCanvas: deps.getCanvas,
    buildPrompt: (entity, slot) => {
      void slot;
      const appearanceDesc = buildAppearancePrompt(entity);
      return `Professional character turnaround reference sheet for animation/film production. `
        + `Solid white background, even studio lighting, no environment, no scene, no props. `
        + `Character: ${entity.name}. `
        + (appearanceDesc ? `${appearanceDesc}. ` : '')
        + `TOP ROW: Three full-body standing poses shown from head to feet with shoes visible — front view, side profile, back view. `
        + `Each pose shows the complete figure at identical scale, arms slightly away from body for silhouette clarity. `
        + `BOTTOM ROW: Five head-and-shoulders close-up portraits of the same character showing distinct facial expressions — neutral, happy, sad, angry, surprised. `
        + `Each close-up fills a square frame with detailed facial features and expression clearly visible. `
        + `Consistent character design, proportions, clothing, and art style across all views. `
        + `High detail, clean lines, professional character concept art, no text labels, single character only.`;
    },
    isStandardSlot: (slot) => STANDARD_ANGLE_SLOTS.includes(slot as (typeof STANDARD_ANGLE_SLOTS)[number]),
    defaultWidth: 1536,
    defaultHeight: 1024,
  });

  return [
    characterList,
    characterCreate,
    characterUpdate,
    characterDelete,
    characterRefImage,
  ];
}
