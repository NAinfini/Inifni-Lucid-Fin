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

    expect(tools.find((tool) => tool.name === 'location.list')?.tags).toEqual(['location', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'location.create')?.tags).toEqual(['location', 'mutate']);
  });

  it('returns expected tool names', () => {
    const tools = createLocationTools(createDeps());
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'location.list',
      'location.create',
      'location.update',
      'location.delete',
      'location.refImage',
    ]);
  });

  describe('location.list query filter', () => {
    const locations = [
      { id: '1', name: 'City Hall', type: 'exterior', description: 'a grand civic building', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '2', name: 'Warehouse', type: 'interior', description: 'dark storage space', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '3', name: 'Rooftop', type: 'int-ext', description: 'open air terrace', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
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

  describe('location.refImage', () => {
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
      vi.mocked(deps.listLocations).mockResolvedValue([{ ...baseLocation, referenceImages: [] }] as never);
      return deps;
    }

    it('action=generate: calls generateImage and saves result', async () => {
      const deps = createDepsWithLocation();
      deps.generateImage = vi.fn(async () => ({ assetHash: 'hash-gen' }));
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'generate', slot: 'main' });
      expect(result).toMatchObject({ success: true, data: { assetHash: 'hash-gen', slot: 'main' } });
      expect(deps.saveLocation).toHaveBeenCalled();
    });

    it('action=generate: returns error when generateImage not available', async () => {
      const deps = createDepsWithLocation();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'generate' });
      expect(result).toMatchObject({ success: false, error: 'Image generation not available' });
    });

    it('action=set: sets a reference image by assetHash', async () => {
      const deps = createDepsWithLocation();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'set', slot: 'atmosphere', assetHash: 'hash-abc' });
      expect(result).toMatchObject({ success: true, data: { assetHash: 'hash-abc', slot: 'atmosphere' } });
      expect(deps.saveLocation).toHaveBeenCalled();
    });

    it('action=delete: removes a reference image slot', async () => {
      const deps = createDeps();
      vi.mocked(deps.listLocations).mockResolvedValue([{
        ...baseLocation,
        referenceImages: [{ slot: 'main', assetHash: 'hash-old', isStandard: true }],
      }] as never);
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'delete', slot: 'main' });
      expect(result).toMatchObject({ success: true, data: { id: 'loc-1', slot: 'main' } });
      const saved = vi.mocked(deps.saveLocation).mock.calls[0][0];
      expect(saved.referenceImages).toHaveLength(0);
    });

    it('action=setFromNode: pulls assetHash from canvas image node', async () => {
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
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'setFromNode', slot: 'main', canvasId: 'canvas-1', nodeId: 'node-1' });
      expect(result).toMatchObject({ success: true, data: { id: 'loc-1', slot: 'main', assetHash: 'hash-from-node' } });
      expect(deps.saveLocation).toHaveBeenCalled();
    });

    it('action=setFromNode: returns error when getCanvas not available', async () => {
      const deps = createDepsWithLocation();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'setFromNode', slot: 'main', canvasId: 'canvas-1', nodeId: 'node-1' });
      expect(result).toMatchObject({ success: false, error: 'getCanvas not available' });
    });

    it('action=set: returns error when location not found', async () => {
      const deps = createDeps();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'missing', action: 'set', slot: 'main', assetHash: 'h' });
      expect(result).toMatchObject({ success: false, error: 'Location not found: missing' });
    });

    it('returns error for unknown action', async () => {
      const deps = createDepsWithLocation();
      const tool = createLocationTools(deps).find((t) => t.name === 'location.refImage')!;
      const result = await tool.execute({ id: 'loc-1', action: 'unknown' });
      expect(result).toMatchObject({ success: false, error: 'Unknown action: unknown' });
    });
  });
});
