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
import type { AgentTool } from '../tool-registry.js';

export interface EquipmentToolDeps {
  listEquipment: () => Promise<Equipment[]>;
  saveEquipment: (equipment: Equipment) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
  generateImage?: (prompt: string, providerId?: string) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
}

const EQUIPMENT_TYPES: EquipmentType[] = ['weapon', 'armor', 'clothing', 'accessory', 'vehicle', 'tool', 'furniture', 'other'];

export function createEquipmentTools(deps: EquipmentToolDeps): AgentTool[] {
  const equipmentList: AgentTool = {
    name: 'equipment.list',
    description: 'List all equipment items in the current project.',
    tags: ['equipment', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      const items = await deps.listEquipment();
      const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
      const mapped = items.map((e) => ({ id: e.id, name: e.name, type: e.type }));
      return { success: true, data: { total: mapped.length, offset, limit, equipment: mapped.slice(offset, offset + limit) } };
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
    description: 'Generate a reference image for an equipment slot. Each slot produces a specific view with plain background, item isolated.',
    tags: ['equipment', 'generation'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID.' },
        slot: {
          type: 'string',
          description: 'Reference image slot. front/back/left-side/right-side = orthographic views; detail-closeup = macro detail; in-use = contextual action shot.',
          enum: ['front', 'back', 'left-side', 'right-side', 'detail-closeup', 'in-use'],
        },
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
        const slotDescriptions: Record<string, string> = {
          'front': 'front orthographic view, straight-on angle, full item visible',
          'back': 'back orthographic view, rear details visible, full item visible',
          'left-side': 'left side orthographic view, pure profile, full item visible',
          'right-side': 'right side orthographic view, pure profile, full item visible',
          'detail-closeup': 'extreme close-up macro view, fine surface textures, material details, engravings and mechanical parts visible',
          'in-use': 'contextual action shot showing the item being held or used, clear view of the item with minimal background',
        };
        const slotDesc = slotDescriptions[slot] ?? `${slot} angle view`;
        const description = entity.description ? `${entity.description}. ` : '';
        const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
          ? args.prompt
          : `Product design reference, solid white background, even studio lighting, no characters, no environment, no scene. `
            + `Item: ${entity.name} (${entity.type}). ${description}${slotDesc}. `
            + `Object only, clean edges, high detail, consistent scale, professional product photography style, technical illustration quality.`;
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

  return [
    equipmentList,
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
