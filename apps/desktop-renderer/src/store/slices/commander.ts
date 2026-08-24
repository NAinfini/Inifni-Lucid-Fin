import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CommanderRunIntent, RunResourceBudget, TimelineEvent } from '@lucid-fin/contracts';

import {
  COMMANDER_PROVIDER_KEY,
  DEFAULT_AUTO_SAVE_DELAY_MS,
  DEFAULT_COMMANDER_PANEL_HEIGHT,
  DEFAULT_COMMANDER_PANEL_WIDTH,
  DEFAULT_CLIPBOARD_MIN_LENGTH,
  DEFAULT_CLIPBOARD_WATCH_INTERVAL_MS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_GENERATION_CONCURRENCY,
  DEFAULT_MAX_LOG_ENTRIES,
  DEFAULT_MAX_MESSAGES_PER_SESSION,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_QUALITY_GATE_BEHAVIOR,
  DEFAULT_REQUIRE_STYLE_PLATE_BEFORE_REF_IMAGE,
  DEFAULT_TEMPERATURE,
  DEFAULT_UNDO_GROUP_WINDOW_MS,
  DEFAULT_UNDO_STACK_DEPTH,
  MAX_COMMANDER_CONTEXT_TOKENS,
  MAX_COMMANDER_OUTPUT_TOKENS,
  MAX_SESSIONS,
  buildRunSummary,
  createCommanderSession,
  createCommanderSessionRuntime,
  createMessageId,
  idlePhase,
  isActivePhase,
  loadPersistedProviderId,
  loadPersistedSessions,
  loadPersistedSettings,
  persistSession,
  persistSessions,
  persistSettingsFromState,
  phaseFromEvent,
  resetTransientRunState,
  writePersistedProviderId,
} from '../../commander/state/index.js';
import type { RunPhase } from '../../commander/state/run-phase.js';
import type {
  CommanderBackendContextUsage,
  CommanderMessage,
  CommanderSession,
  CommanderSessionRuntime,
  CommanderState,
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
  CommanderSessionRuntime,
  CommanderState,
  CommanderToolCall,
  MessageSegment,
  PendingConfirmation,
  PendingQuestion,
  PermissionMode,
} from '../../commander/state/types.js';
export type { RunPhase } from '../../commander/state/run-phase.js';

export type DurableMediaTaskRequest = {
  canvasId: string;
  nodeId: string;
  providerId: string | null;
  variantCount: number;
  seed: number;
};

export type DurableMediaCancellationRequest = Pick<DurableMediaTaskRequest, 'canvasId' | 'nodeId'>;

const persistedSettings = loadPersistedSettings();

const initialState: CommanderState = {
  open: false,
  minimized: false,
  activityFocus: null,
  providerId: loadPersistedProviderId(),
  activeSessionId: null,
  sessions: loadPersistedSessions(),
  position: { x: 24, y: 96 },
  size: { width: DEFAULT_COMMANDER_PANEL_WIDTH, height: DEFAULT_COMMANDER_PANEL_HEIGHT },
  permissionMode: persistedSettings.permissionMode ?? 'normal',
  resourceBudget: normalizeRunResourceBudget(persistedSettings.resourceBudget),
  temperature: persistedSettings.temperature ?? DEFAULT_TEMPERATURE,
  contextWindowTokens: normalizeContextWindowTokens(persistedSettings.contextWindowTokens),
  maxOutputTokens: normalizeMaxOutputTokens(persistedSettings.maxOutputTokens),
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
  generationConcurrency: persistedSettings.generationConcurrency ?? DEFAULT_GENERATION_CONCURRENCY,
  qualityGateBehavior: persistedSettings.qualityGateBehavior ?? DEFAULT_QUALITY_GATE_BEHAVIOR,
  requireStylePlateBeforeRefImage:
    persistedSettings.requireStylePlateBeforeRefImage ??
    DEFAULT_REQUIRE_STYLE_PLATE_BEFORE_REF_IMAGE,
};

