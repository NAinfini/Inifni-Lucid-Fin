import {
  NO_TOOL_RESOURCE,
  toolResultSchema,
  type ToolDefinition,
  type ToolRegistry,
} from '../tool-registry.js';
import { COMMANDER_GUIDE_LIMITS, type CommanderPromptGuide } from '@lucid-fin/contracts';
import { ok, fail } from './tool-result-helpers.js';
import {
  arraySchema,
  booleanSchema,
  numberSchema,
  objectSchema,
  recordSchema,
  stringArraySchema,
  stringSchema,
  unionSchema,
} from './tool-runtime-schemas.js';

const toolListEntrySchema = objectSchema({ name: stringSchema, desc: stringSchema });
const inspectedToolSchema = objectSchema({
  name: stringSchema,
  description: stringSchema,
  inputSchemaJson: stringSchema,
});
const toolGetDataSchema = unionSchema(
  recordSchema(arraySchema(toolListEntrySchema)),
  objectSchema(
    {
      tools: arraySchema(inspectedToolSchema),
      notFound: stringArraySchema,
    },
    ['tools'],
  ),
);

const guideListEntrySchema = objectSchema({ id: stringSchema, name: stringSchema });
const guideContentEntrySchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    content: stringSchema,
    totalChars: numberSchema,
    contentOffset: numberSchema,
    contentLength: numberSchema,
    truncated: booleanSchema,
    nextOffset: numberSchema,
  },
  ['id', 'name', 'content', 'totalChars', 'contentOffset', 'contentLength', 'truncated'],
);
const guideGetDataSchema = unionSchema(
  objectSchema({
    total: numberSchema,
    offset: numberSchema,
    limit: numberSchema,
    guides: arraySchema(guideListEntrySchema),
  }),
  objectSchema(
    {
      guides: arraySchema(guideContentEntrySchema),
      notFound: stringArraySchema,
    },
    ['guides'],
  ),
);

const compactDataSchema = unionSchema(
  objectSchema({ note: stringSchema }),
  objectSchema({
    freedChars: numberSchema,
    messageCount: numberSchema,
    toolCount: numberSchema,
    note: stringSchema,
  }),
);

