import { NO_TOOL_RESOURCE, toolResultSchema, type ToolDefinition } from '../tool-registry.js';
import { defineToolModule } from '../tool-module.js';
import { ok, fail, requireString } from './tool-result-helpers.js';
import { authorityFact, contextProjector, record, records, resultRecord } from './context-replay.js';
import {
  arraySchema,
  colorStyleSchema,
  numberSchema,
  objectSchema,
  stringSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

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

export function createColorStyleTools(deps: ColorStyleToolDeps): ToolDefinition[] {
  const manage: ToolDefinition = {
    name: 'colorStyle.manage',
    process: 'color-style-management',
    category: 'mutation',
    contextReplay: 'authority_reread',
    resource: NO_TOOL_RESOURCE,
    description: 'Manage color styles: list, save, or delete.',
    tier: 2,
    outputSchema: toolResultSchema(
      unionSchema(
        objectSchema({
          total: numberSchema,
          offset: numberSchema,
          limit: numberSchema,
          colorStyles: arraySchema(colorStyleSchema),
        }),
        objectSchema({ style: colorStyleSchema }),
        objectSchema({ id: stringSchema }),
      ),
    ),
    projectPublicResult: contextProjector((result, args) => {
      const data = resultRecord(result);
      if (args.action === 'list') {
        return records(data?.colorStyles).map((style) =>
          authorityFact('color_style', 'read', style.id),
        );
      }
      if (args.action === 'save') {
        return [authorityFact('color_style', 'updated', record(data?.style)?.id)];
      }
      return [authorityFact('color_style', 'deleted', data?.id ?? args.id)];
    }),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'save', 'delete'],
          description: 'The action to perform.',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
        style: {
          ...colorStyleSchema as Extract<typeof colorStyleSchema, { type: 'object' }>,
          description: 'The color style definition to save.',
        },
        id: { type: 'string', description: 'The color style ID to delete.' },
      },
      required: ['action'],
    },
    async execute(args) {
      const action = args.action as string;
      switch (action) {
        case 'list': {
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
        }
        case 'save': {
          try {
            const style = requireStyle(args);
            await deps.saveColorStyle(style);
            return ok({ style });
          } catch (error) {
            return fail(error);
          }
        }
        case 'delete': {
          try {
            const id = requireString(args, 'id');
            await deps.deleteColorStyle(id);
            return ok({ id });
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

export const colorStyleToolModule = defineToolModule({
  name: 'colorStyle',
  createTools: createColorStyleTools,
});
