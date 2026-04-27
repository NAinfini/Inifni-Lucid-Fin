/**
 * Commander unified timeline event — Phase A.
 *
 * Replaces the three parallel Redux message streams with a single
 * `TimelineEvent` union sorted by `(runId, seq)`. Renderer iterates
 * once; persistence stores events not message rollups; history renders
 * as per-run collapsible cards (Phase D).
 *
 * ## Invariant freeze (Codex review 2026-04-20)
 *
 * - **Status is derived, never stored.** `ToolCallEvent` has NO `status`
 *   field. The matching `ToolResultEvent` signals completion; its
 *   `error?`/`skipped?` flags signal the terminal flavor. UI computes
 *   display status from (tool_call seen × tool_result seen).
 * - **`seq` is the single primary ordering key.** Monotonic per-run.
 *   `step` is semantic only (model-step-index, used for dedup
 *   windowing). `emittedAt` is debug/display only.
 * - **Synthetic events** (Phase F orphan cleanup, Phase G dedup) carry
 *   `synthetic: true` on `ToolResultEvent`, indistinguishable in shape
 *   from real executions. They still consume real `seq` numbers from
 *   the run counter.
 */

import type { CommanderError } from './error-code.js';
import type { ToolRef } from './tool-ref.js';

/**
 * `PhaseNoteCode` — discriminated set of phase-level status codes the
 * orchestrator emits. All free-text context moves into `params`. CI
 * drift lint enforces every code has an i18n key in every locale
 * (Phase H).
 */
export type PhaseNoteCode =
  | 'llm_retry'
  | 'tool_skipped_dedup'
  | 'compacted'
  | 'prompt_loaded'
  | 'max_steps_warning'
  | 'force_ask_user'
  | 'intent_reclassified';

export const PHASE_NOTE_CODES = [
  'llm_retry',
  'tool_skipped_dedup',
  'compacted',
  'prompt_loaded',
  'max_steps_warning',
  'force_ask_user',
  'intent_reclassified',
] as const satisfies readonly PhaseNoteCode[];

// Drift guard — matches the error-code pattern.
type _PhaseNoteDrift = Exclude<PhaseNoteCode, (typeof PHASE_NOTE_CODES)[number]>;
const _pd: _PhaseNoteDrift extends never ? true : false = true;
void _pd;

/**
 * Minimal exit-decision payload shape carried on `RunEndEvent`. Exit
 * contract lives in its own parallel initiative; we import only the
 * primitives needed to round-trip the decision without creating a
 * cross-cutting dep here. Extend when exit-contract Phase F1 lands.
 */
export interface TimelineExitDecisionMeta {
  outcome: string;
  contractId?: string;
  blocker?: string;
}

interface EventBase {
  runId: string;
  step: number;
  seq: number;
  emittedAt: number;
}

export interface RunStartEvent extends EventBase {
  kind: 'run_start';
  intent: string;
}

export interface RunEndEvent extends EventBase {
  kind: 'run_end';
  status: 'completed' | 'failed' | 'cancelled' | 'max_steps';
  exitDecision?: TimelineExitDecisionMeta;
}

export interface UserMessageEvent extends EventBase {
  kind: 'user_message';
  content: string;
}

export interface AssistantTextEvent extends EventBase {
  kind: 'assistant_text';
  content: string;
  isDelta: boolean;
}

export interface ThinkingEvent extends EventBase {
  kind: 'thinking';
  content: string;
  isDelta: boolean;
}

export interface ToolCallEvent extends EventBase {
  kind: 'tool_call';
  toolCallId: string;
  toolRef: ToolRef;
  args: Record<string, unknown>;
}

export interface ToolResultEvent extends EventBase {
  kind: 'tool_result';
  toolCallId: string;
  result?: unknown;
  error?: CommanderError;
  durationMs: number;
  /** Set only by dedup short-circuit (Phase G). */
  skipped?: true;
  /** Set by orphan-cleanup (Phase F) or dedup (Phase G). */
  synthetic?: true;
}

export interface ToolConfirmPromptEvent extends EventBase {
  kind: 'tool_confirm_prompt';
  toolCallId: string;
  toolRef: ToolRef;
  tier: number;
  args: Record<string, unknown>;
}

export interface UserConfirmationEvent extends EventBase {
  kind: 'user_confirmation';
  toolCallId: string;
  approved: boolean;
}

export interface QuestionPromptEvent extends EventBase {
  kind: 'question_prompt';
  questionId: string;
  prompt: string;
  options?: { id: string; label: string }[];
  allowFreeText: boolean;
}

export interface UserAnswerEvent extends EventBase {
  kind: 'user_answer';
  questionId: string;
  answer: string;
  selectedOptionId?: string;
}

export interface PhaseNoteEvent extends EventBase {
  kind: 'phase_note';
  note: PhaseNoteCode;
  params: Record<string, string | number | boolean | null>;
}

export interface CancelledEvent extends EventBase {
  kind: 'cancelled';
  reason: 'user' | 'timeout' | 'error';
  completedToolCalls: number;
  pendingToolCalls: number;
  partialContent?: string;
}

export type TimelineEvent =
  | RunStartEvent
  | RunEndEvent
  | UserMessageEvent
  | AssistantTextEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolConfirmPromptEvent
  | UserConfirmationEvent
  | QuestionPromptEvent
  | UserAnswerEvent
  | PhaseNoteEvent
  | CancelledEvent;

export type TimelineEventKind = TimelineEvent['kind'];

/**
 * Exhaustiveness test — any new kind forces an update here. Keep this
 * in sync with the union above; the compile-time `assertNever` below
 * enforces full coverage.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled timeline event kind: ${String(x)}`);
}

/** @internal */
export function _exhaustiveTimelineKinds(e: TimelineEvent): TimelineEventKind {
  switch (e.kind) {
    case 'run_start':
    case 'run_end':
    case 'user_message':
    case 'assistant_text':
    case 'thinking':
    case 'tool_call':
    case 'tool_result':
    case 'tool_confirm_prompt':
    case 'user_confirmation':
    case 'question_prompt':
    case 'user_answer':
    case 'phase_note':
    case 'cancelled':
      return e.kind;
    default:
      return assertNever(e);
  }
}
