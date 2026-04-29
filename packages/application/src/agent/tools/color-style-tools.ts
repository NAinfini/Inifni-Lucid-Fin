import type { AgentTool } from '../tool-registry.js';
import { defineToolModule } from '../tool-module.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

export interface ColorStyleToolDeps {
  listColorStyles: () => Promise<unknown[]>;
  saveColorStyle: (style: Record<string, unknown>) => Promise<void>;
  deleteColorStyle: (id: string) => Promise<void>;
}

function requireStyle(args: Record<string, unknown>): Record<string, unknown> {
  const value = args.style;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('style is required');
  }
  return value as Record<string, unknown>;
}

export function createColorStyleTools(deps: ColorStyleToolDeps): AgentTool[] {
  const list: AgentTool = {
    name: 'colorStyle.list',
    description: 'List saved color styles in the current project.',
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
      try {
        const styles = await deps.listColorStyles();
        const offset =
          typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit =
          typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return ok({
          total: styles.length,
          offset,
          limit,
          colorStyles: styles.slice(offset, offset + limit),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const save: AgentTool = {
    name: 'colorStyle.save',
    description: 'Save a color style definition to the current project.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        style: {
          type: 'object',
          description: 'The color style definition to save.',
        },
      },
      required: ['style'],
    },
    async execute(args) {
      try {
        const style = requireStyle(args);
        await deps.saveColorStyle(style);
        return ok({ style });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const remove: AgentTool = {
    name: 'colorStyle.delete',
    description: 'Delete a saved color style by ID.',
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The color style ID to delete.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = requireString(args, 'id');
        await deps.deleteColorStyle(id);
        return ok({ id });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, save, remove];
}

export const colorStyleToolModule = defineToolModule({
  name: 'colorStyle',
  createTools: createColorStyleTools,
});
