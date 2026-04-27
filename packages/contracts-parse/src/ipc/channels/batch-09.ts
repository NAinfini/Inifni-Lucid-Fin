/**
 * commander:* channels — Batch 9.
 *
 * Covers:
 *  - 8 invoke handlers in `commander.handlers.ts` + `commander-meta.handlers.ts`
 *  - 5 push channels emitted from `commander-emit.ts` and
 *    `commander-tool-deps.ts`.
 *
 * This batch also closes Phase B-2 ("commander:chat/stream alignment"):
 *   - The `commander:chat` request schema carries every field the handler
 *     accepts (including the full `LLMProviderRuntimeConfig`).
 *   - The `commander:stream` payload is a strict `z.discriminatedUnion('type',
 *     [...])` over the 9 variants actually emitted from the main process.
 *     No more flat all-optional bag.
 *
 * A few shapes stay deliberately permissive:
 *  - `commander:canvas:dispatch` carries a Canvas snapshot (DTO not yet
 *    contract-owned; Phase C will zodify).
 *  - `commander:settings:dispatch` carries an action-string plus a
 *    per-action payload; shape varies, renderer reducers discriminate.
 *  - `commander:tool-list` / `commander:tool-search` responses use the
 *    descriptor shape (name, description, optional tags/tier) as emitted
 *    by the handler's map step.
 */
import { z } from 'zod';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────

// `HistoryEntry` is duplicated from @lucid-fin/application
// (`packages/application/src/agent/context-manager.ts`). The contracts packages
// live upstream of application, so we cannot import from there; the shape is
// mirrored here and kept in sync manually.
const HistoryEntryShape = z.union([
  z
    .object({
      role: z.union([z.literal('user'), z.literal('assistant')]),
      content: z.string(),
      toolCalls: z
        .array(
          z.object({
            id: z.string(),
            name: z.string(),
            arguments: z.record(z.string(), z.unknown()),
          }),
        )
        .optional(),
    })
    .passthrough(),
  z
    .object({
      role: z.literal('tool'),
      content: z.string(),
      toolCallId: z.string(),
    })
    .passthrough(),
]);

// Mirror of `LLMProviderRuntimeConfig` (`packages/contracts/src/llm-provider.ts`).
// Protocol and authStyle are the declared enum unions — the handler's runtime
// selection code tolerates additional values, so the schema `.passthrough()`
// keeps us resilient to upstream enum extensions.
const LLMProviderRuntimeConfigShape = z
  .object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string(),
    model: z.string(),
    protocol: z.enum([
      'openai-compatible',
      'openai-responses',
      'anthropic',
      'gemini',
      'cohere',
    ]),
    authStyle: z.enum(['bearer', 'x-api-key', 'x-goog-api-key', 'none']),
    contextWindow: z.number().optional(),
  })
  .passthrough();

const PromptGuideShape = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
});

