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
      },
      required: [],
    },
    async execute(args) {
      try {
        const query = typeof args.query === 'string' ? args.query : undefined;
        return ok(
          registry.search({
            context: deps.context,
            tags: parseTags(args),
            query,
          }).map((tool) => ({
            name: tool.name,
            description: tool.description,
            tags: tool.tags ?? [],
          })),
        );
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
      properties: {},
      required: [],
    },
    async execute() {
      return ok(promptGuides.map(({ id, name }) => ({ id, name })));
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

  return [toolSearch, guideList, guideGet];
}
