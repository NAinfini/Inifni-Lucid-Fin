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
 *   - `CommanderStreamPayload` is a strict discriminated union over the 9
 *     variants actually emitted (see `CommanderStreamEvent` alias).
 *
 * The legacy `CommanderStreamPayload` in `commander-emit.ts` is a flat
 * all-optional bag; it stays as the runtime author's type for now, but any
 * new consumer importing from `@lucid-fin/contracts` gets the strict union.
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
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
    }
  | { role: 'tool'; content: string; toolCallId: string };

// Re-export the canonical LLM provider runtime config so commander:chat
// consumers can import the full provider shape from the channel barrel.
export type { LLMProviderRuntimeConfig } from '../../llm-provider.js';
import type { LLMProviderRuntimeConfig } from '../../llm-provider.js';

// ── commander:chat (invoke) ──────────────────────────────────
export interface CommanderChatRequest {
  canvasId: string;
  sessionId?: string;
  message: string;
  history: HistoryEntry[];
  selectedNodeIds: string[];
  promptGuides?: Array<{ id: string; name: string; content: string }>;
  customLLMProvider?: LLMProviderRuntimeConfig;
  permissionMode?: 'auto' | 'normal' | 'strict';
  locale?: string;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  defaultProviders?: Record<string, string>;
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
 * Mirror of `@lucid-fin/contracts-parse`'s `CommanderStreamPayload` zod
 * schema. Kept in sync by hand (the contracts package is type-only and must
 * not depend on zod at runtime). Every variant carries the provenance fields
 * (`runId`, `step`, `emittedAt`) required by the schema.
 *
 * Discriminator is `kind` — any consumer that still reads `.type` is a
 * compile error by design.
 */
interface CommanderStreamCommon {
  runId: string;
  step: number;
  emittedAt: number;
}

export type CommanderStreamEvent =
  | ({ kind: 'chunk'; content: string } & CommanderStreamCommon)
  | ({
      kind: 'tool_call_started';
      toolName: string;
      toolCallId: string;
      startedAt: number;
    } & CommanderStreamCommon)
  | ({
      kind: 'tool_call_args_delta';
      toolCallId: string;
      delta: string;
    } & CommanderStreamCommon)
  | ({
      kind: 'tool_call_args_complete';
      toolCallId: string;
      arguments: Record<string, unknown>;
    } & CommanderStreamCommon)
  | ({
      kind: 'tool_result';
      toolName: string;
      toolCallId: string;
      result: unknown;
      startedAt: number;
      completedAt: number;
    } & CommanderStreamCommon)
  | ({
      kind: 'tool_confirm';
      toolName: string;
      toolCallId: string;
      arguments: Record<string, unknown>;
      tier: number;
    } & CommanderStreamCommon)
  | ({
      kind: 'tool_question';
      toolName: string;
      toolCallId: string;
      question: string;
      options: Array<{ label: string; description?: string }>;
    } & CommanderStreamCommon)
  | ({ kind: 'thinking_delta'; content: string } & CommanderStreamCommon)
  | ({
      kind: 'phase_note';
      note: 'process_prompt_loaded' | 'compacted' | 'llm_retry';
      detail: string;
    } & CommanderStreamCommon)
  | ({ kind: 'done'; content: string } & CommanderStreamCommon)
  | ({
      kind: 'error';
      toolCallId?: string;
      error: string;
      startedAt?: number;
      completedAt?: number;
    } & CommanderStreamCommon)
  | ({
      kind: 'context_usage';
      estimatedTokensUsed: number;
      contextWindowTokens: number;
      messageCount: number;
      systemPromptChars: number;
      toolSchemaChars: number;
      messageChars: number;
      cacheChars: number;
      cacheEntryCount: number;
      historyMessagesTrimmed?: number;
      utilizationRatio: number;
    } & CommanderStreamCommon);

/** Alias emitted at the codegen's expected `<TypeBase>Payload` name. */
export type CommanderStreamPayload = CommanderStreamEvent;

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
