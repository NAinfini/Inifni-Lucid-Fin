import {
  characterViewToSlot,
  locationViewToSlot,
  equipmentViewToSlot,
  type Canvas,
  type CanvasSettings,
  type Character,
  type CharacterRefImageView,
  type Equipment,
  type EquipmentRefImageView,
  type EquipmentType,
  type ImageNodeData,
  type Location,
  type LocationRefImageView,
  type ReferenceImage,
  type AudioNodeData,
  type VideoNodeData,
} from '@lucid-fin/contracts';
import { tryProviderId } from '@lucid-fin/contracts-parse';
import type { AgentTool } from '../tool-registry.js';
import {
  extractSet,
  warnExtraKeys,
  requireString,
  requireSetString,
} from './tool-result-helpers.js';
import { buildCharacterRefImagePrompt } from './character-prompt.js';
import { buildLocationRefImagePrompt } from './location-prompt.js';
import { buildEquipmentRefImagePrompt } from './equipment-prompt.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EQUIPMENT_TYPES: EquipmentType[] = [
  'weapon',
  'armor',
  'clothing',
  'accessory',
  'vehicle',
  'tool',
  'furniture',
  'other',
];

const VALID_LOCATION_TYPES = new Set<NonNullable<Location['type']>>([
  'interior',
  'exterior',
  'int-ext',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeLocationType(value: unknown): Location['type'] | undefined {
  return typeof value === 'string' &&
    VALID_LOCATION_TYPES.has(value as NonNullable<Location['type']>)
    ? (value as NonNullable<Location['type']>)
    : undefined;
}

function parseCharacterView(raw: unknown): CharacterRefImageView {
  // Default to full-sheet when the agent omits the view field. This matches
  // the Q27 directive that every character gets one composite image covering
  // front/back/side/full-body + detailed expressions.
  if (raw === undefined || raw === null) return { kind: 'full-sheet' };
  if (typeof raw !== 'object') {
    throw new Error(
      'view must be an object: { kind: "full-sheet" | "extra-angle", angle?: string }',
    );
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === 'full-sheet') return { kind: 'full-sheet' };
  if (kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.trim().length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle.trim() };
  }
  throw new Error(`view.kind must be "full-sheet" or "extra-angle" (got ${String(kind)})`);
}

function parseLocationView(raw: unknown): LocationRefImageView {
  if (raw === undefined || raw === null) return { kind: 'bible' };
  if (typeof raw !== 'object') {
    throw new Error(
      'view must be an object: { kind: "bible" | "fake-360" | "extra-angle", angle?: string }',
    );
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === 'bible') return { kind: 'bible' };
  if (kind === 'fake-360') return { kind: 'fake-360' };
  if (kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.trim().length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle.trim() };
  }
  throw new Error(`view.kind must be "bible", "fake-360", or "extra-angle" (got ${String(kind)})`);
}

function parseEquipmentView(raw: unknown): EquipmentRefImageView {
  if (raw === undefined || raw === null) return { kind: 'ortho-grid' };
  if (typeof raw !== 'object') {
    throw new Error(
      'view must be an object: { kind: "ortho-grid" | "extra-angle", angle?: string }',
    );
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === 'ortho-grid') return { kind: 'ortho-grid' };
  if (kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.trim().length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle.trim() };
  }
  throw new Error(`view.kind must be "ortho-grid" or "extra-angle" (got ${String(kind)})`);
}

function readStylePlateFromCanvas(canvas: Canvas | undefined): string | undefined {
  return canvas?.settings?.stylePlate;
}

// ---------------------------------------------------------------------------
// EntityToolDeps
// ---------------------------------------------------------------------------

