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
  });

  describe('equipment.list query filter', () => {
    const items = [
      { id: '1', projectId: '', name: 'Sword', type: 'weapon', description: 'sharp blade', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '2', projectId: '', name: 'Shield', type: 'armor', description: 'defensive plate', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
      { id: '3', projectId: '', name: 'Lantern', type: 'tool', description: 'a glowing light source', tags: [], referenceImages: [], createdAt: 0, updatedAt: 0 },
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
});

