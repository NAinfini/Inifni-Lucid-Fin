/**
 * Phase A — Exit Contract primitives.
 *
 * These are the five typed primitives that every later phase of the
 * exit-contract architecture builds on. Phase A is additive only: nothing
 * in `agent-orchestrator.ts`, the IPC layer, or the study harness imports
 * these yet. See `.trellis/tasks/04-20-exit-contract-architecture/prd.md`
 * for the full design.
 *
 * The guiding invariant: "task satisfied" is a first-class decision driven
 * by typed evidence against a typed contract, not a side effect of the
 * LLM returning zero tool calls.
 */

// ---------------------------------------------------------------------------
// RunIntent — what kind of run is this?
// ---------------------------------------------------------------------------

/**
 * The classified intent of a run, derived from the first user message and
 * current canvas state. Determines which `CompletionContract` applies.
 *
 * - `informational`: the user asked a question; no mutation expected.
 * - `browse`: "what can you do", "list the guides" — catalogue intent.
 * - `execution`: the user wants something persisted (canvas nodes,
 *   settings write, entity records, generation). The workflow hint, when
 *   known, picks the matching contract.
 * - `mixed`: execution with meaningful Q&A first. Treated as execution
 *   for contract purposes; the classifier emits this when it cannot
 *   cleanly pick one of the others.
 */
export type RunIntent =
  | { kind: 'informational' }
  | { kind: 'browse' }
  | { kind: 'execution'; workflow?: string }
  | { kind: 'mixed'; workflow?: string };

// ---------------------------------------------------------------------------
// CompletionContract — what does "done" look like for this run?
// ---------------------------------------------------------------------------

/**
 * A single commit that would satisfy (part of) a contract. Matches a
 * successful `mutation_commit` evidence whose `toolName` equals this
 * requirement and (if present) whose args pass `argPredicate`.
 */
export interface CommitRequirement {
  toolName: string;
  /**
   * Optional predicate over the tool call's arguments. Used when the
   * tool name alone is not enough — e.g. `canvas.batchCreate` counts
   * only when `nodes.length >= 1`.
   */
  argPredicate?: (args: unknown) => boolean;
  /** Human-readable rationale for contract reports and UI banners. */
  description: string;
}

/**
 * A derived success signal that does not map 1-to-1 to a single tool
 * call — e.g. "the canvas has at least one image node with a resolved
 * reference". Evaluated against the full ledger.
 */
export interface SuccessSignal {
  id: string;
  check: (ledger: ReadonlyCompletionEvidenceList) => boolean;
  description: string;
}

export interface CompletionContract {
  /** Stable id. Used in logs, reports, and contract-registry lookups. */
  id: string;
  /**
   * At least one of these must be observed in the ledger for the run to
   * count as satisfied. Multiple requirements are an AND.
   */
  requiredCommits: CommitRequirement[];
  /**
   * Alternates that also satisfy the contract (e.g. `canvas.addNode` for
   * a small scene where `canvas.batchCreate` would be overkill). The
   * engine accepts a substitute for any required commit whose `toolName`
   * matches the substitute's `toolName`.
   */
  acceptableSubstitutes?: CommitRequirement[];
  /**
   * When true, an `informational` intent bypasses commit evaluation and
   * exits `informational_answered`. Browse contracts set this to true;
   * execution contracts set it to false.
   */
  infoIntentExemption: boolean;
  /**
   * Soft cap on askUser invocations inside this contract's lifecycle.
   * The engine uses this to detect `ask_user_loop` blockers.
   */
  blockingQuestionsAllowed: number;
  /** Optional ledger-wide checks beyond individual tool calls. */
  successSignals?: SuccessSignal[];
}

// ---------------------------------------------------------------------------
// CompletionEvidence — what happened during the run?
// ---------------------------------------------------------------------------

/**
 * Append-only evidence emitted during a run. The orchestrator records
 * one of these per instrumented site; the engine consumes them at
 * terminal. Intentionally small and closed — every new variant requires
 * explicit engine support and an exhaustive `switch` update.
 */
export type CompletionEvidence =
  | { kind: 'guide_loaded'; guideId: string; at: number }
  | { kind: 'ask_user_asked'; question: string; at: number }
  | { kind: 'ask_user_answered'; answer: string; at: number }
  | { kind: 'mutation_commit'; toolName: string; args: unknown; resultOk: boolean; at: number }
  | { kind: 'validation_error'; toolName: string; errorText: string; at: number }
  | { kind: 'process_prompt_activated'; key: string; reason: string; at: number }
  | { kind: 'generation_started'; nodeId: string; at: number }
  | { kind: 'settings_write'; canvasId: string; keys: string[]; at: number }
  | { kind: 'user_refused'; message: string; at: number }
  | { kind: 'budget_exhausted'; metric: 'steps' | 'tokens'; at: number };

/**
 * Immutable view over the evidence ledger. Consumed by `SuccessSignal.check`
 * and the exit-decision engine. Using `readonly` both at the array level
 * and on each variant prevents accidental mutation of recorded history.
 */
export type ReadonlyCompletionEvidenceList = readonly CompletionEvidence[];

// ---------------------------------------------------------------------------
// BlockerReason — why a run ended unsatisfied
// ---------------------------------------------------------------------------

/**
 * Structured explanation attached to an `unsatisfied` `ExitDecision`. The
 * UI renders this so the user can recover without re-reading the full
 * transcript, and the study harness buckets sessions by blocker kind to
 * surface systemic patterns.
 */
export type BlockerReason =
  | {
      kind: 'missing_commit';
      /** Tool names listed in the contract that never observed a matching mutation. */
      expected: string[];
      /** The last tool the LLM did call, if any — often clarifies the near-miss. */
      lastTool?: string;
    }
  | {
      kind: 'ask_user_loop';
      askCount: number;
      limit: number;
    }
  | {
      kind: 'empty_narration';
      lastAssistantText: string;
    };

// ---------------------------------------------------------------------------
// ExitDecision — the terminal verdict
// ---------------------------------------------------------------------------

/**
 * Exactly one `ExitDecision` is produced per run. Phase B emits it as a
 * stream event without changing the orchestrator's return value; Phase E
 * makes it the return value.
 */
export type ExitDecision =
  | { outcome: 'satisfied'; contractId: string; evidenceSummary: string }
  | { outcome: 'informational_answered'; reason: string }
  | { outcome: 'blocked_waiting_user'; question: string }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'budget_exhausted'; metric: 'steps' | 'tokens' }
  | { outcome: 'unsatisfied'; contractId: string; blocker: BlockerReason }
  | { outcome: 'error'; message: string };

export type ExitOutcomeKind = ExitDecision['outcome'];

// ---------------------------------------------------------------------------
// Exhaustiveness helpers
// ---------------------------------------------------------------------------

/**
 * Standard "never happened" throw for exhaustive `switch` handling of the
 * union types above. Callers using this in a `default` branch get a
 * compile-time error whenever a new variant is added without updating the
 * switch — the whole point of keeping these unions small and closed.
 */
export function assertNeverEvidence(x: never): never {
  throw new Error(`Unhandled CompletionEvidence variant: ${JSON.stringify(x)}`);
}

export function assertNeverIntent(x: never): never {
  throw new Error(`Unhandled RunIntent variant: ${JSON.stringify(x)}`);
}

export function assertNeverBlocker(x: never): never {
  throw new Error(`Unhandled BlockerReason variant: ${JSON.stringify(x)}`);
}

export function assertNeverDecision(x: never): never {
  throw new Error(`Unhandled ExitDecision variant: ${JSON.stringify(x)}`);
}
