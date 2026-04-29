import type { AgentTool, AgentToolRegistry } from '../tool-registry.js';
import { ok, fail } from './tool-result-helpers.js';
import { ToolCatalog } from '../tool-catalog.js';
import { getProcessCategoryName, type ProcessCategory } from '../process-detection.js';

export interface MetaToolDeps {
  promptGuides?: Array<{ id: string; name: string; content: string; autoInject?: boolean }>;
  context?: string;
  /** Callback to trigger mid-loop context compaction. Optional instructions guide the summary focus. */
  compactContext?: (
    instructions?: string,
  ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
  /**
   * Resolves the effective (user-overridden or default) process prompt for
   * a given category. When provided, `tool.get` includes the matching
   * process guide inline with each tool schema it returns so the model
   * sees the guidance during schema discovery — before it commits to
   * arguments. This is the primary injection path; the orchestrator's
   * pre-flight defer acts as a backstop when the model skips discovery.
   */
  resolveProcessPrompt?: (processKey: ProcessCategory) => string | null;
}

/**
 * Looks up a tool's process category via the catalog. Returns null for:
 *   - tools not in the catalog
 *   - meta-category tools (tool.*, guide.*, commander.askUser)
 *   - canvas.generate (dynamic — process depends on runtime nodeType args,
 *     and we don't have args at schema-discovery time)
 * Kept near the call site to make it obvious which processes tool.get can
 * surface without needing user-provided arguments.
 */
function staticProcessCategoryFor(toolName: string): ProcessCategory | null {
  if (toolName === 'canvas.generate') return null;
  const byKey = ToolCatalog.byKey as Readonly<
    Record<string, { process: string; category: string }>
  >;
  const entry = byKey[toolName];
  if (!entry) return null;
  if (entry.category === 'meta') return null;
  return entry.process as ProcessCategory;
}

export function createMetaTools(registry: AgentToolRegistry, deps: MetaToolDeps): AgentTool[] {
  const promptGuides = deps.promptGuides ?? [];
  const resolveProcessPrompt = deps.resolveProcessPrompt;

  /**
   * Builds the `{ category, name, guide }` block that rides alongside a
   * tool schema in `tool.get` results. Returns undefined when the tool has
   * no static process mapping or when no resolver is wired — callers must
   * gracefully omit the field in that case so we don't emit empty noise.
   */
  const attachProcessGuide = (
    toolName: string,
  ): { processCategory: string; processCategoryName: string; processGuide: string } | undefined => {
    if (!resolveProcessPrompt) return undefined;
    const processKey = staticProcessCategoryFor(toolName);
    if (!processKey) return undefined;
    const guide = resolveProcessPrompt(processKey);
    if (!guide || !guide.trim()) return undefined;
    return {
      processCategory: processKey,
      processCategoryName: getProcessCategoryName(processKey),
      processGuide: guide.trim(),
    };
  };

  const toolGet: AgentTool = {
    name: 'tool.get',
    description: [
      'WHEN TO CALL: any time the user asks what Commander can do, what tools or features exist, a menu, a catalogue, or "how do I start". Call this BEFORE answering from memory — the MASTER INDEX in the system prompt lists names only; the full descriptions live here.',
      '',
      'Two modes:',
      '  (1) Omit "names" to list all available tools grouped by domain (name + short description only). Use this for browse/menu intent.',
      '  (2) Provide "names" array to load full parameter schemas for specific tools. Use this before you commit to calling a tool whose schema you are unsure about.',
      '',
      'When a tool has a governing process guide (e.g. character-ref-image-generation), the guide is attached inline under `processGuide` — follow it before choosing arguments.',
    ].join('\n'),
    tags: ['meta', 'read'],
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string', description: 'Tool name.' },
          description:
            'Tool name or array of tool names to load. Omit to list all tools grouped by domain.',
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
            return { success: false, error: `Tool '${name}' not found` };
          }
          const guideBlock = attachProcessGuide(tool.name);
          return ok({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            ...(guideBlock ?? {}),
          });
        }

        if (Array.isArray(rawNames)) {
          const results: Array<{
            name: string;
            description: string;
            parameters: unknown;
            processCategory?: string;
            processCategoryName?: string;
            processGuide?: string;
          }> = [];
          for (const entry of rawNames) {
            const name = typeof entry === 'string' ? entry.trim() : String(entry);
            const tool = registry.get(name);
            if (!tool) {
              return { success: false, error: `Tool '${name}' not found` };
            }
            const guideBlock = attachProcessGuide(tool.name);
            results.push({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              ...(guideBlock ?? {}),
            });
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
    description: [
      'WHEN TO CALL: any time the user asks what workflows, skills, or guides are available, asks to "see the docs", "list the guides", or any browse-the-docs intent. Call this BEFORE summarising from memory.',
      '',
      'Two modes:',
      '  If `ids` is provided: fetch prompt guide content by id (one or many).',
      '  If `ids` is omitted: list all available guides (id and name only, with offset/limit pagination). Use this for browse intent.',
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