const MESSAGE_QUEUE_COMPACTION_MIN_CURSOR = 128;

function findSession(state: CommanderState, sessionId: string): CommanderSession | undefined {
  return state.sessions.find((session) => session.id === sessionId);
}

function compactMessageQueue(runtime: CommanderSessionRuntime): void {
  const { messageQueue, messageQueueCursor } = runtime;
  if (
    messageQueueCursor === 0 ||
    (messageQueueCursor < messageQueue.length &&
      (messageQueueCursor < MESSAGE_QUEUE_COMPACTION_MIN_CURSOR ||
        messageQueueCursor * 2 < messageQueue.length))
  ) {
    return;
  }
  runtime.messageQueue = messageQueue.slice(messageQueueCursor);
  runtime.messageQueueFirstIndex += messageQueueCursor;
  runtime.messageQueueCursor = 0;
}

function commitPendingInjectedMessages(session: CommanderSession): void {
  for (const content of session.runtime.pendingInjectedMessages) {
    session.messages.push({
      id: createMessageId('user'),
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }
  session.runtime.pendingInjectedMessages = [];
}

function finiteNumber(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

function wholeNumberAtLeast(value: number, min: number): number | null {
  const rounded = Math.round(value);
  if (!Number.isFinite(rounded)) return null;
  return Math.max(min, rounded);
}

function normalizeContextWindowTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_WINDOW_TOKENS;
  }
  return Math.min(MAX_COMMANDER_CONTEXT_TOKENS, Math.max(1, Math.round(value)));
}

function normalizeMaxOutputTokens(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(MAX_COMMANDER_OUTPUT_TOKENS, Math.max(1, Math.round(value)));
}

function normalizeRunResourceBudget(value: unknown): RunResourceBudget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const candidate = value as Partial<RunResourceBudget>;
  const budget: RunResourceBudget = {};
  const integerFields = ['maxTokens', 'maxToolCalls', 'maxWallTimeMs'] as const;
  for (const field of integerFields) {
    const fieldValue = candidate[field];
    if (
      typeof fieldValue === 'number' &&
      Number.isSafeInteger(fieldValue) &&
      fieldValue >= 0
    ) {
      budget[field] = fieldValue;
    }
  }
  if (
    typeof candidate.maxCostUsd === 'number' &&
    Number.isFinite(candidate.maxCostUsd) &&
    candidate.maxCostUsd >= 0
  ) {
    budget.maxCostUsd = candidate.maxCostUsd;
  }
  return budget;
}

function retainRecentSessions(
  sessions: CommanderSession[],
  activeSessionId: string | null,
): CommanderSession[] {
  const protectedSessionIds = new Set(
    sessions
      .filter((session) => session.id === activeSessionId || isActivePhase(session.runtime.phase))
      .map((session) => session.id),
  );
  const inactiveLimit = Math.max(0, MAX_SESSIONS - protectedSessionIds.size);
  let retainedInactive = 0;

  return sessions.filter((session) => {
    if (protectedSessionIds.has(session.id)) return true;
    if (retainedInactive >= inactiveLimit) return false;
    retainedInactive += 1;
    return true;
  });
}

function addSession(state: CommanderState, session: CommanderSession, select: boolean): void {
  state.sessions.unshift(session);
  if (select) state.activeSessionId = session.id;
  state.sessions = retainRecentSessions(state.sessions, state.activeSessionId);
  persistSessions(state.sessions);
}

