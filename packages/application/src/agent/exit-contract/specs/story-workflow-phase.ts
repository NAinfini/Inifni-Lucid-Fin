import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';

/**
 * Story workflow phase process prompt: fires when the orchestrator is
 * already in a `workflow-orchestration` process (detected via ledger
 * evidence of `process_prompt_activated` with key `workflow-orchestration`).
 * Injects phase-gate guidance so the LLM follows the story-to-video
 * pipeline strictly — no skipping ref-image generation, no generating
 * scene images before character refs are complete, and pausing at each
 * phase boundary for user confirmation.
 */
export interface StoryWorkflowPhaseSpecDeps {
  resolvePromptText: (key: 'story-workflow-phase') => string | null | undefined;
}

export function createStoryWorkflowPhaseSpec(
  deps: StoryWorkflowPhaseSpecDeps,
): ProcessPromptSpec {
  return {
    key: 'story-workflow-phase',
    displayName: 'Story Workflow Phase',
    lifecycle: 'sticky',
    activationPredicate: (ctx) => storyWorkflowPhasePredicate(ctx),
    content: () => deps.resolvePromptText('story-workflow-phase')?.trim() ?? '',
  };
}

export function storyWorkflowPhasePredicate(ctx: ActivationContext): boolean {
  // Fire when the workflow-orchestration process prompt has already been
  // activated in this run (visible via ledger evidence).
  return ctx.ledger.some(
    (e) =>
      e.kind === 'process_prompt_activated' &&
      e.key === 'workflow-orchestration',
  );
}
