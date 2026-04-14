import { LOCATION_STANDARD_SLOTS, type Canvas, type Location } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { createRefImageTool } from './ref-image-factory.js';
import { extractSet, warnExtraKeys } from './tool-result-helpers.js';

export interface LocationToolDeps {
  listLocations: () => Promise<Location[]>;
  saveLocation: (location: Location) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  generateImage?: (prompt: string, options?: { providerId?: string; width?: number; height?: number }) => Promise<{ assetHash: string }>;
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
        query: { type: 'string', description: 'Optional search query. Matches against name, type, or description (case-insensitive OR logic).' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const query = typeof args.query === 'string' && args.query.length > 0
          ? args.query.toLowerCase()
          : undefined;
        let filtered = locations;
        if (query) {
          filtered = filtered.filter((l) =>
            l.name?.toLowerCase().includes(query) ||
            l.type?.toLowerCase().includes(query) ||
            l.description?.toLowerCase().includes(query),
          );
        }
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return { success: true, data: { total: filtered.length, offset, limit, locations: filtered.slice(offset, offset + limit) } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationCreate: AgentTool = {
    name: 'location.create',
    description: 'Create a new location in the current project.',
    tags: ['location', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The location name.' },
        type: {
          type: 'string',
          description: 'The location type.',
          enum: ['interior', 'exterior', 'int-ext'],
        },
        description: { type: 'string', description: 'A brief description of the location.' },
        subLocation: { type: 'string', description: 'Sub-location within the main location.' },
        timeOfDay: { type: 'string', description: 'Typical time of day.', enum: ['day', 'night', 'dawn', 'dusk', 'continuous'] },
        mood: { type: 'string', description: 'The mood/atmosphere of the location.' },
        weather: { type: 'string', description: 'Typical weather conditions.' },
        lighting: { type: 'string', description: 'Lighting description.' },
        architectureStyle: { type: 'string', description: 'Architecture style (e.g. brutalist, art deco).' },
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
        tags: { type: 'array', description: 'Tags for organizing locations.', items: { type: 'string', description: 'A tag.' } },
      },
      required: ['name', 'type', 'description'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const location: Location = {
          id: crypto.randomUUID(),
          name: args.name as string,
          type: (args.type as Location['type']) ?? 'interior',
          description: args.description as string,
          subLocation: typeof args.subLocation === 'string' ? args.subLocation : undefined,
          timeOfDay: typeof args.timeOfDay === 'string' ? args.timeOfDay : undefined,
          mood: typeof args.mood === 'string' ? args.mood : undefined,
          weather: typeof args.weather === 'string' ? args.weather : undefined,
          lighting: typeof args.lighting === 'string' ? args.lighting : undefined,
          architectureStyle: typeof args.architectureStyle === 'string' ? args.architectureStyle : undefined,
          dominantColors: Array.isArray(args.dominantColors) ? args.dominantColors.filter((c): c is string => typeof c === 'string') : undefined,
          keyFeatures: Array.isArray(args.keyFeatures) ? args.keyFeatures.filter((f): f is string => typeof f === 'string') : undefined,
          atmosphereKeywords: Array.isArray(args.atmosphereKeywords) ? args.atmosphereKeywords.filter((k): k is string => typeof k === 'string') : undefined,
          tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [],
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
    description: 'Update an existing location by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched.',
    tags: ['location', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID to update.' },
        set: {
          type: 'object',
          description: 'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
            name: { type: 'string', description: 'Updated location name.' },
            type: { type: 'string', description: 'Updated location type.', enum: ['interior', 'exterior', 'int-ext'] },
            description: { type: 'string', description: 'Updated description.' },
            subLocation: { type: 'string', description: 'Updated sub-location.' },
            timeOfDay: { type: 'string', description: 'Updated time of day.' },
            mood: { type: 'string', description: 'Updated mood.' },
            weather: { type: 'string', description: 'Updated weather.' },
            lighting: { type: 'string', description: 'Updated lighting.' },
            architectureStyle: { type: 'string', description: 'Architecture style (e.g. brutalist, art deco).' },
            dominantColors: { type: 'array', description: 'Dominant color palette.', items: { type: 'string', description: 'A color (name or hex).' } },
            keyFeatures: { type: 'array', description: 'Key visual features of the location.', items: { type: 'string', description: 'A feature description.' } },
            atmosphereKeywords: { type: 'array', description: 'Atmosphere keywords (e.g. echoing, musty, vast).', items: { type: 'string', description: 'An atmosphere keyword.' } },
            tags: { type: 'array', description: 'Tags for organizing locations.', items: { type: 'string', description: 'A tag.' } },
          },
        },
      },
      required: ['id', 'set'],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const existing = locations.find((l) => l.id === args.id);
        if (!existing) {
          return { success: false, error: `Location not found: ${args.id}` };
        }
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);
        const updated: Location = {
          ...existing,
          ...(set.name !== undefined && { name: set.name as string }),
          ...(set.type !== undefined && { type: set.type as Location['type'] }),
          ...(set.description !== undefined && { description: set.description as string }),
          ...(set.subLocation !== undefined && { subLocation: set.subLocation as string }),
          ...(set.timeOfDay !== undefined && { timeOfDay: set.timeOfDay as string }),
          ...(set.mood !== undefined && { mood: set.mood as string }),
          ...(set.weather !== undefined && { weather: set.weather as string }),
          ...(set.lighting !== undefined && { lighting: set.lighting as string }),
          ...(typeof set.architectureStyle === 'string' && { architectureStyle: set.architectureStyle }),
          ...(Array.isArray(set.dominantColors) && { dominantColors: (set.dominantColors as unknown[]).filter((c): c is string => typeof c === 'string') }),
          ...(Array.isArray(set.keyFeatures) && { keyFeatures: (set.keyFeatures as unknown[]).filter((f): f is string => typeof f === 'string') }),
          ...(Array.isArray(set.atmosphereKeywords) && { atmosphereKeywords: (set.atmosphereKeywords as unknown[]).filter((k): k is string => typeof k === 'string') }),
          ...(Array.isArray(set.tags) && { tags: (set.tags as unknown[]).filter((t): t is string => typeof t === 'string') }),
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
        await deps.deleteLocation(args.id as string);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationRefImage = createRefImageTool<Location>({
    toolName: 'location.refImage',
    entityLabel: 'location',
    tags: ['location', 'generation', 'mutate'],
    description: 'Manage reference images for a location. Supports generate (auto-compiles location fields into prompt), set (assign by assetHash), delete (remove slot), and setFromNode (pull asset from a canvas image node). IMPORTANT for generate: Call ONE at a time, verify success before generating the next. Never batch parallel generation calls.',
    getEntity: async (id) => {
      const locations = await deps.listLocations();
      return locations.find((l) => l.id === id) ?? null;
    },
    saveEntity: deps.saveLocation,
    generateImage: deps.generateImage,
    getCanvas: deps.getCanvas,
    buildPrompt: (entity, slot) => {
      const typeLabel = entity.type === 'interior' ? 'Interior space' : entity.type === 'exterior' ? 'Exterior view' : 'Interior-exterior transition';
      const slotDescriptions: Record<string, string> = {
        'main': 'wide establishing shot, full environment visible, cinematic composition, showing overall scale and layout',
        'wide-establishing': 'wide establishing shot, full environment visible, cinematic composition, showing overall scale and layout',
        'interior-detail': 'close-up interior detail shot, architectural features, furniture, textures, material quality visible',
        'atmosphere': 'atmospheric mood study, emphasizing lighting, weather, time of day, volumetric light and shadow',
        'key-angle-1': 'key camera angle, eye-level cinematic shot, showing primary viewpoint for scene staging',
        'key-angle-2': 'alternate camera angle, different perspective of the same location, revealing secondary details',
        'overhead': 'overhead bird\'s eye view, looking straight down, showing spatial layout, floor plan perspective',
      };
      const slotDesc = slotDescriptions[slot] ?? `${slot} angle view`;

      const descParts: string[] = [];
      if (entity.description) descParts.push(entity.description);
      if (entity.subLocation) descParts.push(`Sub-location: ${entity.subLocation}`);
      if (entity.architectureStyle) descParts.push(`Architecture: ${entity.architectureStyle}`);
      if (entity.mood) descParts.push(`Mood: ${entity.mood}`);
      if (entity.lighting) descParts.push(`Lighting: ${entity.lighting}`);
      if (entity.weather) descParts.push(`Weather: ${entity.weather}`);
      if (entity.timeOfDay) descParts.push(`Time of day: ${entity.timeOfDay}`);
      if (entity.dominantColors && entity.dominantColors.length > 0) descParts.push(`Color palette: ${entity.dominantColors.join(', ')}`);
      if (entity.keyFeatures && entity.keyFeatures.length > 0) descParts.push(`Key features: ${entity.keyFeatures.join(', ')}`);
      if (entity.atmosphereKeywords && entity.atmosphereKeywords.length > 0) descParts.push(`Atmosphere: ${entity.atmosphereKeywords.join(', ')}`);
      const richDesc = descParts.length > 0 ? descParts.join('. ') + '. ' : '';

      return `Environment concept art reference. Location: ${entity.name}. ${typeLabel}. `
        + `${richDesc}`
        + `${slotDesc}. `
        + `No characters, no people, no figures, empty scene, environment only. `
        + `Consistent architectural style, detailed textures, professional environment concept art, cinematic quality.`;
    },
    isStandardSlot: (slot) => LOCATION_STANDARD_SLOTS.includes(slot as (typeof LOCATION_STANDARD_SLOTS)[number]),
    defaultWidth: 1536,
    defaultHeight: 1024,
  });

  return [
    locationList,
    locationCreate,
    locationUpdate,
    locationDelete,
    locationRefImage,
  ];
}
