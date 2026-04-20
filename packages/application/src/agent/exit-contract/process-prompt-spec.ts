import type { ReadonlyCompletionEvidenceList } from './types.js';

/**
 * Process prompts are system-message fragments the orchestrator injects
 * mid-run when a condition becomes true (e.g. the model is about to fire a
 * generation tool on a canvas with an empty stylePlate). Before Phase C,
 * each prompt had a bespoke priming method on the orchestrator. Phase C
 * collapses them to a single spec list evaluated uniformly.
 *
 * Lifecycle:
 *  - `sticky`: once activated, stays activated for the rest of the run.
 *  - `one-shot`: activates once, then is filtered out on subsequent
 *    evaluations within the same run (but can re-activate in a fresh run).
 *  - `decaying`: re-evaluated every step; activates whenever its predicate
 *    is true. Reserved for future use — Phase C ships only `one-shot` and
 *    `sticky`.
 */
export type ProcessPromptLifecycle = 'sticky' | 'one-shot' | 'decaying';

/**
 * Snapshot of what the orchestrator knows at the moment of the pre-flight
 * check, fed to the spec's predicate and content builder. Pure data; no
 * callbacks, no I/O — side effects belong in the orchestrator wiring.
 */
export interface ActivationContext {
  canvasId: string | undefined;
  pendingToolCalls: ReadonlyArray<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Partial snapshot of canvas.settings that spec predicates consult. */
  canvasSettings: {
    stylePlate?: string | null;
    [k: string]: unknown;
  } | undefined;
  ledger: ReadonlyCompletionEvidenceList;
  /**
   * Step number (0-based) at which this evaluation is happening. Engines
   * that need to space activations by step count use this; ignored by the
   * default specs.
   */
  step: number;
}

export interface ProcessPromptSpec {
  /**
   * Stable key. Used for display-name lookup, dedup, and to match
   * previously-injected system messages so re-injection is idempotent.
   */
  key: string;
  displayName: string;
  lifecycle: ProcessPromptLifecycle;
  /**
   * Pure predicate. Must not throw; any throw is treated as `false` by
   * `evaluateProcessPromptSpecs` so one broken spec cannot take down the
   * full process-prompt pipeline.
   */
  activationPredicate: (ctx: ActivationContext) => boolean;
  /**
   * Builder for the system-message body. Called after the predicate
   * returns true. Should be pure and not perform I/O; typically looks up
   * a preloaded prompt string injected at construction time.
   */
  content: (ctx: ActivationContext) => string;
}

/**
 * Result of evaluating the spec list for a given context. `activated` is
 * the subset whose predicate fired and whose content is non-empty —
 * the orchestrator turns these into system messages and records
 * `process_prompt_activated` evidence per entry.
 */
export interface ProcessPromptEvaluationResult {
  activated: Array<{ spec: ProcessPromptSpec; content: string }>;
}

/**
 * Pure evaluator. Orchestrator owns persistence ("already activated this
 * run") and side effects ("push to messages, emit evidence"). This
 * function just runs the predicates in order and collects the activations
 * the caller has not yet processed.
 *
 * `alreadyActivated` is the set of keys that should be skipped — the
 * orchestrator maintains it across steps and includes one-shot keys that
 * have already fired.
 */
export function evaluateProcessPromptSpecs(
  specs: ReadonlyArray<ProcessPromptSpec>,
  ctx: ActivationContext,
  alreadyActivated: ReadonlySet<string>,
): ProcessPromptEvaluationResult {
  const activated: Array<{ spec: ProcessPromptSpec; content: string }> = [];
  for (const spec of specs) {
    if (alreadyActivated.has(spec.key)) continue;
    let ok: boolean;
    try {
      ok = spec.activationPredicate(ctx);
    } catch {
      ok = false;
    }
    if (!ok) continue;

    let body: string;
    try {
      body = spec.content(ctx);
    } catch {
      body = '';
    }
    if (!body.trim()) continue;

    activated.push({ spec, content: body });
  }
  return { activated };
}
