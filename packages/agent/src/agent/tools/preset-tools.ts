import {
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetDefinition,
  type PresetResetScope,
} from '@lucid-fin/contracts';
import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';
import { authorityFact, contextProjector, record, records, resultRecord } from './context-replay.js';
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  finitePrimitiveSchema,
  numberSchema,
  objectSchema,
  recordSchema,
  stringArraySchema,
  stringSchema,
  toProviderParameterSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

const presetParamValueSchema = finitePrimitiveSchema;
const presetParamMapSchema = recordSchema(presetParamValueSchema);
const presetParameterSchema = objectSchema(
  {
    key: stringSchema,
    label: stringSchema,
    type: enumSchema(['number', 'string', 'boolean', 'enum', 'angle']),
    description: stringSchema,
    required: booleanSchema,
    min: numberSchema,
    max: numberSchema,
    options: stringArraySchema,
    defaultValue: presetParamValueSchema,
  },
  ['key', 'label', 'type', 'defaultValue'],
);
const sphericalPositionSchema = objectSchema(
  {
    label: stringSchema,
    azimuthDeg: numberSchema,
    elevationDeg: numberSchema,
    distance: numberSchema,
    colorHex: stringSchema,
  },
  ['label', 'azimuthDeg', 'elevationDeg'],
);
const presetPromptParameterSchema = objectSchema(
  {
    key: stringSchema,
    label: stringSchema,
    type: enumSchema(['intensity', 'select', 'number']),
    default: unionSchema(stringSchema, numberSchema),
    levels: recordSchema(stringSchema),
    options: stringArraySchema,
    min: numberSchema,
    max: numberSchema,
  },
  ['key', 'label', 'type', 'default'],
);
const presetDefinitionSchema = objectSchema(
  {
    id: stringSchema,
    category: enumSchema([...PRESET_CATEGORIES]),
    name: stringSchema,
    description: stringSchema,
    prompt: stringSchema,
    promptFragment: stringSchema,
    negativePrompt: stringSchema,
    builtIn: booleanSchema,
    modified: booleanSchema,
    defaultPrompt: stringSchema,
    defaultParams: presetParamMapSchema,
    params: arraySchema(presetParameterSchema),
    defaults: presetParamMapSchema,
    sphericalPositions: arraySchema(sphericalPositionSchema),
    promptTemplate: stringSchema,
    promptParamDefs: arraySchema(presetPromptParameterSchema),
    conflictGroup: stringSchema,
    createdAt: numberSchema,
    updatedAt: numberSchema,
  },
  ['id', 'category', 'name', 'description', 'prompt', 'builtIn', 'modified', 'params', 'defaults'],
);
const presetManageDataSchema = unionSchema(
  objectSchema({
    total: numberSchema,
    offset: numberSchema,
    limit: numberSchema,
    presets: arraySchema(presetDefinitionSchema),
  }),
  arraySchema(presetDefinitionSchema),
  presetDefinitionSchema,
  objectSchema({ presetId: stringSchema }),
);

export interface PresetToolDeps {
  listPresets: (category?: PresetCategory) => Promise<PresetDefinition[]>;
  savePreset: (preset: PresetDefinition) => Promise<PresetDefinition>;
  deletePreset: (presetId: string) => Promise<void>;
  resetPreset: (presetId: string, scope?: PresetResetScope) => Promise<PresetDefinition>;
  getPreset: (presetId: string) => Promise<PresetDefinition | null>;
}

function parseOptionalCategory(args: Record<string, unknown>): PresetCategory | undefined {
  if (args.category === undefined) return undefined;
  if (
    typeof args.category === 'string' &&
    PRESET_CATEGORIES.includes(args.category as PresetCategory)
  ) {
    return args.category as PresetCategory;
  }
  throw new Error(`category must be one of ${PRESET_CATEGORIES.join(', ')}`);
}

function parseOptionalResetScope(args: Record<string, unknown>): PresetResetScope | undefined {
  if (args.scope === undefined) return undefined;
  if (args.scope === 'all' || args.scope === 'prompt' || args.scope === 'params') {
    return args.scope;
  }
  throw new Error('scope must be one of all, prompt, or params');
}

