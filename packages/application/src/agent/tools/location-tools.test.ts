import type { Canvas } from '@lucid-fin/contracts';
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

    expect(tools.find((tool) => tool.name === 'location.list')?.tags).toEqual([
      'location',
      'read',
      'search',
    ]);
    expect(tools.find((tool) => tool.name === 'location.create')?.tags).toEqual([
      'location',
      'mutate',
    ]);
  });

  it('returns expected tool names', () => {
    const tools = createLocationTools(createDeps());
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'location.list',
      'location.create',
      'location.update',
      'location.delete',
      'location.setRefImage',
      'location.deleteRefImage',
    ]);
  });

  describe('location.list query filter', () => {
    const locations = [
      {
        id: '1',
        name: 'City Hall',
        type: 'exterior',
        description: 'a grand civic building',
        tags: [],
        referenceImages: [],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: '2',
        name: 'Warehouse',
        type: 'interior',
        description: 'dark storage space',
        tags: [],
        referenceImages: [],
        createdAt: 0,
        updatedAt: 0,
      },
      {
        id: '3',
        name: 'Rooftop',
        type: 'int-ext',
        description: 'open air terrace',
        tags: [],
        referenceImages: [],
        createdAt: 0,
        updatedAt: 0,
      },
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
      expect(result).toMatchObject({
        success: true,
        data: { total: 1, locations: [expect.objectContaining({ id: '1' })] },
      });
    });

    it('filters by type (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'interior' });
      expect(result).toMatchObject({
        success: true,
        data: { total: 1, locations: [expect.objectContaining({ id: '2' })] },
      });
    });

    it('filters by description (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'terrace' });
      expect(result).toMatchObject({
        success: true,
        data: { total: 1, locations: [expect.objectContaining({ id: '3' })] },
      });
    });

    it('returns empty when query matches nothing', async () => {
      const deps = createDepsWithData();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.list')!;
      const result = await tool.execute({ query: 'xyz123' });
      expect(result).toMatchObject({ success: true, data: { total: 0, locations: [] } });
    });
  });

  describe('location ref image tools', () => {
    const baseLocation = {
      id: 'loc-1',
      name: 'Old Library',
      type: 'interior',
      description: 'dusty shelves and dim lanterns',
      tags: [],
      referenceImages: [],
      createdAt: 0,
      updatedAt: 0,
    };

    function createDepsWithLocation() {
      const deps = createDeps();
      vi.mocked(deps.listLocations).mockResolvedValue([
        { ...baseLocation, referenceImages: [] },
      ] as never);
      return deps;
    }

    it('generateRefImage: default view (bible) calls generateImage and saves result', async () => {
      const deps = createDepsWithLocation();
      deps.generateImage = vi.fn(async () => ({ assetHash: 'hash-gen' }));
      const tool = createLocationTools(deps).find((t) => t.name === 'location.generateRefImage')!;
      const result = await tool.execute({ id: 'loc-1' });
      expect(result).toMatchObject({
        success: true,
        data: { assetHash: 'hash-gen', slot: 'bible' },
      });
      expect(deps.saveLocation).toHaveBeenCalled();
    });

    it('generateRefImage: extra-angle view encodes angle into slot', async () => {
      const deps = createDepsWithLocation();
      deps.generateImage = vi.fn(async () => ({ assetHash: 'hash-angle' }));
      const tool = createLocationTools(deps).find((t) => t.name === 'location.generateRefImage')!;
      const result = await tool.execute({
        id: 'loc-1',
        view: { kind: 'extra-angle', angle: 'Low Angle Wide' },
      });
      expect(result).toMatchObject({
        success: true,
        data: { assetHash: 'hash-angle', slot: 'extra-angle:low-angle-wide' },
      });
    });

    it('setRefImage: sets a reference image by assetHash using view kind', async () => {
      const deps = createDepsWithLocation();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.setRefImage')!;
      const result = await tool.execute({
        id: 'loc-1',
        view: { kind: 'fake-360' },
        assetHash: 'hash-abc',
      });
      expect(result).toMatchObject({
        success: true,
        data: { assetHash: 'hash-abc', slot: 'fake-360' },
      });
      expect(deps.saveLocation).toHaveBeenCalled();
    });

    it('deleteRefImage: removes a reference image by view kind', async () => {
      const deps = createDeps();
      vi.mocked(deps.listLocations).mockResolvedValue([
        {
          ...baseLocation,
          referenceImages: [{ slot: 'bible', assetHash: 'hash-old', isStandard: true }],
        },
      ] as never);
      const tool = createLocationTools(deps).find((t) => t.name === 'location.deleteRefImage')!;
      const result = await tool.execute({ id: 'loc-1', view: { kind: 'bible' } });
      expect(result).toMatchObject({ success: true, data: { id: 'loc-1', slot: 'bible' } });
      const saved = vi.mocked(deps.saveLocation).mock.calls[0][0];
      expect(saved.referenceImages).toHaveLength(0);
    });

    it('setRefImageFromNode: pulls assetHash from canvas image node', async () => {
      const mockCanvas: Canvas = {
        id: 'canvas-1',
        name: 'Canvas',
        nodes: [
          {
            id: 'node-1',
            type: 'image',
            data: { assetHash: 'hash-from-node', variants: [], selectedVariantIndex: 0 },
            position: { x: 0, y: 0 },
          } as never,
        ],
        edges: [],
        createdAt: 0,
        updatedAt: 0,
      } as never;
      const deps = createDepsWithLocation();
      deps.getCanvas = vi.fn(async () => mockCanvas);
      const tool = createLocationTools(deps).find(
        (t) => t.name === 'location.setRefImageFromNode',
      )!;
      const result = await tool.execute({
        id: 'loc-1',
        view: { kind: 'bible' },
        canvasId: 'canvas-1',
        nodeId: 'node-1',
      });
      expect(result).toMatchObject({
        success: true,
        data: { id: 'loc-1', slot: 'bible', assetHash: 'hash-from-node' },
      });
      expect(deps.saveLocation).toHaveBeenCalled();
    });

    it('setRefImage: returns error when location not found', async () => {
      const deps = createDeps();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.setRefImage')!;
      const result = await tool.execute({
        id: 'missing',
        view: { kind: 'bible' },
        assetHash: 'h',
      });
      expect(result).toMatchObject({ success: false, error: 'Location not found: missing' });
    });
  });
});
