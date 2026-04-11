import type { AgentTool, AgentToolRegistry, ToolResult } from '../tool-registry.js';

export interface MetaToolDeps {
  promptGuides?: Array<{ id: string; name: string; content: string }>;
  context?: string;
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

function parseTags(args: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(args.tags)) {
    return undefined;
  }

  const tags = args.tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  return tags.length > 0 ? tags : undefined;
}

export function createMetaTools(registry: AgentToolRegistry, deps: MetaToolDeps): AgentTool[] {
  const promptGuides = deps.promptGuides ?? [];

  const toolSearch: AgentTool = {
    name: 'tool.search',
    description: 'Search available tools by tag or name/description substring.',
    tags: ['meta', 'read', 'search'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          description: 'Optional tags to match.',
          items: { type: 'string', description: 'Tool tag.' },
        },
        query: {
          type: 'string',
          description: 'Optional search text matched against tool names and descriptions.',
        },
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const query = typeof args.query === 'string' ? args.query : undefined;
        const tools = registry.search({
          context: deps.context,
          tags: parseTags(args),
          query,
        }).map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          tags: tool.tags ?? [],
        }));
        const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
        return ok({ total: tools.length, offset, limit, tools: tools.slice(offset, offset + limit) });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const guideList: AgentTool = {
    name: 'guide.list',
    description: 'List available prompt guides without loading their contents.',
    tags: ['meta', 'guide', 'read', 'search'],
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
      const guides = promptGuides.map(({ id, name }) => ({ id, name }));
      const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
      return ok({ total: guides.length, offset, limit, guides: guides.slice(offset, offset + limit) });
    },
  };

  const guideGet: AgentTool = {
    name: 'guide.get',
    description: 'Fetch the full content of a single prompt guide by id.',
    tags: ['meta', 'guide', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Prompt guide id.' },
      },
      required: ['id'],
    },
    async execute(args) {
      try {
        const id = typeof args.id === 'string' ? args.id.trim() : '';
        if (!id) {
          throw new Error('id is required');
        }
        const guide = promptGuides.find((entry) => entry.id === id);
        if (!guide) {
          throw new Error(`Guide not found: ${id}`);
        }
        return ok(guide);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toolList: AgentTool = {
    name: 'tool.list',
    description: 'List ALL available tools with their names and descriptions. Use this to see the full tool catalog before searching for specific tools.',
    tags: ['meta', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'number', description: 'Start index (0-based). Default 0.' },
        limit: { type: 'number', description: 'Max items to return. Default 50.' },
      },
    },
    async execute(args) {
      const allTools = deps.context
        ? registry.forContext(deps.context)
        : registry.list();
      const mapped = allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      }));
      const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
      return ok({ total: mapped.length, offset, limit, tools: mapped.slice(offset, offset + limit) });
    },
  };

  return [toolSearch, toolList, guideList, guideGet];
}