export function createPresetTools(deps: PresetToolDeps): ToolDefinition[] {
  const manage: ToolDefinition = {
    name: 'preset.manage',
    process: 'preset-definition-management',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    uiEffects: [{ kind: 'canvas.refresh' }] as const,
    description: 'Manage preset definitions: list, get, create, update, delete, or reset.',
    tier: 2,
    outputSchema: toolResultSchema(presetManageDataSchema),
    projectPublicResult: contextProjector((result, args) => {
      const data = result.success === true ? result.data : undefined;
      if (args.action === 'list') {
        return records(record(data)?.presets).map((preset) =>
          authorityFact('preset', 'read', preset.id),
        );
      }
      if (args.action === 'get') {
        return records(data).map((preset) => authorityFact('preset', 'read', preset.id));
      }
      const id = resultRecord(result)?.id ?? resultRecord(result)?.presetId ?? args.presetId;
      const relation = args.action === 'create'
        ? 'created'
        : args.action === 'delete'
          ? 'deleted'
          : 'updated';
      return [authorityFact('preset', relation, id)];
    }),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'reset'],
          description: 'The action to perform.',
        },
        category: {
          type: 'string',
          description: 'Preset category for the create action.',
          enum: [...PRESET_CATEGORIES],
        },
        categories: {
          type: 'array',
          description:
            'Optional array of preset categories to OR-match against. Matches if preset category is any of the provided values.',
          items: { type: 'string', enum: [...PRESET_CATEGORIES], description: 'A preset category.' },
        },
        query: {
          type: 'string',
          description:
            'Optional search query. Matches against preset name or description (case-insensitive OR logic).',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
        ids: {
          type: 'array',
          items: { type: 'string', description: 'Preset ID.' },
          description: 'Preset IDs to fetch in one call.',
        },
        name: { type: 'string', description: 'Display name (e.g., "Shaky Handheld").' },
        description: { type: 'string', description: 'Short description of the visual effect.' },
        prompt: { type: 'string', description: 'The prompt fragment for AI generation.' },
        preset: toProviderParameterSchema(presetDefinitionSchema),
        presetId: { type: 'string', description: 'The preset ID to delete or reset.' },
        scope: {
          type: 'string',
          description: 'Optional reset scope.',
          enum: ['all', 'prompt', 'params'],
        },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      switch (action) {
        case 'list': {
          try {
            if (args.category !== undefined) {
              return fail('list uses categories; category is only valid for create');
            }
            let categorySet: Set<PresetCategory> | undefined;
            if (Array.isArray(args.categories) && args.categories.length > 0) {
              const validatedCategories: PresetCategory[] = [];
              for (const cat of args.categories as unknown[]) {
                if (typeof cat !== 'string' || !PRESET_CATEGORIES.includes(cat as PresetCategory)) {
                  throw new Error(
                    `categories must contain only ${PRESET_CATEGORIES.join(', ')}`,
                  );
                }
                validatedCategories.push(cat as PresetCategory);
              }
              if (validatedCategories.length > 0) {
                categorySet = new Set(validatedCategories);
              }
            }

            // Fetch presets: for multiple categories fetch each separately and merge (deduped)
            let presets: PresetDefinition[];
            if (categorySet && categorySet.size > 1) {
              const seen = new Set<string>();
              presets = [];
              for (const cat of categorySet) {
                const batch = await deps.listPresets(cat);
                for (const p of batch) {
                  if (!seen.has(p.id)) {
                    seen.add(p.id);
                    presets.push(p);
                  }
                }
              }
            } else {
              presets = await deps.listPresets(categorySet ? [...categorySet][0] : undefined);
            }

            // Apply query filter
            const query =
              typeof args.query === 'string' && args.query.length > 0
                ? args.query.toLowerCase()
                : undefined;
            if (query) {
              presets = presets.filter(
                (p) =>
                  p.name?.toLowerCase().includes(query) ||
                  p.description?.toLowerCase().includes(query),
              );
            }

            const offset =
              typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
            const limit =
              typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
            return ok({
              total: presets.length,
              offset,
              limit,
              presets: presets.slice(offset, offset + limit),
            });
          } catch (error) {
            return fail(error);
          }
        }
        case 'get': {
          try {
            const rawIds = args.ids;
            if (Array.isArray(rawIds) && rawIds.length === 0) {
              return fail('ids array must not be empty');
            }
            if (Array.isArray(rawIds)) {
              const results = [];
              for (const entry of rawIds) {
                const id = typeof entry === 'string' ? entry.trim() : String(entry);
                const preset = await deps.getPreset(id);
                if (!preset) {
                  return fail(new Error(`Preset not found: ${id}`));
                }
                results.push(preset);
              }
              return ok(results);
            }
            return fail('ids must be an array of strings');
          } catch (error) {
            return fail(error);
          }
        }
        case 'create': {
          try {
            const name = requireString(args, 'name');
            const category = parseOptionalCategory(args);
            if (!category) throw new Error('category is required');
            const description = requireString(args, 'description');
            const prompt = requireString(args, 'prompt');
            const preset: PresetDefinition = {
              id: `custom-${crypto.randomUUID()}`,
              category,
              name,
              description,
              prompt,
              builtIn: false,
              modified: false,
              params: [],
              defaults: {},
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            return ok(await deps.savePreset(preset));
          } catch (error) {
            return fail(error);
          }
        }
        case 'update': {
          try {
            if (!args.preset || typeof args.preset !== 'object' || Array.isArray(args.preset)) {
              throw new Error('preset must be a valid object');
            }
            return ok(await deps.savePreset(args.preset as PresetDefinition));
          } catch (error) {
            return fail(error);
          }
        }
        case 'delete': {
          try {
            const presetId = requireString(args, 'presetId');
            await deps.deletePreset(presetId);
            return ok({ presetId });
          } catch (error) {
            return fail(error);
          }
        }
        case 'reset': {
          try {
            const presetId = requireString(args, 'presetId');
            const scope = parseOptionalResetScope(args);
            return ok(await deps.resetPreset(presetId, scope));
          } catch (error) {
            return fail(error);
          }
        }
        default:
          return fail(`Unknown action: ${action}`);
      }
    },
  };

  return [manage];
}
