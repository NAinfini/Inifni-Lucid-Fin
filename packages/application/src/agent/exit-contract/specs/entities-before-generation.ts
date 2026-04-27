import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';
import { isGenerationTool } from './style-plate-lock.js';

/**
 * Entities-before-generation process prompt: injects a reminder on early
 * steps to verify that referenced entities have reference images before
 * generating scene visuals. Fires within the first 5 steps when ANY
 * visual-generation tool is pending.
 *
 * The spec does not verify entity ref-image status itself (that would
 * require DB access in a pure predicate). Instead it injects guidance
 * that tells the LLM to check and generate ref images first.
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
    lifecycle: 'sticky',
    activationPredicate: (ctx) => entitiesBeforeGenerationPredicate(ctx),
    content: () => deps.resolvePromptText('entities-before-generation')?.trim() ?? '',
  };
}

export function entitiesBeforeGenerationPredicate(ctx: ActivationContext): boolean {
  // Only fire within the first 5 steps as an early-session reminder.
  if (ctx.step > 5) return false;
  if (ctx.pendingToolCalls.length === 0) return false;
  return ctx.pendingToolCalls.some((tc) => isGenerationTool(tc.name, tc.arguments));
}
