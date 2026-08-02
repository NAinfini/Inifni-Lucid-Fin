import {
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetDefinition,
  type PresetResetScope,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

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

export function createPresetTools(deps: PresetToolDeps): AgentTool[] {
  const manage: AgentTool = {
    name: 'preset.manage',
    description: 'Manage preset definitions: list, get, create, update, delete, or reset.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'reset'],
          description: 'The action to perform.',
        },
        category: {
          type: 'string',
          description:
            'Optional single preset category filter (backward compat). Use categories[] for OR-matching multiple.',
          enum: [...PRESET_CATEGORIES],
        },
        categories: {
          type: 'array',
          description:
            'Optional array of preset categories to OR-match against. Matches if preset category is any of the provided values.',
          items: { type: 'string', description: 'A preset category.' },
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
          description: 'Preset ID or array of preset IDs to fetch.',
        },
        name: { type: 'string', description: 'Display name (e.g., "Shaky Handheld").' },
        description: { type: 'string', description: 'Short description of the visual effect.' },
        prompt: { type: 'string', description: 'The prompt fragment for AI generation.' },
        preset: {
          type: 'object',
          description: 'The full preset definition object to save.',
        },
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
            // Resolve category filter: categories[] takes precedence; if category string passed, wrap it
            let categorySet: Set<PresetCategory> | undefined;
            if (Array.isArray(args.categories) && args.categories.length > 0) {
              const validatedCategories: PresetCategory[] = [];
              for (const cat of args.categories as unknown[]) {
                if (typeof cat === 'string' && PRESET_CATEGORIES.includes(cat as PresetCategory)) {
                  validatedCategories.push(cat as PresetCategory);
                }
              }
              if (validatedCategories.length > 0) {
                categorySet = new Set(validatedCategories);
              }
            } else if (typeof args.category === 'string') {
              const parsed = parseOptionalCategory(args);
              if (parsed !== undefined) {
                categorySet = new Set([parsed]);
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
            if (typeof rawIds === 'string') {
              const id = rawIds.trim();
              const preset = await deps.getPreset(id);
              if (!preset) {
                throw new Error(`Preset not found: ${id}`);
              }
              return ok(preset);
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
            return fail('ids must be a string or array of strings');
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
