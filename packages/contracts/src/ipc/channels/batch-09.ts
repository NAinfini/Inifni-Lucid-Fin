/**
 * Pure type shapes for Batch 9 — commander:*.
 *
 * Covers:
 *  - 8 invoke handlers from
 *    `apps/desktop-main/src/ipc/handlers/commander.handlers.ts`
 *    (`commander:chat`) and `commander-meta.handlers.ts`
 *    (`commander:cancel`, `commander:inject-message`,
 *    `commander:tool:decision`, `commander:tool:answer`,
 *    `commander:compact`, `commander:tool-list`, `commander:tool-search`).
 *  - 5 push channels emitted from `commander-emit.ts` and
 *    `commander-tool-deps.ts`
 *    (`commander:stream`, `commander:canvas:dispatch`,
 *    `commander:entities:updated`, `commander:settings:dispatch`,
 *    `commander:undo:dispatch`).
 *
 * Batch 9 also closes Phase B-2 ("commander:chat/stream alignment"):
 *   - `CommanderChatRequest` carries every field the handler accepts.
 *   - `CommanderStreamPayload` wraps a `TimelineEvent` in a v2
 *     `WireEnvelope` and is the only shape that rides `commander:stream`.
 */

// `HistoryEntry` mirrors the type from `@lucid-fin/application`
// (`packages/application/src/agent/context-manager.ts`). The contracts package
// must not import from application (dependency direction is app → contracts),
// so the shape is duplicated here and kept in sync manually. A compile-time
// assertion linking the two is tracked for a future phase.
export type HistoryEntry =
  | {
      role: 'user' | 'assistant';
      content: string;
      reasoning?: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        thoughtSignature?: string;
      }>;
    }
  | { role: 'tool'; content: string; toolCallId: string };

// Re-export the canonical LLM provider runtime config so commander:chat
// consumers can import the full provider shape from the channel barrel.
export type { LLMProviderRuntimeConfig } from '../../llm-provider.js';
import type { LLMProviderRuntimeConfig } from '../../llm-provider.js';
import type { TimelineEvent } from '../../agent/timeline-event.js';
import type { WireEnvelope } from '../../agent/wire-version.js';

export type CommanderQualityGateBehavior = 'warn-only' | 'auto-expand' | 'block-generation';

export type CommanderWorkflowGuidePhase =
  | 'unbound'
  | 'production_plan_pending'
  | 'production_plan_revision'
  | 'style_exploration'
  | 'visual_constitution_pending'
  | 'preproduction'
  | 'media_generation'
  | 'assembly'
  | 'final_export_preparation'
  | 'final_export_pending'
  | 'final_export_approved'
  | 'blocked';

export type CommanderPromptGuideRetention = 'turn' | 'workflow' | 'discovery';

/** Shared hard limits for guide transport, storage, and context injection. */
export const COMMANDER_GUIDE_LIMITS = {
  maxCatalogItems: 96,
  maxCatalogChars: 300_000,
  maxContentChars: 48_000,
  maxPromptTemplateChars: 48_000,
  maxWorkflowSkillChars: 8_000,
  maxWorkflowGuideChars: 12_000,
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
  phases?: CommanderWorkflowGuidePhase[];
}

export interface CommanderProcessBehaviorSettings {
  qualityGateBehavior?: CommanderQualityGateBehavior;
  requireStylePlateBeforeRefImage?: boolean;
}

// ── commander:chat (invoke) ──────────────────────────────────
export interface CommanderChatRequest {
  canvasId: string;
  sessionId?: string;
  message: string;
  history: HistoryEntry[];
  selectedNodeIds: string[];
  promptGuides?: CommanderPromptGuide[];
  customLLMProvider?: LLMProviderRuntimeConfig;
  permissionMode?: 'danger' | 'auto' | 'normal' | 'strict';
  locale?: string;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  defaultProviders?: Record<string, string>;
  processSettings?: CommanderProcessBehaviorSettings;
}
export type CommanderChatResponse = void;

// ── commander:cancel (invoke) ────────────────────────────────
export interface CommanderCancelRequest {
  canvasId: string;
}
export type CommanderCancelResponse = void;

// ── commander:cancel-step (invoke) ───────────────────────────
export interface CommanderCancelStepRequest {
  canvasId: string;
}
export interface CommanderCancelStepResponse {
  /** `true` if a double-tap within 2s escalated this step-cancel to a full run cancel. */
  escalated: boolean;
}

