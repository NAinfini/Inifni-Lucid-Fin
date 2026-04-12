import type { AgentTool, AgentToolRegistry, ToolResult } from '../tool-registry.js';

export interface MetaToolDeps {
  promptGuides?: Array<{ id: string; name: string; content: string }>;
  context?: string;
  /** Callback to trigger mid-loop context compaction. Optional instructions guide the summary focus. */
  compactContext?: (instructions?: string) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
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

  const toolGet: AgentTool = {
    name: 'tool.get',
    description: 'If names is provided: load full schema for specific tools. If names is omitted: list ALL available tools grouped by domain.',
    tags: ['meta', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: 'Tool name.' },
          description: 'Tool name or array of tool names to load. Omit to list all tools grouped by domain.',
        },
      },
      required: [],
    },
    async execute(args) {
      try {
        const rawNames = args.names;

        // No names provided — list all tools grouped by domain
        if (rawNames === undefined || rawNames === null) {
          const allTools = deps.context
            ? registry.forContext(deps.context)
            : registry.list();

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

  const guideGet: AgentTool = {
    name: 'guide.get',
    description: 'If ids is provided: fetch prompt guide content by id. If ids is omitted: list all available guides (id and name only, with offset/limit pagination).',
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
        offset: { type: 'number', description: 'Start index for listing (0-based). Default 0. Only used when ids is omitted.' },
        limit: { type: 'number', description: 'Max items to return for listing. Default 50. Only used when ids is omitted.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const rawIds = args.ids;

        // No ids provided — list all guides
        if (rawIds === undefined || rawIds === null) {
          const guides = promptGuides.map(({ id, name }) => ({ id, name }));
          const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
          const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
          return ok({ total: guides.length, offset, limit, guides: guides.slice(offset, offset + limit) });
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

  const toolCompact: AgentTool = {
    name: 'tool.compact',
    description: 'Compact conversation context by summarizing old tool exchanges and stripping unused tool schemas. Optionally pass "instructions" to focus the summary (e.g. "focus on the API changes"). Call proactively when context feels large or before complex multi-step operations.',
    tags: ['meta'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        instructions: { type: 'string', description: 'Optional focus instructions to guide what the compaction summary should emphasize (e.g. "focus on character setup and preset changes").' },
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
        note: result.freedChars > 0
          ? `Freed ~${result.freedChars.toLocaleString()} chars of context.`
          : 'Context already compact — nothing to free.',
      });
    },
  };

  return [toolGet, toolCompact, guideGet];
}
