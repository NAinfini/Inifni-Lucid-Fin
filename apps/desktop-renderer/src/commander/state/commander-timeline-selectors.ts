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

export const selectActiveTodoSnapshot = createSelector(
  [selectCurrentRunEvents, selectCurrentRunId],
  (events, currentRunId): ActiveTodoSnapshot | null => {
    if (!currentRunId) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind !== 'tool_result') continue;
      const toolCall = events.find(
        (e) => e.kind === 'tool_call' && 'toolCallId' in e && e.toolCallId === (ev as { toolCallId?: string }).toolCallId,
      );
      if (!toolCall || toolCall.kind !== 'tool_call') continue;
      const ref = (toolCall as { toolRef?: { domain?: string } }).toolRef;
      if (ref?.domain !== 'todo') continue;
      const result = (ev as { result?: { data?: { todoSnapshot?: ActiveTodoSnapshot } } }).result;
      const snapshot = result?.data?.todoSnapshot;
      if (snapshot && typeof snapshot.todoId === 'string' && Array.isArray(snapshot.items)) {
        return snapshot;
      }
    }
    return null;
  },
);
