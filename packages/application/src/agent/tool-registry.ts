import type { LLMToolDefinition, LLMToolParameter } from '@lucid-fin/contracts';

export type ToolErrorClass = 'transient' | 'not_found' | 'validation' | 'permission' | 'fatal';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /**
   * Typed error class. When a tool knows why it failed (e.g. a `requireString`
   * helper hit a missing arg → validation; a CAS lookup missed → not_found),
   * set this so the executor doesn't have to keyword-sniff `error`. The
   * executor's fallback handles legacy tools that only set `error`.
   */
  errorClass?: ToolErrorClass;
}

export interface AgentTool {
  name: string;
  description: string;
  tags?: string[];
  /** If set, tool is only available when Commander is on one of these pages */
  context?: string[];
  /**
   * Permission tier — required. Drives the needsConfirmation matrix in
   * ToolExecutor (see tool-executor.ts). Every tool MUST declare a tier
   * so a forgotten annotation cannot silently fall into tier-1 (the
   * most permissive bucket), which was the old default.
   *
   * - 1: safe/read (list/get/inspect)
   * - 2: single-entity mutation (rename, reposition)
   * - 3: batch/destructive mutation (delete, generate)
   * - 4: expensive/irreversible project-scope action (render, canvas delete)
   */
  tier: 1 | 2 | 3 | 4;
  /** Max characters for this tool's result before truncation. Overrides RESULT_HARD_LIMIT. */
  maxResultChars?: number;
  parameters: {
    type: 'object';
    properties: Record<
      string,
      {
        type: 'string' | 'number' | 'boolean' | 'object' | 'array';
        description: string;
        enum?: string[];
        properties?: Record<string, LLMToolParameter>;
        items?: LLMToolParameter;
      }
    >;
    required?: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export class AgentToolRegistry {
  private tools = new Map<string, AgentTool>();

  /**
   * Register a tool. Validates that tier is declared — a TS-escape hatch
   * like `as AgentTool` could still slip an undefined tier through, so
   * the runtime check is a belt-and-suspenders guard against future
   * regressions.
   */
  register(tool: AgentTool): void {
    if (tool.tier !== 1 && tool.tier !== 2 && tool.tier !== 3 && tool.tier !== 4) {
      throw new Error(
        `Tool '${tool.name}' is missing a valid tier (must be 1|2|3|4). ` +
          'Every tool must declare its permission tier so the confirmation ' +
          'gate never silently falls back to the most permissive bucket.',
      );
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return Array.from(this.tools.values());
  }

  /** Return tools available for a given context page */
  forContext(context: string): AgentTool[] {
    return this.list().filter((t) => !t.context || t.context.includes(context));
  }

  search(filters?: { context?: string; tags?: string[]; query?: string }): AgentTool[] {
    const tools = filters?.context ? this.forContext(filters.context) : this.list();
    const requestedTags = (filters?.tags ?? [])
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0);
    const query = filters?.query?.trim().toLowerCase() ?? '';

    return tools.filter((tool) => {
      if (
        requestedTags.length > 0 &&
        !requestedTags.every((tag) => tool.tags?.some((toolTag) => toolTag.toLowerCase() === tag))
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      const text = `${tool.name}\n${tool.description}`.toLowerCase();
      const words = query.split(/\s+/).filter(Boolean);
      return words.every((word) => text.includes(word));
    });
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(args);
  }

  /** Convert registered tools to LLM-compatible tool definitions */
  toLLMTools(context?: string): LLMToolDefinition[] {
    const tools = context ? this.forContext(context) : this.list();
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
