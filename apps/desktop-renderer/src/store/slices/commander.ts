import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface CommanderToolCall {
  name: string;
  id: string;
  arguments: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  status: 'pending' | 'done' | 'error';
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolCall: CommanderToolCall };

export interface CommanderMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  segments?: MessageSegment[];
  toolCalls?: CommanderToolCall[];
  timestamp: number;
}

export type PermissionMode = 'auto' | 'normal' | 'strict';

export interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  tier: number;
}

export interface PendingQuestion {
  toolCallId: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
}

export interface CommanderSession {
  id: string;
  title: string;
  messages: CommanderMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CommanderState {
  open: boolean;
  minimized: boolean;
  providerId: string | null;
  activeSessionId: string | null;
  sessions: CommanderSession[];
  messages: CommanderMessage[];
  streaming: boolean;
  currentStreamContent: string;
  currentToolCalls: CommanderToolCall[];
  currentSegments: MessageSegment[];
  error: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  permissionMode: PermissionMode;
  maxSteps: number;
  temperature: number;
  maxTokens: number;
  // AI / network
  llmRetries: number;
  // Storage / data
  maxSessions: number;
  maxMessagesPerSession: number;
  undoStackDepth: number;
  maxLogEntries: number;
  // Behavior
  autoSaveDelayMs: number;
  undoGroupWindowMs: number;
  clipboardWatchIntervalMs: number;
  clipboardMinLength: number;
  generationConcurrency: number;
  pendingConfirmation: PendingConfirmation | null;
  pendingQuestion: PendingQuestion | null;
  messageQueue: string[];
}

const COMMANDER_PROVIDER_KEY = 'lucid-commander-provider-v1';
const COMMANDER_SESSIONS_KEY = 'lucid-commander-sessions-v1';
const COMMANDER_SETTINGS_KEY = 'lucid-commander-settings-v1';
const MAX_SESSIONS = 50;
/** Max messages kept per session in localStorage to avoid hitting the 5 MB quota. */
const MAX_MESSAGES_PER_SESSION = 200;
/** Approx byte budget for the serialised session blob (4 MB leaves headroom). */
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;

const DEFAULT_MAX_STEPS = 50;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 200000;
const DEFAULT_LLM_RETRIES = 2;
const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_MESSAGES_PER_SESSION = 200;
const DEFAULT_UNDO_STACK_DEPTH = 100;
const DEFAULT_MAX_LOG_ENTRIES = 500;
const DEFAULT_AUTO_SAVE_DELAY_MS = 500;
const DEFAULT_UNDO_GROUP_WINDOW_MS = 300;
const DEFAULT_CLIPBOARD_WATCH_INTERVAL_MS = 1500;
const DEFAULT_CLIPBOARD_MIN_LENGTH = 100;
const DEFAULT_GENERATION_CONCURRENCY = 1;

function loadPersistedProviderId(): string | null {
  try {
    return localStorage.getItem(COMMANDER_PROVIDER_KEY);
  } catch { /* localStorage unavailable — no persisted provider */
    return null;
  }
}

interface PersistedSettings {
  permissionMode?: PermissionMode;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  llmRetries?: number;
  maxSessions?: number;
  maxMessagesPerSession?: number;
  undoStackDepth?: number;
  maxLogEntries?: number;
  autoSaveDelayMs?: number;
  undoGroupWindowMs?: number;
  clipboardWatchIntervalMs?: number;
  clipboardMinLength?: number;
  generationConcurrency?: number;
}

function loadPersistedSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(COMMANDER_SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PersistedSettings;
  } catch { /* malformed JSON or localStorage unavailable — use defaults */
    return {};
  }
}