export const commanderSlice = createSlice({
  name: 'commander',
  initialState,
  reducers: {
    toggleCommander(state) {
      state.open = !state.open;
      state.minimized = false;
    },
    setCommanderOpen(state, action: PayloadAction<boolean>) {
      state.open = action.payload;
      state.minimized = false;
    },
    focusAgentActivity(state, action: PayloadAction<{ sessionId: string; runId: string }>) {
      state.activityFocus = action.payload;
      state.open = true;
      state.minimized = false;
    },
    clearAgentActivityFocus(state) {
      state.activityFocus = null;
    },
    minimizeCommander(state) {
      if (state.open) state.minimized = true;
    },
    setProviderId(state, action: PayloadAction<string | null>) {
      state.providerId = action.payload;
      writePersistedProviderId(action.payload);
    },
    ensureSession(state, action: PayloadAction<{ id: string; defaultCanvasId: string | null }>) {
      if (!findSession(state, action.payload.id)) {
        addSession(
          state,
          createCommanderSession(action.payload.id, action.payload.defaultCanvasId),
          false,
        );
      }
    },
    ensureActiveSession(
      state,
      action: PayloadAction<{ id: string; defaultCanvasId: string | null }>,
    ) {
      if (!findSession(state, action.payload.id)) {
        addSession(
          state,
          createCommanderSession(action.payload.id, action.payload.defaultCanvasId),
          true,
        );
      } else {
        state.activeSessionId = action.payload.id;
      }
    },
    newSession: {
      reducer(
        state,
        action: PayloadAction<{ id: string; defaultCanvasId: string | null; createdAt: number }>,
      ) {
        addSession(
          state,
          createCommanderSession(
            action.payload.id,
            action.payload.defaultCanvasId,
            action.payload.createdAt,
          ),
          true,
        );
        state.open = true;
        state.minimized = false;
      },
      prepare(defaultCanvasId: string | null = null) {
        return {
          payload: { id: crypto.randomUUID(), defaultCanvasId, createdAt: Date.now() },
        };
      },
    },
    addUserMessage(state, action: PayloadAction<{ sessionId: string; content: string }>) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.messages.push({
        id: createMessageId('user'),
        role: 'user',
        content: action.payload.content,
        timestamp: Date.now(),
      });
      session.runtime.error = null;
      state.open = true;
      state.minimized = false;
      persistSession(state, session.id);
    },
    addInjectedMessage(state, action: PayloadAction<{ sessionId: string; content: string }>) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.runtime.pendingInjectedMessages.push(action.payload.content);
      persistSession(state, session.id);
    },
    startStreaming(state, action: PayloadAction<string>) {
      const session = findSession(state, action.payload);
      if (!session) return;
      const now = Date.now();
      session.runtime.phase = { kind: 'awaiting_model', step: 0, since: now };
      session.runtime.currentRunStartedAt = now;
      session.runtime.error = null;
      state.open = true;
      state.minimized = false;
      persistSession(state, session.id);
    },
    updateRunPhase(state, action: PayloadAction<{ sessionId: string; event: TimelineEvent }>) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.runtime.phase = phaseFromEvent(session.runtime.phase, action.payload.event);
    },
    appendFinalizedAssistantMessage(
      state,
      action: PayloadAction<{ sessionId: string; message: CommanderMessage; runId: string }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (!session || session.runtime.finalizedRunIds.includes(action.payload.runId)) return;
      session.messages.push(action.payload.message);
      session.runtime.finalizedRunIds.push(action.payload.runId);
      persistSession(state, session.id);
    },
    upsertFinalizedAssistantMessage(
      state,
      action: PayloadAction<{ sessionId: string; message: CommanderMessage; runId: string }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      const index = session.messages.findIndex(
        (message) => message.id === action.payload.message.id,
      );
      if (index >= 0) session.messages[index] = action.payload.message;
      else session.messages.push(action.payload.message);
      if (!session.runtime.finalizedRunIds.includes(action.payload.runId)) {
        session.runtime.finalizedRunIds.push(action.payload.runId);
      }
      persistSession(state, session.id);
    },
    finishStreaming(state, action: PayloadAction<string>) {
      const session = findSession(state, action.payload);
      if (!session) return;
      commitPendingInjectedMessages(session);
      resetTransientRunState(session.runtime);
      persistSession(state, session.id);
    },
    streamError(state, action: PayloadAction<{ sessionId: string; error: string }>) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      const completedAt = Date.now();
      const startedAt = session.runtime.currentRunStartedAt ?? completedAt;
      session.runtime.error = action.payload.error;
      session.messages.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: action.payload.error,
        runMeta: {
          status: 'failed',
          collapsed: true,
          startedAt,
          completedAt,
          summary: buildRunSummary(
            'failed',
            action.payload.error,
            undefined,
            [],
            startedAt,
            completedAt,
            action.payload.error,
          ),
        },
        timestamp: completedAt,
      });
      commitPendingInjectedMessages(session);
      resetTransientRunState(session.runtime);
      persistSession(state, session.id);
    },
    clearHistory(state, action: PayloadAction<string>) {
      const session = findSession(state, action.payload);
      if (!session) return;
      session.messages = [];
      session.runtime = createCommanderSessionRuntime();
      session.title = 'New session';
      persistSession(state, session.id);
    },
    loadSession(
      state,
      action: PayloadAction<{ id: string; hydratedMessages?: CommanderMessage[] }>,
    ) {
      const session = findSession(state, action.payload.id);
      if (!session) return;
      if (action.payload.hydratedMessages && session.messages.length === 0) {
        session.messages = action.payload.hydratedMessages;
        session.messageCount = action.payload.hydratedMessages.length;
      }
      state.activeSessionId = session.id;
      if (state.activityFocus?.sessionId !== session.id) state.activityFocus = null;
      state.open = true;
      state.minimized = false;
    },
    hydrateSessionMessages(
      state,
      action: PayloadAction<{ id: string; messages: CommanderMessage[] }>,
    ) {
      const session = findSession(state, action.payload.id);
      if (!session || session.messages.length === session.messageCount) return;
      session.messages = action.payload.messages;
      session.messageCount = action.payload.messages.length;
    },
    deleteSession(state, action: PayloadAction<string>) {
      state.sessions = state.sessions.filter((session) => session.id !== action.payload);
      if (state.activeSessionId === action.payload) state.activeSessionId = null;
      if (state.activityFocus?.sessionId === action.payload) state.activityFocus = null;
      persistSessions(state.sessions);
    },
    renameSession(state, action: PayloadAction<{ id: string; title: string }>) {
      const session = findSession(state, action.payload.id);
      if (!session) return;
      session.title = action.payload.title;
      session.updatedAt = Date.now();
      persistSessions(state.sessions);
    },
    moveSession(state, action: PayloadAction<{ id: string; defaultCanvasId: string | null }>) {
      const session = findSession(state, action.payload.id);
      if (!session) return;
      session.defaultCanvasId = action.payload.defaultCanvasId;
      session.updatedAt = Date.now();
      persistSessions(state.sessions);
    },
    unassignSessionsFromCanvas(state, action: PayloadAction<string>) {
      const now = Date.now();
      for (const session of state.sessions) {
        if (session.defaultCanvasId !== action.payload) continue;
        session.defaultCanvasId = null;
        session.updatedAt = now;
      }
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
    setRunResourceBudget(state, action: PayloadAction<RunResourceBudget>) {
      state.resourceBudget = normalizeRunResourceBudget(action.payload);
      persistSettingsFromState(state);
    },
    setTemperature(state, action: PayloadAction<number>) {
      const next = finiteNumber(action.payload);
      if (next === null) return;
      state.temperature = Math.max(0, next);
      persistSettingsFromState(state);
    },
    setContextWindowTokens(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.contextWindowTokens = normalizeContextWindowTokens(next);
      persistSettingsFromState(state);
    },
    setMaxOutputTokens(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.maxOutputTokens = normalizeMaxOutputTokens(next);
      persistSettingsFromState(state);
    },
    setAutoSaveDelayMs(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 0);
      if (next === null) return;
      state.autoSaveDelayMs = next;
      persistSettingsFromState(state);
    },
    setUndoGroupWindowMs(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 0);
      if (next === null) return;
      state.undoGroupWindowMs = next;
      persistSettingsFromState(state);
    },
    setClipboardWatchIntervalMs(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 0);
      if (next === null) return;
      state.clipboardWatchIntervalMs = next;
      persistSettingsFromState(state);
    },
    setClipboardMinLength(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 0);
      if (next === null) return;
      state.clipboardMinLength = next;
      persistSettingsFromState(state);
    },
    setGenerationConcurrency(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.generationConcurrency = next;
      persistSettingsFromState(state);
    },
    setQualityGateBehavior(state, action: PayloadAction<CommanderState['qualityGateBehavior']>) {
      state.qualityGateBehavior = action.payload;
      persistSettingsFromState(state);
    },
    setRequireStylePlateBeforeRefImage(state, action: PayloadAction<boolean>) {
      state.requireStylePlateBeforeRefImage = action.payload;
      persistSettingsFromState(state);
    },
    setMaxSessions(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.maxSessions = next;
      persistSettingsFromState(state);
    },
    setMaxMessagesPerSession(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.maxMessagesPerSession = next;
      persistSettingsFromState(state);
    },
    setUndoStackDepth(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.undoStackDepth = next;
      persistSettingsFromState(state);
    },
    setMaxLogEntries(state, action: PayloadAction<number>) {
      const next = wholeNumberAtLeast(action.payload, 1);
      if (next === null) return;
      state.maxLogEntries = next;
      persistSettingsFromState(state);
    },
    setConfirmAutoMode(
      state,
      action: PayloadAction<{
        sessionId: string;
        mode: CommanderSessionRuntime['confirmAutoMode'];
      }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.runtime.confirmAutoMode = action.payload.mode;
      if (action.payload.mode === 'none') session.runtime.consecutiveConfirmCount = 0;
    },
    recordConfirmationResolved(state, action: PayloadAction<string>) {
      const session = findSession(state, action.payload);
      if (session) session.runtime.consecutiveConfirmCount += 1;
    },
    setBackendContextUsage(
      state,
      action: PayloadAction<{ sessionId: string; usage: CommanderBackendContextUsage | null }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (session) session.runtime.backendContextUsage = action.payload.usage;
    },
    requestDurableMediaTask(_state, _action: PayloadAction<DurableMediaTaskRequest>) {},
    requestDurableMediaCancellation(
      _state,
      _action: PayloadAction<DurableMediaCancellationRequest>,
    ) {},
    enqueueMessage(
      state,
      action: PayloadAction<{ sessionId: string; content: string; extraCanvasIds?: string[] }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.runtime.messageQueue.push({
        id: createMessageId('queue'),
        content: action.payload.content,
        extraCanvasIds: action.payload.extraCanvasIds,
      });
      persistSession(state, session.id);
    },
    enqueueMediaPromptIntent(
      state,
      action: PayloadAction<{
        sessionId: string;
        content: string;
        intent: Extract<CommanderRunIntent, { kind: 'media_prompt_assembly' }>;
        extraCanvasIds?: string[];
      }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.runtime.messageQueue.push({
        id: createMessageId('queue'),
        content: action.payload.content,
        intent: action.payload.intent,
        extraCanvasIds: action.payload.extraCanvasIds,
      });
      persistSession(state, session.id);
    },
    dequeueMessage(state, action: PayloadAction<string>) {
      const session = findSession(state, action.payload);
      if (!session || session.runtime.messageQueueCursor >= session.runtime.messageQueue.length) {
        return;
      }
      session.runtime.messageQueueCursor += 1;
      compactMessageQueue(session.runtime);
      persistSession(state, session.id);
    },
    removeQueuedMessage(state, action: PayloadAction<{ sessionId: string; index: number }>) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      const index = session.runtime.messageQueueCursor + action.payload.index;
      if (
        index < session.runtime.messageQueueCursor ||
        index >= session.runtime.messageQueue.length
      ) {
        return;
      }
      session.runtime.messageQueue.splice(index, 1);
      persistSession(state, session.id);
    },
    editQueuedMessage(
      state,
      action: PayloadAction<{ sessionId: string; index: number; content: string }>,
    ) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      const item =
        session.runtime.messageQueue[session.runtime.messageQueueCursor + action.payload.index];
      if (item && !item.intent) item.content = action.payload.content;
      persistSession(state, session.id);
    },
    clearQueue(state, action: PayloadAction<string>) {
      const session = findSession(state, action.payload);
      if (!session) return;
      session.runtime.messageQueue = [];
      session.runtime.messageQueueCursor = 0;
      session.runtime.messageQueueFirstIndex = 0;
      persistSession(state, session.id);
    },
    addSystemNotice(state, action: PayloadAction<{ sessionId: string; content: string }>) {
      const session = findSession(state, action.payload.sessionId);
      if (!session) return;
      session.messages.push({
        id: createMessageId('system'),
        role: 'assistant',
        content: action.payload.content,
        timestamp: Date.now(),
      });
      persistSession(state, session.id);
    },
    compactLocalContext() {},
    restore(_state, action: PayloadAction<CommanderState>) {
      const sessions = action.payload.sessions.map((session) => ({
        ...session,
        messageCount:
          typeof session.messageCount === 'number' ? session.messageCount : session.messages.length,
        defaultCanvasId:
          typeof session.defaultCanvasId === 'string' ? session.defaultCanvasId : null,
        runtime: { ...createCommanderSessionRuntime(), ...session.runtime },
      }));
      return {
        ...initialState,
        ...action.payload,
        sessions,
        activeSessionId: sessions.some((session) => session.id === action.payload.activeSessionId)
          ? action.payload.activeSessionId
          : null,
        contextWindowTokens: normalizeContextWindowTokens(action.payload.contextWindowTokens),
        maxOutputTokens: normalizeMaxOutputTokens(action.payload.maxOutputTokens),
      };
    },
    loadSessionsFromDB(state, action: PayloadAction<CommanderSession[]>) {
      const localMap = new Map(state.sessions.map((session) => [session.id, session]));
      const dbMap = new Map(action.payload.map((session) => [session.id, session]));
      const merged: CommanderSession[] = [];
      for (const [id, dbSession] of dbMap) {
        const local = localMap.get(id);
        merged.push(
          local
            ? {
                ...dbSession,
                messages:
                  local.updatedAt >= dbSession.updatedAt &&
                  local.messages.length === local.messageCount &&
                  local.messageCount >= dbSession.messageCount
                    ? local.messages
                    : dbSession.messages,
                messageCount:
                  local.updatedAt >= dbSession.updatedAt &&
                  local.messages.length === local.messageCount &&
                  local.messageCount >= dbSession.messageCount
                    ? local.messageCount
                    : dbSession.messageCount,
                runtime: local.runtime,
              }
            : {
                ...dbSession,
                runtime: { ...createCommanderSessionRuntime(), ...dbSession.runtime },
              },
        );
      }
      for (const session of state.sessions) {
        if (!dbMap.has(session.id)) merged.push(session);
      }
      merged.sort((a, b) => b.updatedAt - a.updatedAt);
      state.sessions = retainRecentSessions(merged, state.activeSessionId);
    },
  },
});

