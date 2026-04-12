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
  generateImage?: (prompt: string, options?: { providerId?: string; width?: number; height?: number }) => Promise<{ assetHash: string }>;
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
        query: { type: 'string', description: 'Optional search query. Matches against name, type, or description (case-insensitive OR logic).' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const query = typeof args.query === 'string' && args.query.length > 0
          ? args.query.toLowerCase()
          : undefined;
        let filtered = items;
        if (query) {
          filtered = filtered.filter((e) =>
            e.name?.toLowerCase().includes(query) ||
            e.type?.toLowerCase().includes(query) ||
            e.description?.toLowerCase().includes(query),
          );
        }
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return { success: true, data: { total: filtered.length, offset, limit, equipment: filtered.slice(offset, offset + limit) } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
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
        material: { type: 'string', description: 'Material (e.g. weathered leather, brushed steel).' },
        color: { type: 'string', description: 'Color description.' },
        condition: { type: 'string', description: 'Condition (e.g. battle-worn, pristine, antique).' },
        visualDetails: { type: 'string', description: 'Visual detail description for prompts.' },
        tags: { type: 'array', description: 'Tags for organizing equipment.', items: { type: 'string', description: 'A tag.' } },
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
          material: typeof args.material === 'string' ? args.material : undefined,
          color: typeof args.color === 'string' ? args.color : undefined,
          condition: typeof args.condition === 'string' ? args.condition : undefined,
          visualDetails: typeof args.visualDetails === 'string' ? args.visualDetails : undefined,
          tags: Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === 'string') : [],
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
        subtype: { type: 'string', description: 'Updated subtype.' },
        description: { type: 'string', description: 'Updated description.' },
        function: { type: 'string', description: 'Updated function.' },
        material: { type: 'string', description: 'Material (e.g. weathered leather, brushed steel).' },
        color: { type: 'string', description: 'Color description.' },
        condition: { type: 'string', description: 'Condition (e.g. battle-worn, pristine, antique).' },
        visualDetails: { type: 'string', description: 'Visual detail description for prompts.' },
        tags: { type: 'array', description: 'Tags for organizing equipment.', items: { type: 'string', description: 'A tag.' } },
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
          ...(typeof args.subtype === 'string' && { subtype: args.subtype }),
          ...(typeof args.material === 'string' && { material: args.material }),
          ...(typeof args.color === 'string' && { color: args.color }),
          ...(typeof args.condition === 'string' && { condition: args.condition }),
          ...(typeof args.visualDetails === 'string' && { visualDetails: args.visualDetails }),
          ...(Array.isArray(args.tags) && { tags: args.tags.filter((t): t is string => typeof t === 'string') }),
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

  const equipmentRefImage: AgentTool = {
    name: 'equipment.refImage',
    description: 'Manage reference images for an equipment item. Use action=generate to produce a new image (auto-compiles all equipment fields into the prompt; call ONE at a time, verify success before the next). Use action=set to assign an existing asset hash. Use action=delete to remove a slot. Use action=setFromNode to pull the asset directly from a generated canvas image node.',
    tags: ['equipment', 'generation', 'mutate'],
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID.' },
        action: {
          type: 'string',
          description: 'Operation to perform.',
          enum: ['generate', 'set', 'delete', 'setFromNode'],
        },
        slot: {
          type: 'string',
          description: 'Reference image slot. Default: "main". Use specific slots for targeted views.',
          enum: ['main', 'front', 'back', 'left-side', 'right-side', 'detail-closeup', 'in-use'],
        },
        assetHash: { type: 'string', description: 'The CAS asset hash to assign. Required for action=set.' },
        canvasId: { type: 'string', description: 'The canvas ID. Required for action=setFromNode.' },
        nodeId: { type: 'string', description: 'The image node ID. Required for action=setFromNode.' },
        width: { type: 'number', description: 'Image width in pixels. Default 1024. Auto-clamped to provider max. For action=generate.' },
        height: { type: 'number', description: 'Image height in pixels. Default 1536. Auto-clamped to provider max. For action=generate.' },
        prompt: { type: 'string', description: 'Optional custom prompt override. Default auto-generates from equipment data. For action=generate.' },
        providerId: { type: 'string', description: 'Provider ID override. For action=generate.' },
      },
      required: ['id', 'action'],
    },
    async execute(args) {
      try {
        const action = args.action as string;

        if (action === 'generate') {
          const items = await deps.listEquipment();
          const entity = items.find((equipment) => equipment.id === args.id);
          if (!entity) {
            return { success: false, error: `Equipment not found: ${args.id as string}` };
          }
          if (!deps.generateImage) {
            return { success: false, error: 'Image generation not available' };
          }

          const slot = typeof args.slot === 'string' ? args.slot : 'main';
          const slotDescriptions: Record<string, string> = {
            'main': 'front orthographic view, straight-on angle, full item visible, centered composition',
            'front': 'front orthographic view, straight-on angle, full item visible',
            'back': 'back orthographic view, rear details visible, full item visible',
            'left-side': 'left side orthographic view, pure profile, full item visible',
            'right-side': 'right side orthographic view, pure profile, full item visible',
            'detail-closeup': 'extreme close-up macro view, fine surface textures, material details, engravings and mechanical parts visible',
            'in-use': 'contextual action shot showing the item being held or used, clear view of the item with minimal background',
          };
          const slotDesc = slotDescriptions[slot] ?? `${slot} angle view`;

          const descParts: string[] = [];
          if (entity.description) descParts.push(entity.description);
          if (entity.function) descParts.push(`Function: ${entity.function}`);
          if (entity.material) descParts.push(`Material: ${entity.material}`);
          if (entity.color) descParts.push(`Color: ${entity.color}`);
          if (entity.condition) descParts.push(`Condition: ${entity.condition}`);
          if (entity.visualDetails) descParts.push(`Visual details: ${entity.visualDetails}`);
          if (entity.subtype) descParts.push(`Subtype: ${entity.subtype}`);
          const richDesc = descParts.length > 0 ? descParts.join('. ') + '. ' : '';

          const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
            ? args.prompt
            : `Product design reference, solid white background, even studio lighting, no characters, no environment, no scene. `
              + `Item: ${entity.name} (${entity.type}). ${richDesc}`
              + `${slotDesc}. `
              + `Object only, clean edges, high detail, consistent scale, professional product photography style, technical illustration quality.`;
          const reqWidth = typeof args.width === 'number' && args.width > 0 ? args.width : 1024;
          const reqHeight = typeof args.height === 'number' && args.height > 0 ? args.height : 1536;
          const providerId = typeof args.providerId === 'string' ? args.providerId : undefined;
          const result = await deps.generateImage(finalPrompt, { width: reqWidth, height: reqHeight, providerId });
          const referenceImages = [...(entity.referenceImages ?? [])];
          const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
          if (existingIndex >= 0) {
            const existing = referenceImages[existingIndex];
            const prevVariants = existing.variants ?? [];
            if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
              prevVariants.push(existing.assetHash);
            }
            referenceImages[existingIndex] = {
              ...existing,
              assetHash: result.assetHash,
              variants: prevVariants,
            };
          } else {
            referenceImages.push({
              slot,
              assetHash: result.assetHash,
              isStandard: EQUIPMENT_STANDARD_SLOTS.includes(slot as Equipment['referenceImages'][number]['slot'] & (typeof EQUIPMENT_STANDARD_SLOTS)[number]),
            });
          }

          entity.referenceImages = referenceImages;
          entity.updatedAt = Date.now();
          await deps.saveEquipment(entity);

          return { success: true, data: { assetHash: result.assetHash, slot } };
        }

        if (action === 'set') {
          const items = await deps.listEquipment();
          const entity = items.find((equipment) => equipment.id === args.id);
          if (!entity) {
            return { success: false, error: `Equipment not found: ${args.id as string}` };
          }

          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required for action=set');
          if (typeof args.assetHash !== 'string' || !args.assetHash.trim()) throw new Error('assetHash is required for action=set');
          const slot = args.slot;
          const assetHash = args.assetHash;
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
        }

        if (action === 'delete') {
          const items = await deps.listEquipment();
          const entity = items.find((equipment) => equipment.id === args.id);
          if (!entity) {
            return { success: false, error: `Equipment not found: ${args.id as string}` };
          }

          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required for action=delete');
          const slot = args.slot;
          entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
          entity.updatedAt = Date.now();
          await deps.saveEquipment(entity);

          return { success: true, data: { id: entity.id, slot } };
        }

        if (action === 'setFromNode') {
          if (!deps.getCanvas) return { success: false, error: 'getCanvas not available' };
          if (typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required for action=setFromNode');
          if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) throw new Error('nodeId is required for action=setFromNode');
          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required for action=setFromNode');
          const canvas = await deps.getCanvas(args.canvasId);
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
          const slot = args.slot as string;
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
        }

        return { success: false, error: `Unknown action: ${action}` };
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
    equipmentRefImage,
  ];
}
