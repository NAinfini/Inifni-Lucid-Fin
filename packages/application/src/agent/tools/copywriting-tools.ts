import type { AgentTool } from '../tool-registry.js';

export interface CopywritingToolDeps {
  callLLM: (systemPrompt: string, userText: string) => Promise<string>;
}

function ok(data?: unknown): { success: true; data?: unknown } {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): { success: false; error: string } {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function requireText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function createCopywritingTools(deps: CopywritingToolDeps): AgentTool[] {
  const expandText: AgentTool = {
    name: 'text.expandText',
    description: 'Expand and elaborate on text with more vivid, detailed descriptions. Useful for enriching AI image/video generation prompts.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to expand.' },
        targetLength: { type: 'string', description: 'Optional target length hint (e.g. "short", "medium", "long").' },
      },
      required: ['text'],
    },
    async execute(args) {
      try {
        const text = requireText(args, 'text');
        const systemPrompt =
          'Expand and elaborate on this text with more vivid, detailed descriptions. Keep the same meaning but make it more descriptive for AI image/video generation.' +
          (typeof args.targetLength === 'string' && args.targetLength.trim().length > 0
            ? ` Target length: ${args.targetLength.trim()}.`
            : '');
        const result = await deps.callLLM(systemPrompt, text);
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const condenseText: AgentTool = {
    name: 'text.condenseText',
    description: 'Condense text to its essential elements, removing redundancy and keeping only the most important visual/cinematic details.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to condense.' },
      },
      required: ['text'],
    },
    async execute(args) {
      try {
        const text = requireText(args, 'text');
        const systemPrompt =
          'Condense this text to its essential elements. Remove redundancy and keep only the most important visual/cinematic details.';
        const result = await deps.callLLM(systemPrompt, text);
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const refineText: AgentTool = {
    name: 'text.refineText',
    description: 'Refine and polish text for use as an AI generation prompt, improving clarity, specificity, and artistic quality.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to refine.' },
        style: { type: 'string', description: 'Optional style direction (e.g. "cinematic", "photorealistic", "anime").' },
      },
      required: ['text'],
    },
    async execute(args) {
      try {
        const text = requireText(args, 'text');
        const systemPrompt =
          'Refine and polish this text for use as an AI generation prompt. Improve clarity, specificity, and artistic quality.' +
          (typeof args.style === 'string' && args.style.trim().length > 0
            ? ` Apply a ${args.style.trim()} style.`
            : '');
        const result = await deps.callLLM(systemPrompt, text);
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addViralHook: AgentTool = {
    name: 'text.addViralHook',
    description: 'Add a compelling, attention-grabbing opening hook to text that would make viewers want to keep watching.',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to add a hook to.' },
      },
      required: ['text'],
    },
    async execute(args) {
      try {
        const text = requireText(args, 'text');
        const systemPrompt =
          'Add a compelling, attention-grabbing opening hook to this text that would make viewers want to keep watching.';
        const result = await deps.callLLM(systemPrompt, text);
        return ok({ result });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [expandText, condenseText, refineText, addViralHook];
}
