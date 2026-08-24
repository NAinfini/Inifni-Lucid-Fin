import type { Equipment, EquipmentType } from '@lucid-fin/contracts';
import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { arraySchema, equipmentSchema, numberSchema, objectSchema } from './tool-runtime-schemas.js';
import {
  extractSet,
  warnExtraKeys,
  requireString,
  requireSetString,
} from './tool-result-helpers.js';
import { authorityFact, contextProjector, records, resultRecord } from './context-replay.js';

export interface EquipmentToolDeps {
  listEquipment: () => Promise<Equipment[]>;
  saveEquipment: (equipment: Equipment) => Promise<void>;
  deleteEquipment: (id: string) => Promise<void>;
}

const EQUIPMENT_TYPES: EquipmentType[] = [
  'weapon',
  'armor',
  'clothing',
  'accessory',
  'vehicle',
  'tool',
  'furniture',
  'other',
];

export function createEquipmentTools(deps: EquipmentToolDeps): ToolDefinition[] {
  const equipmentList: ToolDefinition = {
    name: 'equipment.list',
    process: 'entity-management',
    category: 'query',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'List all equipment items in the current project.',
    tags: ['equipment', 'read', 'search'],
    tier: 1,
    outputSchema: toolResultSchema(objectSchema({
      total: numberSchema,
      offset: numberSchema,
      limit: numberSchema,
      equipment: arraySchema(equipmentSchema),
    })),
    projectPublicResult: contextProjector((result) =>
      records(resultRecord(result)?.equipment).map((item) =>
        authorityFact('equipment', 'read', item.id),
      ),
    ),
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional search query. Matches against name, type, or description (case-insensitive OR logic).',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const items = await deps.listEquipment();
        const query =
          typeof args.query === 'string' && args.query.length > 0
            ? args.query.toLowerCase()
            : undefined;
        let filtered = items;
        if (query) {
          filtered = filtered.filter(
            (e) =>
              e.name?.toLowerCase().includes(query) ||
              e.type?.toLowerCase().includes(query) ||
              e.description?.toLowerCase().includes(query),
          );
        }
        const offset =
          typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return {
          success: true,
          data: {
            total: filtered.length,
            offset,
            limit,
            equipment: filtered.slice(offset, offset + limit),
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentCreate: ToolDefinition = {
    name: 'equipment.create',
    process: 'entity-management',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Create a new equipment item in the current project. To update an existing item, use equipment.update instead. Generate reference images as Canvas image nodes through canvas.generation, then attach an accepted result with entity.setRefImageFromNode.',
    tags: ['equipment', 'mutate'],
    tier: 2,
    outputSchema: toolResultSchema(equipmentSchema),
    projectPublicResult: contextProjector((result) => [
      authorityFact('equipment', 'created', resultRecord(result)?.id),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The equipment name.' },
        type: { type: 'string', description: 'Equipment type.', enum: EQUIPMENT_TYPES },
        subtype: { type: 'string', description: 'Optional subtype.' },
        description: { type: 'string', description: 'A description of the equipment.' },
        function: { type: 'string', description: 'What the equipment does.' },
        material: {
          type: 'string',
          description: 'Material (e.g. weathered leather, brushed steel).',
        },
        color: { type: 'string', description: 'Color description.' },
        condition: {
          type: 'string',
          description: 'Condition (e.g. battle-worn, pristine, antique).',
        },
        visualDetails: { type: 'string', description: 'Visual detail description for prompts.' },
        tags: {
          type: 'array',
          description: 'Tags for organizing equipment.',
          items: { type: 'string', description: 'A tag.' },
        },
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
          tags: Array.isArray(args.tags)
            ? args.tags.filter((t): t is string => typeof t === 'string')
            : [],
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

  const equipmentUpdate: ToolDefinition = {
    name: 'equipment.update',
    process: 'entity-management',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description:
      'Update an existing equipment item by ID. Wrap all fields you want to change inside "set": { ... }. Only fields present in "set" will be applied — omitted fields are left untouched. To create a new item, use equipment.create instead.',
    tags: ['equipment', 'mutate'],
    tier: 2,
    outputSchema: toolResultSchema(equipmentSchema),
    projectPublicResult: contextProjector((result, args) => [
      authorityFact('equipment', 'updated', resultRecord(result)?.id ?? args.id),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The equipment ID to update (obtain from equipment.list).',
        },
        set: {
          type: 'object',
          description:
            'Fields to update. ONLY include the fields you want to change — omitted fields are left untouched.',
          properties: {
            name: { type: 'string', description: 'Updated name.' },
            type: { type: 'string', description: 'Updated type.', enum: EQUIPMENT_TYPES },
            subtype: { type: 'string', description: 'Updated subtype.' },
            description: { type: 'string', description: 'Updated description.' },
            function: { type: 'string', description: 'Updated function.' },
            material: {
              type: 'string',
              description: 'Material (e.g. weathered leather, brushed steel).',
            },
            color: { type: 'string', description: 'Color description.' },
            condition: {
              type: 'string',
              description: 'Condition (e.g. battle-worn, pristine, antique).',
            },
            visualDetails: {
              type: 'string',
              description: 'Visual detail description for prompts.',
            },
            tags: {
              type: 'array',
              description: 'Tags for organizing equipment.',
              items: { type: 'string', description: 'A tag.' },
            },
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
          ...(set.subtype !== undefined && {
            subtype: typeof set.subtype === 'string' ? set.subtype : existing.subtype,
          }),
          ...(set.description !== undefined && { description: set.description as string }),
          ...(set.function !== undefined && { function: set.function as string }),
          ...(typeof set.material === 'string' && { material: set.material }),
          ...(typeof set.color === 'string' && { color: set.color }),
          ...(typeof set.condition === 'string' && { condition: set.condition }),
          ...(typeof set.visualDetails === 'string' && { visualDetails: set.visualDetails }),
          ...(Array.isArray(set.tags) && {
            tags: (set.tags as unknown[]).filter((t): t is string => typeof t === 'string'),
          }),
          updatedAt: Date.now(),
        };
        await deps.saveEquipment(updated);
        return { success: true, data: { ...updated, ...(warnings.length > 0 && { warnings }) } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const equipmentDelete: ToolDefinition = {
    name: 'equipment.delete',
    process: 'entity-management',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'Delete an equipment item by ID.',
    tags: ['equipment', 'mutate'],
    tier: 3,
    outputSchema: toolResultSchema(),
    projectPublicResult: contextProjector((_result, args) => [
      authorityFact('equipment', 'deleted', args.id),
    ]),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The equipment ID to delete (obtain from equipment.list).',
        },
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

  return [equipmentList, equipmentCreate, equipmentUpdate, equipmentDelete];
}
