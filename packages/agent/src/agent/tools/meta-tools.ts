import type { AgentTool, AgentToolRegistry } from '../tool-registry.js';
import { ok, fail } from './tool-result-helpers.js';

export interface MetaToolDeps {
  promptGuides?: Array<{ id: string; name: string; content: string; autoInject?: boolean }>;
  context?: string;
  /** Callback to trigger mid-loop context compaction. Optional instructions guide the summary focus. */
  compactContext?: (
    instructions?: string,
  ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
}

export function createMetaTools(registry: AgentToolRegistry, deps: MetaToolDeps): AgentTool[] {
  const promptGuides = deps.promptGuides ?? [];

  const toolGet: AgentTool = {
    name: 'tool.get',
    description: [
      'Two modes:',
      '  (1) Omit "names" to list all available tools grouped by domain (name + short description only). Use this for browse/menu intent or when the user asks what Commander can do.',
      '  (2) Provide "names" array to load full parameter schemas for specific tools. Use this before calling a tool whose parameter schema you are unsure about.',
    ].join('\n'),
    tags: ['meta', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: 'Tool name.' },
          description: 'Tool names to load. Omit to list all tools grouped by domain.',
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

        if (typeof rawNames === 'string') {
          const name = rawNames.trim();
          const tool = registry.get(name);
          if (!tool) {
            return {
              success: false,
              error: `Tool '${name}' not found. Call tool.get() with no arguments to see all available tools.`,
            };
          }
          return ok({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          });
        }

        if (Array.isArray(rawNames)) {
          const results: Array<{
            name: string;
            description: string;
            parameters: unknown;
          }> = [];
          const notFound: string[] = [];
          for (const entry of rawNames) {
            const name = typeof entry === 'string' ? entry.trim() : String(entry);
            const tool = registry.get(name);
            if (!tool) {
              notFound.push(name);
              continue;
            }
            results.push({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
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

        return { success: false, error: 'names must be a string or array of strings' };
      } catch (error) {
        return fail(error);
      }
    },
  };

  const guideGet: AgentTool = {
    name: 'guide.get',
    description: [
      'Two modes:',
      '  If `ids` is provided: fetch prompt guide content by id (one or many).',
      '  If `ids` is omitted: list all available guides (id and name only, with offset/limit pagination). Use this when the user asks what workflows, skills, or guides are available.',
    ].join('\n'),
    tags: ['meta', 'guide', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string', description: 'Guide id.' },
          description: 'Guide id or array of guide ids to fetch. Omit to list all guides.',
        },
        offset: {
          type: 'number',
          description:
            'Start index for listing (0-based). Default 0. Only used when ids is omitted.',
        },
        limit: {
          type: 'number',
          description:
            'Max items to return for listing. Default 50. Only used when ids is omitted.',
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
            typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
          const limit =
            typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
          return ok({
            total: guides.length,
            offset,
            limit,
            guides: guides.slice(offset, offset + limit),
          });
        }

        if (typeof rawIds === 'string') {
          const id = rawIds.trim();
          if (!id) {
            throw new Error('ids is required');
          }
          const guide = promptGuides.find((entry) => entry.id === id);
          if (!guide) {
            throw new Error(`Guide not found: ${id}`);
          }
          return ok(guide);
        }

        if (Array.isArray(rawIds)) {
          const results: Array<{ id: string; name: string; content: string }> = [];
          const notFound: string[] = [];
          for (const entry of rawIds) {
            const id = typeof entry === 'string' ? entry.trim() : String(entry);
            const guide = promptGuides.find((g) => g.id === id);
            if (!guide) {
              notFound.push(id);
              continue;
            }
            results.push({ id: guide.id, name: guide.name, content: guide.content });
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
        }

        throw new Error('ids must be a string or array of strings');
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toolCompact: AgentTool = {
    name: 'tool.compact',
    description:
      'Compact conversation context by summarizing old tool exchanges and stripping unused tool schemas. Optionally pass "instructions" to focus the summary (e.g. "focus on the API changes"). Call proactively when context feels large or before complex multi-step operations.',
    tags: ['meta'],
    tier: 1,
    parameters: {
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
