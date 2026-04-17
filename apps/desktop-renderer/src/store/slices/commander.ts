import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
// eslint-disable-next-line no-restricted-imports -- Phase C (tool-compaction-class relocation) will fix this
import { getToolCompactionCategory } from '@lucid-fin/application/dist/agent/tool-compaction-class.js';

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

export interface CommanderQuestionOption {
  label: string;
  description?: string;
}

export interface CommanderQuestionMeta {
  question: string;
  options: CommanderQuestionOption[];
}

export type CommanderRunStatus = 'completed' | 'failed';

export interface CommanderRunSummary {
  excerpt: string;
  toolCount: number;
  failedToolCount: number;
  durationMs: number;
}

export interface CommanderRunMeta {
  status: CommanderRunStatus;
  collapsed: boolean;
  startedAt: number;
  completedAt: number;
  thinkingContent?: string;
  summary: CommanderRunSummary;
}

export interface CommanderMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  questionMeta?: CommanderQuestionMeta;
  runMeta?: CommanderRunMeta;
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
  options: CommanderQuestionOption[];
}

export interface CommanderSession {
  id: string;
  canvasId: string | null;
  title: string;
  messages: CommanderMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface CommanderState {
  open: boolean;
  minimized: boolean;
  providerId: string | null;
  /** The canvasId this Commander session is currently bound to. */
  activeCanvasId: string | null;
  activeSessionId: string | null;
  sessions: CommanderSession[];
  messages: CommanderMessage[];
  streaming: boolean;
  currentRunStartedAt: number | null;
  currentStreamContent: string;
  /** Model reasoning/thinking content for the current step (cleared on each new step). */
  currentThinkingContent: string;
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
  confirmAutoMode: 'none' | 'approve' | 'skip';
  consecutiveConfirmCount: number;
  messageQueue: string[];
  /** User messages injected during streaming — committed to messages[] when streaming finishes. */
  pendingInjectedMessages: string[];
  /** Backend-reported context usage (updated per LLM request). */
  backendContextUsage: {
    estimatedTokensUsed: number;
    contextWindowTokens: number;
    messageCount: number;
    systemPromptChars: number;
    toolSchemaChars: number;
    messageChars: number;
    cacheChars: number;
    cacheEntryCount: number;
    historyMessagesTrimmed: number;
    utilizationRatio: number;
  } | null;
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

function formatQuestionTranscript(question: string, options: CommanderQuestionOption[]): string {
  const optionLines = options.map((option) =>
    option.description ? `- ${option.label}: ${option.description}` : `- ${option.label}`,
  );

  return optionLines.length > 0 ? `${question}\n\n${optionLines.join('\n')}` : question;
}

function normalizeRunExcerpt(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function trimRunExcerpt(content: string): string {
  return content.length > 160 ? `${content.slice(0, 157)}...` : content;
}

function buildRunSummary(
  status: CommanderRunStatus,
  content: string,
  toolCalls: CommanderToolCall[],
  startedAt: number,
  completedAt: number,
  errorMessage?: string,
): CommanderRunSummary {
  const failedToolCount = toolCalls.filter((toolCall) => toolCall.status === 'error').length;
  const toolCount = toolCalls.length;
  const normalizedContent = normalizeRunExcerpt(content);
  const excerptSource =
    normalizedContent ||
    normalizeRunExcerpt(errorMessage ?? '') ||
    (toolCount > 0
      ? `${status === 'failed' ? 'Attempted' : 'Completed'} ${toolCount} tool call${toolCount === 1 ? '' : 's'}.`
      : status === 'failed'
        ? 'Run failed before producing output.'
        : 'Run completed.');

  return {
    excerpt: trimRunExcerpt(excerptSource),
    toolCount,
    failedToolCount,
    durationMs: Math.max(0, completedAt - startedAt),
  };
}

function finalizeCurrentRunMessage(
  state: CommanderState,
  status: CommanderRunStatus,
  fallbackContent?: string,
  errorMessage?: string,
): void {
  const content = state.currentStreamContent || fallbackContent || '';
  const hasThinking = state.currentThinkingContent.trim().length > 0;
  const hasSegments = state.currentSegments.length > 0;
  const hasTools = state.currentToolCalls.length > 0;

  if (!content && !hasTools && !hasThinking && !errorMessage) {
    return;
  }

  const completedAt = Date.now();
  const startedAt = state.currentRunStartedAt ?? completedAt;
  const segments: MessageSegment[] | undefined =
    hasSegments
      ? [...state.currentSegments]
      : content
        ? [{ type: 'text' as const, content }]
        : undefined;

  state.messages.push({
    id: createMessageId('assistant'),
    role: 'assistant',
    content,
    runMeta: {
      status,
      collapsed: true,
      startedAt,
      completedAt,
      thinkingContent: hasThinking ? state.currentThinkingContent : undefined,
      summary: buildRunSummary(status, content, state.currentToolCalls, startedAt, completedAt, errorMessage),
    },
    segments,
    toolCalls: hasTools ? [...state.currentToolCalls] : undefined,
    timestamp: completedAt,
  });
}

function persistCurrentSession(state: CommanderState): void {
  if (!hasUserMessage(state.messages)) {
    return;
  }

  if (!state.activeSessionId) {
    state.activeSessionId = crypto.randomUUID();
  }

  const now = Date.now();
  const existing = state.sessions.findIndex((session) => session.id === state.activeSessionId);
  const session: CommanderSession = {
    id: state.activeSessionId,
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

function resetTransientRunState(state: CommanderState): void {
  state.streaming = false;
  state.currentRunStartedAt = null;
  state.currentStreamContent = '';
  state.currentThinkingContent = '';
  state.currentToolCalls = [];
  state.currentSegments = [];
  state.confirmAutoMode = 'none';
  state.consecutiveConfirmCount = 0;
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

/** A session is worth saving only if the user actually sent at least one message. */
function hasUserMessage(messages: CommanderMessage[]): boolean {
  return messages.some((m) => m.role === 'user');
}

const persistedSettings = loadPersistedSettings();

const initialState: CommanderState = {
  open: false,
  minimized: false,
  providerId: loadPersistedProviderId(),
  activeCanvasId: null,
  activeSessionId: null,
  sessions: loadPersistedSessions(),
  messages: [],
  streaming: false,
  currentRunStartedAt: null,
  currentStreamContent: '',
  currentThinkingContent: '',
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
  confirmAutoMode: 'none',
  consecutiveConfirmCount: 0,
  messageQueue: [],
  pendingInjectedMessages: [],
  backendContextUsage: null,
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
      state.streaming = true;
      state.currentRunStartedAt = Date.now();
      state.currentStreamContent = '';
      state.currentThinkingContent = '';
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
      finalizeCurrentRunMessage(state, 'completed', action.payload);
      // Commit injected user messages (sent during streaming) in correct chronological order
      for (const msg of state.pendingInjectedMessages) {
        state.messages.push({
          id: createMessageId('user'),
          role: 'user',
          content: msg,
          timestamp: Date.now(),
        });
      }
      state.pendingInjectedMessages = [];
      resetTransientRunState(state);
      persistCurrentSession(state);
    },
    streamError(state, action: PayloadAction<string>) {
      state.error = action.payload;
      finalizeCurrentRunMessage(state, 'failed', action.payload, action.payload);
      // Commit injected user messages before the error notice
      for (const msg of state.pendingInjectedMessages) {
        state.messages.push({
          id: createMessageId('user'),
          role: 'user',
          content: msg,
          timestamp: Date.now(),
        });
      }
      state.pendingInjectedMessages = [];
      resetTransientRunState(state);
      persistCurrentSession(state);
    },
    clearHistory(state) {
      // Save current session before clearing
      persistCurrentSession(state);
      state.activeSessionId = null;
      state.messages = [];
      state.currentRunStartedAt = null;
      state.currentStreamContent = '';
      state.currentThinkingContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
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
      state.currentStreamContent = '';
      state.currentThinkingContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
      state.pendingConfirmation = null;
      state.pendingQuestion = null;
      state.confirmAutoMode = 'none';
      state.consecutiveConfirmCount = 0;
      state.pendingInjectedMessages = [];
      state.backendContextUsage = null;
    },
    /** Load a previous session. Pass hydratedMessages if fetched from DB. */
    loadSession(state, action: PayloadAction<{ id: string; hydratedMessages?: CommanderMessage[] }>) {
      const { id, hydratedMessages } = typeof action.payload === 'string'
        ? { id: action.payload, hydratedMessages: undefined }
        : action.payload;
      // Save current session first
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
      // Hydrate session messages from DB if provided and session was lazy-loaded
      if (hydratedMessages && session.messages.length === 0) {
        session.messages = hydratedMessages;
      }
      state.activeSessionId = session.id;
      state.activeCanvasId = session.canvasId;
      state.messages = session.messages;
      state.currentRunStartedAt = null;
      state.currentStreamContent = '';
      state.currentThinkingContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
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
      state.consecutiveConfirmCount++;
    },
    setConfirmAutoMode(state, action: PayloadAction<'none' | 'approve' | 'skip'>) {
      state.confirmAutoMode = action.payload;
      if (action.payload === 'none') {
        state.consecutiveConfirmCount = 0;
      }
    },
    setBackendContextUsage(state, action: PayloadAction<CommanderState['backendContextUsage']>) {
      state.backendContextUsage = action.payload;
    },
    setThinkingContent(state, action: PayloadAction<string>) {
      state.currentThinkingContent = action.payload;
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
    /**
     * Compact local message store to reclaim context space.
     *
     * Strategy (all applied unconditionally, in order):
     *  1. Mutation tools -> one-line summary, remove tool call entirely.
     *  2. Read/list tools -> merge all calls into ONE deduplicated list.
     *  3. Log-style tools -> paginate to last 20 entries.
     *  4. Remaining large results -> truncate.
     *  5. Old assistant text -> truncate.
     *  6. Still over budget -> drop oldest messages.
     */
    compactLocalContext(state) {
      const msgs = state.messages;
      if (msgs.length === 0) return;

      const msgChars = (m: CommanderMessage) => {
        let c = m.content.length;
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            c += JSON.stringify(tc.arguments).length;
            if (tc.result != null) {
              c += typeof tc.result === 'string' ? tc.result.length : JSON.stringify(tc.result).length;
            }
          }
        }
        return c;
      };
      const totalChars = () => state.messages.reduce((s, m) => s + msgChars(m), 0);

      const ctxWindowTokens = state.maxTokens || 200_000;
      const targetChars = Math.floor(ctxWindowTokens * 4 * 0.5);
      if (totalChars() <= targetChars) return;

      // Protect only the last user + last assistant message.
      const protectedIndices = new Set<number>();
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant' && !protectedIndices.has(i)) { protectedIndices.add(i); }
        if (msgs[i].role === 'user' && !protectedIndices.has(i)) { protectedIndices.add(i); break; }
      }

      // --- classify tools via typed lookup ---
      const classify = (name: string) => getToolCompactionCategory(name);

      // =================================================================
      // Step 1: Mutation tools -> one-line summary, remove tool call
      // =================================================================
      const summarize = (tc: CommanderToolCall): string => {
        const a = tc.arguments;
        const id = a.id ?? a.nodeId ?? a.snapshotId ?? a.presetId ?? '';
        const status = tc.status === 'error' ? 'FAILED' : 'done';
        const details: string[] = [];
        for (const [k, v] of Object.entries(a)) {
          if (['id', 'nodeId', 'snapshotId', 'presetId'].includes(k)) continue;
          if (v == null) continue;
          const s = typeof v === 'string' ? v : JSON.stringify(v);
          if (s.length > 60) continue;
          details.push(`${k}=${s}`);
          if (details.length >= 3) break;
        }
        const d = details.length > 0 ? ` (${details.join(', ')})` : '';
        return `[${status}] ${tc.name}${id ? ` ${id}` : ''}${d}`;
      };

      for (let i = 0; i < msgs.length; i++) {
        if (protectedIndices.has(i) || !msgs[i].toolCalls) continue;
        const summaries: string[] = [];
        msgs[i].toolCalls = msgs[i].toolCalls!.filter((tc) => {
          if (classify(tc.name) === 'mutation' && tc.result !== undefined) {
            summaries.push(summarize(tc));
            return false;
          }
          return true;
        });
        if (summaries.length > 0) {
          const block = summaries.join('\n');
          msgs[i].content = msgs[i].content ? `${msgs[i].content}\n${block}` : block;
        }
      }

      // =================================================================
      // Shared helpers
      // =================================================================
      const RESULT_TRIM_LIMIT = 400;
      const trimValue = (val: unknown, depth: number): unknown => {
        if (depth > 3) return '[…]';
        if (typeof val === 'string') return val.length > 200 ? val.slice(0, 150) + '…' : val;
        if (Array.isArray(val)) {
          if (val.length > 5) return [...val.slice(0, 5).map((v) => trimValue(v, depth + 1)), `… +${val.length - 5} more`];
          return val.map((v) => trimValue(v, depth + 1));
        }
        if (val && typeof val === 'object') {
          const r = val as Record<string, unknown>;
          const out: Record<string, unknown> = {};
          let kept = 0;
          for (const [k, v] of Object.entries(r)) {
            out[k] = trimValue(v, depth + 1);
            kept++;
            if (kept >= 8) { out['…'] = `+${Object.keys(r).length - kept} fields`; break; }
          }
          return out;
        }
        return val;
      };

      // =================================================================
      // Step 2: List tools -> merge all calls into ONE deduplicated list
      // =================================================================
      const extractList = (result: unknown): unknown[] | null => {
        if (Array.isArray(result)) return result;
        if (!result || typeof result !== 'object') return null;
        const r = result as Record<string, unknown>;
        // Try .data first, then walk all values
        if (Array.isArray(r.data)) return r.data;
        if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) {
          for (const v of Object.values(r.data as Record<string, unknown>)) {
            if (Array.isArray(v)) return v;
          }
        }
        for (const v of Object.values(r)) {
          if (Array.isArray(v)) return v;
        }
        return null;
      };
      const itemKey = (item: unknown): string | null => {
        if (!item || typeof item !== 'object') return null;
        const o = item as Record<string, unknown>;
        const k = o.id ?? o.hash ?? o.name ?? o.code;
        return k != null ? String(k) : null;
      };
      const isListTool = (n: string) => classify(n) === 'list';
      const isGetTool = (n: string) => { const c = classify(n); return c === 'get' || c === 'query'; };
      const isLogTool = (n: string) => classify(n) === 'log';

      // 2a: Merge list-tool results (deduplicated)
      const mergedLists = new Map<string, Map<string, unknown>>();
      const listLocs = new Map<string, Array<{ mi: number; ti: number }>>();

      for (let i = 0; i < msgs.length; i++) {
        if (!msgs[i].toolCalls) continue;
        for (let j = 0; j < msgs[i].toolCalls!.length; j++) {
          const tc = msgs[i].toolCalls![j];
          if (!isListTool(tc.name) || isLogTool(tc.name) || tc.result === undefined) continue;
          if (!listLocs.has(tc.name)) listLocs.set(tc.name, []);
          listLocs.get(tc.name)!.push({ mi: i, ti: j });

          const list = extractList(tc.result);
          if (!list) continue;
          if (!mergedLists.has(tc.name)) mergedLists.set(tc.name, new Map());
          const merged = mergedLists.get(tc.name)!;
          for (const item of list) {
            const k = itemKey(item) || `_idx_${merged.size}`;
            merged.set(k, item);
          }
        }
      }

      for (const [toolName, locations] of listLocs) {
        if (locations.length <= 1 && !mergedLists.has(toolName)) continue;
        const merged = mergedLists.get(toolName);
        if (!merged || merged.size === 0) continue;
        const arr = [...merged.values()];

        const last = locations[locations.length - 1];
        const removeKeys = new Set(locations.slice(0, -1).map((l) => `${l.mi}:${l.ti}`));
        for (let i = 0; i < msgs.length; i++) {
          if (!msgs[i].toolCalls) continue;
          msgs[i].toolCalls = msgs[i].toolCalls!.filter((_, j) => !removeKeys.has(`${i}:${j}`));
        }

        const lastMsg = msgs[last.mi];
        if (lastMsg?.toolCalls) {
          const tc = lastMsg.toolCalls.find((t) => t.name === toolName);
          if (tc) {
            tc.result = { success: true, data: arr.map((v) => trimValue(v, 0)), total: arr.length };
            tc.arguments = {};
          }
        }
      }

      // 2b: Get/read tools -> merge all results per tool name into ONE
      //     deduplicated collection (same strategy as list tools).
      //     e.g. 40 canvas.getNode calls → 1 tool call with merged array of nodes.
      //     Each entity keyed by id; later calls overwrite earlier ones (freshest wins).
      const extractEntity = (result: unknown): unknown => {
        if (!result || typeof result !== 'object') return result;
        const r = result as Record<string, unknown>;
        if (r.data && typeof r.data === 'object' && !Array.isArray(r.data)) return r.data;
        return result;
      };

      const mergedGets = new Map<string, Map<string, unknown>>();
      const getLocs = new Map<string, Array<{ mi: number; tcId: string }>>();

      for (let i = 0; i < msgs.length; i++) {
        if (!msgs[i].toolCalls) continue;
        for (const tc of msgs[i].toolCalls!) {
          if (!isGetTool(tc.name) || isLogTool(tc.name) || tc.result === undefined) continue;
          if (!getLocs.has(tc.name)) getLocs.set(tc.name, []);
          getLocs.get(tc.name)!.push({ mi: i, tcId: tc.id });

          const entity = extractEntity(tc.result);
          if (!entity || typeof entity !== 'object') continue;
          const ent = entity as Record<string, unknown>;
          const k = itemKey(ent) || tc.id;

          if (!mergedGets.has(tc.name)) mergedGets.set(tc.name, new Map());
          mergedGets.get(tc.name)!.set(k, ent);
        }
      }

      for (const [toolName, locations] of getLocs) {
        if (locations.length <= 1 && !mergedGets.has(toolName)) continue;
        const merged = mergedGets.get(toolName);
        if (!merged || merged.size === 0) continue;
        const arr = [...merged.values()].map((v) => trimValue(v, 0));

        // Remove all but the last call
        const removeIds = new Set(locations.slice(0, -1).map((l) => l.tcId));
        if (removeIds.size > 0) {
          for (let i = 0; i < msgs.length; i++) {
            if (!msgs[i].toolCalls) continue;
            msgs[i].toolCalls = msgs[i].toolCalls!.filter((tc) => !removeIds.has(tc.id));
          }
        }

        // Replace the last call's result with merged + trimmed collection
        const lastTcId = locations[locations.length - 1].tcId;
        for (const m of msgs) {
          if (!m.toolCalls) continue;
          const tc = m.toolCalls.find((t) => t.id === lastTcId);
          if (tc) {
            tc.result = { success: true, data: arr, total: arr.length };
            tc.arguments = {};
            break;
          }
        }
      }

      // =================================================================
      // Step 3: Log-style tools -> deduplicate calls + paginate to 20
      // =================================================================
      // 3a: Keep only the last call per log tool name
      const logToolCalls = new Map<string, Array<{ mi: number; tcId: string }>>();
      for (let i = 0; i < msgs.length; i++) {
        if (!msgs[i].toolCalls) continue;
        for (const tc of msgs[i].toolCalls!) {
          if (!isLogTool(tc.name) || tc.result === undefined) continue;
          if (!logToolCalls.has(tc.name)) logToolCalls.set(tc.name, []);
          logToolCalls.get(tc.name)!.push({ mi: i, tcId: tc.id });
        }
      }
      for (const [, locs] of logToolCalls) {
        if (locs.length <= 1) continue;
        const removeIds = new Set(locs.slice(0, -1).map((l) => l.tcId));
        for (let i = 0; i < msgs.length; i++) {
          if (!msgs[i].toolCalls) continue;
          msgs[i].toolCalls = msgs[i].toolCalls!.filter((tc) => !removeIds.has(tc.id));
        }
      }

      // 3b: Paginate remaining log tools to last 20 entries + trim each entry
      for (let i = 0; i < msgs.length; i++) {
        if (protectedIndices.has(i) || !msgs[i].toolCalls) continue;
        for (const tc of msgs[i].toolCalls!) {
          if (!isLogTool(tc.name) || tc.result === undefined) continue;
          const list = extractList(tc.result);
          if (!list) continue;
          const trimmed = list.slice(-20).map((entry) => trimValue(entry, 0));
          tc.result = { success: true, data: trimmed, total: list.length, showing: Math.min(list.length, 20) };
        }
      }

      // =================================================================
      // Step 4: Truncate large results + deeply trim nested objects
      // =================================================================
      for (let i = 0; i < msgs.length; i++) {
        if (protectedIndices.has(i) || !msgs[i].toolCalls) continue;
        for (const tc of msgs[i].toolCalls!) {
          if (tc.result !== undefined) {
            const len = (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result)).length;
            if (len > RESULT_TRIM_LIMIT) {
              tc.result = trimValue(tc.result, 0);
            }
          }
          if (JSON.stringify(tc.arguments).length > 200) {
            tc.arguments = { _compacted: true };
          }
        }
      }

      // =================================================================
      // Step 5: Truncate old assistant text
      // =================================================================
      for (let i = 0; i < msgs.length; i++) {
        if (protectedIndices.has(i)) continue;
        if (msgs[i].role === 'assistant' && msgs[i].content.length > 300) {
          msgs[i].content = msgs[i].content.slice(0, 200) + '… [compacted]';
        }
      }

      // =================================================================
      // Step 6: Drop oldest messages if still over budget
      // =================================================================
      let current = totalChars();
      if (current > targetChars) {
        const toRemove: number[] = [];
        for (let i = 0; i < state.messages.length && current > targetChars; i++) {
          if (protectedIndices.has(i)) continue;
          current -= msgChars(state.messages[i]);
          toRemove.push(i);
        }
        if (toRemove.length > 0) {
          const removeSet = new Set(toRemove);
          state.messages = state.messages.filter((_, idx) => !removeSet.has(idx));
        }
      }
    },
    restore(_state, action: PayloadAction<CommanderState>) {
      return {
        ...initialState,
        ...action.payload,
        streaming: false,
        currentRunStartedAt: null,
        currentStreamContent: '',
        currentThinkingContent: '',
        currentToolCalls: [],
        currentSegments: [],
        error: null,
        permissionMode: action.payload.permissionMode ?? 'normal',
        maxSteps: action.payload.maxSteps ?? DEFAULT_MAX_STEPS,
        temperature: action.payload.temperature ?? DEFAULT_TEMPERATURE,
        maxTokens: action.payload.maxTokens ?? DEFAULT_MAX_TOKENS,
        pendingConfirmation: null,
        pendingQuestion: null,
        confirmAutoMode: 'none',
        consecutiveConfirmCount: 0,
        messageQueue: [],
      };
    },
    /** Merge sessions loaded from SQLite into in-memory list. DB wins on conflict,
     *  but preserves in-memory messages if the DB version was lazy-loaded (empty). */
    loadSessionsFromDB(state, action: PayloadAction<CommanderSession[]>) {
      const localMap = new Map(state.sessions.map((s) => [s.id, s]));
      const dbMap = new Map(action.payload.map((s) => [s.id, s]));
      const merged: CommanderSession[] = [];
      for (const [id, dbSession] of dbMap) {
        const local = localMap.get(id);
        // DB session has lazy-loaded empty messages — prefer local messages if available
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
      // Noop if same canvas
      if (newCanvasId === state.activeCanvasId) return;

      // 1. Save current session (if it has user messages)
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

      // 2. Update canvas binding
      state.activeCanvasId = newCanvasId;

      // 3. Try to load the most recent session for the new canvas
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

      // 4. Reset transient state
      state.currentRunStartedAt = null;
      state.currentStreamContent = '';
      state.currentThinkingContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
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
  setConfirmAutoMode,
  setBackendContextUsage,
  setThinkingContent,
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
