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

// ── commander:stream (push) — B-2 discriminated union ────────
/**
 * Strict per-variant discriminated union over the 9 `type:` events actually
 * emitted from the main process (see `commander-emit.ts:115-161` and the
 * two direct emits in `commander.handlers.ts:551` (context_usage) and
 * `:579` (error from the catch block — only `error` is set, so the other
 * fields stay optional in that variant).
 */
const CommanderStreamPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chunk'), content: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    toolName: z.string(),
    toolCallId: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    startedAt: z.number(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolName: z.string(),
    toolCallId: z.string(),
    result: z.unknown(),
    startedAt: z.number(),
    completedAt: z.number(),
  }),
  z.object({
    type: z.literal('tool_confirm'),
    toolName: z.string(),
    toolCallId: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    tier: z.number(),
  }),
  z.object({
    type: z.literal('tool_question'),
    toolName: z.string(),
    toolCallId: z.string(),
    question: z.string(),
    options: z.array(
      z.object({ label: z.string(), description: z.string().optional() }),
    ),
  }),
  z.object({ type: z.literal('thinking'), content: z.string() }),
  z.object({ type: z.literal('done'), content: z.string() }),
  z.object({
    type: z.literal('error'),
    toolCallId: z.string().optional(),
    error: z.string(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
  }),
  z.object({
    type: z.literal('context_usage'),
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
  }),
]);
export const commanderStreamChannel = definePushChannel({
  channel: 'commander:stream',
  payload: CommanderStreamPayload,
});
export type CommanderStreamPayload = z.infer<typeof CommanderStreamPayload>;

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
