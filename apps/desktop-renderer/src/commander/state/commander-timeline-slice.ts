/**
 * Commander timeline slice — Phase C.
 *
 * Append-only store of `TimelineEvent[]` per the Phase A contract.
 * Coexists with the legacy `commanderSlice` during migration:
 *
 *   - Dispatcher routes events by `envelope.wireVersion`: v1 feeds the
 *     legacy `commanderSlice.reducer` (unchanged); v2 feeds
 *     `commanderTimelineSlice.actions.appendEvent`.
 *   - Phase B emits v2-shaped events (`run_start`, `run_end`,
 *     `cancelled`) additively on the v1 channel already. The
 *     `CommanderSessionService.subscribe` dispatcher will also forward
 *     them here via the envelope path (Phase C-3 wiring below).
 *
 * Sort/ordering invariant (Codex freeze 2026-04-20):
 *
 *   - `seq` is the single primary ordering key, monotonic per-run.
 *   - `step` is semantic (model-step-index, not a sort key).
 *   - `emittedAt` is debug/display only.
 *
 * Out-of-order events are logged + dropped. Never silently reordered.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TimelineEvent } from '@lucid-fin/contracts';

export interface CommanderTimelineState {
  events: TimelineEvent[];
  /** Map runId → indices into `events[]`. Keeps per-run lookup O(k). */
  byRunId: Record<string, number[]>;
  /** Most recently opened run (via `run_start`). Cleared on `run_end`. */
  currentRunId: string | null;
  /** Lightweight out-of-order drop counter — surfaced for telemetry. */
  droppedOutOfOrder: number;
  /**
   * toolCallIds of `tool_confirm_prompt` events the user resolved locally
   * (clicked Execute/Skip) before the backend `user_confirmation` arrives.
   * Selector treats these as closed so the confirm card disappears on click
   * instead of hanging until the round-trip completes. Idempotent with the
   * backend event when it lands.
   */
  locallyResolvedConfirmations: string[];
  /**
   * toolCallIds of `question_prompt` events the user answered locally.
   * Same rationale as above but for askUser questions.
   */
  locallyResolvedQuestions: string[];
}

const initialState: CommanderTimelineState = {
  events: [],
  byRunId: {},
  currentRunId: null,
  droppedOutOfOrder: 0,
  locallyResolvedConfirmations: [],
  locallyResolvedQuestions: [],
};

export const commanderTimelineSlice = createSlice({
  name: 'commanderTimeline',
  initialState,
  reducers: {
    appendEvent(state, action: PayloadAction<TimelineEvent>) {
      const event = action.payload;
      const runIndices = state.byRunId[event.runId] ?? [];

      // Monotonicity check: drop + log if `seq` regresses within a run.
      if (runIndices.length > 0) {
        const lastIdx = runIndices[runIndices.length - 1];
        const lastSeq = state.events[lastIdx].seq;
        if (event.seq <= lastSeq) {
          state.droppedOutOfOrder += 1;
          return;
        }
      }

      const idx = state.events.length;
      state.events.push(event);
      if (!state.byRunId[event.runId]) {
        state.byRunId[event.runId] = [];
      }
      state.byRunId[event.runId].push(idx);

      if (event.kind === 'run_start') {
        state.currentRunId = event.runId;
      }
      if (
        (event.kind === 'run_end' || event.kind === 'cancelled') &&
        state.currentRunId === event.runId
      ) {
        state.currentRunId = null;
      }

      // Phase F — orphan cleanup on terminal events. Any `tool_call`
      // for this run that never got a matching `tool_result` gets a
      // synthetic `tool_result` with `RUN_ENDED_BEFORE_RESULT` so the
      // UI can close the spinner deterministically. Synthetic events
      // consume fresh seq numbers (monotonic after the terminal event).
      if (event.kind === 'run_end' || event.kind === 'cancelled') {
        const indices = state.byRunId[event.runId] ?? [];
        const resultIds = new Set<string>();
        const callEvents: { index: number; id: string }[] = [];
        for (const i of indices) {
          const ev = state.events[i];
          if (ev.kind === 'tool_result') resultIds.add(ev.toolCallId);
          else if (ev.kind === 'tool_call') callEvents.push({ index: i, id: ev.toolCallId });
        }
        let nextSeq = event.seq + 1;
        for (const { id } of callEvents) {
          if (resultIds.has(id)) continue;
          const synthetic = {
            kind: 'tool_result' as const,
            toolCallId: id,
            error: { code: 'RUN_ENDED_BEFORE_RESULT' as const, params: {} },
            durationMs: 0,
            synthetic: true as const,
            runId: event.runId,
            step: event.step,
            seq: nextSeq++,
            emittedAt: event.emittedAt,
          };
          const synIdx = state.events.length;
          state.events.push(synthetic);
          state.byRunId[event.runId].push(synIdx);
        }
      }
    },

    /**
     * Clear the timeline. Called on new session load or explicit reset.
     * Does not touch legacy `commanderSlice` — both slices reset via
     * their own actions.
     */
    resetTimeline(state) {
      state.events = [];
      state.byRunId = {};
      state.currentRunId = null;
      state.droppedOutOfOrder = 0;
      state.locallyResolvedConfirmations = [];
      state.locallyResolvedQuestions = [];
    },

    /**
     * Mark a tool_confirm_prompt as resolved on the renderer side — lets
     * the confirm card disappear the instant the user clicks Execute/Skip
     * instead of waiting for the IPC round-trip + backend user_confirmation
     * emit. Idempotent: when the real user_confirmation event lands, the
     * selector already treats the prompt as closed via the same toolCallId.
     */
    markConfirmationResolvedLocally(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (!state.locallyResolvedConfirmations.includes(id)) {
        state.locallyResolvedConfirmations.push(id);
      }
    },

    /**
     * Same as above but for askUser question prompts.
     */
    markQuestionResolvedLocally(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (!state.locallyResolvedQuestions.includes(id)) {
        state.locallyResolvedQuestions.push(id);
      }
    },

    /**
     * Bulk-replace the timeline from persisted `commander_events` rows.
     * Used on session resume (v2cut Phase 5 hydration). Events must
     * already be sorted by (runId, seq) from the repo; we rebuild
     * `byRunId` and `currentRunId` as we walk.
     */
    hydrateEvents(state, action: PayloadAction<TimelineEvent[]>) {
      state.events = [];
      state.byRunId = {};
      state.currentRunId = null;
      state.droppedOutOfOrder = 0;
      state.locallyResolvedConfirmations = [];
      state.locallyResolvedQuestions = [];
      for (const event of action.payload) {
        const idx = state.events.length;
        state.events.push(event);
        if (!state.byRunId[event.runId]) {
          state.byRunId[event.runId] = [];
        }
        state.byRunId[event.runId].push(idx);
        if (event.kind === 'run_start') {
          state.currentRunId = event.runId;
        }
        if (
          (event.kind === 'run_end' || event.kind === 'cancelled') &&
          state.currentRunId === event.runId
        ) {
          state.currentRunId = null;
        }
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
