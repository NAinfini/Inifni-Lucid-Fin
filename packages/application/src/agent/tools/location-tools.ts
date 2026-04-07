import { LOCATION_STANDARD_SLOTS, type Location } from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface LocationToolDeps {
  listLocations: () => Promise<Location[]>;
  saveLocation: (location: Location) => Promise<void>;
  deleteLocation: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
}

function ok(data?: unknown): ToolResult {
  return { success: true, data };
}

export function createLocationTools(deps: LocationToolDeps): AgentTool[] {
  const locationList: AgentTool = {
    name: 'location.list',
    description: 'List all locations in the current project.',
    tags: ['location', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    async execute(_args) {
      try {
        const locations = await deps.listLocations();
        return { success: true, data: locations };
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
        timeOfDay: { type: 'string', description: 'Typical time of day.' },
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
    description: 'Generate a reference image for a location slot.',
    tags: ['location', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The location ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
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
        const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
          ? args.prompt
          : `Location reference image: ${entity.name} (${entity.type}). ${entity.description}. Mood: ${entity.mood ?? ''}. Lighting: ${entity.lighting ?? ''}. Angle: ${slot}`;
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

  const locationSearch: AgentTool = {
    name: 'location.search',
    description: 'Search locations by name or type. Returns lightweight summaries.',
    tags: ['location', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional name query. Matches location names case-insensitively.',
        },
        type: {
          type: 'string',
          description: 'Optional exact type match.',
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const locations = await deps.listLocations();
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const type = typeof args.type === 'string' ? args.type : undefined;
        const matches = locations
          .filter((location) => (
            (query.length === 0 || location.name.toLowerCase().includes(query))
            && (type === undefined || location.type === type)
          ))
          .map(({ id, name, type: locationType }) => ({ id, name, type: locationType }));
        return ok(matches);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    locationList,
    locationSearch,
    locationCreate,
    locationUpdate,
    locationDelete,
    locationGenerateReferenceImage,
    locationSetReferenceImage,
    locationDeleteReferenceImage,
  ];
}
