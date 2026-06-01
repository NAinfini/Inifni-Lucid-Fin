import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';

/**
 * Entities-before-generation process prompt: fires once per run to remind
 * the LLM to verify that referenced entities have reference images before
 * generating scene visuals.
 *
 * v2: Evaluates purely on workspace state (canvas exists). The old
 * pendingToolCalls dependency is removed — the guide activates early so it's
 * in context before any generation tool call.
 *
 * Uses `one-shot` lifecycle so the reminder is injected exactly once and
 * never repeated.
 */
export interface EntitiesBeforeGenerationSpecDeps {
  resolvePromptText: (key: 'entities-before-generation') => string | null | undefined;
}

export function createEntitiesBeforeGenerationSpec(
  deps: EntitiesBeforeGenerationSpecDeps,
): ProcessPromptSpec {
  return {
    key: 'entities-before-generation',
    displayName: 'Entities Before Generation',
    lifecycle: 'one-shot',
    activationPredicate: (ctx) => entitiesBeforeGenerationPredicate(ctx),
    content: () => deps.resolvePromptText('entities-before-generation')?.trim() ?? '',
  };
}

export function entitiesBeforeGenerationPredicate(ctx: ActivationContext): boolean {
  return !!ctx.canvasId;
}