export const {
  toggleCommander,
  setCommanderOpen,
  focusAgentActivity,
  clearAgentActivityFocus,
  minimizeCommander,
  setProviderId,
  ensureSession,
  ensureActiveSession,
  newSession,
  addUserMessage,
  addInjectedMessage,
  startStreaming,
  updateRunPhase,
  appendFinalizedAssistantMessage,
  upsertFinalizedAssistantMessage,
  finishStreaming,
  streamError,
  clearHistory,
  loadSession,
  hydrateSessionMessages,
  deleteSession,
  renameSession,
  moveSession,
  unassignSessionsFromCanvas,
  setPosition,
  setSize,
  setPermissionMode,
  setRunResourceBudget,
  setTemperature,
  setContextWindowTokens,
  setMaxOutputTokens,
  setMaxSessions,
  setMaxMessagesPerSession,
  setUndoStackDepth,
  setMaxLogEntries,
  setAutoSaveDelayMs,
  setUndoGroupWindowMs,
  setClipboardWatchIntervalMs,
  setClipboardMinLength,
  setGenerationConcurrency,
  setQualityGateBehavior,
  setRequireStylePlateBeforeRefImage,
  setConfirmAutoMode,
  recordConfirmationResolved,
  setBackendContextUsage,
  requestDurableMediaTask,
  requestDurableMediaCancellation,
  enqueueMessage,
  enqueueMediaPromptIntent,
  dequeueMessage,
  removeQueuedMessage,
  editQueuedMessage,
  clearQueue,
  addSystemNotice,
  compactLocalContext,
  loadSessionsFromDB,
} = commanderSlice.actions;

