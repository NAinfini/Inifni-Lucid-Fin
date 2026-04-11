import { describe, expect, it, vi } from 'vitest';
import { createLocationTools, type LocationToolDeps } from './location-tools.js';

function createDeps(): LocationToolDeps {
  return {
    listLocations: vi.fn(async () => []),
    saveLocation: vi.fn(async () => undefined),
    deleteLocation: vi.fn(async () => undefined),
  };
}

describe('createLocationTools', () => {
  it('assigns expected tags to location tools', () => {
    const tools = createLocationTools(createDeps());

    expect(tools.find((tool) => tool.name === 'location.list')?.tags).toEqual(['location', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'location.create')?.tags).toEqual(['location', 'mutate']);
  });
});
