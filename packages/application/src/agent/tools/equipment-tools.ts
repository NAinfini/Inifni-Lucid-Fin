import {
  EQUIPMENT_STANDARD_SLOTS,
  type AudioNodeData,
  type Canvas,
  type Equipment,
  type EquipmentType,
  type ImageNodeData,
  type ReferenceImage,
  type VideoNodeData,
} from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface EquipmentToolDeps {
  listEquipment: () => Promise<Equipment[]>;
  saveEquipment: (equipment: Equipment) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

const EQUIPMENT_TYPES: EquipmentType[] = ['weapon', 'armor', 'clothing', 'accessory', 'vehicle', 'tool', 'furniture', 'other'];

function ok(data?: unknown): ToolResult {
  return { success: true, data };
}

export function createEquipmentTools(deps: EquipmentToolDeps): AgentTool[] {
  const equipmentList: AgentTool = {
    name: 'equipment.list',
    description: 'List all equipment items in the current project.',
    tags: ['equipment', 'read', 'search'],
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
    tags: ['equipment', 'mutate'],
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
    tags: ['equipment', 'mutate'],
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
    tags: ['equipment', 'mutate'],
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
    tags: ['equipment', 'generation'],
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
    tags: ['equipment', 'mutate'],
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
    tags: ['equipment', 'mutate'],
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

  const equipmentSearch: AgentTool = {
    name: 'equipment.search',
    description: 'Search equipment by name or type. Returns lightweight summaries.',
    tags: ['equipment', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional name query. Matches equipment names case-insensitively.',
        },
        type: {
          type: 'string',
          description: 'Optional exact type match.',
          enum: EQUIPMENT_TYPES,
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const type = typeof args.type === 'string' ? args.type : undefined;
        const matches = items
          .filter((equipment) => (
            (query.length === 0 || equipment.name.toLowerCase().includes(query))
            && (type === undefined || equipment.type === type)
          ))
          .map(({ id, name, type: equipmentType }) => ({ id, name, type: equipmentType }));
        return ok(matches);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  return [
    equipmentList,
    equipmentSearch,
    equipmentCreate,
    equipmentUpdate,
    equipmentDelete,
    equipmentGenerateReferenceImage,
    equipmentSetReferenceImage,
    equipmentDeleteReferenceImage,
    {
      name: 'equipment.setReferenceImageFromNode',
      description: 'Set an equipment reference image directly from a generated canvas image node.',
      tags: ['equipment', 'mutate'],
      tier: 2,
      parameters: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'The equipment ID.' },
          slot: { type: 'string' as const, description: 'The reference image slot.' },
          canvasId: { type: 'string' as const, description: 'The canvas ID.' },
          nodeId: { type: 'string' as const, description: 'The image node ID.' },
        },
        required: ['id', 'slot', 'canvasId', 'nodeId'],
      },
      async execute(args: Record<string, unknown>) {
        try {
          if (!deps.getCanvas) return { success: false, error: 'getCanvas not available' };
          const canvas = await deps.getCanvas(String(args.canvasId));
          const node = canvas.nodes.find((n) => n.id === args.nodeId);
          if (!node) return { success: false, error: `Node not found: ${args.nodeId}` };
          if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
            return { success: false, error: `Node type does not support reference images: ${node.type}` };
          }
          const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
          const variants = Array.isArray(data.variants) ? data.variants : [];
          const idx = typeof data.selectedVariantIndex === 'number' ? data.selectedVariantIndex : 0;
          const assetHash = variants[idx] ?? data.assetHash;
          if (typeof assetHash !== 'string' || !assetHash) return { success: false, error: 'No generated asset on node' };
          const equipment = await deps.listEquipment();
          const entity = equipment.find((e) => e.id === args.id);
          if (!entity) return { success: false, error: `Equipment not found: ${args.id}` };
          const slot = String(args.slot);
          entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
          entity.referenceImages.push({
            slot,
            assetHash,
            isStandard: EQUIPMENT_STANDARD_SLOTS.includes(
              slot as ReferenceImage['slot'] & (typeof EQUIPMENT_STANDARD_SLOTS)[number],
            ),
          });
          entity.updatedAt = Date.now();
          await deps.saveEquipment(entity);
          return { success: true, data: { id: entity.id, slot, assetHash } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    } as AgentTool,
  ];
}
