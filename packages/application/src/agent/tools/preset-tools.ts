import {
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetDefinition,
  type PresetResetScope,
} from '@lucid-fin/contracts';
import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface PresetToolDeps {
  listPresets: (category?: PresetCategory) => Promise<PresetDefinition[]>;
  savePreset: (preset: PresetDefinition) => Promise<PresetDefinition>;
  deletePreset: (presetId: string) => Promise<void>;
  resetPreset: (presetId: string, scope?: PresetResetScope) => Promise<PresetDefinition>;
  getPreset: (presetId: string) => Promise<PresetDefinition | null>;
}

function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
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

function requirePreset(args: Record<string, unknown>): PresetDefinition {
  const value = args.preset;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('preset is required');
  }
  return value as PresetDefinition;
}

export function createPresetTools(deps: PresetToolDeps): AgentTool[] {
  const list: AgentTool = {
    name: 'preset.list',
    description: 'List presets in the current project, optionally filtered by category.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional preset category filter.',
          enum: [...PRESET_CATEGORIES],
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const category = parseOptionalCategory(args);
        return ok(await deps.listPresets(category));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const save: AgentTool = {
    name: 'preset.save',
    description: 'Save a preset definition to the current project library.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        preset: {
          type: 'object',
          description: 'The preset definition to save.',
        },
      },
      required: ['preset'],
    },
    async execute(args) {
      try {
        return ok(await deps.savePreset(requirePreset(args)));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const reset: AgentTool = {
    name: 'preset.reset',
    description: 'Reset a built-in preset override back to its base definition.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        presetId: { type: 'string', description: 'The preset ID to reset.' },
        scope: {
          type: 'string',
          description: 'Optional reset scope.',
          enum: ['all', 'prompt', 'params'],
        },
      },
      required: ['presetId'],
    },
    async execute(args) {
      try {
        const presetId = requireString(args, 'presetId');
        const scope = parseOptionalResetScope(args);
        return ok(await deps.resetPreset(presetId, scope));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const del: AgentTool = {
    name: 'preset.delete',
    description: 'Delete a custom preset from the current project library.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        presetId: { type: 'string', description: 'The preset ID to delete.' },
      },
      required: ['presetId'],
    },
    async execute(args) {
      try {
        const presetId = requireString(args, 'presetId');
        await deps.deletePreset(presetId);
        return ok({ presetId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const get: AgentTool = {
    name: 'preset.get',
    description: 'Get a preset definition by ID.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        presetId: { type: 'string', description: 'The preset ID to load.' },
      },
      required: ['presetId'],
    },
    async execute(args) {
      try {
        const presetId = requireString(args, 'presetId');
        const preset = await deps.getPreset(presetId);
        if (!preset) {
          throw new Error(`Preset not found: ${presetId}`);
        }
        return ok(preset);
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, save, del, reset, get];
}
