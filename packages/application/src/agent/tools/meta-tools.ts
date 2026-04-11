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

export function createMetaTools(registry: AgentToolRegistry, deps: MetaToolDeps): AgentTool[] {
  const promptGuides = deps.promptGuides ?? [];

  const toolList: AgentTool = {
    name: 'tool.list',
    description: 'Discover available tools grouped by domain. Use optional query to filter by name or description substring.',
    tags: ['meta', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search text matched against tool names and descriptions (case-insensitive substring).',
        },
      },
      required: [],
    },
    async execute(args) {
      const allTools = deps.context
        ? registry.forContext(deps.context)
        : registry.list();

      const query = typeof args.query === 'string' && args.query.length > 0
        ? args.query.toLowerCase()
        : undefined;

      const filtered = query
        ? allTools.filter(
            (tool) =>
              tool.name.toLowerCase().includes(query) ||
              tool.description.toLowerCase().includes(query),
          )
        : allTools;

      const grouped: Record<string, Array<{ name: string; desc: string }>> = {};
      for (const tool of filtered) {
        const domain = tool.name.includes('.') ? tool.name.split('.')[0] : tool.name;
        if (!grouped[domain]) {
          grouped[domain] = [];
        }
        const rawDesc = tool.description ?? '';
        const desc = rawDesc.length > 80 ? rawDesc.slice(0, 80) + '...' : rawDesc;
        grouped[domain].push({ name: tool.name, desc });
      }

      return ok(grouped);
    },
  };

  const toolGet: AgentTool = {
    name: 'tool.get',
    description: 'Load the full schema (description and parameters) for one or more tools by name.',
    tags: ['meta', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: 'Tool name.' },
          description: 'Tool name or array of tool names to load.',
        },
      },
      required: ['names'],
    },
    async execute(args) {
      try {
        const rawNames = args.names;
        if (typeof rawNames === 'string') {
          const name = rawNames.trim();
          const tool = registry.get(name);
          if (!tool) {
            return { success: false, error: `Tool '${name}' not found` };
          }
          return ok({ name: tool.name, description: tool.description, parameters: tool.parameters });
        }

        if (Array.isArray(rawNames)) {
          const results: Array<{ name: string; description: string; parameters: unknown }> = [];
          for (const entry of rawNames) {
            const name = typeof entry === 'string' ? entry.trim() : String(entry);
            const tool = registry.get(name);
            if (!tool) {
              return { success: false, error: `Tool '${name}' not found` };
            }
            results.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
          }
          return ok(results);
        }

        return { success: false, error: 'names must be a string or array of strings' };
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
    description: 'Fetch prompt guide content by id. Accepts a single id or array of ids.',
    tags: ['meta', 'guide', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string', description: 'Guide id.' },
          description: 'Guide id or array of guide ids to fetch.',
        },
      },
      required: ['ids'],
    },
    async execute(args) {
      try {
        const rawIds = args.ids;
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
          for (const entry of rawIds) {
            const id = typeof entry === 'string' ? entry.trim() : String(entry);
            const guide = promptGuides.find((g) => g.id === id);
            if (!guide) {
              throw new Error(`Guide not found: ${id}`);
            }
            results.push({ id: guide.id, name: guide.name, content: guide.content });
          }
          return ok(results);
        }

        throw new Error('ids must be a string or array of strings');
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [toolList, toolGet, guideList, guideGet];
}