function persistSettings(settings: PersistedSettings): void {
  try {
    localStorage.setItem(COMMANDER_SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* localStorage unavailable */
  }
}

function persistSettingsFromState(state: CommanderState): void {
  persistSettings({
    permissionMode: state.permissionMode,
    maxSteps: state.maxSteps,
    temperature: state.temperature,
    maxTokens: state.maxTokens,
    llmRetries: state.llmRetries,
    maxSessions: state.maxSessions,
    maxMessagesPerSession: state.maxMessagesPerSession,
    undoStackDepth: state.undoStackDepth,
    maxLogEntries: state.maxLogEntries,
    autoSaveDelayMs: state.autoSaveDelayMs,
    undoGroupWindowMs: state.undoGroupWindowMs,
    clipboardWatchIntervalMs: state.clipboardWatchIntervalMs,
    clipboardMinLength: state.clipboardMinLength,
    generationConcurrency: state.generationConcurrency,
  });
}

function loadPersistedSessions(): CommanderSession[] {
  try {
    const raw = localStorage.getItem(COMMANDER_SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CommanderSession[];
  } catch { /* malformed JSON or localStorage unavailable — start with empty sessions */
    return [];
  }
}

function trimSessionForStorage(session: CommanderSession): CommanderSession {
  if (session.messages.length <= MAX_MESSAGES_PER_SESSION) return session;
  return {
    ...session,
    messages: session.messages.slice(-MAX_MESSAGES_PER_SESSION),
  };
}

function persistSessions(sessions: CommanderSession[]): void {
  const trimmed = sessions.slice(0, MAX_SESSIONS).map(trimSessionForStorage);
  try {
    const json = JSON.stringify(trimmed);
    if (json.length > MAX_STORAGE_BYTES) {
      // Drop oldest sessions until we fit
      let shrunk = trimmed;
      while (shrunk.length > 1 && JSON.stringify(shrunk).length > MAX_STORAGE_BYTES) {
        shrunk = shrunk.slice(0, -1);
      }
      localStorage.setItem(COMMANDER_SESSIONS_KEY, JSON.stringify(shrunk));
      return;
    }
    localStorage.setItem(COMMANDER_SESSIONS_KEY, json);
  } catch { /* QuotaExceededError — evict oldest half and retry once */
    // QuotaExceededError — evict oldest half and retry once
    try {
      const halved = trimmed.slice(0, Math.max(1, Math.floor(trimmed.length / 2)));
      localStorage.setItem(COMMANDER_SESSIONS_KEY, JSON.stringify(halved));
    } catch { /* localStorage completely full — clear sessions to prevent data loss elsewhere */
      // Completely full — clear sessions to prevent data loss elsewhere
      try { localStorage.removeItem(COMMANDER_SESSIONS_KEY); } catch { /* noop */ }
    }
  }
}

function deriveSessionTitle(messages: CommanderMessage[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New session';
  const text = firstUserMsg.content.trim();
  return text.length > 60 ? text.slice(0, 57) + '...' : text;
}

const persistedSettings = loadPersistedSettings();

const initialState: CommanderState = {
  open: false,
  minimized: false,
  providerId: loadPersistedProviderId(),
  activeSessionId: null,
  sessions: loadPersistedSessions(),
  messages: [],
  streaming: false,
  currentStreamContent: '',
  currentToolCalls: [],
  currentSegments: [],
  error: null,
  position: { x: 24, y: 96 },
  size: { width: 400, height: 500 },
  permissionMode: persistedSettings.permissionMode ?? 'normal',
  maxSteps: persistedSettings.maxSteps ?? DEFAULT_MAX_STEPS,
  temperature: persistedSettings.temperature ?? DEFAULT_TEMPERATURE,
  maxTokens: persistedSettings.maxTokens ?? DEFAULT_MAX_TOKENS,
  llmRetries: persistedSettings.llmRetries ?? DEFAULT_LLM_RETRIES,
  maxSessions: persistedSettings.maxSessions ?? DEFAULT_MAX_SESSIONS,
  maxMessagesPerSession: persistedSettings.maxMessagesPerSession ?? DEFAULT_MAX_MESSAGES_PER_SESSION,
  undoStackDepth: persistedSettings.undoStackDepth ?? DEFAULT_UNDO_STACK_DEPTH,
  maxLogEntries: persistedSettings.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES,
  autoSaveDelayMs: persistedSettings.autoSaveDelayMs ?? DEFAULT_AUTO_SAVE_DELAY_MS,
  undoGroupWindowMs: persistedSettings.undoGroupWindowMs ?? DEFAULT_UNDO_GROUP_WINDOW_MS,
  clipboardWatchIntervalMs: persistedSettings.clipboardWatchIntervalMs ?? DEFAULT_CLIPBOARD_WATCH_INTERVAL_MS,
  clipboardMinLength: persistedSettings.clipboardMinLength ?? DEFAULT_CLIPBOARD_MIN_LENGTH,
  generationConcurrency: persistedSettings.generationConcurrency ?? DEFAULT_GENERATION_CONCURRENCY,
  pendingConfirmation: null,
  pendingQuestion: null,
  messageQueue: [],
};

function createMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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
      try {
        if (action.payload) {
          localStorage.setItem(COMMANDER_PROVIDER_KEY, action.payload);
        } else {
          localStorage.removeItem(COMMANDER_PROVIDER_KEY);
        }
      } catch { /* localStorage unavailable */
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
    startStreaming(state) {
      state.streaming = true;
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.open = true;
      state.minimized = false;
    },
    appendStreamChunk(state, action: PayloadAction<string>) {
      state.currentStreamContent += action.payload;
      // Append to last text segment or create new one
      const last = state.currentSegments[state.currentSegments.length - 1];
      if (last && last.type === 'text') {
        last.content += action.payload;
      } else {
        state.currentSegments.push({ type: 'text', content: action.payload });
      }
    },
    addToolCall(
      state,
      action: PayloadAction<{
        name: string;
        id: string;
        arguments: Record<string, unknown>;
        startedAt?: number;
      }>,
    ) {
      const tc: CommanderToolCall = {
        name: action.payload.name,
        id: action.payload.id,
        arguments: action.payload.arguments,
        startedAt: action.payload.startedAt ?? Date.now(),
        status: 'pending',
      };
      state.currentToolCalls.push(tc);
      state.currentSegments.push({ type: 'tool', toolCall: tc });
    },
    resolveToolCall(
      state,
      action: PayloadAction<{
        id: string;
        result?: unknown;
        error?: string;
        completedAt?: number;
      }>,
    ) {
      const toolCall = state.currentToolCalls.find((entry) => entry.id === action.payload.id);
      if (!toolCall) {
        return;
      }
      toolCall.result = action.payload.error ?? action.payload.result;
      toolCall.status = action.payload.error ? 'error' : 'done';
      toolCall.completedAt = action.payload.completedAt ?? Date.now();
      // Also update in segments
      const seg = state.currentSegments.find(
        (s) => s.type === 'tool' && s.toolCall.id === action.payload.id,
      );
      if (seg && seg.type === 'tool') {
        seg.toolCall.result = toolCall.result;
        seg.toolCall.status = toolCall.status;
        seg.toolCall.completedAt = toolCall.completedAt;
      }
    },
    finishStreaming(state, action: PayloadAction<string | undefined>) {
      const content = state.currentStreamContent || action.payload || '';
      if (content || state.currentToolCalls.length > 0) {
        state.messages.push({
          id: createMessageId('assistant'),
          role: 'assistant',
          content,
          segments: state.currentSegments.length > 0 ? [...state.currentSegments] : undefined,
          toolCalls: state.currentToolCalls.length > 0 ? [...state.currentToolCalls] : undefined,
          timestamp: Date.now(),
        });
      }
      state.streaming = false;
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      // Auto-save session
      if (state.messages.length > 0) {
        if (!state.activeSessionId) {
          state.activeSessionId = crypto.randomUUID();
        }
        const now = Date.now();
        const existing = state.sessions.findIndex((s) => s.id === state.activeSessionId);
        const session: CommanderSession = {
          id: state.activeSessionId!,
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
    },
    streamError(state, action: PayloadAction<string>) {
      state.error = action.payload;
      state.streaming = false;
      // Persist the error as a visible message so it survives the next
      // addUserMessage clearing state.error.
      state.messages.push({
        id: createMessageId('error'),
        role: 'assistant',
        content: `⚠️ ${action.payload}`,
        timestamp: Date.now(),
      });
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
    },
    clearHistory(state) {
      // Save current session before clearing
      if (state.messages.length > 0) {
        const now = Date.now();
        const sessionId = state.activeSessionId ?? crypto.randomUUID();
        const existing = state.sessions.findIndex((s) => s.id === sessionId);
        const session: CommanderSession = {
          id: sessionId,
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
      state.activeSessionId = null;
      state.messages = [];
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
    },
    /** Start a new session (save current first) */
    newSession(state) {
      if (state.messages.length > 0) {
        const now = Date.now();
        const sessionId = state.activeSessionId ?? crypto.randomUUID();
        const existing = state.sessions.findIndex((s) => s.id === sessionId);
        const session: CommanderSession = {
          id: sessionId,
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
      state.activeSessionId = null;
      state.messages = [];
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
    },
    /** Load a previous session */
    loadSession(state, action: PayloadAction<string>) {
      // Save current session first
      if (state.messages.length > 0 && state.activeSessionId) {
        const existing = state.sessions.findIndex((s) => s.id === state.activeSessionId);
        if (existing >= 0) {
          state.sessions[existing].messages = state.messages;
          state.sessions[existing].updatedAt = Date.now();
          persistSessions(state.sessions);
        }
      }
      const session = state.sessions.find((s) => s.id === action.payload);
      if (!session) return;
      state.activeSessionId = session.id;
      state.messages = session.messages;
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
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
      state.maxTokens = Math.max(1024, Math.min(1_000_000, Math.round(action.payload / 1024) * 1024));
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
      state.clipboardWatchIntervalMs = Math.max(500, Math.min(10000, Math.round(action.payload / 500) * 500));
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
      // Record the question as an assistant message
      const optionList = options.map((o) => `  • ${o.label}${o.description ? ` — ${o.description}` : ''}`).join('\n');
      state.messages.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: `**Question:** ${question}\n${optionList}`,
        timestamp: Date.now(),
      });
      // Record the user's answer
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
    /** Compact local message store: truncate old tool results + remove old assistant text bulk. */
    compactLocalContext(state) {
      // Find assistant messages with toolCalls, protect the last 3 groups
      const groupIndices: number[] = [];
      for (let i = 0; i < state.messages.length; i++) {
        if (state.messages[i].toolCalls && state.messages[i].toolCalls!.length > 0) {
          groupIndices.push(i);
        }
      }
      const protectedFrom = Math.max(0, groupIndices.length - 3);
      const protectedSet = new Set(groupIndices.slice(protectedFrom));

      for (let i = 0; i < state.messages.length; i++) {
        const msg = state.messages[i];

        // Truncate old assistant text (not in recent groups)
        if (msg.role === 'assistant' && !protectedSet.has(i) && msg.content.length > 500) {
          msg.content = msg.content.slice(0, 200) + '... [compacted]';
        }

        if (!msg.toolCalls || protectedSet.has(i)) continue;
        for (const tc of msg.toolCalls) {
          if (tc.result === undefined) continue;
          const resStr = typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
          if (resStr.length <= 300) continue;
          // Compact: keep status + minimal info
          if (typeof tc.result === 'object' && tc.result !== null && !Array.isArray(tc.result)) {
            const r = tc.result as Record<string, unknown>;
            const compact: Record<string, unknown> = { success: r.success ?? true };
            if (r.error) compact.error = String(r.error).slice(0, 120);
            else compact.data = '[compacted]';
            tc.result = compact;
          } else {
            tc.result = { success: true, data: '[compacted]' };
          }
        }
      }
    },
    restore(_state, action: PayloadAction<CommanderState>) {
      return {
        ...initialState,
        ...action.payload,
        permissionMode: action.payload.permissionMode ?? 'normal',
        maxSteps: action.payload.maxSteps ?? DEFAULT_MAX_STEPS,
        temperature: action.payload.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: action.payload.maxTokens ?? DEFAULT_MAX_TOKENS,
        pendingConfirmation: null,
        pendingQuestion: null,
        messageQueue: [],
      };
    },
    /** Merge sessions loaded from SQLite into in-memory list. DB wins on conflict. */
    loadSessionsFromDB(state, action: PayloadAction<CommanderSession[]>) {
      const dbMap = new Map(action.payload.map((s) => [s.id, s]));
      const merged: CommanderSession[] = [...dbMap.values()];
      for (const s of state.sessions) {
        if (!dbMap.has(s.id)) merged.push(s);
      }
      merged.sort((a, b) => b.updatedAt - a.updatedAt);
      state.sessions = merged.slice(0, MAX_SESSIONS);
    },
  },
});

export const {
  toggleCommander,
  setCommanderOpen,
  minimizeCommander,
  setProviderId,
  addUserMessage,
  startStreaming,
  appendStreamChunk,
  addToolCall,
  resolveToolCall,
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
} = commanderSlice.actions;
