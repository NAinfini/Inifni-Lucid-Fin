import type { AgentTool, ToolResult } from '../tool-registry.js';

export interface PromptListEntry {
  code: string;
  name: string;
  type: string;
  hasCustom: boolean;
}

export interface PromptDetail {
  code: string;
  name: string;
  defaultValue: string;
  customValue: string | null;
}

export interface PromptToolDeps {
  listPrompts: () => Promise<PromptListEntry[]>;
  getPrompt: (code: string) => Promise<PromptDetail | null>;
  setCustomPrompt: (code: string, value: string) => Promise<void>;
  clearCustomPrompt: (code: string) => Promise<void>;
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

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function createPromptTools(deps: PromptToolDeps): AgentTool[] {
  const list: AgentTool = {
    name: 'prompt.list',
    description: 'List AI prompt templates available in the application.',
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    async execute() {
      try {
        return ok(await deps.listPrompts());
      } catch (error) {
        return fail(error);
      }
    },
  };

  const get: AgentTool = {
    name: 'prompt.get',
    description: 'Get a prompt template by code.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Prompt template code.' },
      },
      required: ['code'],
    },
    async execute(args) {
      try {
        const code = requireString(args, 'code');
        const prompt = await deps.getPrompt(code);
        if (!prompt) {
          throw new Error(`Prompt not found: ${code}`);
        }
        return ok(prompt);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setCustom: AgentTool = {
    name: 'prompt.setCustom',
    description: 'Set a custom override value for a prompt template.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Prompt template code.' },
        value: { type: 'string', description: 'Custom prompt value.' },
      },
      required: ['code', 'value'],
    },
    async execute(args) {
      try {
        const code = requireString(args, 'code');
        const value = requireString(args, 'value');
        await deps.setCustomPrompt(code, value);
        return ok({ code });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const clearCustom: AgentTool = {
    name: 'prompt.clearCustom',
    description: 'Clear a custom prompt override and fall back to the default value.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Prompt template code.' },
      },
      required: ['code'],
    },
    async execute(args) {
      try {
        const code = requireString(args, 'code');
        await deps.clearCustomPrompt(code);
        return ok({ code });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [list, get, setCustom, clearCustom];
}
