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

  describe('location.list query filter', () => {
    const locations = [
      { id: '1', projectId: '', name: 'City Hall', type: 'exterior', description: 'a grand civic building', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '2', projectId: '', name: 'Warehouse', type: 'interior', description: 'dark storage space', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '3', projectId: '', name: 'Rooftop', type: 'int-ext', description: 'open air terrace', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
    ];

    function createDepsWithData() {
      const deps = createDeps();
      vi.mocked(deps.listLocations).mockResolvedValue(locations as never);
      return deps;
    }

    it('returns all locations when no query is provided', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({});
      expect(result).toMatchObject({ success: true, data: { total: 3 } });
    });

    it('filters by name (case-insensitive)', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'city' });
      expect(result).toMatchObject({ success: true, data: { total: 1, locations: [expect.objectContaining({ id: '1' })] } });
    });

    it('filters by type (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'interior' });
      expect(result).toMatchObject({ success: true, data: { total: 1, locations: [expect.objectContaining({ id: '2' })] } });
    });

    it('filters by description (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'terrace' });
      expect(result).toMatchObject({ success: true, data: { total: 1, locations: [expect.objectContaining({ id: '3' })] } });
    });

    it('returns empty when query matches nothing', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'xyz123' });
      expect(result).toMatchObject({ success: true, data: { total: 0, locations: [] } });
    });
  });
});

