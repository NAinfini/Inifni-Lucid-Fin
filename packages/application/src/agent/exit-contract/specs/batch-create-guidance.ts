import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';

/**
 * Batch-create guidance process prompt: fires once per run when
 * `canvas.batchCreate` is pending with more than 5 nodes. Injects
 * structural guidance so large batches are organized by scene, use
 * backdrops, and have proper edge flow.
 */
export interface BatchCreateGuidanceSpecDeps {
  resolvePromptText: (key: 'batch-create-guidance') => string | null | undefined;
}

export function createBatchCreateGuidanceSpec(
  deps: BatchCreateGuidanceSpecDeps,
): ProcessPromptSpec {
  return {
    key: 'batch-create-guidance',
    displayName: 'Batch Create Guidance',
    lifecycle: 'one-shot',
    activationPredicate: (ctx) => batchCreateGuidancePredicate(ctx),
    content: () => deps.resolvePromptText('batch-create-guidance')?.trim() ?? '',
  };
}

export function batchCreateGuidancePredicate(ctx: ActivationContext): boolean {
  if (ctx.pendingToolCalls.length === 0) return false;
  return ctx.pendingToolCalls.some((tc) => {
    if (tc.name !== 'canvas.batchCreate') return false;
    const nodes = Array.isArray(tc.arguments?.nodes) ? tc.arguments.nodes : [];
    return nodes.length > 5;
  });
}