export interface MetaToolDeps {
  promptGuides?: CommanderPromptGuide[];
  context?: string;
  /** Callback to trigger mid-loop context compaction. Optional instructions guide the summary focus. */
  compactContext?: (
    instructions?: string,
  ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
}

export function createMetaTools(registry: ToolRegistry, deps: MetaToolDeps): ToolDefinition[] {
  const promptGuides = deps.promptGuides ?? [];

  const toolGet: ToolDefinition = {
    name: 'tool.get',
    process: 'meta',
    category: 'meta',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description: [
      'Two modes:',
      '  (1) Omit "names" to list all available tools grouped by domain (name + short description only). Use this for browse/menu intent or when the user asks what Commander can do.',
      '  (2) Provide "names" to inspect full parameter schemas for specific tools.',
    ].join('\n'),
    tags: ['meta', 'read'],
    tier: 1,
    outputSchema: toolResultSchema(toolGetDataSchema),
    inputSchema: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: 'Tool name.' },
          description: 'Tool names to inspect. Omit to list all tools grouped by domain.',
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const rawNames = args.names;

        // No names provided or empty array — list all tools grouped by domain
        if (
          rawNames === undefined ||
          rawNames === null ||
          (Array.isArray(rawNames) && rawNames.length === 0)
        ) {
          const allTools = deps.context ? registry.forContext(deps.context) : registry.list();

          const grouped: Record<string, Array<{ name: string; desc: string }>> = {};
          for (const tool of allTools) {
            const domain = tool.name.includes('.') ? tool.name.split('.')[0] : tool.name;
            if (!grouped[domain]) {
              grouped[domain] = [];
            }
            const rawDesc = tool.description ?? '';
            const desc = rawDesc.length > 80 ? rawDesc.slice(0, 80) + '...' : rawDesc;
            grouped[domain].push({ name: tool.name, desc });
          }
          return ok(grouped);
        }

        if (Array.isArray(rawNames)) {
          const results: Array<{
            name: string;
            description: string;
            inputSchemaJson: string;
          }> = [];
          const notFound: string[] = [];
          for (const entry of rawNames) {
            const name = typeof entry === 'string' ? entry.trim() : String(entry);
            const tool = registry.get(name);
            if (!tool) {
              notFound.push(name);
              continue;
            }
            const inputSchemaJson = JSON.stringify(tool.inputSchema);
            if (typeof inputSchemaJson !== 'string') {
              throw new Error(`Tool input schema for ${tool.name} could not be serialized`);
            }
            results.push({
              name: tool.name,
              description: tool.description,
              inputSchemaJson,
            });
          }
          if (results.length === 0 && notFound.length > 0) {
            return {
              success: false,
              error: `None of the requested tools were found: [${notFound.join(', ')}]. Call tool.get() with no arguments to see all available tools.`,
            };
          }
          const response: Record<string, unknown> = { tools: results };
          if (notFound.length > 0) {
            response.notFound = notFound;
          }
          return ok(response);
        }

        return { success: false, error: 'names must be an array of strings' };
      } catch (error) {
        return fail(error);
      }
    },
  };

  const guideGet: ToolDefinition = {
    name: 'guide.get',
    process: 'meta',
    category: 'meta',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description: [
      'Two modes:',
      '  If `ids` is provided: fetch bounded prompt-guide content chunks for one or two ids. Continue from `nextOffset` until `truncated` is false.',
      '  If `ids` is omitted: list all available guides (id and name only, with offset/limit pagination). Use this when the user asks what task lists, skills, or guides are available.',
    ].join('\n'),
    tags: ['meta', 'guide', 'read'],
    tier: 1,
    outputSchema: toolResultSchema(guideGetDataSchema),
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string', description: 'Guide id.' },
          description: 'Array of one or two guide ids to fetch. Omit to list all guides.',
        },
        offset: {
          type: 'number',
          description:
            'Start index for listing (0-based). Default 0. Only used when ids is omitted.',
        },
        limit: {
          type: 'number',
          description:
            'Max items to return for listing. Default and maximum 100. Only used when ids is omitted.',
        },
        contentOffset: {
          type: 'number',
          description: 'Character offset for guide content chunks. Default 0.',
        },
        contentLimit: {
          type: 'number',
          description: 'Characters per guide content chunk. Default and maximum 8000.',
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const rawIds = args.ids;

        // No ids provided or empty array — list all guides
        if (
          rawIds === undefined ||
          rawIds === null ||
          (Array.isArray(rawIds) && rawIds.length === 0)
        ) {
          const guides = promptGuides.map(({ id, name }) => ({ id, name }));
          const offset =
            typeof args.offset === 'number' && Number.isFinite(args.offset) && args.offset >= 0
              ? Math.floor(args.offset)
              : 0;
          const requestedLimit =
            typeof args.limit === 'number' && Number.isFinite(args.limit) && args.limit > 0
              ? Math.floor(args.limit)
              : COMMANDER_GUIDE_LIMITS.defaultGuideListItems;
          const limit = Math.min(requestedLimit, COMMANDER_GUIDE_LIMITS.maxGuideListItems);
          return ok({
            total: guides.length,
            offset,
            limit,
            guides: guides.slice(offset, offset + limit),
          });
        }

        if (!Array.isArray(rawIds) || rawIds.some((id) => typeof id !== 'string')) {
          throw new Error('ids must be an array of strings');
        }
        if (rawIds.length > COMMANDER_GUIDE_LIMITS.maxGuideGetIds) {
          throw new Error(`ids accepts at most ${COMMANDER_GUIDE_LIMITS.maxGuideGetIds} guide ids`);
        }

        const ids = rawIds.map((id) => id.trim());
        if (ids.some((id) => id.length === 0)) {
          throw new Error('ids must contain non-empty guide ids');
        }
        const requestedOffset =
          typeof args.contentOffset === 'number' &&
          Number.isFinite(args.contentOffset) &&
          args.contentOffset >= 0
            ? Math.floor(args.contentOffset)
            : 0;
        const requestedContentLimit =
          typeof args.contentLimit === 'number' &&
          Number.isFinite(args.contentLimit) &&
          args.contentLimit > 0
            ? Math.floor(args.contentLimit)
            : COMMANDER_GUIDE_LIMITS.maxGuideGetContentChars;
        const contentLimit = Math.min(
          requestedContentLimit,
          COMMANDER_GUIDE_LIMITS.maxGuideGetContentChars,
        );

        const results: Array<{
          id: string;
          name: string;
          content: string;
          totalChars: number;
          contentOffset: number;
          contentLength: number;
          truncated: boolean;
          nextOffset?: number;
        }> = [];
        const notFound: string[] = [];
        for (const id of ids) {
          const guide = promptGuides.find((entry) => entry.id === id);
          if (!guide) {
            notFound.push(id);
            continue;
          }
          const totalChars = guide.content.length;
          const contentOffset = Math.min(requestedOffset, totalChars);
          const content = guide.content.slice(contentOffset, contentOffset + contentLimit);
          const nextOffset = contentOffset + content.length;
          const truncated = nextOffset < totalChars;
          results.push({
            id: guide.id,
            name: guide.name,
            content,
            totalChars,
            contentOffset,
            contentLength: content.length,
            truncated,
            ...(truncated ? { nextOffset } : {}),
          });
        }
        if (results.length === 0 && notFound.length > 0) {
          return {
            success: false,
            error: `None of the requested guides were found: [${notFound.join(', ')}]. Call guide.get() with no arguments to see all available guides.`,
          };
        }
        const response: Record<string, unknown> = { guides: results };
        if (notFound.length > 0) {
          response.notFound = notFound;
        }
        return ok(response);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toolCompact: ToolDefinition = {
    name: 'tool.compact',
    process: 'meta',
    category: 'meta',
    contextReplay: 'status_only',
    resource: NO_TOOL_RESOURCE,
    description:
      'Compact conversation context by summarizing old complete exchanges and trimming large results. Optionally pass "instructions" to focus the summary (e.g. "focus on the API changes"). Call proactively when context feels large or before complex multi-step operations.',
    tags: ['meta'],
    tier: 1,
    outputSchema: toolResultSchema(compactDataSchema),
    inputSchema: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description:
            'Optional focus instructions to guide what the compaction summary should emphasize (e.g. "focus on character setup and preset changes").',
        },
      },
      required: [],
    },
    async execute(args) {
      if (!deps.compactContext) {
        return ok({ note: 'Compaction not available in this session.' });
      }
      const instructions = typeof args.instructions === 'string' ? args.instructions : undefined;
      const result = await deps.compactContext(instructions);
      return ok({
        freedChars: result.freedChars,
        messageCount: result.messageCount,
        toolCount: result.toolCount,
        note:
          result.freedChars > 0
            ? `Freed ~${result.freedChars.toLocaleString()} chars of context.`
            : 'Context already compact — nothing to free.',
      });
    },
  };

  return [toolGet, toolCompact, guideGet];
}
