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
 * Discriminated union over every Commander stream event. This is THE schema.
 * Orchestrator, preload, and renderer all derive their types from here via
 * `z.infer`. Adding a new variant is a compile error at every consumer site.
 *
 * Every variant carries three required provenance fields:
 *   - `runId`: monotonic per-run identifier (UUID) — so the renderer can group
 *     events by run and detect run boundaries unambiguously.
 *   - `step`: the orchestrator step number at emission time (0-based).
 *   - `emittedAt`: `Date.now()` at emission — used for elapsed / stall detection.
 *
 * The discriminator is `kind` (not `type`) to force every legacy string compare
 * on `.type` to surface as a compile error during the migration.
 */
const CommanderStreamCommon = {
  runId: z.string(),
  step: z.number().int().nonnegative(),
  emittedAt: z.number(),
};
const CommanderStreamPayload = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chunk'),
    content: z.string(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('tool_call_started'),
    toolName: z.string(),
    toolCallId: z.string(),
    startedAt: z.number(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('tool_call_args_delta'),
    toolCallId: z.string(),
    delta: z.string(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('tool_call_args_complete'),
    toolCallId: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('tool_result'),
    toolName: z.string(),
    toolCallId: z.string(),
    result: z.unknown(),
    startedAt: z.number(),
    completedAt: z.number(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('tool_confirm'),
    toolName: z.string(),
    toolCallId: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    tier: z.number(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('tool_question'),
    toolName: z.string(),
    toolCallId: z.string(),
    question: z.string(),
    options: z.array(
      z.object({ label: z.string(), description: z.string().optional() }),
    ),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('thinking_delta'),
    content: z.string(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('phase_note'),
    note: z.enum(['process_prompt_loaded', 'compacted', 'llm_retry']),
    detail: z.string(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('done'),
    content: z.string(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('error'),
    toolCallId: z.string().optional(),
    error: z.string(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
    ...CommanderStreamCommon,
  }),
  z.object({
    kind: z.literal('context_usage'),
    estimatedTokensUsed: z.number(),
    contextWindowTokens: z.number(),
    messageCount: z.number(),
    systemPromptChars: z.number(),
    toolSchemaChars: z.number(),
    messageChars: z.number(),
    cacheChars: z.number(),
    cacheEntryCount: z.number(),
    historyMessagesTrimmed: z.number().optional(),
    utilizationRatio: z.number(),
    ...CommanderStreamCommon,
  }),
]);
export const commanderStreamChannel = definePushChannel({
  channel: 'commander:stream',
  payload: CommanderStreamPayload,
});
export type CommanderStreamPayload = z.infer<typeof CommanderStreamPayload>;
export type CommanderStreamEvent = CommanderStreamPayload;
export { CommanderStreamPayload as CommanderStreamPayloadSchema };

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
] as const;

export const commanderPushChannels = [
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  commanderSettingsDispatchChannel,
  commanderUndoDispatchChannel,
] as const;
