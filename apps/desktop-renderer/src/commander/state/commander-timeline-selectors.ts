/**
 * Commander timeline selectors — Batch 2 (legacy reducer removal).
 *
 * Read-side API for the `commanderTimeline` slice. Post-Batch-2:
 * - `selectCommanderView` (renamed from `selectLegacyDerivedView`) only
 *   derives the *active* run. Terminated runs live in
 *   `state.commander.messages`, pushed there by the service on `run_end`
 *   via `appendFinalizedAssistantMessage` (see D2). No more interleave.
 * - Per-run derivation logic moved to `run-derivation.ts` so the service
 *   can reuse it at finalize-time.
 */

import type { TimelineEvent } from '@lucid-fin/contracts';
import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '../../store/index.js';
import type {
  CommanderMessage,
  CommanderToolCall,
  MessageSegment,
  PendingConfirmation,
  PendingQuestion,
} from './types.js';
import { deriveActiveRunView } from './run-derivation.js';

export const selectTimelineEvents = (state: RootState): readonly TimelineEvent[] =>
  state.commanderTimeline.events;

export const selectCurrentRunId = (state: RootState): string | null =>
  state.commanderTimeline.currentRunId;

export function selectEventsForRun(
  state: RootState,
  runId: string,
): readonly TimelineEvent[] {
  const indices = state.commanderTimeline.byRunId[runId];
  if (!indices || indices.length === 0) return [];
  return indices.map((i) => state.commanderTimeline.events[i]);
}

export function selectCurrentRunEvents(state: RootState): readonly TimelineEvent[] {
  const runId = state.commanderTimeline.currentRunId;
  if (!runId) return [];
  return selectEventsForRun(state, runId);
}

export interface RunSummary {
  runId: string;
  events: readonly TimelineEvent[];
  /** `true` until a `run_end` or `cancelled` lands for this run. */
  active: boolean;
}

/** Every run seen, in chronological order by the first event's `seq`. */
export function selectAllRuns(state: RootState): readonly RunSummary[] {
  const { currentRunId, byRunId, events } = state.commanderTimeline;
  const out: RunSummary[] = [];
  const runIds = Object.keys(byRunId);
  runIds.sort((a, b) => {
    const aFirst = byRunId[a]?.[0] ?? -1;
    const bFirst = byRunId[b]?.[0] ?? -1;
    return aFirst - bFirst;
  });
  for (const runId of runIds) {
    const indices = byRunId[runId] ?? [];
    out.push({
      runId,
      events: indices.map((i) => events[i]),
      active: runId === currentRunId,
    });
  }
  return out;
}

export function selectToolCallById(
  state: RootState,
  toolCallId: string,
): TimelineEvent | undefined {
  return state.commanderTimeline.events.find(
    (e) => e.kind === 'tool_call' && e.toolCallId === toolCallId,
  );
}

export function selectToolResultById(
  state: RootState,
  toolCallId: string,
): TimelineEvent | undefined {
  return state.commanderTimeline.events.find(
    (e) => e.kind === 'tool_result' && e.toolCallId === toolCallId,
  );
}

/**
 * Phase F — per-run tool stats for CancelledBanner and run cards. Counts
 * completed real tool_result events, synthetic orphan-cleanup events, and
 * pending (tool_call without tool_result). The three groups partition the
 * tool_call events of the run.
 */
export interface RunToolStats {
  completed: number;
  synthetic: number;
  pending: number;
}