export { COMMANDER_PROVIDER_KEY };

type CommanderRoot = { commander: CommanderState };

const EMPTY_MESSAGES: CommanderMessage[] = [];
const EMPTY_QUEUE: CommanderSessionRuntime['messageQueue'] = [];
const EMPTY_INJECTED: string[] = [];

export const selectCommanderSessionById = (
  state: CommanderRoot,
  sessionId: string | null,
): CommanderSession | null =>
  sessionId ? (state.commander.sessions.find((session) => session.id === sessionId) ?? null) : null;

export const selectActiveCommanderSession = (state: CommanderRoot): CommanderSession | null =>
  selectCommanderSessionById(state, state.commander.activeSessionId);

export const selectIsStreaming = (state: CommanderRoot): boolean =>
  isActivePhase(selectActiveCommanderSession(state)?.runtime?.phase ?? idlePhase);

export const selectPhase = (state: CommanderRoot): RunPhase =>
  selectActiveCommanderSession(state)?.runtime?.phase ?? idlePhase;

export const selectActiveMessages = (state: CommanderRoot): CommanderMessage[] =>
  selectActiveCommanderSession(state)?.messages ?? EMPTY_MESSAGES;

export const selectCurrentRunStartedAt = (state: CommanderRoot): number | null =>
  selectActiveCommanderSession(state)?.runtime?.currentRunStartedAt ?? null;

export const selectBackendContextUsage = (
  state: CommanderRoot,
): CommanderBackendContextUsage | null =>
  selectActiveCommanderSession(state)?.runtime?.backendContextUsage ?? null;

export const selectPendingInjectedMessages = (state: CommanderRoot): string[] =>
  selectActiveCommanderSession(state)?.runtime?.pendingInjectedMessages ?? EMPTY_INJECTED;

export const selectConsecutiveConfirmCount = (state: CommanderRoot): number =>
  selectActiveCommanderSession(state)?.runtime?.consecutiveConfirmCount ?? 0;

export const selectMessageQueue = (state: CommanderRoot): CommanderSessionRuntime['messageQueue'] =>
  selectActiveCommanderSession(state)?.runtime?.messageQueue ?? EMPTY_QUEUE;

export const selectMessageQueueCursor = (state: CommanderRoot): number =>
  selectActiveCommanderSession(state)?.runtime?.messageQueueCursor ?? 0;

export const selectMessageQueueFirstIndex = (state: CommanderRoot): number =>
  selectActiveCommanderSession(state)?.runtime?.messageQueueFirstIndex ?? 0;
