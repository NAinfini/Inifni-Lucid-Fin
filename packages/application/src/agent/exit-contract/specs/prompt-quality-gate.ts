import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';

/**
 * Prompt quality gate process prompt: fires once per run when
 * `canvas.generate` is pending. Reminds the LLM to verify and expand
 * thin prompts before committing to generation, since short or empty
 * prompts produce generic, low-quality results.
 */
export interface PromptQualityGateSpecDeps {
  resolvePromptText: (key: 'prompt-quality-gate') => string | null | undefined;
}

export function createPromptQualityGateSpec(deps: PromptQualityGateSpecDeps): ProcessPromptSpec {
  return {
    key: 'prompt-quality-gate',
    displayName: 'Prompt Quality Gate',
    lifecycle: 'one-shot',
    activationPredicate: (ctx) => promptQualityGatePredicate(ctx),
    content: () => deps.resolvePromptText('prompt-quality-gate')?.trim() ?? '',
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
