import {
  locationViewToSlot,
  type Canvas,
  type Location,
  type LocationRefImageView,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { createRefImageTools } from './ref-image-factory.js';
import {
  extractSet,
  warnExtraKeys,
  requireString,
  requireSetString,
} from './tool-result-helpers.js';
import { buildLocationRefImagePrompt } from './location-prompt.js';

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

const VALID_LOCATION_TYPES = new Set<NonNullable<Location['type']>>([
  'interior',
  'exterior',
  'int-ext',
]);

function normalizeLocationType(value: unknown): Location['type'] | undefined {
  return typeof value === 'string' &&
    VALID_LOCATION_TYPES.has(value as NonNullable<Location['type']>)
    ? (value as NonNullable<Location['type']>)
    : undefined;
}

export interface LocationToolDeps {
  listLocations: () => Promise<Location[]>;
  saveLocation: (location: Location) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  generateImage?: (
    prompt: string,
    options?: { providerId?: string; width?: number; height?: number },
  ) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

export function createLocationTools(deps: LocationToolDeps): AgentTool[] {
  const locationList: AgentTool = {
    name: 'location.list',
    description: 'List all locations in the current project.',
    tags: ['location', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional search query. Matches against name, type, or description (case-insensitive OR logic).',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const query =
          typeof args.query === 'string' && args.query.length > 0
            ? args.query.toLowerCase()
            : undefined;
        let filtered = locations;
        if (query) {
          filtered = filtered.filter(
            (l) =>
              l.name?.toLowerCase().includes(query) ||
              l.type?.toLowerCase().includes(query) ||
              l.description?.toLowerCase().includes(query),
          );
        }
        const offset =
          typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return {
          success: true,
          data: {
            total: filtered.length,
            offset,
            limit,
            locations: filtered.slice(offset, offset + limit),
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationCreate: AgentTool = {
    name: 'location.create',
    description:
      'Create a new location in the current project. To update an existing location, use location.update instead. To generate a reference image, use location.generateRefImage after creation.',
    tags: ['location', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The location name.' },
        type: {
          type: 'string',
          description: 'Location type.',
          enum: ['interior', 'exterior', 'int-ext'],
        },
        subLocation: {
          type: 'string',
          description: 'Optional sub-location or area within the main location.',
        },
        description: { type: 'string', description: 'A brief description of the location.' },
        timeOfDay: {
          type: 'string',
          description: 'Typical time of day.',
          enum: ['day', 'night', 'dawn', 'dusk', 'continuous'],
        },
        mood: { type: 'string', description: 'The mood/atmosphere of the location.' },
        weather: { type: 'string', description: 'Typical weather conditions.' },
        lighting: { type: 'string', description: 'Lighting description.' },
        architectureStyle: {
          type: 'string',
          description: 'Architecture style (e.g. brutalist, art deco).',
        },
        dominantColors: {
          type: 'array',
          description: 'Dominant color palette.',
          items: { type: 'string', description: 'A color (name or hex).' },
        },
        keyFeatures: {
          type: 'array',
          description: 'Key visual features of the location.',
          items: { type: 'string', description: 'A feature description.' },
        },
        atmosphereKeywords: {
          type: 'array',
          description: 'Atmosphere keywords (e.g. echoing, musty, vast).',
          items: { type: 'string', description: 'An atmosphere keyword.' },
        },
        tags: {
          type: 'array',
          description: 'Tags for organizing locations.',
          items: { type: 'string', description: 'A tag.' },
        },
      },
      required: ['name', 'description'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const name = requireString(args, 'name');
        const location: Location = {
          id: crypto.randomUUID(),
          name,
          type: normalizeLocationType(args.type) ?? 'interior',
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
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationUpdate: AgentTool = {
    name: 'location.update',
    description:
      'Update an existing location by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched. To create a new location, use location.create instead.',
    tags: ['location', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID to update.' },
        set: {
          type: 'object',
          description:
            'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
            name: { type: 'string', description: 'Updated location name.' },
            type: {
              type: 'string',
              description: 'Updated location type.',
              enum: ['interior', 'exterior', 'int-ext'],
            },
            subLocation: { type: 'string', description: 'Updated sub-location or area.' },
            description: { type: 'string', description: 'Updated description.' },
            timeOfDay: { type: 'string', description: 'Updated time of day.' },
            mood: { type: 'string', description: 'Updated mood.' },
            weather: { type: 'string', description: 'Updated weather.' },
            lighting: { type: 'string', description: 'Updated lighting.' },
            architectureStyle: {
              type: 'string',
              description: 'Architecture style (e.g. brutalist, art deco).',
            },
            dominantColors: {
              type: 'array',
              description: 'Dominant color palette.',
              items: { type: 'string', description: 'A color (name or hex).' },
            },
            keyFeatures: {
              type: 'array',
              description: 'Key visual features of the location.',
              items: { type: 'string', description: 'A feature description.' },
            },
            atmosphereKeywords: {
              type: 'array',
              description: 'Atmosphere keywords (e.g. echoing, musty, vast).',
              items: { type: 'string', description: 'An atmosphere keyword.' },
            },
            tags: {
              type: 'array',
              description: 'Tags for organizing locations.',
              items: { type: 'string', description: 'A tag.' },
            },
          },
        },
      },
      required: ['id', 'set'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        const locations = await deps.listLocations();
        const existing = locations.find((l) => l.id === id);
        if (!existing) {
          return { success: false, error: `Location not found: ${id}` };
        }
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);
        const updated: Location = {
          ...existing,
          ...(set.name !== undefined && { name: requireSetString(set, 'name') }),
          ...(normalizeLocationType(set.type) !== undefined && {
            type: normalizeLocationType(set.type),
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
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationDelete: AgentTool = {
    name: 'location.delete',
    description: 'Delete a location by ID.',
    tags: ['location', 'mutate'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID to delete.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.deleteLocation(id);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationRefImages = createRefImageTools<Location, LocationRefImageView>({
    toolNamePrefix: 'location',
    entityLabel: 'location',
    tags: ['location', 'generation', 'mutate'],
    description:
      'Manage reference images for a location. ' +
      'Default view kind "bible" produces ONE five-frame composite (wide establish + detail + atmosphere + two key angles). ' +
      'Use view={kind:"fake-360"} for an 8-panel pseudo-panorama when you need full-perimeter coverage. ' +
      'Use view={kind:"extra-angle", angle:"<free form>"} for custom perspectives. ' +
      'Always pass canvasId so the canvas-scoped stylePlate is prepended to the prompt.',
    getEntity: async (id) => {
      const locations = await deps.listLocations();
      return locations.find((l) => l.id === id) ?? null;
    },
    saveEntity: deps.saveLocation,
    generateImage: deps.generateImage,
    getCanvas: deps.getCanvas,
    parseView: parseLocationView,
    buildPrompt: buildLocationRefImagePrompt,
    viewToSlot: locationViewToSlot,
    kindEnum: ['bible', 'fake-360', 'extra-angle'],
    defaultWidth: 2048,
    defaultHeight: 1360,
  });

  return [locationList, locationCreate, locationUpdate, locationDelete, ...locationRefImages];
}
