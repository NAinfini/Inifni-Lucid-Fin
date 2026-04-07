import { describe, expect, it, vi } from 'vitest';
import type { Location } from '@lucid-fin/contracts';
import { createLocationTools, type LocationToolDeps } from './location-tools.js';

function createLocation(overrides: Partial<Location>): Location {
  return {
    id: 'loc-1',
    projectId: 'project-1',
    name: 'Warehouse',
    type: 'interior',
    description: 'Dusty interior',
    tags: [],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createDeps(locations: Location[]): LocationToolDeps {
  return {
    listLocations: vi.fn(async () => locations),
    saveLocation: vi.fn(async () => undefined),
    deleteLocation: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: LocationToolDeps) {
  const tool = createLocationTools(deps).find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }
  return tool;
}

describe('createLocationTools', () => {
  it('assigns expected tags and exposes location.search', () => {
    const tools = createLocationTools(createDeps([]));

    expect(tools.find((tool) => tool.name === 'location.list')?.tags).toEqual(['location', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'location.search')?.tags).toEqual(['location', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'location.create')?.tags).toEqual(['location', 'mutate']);
  });

  it('searches locations by name substring and exact type', async () => {
    const deps = createDeps([
      createLocation({ id: 'loc-1', name: 'Main Warehouse', type: 'interior' }),
      createLocation({ id: 'loc-2', name: 'Warehouse Roof', type: 'exterior' }),
      createLocation({ id: 'loc-3', name: 'Alley', type: 'exterior' }),
    ]);

    const result = await getTool('location.search', deps).execute({
      query: 'warehouse',
      type: 'exterior',
    });

    expect(result).toEqual({
      success: true,
      data: [{ id: 'loc-2', name: 'Warehouse Roof', type: 'exterior' }],
    });
  });
});
