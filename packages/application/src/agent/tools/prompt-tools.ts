import type { AgentTool } from '../tool-registry.js';
import { ok, fail, requireString } from './tool-result-helpers.js';

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

export function createPromptTools(deps: PromptToolDeps): AgentTool[] {
  const get: AgentTool = {
    name: 'prompt.get',
    description: 'Get prompt templates. If ids is provided, fetch specific prompt(s) by code. If ids is omitted, return a paginated list of all prompts.',
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string', description: 'Prompt ID.' }, description: 'Prompt ID or array of prompt IDs to fetch. Omit to list all prompts.' },
        offset: { type: 'number', description: 'Start index (0-based). Default 0. Used when ids is omitted.' },
        limit: { type: 'number', description: 'Max items to return. Default 50. Used when ids is omitted.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const rawIds = args.ids;
        if (rawIds === undefined || rawIds === null || (Array.isArray(rawIds) && rawIds.length === 0)) {
          const prompts = await deps.listPrompts();
          const offset = typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
          const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
          return ok({ total: prompts.length, offset, limit, prompts: prompts.slice(offset, offset + limit) });
        }
        if (typeof rawIds === 'string') {
          const id = rawIds.trim();
          const prompt = await deps.getPrompt(id);
          if (!prompt) {
            throw new Error(`Prompt not found: ${id}`);
          }
          return ok(prompt);
        }
        if (Array.isArray(rawIds)) {
          const results = [];
          for (const entry of rawIds) {
            const id = typeof entry === 'string' ? entry.trim() : String(entry);
            const prompt = await deps.getPrompt(id);
            if (!prompt) {
              return fail(new Error(`Prompt not found: ${id}`));
            }
            results.push(prompt);
          }
          return ok(results);
        }
        return fail('ids must be a string or array of strings');
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setCustom: AgentTool = {
    name: 'prompt.setCustom',
    description: 'Set or clear a custom override for a prompt template. If value is provided, set the custom override. If value is omitted or null, clear the override and restore the default.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Prompt template code.' },
        value: { type: 'string', description: 'Custom prompt value. Omit or set null to clear the override.' },
      },
      required: ['code'],
    },
    async execute(args) {
      try {
        const code = requireString(args, 'code');
        const exists = await deps.getPrompt(code);
        if (!exists) {
          return fail(new Error(`Prompt not found: ${code}`));
        }
        if (args.value === undefined || args.value === null) {
          await deps.clearCustomPrompt(code);
          return ok({ code });
        }
        const value = requireString(args, 'value');
        await deps.setCustomPrompt(code, value);
        return ok({ code });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [get, setCustom];
}
