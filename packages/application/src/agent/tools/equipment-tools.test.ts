import { describe, expect, it, vi } from 'vitest';
import type { Equipment } from '@lucid-fin/contracts';
import { createEquipmentTools, type EquipmentToolDeps } from './equipment-tools.js';

function createEquipment(overrides: Partial<Equipment>): Equipment {
  return {
    id: 'eq-1',
    projectId: 'project-1',
    name: 'Camera Rig',
    type: 'tool',
    description: 'Primary rig',
    tags: [],
    referenceImages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function createDeps(equipment: Equipment[]): EquipmentToolDeps {
  return {
    listEquipment: vi.fn(async () => equipment),
    saveEquipment: vi.fn(async () => undefined),
    deleteEquipment: vi.fn(async () => undefined),
  };
}

function getTool(name: string, deps: EquipmentToolDeps) {
  const tool = createEquipmentTools(deps).find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`Missing tool: ${name}`);
  }
  return tool;
}

describe('createEquipmentTools', () => {
  it('assigns expected tags and exposes equipment.search', () => {
    const tools = createEquipmentTools(createDeps([]));

    expect(tools.find((tool) => tool.name === 'equipment.list')?.tags).toEqual(['equipment', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'equipment.search')?.tags).toEqual(['equipment', 'read', 'search']);
    expect(tools.find((tool) => tool.name === 'equipment.create')?.tags).toEqual(['equipment', 'mutate']);
  });

  it('searches equipment by name substring and exact type', async () => {
    const deps = createDeps([
      createEquipment({ id: 'eq-1', name: 'Hero Sword', type: 'weapon' }),
      createEquipment({ id: 'eq-2', name: 'Hero Shield', type: 'armor' }),
      createEquipment({ id: 'eq-3', name: 'Cart', type: 'vehicle' }),
    ]);

    const result = await getTool('equipment.search', deps).execute({
      query: 'hero',
      type: 'armor',
    });

    expect(result).toEqual({
      success: true,
      data: [{ id: 'eq-2', name: 'Hero Shield', type: 'armor' }],
    });
  });
});