// ── commander:inject-message (invoke) ────────────────────────
export interface CommanderInjectMessageRequest {
  canvasId: string;
  message: string;
}
export type CommanderInjectMessageResponse = void;

// ── commander:tool:decision (invoke) ─────────────────────────
export interface CommanderToolDecisionRequest {
  canvasId: string;
  toolCallId: string;
  approved: boolean;
}
export type CommanderToolDecisionResponse = void;

// ── commander:tool:answer (invoke) ───────────────────────────
export interface CommanderToolAnswerRequest {
  canvasId: string;
  toolCallId: string;
  answer: string;
}
export type CommanderToolAnswerResponse = void;

// ── commander:compact (invoke) ───────────────────────────────
// Handler returns the orchestrator compact stats, plus a silent no-op result
// when the session has already ended (same shape, all zeros).
export interface CommanderCompactRequest {
  canvasId: string;
}
export interface CommanderCompactResponse {
  freedChars: number;
  messageCount: number;
  toolCount: number;
}

// ── commander:tool-list (invoke) ─────────────────────────────
// Handler maps the live tool registry into a lean descriptor list.
// `tags` and `tier` are optional — older tools in the registry don't set them.
export interface CommanderToolDescriptor {
  name: string;
  description: string;
  tags?: string[];
  tier?: number;
}
export type CommanderToolListRequest = Record<string, never>;
export type CommanderToolListResponse = CommanderToolDescriptor[];

// ── commander:tool-search (invoke) ───────────────────────────
// Handler returns the same descriptor shape as tool-list, but filtered by the
// case-insensitive query; only `name` and `description` are guaranteed to be
// present on matches — `tags`/`tier` are stripped in the map step.
export interface CommanderToolSearchRequest {
  query?: string;
}
export type CommanderToolSearchResponse = Array<{
  name: string;
  description: string;
}>;

// ── commander:stream (push) — single source of truth (pure types) ──
/**
 * The `commander:stream` channel carries `TimelineEvent`s wrapped in a
 * v2 `WireEnvelope`. `CommanderStreamPayload` is the envelope that
 * actually rides the wire. The zod schema lives in
 * `@lucid-fin/contracts-parse`'s batch-09.
 */

/**
 * Serialisable intent, evidence, and decision shapes for the stream
 * wire. These mirror the in-process types in
 * `@lucid-fin/application/agent/exit-contract` by shape. Contracts
 * must not import application (reverse dependency), so we duplicate
 * the plain data and keep them in sync. Phase D+ introduces a
 * codegen/lint check to prevent drift.
 */
export type CommanderIntentPayload =
  { kind: 'informational' } | { kind: 'execution'; workflow?: string };

export type CommanderEvidencePayload =
  | { kind: 'guide_loaded'; guideId: string; at: number }
  | { kind: 'ask_user_asked'; question: string; at: number }
  | { kind: 'ask_user_answered'; answer: string; at: number }
  | { kind: 'mutation_commit'; toolName: string; args: unknown; resultOk: boolean; at: number }
  | { kind: 'validation_error'; toolName: string; errorText: string; at: number }
  | { kind: 'guide_activated'; key: string; reason: string; at: number }
  | { kind: 'generation_started'; nodeId: string; at: number }
  | { kind: 'settings_write'; canvasId: string; keys: string[]; at: number }
  | { kind: 'user_refused'; message: string; at: number }
  | { kind: 'budget_exhausted'; metric: 'steps' | 'tokens'; at: number };

export type CommanderBlockerPayload =
  | { kind: 'missing_commit'; expected: string[]; lastTool?: string }
  | { kind: 'ask_user_loop'; askCount: number; limit: number }
  | { kind: 'empty_narration'; lastAssistantText: string };

export type CommanderExitDecisionPayload =
  | { outcome: 'satisfied'; contractId: string; evidenceSummary: string }
  | { outcome: 'informational_answered'; reason: string }
  | { outcome: 'blocked_waiting_user'; question: string }
  | { outcome: 'refused'; reason: string }
  | { outcome: 'budget_exhausted'; metric: 'steps' | 'tokens' }
  | { outcome: 'unsatisfied'; contractId: string; blocker: CommanderBlockerPayload }
  | { outcome: 'error'; message: string };

/** v2 wire envelope payload for `commander:stream`. */
export type CommanderStreamPayload = WireEnvelope<TimelineEvent>;

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

// ── commander:undo:dispatch (push) ───────────────────────────
export interface CommanderUndoDispatchPayload {
  action: 'undo' | 'redo';
}
