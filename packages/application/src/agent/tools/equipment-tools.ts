import { EQUIPMENT_STANDARD_SLOTS, type Equipment, type EquipmentType } from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface EquipmentToolDeps {
  listEquipment: () => Promise<Equipment[]>;
  saveEquipment: (equipment: Equipment) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
}

const EQUIPMENT_TYPES: EquipmentType[] = ['weapon', 'armor', 'clothing', 'accessory', 'vehicle', 'tool', 'furniture', 'other'];

export function createEquipmentTools(deps: EquipmentToolDeps): AgentTool[] {
  const equipmentList: AgentTool = {
    name: 'equipment.list',
    description: 'List all equipment items in the current project.',
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      const items = await deps.listEquipment();
      return { success: true, data: items.map((e) => ({ id: e.id, name: e.name, type: e.type })) };
    },
  };

  const equipmentCreate: AgentTool = {
    name: 'equipment.create',
    description: 'Create a new equipment item in the current project.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The equipment name.' },
        type: { type: 'string', description: 'Equipment type.', enum: EQUIPMENT_TYPES },
        subtype: { type: 'string', description: 'Optional subtype.' },
        description: { type: 'string', description: 'A description of the equipment.' },
        function: { type: 'string', description: 'What the equipment does.' },
      },
      required: ['name', 'type', 'description'],
    },
    async execute(args) {
      try {
        const now = Date.now();
        const equipment: Equipment = {
          id: crypto.randomUUID(),
          projectId: '',
          name: args.name as string,
          type: args.type as EquipmentType,
          subtype: (args.subtype as string) || undefined,
          description: args.description as string,
          function: (args.function as string) || undefined,
          tags: [],
          referenceImages: [],
          createdAt: now,
          updatedAt: now,
        };
        await deps.saveEquipment(equipment);
        return { success: true, data: equipment };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentUpdate: AgentTool = {
    name: 'equipment.update',
    description: 'Update an existing equipment item by ID.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID to update.' },
        name: { type: 'string', description: 'Updated name.' },
        type: { type: 'string', description: 'Updated type.', enum: EQUIPMENT_TYPES },
        description: { type: 'string', description: 'Updated description.' },
        function: { type: 'string', description: 'Updated function.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const existing = items.find((e) => e.id === args.id);
        if (!existing) return { success: false, error: `Equipment not found: ${args.id as string}` };
        const updated: Equipment = {
          ...existing,
          name: (args.name as string) ?? existing.name,
          type: (args.type as EquipmentType) ?? existing.type,
          description: (args.description as string) ?? existing.description,
          function: (args.function as string) ?? existing.function,
          updatedAt: Date.now(),
        };
        await deps.saveEquipment(updated);
        return { success: true, data: updated };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentDelete: AgentTool = {
    name: 'equipment.delete',
    description: 'Delete an equipment item by ID.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID to delete.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        await deps.deleteEquipment(args.id as string);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentGenerateReferenceImage: AgentTool = {
    name: 'equipment.generateReferenceImage',
    description: 'Generate a reference image for an equipment slot.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
        prompt: { type: 'string', description: 'Optional custom image generation prompt.' },
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const entity = items.find((equipment) => equipment.id === args.id);
        if (!entity) {
          return { success: false, error: `Equipment not found: ${args.id as string}` };
        }
        if (!deps.generateImage) {
          return { success: false, error: 'Image generation not available' };
        }

        const slot = args.slot as string;
        const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
          ? args.prompt
          : `Equipment reference image: ${entity.name} (${entity.type}). ${entity.description}. Angle: ${slot}`;
        const result = await deps.generateImage(finalPrompt);
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = {
          slot,
          assetHash: result.assetHash,
          isStandard: EQUIPMENT_STANDARD_SLOTS.includes(slot as Equipment['referenceImages'][number]['slot'] & (typeof EQUIPMENT_STANDARD_SLOTS)[number]),
        };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await deps.saveEquipment(entity);

        return { success: true, data: { assetHash: result.assetHash, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentSetReferenceImage: AgentTool = {
    name: 'equipment.setReferenceImage',
    description: 'Set a reference image asset for an equipment slot.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
        assetHash: { type: 'string', description: 'The CAS asset hash to assign.' },
      },
      required: ['id', 'slot', 'assetHash'],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const entity = items.find((equipment) => equipment.id === args.id);
        if (!entity) {
          return { success: false, error: `Equipment not found: ${args.id as string}` };
        }

        const slot = args.slot as string;
        const assetHash = args.assetHash as string;
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = {
          slot,
          assetHash,
          isStandard: EQUIPMENT_STANDARD_SLOTS.includes(slot as Equipment['referenceImages'][number]['slot'] & (typeof EQUIPMENT_STANDARD_SLOTS)[number]),
        };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await deps.saveEquipment(entity);

        return { success: true, data: { assetHash, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentDeleteReferenceImage: AgentTool = {
    name: 'equipment.deleteReferenceImage',
    description: 'Remove a reference image from an equipment slot.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID.' },
        slot: { type: 'string', description: 'The reference image slot or angle.' },
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const entity = items.find((equipment) => equipment.id === args.id);
        if (!entity) {
          return { success: false, error: `Equipment not found: ${args.id as string}` };
        }

        const slot = args.slot as string;
        entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
        entity.updatedAt = Date.now();
        await deps.saveEquipment(entity);

        return { success: true, data: { id: entity.id, slot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    equipmentList,
    equipmentCreate,
    equipmentUpdate,
    equipmentDelete,
    equipmentGenerateReferenceImage,
    equipmentSetReferenceImage,
    equipmentDeleteReferenceImage,
  ];
}