// ── commander:chat (invoke) ──────────────────────────────────
const CommanderChatRequest = z
  .object({
    canvasId: z.string().min(1),
    sessionId: z.string().optional(),
    message: z.string(),
    history: z.array(HistoryEntryShape),
    selectedNodeIds: z.array(z.string()),
    promptGuides: z.array(PromptGuideShape).optional(),
    customLLMProvider: LLMProviderRuntimeConfigShape.optional(),
    permissionMode: z.enum(['auto', 'normal', 'strict']).optional(),
    locale: z.string().optional(),
    maxSteps: z.number().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().optional(),
    defaultProviders: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
const CommanderChatResponse = z.void();
export const commanderChatChannel = defineInvokeChannel({
  channel: 'commander:chat',
  request: CommanderChatRequest,
  response: CommanderChatResponse,
});
export type CommanderChatRequest = z.infer<typeof CommanderChatRequest>;
export type CommanderChatResponse = z.infer<typeof CommanderChatResponse>;

// ── commander:cancel (invoke) ────────────────────────────────
const CommanderCancelRequest = z.object({ canvasId: z.string().min(1) });
const CommanderCancelResponse = z.void();
export const commanderCancelChannel = defineInvokeChannel({
  channel: 'commander:cancel',
  request: CommanderCancelRequest,
  response: CommanderCancelResponse,
});
export type CommanderCancelRequest = z.infer<typeof CommanderCancelRequest>;
export type CommanderCancelResponse = z.infer<typeof CommanderCancelResponse>;

// ── commander:cancel-step (invoke) ───────────────────────────
// Step-level cancel. Aborts only the currently in-flight LLM request; the
// agent loop survives and retries. If fired twice within 2s the main-side
// handler escalates to a full run cancel — the response flag tells the
// renderer which happened so it can decide whether to keep the step
// button visible.
const CommanderCancelStepRequest = z.object({ canvasId: z.string().min(1) });
const CommanderCancelStepResponse = z.object({ escalated: z.boolean() });
export const commanderCancelStepChannel = defineInvokeChannel({
  channel: 'commander:cancel-step',
  request: CommanderCancelStepRequest,
  response: CommanderCancelStepResponse,
});
export type CommanderCancelStepRequest = z.infer<typeof CommanderCancelStepRequest>;
export type CommanderCancelStepResponse = z.infer<typeof CommanderCancelStepResponse>;

// ── commander:inject-message (invoke) ────────────────────────
const CommanderInjectMessageRequest = z.object({
  canvasId: z.string().min(1),
  message: z.string().min(1),
});
const CommanderInjectMessageResponse = z.void();
export const commanderInjectMessageChannel = defineInvokeChannel({
  channel: 'commander:inject-message',
  request: CommanderInjectMessageRequest,
  response: CommanderInjectMessageResponse,
});
export type CommanderInjectMessageRequest = z.infer<
  typeof CommanderInjectMessageRequest
>;
export type CommanderInjectMessageResponse = z.infer<
  typeof CommanderInjectMessageResponse
>;

// ── commander:tool:decision (invoke) ─────────────────────────
const CommanderToolDecisionRequest = z.object({
  canvasId: z.string().min(1),
  toolCallId: z.string().min(1),
  approved: z.boolean(),
});
const CommanderToolDecisionResponse = z.void();
export const commanderToolDecisionChannel = defineInvokeChannel({
  channel: 'commander:tool:decision',
  request: CommanderToolDecisionRequest,
  response: CommanderToolDecisionResponse,
});
export type CommanderToolDecisionRequest = z.infer<
  typeof CommanderToolDecisionRequest
>;
export type CommanderToolDecisionResponse = z.infer<
  typeof CommanderToolDecisionResponse
>;

// ── commander:tool:answer (invoke) ───────────────────────────
const CommanderToolAnswerRequest = z.object({
  canvasId: z.string().min(1),
  toolCallId: z.string().min(1),
  answer: z.string(),
});
const CommanderToolAnswerResponse = z.void();
export const commanderToolAnswerChannel = defineInvokeChannel({
  channel: 'commander:tool:answer',
  request: CommanderToolAnswerRequest,
  response: CommanderToolAnswerResponse,
});
export type CommanderToolAnswerRequest = z.infer<
  typeof CommanderToolAnswerRequest
>;
export type CommanderToolAnswerResponse = z.infer<
  typeof CommanderToolAnswerResponse
>;

// ── commander:compact (invoke) ───────────────────────────────
// Handler always resolves with a stats record — even the "no active session"
// path returns `{ freedChars: 0, messageCount: 0, toolCount: 0 }`.
const CommanderCompactRequest = z.object({ canvasId: z.string().min(1) });
const CommanderCompactResponse = z.object({
  freedChars: z.number(),
  messageCount: z.number(),
  toolCount: z.number(),
});
export const commanderCompactChannel = defineInvokeChannel({
  channel: 'commander:compact',
  request: CommanderCompactRequest,
  response: CommanderCompactResponse,
});
export type CommanderCompactRequest = z.infer<typeof CommanderCompactRequest>;
export type CommanderCompactResponse = z.infer<typeof CommanderCompactResponse>;

// ── commander:tool-list (invoke) ─────────────────────────────
const CommanderToolDescriptorShape = z
  .object({
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
    tier: z.number().optional(),
  })
  .passthrough();
// Handler is registered with `ipcMain.handle('commander:tool-list', async () => …)`
// — no args. Electron delivers `undefined` for an empty invoke payload, so the
// schema accepts an absent/empty object.
const CommanderToolListRequest = z.object({}).strict();
const CommanderToolListResponse = z.array(CommanderToolDescriptorShape);
export const commanderToolListChannel = defineInvokeChannel({
  channel: 'commander:tool-list',
  request: CommanderToolListRequest,
  response: CommanderToolListResponse,
});
export type CommanderToolListRequest = z.infer<typeof CommanderToolListRequest>;
export type CommanderToolListResponse = z.infer<
  typeof CommanderToolListResponse
>;

// ── commander:tool-search (invoke) ───────────────────────────
// Response variant: handler maps to `{ name, description }` only — tags/tier
// are dropped. Use a looser response shape matching the descriptor so the
// schema works for both list and search call sites.
const CommanderToolSearchRequest = z.object({ query: z.string().optional() });
const CommanderToolSearchResponse = z.array(
  z.object({ name: z.string(), description: z.string() }).passthrough(),
);
export const commanderToolSearchChannel = defineInvokeChannel({
  channel: 'commander:tool-search',
  request: CommanderToolSearchRequest,
  response: CommanderToolSearchResponse,
});
export type CommanderToolSearchRequest = z.infer<
  typeof CommanderToolSearchRequest
>;
export type CommanderToolSearchResponse = z.infer<
  typeof CommanderToolSearchResponse
>;

// ── commander:stream (push) — single zod source of truth ─────
/**
 * The `commander:stream` wire carries `TimelineEvent`s wrapped in a v2
 * `WireEnvelope`. The schema below mirrors the type-only `TimelineEvent`
 * union defined in `@lucid-fin/contracts/agent/timeline-event.ts`; both
 * must stay in sync (Phase H adds a CI drift check).
 *
 * Every event carries four provenance fields:
 *   - `runId`: monotonic per-run identifier — groups events into runs.
 *   - `step`: semantic model-step index (0-based); NOT a sort key.
 *   - `seq`: primary ordering key, monotonic per-run.
 *   - `emittedAt`: `Date.now()` at emission — debug/display only.
 */
// ── Exit Contract payloads (Phase B) ─────────────────────────
// Mirror the TypeScript unions in `packages/contracts/src/ipc/channels/batch-09.ts`.
// Contracts package is type-only (no zod dep); these runtime schemas are the
// canonical source and the `z.infer`-derived types match the hand-written types
// by shape. Phase D+ adds a drift-detection check.
const CommanderIntentPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('informational') }),
  z.object({ kind: z.literal('browse') }),
  z.object({ kind: z.literal('execution'), workflow: z.string().optional() }),
  z.object({ kind: z.literal('mixed'), workflow: z.string().optional() }),
]);

const CommanderEvidencePayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guide_loaded'), guideId: z.string(), at: z.number() }),
  z.object({ kind: z.literal('ask_user_asked'), question: z.string(), at: z.number() }),
  z.object({ kind: z.literal('ask_user_answered'), answer: z.string(), at: z.number() }),
  z.object({
    kind: z.literal('mutation_commit'),
    toolName: z.string(),
    args: z.unknown(),
    resultOk: z.boolean(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal('validation_error'),
    toolName: z.string(),
    errorText: z.string(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal('process_prompt_activated'),
    key: z.string(),
    reason: z.string(),
    at: z.number(),
  }),
  z.object({ kind: z.literal('generation_started'), nodeId: z.string(), at: z.number() }),
  z.object({
    kind: z.literal('settings_write'),
    canvasId: z.string(),
    keys: z.array(z.string()),
    at: z.number(),
  }),
  z.object({ kind: z.literal('user_refused'), message: z.string(), at: z.number() }),
  z.object({
    kind: z.literal('budget_exhausted'),
    metric: z.enum(['steps', 'tokens']),
    at: z.number(),
  }),
]);

const CommanderBlockerPayload = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('missing_commit'),
    expected: z.array(z.string()),
    lastTool: z.string().optional(),
  }),
  z.object({
    kind: z.literal('ask_user_loop'),
    askCount: z.number(),
    limit: z.number(),
  }),
  z.object({ kind: z.literal('empty_narration'), lastAssistantText: z.string() }),
]);

const CommanderExitDecisionPayload = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('satisfied'),
    contractId: z.string(),
    evidenceSummary: z.string(),
  }),
  z.object({ outcome: z.literal('informational_answered'), reason: z.string() }),
  z.object({ outcome: z.literal('blocked_waiting_user'), question: z.string() }),
  z.object({ outcome: z.literal('refused'), reason: z.string() }),
  z.object({
    outcome: z.literal('budget_exhausted'),
    metric: z.enum(['steps', 'tokens']),
  }),
  z.object({
    outcome: z.literal('unsatisfied'),
    contractId: z.string(),
    blocker: CommanderBlockerPayload,
  }),
  z.object({ outcome: z.literal('error'), message: z.string() }),
]);

