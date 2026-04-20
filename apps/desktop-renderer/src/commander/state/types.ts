/**
 * `commander/state/types.ts` — Phase E split-1.
 *
 * Pure-data shapes for the commander slice. Extracted from the original
 * `store/slices/commander.ts` monolith so helpers/services can import them
 * without pulling in the createSlice runtime.
 *
 * No behavior change — these are the same types the slice already used.
 */

export interface CommanderToolCall {
  name: string;
  id: string;
  arguments: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  status: 'pending' | 'done' | 'error';
}

export type MessageSegmentId = string;

export type PhaseNoteKind = 'process_prompt_loaded' | 'compacted' | 'llm_retry';

export type MessageSegment =
  | { kind: 'text'; id: MessageSegmentId; content: string }
  | { kind: 'tool'; id: MessageSegmentId; toolCall: CommanderToolCall }
  | { kind: 'thinking'; id: MessageSegmentId; content: string; collapsed: boolean }
  | { kind: 'step_marker'; id: MessageSegmentId; step: number; at: number }
  | {
      kind: 'phase_note';
      id: MessageSegmentId;
      note: PhaseNoteKind;
      detail: string;
    };

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

export interface CommanderBackendContextUsage {
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
  /**
   * Fine-grained run state. Drives LiveActivityBar, elapsed timers, and
   * cursor gating. `idle` / `done` / `failed` mean "not currently streaming";
   * every other kind means the agent is doing something. Prefer the
   * `selectIsStreaming` selector over reading this directly.
   */
  phase: import('./run-phase.js').RunPhase;
  currentRunStartedAt: number | null;
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
  llmRetries: number;
  maxSessions: number;
  maxMessagesPerSession: number;
  undoStackDepth: number;
  maxLogEntries: number;
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
  backendContextUsage: CommanderBackendContextUsage | null;
}

export interface PersistedSettings {
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
