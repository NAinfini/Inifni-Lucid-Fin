/**
 * Commander Redux slice — Batch 2 (legacy reducer removal).
 *
 * After Batch 2:
 * - 8 dead stream reducers deleted (`appendStreamChunk`, `addToolCall`,
 *   `updateToolCallArguments`, `resolveToolCall`, `appendThinking`,
 *   `collapseThinking`, `pushStepMarker`, `pushPhaseNote`) — the timeline
 *   slice is the single source of truth for live run events.
 * - 3 transient state fields deleted (`currentStreamContent`,
 *   `currentToolCalls`, `currentSegments`) — selector derives from the
 *   timeline on the fly.
 * - `finalizeCurrentRunMessage` helper deleted — finalized messages are
 *   built by `buildFinalizedAssistantMessage` (run-derivation.ts) and
 *   appended via `appendFinalizedAssistantMessage` / upserted via
 *   `upsertFinalizedAssistantMessage`.
 * - `finishStreaming()` is payloadless.
 * - `streamError` still pushes a failed CommanderMessage (D4) but only
 *   from `start()`'s pre-run_end exception catch.
 * - `state.commander.finalizedRunIds: string[]` dedup set guards against
 *   local-cancel + late-backend-run_end producing duplicate messages.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import {
  compactCommanderMessages,
  COMMANDER_PROVIDER_KEY,
  DEFAULT_AUTO_SAVE_DELAY_MS,
  DEFAULT_CLIPBOARD_MIN_LENGTH,
  DEFAULT_CLIPBOARD_WATCH_INTERVAL_MS,
  DEFAULT_GENERATION_CONCURRENCY,
  DEFAULT_LLM_RETRIES,
  DEFAULT_MAX_LOG_ENTRIES,
  DEFAULT_MAX_MESSAGES_PER_SESSION,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_UNDO_GROUP_WINDOW_MS,
  DEFAULT_UNDO_STACK_DEPTH,
  MAX_SESSIONS,
  buildRunSummary,
  createMessageId,
  deriveSessionTitle,
  formatQuestionTranscript,
  hasUserMessage,
  idlePhase,
  isActivePhase,
  loadPersistedProviderId,
  loadPersistedSessions,
  loadPersistedSettings,
  persistCurrentSession,
  persistSessions,
  persistSettingsFromState,
  phaseFromEvent,
  resetTransientRunState,
  writePersistedProviderId,
} from '../../commander/state/index.js';
import type { TimelineEvent } from '@lucid-fin/contracts';
import type { RunPhase } from '../../commander/state/run-phase.js';
import type {
  CommanderBackendContextUsage,
  CommanderMessage,
  CommanderSession,
  CommanderState,
  PendingConfirmation,
  PendingQuestion,
  PermissionMode,
} from '../../commander/state/types.js';

export type {
  CommanderBackendContextUsage,
  CommanderMessage,
  CommanderQuestionMeta,
  CommanderQuestionOption,
  CommanderRunMeta,
  CommanderRunStatus,
  CommanderRunSummary,
  CommanderSession,
  CommanderState,
  CommanderToolCall,
  MessageSegment,
  PendingConfirmation,
  PendingQuestion,
  PermissionMode,
} from '../../commander/state/types.js';
export type { RunPhase } from '../../commander/state/run-phase.js';

const persistedSettings = loadPersistedSettings();

const initialState: CommanderState = {
  open: false,
  minimized: false,
  providerId: loadPersistedProviderId(),
  activeCanvasId: null,
  activeSessionId: null,
  sessions: loadPersistedSessions(),
  messages: [],
  phase: idlePhase,
  currentRunStartedAt: null,
  error: null,
  finalizedRunIds: [],
  position: { x: 24, y: 96 },
  size: { width: 400, height: 500 },
  permissionMode: persistedSettings.permissionMode ?? 'normal',
  maxSteps: persistedSettings.maxSteps ?? DEFAULT_MAX_STEPS,
  temperature: persistedSettings.temperature ?? DEFAULT_TEMPERATURE,
  maxTokens: persistedSettings.maxTokens ?? DEFAULT_MAX_TOKENS,
  llmRetries: persistedSettings.llmRetries ?? DEFAULT_LLM_RETRIES,
  maxSessions: persistedSettings.maxSessions ?? DEFAULT_MAX_SESSIONS,
  maxMessagesPerSession:
    persistedSettings.maxMessagesPerSession ?? DEFAULT_MAX_MESSAGES_PER_SESSION,
  undoStackDepth: persistedSettings.undoStackDepth ?? DEFAULT_UNDO_STACK_DEPTH,
  maxLogEntries: persistedSettings.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES,
  autoSaveDelayMs: persistedSettings.autoSaveDelayMs ?? DEFAULT_AUTO_SAVE_DELAY_MS,
  undoGroupWindowMs: persistedSettings.undoGroupWindowMs ?? DEFAULT_UNDO_GROUP_WINDOW_MS,
  clipboardWatchIntervalMs:
    persistedSettings.clipboardWatchIntervalMs ?? DEFAULT_CLIPBOARD_WATCH_INTERVAL_MS,
  clipboardMinLength: persistedSettings.clipboardMinLength ?? DEFAULT_CLIPBOARD_MIN_LENGTH,
  generationConcurrency:
    persistedSettings.generationConcurrency ?? DEFAULT_GENERATION_CONCURRENCY,
  pendingConfirmation: null,
  pendingQuestion: null,
  confirmAutoMode: 'none',
  consecutiveConfirmCount: 0,
  messageQueue: [],
  pendingInjectedMessages: [],
  backendContextUsage: null,
};

/** Commit queued injected user messages to the message list. Shared by
 *  finishStreaming / streamError paths so both preserve ordering. */
