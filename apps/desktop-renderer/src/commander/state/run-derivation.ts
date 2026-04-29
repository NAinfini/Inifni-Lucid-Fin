/**
 * `commander/state/run-derivation.ts` — Batch 2 (Commander legacy reducer removal).
 *
 * Pure helpers that fold a `TimelineEvent[]` into either:
 *   - an active-run view (segments, toolCalls, streamContent, pending prompts)
 *     used by `selectCommanderView` for the currently open run.
 *   - a finalized `CommanderMessage` for a terminated run — dispatched onto
 *     `state.commander.messages` by the service on `run_end`.
 *
 * Consolidates the previously-split logic between
 * `commander-timeline-selectors.ts::deriveRun` and
 * `run-summary.ts::finalizeCurrentRunMessage`. The slice no longer builds
 * finalized messages by walking transient state; the service calls these
 * helpers on terminal events.
 */

import type { TimelineEvent, ToolCallEvent, ToolResultEvent } from '@lucid-fin/contracts';

import { createMessageId, createSegmentId } from './helpers.js';
import { buildRunSummary } from './run-summary.js';
import type {
  CommanderExitDecisionMeta,
  CommanderMessage,
  CommanderRunMeta,
  CommanderRunStatus,
  CommanderToolCall,
  MessageSegment,
  PendingConfirmation,
  PendingQuestion,
  PhaseNoteKind,
} from './types.js';

export type TerminalKind = 'completed' | 'failed' | 'cancelled' | 'max_steps';

export interface ActiveRunView {
  segments: MessageSegment[];
  toolCalls: CommanderToolCall[];
  streamContent: string;
  startedAt: number;
  pendingConfirmation: PendingConfirmation | null;
  pendingQuestion: PendingQuestion | null;
  errorText: string | undefined;
}

function canonicalToolName(e: ToolCallEvent): string {
  return e.toolRef.domain + '.' + e.toolRef.action;
}

function toolCallFromEvents(
  call: ToolCallEvent,
  result: ToolResultEvent | undefined,
): CommanderToolCall {
  const status: CommanderToolCall['status'] = !result ? 'pending' : result.error ? 'error' : 'done';
  return {
    name: canonicalToolName(call),
    id: call.toolCallId,
    arguments: call.args,
    startedAt: call.emittedAt,
    completedAt: result?.emittedAt,
    result: result?.error ? result.error : result?.result,
    status,
  };
}

function phaseNoteToLegacy(note: string): PhaseNoteKind {
  if (note === 'prompt_loaded') return 'process_prompt_loaded';
  if (note === 'compacted') return 'compacted';
  if (note === 'llm_retry') return 'llm_retry';
  return 'compacted';
}

/**
 * D3 mapping — `TimelineEvent.run_end.status` (4-valued) → slice
 * `CommanderRunStatus` (2-valued) plus human-readable errorText when the
 * backend didn't already attach an `exitDecision`.
 */
export function mapTerminalKindToStatus(
  kind: TerminalKind,
  partialContent?: string,
): { status: CommanderRunStatus; errorText?: string } {
  switch (kind) {
    case 'completed':
      return { status: 'completed' };
    case 'failed':
      return { status: 'failed' };
    case 'cancelled':
      return {
        status: 'failed',
        errorText: partialContent ?? 'Run cancelled',
      };
    case 'max_steps':
      return { status: 'failed', errorText: 'Reached max steps' };
  }
}

interface Folded {
  segments: MessageSegment[];
  toolCalls: CommanderToolCall[];
  streamContent: string;
  startedAt: number;
  pendingConfirmation: PendingConfirmation | null;
  pendingQuestion: PendingQuestion | null;
  exitDecision: CommanderExitDecisionMeta | undefined;
  cancelledPartialContent: string | undefined;
}

