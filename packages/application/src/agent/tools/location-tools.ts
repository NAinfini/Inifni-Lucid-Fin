import { LOCATION_STANDARD_SLOTS, type Location } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface LocationToolDeps {
  listLocations: () => Promise<Location[]>;
  saveLocation: (location: Location) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
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
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return { success: true, data: { total: locations.length, offset, limit, locations: locations.slice(offset, offset + limit) } };
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
      },
      required: ['name', 'type', 'description'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const location: Location = {
          id: crypto.randomUUID(),
          projectId: '',
          name: args.name as string,
          type: (args.type as Location['type']) ?? 'interior',
          description: args.description as string,
          subLocation: typeof args.subLocation === 'string' ? args.subLocation : undefined,
          timeOfDay: typeof args.timeOfDay === 'string' ? args.timeOfDay : undefined,
          mood: typeof args.mood === 'string' ? args.mood : undefined,
          weather: typeof args.weather === 'string' ? args.weather : undefined,
          lighting: typeof args.lighting === 'string' ? args.lighting : undefined,
          tags: [],
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
    description: 'Update an existing location by ID.',
    tags: ['location', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID to update.' },
        name: { type: 'string', description: 'Updated location name.' },
        type: {
          type: 'string',
          description: 'Updated location type.',
          enum: ['interior', 'exterior', 'int-ext'],
        },
        description: { type: 'string', description: 'Updated description.' },
        subLocation: { type: 'string', description: 'Updated sub-location.' },
        timeOfDay: { type: 'string', description: 'Updated time of day.' },
        mood: { type: 'string', description: 'Updated mood.' },
        weather: { type: 'string', description: 'Updated weather.' },
        lighting: { type: 'string', description: 'Updated lighting.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const existing = locations.find((l) => l.id === args.id);
        if (!existing) {
          return { success: false, error: `Location not found: ${args.id}` };
        }
        const updated: Location = {
          ...existing,
          ...(args.name !== undefined && { name: args.name as string }),
          ...(args.type !== undefined && { type: args.type as Location['type'] }),
          ...(args.description !== undefined && { description: args.description as string }),
          ...(args.subLocation !== undefined && { subLocation: args.subLocation as string }),
          ...(args.timeOfDay !== undefined && { timeOfDay: args.timeOfDay as string }),
          ...(args.mood !== undefined && { mood: args.mood as string }),
          ...(args.weather !== undefined && { weather: args.weather as string }),
          ...(args.lighting !== undefined && { lighting: args.lighting as string }),
          updatedAt: Date.now(),
        };
        await deps.saveLocation(updated);
        return { success: true, data: updated };
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

  const locationGenerateReferenceImage: AgentTool = {
    name: 'location.generateReferenceImage',
    description: 'Generate a reference image for a location slot. Each slot produces a specific view — environment only, no characters.',
    tags: ['location', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID.' },
        slot: {
          type: 'string',
          description: 'Reference image slot. wide-establishing = full overview; interior-detail = close-up of interior elements; atmosphere = mood/lighting study; key-angle-1/2 = important camera positions; overhead = bird\'s eye layout.',
          enum: ['wide-establishing', 'interior-detail', 'atmosphere', 'key-angle-1', 'key-angle-2', 'overhead'],
        },
        prompt: { type: 'string', description: 'Optional custom image generation prompt.' },
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const entity = locations.find((location) => location.id === args.id);
        if (!entity) {
          return { success: false, error: `Location not found: ${args.id}` };
        }
        if (!deps.generateImage) {
          return { success: false, error: 'Image generation not available' };
        }

        const slot = args.slot as string;
        const typeLabel = entity.type === 'interior' ? 'Interior space' : entity.type === 'exterior' ? 'Exterior view' : 'Interior-exterior transition';
        const slotDescriptions: Record<string, string> = {
          'wide-establishing': 'wide establishing shot, full environment visible, cinematic composition, showing overall scale and layout',
          'interior-detail': 'close-up interior detail shot, architectural features, furniture, textures, material quality visible',
          'atmosphere': 'atmospheric mood study, emphasizing lighting, weather, time of day, volumetric light and shadow',
          'key-angle-1': 'key camera angle, eye-level cinematic shot, showing primary viewpoint for scene staging',
          'key-angle-2': 'alternate camera angle, different perspective of the same location, revealing secondary details',
          'overhead': 'overhead bird\'s eye view, looking straight down, showing spatial layout, floor plan perspective',
        };
        const slotDesc = slotDescriptions[slot] ?? `${slot} angle view`;
        const description = entity.description ? `${entity.description}. ` : '';
        const mood = entity.mood ? `Mood: ${entity.mood}. ` : '';
        const lighting = entity.lighting ? `Lighting: ${entity.lighting}. ` : '';
        const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
          ? args.prompt
          : `Environment concept art reference. Location: ${entity.name}. ${description}${typeLabel}. `
            + `${slotDesc}. ${mood}${lighting}`
            + `No characters, no people, no figures, empty scene, environment only. `
            + `Consistent architectural style, detailed textures, professional environment concept art, cinematic quality.`;
        const result = await deps.generateImage(finalPrompt);
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = {
          slot,
          assetHash: result.assetHash,
          isStandard: LOCATION_STANDARD_SLOTS.includes(slot as Location['referenceImages'][number]['slot'] & (typeof LOCATION_STANDARD_SLOTS)[number]),
        };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await deps.saveLocation(entity);

        return { success: true, data: { assetHash: result.assetHash, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationSetReferenceImage: AgentTool = {
    name: 'location.setReferenceImage',
    description: 'Set a reference image asset for a location slot.',
    tags: ['location', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
        assetHash: { type: 'string', description: 'The CAS asset hash to assign.' },
      },
      required: ['id', 'slot', 'assetHash'],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const entity = locations.find((location) => location.id === args.id);
        if (!entity) {
          return { success: false, error: `Location not found: ${args.id}` };
        }

        const slot = args.slot as string;
        const assetHash = args.assetHash as string;
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = {
          slot,
          assetHash,
          isStandard: LOCATION_STANDARD_SLOTS.includes(slot as Location['referenceImages'][number]['slot'] & (typeof LOCATION_STANDARD_SLOTS)[number]),
        };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await deps.saveLocation(entity);

        return { success: true, data: { assetHash, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const locationDeleteReferenceImage: AgentTool = {
    name: 'location.deleteReferenceImage',
    description: 'Remove a reference image from a location slot.',
    tags: ['location', 'mutate'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const entity = locations.find((location) => location.id === args.id);
        if (!entity) {
          return { success: false, error: `Location not found: ${args.id}` };
        }

        const slot = args.slot as string;
        entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
        entity.updatedAt = Date.now();
        await deps.saveLocation(entity);

        return { success: true, data: { id: entity.id, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    locationList,
    locationCreate,
    locationUpdate,
    locationDelete,
    locationGenerateReferenceImage,
    locationSetReferenceImage,
    locationDeleteReferenceImage,
  ];
}
