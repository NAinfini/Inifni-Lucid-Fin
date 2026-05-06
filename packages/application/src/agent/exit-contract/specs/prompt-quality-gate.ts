import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';

/**
 * Prompt quality gate process prompt: fires once per run when
 * `canvas.generate` is pending. Reminds the LLM to verify and expand
 * thin prompts before committing to generation, since short or empty
 * prompts produce generic, low-quality results.
 */
export interface PromptQualityGateSpecDeps {
  resolvePromptText: (key: 'prompt-quality-gate') => string | null | undefined;
  behavior?: QualityGateBehavior;
}

export type QualityGateBehavior = 'warn-only' | 'auto-expand' | 'block-generation';

export function createPromptQualityGateSpec(deps: PromptQualityGateSpecDeps): ProcessPromptSpec {
  return {
    key: 'prompt-quality-gate',
    displayName: 'Prompt Quality Gate',
    lifecycle: 'one-shot',
    activationPredicate: (ctx) => promptQualityGatePredicate(ctx),
    content: () => {
      const base = deps.resolvePromptText('prompt-quality-gate')?.trim() ?? '';
      if (!base) return '';
      return `${base}\n\n${qualityGateBehaviorInstruction(deps.behavior ?? 'auto-expand')}`;
    },
  };
}

const MIN_PROMPT_LENGTH = 20;

export function promptQualityGatePredicate(ctx: ActivationContext): boolean {
  if (ctx.pendingToolCalls.length === 0) return false;
  return ctx.pendingToolCalls.some((tc) => {
    if (tc.name !== 'canvas.generate') return false;
    const prompt = tc.arguments?.prompt;
    if (typeof prompt !== 'string') return true;
    return prompt.trim().length < MIN_PROMPT_LENGTH;
  });
}

function qualityGateBehaviorInstruction(behavior: QualityGateBehavior): string {
  if (behavior === 'warn-only') {
    return 'Configured behavior: warn only. If the prompt is weak, warn the user clearly but do not block generation.';
  }
  if (behavior === 'block-generation') {
    return 'Configured behavior: block generation. If the prompt is weak, stop before generation and ask the user to approve or improve it.';
  }
  return 'Configured behavior: auto-expand. If the prompt is weak, expand it with node context, refs, and presets before generation.';
}