function foldEvents(
  events: readonly TimelineEvent[],
  localConfirmations: readonly string[],
  localQuestions: readonly string[],
): Folded {
  const segments: MessageSegment[] = [];
  const toolCallById = new Map<string, CommanderToolCall>();
  const segIndexByToolCallId = new Map<string, number>();
  let streamContent = '';
  let startedAt = 0;
  let pendingConfirmation: PendingConfirmation | null = null;
  let pendingQuestion: PendingQuestion | null = null;
  let exitDecision: CommanderExitDecisionMeta | undefined;
  let cancelledPartialContent: string | undefined;
  let lastStep = -1;

  const pushStepMarkerIfNeeded = (step: number, at: number): void => {
    if (step === lastStep) return;
    segments.push({
      kind: 'step_marker',
      id: 'step-' + step + '-' + at,
      step,
      at,
    });
    lastStep = step;
  };

  for (const e of events) {
    switch (e.kind) {
      case 'run_start':
        startedAt = e.emittedAt;
        break;
      case 'assistant_text': {
        pushStepMarkerIfNeeded(e.step, e.emittedAt);
        streamContent += e.content;
        const last = segments[segments.length - 1];
        if (last && last.kind === 'text') {
          last.content += e.content;
        } else {
          segments.push({
            kind: 'text',
            id: 'text-' + e.runId + '-' + e.seq,
            content: e.content,
          });
        }
        break;
      }
      case 'thinking': {
        pushStepMarkerIfNeeded(e.step, e.emittedAt);
        const last = segments[segments.length - 1];
        if (last && last.kind === 'thinking') {
          last.content += e.content;
        } else {
          segments.push({
            kind: 'thinking',
            id: 'thinking-' + e.runId + '-' + e.seq,
            content: e.content,
            collapsed: false,
          });
        }
        break;
      }
      case 'tool_call': {
        pushStepMarkerIfNeeded(e.step, e.emittedAt);
        const existing = toolCallById.get(e.toolCallId);
        if (existing) {
          existing.arguments = { ...existing.arguments, ...e.args };
          const idx = segIndexByToolCallId.get(e.toolCallId);
          if (idx !== undefined) {
            const seg = segments[idx];
            if (seg && seg.kind === 'tool') seg.toolCall = existing;
          }
        } else {
          const tc = toolCallFromEvents(e, undefined);
          toolCallById.set(e.toolCallId, tc);
          segments.push({
            kind: 'tool',
            id: 'tool-' + e.runId + '-' + e.toolCallId,
            toolCall: tc,
          });
          segIndexByToolCallId.set(e.toolCallId, segments.length - 1);
        }
        break;
      }
      case 'tool_result': {
        const tc = toolCallById.get(e.toolCallId);
        if (tc) {
          tc.status = e.error ? 'error' : 'done';
          tc.completedAt = e.emittedAt;
          tc.result = e.error ? e.error : e.result;
          const idx = segIndexByToolCallId.get(e.toolCallId);
          if (idx !== undefined) {
            const seg = segments[idx];
            if (seg && seg.kind === 'tool') seg.toolCall = { ...tc };
          }
        }
        break;
      }
      case 'tool_confirm_prompt':
        if (!localConfirmations.includes(e.toolCallId)) {
          pendingConfirmation = {
            toolCallId: e.toolCallId,
            toolName: e.toolRef.domain + '.' + e.toolRef.action,
            args: e.args,
            tier: e.tier,
          };
        }
        break;
      case 'user_confirmation':
        if (pendingConfirmation && pendingConfirmation.toolCallId === e.toolCallId) {
          pendingConfirmation = null;
        }
        break;
      case 'question_prompt':
        if (!localQuestions.includes(e.questionId)) {
          pendingQuestion = {
            toolCallId: e.questionId,
            question: e.prompt,
            options: (e.options ?? []).map((o) => ({ label: o.label })),
          };
        }
        break;
      case 'user_answer':
        if (pendingQuestion && pendingQuestion.toolCallId === e.questionId) {
          pendingQuestion = null;
        }
        break;
      case 'phase_note': {
        const note = phaseNoteToLegacy(e.note);
        const detail =
          typeof e.params?.detail === 'string' ? e.params.detail : JSON.stringify(e.params ?? {});
        segments.push({
          kind: 'phase_note',
          id: 'note-' + e.runId + '-' + e.seq,
          note,
          detail,
        });
        break;
      }
      case 'run_end':
        if (e.exitDecision) {
          exitDecision = {
            outcome: e.exitDecision.outcome as CommanderExitDecisionMeta['outcome'],
            contractId: e.exitDecision.contractId,
            blockerKind: e.exitDecision.blocker,
          };
        }
        break;
      case 'cancelled':
        if (e.partialContent) cancelledPartialContent = e.partialContent;
        break;
      default:
        break;
    }
  }

  return {
    segments,
    toolCalls: Array.from(toolCallById.values()),
    streamContent,
    startedAt,
    pendingConfirmation,
    pendingQuestion,
    exitDecision,
    cancelledPartialContent,
  };
}

