/**
 * Pure type shapes for Batch 9 — commander:*.
 *
 * Covers:
 *  - Commander run lifecycle and tool-control invoke handlers from
 *    `apps/desktop-main/src/ipc/handlers/commander.handlers.ts`
 *    (`commander:start`, run lookup/hydration) and `commander-meta.handlers.ts`
 *    (`commander:cancel`, `commander:inject-message`,
 *    `commander:tool:decision`, `commander:tool:answer`, `commander:compact`).
 *  - 4 push channels emitted from `commander-emit.ts` and
 *    `commander-tool-deps.ts`
 *    (`commander:stream`, `commander:canvas:dispatch`,
 *    `commander:entities:updated`, `commander:settings:dispatch`).
 *
 * Commander start returns a persisted run ACK; subsequent progress arrives
 * exclusively through the run-keyed event stream.
 *   - `CommanderStreamPayload` wraps a `TimelineEvent` in a v2
 *     `WireEnvelope` and is the only shape that rides `commander:stream`.
 */

// Re-export the canonical LLM provider runtime config so commander:start
// consumers can import the full provider shape from the channel barrel.
export type { LLMProviderRuntimeConfig } from '../../llm-provider.js';
import type { LLMProviderRuntimeConfig } from '../../llm-provider.js';
import type {
  PublicContextFact,
  PublicToolArtifact,
  PublicToolDetails,
  RunResourceBudget,
  TimelineEvent,
  CommanderWorkType,
} from '../../agent/timeline-event.js';
import type { CommanderErrorCode } from '../../agent/error-code.js';
import type { WireEnvelope } from '../../agent/wire-version.js';

export type CommanderQualityGateBehavior = 'warn-only' | 'auto-expand' | 'block-generation';

export type CommanderTaskListGuidePhase =
  | 'unbound'
  | 'production_plan_pending'
  | 'production_plan_revision'
  | 'style_exploration'
  | 'visual_constitution_pending'
  | 'preproduction'
  | 'media_generation'
  | 'assembly'
  | 'delivery_preparation'
  | 'delivery_pending'
  | 'delivery_approved'
  | 'blocked';

export type CommanderPromptGuideRetention = 'turn' | 'task_list' | 'discovery';

/** Shared hard limits for guide transport, storage, and context injection. */
export const COMMANDER_GUIDE_LIMITS = {
  maxCatalogItems: 96,
  maxCatalogChars: 300_000,
  maxContentChars: 48_000,
  maxPromptTemplateChars: 48_000,
  maxTaskSkillChars: 8_000,
  maxTaskListGuideChars: 12_000,
  maxUserGuideChars: 12_000,
  maxProcessPromptChars: 12_000,
  maxAutoInjectItems: 8,
  maxAutoInjectCharsPerGuide: 2_000,
  maxAutoInjectCharsTotal: 8_000,
  maxGuideGetIds: 2,
  maxGuideGetContentChars: 8_000,
  defaultGuideListItems: 100,
  maxGuideListItems: 100,
} as const;

/** Renderer-authored guide metadata used only for bounded context selection. */
export interface CommanderPromptGuide {
  id: string;
  name: string;
  content: string;
  autoInject?: boolean;
  autoInjectContent?: string;
  priority?: number;
  retention?: CommanderPromptGuideRetention;
  phases?: CommanderTaskListGuidePhase[];
}

export interface CommanderProcessBehaviorSettings {
  qualityGateBehavior?: CommanderQualityGateBehavior;
  requireStylePlateBeforeRefImage?: boolean;
}

export type CommanderAttachmentRole = 'reference';

/** A logical Asset library entry attached to this Commander turn. */
export interface CommanderAttachmentInput {
  assetEntryId: string;
  role: CommanderAttachmentRole;
}

/** Immutable attachment lineage persisted with the accepted run. */
export interface CommanderRunAttachment {
  ordinal: number;
  contentHash: string;
  role: CommanderAttachmentRole;
  originalName: string;
  mimeType: string;
}

