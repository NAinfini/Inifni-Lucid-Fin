import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TimelineEvent } from '@lucid-fin/contracts';

export interface CommanderTimelineState {
  events: TimelineEvent[];
  byRunId: Record<string, number[]>;
  sessionIdByRunId: Record<string, string>;
  currentRunIdBySessionId: Record<string, string>;
  droppedOutOfOrder: number;
  locallyResolvedConfirmationsBySessionId: Record<string, Record<string, string[]>>;
  locallyResolvedQuestionsBySessionId: Record<string, Record<string, string[]>>;
}

const initialState: CommanderTimelineState = {
  events: [],
  byRunId: {},
  sessionIdByRunId: {},
  currentRunIdBySessionId: {},
  droppedOutOfOrder: 0,
  locallyResolvedConfirmationsBySessionId: {},
  locallyResolvedQuestionsBySessionId: {},
};

function indexEvent(state: CommanderTimelineState, sessionId: string, event: TimelineEvent): void {
  const index = state.events.length;
  state.events.push(event);
  (state.byRunId[event.runId] ??= []).push(index);
  state.sessionIdByRunId[event.runId] = sessionId;
  if (event.kind === 'run_start') state.currentRunIdBySessionId[sessionId] = event.runId;
  if (event.kind === 'run_end' && state.currentRunIdBySessionId[sessionId] === event.runId) {
    delete state.currentRunIdBySessionId[sessionId];
  }
}

function appendOrphanResults(
  state: CommanderTimelineState,
  sessionId: string,
  event: TimelineEvent,
): void {
  if (event.kind !== 'run_end') return;
  const indices = state.byRunId[event.runId] ?? [];
  const resultIds = new Set<string>();
  const callIds: string[] = [];
  for (const index of indices) {
    const candidate = state.events[index];
    if (candidate.kind === 'tool_result') resultIds.add(candidate.toolCallId);
    else if (candidate.kind === 'tool_call') callIds.push(candidate.toolCallId);
  }
  let nextSeq = event.seq + 1;
  for (const toolCallId of callIds) {
    if (resultIds.has(toolCallId)) continue;
    indexEvent(state, sessionId, {
      kind: 'tool_result',
      toolCallId,
      status: 'failed',
      errorCode: 'RUN_ENDED_BEFORE_RESULT',
      synthetic: true,
      runId: event.runId,
      step: event.step,
      seq: nextSeq++,
      emittedAt: event.emittedAt,
    });
  }
}

function resolvedIds(
  index: Record<string, Record<string, string[]>>,
  sessionId: string,
  runId: string,
): string[] {
  return (index[sessionId] ??= {})[runId] ?? ((index[sessionId] ??= {})[runId] = []);
}

export const commanderTimelineSlice = createSlice({
  name: 'commanderTimeline',
  initialState,
  reducers: {
    appendEvent(
      state,
      action: PayloadAction<{ sessionId: string; event: TimelineEvent }>,
    ) {
      const { sessionId, event } = action.payload;
      const owner = state.sessionIdByRunId[event.runId];
      if (owner && owner !== sessionId) {
        state.droppedOutOfOrder += 1;
        return;
      }
      const runIndices = state.byRunId[event.runId] ?? [];
      if (runIndices.length > 0) {
        const lastIndex = runIndices[runIndices.length - 1];
        if (event.seq <= state.events[lastIndex].seq) {
          state.droppedOutOfOrder += 1;
          return;
        }
      }
      indexEvent(state, sessionId, event);
      appendOrphanResults(state, sessionId, event);
    },
    resetTimeline(state, action: PayloadAction<string>) {
      const sessionId = action.payload;
      const retained = state.events.flatMap((event) =>
        state.sessionIdByRunId[event.runId] === sessionId
          ? []
          : [{ sessionId: state.sessionIdByRunId[event.runId], event }],
      );
      state.events = [];
      state.byRunId = {};
      state.sessionIdByRunId = {};
      delete state.currentRunIdBySessionId[sessionId];
      delete state.locallyResolvedConfirmationsBySessionId[sessionId];
      delete state.locallyResolvedQuestionsBySessionId[sessionId];
      for (const item of retained) {
        if (item.sessionId) indexEvent(state, item.sessionId, item.event);
      }
    },
    markConfirmationResolvedLocally(
      state,
      action: PayloadAction<{ sessionId: string; runId: string; toolCallId: string }>,
    ) {
      const ids = resolvedIds(
        state.locallyResolvedConfirmationsBySessionId,
        action.payload.sessionId,
        action.payload.runId,
      );
      if (!ids.includes(action.payload.toolCallId)) ids.push(action.payload.toolCallId);
    },
    markQuestionResolvedLocally(
      state,
      action: PayloadAction<{ sessionId: string; runId: string; toolCallId: string }>,
    ) {
      const ids = resolvedIds(
        state.locallyResolvedQuestionsBySessionId,
        action.payload.sessionId,
        action.payload.runId,
      );
      if (!ids.includes(action.payload.toolCallId)) ids.push(action.payload.toolCallId);
    },
    hydrateEvents(
      state,
      action: PayloadAction<{ sessionId: string; events: TimelineEvent[] }>,
    ) {
      const retained = state.events.flatMap((event) =>
        state.sessionIdByRunId[event.runId] === action.payload.sessionId
          ? []
          : [{ sessionId: state.sessionIdByRunId[event.runId], event }],
      );
      state.events = [];
      state.byRunId = {};
      state.sessionIdByRunId = {};
      delete state.currentRunIdBySessionId[action.payload.sessionId];
      delete state.locallyResolvedConfirmationsBySessionId[action.payload.sessionId];
      delete state.locallyResolvedQuestionsBySessionId[action.payload.sessionId];
      for (const item of retained) {
        if (item.sessionId) indexEvent(state, item.sessionId, item.event);
      }
      for (const event of action.payload.events) {
        indexEvent(state, action.payload.sessionId, event);
      }
    },
  },
});

export const {
  appendEvent,
  resetTimeline,
  hydrateEvents,
  markConfirmationResolvedLocally,
  markQuestionResolvedLocally,
} = commanderTimelineSlice.actions;