/**
 * D7 — derive the live view of the currently active run for the selector.
 * Finalized messages for this run are NOT emitted here; the slice owns them.
 */
export function deriveActiveRunView(
  events: readonly TimelineEvent[],
  localConfirmations: readonly string[],
  localQuestions: readonly string[],
): ActiveRunView {
  const folded = foldEvents(events, localConfirmations, localQuestions);
  return {
    segments: folded.segments,
    toolCalls: folded.toolCalls,
    streamContent: folded.streamContent,
    startedAt: folded.startedAt,
    pendingConfirmation: folded.pendingConfirmation,
    pendingQuestion: folded.pendingQuestion,
    errorText: undefined,
  };
}

/**
 * D6 — build a finalized `CommanderMessage` from the terminal state of a run.
 * Returns `null` when the run produced nothing worth persisting (no content,
 * no tools, no segments, no error text).
 *
 * The message id is deterministic — `'assistant-run-' + runId` — so the
 * upsert reducer can find and replace a prior local-cancel message when a
 * late backend `run_end` lands later.
 */
export function buildFinalizedAssistantMessage(
  runId: string,
  terminalKind: TerminalKind,
  events: readonly TimelineEvent[],
  localConfirmations: readonly string[],
  localQuestions: readonly string[],
): CommanderMessage | null {
  const folded = foldEvents(events, localConfirmations, localQuestions);
  const { status, errorText: defaultErrorText } = mapTerminalKindToStatus(
    terminalKind,
    folded.cancelledPartialContent,
  );

  const hasContent = !!folded.streamContent;
  const hasSegments = folded.segments.length > 0;
  const hasTools = folded.toolCalls.length > 0;
  const errorText = status === 'failed' ? defaultErrorText : undefined;

  if (!hasContent && !hasSegments && !hasTools && !errorText) {
    return null;
  }

  const endOfRunEvent = [...events]
    .reverse()
    .find((e) => e.kind === 'run_end' || e.kind === 'cancelled');
  const completedAt = endOfRunEvent?.emittedAt ?? Date.now();
  const startedAt = folded.startedAt || completedAt;

  // Phase D/F — if this run terminated via a `cancelled` event, surface
  // the reason + partial content + tool counts to the renderer. Counts
  // mirror `selectRunToolStats`: a tool with a real `tool_result` is
  // completed; one with a synthetic orphan-cleanup result or no result
  // at all is pending.
  const cancelledEvent = events.find((e) => e.kind === 'cancelled');
  let cancelledMeta: CommanderRunMeta['cancelled'] | undefined;
  if (cancelledEvent && cancelledEvent.kind === 'cancelled') {
    const realResultIds = new Set<string>();
    const syntheticResultIds = new Set<string>();
    const callIds = new Set<string>();
    for (const ev of events) {
      if (ev.kind === 'tool_call') callIds.add(ev.toolCallId);
      else if (ev.kind === 'tool_result') {
        if (ev.synthetic) syntheticResultIds.add(ev.toolCallId);
        else realResultIds.add(ev.toolCallId);
      }
    }
    let completed = 0;
    let pending = 0;
    for (const id of callIds) {
      if (realResultIds.has(id)) completed += 1;
      else pending += 1; // synthetic or truly missing
      void syntheticResultIds; // noop — kept for symmetry with selector
    }
    cancelledMeta = {
      reason: cancelledEvent.reason,
      partialContent: cancelledEvent.partialContent,
      completedToolCalls: completed,
      pendingToolCalls: pending,
    };
  }

  const segments: MessageSegment[] | undefined = hasSegments
    ? folded.segments
    : hasContent
      ? [{ kind: 'text' as const, id: createSegmentId('text'), content: folded.streamContent }]
      : undefined;

  return {
    id: 'assistant-run-' + runId,
    role: 'assistant',
    content: folded.streamContent,
    runMeta: {
      status,
      collapsed: true,
      startedAt,
      completedAt,
      summary: buildRunSummary(
        status,
        folded.streamContent,
        segments,
        folded.toolCalls,
        startedAt,
        completedAt,
        errorText,
      ),
      exitDecision: folded.exitDecision,
      cancelled: cancelledMeta,
    },
    segments,
    toolCalls: hasTools ? folded.toolCalls : undefined,
    timestamp: completedAt,
  };
}

// Re-export createMessageId for the rare caller that still builds a
// non-deterministic id (e.g. streamError's pre-run-end fallback).
export { createMessageId };
