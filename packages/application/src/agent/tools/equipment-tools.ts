import {
  equipmentViewToSlot,
  type Canvas,
  type Equipment,
  type EquipmentRefImageView,
  type EquipmentType,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { createRefImageTools } from './ref-image-factory.js';
import { extractSet, warnExtraKeys, requireString, requireSetString } from './tool-result-helpers.js';
import { buildEquipmentRefImagePrompt } from './equipment-prompt.js';

function parseEquipmentView(raw: unknown): EquipmentRefImageView {
  if (raw === undefined || raw === null) return { kind: 'ortho-grid' };
  if (typeof raw !== 'object') {
    throw new Error('view must be an object: { kind: "ortho-grid" | "extra-angle", angle?: string }');
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (kind === 'ortho-grid') return { kind: 'ortho-grid' };
  if (kind === 'extra-angle') {
    if (typeof obj.angle !== 'string' || obj.angle.trim().length === 0) {
      throw new Error('view.angle is required when kind=extra-angle');
    }
    return { kind: 'extra-angle', angle: obj.angle.trim() };
  }
  throw new Error(`view.kind must be "ortho-grid" or "extra-angle" (got ${String(kind)})`);
}

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
    description: 'Create a new equipment item in the current project. To update an existing item, use equipment.update instead. To generate a reference image, use equipment.generateRefImage after creation.',
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
        const name = requireString(args, 'name');
        const equipment: Equipment = {
          id: crypto.randomUUID(),
          name,
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
    description: 'Update an existing equipment item by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched. To create a new item, use equipment.create instead.',
    tags: ['equipment', 'mutate'],
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The equipment ID to update.' },
        set: {
          type: 'object',
          description: 'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
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
        },
      },
      required: ['id', 'set'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        const items = await deps.listEquipment();
        const existing = items.find((e) => e.id === id);
        if (!existing) return { success: false, error: `Equipment not found: ${id}` };
        const set = extractSet(args);
        const warnings = warnExtraKeys(args);
        const updated: Equipment = {
          ...existing,
          ...(set.name !== undefined && { name: requireSetString(set, 'name') }),
          ...(set.type !== undefined && { type: set.type as EquipmentType }),
          ...(set.subtype !== undefined && { subtype: typeof set.subtype === 'string' ? set.subtype : existing.subtype }),
          ...(set.description !== undefined && { description: set.description as string }),
          ...(set.function !== undefined && { function: set.function as string }),
          ...(typeof set.material === 'string' && { material: set.material }),
          ...(typeof set.color === 'string' && { color: set.color }),
          ...(typeof set.condition === 'string' && { condition: set.condition }),
          ...(typeof set.visualDetails === 'string' && { visualDetails: set.visualDetails }),
          ...(Array.isArray(set.tags) && { tags: (set.tags as unknown[]).filter((t): t is string => typeof t === 'string') }),
          updatedAt: Date.now(),
        };
        await deps.saveEquipment(updated);
        return { success: true, data: updated, ...(warnings.length > 0 && { warnings }) };
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
        const id = requireString(args, 'id');
        await deps.deleteEquipment(id);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentRefImages = createRefImageTools<Equipment, EquipmentRefImageView>({
    toolNamePrefix: 'equipment',
    entityLabel: 'equipment',
    tags: ['equipment', 'generation', 'mutate'],
    description:
      'Manage reference images for an equipment item. '
      + 'Default view kind "ortho-grid" produces ONE composite image with front/back/left/right + macro detail on a single sheet. '
      + 'Use view={kind:"extra-angle", angle:"<free form>"} for rare custom needs (in-use shot, cutaway, etc). '
      + 'Always pass canvasId so the canvas-scoped stylePlate is prepended to the prompt.',
    getEntity: async (id) => {
      const items = await deps.listEquipment();
      return items.find((e) => e.id === id) ?? null;
    },
    saveEntity: deps.saveEquipment,
    generateImage: deps.generateImage,
    getCanvas: deps.getCanvas,
    parseView: parseEquipmentView,
    buildPrompt: buildEquipmentRefImagePrompt,
    viewToSlot: equipmentViewToSlot,
    kindEnum: ['ortho-grid', 'extra-angle'],
    defaultWidth: 1360,
    defaultHeight: 2048,
  });

  return [
    equipmentList,
    equipmentCreate,
    equipmentUpdate,
    equipmentDelete,
    ...equipmentRefImages,
  ];
}
