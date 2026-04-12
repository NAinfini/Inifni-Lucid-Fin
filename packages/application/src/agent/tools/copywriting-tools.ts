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

const MODES: Record<string, string> = {
  expand: 'Expand and elaborate on this text with more vivid, detailed descriptions. Keep the same meaning but make it more descriptive for AI image/video generation.',
  condense: 'Condense this text to its essential elements. Remove redundancy and keep only the most important visual/cinematic details.',
  refine: 'Refine and polish this text for use as an AI generation prompt. Improve clarity, specificity, and artistic quality.',
  viralHook: 'Add a compelling, attention-grabbing opening hook to this text that would make viewers want to keep watching.',
};

export function createCopywritingTools(deps: CopywritingToolDeps): AgentTool[] {
  const transform: AgentTool = {
    name: 'text.transform',
    description: 'Transform text using AI: expand (add detail), condense (remove redundancy), refine (polish for AI prompts), or viralHook (add attention-grabbing opener).',
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to transform.' },
        mode: { type: 'string', description: 'Transformation mode.', enum: ['expand', 'condense', 'refine', 'viralHook'] },
        style: { type: 'string', description: 'Optional style direction for refine mode (e.g. "cinematic", "photorealistic", "anime").' },
        targetLength: { type: 'string', description: 'Optional target length hint for expand mode (e.g. "short", "medium", "long").' },
      },
      required: ['text', 'mode'],
    },
    async execute(args) {
      try {
        const text = requireText(args, 'text');
        const mode = args.mode as string;
        const basePrompt = MODES[mode];
        if (!basePrompt) {
          throw new Error(`Unknown mode: ${mode}. Must be expand, condense, refine, or viralHook.`);
        }
        let systemPrompt = basePrompt;
        if (mode === 'expand' && typeof args.targetLength === 'string' && args.targetLength.trim().length > 0) {
          systemPrompt += ` Target length: ${args.targetLength.trim()}.`;
        }
        if (mode === 'refine' && typeof args.style === 'string' && args.style.trim().length > 0) {
          systemPrompt += ` Apply a ${args.style.trim()} style.`;
        }
        const result = await deps.callLLM(systemPrompt, text);
        return ok({ result, mode });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [transform];
}