// ── commander:stream (push) — TimelineEvent zod schema ───────
/**
 * Mirror of the `TimelineEvent` discriminated union from
 * `@lucid-fin/contracts/agent/timeline-event.ts`. Contracts package is
 * type-only (no zod); this is the runtime source of truth. The two must
 * stay in sync by hand — a CI drift check is tracked in Phase H.
 *
 * Ordering invariants (Codex freeze 2026-04-20):
 *   - `seq` is required, monotonic per-run (primary order key).
 *   - `step` is semantic (model-step-index, used for dedup window).
 *   - `emittedAt` is debug/display only.
 */
const TimelineEventCommon = {
  runId: z.string(),
  step: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  emittedAt: z.number(),
};

const TimelineParamValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const ToolRefShape = z.object({
  domain: z.string(),
  action: z.string(),
  version: z.number().int().optional(),
});

const CommanderErrorShape = z.object({
  code: z.enum([
    'LLM_TRANSIENT',
    'LLM_FATAL',
    'TOOL_VALIDATION',
    'TOOL_NOT_FOUND',
    'TOOL_PERMISSION',
    'TOOL_RUNTIME',
    'STREAM_STALLED',
    'RUN_CANCELLED',
    'RUN_MAX_STEPS',
    'CONTRACT_UNSATISFIED',
    'RUN_ENDED_BEFORE_RESULT',
  ]),
  params: z.record(z.string(), TimelineParamValue),
});

const TimelineExitDecisionMeta = z.object({
  outcome: z.string(),
  contractId: z.string().optional(),
  blocker: z.string().optional(),
});

const TimelineEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('run_start'),
    intent: z.string(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('run_end'),
    status: z.enum(['completed', 'failed', 'cancelled', 'max_steps']),
    exitDecision: TimelineExitDecisionMeta.optional(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('user_message'),
    content: z.string(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('assistant_text'),
    content: z.string(),
    isDelta: z.boolean(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('thinking'),
    content: z.string(),
    isDelta: z.boolean(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('tool_call'),
    toolCallId: z.string(),
    toolRef: ToolRefShape,
    args: z.record(z.string(), z.unknown()),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('tool_result'),
    toolCallId: z.string(),
    result: z.unknown().optional(),
    error: CommanderErrorShape.optional(),
    durationMs: z.number(),
    skipped: z.literal(true).optional(),
    synthetic: z.literal(true).optional(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('tool_confirm_prompt'),
    toolCallId: z.string(),
    toolRef: ToolRefShape,
    tier: z.number(),
    args: z.record(z.string(), z.unknown()),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('user_confirmation'),
    toolCallId: z.string(),
    approved: z.boolean(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('question_prompt'),
    questionId: z.string(),
    prompt: z.string(),
    options: z
      .array(z.object({ id: z.string(), label: z.string() }))
      .optional(),
    allowFreeText: z.boolean(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('user_answer'),
    questionId: z.string(),
    answer: z.string(),
    selectedOptionId: z.string().optional(),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('phase_note'),
    note: z.enum([
      'llm_retry',
      'tool_skipped_dedup',
      'compacted',
      'prompt_loaded',
      'max_steps_warning',
      'force_ask_user',
      'intent_reclassified',
    ]),
    params: z.record(z.string(), TimelineParamValue),
    ...TimelineEventCommon,
  }),
  z.object({
    kind: z.literal('cancelled'),
    reason: z.enum(['user', 'timeout', 'error']),
    completedToolCalls: z.number().int().nonnegative(),
    pendingToolCalls: z.number().int().nonnegative(),
    partialContent: z.string().optional(),
    ...TimelineEventCommon,
  }),
]);

const CommanderStreamPayload = z.object({
  wireVersion: z.literal(2),
  event: TimelineEvent,
});
export const commanderStreamChannel = definePushChannel({
  channel: 'commander:stream',
  payload: CommanderStreamPayload,
});
export type CommanderStreamPayload = z.infer<typeof CommanderStreamPayload>;
export { CommanderStreamPayload as CommanderStreamPayloadSchema };

// Legacy exit-contract payload type exports (still referenced elsewhere
// in the contracts-parse surface). Kept for downstream consumers until
// the exit-contract v2 landing; they no longer appear on the stream wire.
export type CommanderIntentPayload = z.infer<typeof CommanderIntentPayload>;
export type CommanderEvidencePayload = z.infer<typeof CommanderEvidencePayload>;
export type CommanderBlockerPayload = z.infer<typeof CommanderBlockerPayload>;
export type CommanderExitDecisionPayload = z.infer<
  typeof CommanderExitDecisionPayload
>;

// ── commander:canvas:dispatch (push) ─────────────────────────
// Carries a full Canvas snapshot. Canvas DTO is not yet contract-owned — kept
// opaque and permissive per Batch 7's precedent.
const CommanderCanvasDispatchPayload = z
  .object({
    canvasId: z.string(),
    canvas: z.unknown(),
  })
  .passthrough();
export const commanderCanvasDispatchChannel = definePushChannel({
  channel: 'commander:canvas:dispatch',
  payload: CommanderCanvasDispatchPayload,
});
export type CommanderCanvasDispatchPayload = z.infer<
  typeof CommanderCanvasDispatchPayload
>;

// ── commander:entities:updated (push) ────────────────────────
const CommanderEntitiesUpdatedPayload = z.object({ toolName: z.string() });
export const commanderEntitiesUpdatedChannel = definePushChannel({
  channel: 'commander:entities:updated',
  payload: CommanderEntitiesUpdatedPayload,
});
export type CommanderEntitiesUpdatedPayload = z.infer<
  typeof CommanderEntitiesUpdatedPayload
>;

// ── commander:settings:dispatch (push) ───────────────────────
// `action` is a provider-settings verb; `payload` shape varies per action
// (setProviderId, setProviderBaseUrl, addCustomProvider, …). Permissive by
// design — renderer reducers discriminate on `action` at runtime.
const CommanderSettingsDispatchPayload = z
  .object({
    action: z.string(),
    payload: z.unknown().optional(),
  })
  .passthrough();
export const commanderSettingsDispatchChannel = definePushChannel({
  channel: 'commander:settings:dispatch',
  payload: CommanderSettingsDispatchPayload,
});
export type CommanderSettingsDispatchPayload = z.infer<
  typeof CommanderSettingsDispatchPayload
>;

// ── commander:undo:dispatch (push) ───────────────────────────
const CommanderUndoDispatchPayload = z.object({
  action: z.enum(['undo', 'redo']),
});
export const commanderUndoDispatchChannel = definePushChannel({
  channel: 'commander:undo:dispatch',
  payload: CommanderUndoDispatchPayload,
});
export type CommanderUndoDispatchPayload = z.infer<
  typeof CommanderUndoDispatchPayload
>;

// ── commander:events:hydrate (invoke) ───────────────────────
// Renderer → main: read back all persisted `TimelineEvent`s for a
// session so the timeline slice can be rebuilt on session resume.
// `events` is the in-memory wire shape — the `payload` JSON column has
// already been parsed by the repo.
const CommanderEventsHydrateRequest = z.object({
  sessionId: z.string().min(1),
});
const CommanderEventsHydrateResponse = z.object({
  events: z.array(TimelineEvent),
});
export const commanderEventsHydrateChannel = defineInvokeChannel({
  channel: 'commander:events:hydrate',
  request: CommanderEventsHydrateRequest,
  response: CommanderEventsHydrateResponse,
});
export type CommanderEventsHydrateRequest = z.infer<
  typeof CommanderEventsHydrateRequest
>;
export type CommanderEventsHydrateResponse = z.infer<
  typeof CommanderEventsHydrateResponse
>;

// ── Channel tuples ──────────────────────────────────────────
export const commanderChannels = [
  commanderChatChannel,
  commanderCancelChannel,
  commanderInjectMessageChannel,
  commanderToolDecisionChannel,
  commanderToolAnswerChannel,
  commanderCompactChannel,
  commanderToolListChannel,
  commanderToolSearchChannel,
  commanderEventsHydrateChannel,
] as const;

export const commanderPushChannels = [
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  commanderSettingsDispatchChannel,
  commanderUndoDispatchChannel,
] as const;