export function selectRunToolStats(state: RootState, runId: string): RunToolStats {
  const indices = state.commanderTimeline.byRunId[runId];
  if (!indices || indices.length === 0) return { completed: 0, synthetic: 0, pending: 0 };
  const callIds = new Set<string>();
  const realResultIds = new Set<string>();
  const syntheticResultIds = new Set<string>();
  for (const i of indices) {
    const ev = state.commanderTimeline.events[i];
    if (ev.kind === 'tool_call') callIds.add(ev.toolCallId);
    else if (ev.kind === 'tool_result') {
      if (ev.synthetic) syntheticResultIds.add(ev.toolCallId);
      else realResultIds.add(ev.toolCallId);
    }
  }
  let completed = 0;
  let synthetic = 0;
  let pending = 0;
  for (const id of callIds) {
    if (realResultIds.has(id)) completed += 1;
    else if (syntheticResultIds.has(id)) synthetic += 1;
    else pending += 1;
  }
  return { completed, synthetic, pending };
}

/** The `CancelledEvent` for a given run, if one was emitted. */
export function selectCancelledEventForRun(
  state: RootState,
  runId: string,
): TimelineEvent | undefined {
  const indices = state.commanderTimeline.byRunId[runId];
  if (!indices) return undefined;
  for (const i of indices) {
    const ev = state.commanderTimeline.events[i];
    if (ev.kind === 'cancelled') return ev;
  }
  return undefined;
}

export interface CommanderView {
  /** User + persisted finalized-assistant messages, read verbatim from the slice. */
  messages: CommanderMessage[];
  /** Segments for the active (open) run. Empty when no run is active. */
  currentSegments: MessageSegment[];
  currentToolCalls: CommanderToolCall[];
  currentStreamContent: string;
  /** Derived `liveMessage` prop for MessageList. */
  liveMessage: {
    id: string;
    role: 'assistant';
    content: string;
    toolCalls: CommanderToolCall[];
  } | null;
  pendingConfirmation: PendingConfirmation | null;
  pendingQuestion: PendingQuestion | null;
  error: string | null;
}

/**
 * Project the current UI view off the slice + timeline:
 * - `messages` — verbatim `state.commander.messages`. Finalized runs are
 *   pushed there by the service on `run_end`; user turns/system notices
 *   live there too.
 * - Active-run fields — derived from the currently open run's timeline
 *   events. Empty when no run is active.
 */
export const selectCommanderView = createSelector(
  [
    (state: RootState) => state.commanderTimeline,
    (state: RootState) => state.commander.messages,
    (state: RootState) => state.commander.error,
  ],
  (timelineState, legacyMessages, commanderError): CommanderView => {
    const {
      currentRunId,
      byRunId,
      events,
      locallyResolvedConfirmations,
      locallyResolvedQuestions,
    } = timelineState;

    let activeSegments: MessageSegment[] = [];
    let activeToolCalls: CommanderToolCall[] = [];
    let activeStreamContent = '';
    let activePendingConfirmation: PendingConfirmation | null = null;
    let activePendingQuestion: PendingQuestion | null = null;

    if (currentRunId) {
      const indices = byRunId[currentRunId] ?? [];
      const runEvents = indices.map((i) => events[i]);
      const view = deriveActiveRunView(
        runEvents,
        locallyResolvedConfirmations,
        locallyResolvedQuestions,
      );
      activeSegments = view.segments;
      activeToolCalls = view.toolCalls;
      activeStreamContent = view.streamContent;
      activePendingConfirmation = view.pendingConfirmation;
      activePendingQuestion = view.pendingQuestion;
    }

    const liveMessage =
      activeStreamContent || activeToolCalls.length > 0
        ? {
            id: 'live-' + (currentRunId ?? 'idle'),
            role: 'assistant' as const,
            content: activeStreamContent,
            toolCalls: activeToolCalls,
          }
        : null;

    return {
      messages: [...legacyMessages],
      currentSegments: activeSegments,
      currentToolCalls: activeToolCalls,
      currentStreamContent: activeStreamContent,
      liveMessage,
      pendingConfirmation: activePendingConfirmation,
      pendingQuestion: activePendingQuestion,
      error: commanderError,
    };
  },
);

export interface ActiveTodoSnapshot {
  todoId: string;
  items: Array<{
    id: string;
    label: string;
    status: 'pending' | 'in_progress' | 'done';
  }>;
}