/** Typed user or host intent accepted by Commander. Host intents are never
 * projected as user-authored chat messages. */
export type CommanderRunIntent =
  | { kind: 'user_message'; message: string }
  | {
      kind: 'media_prompt_assembly';
      taskListId: string;
      promptAssemblyId: string;
      nodeId: string;
      label: string;
    };

// ── commander:start (invoke) ─────────────────────────────────
export interface CommanderStartRequest {
  defaultCanvasId?: string;
  authorizedCanvasIds: string[];
  sessionId: string;
  intent: CommanderRunIntent;
  selectedNodes: Array<{ canvasId: string; nodeId: string }>;
  attachments?: CommanderAttachmentInput[];
  promptGuides?: CommanderPromptGuide[];
  customLLMProvider?: LLMProviderRuntimeConfig;
  permissionMode?: 'danger' | 'auto' | 'normal' | 'strict';
  locale?: string;
  resourceBudget?: RunResourceBudget;
  continuationOfRunId?: string;
  temperature?: number;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  defaultProviders?: Record<string, string>;
  processSettings?: CommanderProcessBehaviorSettings;
  workType?: CommanderWorkType;
  parentRunId?: string;
  retryOfRunId?: string;
  displayName?: string;
  objective?: string;
}
export interface CommanderStartResponse {
  runId: string;
  sessionId: string;
  acceptedAt: number;
}

export type CommanderRunStatus =
  | 'accepted'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'max_steps';

export interface CommanderRunRecord {
  id: string;
  sessionId: string;
  defaultCanvasId?: string;
  authorizedCanvasIds: string[];
  intent: string;
  workType: CommanderWorkType;
  parentRunId?: string;
  retryOfRunId?: string;
  displayName?: string;
  objective?: string;
  status: CommanderRunStatus;
  acceptedAt: number;
  startedAt?: number;
  completedAt?: number;
  lastSeq: number;
  errorText?: string;
  attachments: CommanderRunAttachment[];
}

export type PublicContextItem =
  | {
      kind: 'user_input';
      runId: string;
      seq: number;
      content: string;
    }
  | {
      kind: 'run_context';
      runId: string;
      seq: number;
      facts: PublicContextFact[];
    }
  | {
      kind: 'assistant_text';
      runId: string;
      step: number;
      content: string;
    }
  | {
      kind: 'tool_observation';
      runId: string;
      toolCallId: string;
      toolName: string;
      status: 'completed' | 'failed';
      summary?: string;
      details?: PublicToolDetails;
      artifacts?: PublicToolArtifact[];
      contextFacts?: PublicContextFact[];
    }
  | {
      kind: 'interaction';
      runId: string;
      seq: number;
      interaction: 'question' | 'answer' | 'confirmation';
      content?: string;
    }
  | {
      kind: 'terminal_summary';
      runId: string;
      status: 'completed' | 'failed' | 'cancelled' | 'blocked' | 'max_steps';
      summary?: string;
      errorCode?: CommanderErrorCode;
    };

export interface CommanderContextCacheRun {
  runId: string;
  acceptedAt: number;
  status: CommanderRunStatus;
  throughSeq: number;
  eventHash: string;
  items: PublicContextItem[];
}

export interface CommanderContextCache {
  kind: 'commander_context_cache';
  version: 2;
  projectorVersion: number;
  sessionId: string;
  runs: CommanderContextCacheRun[];
  projectionHash: string;
}

// ── commander:cancel (invoke) ────────────────────────────────
export interface CommanderCancelRequest {
  runId: string;
}
export type CommanderCancelResponse = void;

// ── commander:cancel-step (invoke) ───────────────────────────
export interface CommanderCancelStepRequest {
  runId: string;
}
export interface CommanderCancelStepResponse {
  /** `true` if a double-tap within 2s escalated this step-cancel to a full run cancel. */
  escalated: boolean;
}

// ── commander:inject-message (invoke) ────────────────────────
export interface CommanderInjectMessageRequest {
  runId: string;
  message: string;
}
export type CommanderInjectMessageResponse = void;

