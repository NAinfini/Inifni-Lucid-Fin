import type { LLMToolDefinition, LLMToolParameter } from '@lucid-fin/contracts';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  /** If set, tool is only available when Commander is on one of these pages */
  context?: string[];
  /** Permission tier: 1=safe/read, 2=single-entity mutation, 3=batch/destructive, 4=system */
  tier?: 1 | 2 | 3 | 4;
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

  register(tool: AgentTool): void {
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
