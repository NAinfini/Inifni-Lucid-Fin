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
});
