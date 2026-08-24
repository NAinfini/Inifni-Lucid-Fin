import type {
  CommanderErrorCode,
  CommanderQualityGateBehavior,
  CommanderRunIntent,
  PublicToolArtifact,
  PublicToolDetails,
  ResourceStateCause,
  RunBlocker,
  RunResourceBudget,
  RunResourceClock,
  RunResourceRemainder,
  RunResourceUsage,
} from '@lucid-fin/contracts';

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
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  summary?: string;
  details?: PublicToolDetails;
  artifacts?: PublicToolArtifact[];
  errorCode?: CommanderErrorCode;
  status: 'pending' | 'done' | 'error';
}

export interface QueuedMessage {
  id: string;
  content: string;
  intent?: Extract<CommanderRunIntent, { kind: 'media_prompt_assembly' }>;
  extraCanvasIds?: string[];
}

export type MessageSegmentId = string;

export type PhaseNoteKind =
  | 'process_prompt_loaded'
  | 'compacted'
  | 'llm_retry'
  | 'tool_skipped_dedup';

export type MessageSegment =
  | { kind: 'text'; id: MessageSegmentId; content: string }
  | { kind: 'tool'; id: MessageSegmentId; toolCall: CommanderToolCall }
  | {
      kind: 'progress';
      id: MessageSegmentId;
      operationId: string;
      status: 'running' | 'completed' | 'failed';
      summary?: string;
    }
  | {
      kind: 'resource_usage';
      id: MessageSegmentId;
      operationId: string;
      promptTokens?: number;
      completionTokens?: number;
      reasoningTokens?: number;
    }
  | {
      kind: 'resource_state';
      id: MessageSegmentId;
      cause: ResourceStateCause;
      usage: RunResourceUsage;
      remaining: RunResourceRemainder;
      clock: RunResourceClock;
    }
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
  previewAssetHash?: string;
}

export interface CommanderQuestionMeta {
  question: string;
  options: CommanderQuestionOption[];
}

export type CommanderRunStatus = 'completed' | 'failed' | 'blocked';

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
  /** Immutable run identity used to reopen the public activity tree from history. */
  runId?: string;
  status: CommanderRunStatus;
  collapsed: boolean;
  startedAt: number;
  completedAt: number;
  summary: CommanderRunSummary;
  exitDecision?: CommanderExitDecisionMeta;
  blocker?: RunBlocker;
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

export type PermissionMode = 'danger' | 'auto' | 'normal' | 'strict';

export interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  summary?: string;
  details?: PublicToolDetails;
  tier: number;
}

export interface PendingQuestion {
  toolCallId: string;
  question: string;
  options: CommanderQuestionOption[];
  allowFreeText: boolean;
}

export interface CommanderSession {
  id: string;
  defaultCanvasId: string | null;
  title: string;
  messages: CommanderMessage[];
  /** Persisted transcript size when messages are still lazy-loaded. */
  messageCount: number;
  runtime: CommanderSessionRuntime;
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

export interface CommanderSessionRuntime {
  phase: import('./run-phase.js').RunPhase;
  currentRunStartedAt: number | null;
  error: string | null;
  finalizedRunIds: string[];
  confirmAutoMode: 'none' | 'approve' | 'skip';
  consecutiveConfirmCount: number;
  messageQueue: QueuedMessage[];
  messageQueueCursor: number;
  messageQueueFirstIndex: number;
  pendingInjectedMessages: string[];
  backendContextUsage: CommanderBackendContextUsage | null;
}

export interface CommanderState {
  open: boolean;
  minimized: boolean;
  /** Ephemeral request to focus the shared public activity control for a run. */
  activityFocus?: { sessionId: string; runId: string } | null;
  providerId: string | null;
  activeSessionId: string | null;
  sessions: CommanderSession[];
  position: { x: number; y: number };
  size: { width: number; height: number };
  permissionMode: PermissionMode;
  resourceBudget: RunResourceBudget;
  temperature: number;
  contextWindowTokens: number;
  maxOutputTokens: number;
  maxSessions: number;
  maxMessagesPerSession: number;
  undoStackDepth: number;
  maxLogEntries: number;
  autoSaveDelayMs: number;
  undoGroupWindowMs: number;
  clipboardWatchIntervalMs: number;
  clipboardMinLength: number;
  generationConcurrency: number;
  qualityGateBehavior: CommanderQualityGateBehavior;
  requireStylePlateBeforeRefImage: boolean;
}

export interface PersistedSettings {
  permissionMode?: PermissionMode;
  resourceBudget?: RunResourceBudget;
  temperature?: number;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  maxSessions?: number;
  maxMessagesPerSession?: number;
  undoStackDepth?: number;
  maxLogEntries?: number;
  autoSaveDelayMs?: number;
  undoGroupWindowMs?: number;
  clipboardWatchIntervalMs?: number;
  clipboardMinLength?: number;
  generationConcurrency?: number;
  qualityGateBehavior?: CommanderQualityGateBehavior;
  requireStylePlateBeforeRefImage?: boolean;
}
