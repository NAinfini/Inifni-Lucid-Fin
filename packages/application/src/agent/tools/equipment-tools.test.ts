import { describe, expect, it, vi } from 'vitest';
import { createEquipmentTools, type EquipmentToolDeps } from './equipment-tools.js';

function createDeps(): EquipmentToolDeps {
  return {
    listEquipment: vi.fn(async () => []),
    saveEquipment: vi.fn(async () => undefined),
    deleteEquipment: vi.fn(async () => undefined),
  };
}

describe('createEquipmentTools', () => {
  it('assigns expected tags to equipment tools', () => {
    const tools = createEquipmentTools(createDeps());

    expect(tools.find((tool) => tool.name === 'equipment.list')?.tags).toEqual(['equipment', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'equipment.create')?.tags).toEqual(['equipment', 'mutate']);
    expect(tools.find((tool) => tool.name === 'equipment.setRefImage')?.tags).toEqual(['equipment', 'generation', 'mutate']);
    expect(tools.find((tool) => tool.name === 'equipment.setRefImage')?.tier).toBe(3);
  });

  it('tool name list contains split ref image tools and not old ref image tool names', () => {
    const tools = createEquipmentTools(createDeps());
    const names = tools.map((t) => t.name);

    expect(names).toContain('equipment.setRefImage');
    expect(names).toContain('equipment.deleteRefImage');
    expect(names).not.toContain('equipment.refImage');
    expect(names).not.toContain('equipment.generateReferenceImage');
    expect(names).not.toContain('equipment.setReferenceImage');
    expect(names).not.toContain('equipment.deleteReferenceImage');
    expect(names).not.toContain('equipment.setReferenceImageFromNode');
  });

  describe('equipment.list query filter', () => {
    const items = [
      { id: '1', name: 'Sword', type: 'weapon', description: 'sharp blade', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '2', name: 'Shield', type: 'armor', description: 'defensive plate', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '3', name: 'Lantern', type: 'tool', description: 'a glowing light source', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
    ];

    function createDepsWithData() {
      const deps = createDeps();
      vi.mocked(deps.listEquipment).mockResolvedValue(items as never);
      return deps;
    }

    it('returns all equipment when no query is provided', async () => {
      const deps = createDepsWithData();
      const tool = createEquipmentTools(deps).find((t) => t.name === 'equipment.list')!;
      const result = await tool.execute({});
      expect(result).toMatchObject({ success: true, data: { total: 3 } });
    });

    it('filters by name (case-insensitive)', async () => {
      const deps = createDepsWithData();
      const tool = createEquipmentTools(deps).find((t) => t.name === 'equipment.list')!;
      const result = await tool.execute({ query: 'sword' });
      expect(result).toMatchObject({ success: true, data: { total: 1, equipment: [expect.objectContaining({ id: '1' })] } });
    });

    it('filters by type (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createEquipmentTools(deps).find((t) => t.name === 'equipment.list')!;
      const result = await tool.execute({ query: 'armor' });
      expect(result).toMatchObject({ success: true, data: { total: 1, equipment: [expect.objectContaining({ id: '2' })] } });
    });

    it('filters by description (OR logic)', async () => {
      const deps = createDepsWithData();
      const tool = createEquipmentTools(deps).find((t) => t.name === 'equipment.list')!;
      const result = await tool.execute({ query: 'glowing' });
      expect(result).toMatchObject({ success: true, data: { total: 1, equipment: [expect.objectContaining({ id: '3' })] } });
    });

    it('returns empty when query matches nothing', async () => {
      const deps = createDepsWithData();
      const tool = createEquipmentTools(deps).find((t) => t.name === 'equipment.list')!;
      const result = await tool.execute({ query: 'xyz123' });
      expect(result).toMatchObject({ success: true, data: { total: 0, equipment: [] } });
    });
  });

  describe('equipment ref image prompts', () => {
    function createDepsWithEquipment(): EquipmentToolDeps {
      return {
        listEquipment: vi.fn(async () => [
          {
            id: 'eq-1',
            name: 'Signal Lantern',
            type: 'tool',
            subtype: 'nautical',
            description: 'compact storm lantern',
            function: 'guides ships through fog',
            material: 'knurled steel grip with chipped enamel housing',
            color: 'aged navy and brass',
            condition: 'salt-worn',
            visualDetails: 'oil-stained hinge and etched range marks',
            tags: ['marine'],
            referenceImages: [],
            createdAt: 0,
            updatedAt: 0,
          },
        ]),
        saveEquipment: vi.fn(async () => undefined),
        deleteEquipment: vi.fn(async () => undefined),
        generateImage: vi.fn(async () => ({ assetHash: 'hash-1' })),
      };
    }

    it('uses macro photography language for detail closeups', async () => {
      const deps = createDepsWithEquipment();
      const tool = createEquipmentTools(deps).find((entry) => entry.name === 'equipment.generateRefImage');
      if (!tool) throw new Error('Missing equipment.generateRefImage');

      await tool.execute({ id: 'eq-1', slot: 'detail-closeup' });

      expect(deps.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('macro photography, shallow depth of field'),
        expect.anything(),
      );
      expect(deps.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('fine surface textures and engravings visible'),
        expect.anything(),
      );
    });

    it('uses an anonymous human scale reference for in-use shots', async () => {
      const deps = createDepsWithEquipment();
      const tool = createEquipmentTools(deps).find((entry) => entry.name === 'equipment.generateRefImage');
      if (!tool) throw new Error('Missing equipment.generateRefImage');

      await tool.execute({ id: 'eq-1', slot: 'in-use' });

      expect(deps.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('generic human silhouette or anonymous hand for scale reference'),
        expect.anything(),
      );
      expect(deps.generateImage).toHaveBeenCalledWith(
        expect.stringContaining('item is the subject'),
        expect.anything(),
      );
    });
  });
});

