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
    expect(tools.find((tool) => tool.name === 'equipment.refImage')?.tags).toEqual(['equipment', 'generation', 'mutate']);
    expect(tools.find((tool) => tool.name === 'equipment.refImage')?.tier).toBe(3);
  });

  it('tool name list contains equipment.refImage and not old ref image tool names', () => {
    const tools = createEquipmentTools(createDeps());
    const names = tools.map((t) => t.name);

    expect(names).toContain('equipment.refImage');
    expect(names).not.toContain('equipment.generateReferenceImage');
    expect(names).not.toContain('equipment.setReferenceImage');
    expect(names).not.toContain('equipment.deleteReferenceImage');
    expect(names).not.toContain('equipment.setReferenceImageFromNode');
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