// ── commander:tool:decision (invoke) ─────────────────────────
export interface CommanderToolDecisionRequest {
  runId: string;
  sessionId: string;
  toolCallId: string;
  approved: boolean;
}

export type CommanderToolActionResponse =
  | {
      accepted: true;
      delivery: 'active_run' | 'task_list_continuation';
      taskListId?: string;
    }
  | {
      accepted: false;
      code: 'stale_run' | 'not_pending' | 'no_active_session' | 'already_resolved';
    };

export type CommanderToolDecisionResponse = CommanderToolActionResponse;

// ── commander:tool:answer (invoke) ───────────────────────────
export interface CommanderToolAnswerRequest {
  runId: string;
  sessionId: string;
  toolCallId: string;
  answer: string;
}
export type CommanderToolAnswerResponse = CommanderToolActionResponse;

// ── commander:compact (invoke) ───────────────────────────────
// Handler returns the orchestrator compact stats, plus a silent no-op result
// when the session has already ended (same shape, all zeros).
export interface CommanderCompactRequest {
  runId: string;
}
export interface CommanderCompactResponse {
  freedChars: number;
  messageCount: number;
  toolCount: number;
}

// ── commander:stream (push) — single source of truth (pure types) ──
/**
 * The `commander:stream` channel carries `TimelineEvent`s wrapped in a
 * v2 `WireEnvelope`. `CommanderStreamPayload` is the envelope that
 * actually rides the wire. The zod schema lives in
 * `@lucid-fin/contracts-parse`'s batch-09.
 */

/** v2 wire envelope payload for `commander:stream`. */
export type CommanderStreamPayload = WireEnvelope<TimelineEvent> & { sessionId: string };

export interface CommanderRunGetRequest {
  runId: string;
}
export type CommanderRunGetResponse = CommanderRunRecord;

export interface CommanderEventsHydrateRequest {
  runId: string;
  afterSeq: number;
}
export interface CommanderEventsHydrateResponse {
  run: CommanderRunRecord;
  events: TimelineEvent[];
}

export type CommanderRunControlAction =
  | 'message'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'cancel_step'
  | 'retry';

export type CommanderRunControlRequest =
  | { runId: string; action: 'message'; message: string }
  | {
      runId: string;
      action: Exclude<CommanderRunControlAction, 'message'>;
      message?: never;
    };

export type CommanderRunControlResponse =
  | {
      accepted: true;
      action: CommanderRunControlAction;
      runId: string;
      affectedRunIds: string[];
      retryRunId?: string;
    }
  | {
      accepted: false;
      action: CommanderRunControlAction;
      runId: string;
      affectedRunIds: string[];
      code: 'run_not_found' | 'runtime_unavailable' | 'invalid_state';
    };

export interface CommanderRunTreeRequest {
  sessionId: string;
}

export interface CommanderRunTreeResponse {
  sessionId: string;
  runs: CommanderRunRecord[];
}

// ── commander:canvas:dispatch (push) ─────────────────────────
// Emitted from `commander-emit.ts:200` when a mutating tool completes.
// Carries the canvasId plus a Canvas snapshot — the Canvas DTO stays
// `unknown` at this stage (Phase C will zodify it alongside the rest of the
// canvas DTO tree).
export interface CommanderCanvasDispatchPayload {
  canvasId: string;
  canvas: unknown;
}

// ── commander:entities:updated (push) ────────────────────────
export interface CommanderEntitiesUpdatedPayload {
  toolName: string;
}

// ── commander:settings:dispatch (push) ───────────────────────
// Emitted from multiple sites in `commander-tool-deps.ts`. The `action`
// string is an enum of provider-settings verbs; `payload` shape varies per
// action (providerId, baseUrl, model, etc.). Kept permissive at the contract
// layer — renderer-side reducers discriminate on `action` at runtime.
export interface CommanderSettingsDispatchPayload {
  action: string;
  payload?: unknown;
}