function commitPendingInjectedMessages(state: CommanderState): void {
  for (const msg of state.pendingInjectedMessages) {
    state.messages.push({
      id: createMessageId('user'),
      role: 'user',
      content: msg,
      timestamp: Date.now(),
    });
  }
  state.pendingInjectedMessages = [];
}

export const commanderSlice = createSlice({
  name: 'commander',
  initialState,
  reducers: {
    toggleCommander(state) {
      if (!state.open) {
        state.open = true;
        state.minimized = false;
        return;
      }
      state.open = false;
      state.minimized = false;
    },
    setCommanderOpen(state, action: PayloadAction<boolean>) {
      state.open = action.payload;
      state.minimized = false;
    },
    minimizeCommander(state) {
      if (state.open) state.minimized = true;
    },
    setProviderId(state, action: PayloadAction<string | null>) {
      state.providerId = action.payload;
      writePersistedProviderId(action.payload);
    },
    ensureActiveSession(state, action: PayloadAction<string>) {
      if (!state.activeSessionId) {
        state.activeSessionId = action.payload;
      }
    },
    addUserMessage(state, action: PayloadAction<string>) {
      state.messages.push({
        id: createMessageId('user'),
        role: 'user',
        content: action.payload,
        timestamp: Date.now(),
      });
      state.error = null;
      state.open = true;
      state.minimized = false;
    },
    /** Queue a user message sent during streaming — shown below live AI, committed on finishStreaming. */
    addInjectedMessage(state, action: PayloadAction<string>) {
      state.pendingInjectedMessages.push(action.payload);
    },
    startStreaming(state) {
      state.phase = { kind: 'awaiting_model', step: 0, since: Date.now() };
      state.currentRunStartedAt = Date.now();
      state.error = null;
      state.open = true;
      state.minimized = false;
    },
    /**
     * Advance the RunPhase state machine by one TimelineEvent. Called by
     * the service after it pushes the event into `commanderTimeline` so
     * `state.phase` stays in sync with the v2 event stream.
     */
    updateRunPhase(state, action: PayloadAction<TimelineEvent>) {
      state.phase = phaseFromEvent(state.phase, action.payload);
    },
    /**
     * D2/D2b — normal-path finalize. No-op when runId is already in
     * `finalizedRunIds` (late-run_end-after-local-cancel race handled by
     * `upsertFinalizedAssistantMessage` instead).
     */
    appendFinalizedAssistantMessage(
      state,
      action: PayloadAction<{ message: CommanderMessage; runId: string }>,
    ) {
      const { message, runId } = action.payload;
      if (state.finalizedRunIds.includes(runId)) return;
      state.messages.push(message);
      state.finalizedRunIds.push(runId);
      persistCurrentSession(state);
    },
    /**
     * D2b — late-run_end-after-cancel merge. Always dispatched by the
     * service's `run_end` side-effect when the runId is already in
     * `finalizedRunIds`. Replaces the message in place (preserving the
     * list position) so the backend's richer `exitDecision` / `summary`
     * wins while the user sees no flicker.
     */
    upsertFinalizedAssistantMessage(
      state,
      action: PayloadAction<{ message: CommanderMessage; runId: string }>,
    ) {
      const { message, runId } = action.payload;
      const idx = state.messages.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        state.messages[idx] = message;
      } else {
        state.messages.push(message);
      }
      if (!state.finalizedRunIds.includes(runId)) {
        state.finalizedRunIds.push(runId);
      }
      persistCurrentSession(state);
    },
    finishStreaming(state) {
      commitPendingInjectedMessages(state);
      resetTransientRunState(state);
      persistCurrentSession(state);
    },
    /**
     * Pre-run_end error path (D4). Pushes a minimal failed assistant
     * message — no segments, no toolCalls — since no timeline events
     * existed when this error fired. The run_end.failed path does NOT
     * dispatch this reducer; it uses `appendFinalizedAssistantMessage`
     * with a derived message.
     */
    streamError(state, action: PayloadAction<string>) {
      const errorMsg = action.payload;
      state.error = errorMsg;
      const completedAt = Date.now();
      const startedAt = state.currentRunStartedAt ?? completedAt;
      state.messages.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: errorMsg,
        runMeta: {
          status: 'failed',
          collapsed: true,
          startedAt,
          completedAt,
          summary: buildRunSummary(
            'failed',
            errorMsg,
            undefined,
            [],
            startedAt,
            completedAt,
            errorMsg,
          ),
        },
        timestamp: completedAt,
      });
      commitPendingInjectedMessages(state);
      resetTransientRunState(state);
      persistCurrentSession(state);
    },
    clearHistory(state) {
      persistCurrentSession(state);
      state.activeSessionId = null;
      state.messages = [];
      state.currentRunStartedAt = null;
      state.error = null;
      state.finalizedRunIds = [];
      state.phase = idlePhase;
      state.pendingConfirmation = null;
      state.pendingQuestion = null;
      state.confirmAutoMode = 'none';
      state.consecutiveConfirmCount = 0;
      state.pendingInjectedMessages = [];
      state.backendContextUsage = null;
    },
    /** Start a new session (save current first) */
    newSession(state) {
      persistCurrentSession(state);
      state.activeSessionId = null;
      state.messages = [];
      state.currentRunStartedAt = null;
      state.error = null;
      state.finalizedRunIds = [];
      state.phase = idlePhase;
      state.pendingConfirmation = null;
      state.pendingQuestion = null;
      state.confirmAutoMode = 'none';
      state.consecutiveConfirmCount = 0;
      state.pendingInjectedMessages = [];
      state.backendContextUsage = null;
    },
    /** Load a previous session. Pass hydratedMessages if fetched from DB. */
    loadSession(
      state,
      action: PayloadAction<{ id: string; hydratedMessages?: CommanderMessage[] }>,
    ) {
      const { id, hydratedMessages } =
        typeof action.payload === 'string'
          ? { id: action.payload, hydratedMessages: undefined }
          : action.payload;
      if (hasUserMessage(state.messages) && state.activeSessionId) {
        const existing = state.sessions.findIndex((s) => s.id === state.activeSessionId);
        if (existing >= 0) {
          state.sessions[existing].messages = state.messages;
          state.sessions[existing].updatedAt = Date.now();
          persistSessions(state.sessions);
        }
      }
      const session = state.sessions.find((s) => s.id === id);
      if (!session) return;
      if (hydratedMessages && session.messages.length === 0) {
        session.messages = hydratedMessages;
      }
      state.activeSessionId = session.id;
      state.activeCanvasId = session.canvasId;
      state.messages = session.messages;
      state.currentRunStartedAt = null;
      state.error = null;
      state.finalizedRunIds = [];
      state.phase = idlePhase;
      state.pendingConfirmation = null;
      state.pendingQuestion = null;
      state.confirmAutoMode = 'none';
      state.consecutiveConfirmCount = 0;
    },
    /** Delete a saved session */
    deleteSession(state, action: PayloadAction<string>) {
      state.sessions = state.sessions.filter((s) => s.id !== action.payload);
      persistSessions(state.sessions);
      if (state.activeSessionId === action.payload) {
        state.activeSessionId = null;
        state.messages = [];
      }
    },
    /** Rename a saved session */
    renameSession(state, action: PayloadAction<{ id: string; title: string }>) {
      const session = state.sessions.find((s) => s.id === action.payload.id);
      if (!session) return;
      session.title = action.payload.title;
      session.updatedAt = Date.now();
      persistSessions(state.sessions);
    },
    setPosition(state, action: PayloadAction<{ x: number; y: number }>) {
      state.position = action.payload;
    },
    setSize(state, action: PayloadAction<{ width: number; height: number }>) {
      state.size = action.payload;
    },
    setPermissionMode(state, action: PayloadAction<PermissionMode>) {
      state.permissionMode = action.payload;
      persistSettingsFromState(state);
    },
    setMaxSteps(state, action: PayloadAction<number>) {
      state.maxSteps = Math.max(1, Math.min(200, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setTemperature(state, action: PayloadAction<number>) {
      state.temperature = Math.max(0, Math.min(1, Math.round(action.payload * 10) / 10));
      persistSettingsFromState(state);
    },
    setMaxTokens(state, action: PayloadAction<number>) {
      state.maxTokens = Math.max(
        1024,
        Math.min(1_000_000, Math.round(action.payload / 1024) * 1024),
      );
      persistSettingsFromState(state);
    },
    setAutoSaveDelayMs(state, action: PayloadAction<number>) {
      state.autoSaveDelayMs = Math.max(100, Math.min(5000, Math.round(action.payload / 100) * 100));
      persistSettingsFromState(state);
    },
    setUndoGroupWindowMs(state, action: PayloadAction<number>) {
      state.undoGroupWindowMs = Math.max(50, Math.min(1000, Math.round(action.payload / 50) * 50));
      persistSettingsFromState(state);
    },
    setClipboardWatchIntervalMs(state, action: PayloadAction<number>) {
      state.clipboardWatchIntervalMs = Math.max(
        500,
        Math.min(10000, Math.round(action.payload / 500) * 500),
      );
      persistSettingsFromState(state);
    },
    setClipboardMinLength(state, action: PayloadAction<number>) {
      state.clipboardMinLength = Math.max(10, Math.min(1000, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setGenerationConcurrency(state, action: PayloadAction<number>) {
      state.generationConcurrency = Math.max(1, Math.min(10, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setLlmRetries(state, action: PayloadAction<number>) {
      state.llmRetries = Math.max(0, Math.min(10, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setMaxSessions(state, action: PayloadAction<number>) {
      state.maxSessions = Math.max(5, Math.min(200, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setMaxMessagesPerSession(state, action: PayloadAction<number>) {
      state.maxMessagesPerSession = Math.max(20, Math.min(1000, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setUndoStackDepth(state, action: PayloadAction<number>) {
      state.undoStackDepth = Math.max(10, Math.min(500, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setMaxLogEntries(state, action: PayloadAction<number>) {
      state.maxLogEntries = Math.max(100, Math.min(5000, Math.round(action.payload)));
      persistSettingsFromState(state);
    },
    setPendingConfirmation(state, action: PayloadAction<PendingConfirmation>) {
      state.pendingConfirmation = action.payload;
    },
    clearPendingConfirmation(state) {
      state.pendingConfirmation = null;
      state.consecutiveConfirmCount++;
    },
    setConfirmAutoMode(state, action: PayloadAction<'none' | 'approve' | 'skip'>) {
      state.confirmAutoMode = action.payload;
      if (action.payload === 'none') {
        state.consecutiveConfirmCount = 0;
      }
    },
    setBackendContextUsage(state, action: PayloadAction<CommanderBackendContextUsage | null>) {
      state.backendContextUsage = action.payload;
    },
    setPendingQuestion(state, action: PayloadAction<PendingQuestion>) {
      state.pendingQuestion = action.payload;
    },
    clearPendingQuestion(state) {
      state.pendingQuestion = null;
    },
    resolveQuestion(state, action: PayloadAction<{ answer: string }>) {
      if (!state.pendingQuestion) return;
      const { question, options } = state.pendingQuestion;
      state.messages.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: formatQuestionTranscript(question, options),
        questionMeta: { question, options },
        timestamp: Date.now(),
      });
      state.messages.push({
        id: createMessageId('user'),
        role: 'user',
        content: action.payload.answer,
        timestamp: Date.now(),
      });
      state.pendingQuestion = null;
    },
    enqueueMessage(state, action: PayloadAction<string>) {
      state.messageQueue.push(action.payload);
    },
    dequeueMessage(state) {
      state.messageQueue.shift();
    },
    removeQueuedMessage(state, action: PayloadAction<number>) {
      state.messageQueue.splice(action.payload, 1);
    },
    editQueuedMessage(state, action: PayloadAction<{ index: number; content: string }>) {
      state.messageQueue[action.payload.index] = action.payload.content;
    },
    clearQueue(state) {
      state.messageQueue = [];
    },
    addSystemNotice(state, action: PayloadAction<string>) {
      state.messages.push({
        id: createMessageId('system'),
        role: 'assistant',
        content: action.payload,
        timestamp: Date.now(),
      });
    },
    /**
     * Compact local message store to reclaim context space. See
     * `commander/state/compactor.ts` for the strategy documentation.
     */
    compactLocalContext(state) {
      compactCommanderMessages(state);
    },
    restore(_state, action: PayloadAction<CommanderState>) {
      // Defensive destructure — old persisted payloads may include the
      // three deleted transient fields; strip them before spread.
      const {
        currentStreamContent: _a,
        currentToolCalls: _b,
        currentSegments: _c,
        ...rest
      } = action.payload as CommanderState & {
        currentStreamContent?: unknown;
        currentToolCalls?: unknown;
        currentSegments?: unknown;
      };
      void _a;
      void _b;
      void _c;
      return {
        ...initialState,
        ...rest,
        phase: idlePhase,
        currentRunStartedAt: null,
        error: null,
        finalizedRunIds: [],
        permissionMode: rest.permissionMode ?? 'normal',
        maxSteps: rest.maxSteps ?? DEFAULT_MAX_STEPS,
        temperature: rest.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: rest.maxTokens ?? DEFAULT_MAX_TOKENS,
        pendingConfirmation: null,
        pendingQuestion: null,
        confirmAutoMode: 'none',
        consecutiveConfirmCount: 0,
        messageQueue: [],
      };
    },
    /** Merge sessions loaded from SQLite into in-memory list. */
    loadSessionsFromDB(state, action: PayloadAction<CommanderSession[]>) {
      const localMap = new Map(state.sessions.map((s) => [s.id, s]));
      const dbMap = new Map(action.payload.map((s) => [s.id, s]));
      const merged: CommanderSession[] = [];
      for (const [id, dbSession] of dbMap) {
        const local = localMap.get(id);
        if (local && local.messages.length > 0 && dbSession.messages.length === 0) {
          merged.push({ ...dbSession, messages: local.messages });
        } else {
          merged.push(dbSession);
        }
      }
      for (const s of state.sessions) {
        if (!dbMap.has(s.id)) merged.push(s);
      }
      merged.sort((a, b) => b.updatedAt - a.updatedAt);
      state.sessions = merged.slice(0, MAX_SESSIONS);
    },
    /** Called when the active canvas changes. Saves current session, resets state, and loads the most recent session for the new canvas (if any). */
    switchCanvas(state, action: PayloadAction<string | null>) {
      const newCanvasId = action.payload;
      if (newCanvasId === state.activeCanvasId) return;

      if (hasUserMessage(state.messages)) {
        const now = Date.now();
        const sessionId = state.activeSessionId ?? crypto.randomUUID();
        const existing = state.sessions.findIndex((s) => s.id === sessionId);
        const session: CommanderSession = {
          id: sessionId,
          canvasId: state.activeCanvasId,
          title: deriveSessionTitle(state.messages),
          messages: state.messages,
          createdAt: existing >= 0 ? state.sessions[existing].createdAt : now,
          updatedAt: now,
        };
        if (existing >= 0) {
          state.sessions[existing] = session;
        } else {
          state.sessions.unshift(session);
        }
        if (state.sessions.length > MAX_SESSIONS) {
          state.sessions = state.sessions.slice(0, MAX_SESSIONS);
        }
        persistSessions(state.sessions);
      }

      state.activeCanvasId = newCanvasId;

      const canvasSession = newCanvasId
        ? state.sessions.find((s) => s.canvasId === newCanvasId)
        : undefined;

      if (canvasSession) {
        state.activeSessionId = canvasSession.id;
        state.messages = canvasSession.messages;
      } else {
        state.activeSessionId = null;
        state.messages = [];
      }

      state.currentRunStartedAt = null;
      state.error = null;
      state.finalizedRunIds = [];
      state.phase = idlePhase;
      state.pendingConfirmation = null;
      state.pendingQuestion = null;
      state.confirmAutoMode = 'none';
      state.consecutiveConfirmCount = 0;
      state.pendingInjectedMessages = [];
      state.backendContextUsage = null;
    },
  },
});

export const {
  toggleCommander,
  setCommanderOpen,
  minimizeCommander,
  setProviderId,
  ensureActiveSession,
  addUserMessage,
  addInjectedMessage,
  startStreaming,
  updateRunPhase,
  appendFinalizedAssistantMessage,
  upsertFinalizedAssistantMessage,
  finishStreaming,
  streamError,
  clearHistory,
  newSession,
  loadSession,
  deleteSession,
  renameSession,
  setPosition,
  setSize,
  setPermissionMode,
  setMaxSteps,
  setTemperature,
  setMaxTokens,
  setLlmRetries,
  setMaxSessions,
  setMaxMessagesPerSession,
  setUndoStackDepth,
  setMaxLogEntries,
  setAutoSaveDelayMs,
  setUndoGroupWindowMs,
  setClipboardWatchIntervalMs,
  setClipboardMinLength,
  setGenerationConcurrency,
  setPendingConfirmation,
  clearPendingConfirmation,
  setConfirmAutoMode,
  setBackendContextUsage,
  setPendingQuestion,
  clearPendingQuestion,
  resolveQuestion,
  enqueueMessage,
  dequeueMessage,
  removeQueuedMessage,
  editQueuedMessage,
  clearQueue,
  addSystemNotice,
  compactLocalContext,
  loadSessionsFromDB,
  switchCanvas,
} = commanderSlice.actions;

export { COMMANDER_PROVIDER_KEY };

/**
 * Whether the Commander is in an active run. Replaces the old boolean
 * `state.commander.streaming` field — the phase machine is the source of
 * truth; every other "am I streaming" check derives from it.
 */
export const selectIsStreaming = (state: { commander: { phase: RunPhase } }): boolean =>
  isActivePhase(state.commander.phase);

export const selectPhase = (state: { commander: { phase: RunPhase } }): RunPhase =>
  state.commander.phase;
