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

export interface QueuedMessage {
  id: string;
  content: string;
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

/**
 * Phase E — surface the ExitDecision outcome on a completed run so the
 * MessageList can render a banner for non-satisfied outcomes. Missing means
 * the run came from a pre-Phase-E build or was cancelled before the
 * orchestrator could compute a decision (e.g. user hit stop).
 */
export interface CommanderExitDecisionMeta {
  outcome:
    | 'satisfied'
    | 'unsatisfied'
    | 'informational_answered'
    | 'blocked_waiting_user'
    | 'refused'
    | 'budget_exhausted'
    | 'error';
  contractId?: string;
  reason?: string;
  blockerKind?: string;
}

export interface CommanderRunMeta {
  status: CommanderRunStatus;
  collapsed: boolean;
  startedAt: number;
  completedAt: number;
  summary: CommanderRunSummary;
  exitDecision?: CommanderExitDecisionMeta;
  /**
   * Phase D/F — present only when the run ended via a `cancelled`
   * terminal event. `completedToolCalls` counts tools that got a real
   * `tool_result`; `pendingToolCalls` counts those that got a synthetic
   * orphan-cleanup result (or never got one at all). Renderer uses this
   * to surface a `<CancelledBanner>` above the summary.
   */
  cancelled?: {
    reason: 'user' | 'timeout' | 'error';
    partialContent?: string;
    completedToolCalls: number;
    pendingToolCalls: number;
  };
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
  error: string | null;
  /**
   * Run ids whose finalized assistant message has already been appended to
   * `messages`. Used by `appendFinalizedAssistantMessage` to dedup the
   * local-cancel + late-backend-run_end race (see D2b). Cleared on session
   * boundary transitions (newSession, loadSession, switchCanvas,
   * clearHistory, restore).
   */
  finalizedRunIds: string[];
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
  messageQueue: QueuedMessage[];
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