export interface EntityToolDeps {
  // Character
  listCharacters: () => Promise<Character[]>;
  saveCharacter: (character: Character) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  // Location
  listLocations: () => Promise<Location[]>;
  saveLocation: (location: Location) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  // Equipment
  listEquipment: () => Promise<Equipment[]>;
  saveEquipment: (equipment: Equipment) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  // Shared
  generateImage?: (
    prompt: string,
    options?: { providerId?: string; width?: number; height?: number },
  ) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

// ---------------------------------------------------------------------------
// Shared schema fragments
// ---------------------------------------------------------------------------

type EntityType = 'character' | 'location' | 'equipment';

const ENTITY_TYPE_PARAM = {
  type: 'string' as const,
  description: 'Entity domain. Use type to specify which entity domain.',
  enum: ['character', 'location', 'equipment'],
};

const VIEW_PARAM = {
  type: 'object' as const,
  description:
    'View kind discriminator. Use kind=<primary> for the default composite view ' +
    '(full-sheet / bible / ortho-grid depending on domain). ' +
    'Use kind=extra-angle with angle=<string> for a custom angle.',
  properties: {
    kind: {
      type: 'string' as const,
      description: 'View kind discriminator.',
      enum: ['full-sheet', 'extra-angle', 'bible', 'fake-360', 'ortho-grid'],
    },
    angle: {
      type: 'string' as const,
      description: 'Free-form angle label (required when kind=extra-angle).',
    },
  },
};

// ---------------------------------------------------------------------------
// createEntityTools
// ---------------------------------------------------------------------------

export function createEntityTools(deps: EntityToolDeps): AgentTool[] {
  // -------------------------------------------------------------------------
  // entity.list
  // -------------------------------------------------------------------------
  const entityList: AgentTool = {
    name: 'entity.list',
    description:
      'List entities in the current project. Use type to specify which entity domain. Results are returned in the "entities" array.',
    tags: ['entity', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        query: {
          type: 'string',
          description:
            'Optional search query. Matches against name, role, type, or description (case-insensitive OR logic).',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: ['type'],
    },
    async execute(args) {
      try {
        const entityType = args.type as EntityType;
        const query =
          typeof args.query === 'string' && args.query.length > 0
            ? args.query.toLowerCase()
            : undefined;
        const offset =
          typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;

        let filtered: (Character | Location | Equipment)[];

        if (entityType === 'character') {
          const items = await deps.listCharacters();
          filtered = query
            ? items.filter(
                (c) =>
                  c.name?.toLowerCase().includes(query) ||
                  c.role?.toLowerCase().includes(query) ||
                  c.description?.toLowerCase().includes(query),
              )
            : items;
        } else if (entityType === 'location') {
          const items = await deps.listLocations();
          filtered = query
            ? items.filter(
                (l) =>
                  l.name?.toLowerCase().includes(query) ||
                  l.type?.toLowerCase().includes(query) ||
                  l.description?.toLowerCase().includes(query),
              )
            : items;
        } else if (entityType === 'equipment') {
          const items = await deps.listEquipment();
          filtered = query
            ? items.filter(
                (e) =>
                  e.name?.toLowerCase().includes(query) ||
                  e.type?.toLowerCase().includes(query) ||
                  e.description?.toLowerCase().includes(query),
              )
            : items;
        } else {
          return { success: false, error: `Unknown entity type: ${String(args.type)}` };
        }

        return {
          success: true,
          data: {
            total: filtered.length,
            offset,
            limit,
            entities: filtered.slice(offset, offset + limit),
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // entity.create
  // -------------------------------------------------------------------------
  const entityCreate: AgentTool = {
    name: 'entity.create',
    description:
      'Create a new entity in the current project. Fields vary by type — character requires role/appearance/personality; location accepts timeOfDay/mood/lighting; equipment accepts equipmentType/material/condition. To update an existing entity, use entity.update instead. To generate a reference image, use entity.generateRefImage after creation.',
    tags: ['entity', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        name: { type: 'string', description: 'The entity name.' },

        // --- character fields ---
        role: {
          type: 'string',
          description: 'Character role (character only).',
          enum: ['protagonist', 'antagonist', 'supporting', 'extra'],
        },
        description: { type: 'string', description: 'A brief description of the entity.' },
        appearance: { type: 'string', description: 'Physical appearance description (character only).' },
        personality: { type: 'string', description: 'Personality traits description (character only).' },
        age: { type: 'number', description: 'Character age (character only).' },
        gender: {
          type: 'string',
          description: 'Gender (character only).',
          enum: ['male', 'female', 'non-binary', 'other'],
        },
        voice: {
          type: 'string',
          description: 'Voice description (character only, e.g. warm alto, gravelly baritone).',
        },
        face: {
          type: 'object',
          description: 'Structured face description for prompt compilation (character only).',
          properties: {
            eyeShape: { type: 'string', description: 'Eye shape (e.g. almond, round, hooded).' },
            eyeColor: { type: 'string', description: 'Eye color.' },
            noseType: {
              type: 'string',
              description: 'Nose type (e.g. straight, aquiline, button).',
            },
            lipShape: { type: 'string', description: 'Lip shape (e.g. full, thin, cupid bow).' },
            jawline: { type: 'string', description: 'Jawline shape (e.g. oval, square, pointed).' },
            definingFeatures: {
              type: 'string',
              description: 'Additional defining facial features.',
            },
          },
        },
        hair: {
          type: 'object',
          description: 'Structured hair description (character only).',
          properties: {
            color: { type: 'string', description: 'Hair color.' },
            style: { type: 'string', description: 'Hair style (e.g. bob, braids, undercut).' },
            length: {
              type: 'string',
              description: 'Hair length (e.g. shoulder-length, waist-length).',
            },
            texture: { type: 'string', description: 'Hair texture (e.g. straight, curly, coily).' },
          },
        },
        skinTone: {
          type: 'string',
          description: 'Skin tone description (character only, e.g. warm olive, deep brown).',
        },
        body: {
          type: 'object',
          description: 'Body type description (character only).',
          properties: {
            height: { type: 'string', description: 'Height.' },
            build: { type: 'string', description: 'Body build (e.g. athletic, slender, stocky).' },
            proportions: { type: 'string', description: 'Body proportions (e.g. 8-head body).' },
          },
        },
        distinctTraits: {
          type: 'array',
          description: 'Distinctive physical traits (character only — scars, tattoos, piercings, etc.).',
          items: { type: 'string', description: 'A distinctive trait.' },
        },
        vocalTraits: {
          type: 'object',
          description: 'Voice characteristics for audio generation (character only).',
          properties: {
            pitch: { type: 'string', description: 'Voice pitch (e.g. alto, tenor, baritone).' },
            accent: { type: 'string', description: 'Accent (e.g. British RP, Southern US).' },
            cadence: {
              type: 'string',
              description: 'Speaking cadence (e.g. measured, rapid-fire).',
            },
          },
        },

        // --- location fields ---
        locationType: {
          type: 'string',
          description: 'Location type (location only).',
          enum: ['interior', 'exterior', 'int-ext'],
        },
        subLocation: {
          type: 'string',
          description: 'Optional sub-location or area within the main location (location only).',
        },
        timeOfDay: {
          type: 'string',
          description: 'Typical time of day (location only).',
          enum: ['day', 'night', 'dawn', 'dusk', 'continuous'],
        },
        mood: { type: 'string', description: 'The mood/atmosphere of the location (location only).' },
        weather: { type: 'string', description: 'Typical weather conditions (location only).' },
        lighting: { type: 'string', description: 'Lighting description (location only).' },
        architectureStyle: {
          type: 'string',
          description: 'Architecture style (location only, e.g. brutalist, art deco).',
        },
        dominantColors: {
          type: 'array',
          description: 'Dominant color palette (location only).',
          items: { type: 'string', description: 'A color (name or hex).' },
        },
        keyFeatures: {
          type: 'array',
          description: 'Key visual features of the location (location only).',
          items: { type: 'string', description: 'A feature description.' },
        },
        atmosphereKeywords: {
          type: 'array',
          description: 'Atmosphere keywords (location only, e.g. echoing, musty, vast).',
          items: { type: 'string', description: 'An atmosphere keyword.' },
        },

        // --- equipment fields ---
        equipmentType: {
          type: 'string',
          description: 'Equipment subtype (equipment only).',
          enum: EQUIPMENT_TYPES,
        },
        subtype: { type: 'string', description: 'Optional equipment subtype (equipment only).' },
        function: { type: 'string', description: 'What the equipment does (equipment only).' },
        material: {
          type: 'string',
          description: 'Material (equipment only, e.g. weathered leather, brushed steel).',
        },
        color: { type: 'string', description: 'Color description (equipment only).' },
        condition: {
          type: 'string',
          description: 'Condition (equipment only, e.g. battle-worn, pristine, antique).',
        },
        visualDetails: {
          type: 'string',
          description: 'Visual detail description for prompts (equipment only).',
        },

        // --- shared ---
        tags: {
          type: 'array',
          description: 'Tags for organizing the entity.',
          items: { type: 'string', description: 'A tag.' },
        },
      },
      required: ['type', 'name'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const entityType = args.type as EntityType;
        const name = requireString(args, 'name');

        if (entityType === 'character') {
          const face =
            typeof args.face === 'object' && args.face !== null
              ? (args.face as Record<string, unknown>)
              : undefined;
          const hair =
            typeof args.hair === 'object' && args.hair !== null
              ? (args.hair as Record<string, unknown>)
              : undefined;
          const skinTone = typeof args.skinTone === 'string' ? args.skinTone : undefined;
          const body =
            typeof args.body === 'object' && args.body !== null
              ? (args.body as Record<string, unknown>)
              : undefined;
          const distinctTraits = Array.isArray(args.distinctTraits)
            ? args.distinctTraits.filter((t): t is string => typeof t === 'string')
            : undefined;
          const vocalTraits =
            typeof args.vocalTraits === 'object' && args.vocalTraits !== null
              ? (args.vocalTraits as Record<string, unknown>)
              : undefined;
          const character: Character = {
            id: crypto.randomUUID(),
            name,
            role: args.role as Character['role'],
            description: args.description as string,
            appearance: args.appearance as string,
            personality: args.personality as string,
            costumes: [],
            referenceImages: [],
            loadouts: [],
            defaultLoadoutId: '',
            tags: Array.isArray(args.tags)
              ? args.tags.filter((t): t is string => typeof t === 'string')
              : [],
            ...(typeof args.age === 'number' && { age: args.age }),
            ...(typeof args.gender === 'string' &&
              args.gender && { gender: args.gender as Character['gender'] }),
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
        }

        if (entityType === 'location') {
          const location: Location = {
            id: crypto.randomUUID(),
            name,
            type: normalizeLocationType(args.locationType) ?? 'interior',
            subLocation: typeof args.subLocation === 'string' ? args.subLocation : undefined,
            description: args.description as string,
            timeOfDay: typeof args.timeOfDay === 'string' ? args.timeOfDay : undefined,
            mood: typeof args.mood === 'string' ? args.mood : undefined,
            weather: typeof args.weather === 'string' ? args.weather : undefined,
            lighting: typeof args.lighting === 'string' ? args.lighting : undefined,
            architectureStyle:
              typeof args.architectureStyle === 'string' ? args.architectureStyle : undefined,
            dominantColors: Array.isArray(args.dominantColors)
              ? args.dominantColors.filter((c): c is string => typeof c === 'string')
              : undefined,
            keyFeatures: Array.isArray(args.keyFeatures)
              ? args.keyFeatures.filter((f): f is string => typeof f === 'string')
              : undefined,
            atmosphereKeywords: Array.isArray(args.atmosphereKeywords)
              ? args.atmosphereKeywords.filter((k): k is string => typeof k === 'string')
              : undefined,
            tags: Array.isArray(args.tags)
              ? args.tags.filter((t): t is string => typeof t === 'string')
              : [],
            referenceImages: [],
            createdAt: now,
            updatedAt: now,
          };
          await deps.saveLocation(location);
          return { success: true, data: location };
        }

        if (entityType === 'equipment') {
          const equipment: Equipment = {
            id: crypto.randomUUID(),
            name,
            type: args.equipmentType as EquipmentType,
            subtype: (args.subtype as string) || undefined,
            description: args.description as string,
            function: (args.function as string) || undefined,
            material: typeof args.material === 'string' ? args.material : undefined,
            color: typeof args.color === 'string' ? args.color : undefined,
            condition: typeof args.condition === 'string' ? args.condition : undefined,
            visualDetails: typeof args.visualDetails === 'string' ? args.visualDetails : undefined,
            tags: Array.isArray(args.tags)
              ? args.tags.filter((t): t is string => typeof t === 'string')
              : [],
            referenceImages: [],
            createdAt: now,
            updatedAt: now,
          };
          await deps.saveEquipment(equipment);
          return { success: true, data: equipment };
        }

        return { success: false, error: `Unknown entity type: ${String(args.type)}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // entity.update
  // -------------------------------------------------------------------------
  const entityUpdate: AgentTool = {
    name: 'entity.update',
    description:
      'Update an existing entity by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched. To create a new entity, use entity.create instead.',
    tags: ['entity', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        id: { type: 'string', description: 'The entity ID to update (obtain from entity.list).' },
        set: {
          type: 'object',
          description:
            'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
            name: { type: 'string', description: 'Updated entity name.' },

            // --- character fields ---
            role: {
              type: 'string',
              description: 'Updated character role (character only).',
              enum: ['protagonist', 'antagonist', 'supporting', 'extra'],
            },
            description: { type: 'string', description: 'Updated description.' },
            appearance: { type: 'string', description: 'Updated appearance description (character only).' },
            personality: { type: 'string', description: 'Updated personality description (character only).' },
            age: { type: 'number', description: 'Character age (character only).' },
            gender: {
              type: 'string',
              description: 'Gender (character only).',
              enum: ['male', 'female', 'non-binary', 'other'],
            },
            voice: { type: 'string', description: 'Voice description (character only).' },
            face: {
              type: 'object',
              description: 'Structured face description for prompt compilation (character only).',
              properties: {
                eyeShape: {
                  type: 'string',
                  description: 'Eye shape (e.g. almond, round, hooded).',
                },
                eyeColor: { type: 'string', description: 'Eye color.' },
                noseType: {
                  type: 'string',
                  description: 'Nose type (e.g. straight, aquiline, button).',
                },
                lipShape: {
                  type: 'string',
                  description: 'Lip shape (e.g. full, thin, cupid bow).',
                },
                jawline: {
                  type: 'string',
                  description: 'Jawline shape (e.g. oval, square, pointed).',
                },
                definingFeatures: {
                  type: 'string',
                  description: 'Additional defining facial features.',
                },
              },
            },
            hair: {
              type: 'object',
              description: 'Structured hair description (character only).',
              properties: {
                color: { type: 'string', description: 'Hair color.' },
                style: { type: 'string', description: 'Hair style (e.g. bob, braids, undercut).' },
                length: {
                  type: 'string',
                  description: 'Hair length (e.g. shoulder-length, waist-length).',
                },
                texture: {
                  type: 'string',
                  description: 'Hair texture (e.g. straight, curly, coily).',
                },
              },
            },
            skinTone: {
              type: 'string',
              description: 'Skin tone description (character only, e.g. warm olive, deep brown).',
            },
            body: {
              type: 'object',
              description: 'Body type description (character only).',
              properties: {
                height: { type: 'string', description: 'Height.' },
                build: {
                  type: 'string',
                  description: 'Body build (e.g. athletic, slender, stocky).',
                },
                proportions: {
                  type: 'string',
                  description: 'Body proportions (e.g. 8-head body).',
                },
              },
            },
            distinctTraits: {
              type: 'array',
              description: 'Distinctive physical traits (character only — scars, tattoos, piercings, etc.).',
              items: { type: 'string', description: 'A distinctive trait.' },
            },
            vocalTraits: {
              type: 'object',
              description: 'Voice characteristics for audio generation (character only).',
              properties: {
                pitch: { type: 'string', description: 'Voice pitch (e.g. alto, tenor, baritone).' },
                accent: { type: 'string', description: 'Accent (e.g. British RP, Southern US).' },
                cadence: {
                  type: 'string',
                  description: 'Speaking cadence (e.g. measured, rapid-fire).',
                },
              },
            },

            // --- location fields ---
            locationType: {
              type: 'string',
              description: 'Updated location type (location only).',
              enum: ['interior', 'exterior', 'int-ext'],
            },
            subLocation: { type: 'string', description: 'Updated sub-location or area (location only).' },
            timeOfDay: { type: 'string', description: 'Updated time of day (location only).' },
            mood: { type: 'string', description: 'Updated mood (location only).' },
            weather: { type: 'string', description: 'Updated weather (location only).' },
            lighting: { type: 'string', description: 'Updated lighting (location only).' },
            architectureStyle: {
              type: 'string',
              description: 'Architecture style (location only, e.g. brutalist, art deco).',
            },
            dominantColors: {
              type: 'array',
              description: 'Dominant color palette (location only).',
              items: { type: 'string', description: 'A color (name or hex).' },
            },
            keyFeatures: {
              type: 'array',
              description: 'Key visual features of the location (location only).',
              items: { type: 'string', description: 'A feature description.' },
            },
            atmosphereKeywords: {
              type: 'array',
              description: 'Atmosphere keywords (location only, e.g. echoing, musty, vast).',
              items: { type: 'string', description: 'An atmosphere keyword.' },
            },

            // --- equipment fields ---
            equipmentType: {
              type: 'string',
              description: 'Updated equipment type (equipment only).',
              enum: EQUIPMENT_TYPES,
            },
            subtype: { type: 'string', description: 'Updated subtype (equipment only).' },
            function: { type: 'string', description: 'Updated function (equipment only).' },
            material: {
              type: 'string',
              description: 'Material (equipment only, e.g. weathered leather, brushed steel).',
            },
            color: { type: 'string', description: 'Color description (equipment only).' },
            condition: {
              type: 'string',
              description: 'Condition (equipment only, e.g. battle-worn, pristine, antique).',
            },
            visualDetails: {
              type: 'string',
              description: 'Visual detail description for prompts (equipment only).',
            },

            // --- shared ---
            tags: {
              type: 'array',
              description: 'Tags for organizing the entity.',
              items: { type: 'string', description: 'A tag.' },
            },
          },
        },
      },
      required: ['type', 'id', 'set'],
    },
    async execute(args) {
      try {
        const entityType = args.type as EntityType;
        const id = requireString(args, 'id');
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);

        if (entityType === 'character') {
          const characters = await deps.listCharacters();
          const existing = characters.find((c) => c.id === id);
          if (!existing) {
            return { success: false, error: `Character not found: ${id}` };
          }
          const face =
            typeof set.face === 'object' && set.face !== null
              ? (set.face as Record<string, unknown>)
              : undefined;
          const hair =
            typeof set.hair === 'object' && set.hair !== null
              ? (set.hair as Record<string, unknown>)
              : undefined;
          const skinTone = typeof set.skinTone === 'string' ? set.skinTone : undefined;
          const body =
            typeof set.body === 'object' && set.body !== null
              ? (set.body as Record<string, unknown>)
              : undefined;
          const distinctTraits = Array.isArray(set.distinctTraits)
            ? set.distinctTraits.filter((t): t is string => typeof t === 'string')
            : undefined;
          const vocalTraits =
            typeof set.vocalTraits === 'object' && set.vocalTraits !== null
              ? (set.vocalTraits as Record<string, unknown>)
              : undefined;
          const updated: Character = {
            ...existing,
            ...(set.name !== undefined && { name: requireSetString(set, 'name') }),
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
            ...(Array.isArray(set.tags) && {
              tags: set.tags.filter((t): t is string => typeof t === 'string'),
            }),
            updatedAt: Date.now(),
          };
          await deps.saveCharacter(updated);
          return { success: true, data: updated, ...(warnings.length > 0 && { warnings }) };
        }

        if (entityType === 'location') {
          const locations = await deps.listLocations();
          const existing = locations.find((l) => l.id === id);
          if (!existing) {
            return { success: false, error: `Location not found: ${id}` };
          }
          const updated: Location = {
            ...existing,
            ...(set.name !== undefined && { name: requireSetString(set, 'name') }),
            ...(normalizeLocationType(set.locationType) !== undefined && {
              type: normalizeLocationType(set.locationType),
            }),
            ...(set.subLocation !== undefined && { subLocation: set.subLocation as string }),
            ...(set.description !== undefined && { description: set.description as string }),
            ...(set.timeOfDay !== undefined && { timeOfDay: set.timeOfDay as string }),
            ...(set.mood !== undefined && { mood: set.mood as string }),
            ...(set.weather !== undefined && { weather: set.weather as string }),
            ...(set.lighting !== undefined && { lighting: set.lighting as string }),
            ...(typeof set.architectureStyle === 'string' && {
              architectureStyle: set.architectureStyle,
            }),
            ...(Array.isArray(set.dominantColors) && {
              dominantColors: (set.dominantColors as unknown[]).filter(
                (c): c is string => typeof c === 'string',
              ),
            }),
            ...(Array.isArray(set.keyFeatures) && {
              keyFeatures: (set.keyFeatures as unknown[]).filter(
                (f): f is string => typeof f === 'string',
              ),
            }),
            ...(Array.isArray(set.atmosphereKeywords) && {
              atmosphereKeywords: (set.atmosphereKeywords as unknown[]).filter(
                (k): k is string => typeof k === 'string',
              ),
            }),
            ...(Array.isArray(set.tags) && {
              tags: (set.tags as unknown[]).filter((t): t is string => typeof t === 'string'),
            }),
            updatedAt: Date.now(),
          };
          await deps.saveLocation(updated);
          return { success: true, data: updated, ...(warnings.length > 0 && { warnings }) };
        }

        if (entityType === 'equipment') {
          const items = await deps.listEquipment();
          const existing = items.find((e) => e.id === id);
          if (!existing) {
            return { success: false, error: `Equipment not found: ${id}` };
          }
          const updated: Equipment = {
            ...existing,
            ...(set.name !== undefined && { name: requireSetString(set, 'name') }),
            ...(set.equipmentType !== undefined && { type: set.equipmentType as EquipmentType }),
            ...(set.subtype !== undefined && {
              subtype: typeof set.subtype === 'string' ? set.subtype : existing.subtype,
            }),
            ...(set.description !== undefined && { description: set.description as string }),
            ...(set.function !== undefined && { function: set.function as string }),
            ...(typeof set.material === 'string' && { material: set.material }),
            ...(typeof set.color === 'string' && { color: set.color }),
            ...(typeof set.condition === 'string' && { condition: set.condition }),
            ...(typeof set.visualDetails === 'string' && { visualDetails: set.visualDetails }),
            ...(Array.isArray(set.tags) && {
              tags: (set.tags as unknown[]).filter((t): t is string => typeof t === 'string'),
            }),
            updatedAt: Date.now(),
          };
          await deps.saveEquipment(updated);
          return { success: true, data: updated, ...(warnings.length > 0 && { warnings }) };
        }

        return { success: false, error: `Unknown entity type: ${String(args.type)}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // entity.delete
  // -------------------------------------------------------------------------
  const entityDelete: AgentTool = {
    name: 'entity.delete',
    description: 'Delete an entity by ID.',
    tags: ['entity', 'mutate'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        id: { type: 'string', description: 'The entity ID to delete (obtain from entity.list).' },
      },
      required: ['type', 'id'],
    },
    async execute(args) {
      try {
        const entityType = args.type as EntityType;
        const id = requireString(args, 'id');
        if (entityType === 'character') {
          await deps.deleteCharacter(id);
        } else if (entityType === 'location') {
          await deps.deleteLocation(id);
        } else if (entityType === 'equipment') {
          await deps.deleteEquipment(id);
        } else {
          return { success: false, error: `Unknown entity type: ${String(args.type)}` };
        }
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // Shared ref-image logic helpers
  // -------------------------------------------------------------------------

  type AnyEntity = Character | Location | Equipment;

  function resolveEntityHandlers(entityType: EntityType): {
    getEntity: (id: string) => Promise<AnyEntity | null>;
    saveEntity: (entity: AnyEntity) => Promise<void>;
    parseView: (raw: unknown) => CharacterRefImageView | LocationRefImageView | EquipmentRefImageView;
    buildPrompt: (entity: AnyEntity, view: CharacterRefImageView | LocationRefImageView | EquipmentRefImageView, stylePlate?: string) => string;
    viewToSlot: (view: CharacterRefImageView | LocationRefImageView | EquipmentRefImageView) => string;
    entityLabelCap: string;
  } {
    if (entityType === 'character') {
      return {
        getEntity: async (id) => {
          const items = await deps.listCharacters();
          return (items.find((c) => c.id === id) as Character) ?? null;
        },
        saveEntity: (e) => deps.saveCharacter(e as Character),
        parseView: parseCharacterView,
        buildPrompt: (e, v, sp) =>
          buildCharacterRefImagePrompt(e as Character, v as CharacterRefImageView, sp),
        viewToSlot: (v) => characterViewToSlot(v as CharacterRefImageView),
        entityLabelCap: 'Character',
      };
    }
    if (entityType === 'location') {
      return {
        getEntity: async (id) => {
          const items = await deps.listLocations();
          return (items.find((l) => l.id === id) as Location) ?? null;
        },
        saveEntity: (e) => deps.saveLocation(e as Location),
        parseView: parseLocationView,
        buildPrompt: (e, v, sp) =>
          buildLocationRefImagePrompt(e as Location, v as LocationRefImageView, sp),
        viewToSlot: (v) => locationViewToSlot(v as LocationRefImageView),
        entityLabelCap: 'Location',
      };
    }
    // equipment
    return {
      getEntity: async (id) => {
        const items = await deps.listEquipment();
        return (items.find((e) => e.id === id) as Equipment) ?? null;
      },
      saveEntity: (e) => deps.saveEquipment(e as Equipment),
      parseView: parseEquipmentView,
      buildPrompt: (e, v, sp) =>
        buildEquipmentRefImagePrompt(e as Equipment, v as EquipmentRefImageView, sp),
      viewToSlot: (v) => equipmentViewToSlot(v as EquipmentRefImageView),
      entityLabelCap: 'Equipment',
    };
  }

  async function resolveCanvasSettings(
    canvasId: unknown,
  ): Promise<CanvasSettings | undefined> {
    if (
      typeof canvasId === 'string' &&
      canvasId.trim().length > 0 &&
      deps.getCanvas
    ) {
      try {
        const canvas = await deps.getCanvas(canvasId);
        return canvas.settings;
      } catch {
        // Canvas lookup failed — fall through with no canvas settings.
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // entity.generateRefImage
  // -------------------------------------------------------------------------
  const entityGenerateRefImage: AgentTool = {
    name: 'entity.generateRefImage',
    description:
      'Generate a new AI reference image for an entity. ' +
      'Requires the entity ID from entity.list. ' +
      'Pass a canvasId so the canvas-scoped style prompt is woven into the generation prompt. ' +
      'View defaults to the primary composite kind (full-sheet for character, bible for location, ortho-grid for equipment). ' +
      'Optionally specify dimensions, provider, and a custom prompt.',
    tags: ['entity', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        id: { type: 'string', description: 'The entity ID (obtain from entity.list).' },
        view: VIEW_PARAM,
        canvasId: {
          type: 'string',
          description:
            'Canvas ID whose settings (stylePlate, provider overrides) drive prompt composition.',
        },
        width: {
          type: 'number',
          description: `Image width in pixels. When omitted, the provider's maximum supported resolution is used automatically.`,
        },
        height: {
          type: 'number',
          description: `Image height in pixels. When omitted, the provider's maximum supported resolution is used automatically.`,
        },
        prompt: {
          type: 'string',
          description:
            'Optional supplementary prompt merged with the composite prompt. ' +
            'The composite prompt (entity appearance + style plate + layout) is ALWAYS generated; ' +
            'this field adds extra instructions (e.g. specific pose, mood, angle emphasis) AFTER the composite.',
        },
        providerId: {
          type: 'string',
          description:
            'Optional provider ID override (falls back to canvas setting, then global default).',
        },
      },
      required: ['type', 'id'],
    },
    async execute(args) {
      try {
        if (!deps.generateImage) {
          return { success: false, error: 'Image generation not available' };
        }
        const entityType = args.type as EntityType;
        const id = requireString(args, 'id');
        const handlers = resolveEntityHandlers(entityType);

        const entity = await handlers.getEntity(id);
        if (!entity) {
          return { success: false, error: `${handlers.entityLabelCap} not found: ${id}` };
        }

        let view: CharacterRefImageView | LocationRefImageView | EquipmentRefImageView;
        try {
          view = handlers.parseView(args.view);
        } catch (viewErr) {
          return {
            success: false,
            error: viewErr instanceof Error ? viewErr.message : String(viewErr),
          };
        }
        const slot = handlers.viewToSlot(view);

        const canvasSettings = await resolveCanvasSettings(args.canvasId);
        const stylePlate = readStylePlateFromCanvas(
          canvasSettings ? ({ settings: canvasSettings } as Canvas) : undefined,
        );

        const customPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
        const negativePrompt = canvasSettings?.negativePrompt?.trim() ?? '';
        const compositePrompt = handlers.buildPrompt(entity, view, stylePlate);
        let finalPrompt = compositePrompt;
        if (customPrompt.length > 0) {
          finalPrompt = `${compositePrompt}\n\nAdditional instructions: ${customPrompt}`;
        }
        if (negativePrompt.length > 0) {
          finalPrompt = `${finalPrompt}\n\nAvoid: ${negativePrompt}`;
        }

        const canvasRefW = canvasSettings?.refResolution?.width;
        const canvasRefH = canvasSettings?.refResolution?.height;
        const reqWidth =
          typeof args.width === 'number' && args.width > 0 ? args.width : canvasRefW;
        const reqHeight =
          typeof args.height === 'number' && args.height > 0 ? args.height : canvasRefH;

        const explicitProvider = tryProviderId(args.providerId);
        const canvasProvider = tryProviderId(canvasSettings?.imageProviderId);
        const providerId = explicitProvider ?? canvasProvider;

        const result = await deps.generateImage(finalPrompt, {
          ...(reqWidth !== undefined && { width: reqWidth }),
          ...(reqHeight !== undefined && { height: reqHeight }),
          ...(providerId !== undefined && { providerId }),
        });

        const referenceImages: ReferenceImage[] = [...(entity.referenceImages ?? [])];
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          const existing = referenceImages[existingIndex];
          const prevVariants = [...(existing.variants ?? [])];
          if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
            prevVariants.push(existing.assetHash);
          }
          if (!prevVariants.includes(result.assetHash)) {
            prevVariants.push(result.assetHash);
          }
          referenceImages[existingIndex] = {
            ...existing,
            assetHash: result.assetHash,
            variants: prevVariants,
          };
        } else {
          referenceImages.push({
            slot,
            assetHash: result.assetHash,
            isStandard: true,
            variants: [result.assetHash],
          });
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await handlers.saveEntity(entity);

        const variantCount =
          referenceImages.find((image) => image.slot === slot)?.variants?.length ?? 0;
        return {
          success: true,
          data: {
            assetHash: result.assetHash,
            slot,
            view,
            variantCount,
            promptSource: customPrompt.length > 0 ? 'composite+custom' : 'composite',
            stylePlateUsed: Boolean(stylePlate),
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // entity.setRefImage
  // -------------------------------------------------------------------------
  const entitySetRefImage: AgentTool = {
    name: 'entity.setRefImage',
    description: 'Assign an existing asset hash as a reference image for an entity.',
    tags: ['entity', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        id: { type: 'string', description: 'The entity ID.' },
        view: VIEW_PARAM,
        assetHash: { type: 'string', description: 'CAS asset hash to assign.' },
      },
      required: ['type', 'id', 'view', 'assetHash'],
    },
    async execute(args) {
      try {
        const entityType = args.type as EntityType;
        const handlers = resolveEntityHandlers(entityType);
        const entity = await handlers.getEntity(args.id as string);
        if (!entity) {
          return { success: false, error: `${handlers.entityLabelCap} not found: ${args.id}` };
        }
        if (typeof args.assetHash !== 'string' || !args.assetHash.trim()) {
          throw new Error('assetHash is required');
        }

        let view: CharacterRefImageView | LocationRefImageView | EquipmentRefImageView;
        try {
          view = handlers.parseView(args.view);
        } catch (viewErr) {
          return {
            success: false,
            error: viewErr instanceof Error ? viewErr.message : String(viewErr),
          };
        }
        const slot = handlers.viewToSlot(view);
        const assetHash = args.assetHash;
        const referenceImages: ReferenceImage[] = [...(entity.referenceImages ?? [])];
        const referenceImage: ReferenceImage = { slot, assetHash, isStandard: true };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await handlers.saveEntity(entity);

        return { success: true, data: { assetHash, slot, view } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // entity.deleteRefImage
  // -------------------------------------------------------------------------
  const entityDeleteRefImage: AgentTool = {
    name: 'entity.deleteRefImage',
    description: 'Delete a reference image by view from an entity.',
    tags: ['entity', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        id: { type: 'string', description: 'The entity ID.' },
        view: VIEW_PARAM,
      },
      required: ['type', 'id', 'view'],
    },
    async execute(args) {
      try {
        const entityType = args.type as EntityType;
        const handlers = resolveEntityHandlers(entityType);
        const entity = await handlers.getEntity(args.id as string);
        if (!entity) {
          return { success: false, error: `${handlers.entityLabelCap} not found: ${args.id}` };
        }

        let view: CharacterRefImageView | LocationRefImageView | EquipmentRefImageView;
        try {
          view = handlers.parseView(args.view);
        } catch (viewErr) {
          return {
            success: false,
            error: viewErr instanceof Error ? viewErr.message : String(viewErr),
          };
        }
        const slot = handlers.viewToSlot(view);
        entity.referenceImages = (entity.referenceImages ?? []).filter(
          (image) => image.slot !== slot,
        );
        entity.updatedAt = Date.now();
        await handlers.saveEntity(entity);

        return { success: true, data: { id: entity.id, slot, view } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  // -------------------------------------------------------------------------
  // entity.setRefImageFromNode
  // -------------------------------------------------------------------------
  const entitySetRefImageFromNode: AgentTool = {
    name: 'entity.setRefImageFromNode',
    description:
      'Pull a generated asset from a canvas node and assign it as a reference image for an entity.',
    tags: ['entity', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        type: ENTITY_TYPE_PARAM,
        id: { type: 'string', description: 'The entity ID (obtain from entity.list).' },
        view: VIEW_PARAM,
        canvasId: { type: 'string', description: 'Canvas ID containing the node.' },
        nodeId: { type: 'string', description: 'Image node ID to pull the asset from.' },
      },
      required: ['type', 'id', 'view', 'canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        if (!deps.getCanvas) return { success: false, error: 'getCanvas not available' };
        if (typeof args.canvasId !== 'string' || !args.canvasId.trim())
          throw new Error('canvasId is required');
        if (typeof args.nodeId !== 'string' || !args.nodeId.trim())
          throw new Error('nodeId is required');

        const entityType = args.type as EntityType;
        const handlers = resolveEntityHandlers(entityType);

        let view: CharacterRefImageView | LocationRefImageView | EquipmentRefImageView;
        try {
          view = handlers.parseView(args.view);
        } catch (viewErr) {
          return {
            success: false,
            error: viewErr instanceof Error ? viewErr.message : String(viewErr),
          };
        }
        const slot = handlers.viewToSlot(view);

        const canvas = await deps.getCanvas(args.canvasId);
        const node = canvas.nodes.find((n) => n.id === args.nodeId);
        if (!node) return { success: false, error: `Node not found: ${args.nodeId}` };
        if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
          return {
            success: false,
            error: `Node type does not support reference images: ${node.type}`,
          };
        }
        const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
        const variants = Array.isArray(data.variants) ? data.variants : [];
        const idx = typeof data.selectedVariantIndex === 'number' ? data.selectedVariantIndex : 0;
        const assetHash = variants[idx] ?? data.assetHash;
        if (typeof assetHash !== 'string' || !assetHash)
          return { success: false, error: 'No generated asset on node' };

        const entity = await handlers.getEntity(args.id as string);
        if (!entity) {
          return { success: false, error: `${handlers.entityLabelCap} not found: ${args.id}` };
        }
        entity.referenceImages = (entity.referenceImages ?? []).filter(
          (image) => image.slot !== slot,
        );
        entity.referenceImages.push({ slot, assetHash, isStandard: true });
        entity.updatedAt = Date.now();
        await handlers.saveEntity(entity);

        return { success: true, data: { id: entity.id, slot, view, assetHash } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    entityList,
    entityCreate,
    entityUpdate,
    entityDelete,
    entityGenerateRefImage,
    entitySetRefImage,
    entityDeleteRefImage,
    entitySetRefImageFromNode,
  ];
}
