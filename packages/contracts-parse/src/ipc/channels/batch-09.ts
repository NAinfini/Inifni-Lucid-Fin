/**
 * commander:* channels — Batch 9.
 *
 * Covers:
 *  - 8 invoke handlers in `commander.handlers.ts` + `commander-meta.handlers.ts`
 *  - 5 push channels emitted from `commander-emit.ts` and
 *    `commander-tool-deps.ts`.
 *
 * `commander:start` returns only a persisted run ACK; progress and terminal
 * state use the run-keyed stream and hydration contracts.
 *   - The `commander:stream` payload is a strict `z.discriminatedUnion('type',
 *     [...])` over the 9 variants actually emitted from the main process.
 *     No more flat all-optional bag.
 *
 * A few shapes stay deliberately permissive:
 *  - `commander:canvas:dispatch` carries a Canvas snapshot (DTO not yet
 *    contract-owned; Phase C will zodify).
 *  - `commander:settings:dispatch` carries an action-string plus a
 *    per-action payload; shape varies, renderer reducers discriminate.
 */
import { z } from 'zod';
import { COMMANDER_GUIDE_LIMITS } from '@lucid-fin/contracts';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────

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
    protocol: z.enum(['openai-compatible', 'openai-responses', 'anthropic', 'gemini', 'cohere']),
    authStyle: z.enum(['bearer', 'x-api-key', 'x-goog-api-key', 'none']),
    supportsModelOverride: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    reasoningEffortsByModel: z.record(z.string(), z.array(z.string())).optional(),
    reasoningEffort: z.string().trim().min(1).optional(),
    contextWindow: z.number().optional(),
  })
  .passthrough();

const TaskListGuidePhaseShape = z.enum([
  'unbound',
  'production_plan_pending',
  'production_plan_revision',
  'style_exploration',
  'visual_constitution_pending',
  'preproduction',
  'media_generation',
  'assembly',
  'delivery_preparation',
  'delivery_pending',
  'delivery_approved',
  'blocked',
]);

const PromptGuideShape = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string().max(COMMANDER_GUIDE_LIMITS.maxContentChars),
  autoInject: z.boolean().optional(),
  autoInjectContent: z.string().max(COMMANDER_GUIDE_LIMITS.maxAutoInjectCharsPerGuide).optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  retention: z.enum(['turn', 'task_list', 'discovery']).optional(),
  phases: z.array(TaskListGuidePhaseShape).max(8).optional(),
});

const PromptGuideCatalogShape = z
  .array(PromptGuideShape)
  .max(COMMANDER_GUIDE_LIMITS.maxCatalogItems)
  .superRefine((guides, ctx) => {
    const totalChars = guides.reduce(
      (total, guide) => total + guide.content.length + (guide.autoInjectContent?.length ?? 0),
      0,
    );
    if (totalChars > COMMANDER_GUIDE_LIMITS.maxCatalogChars) {
      ctx.addIssue({
        code: 'custom',
        message: `Guide catalog must be at most ${COMMANDER_GUIDE_LIMITS.maxCatalogChars} characters`,
      });
    }
  });

const CommanderProcessBehaviorSettingsShape = z.object({
  qualityGateBehavior: z.enum(['warn-only', 'auto-expand', 'block-generation']).optional(),
  requireStylePlateBeforeRefImage: z.boolean().optional(),
});

const CommanderAttachmentRole = z.literal('reference');
const CommanderAttachmentInput = z.object({
  assetEntryId: z.string().min(1),
  role: CommanderAttachmentRole,
});
const CommanderRunAttachment = z.object({
  ordinal: z.number().int().nonnegative(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  role: CommanderAttachmentRole,
  originalName: z.string().min(1),
  mimeType: z.string().min(1),
});

const SafeNonnegativeInteger = z
  .number()
  .finite()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const NonnegativeFiniteNumber = z.number().finite().nonnegative();
const RunResourceBudget = z
  .object({
    maxTokens: SafeNonnegativeInteger.optional(),
    maxToolCalls: SafeNonnegativeInteger.optional(),
    maxWallTimeMs: SafeNonnegativeInteger.optional(),
    maxCostUsd: NonnegativeFiniteNumber.optional(),
  })
  .strict();
const CommanderWorkType = z.enum(['agent', 'subagent', 'tool_program']);

// ── commander:start (invoke) ─────────────────────────────────
const CommanderRunIntent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user_message'), message: z.string().trim().min(1) }).strict(),
  z
    .object({
      kind: z.literal('media_prompt_assembly'),
      taskListId: z.string().min(1),
      promptAssemblyId: z.string().min(1),
      nodeId: z.string().min(1),
      label: z.string().trim().min(1),
    })
    .strict(),
]);

const CommanderStartRequest = z
  .object({
    defaultCanvasId: z.string().refine((value) => value.trim().length > 0).optional(),
    authorizedCanvasIds: z
      .array(z.string().refine((value) => value.trim().length > 0))
      .transform((canvasIds) => [...new Set(canvasIds)]),
    sessionId: z.string().min(1),
    intent: CommanderRunIntent,
    selectedNodes: z
      .array(
        z
          .object({
            canvasId: z.string().refine((value) => value.trim().length > 0),
            nodeId: z.string().refine((value) => value.trim().length > 0),
          })
          .strict(),
      )
      .transform((nodes) => {
        const seen = new Set<string>();
        return nodes.filter((node) => {
          const key = `${node.canvasId}\u0000${node.nodeId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }),
    attachments: z.array(CommanderAttachmentInput).max(8).optional(),
    promptGuides: PromptGuideCatalogShape.optional(),
    customLLMProvider: LLMProviderRuntimeConfigShape.optional(),
    permissionMode: z.enum(['danger', 'auto', 'normal', 'strict']).optional(),
    locale: z.string().optional(),
    resourceBudget: RunResourceBudget.optional(),
    continuationOfRunId: z.string().min(1).max(160).optional(),
    temperature: z.number().optional(),
    contextWindowTokens: z.number().optional(),
    maxOutputTokens: z.number().optional(),
    defaultProviders: z.record(z.string(), z.string()).optional(),
    processSettings: CommanderProcessBehaviorSettingsShape.optional(),
    workType: CommanderWorkType.optional(),
    parentRunId: z.string().min(1).max(160).optional(),
    retryOfRunId: z.string().min(1).max(160).optional(),
    displayName: z.string().trim().min(1).max(240).optional(),
    objective: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (
      request.defaultCanvasId &&
      !request.authorizedCanvasIds.includes(request.defaultCanvasId)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['defaultCanvasId'],
        message: 'defaultCanvasId must be included in authorizedCanvasIds',
      });
    }
    request.selectedNodes.forEach((node, index) => {
      if (!request.authorizedCanvasIds.includes(node.canvasId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['selectedNodes', index, 'canvasId'],
          message: 'selectedNodes must reference an authorized Canvas',
        });
      }
    });
    const workType = request.workType ?? 'agent';
    if (workType === 'agent' && request.parentRunId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentRunId'],
        message: 'root agent runs cannot have a parentRunId',
      });
    }
    if (workType !== 'agent' && request.parentRunId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentRunId'],
        message: 'subagent and tool_program runs require a parentRunId',
      });
    }
  });
const CommanderStartResponse = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  acceptedAt: z.number().int().nonnegative(),
});
export const commanderStartChannel = defineInvokeChannel({
  channel: 'commander:start',
  request: CommanderStartRequest,
  response: CommanderStartResponse,
});
export type CommanderStartRequest = z.infer<typeof CommanderStartRequest>;
export type CommanderStartResponse = z.infer<typeof CommanderStartResponse>;

// ── commander:cancel (invoke) ────────────────────────────────
const CommanderCancelRequest = z.object({ runId: z.string().min(1) });
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
const CommanderCancelStepRequest = z.object({ runId: z.string().min(1) });
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
  runId: z.string().min(1),
  message: z.string().min(1),
});
const CommanderInjectMessageResponse = z.void();
export const commanderInjectMessageChannel = defineInvokeChannel({
  channel: 'commander:inject-message',
  request: CommanderInjectMessageRequest,
  response: CommanderInjectMessageResponse,
});
export type CommanderInjectMessageRequest = z.infer<typeof CommanderInjectMessageRequest>;
export type CommanderInjectMessageResponse = z.infer<typeof CommanderInjectMessageResponse>;

// ── commander:tool:decision (invoke) ─────────────────────────
const CommanderToolDecisionRequest = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  toolCallId: z.string().min(1),
  approved: z.boolean(),
});
const CommanderToolActionResponse = z.discriminatedUnion('accepted', [
  z.object({
    accepted: z.literal(true),
    delivery: z.enum(['active_run', 'task_list_continuation']),
    taskListId: z.string().min(1).optional(),
  }),
  z.object({
    accepted: z.literal(false),
    code: z.enum(['stale_run', 'not_pending', 'no_active_session', 'already_resolved']),
  }),
]);
const CommanderToolDecisionResponse = CommanderToolActionResponse;
export const commanderToolDecisionChannel = defineInvokeChannel({
  channel: 'commander:tool:decision',
  request: CommanderToolDecisionRequest,
  response: CommanderToolDecisionResponse,
});
export type CommanderToolDecisionRequest = z.infer<typeof CommanderToolDecisionRequest>;
export type CommanderToolDecisionResponse = z.infer<typeof CommanderToolDecisionResponse>;

// ── commander:tool:answer (invoke) ───────────────────────────
const CommanderToolAnswerRequest = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  toolCallId: z.string().min(1),
  answer: z.string(),
});
const CommanderToolAnswerResponse = CommanderToolActionResponse;
export const commanderToolAnswerChannel = defineInvokeChannel({
  channel: 'commander:tool:answer',
  request: CommanderToolAnswerRequest,
  response: CommanderToolAnswerResponse,
});
export type CommanderToolAnswerRequest = z.infer<typeof CommanderToolAnswerRequest>;
export type CommanderToolAnswerResponse = z.infer<typeof CommanderToolAnswerResponse>;

// ── commander:compact (invoke) ───────────────────────────────
// Handler always resolves with a stats record — even the "no active session"
// path returns `{ freedChars: 0, messageCount: 0, toolCount: 0 }`.
const CommanderCompactRequest = z.object({ runId: z.string().min(1) });
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
  runId: z.string().min(1).max(160),
  step: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  emittedAt: z.number().int().nonnegative(),
};

const TimelineParamValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const PublicId = z.string().min(1).max(160);
const PublicLabel = z.string().min(1).max(240);
const PublicSummary = z.string().min(1).max(240);
const PublicCount = SafeNonnegativeInteger;
const Sha256Hash = z.string().regex(/^[a-f0-9]{64}$/);

const ToolRefShape = z.object({
  domain: z.string().min(1).max(80),
  action: z.string().min(1).max(120),
  version: z.number().int().optional(),
}).strict();

const CommanderErrorCode = z.enum([
  'LLM_TRANSIENT',
  'LLM_FATAL',
  'TOOL_VALIDATION',
  'INVALID_TOOL_OUTPUT',
  'TOOL_NOT_FOUND',
  'TOOL_PERMISSION',
  'TOOL_RUNTIME',
  'STREAM_STALLED',
  'RUN_CANCELLED',
  'RUN_MAX_STEPS',
  'CONTRACT_UNSATISFIED',
  'RUN_ENDED_BEFORE_RESULT',
]);

const PublicToolDetails = z
  .record(z.string().min(1).max(80), z.union([
    z.string().max(240),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]))
  .refine((value) => Object.keys(value).length <= 32, 'Too many public tool details');

const PublicToolArtifact = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('checklist'),
    id: PublicId,
    label: PublicLabel.optional(),
    items: z.array(z.object({
      id: PublicId,
      label: PublicLabel,
      status: z.enum(['pending', 'in_progress', 'done']),
    }).strict()).max(200),
  }).strict(),
  z.object({
    kind: z.literal('asset'),
    id: PublicId,
    label: PublicLabel.optional(),
    contentHash: PublicId.optional(),
    mediaType: z.enum(['image', 'video', 'audio', 'document']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('canvas_node'),
    id: PublicId,
    label: PublicLabel.optional(),
    assetHash: PublicId.optional(),
  }).strict(),
]);

const ContextAuthority = z.enum([
  'commander_run',
  'canvas',
  'canvas_node',
  'asset_entry',
  'character',
  'equipment',
  'location',
  'script',
  'preset',
  'shot_template',
  'snapshot',
  'color_style',
  'run_checklist',
  'task_list',
  'prompt_assembly',
  'cas',
]);

const ContextFactRelation = z.enum([
  'run_scope',
  'selected_input',
  'attachment',
  'bound_input',
  'retry_source',
  'read',
  'created',
  'updated',
  'deleted',
  'produced',
]);

export const PublicContextFactSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('authority_ref'),
    authority: ContextAuthority,
    relation: ContextFactRelation,
    id: PublicId,
    scopeId: PublicId.optional(),
    revision: PublicCount.optional(),
    contentHash: Sha256Hash.optional(),
  }).strict(),
  z.object({
    kind: z.literal('value'),
    key: z.string().min(1).max(80),
    value: z.union([z.string().max(240), z.number().finite(), z.boolean(), z.null()]),
  }).strict(),
]);

const ContextFactSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('run_input') }).strict(),
  z.object({
    kind: z.literal('tool_result'),
    toolCallId: PublicId,
    toolResultSeq: PublicCount,
  }).strict(),
]);

const ContextFactEvent = z.object({
  kind: z.literal('context_fact'),
  schemaVersion: z.literal(1),
  source: ContextFactSource,
  completeness: z.enum(['complete', 'unavailable']),
  facts: z.array(PublicContextFactSchema).max(128),
  ...TimelineEventCommon,
}).strict().superRefine((event, ctx) => {
  if (event.completeness === 'complete' && event.facts.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['facts'],
      message: 'complete context_fact events require at least one fact',
    });
  }
  if (event.completeness === 'unavailable' && event.facts.length !== 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['facts'],
      message: 'unavailable context_fact events must not contain facts',
    });
  }
  if (event.source.kind === 'tool_result' && event.facts.length > 32) {
    ctx.addIssue({
      code: 'custom',
      path: ['facts'],
      message: 'tool_result context_fact events may contain at most 32 facts',
    });
  }
});

const TimelineExitDecisionMeta = z.object({
  outcome: PublicId,
  contractId: PublicId.optional(),
  blocker: PublicSummary.optional(),
}).strict();

const ResourceAmount = z.discriminatedUnion('knowledge', [
  z.object({ knowledge: z.literal('known'), value: NonnegativeFiniteNumber }).strict(),
  z.object({ knowledge: z.literal('estimated'), value: NonnegativeFiniteNumber }).strict(),
  z.object({ knowledge: z.literal('unknown') }).strict(),
]);

const ResourceRemaining = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unlimited') }).strict(),
  z.object({ state: z.literal('known'), value: NonnegativeFiniteNumber }).strict(),
  z.object({ state: z.literal('estimated'), value: NonnegativeFiniteNumber }).strict(),
  z.object({ state: z.literal('unknown') }).strict(),
]);

const RunResourceUsage = z.object({
  tokens: ResourceAmount,
  toolCalls: SafeNonnegativeInteger,
  wallTimeMs: SafeNonnegativeInteger,
  costUsd: ResourceAmount,
}).strict();

const RunResourceRemainder = z.object({
  tokens: ResourceRemaining,
  toolCalls: ResourceRemaining,
  wallTimeMs: ResourceRemaining,
  costUsd: ResourceRemaining,
}).strict();

const RunResourceClock = z.object({
  state: z.enum(['active', 'waiting_user', 'paused', 'stopped']),
  activeMs: SafeNonnegativeInteger,
  changedAt: SafeNonnegativeInteger,
}).strict();

const RunBlocker = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resource_budget'),
    metric: z.enum(['tokens', 'tool_calls', 'wall_time', 'cost']),
    reason: z.enum(['exhausted', 'unavailable']),
  }).strict(),
  z.object({
    kind: z.literal('safety_limit'),
    limit: z.enum(['context_window', 'provider_limit', 'recovery_required']),
  }).strict(),
]);

const ResourceStateCause = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initialized') }).strict(),
  z.object({
    kind: z.literal('reserved'),
    operationId: PublicId,
    source: z.enum(['model', 'tool']),
  }).strict(),
  z.object({
    kind: z.literal('settled'),
    operationId: PublicId,
    source: z.enum(['model', 'tool']),
  }).strict(),
  z.object({ kind: z.literal('wait_started') }).strict(),
  z.object({ kind: z.literal('wait_ended') }).strict(),
  z.object({ kind: z.literal('pause_started') }).strict(),
  z.object({ kind: z.literal('pause_ended') }).strict(),
  z.object({ kind: z.literal('boundary'), blocker: RunBlocker }).strict(),
]);

const ResourceStateEvent = z.object({
  kind: z.literal('resource_state'),
  schemaVersion: z.literal(1),
  cause: ResourceStateCause,
  usage: RunResourceUsage,
  remaining: RunResourceRemainder,
  clock: RunResourceClock,
  ...TimelineEventCommon,
}).strict();

const RunEndEvent = z.object({
  kind: z.literal('run_end'),
  status: z.enum(['completed', 'failed', 'cancelled', 'blocked', 'max_steps']),
  blocker: RunBlocker.optional(),
  exitDecision: TimelineExitDecisionMeta.optional(),
  ...TimelineEventCommon,
}).strict().superRefine((event, ctx) => {
  if (event.status === 'blocked' && !event.blocker) {
    ctx.addIssue({
      code: 'custom',
      path: ['blocker'],
      message: 'blocked run_end events require a blocker',
    });
  }
  if (event.status !== 'blocked' && event.blocker !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['blocker'],
      message: 'only blocked run_end events may include a blocker',
    });
  }
});

const TimelineEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('run_start'),
    intent: z.string(),
    resourceBudget: RunResourceBudget,
    workType: CommanderWorkType.default('agent'),
    parentRunId: PublicId.optional(),
    retryOfRunId: PublicId.optional(),
    displayName: PublicLabel.optional(),
    objective: z.string().min(1).max(4_000).optional(),
    continuationOfRunId: PublicId.optional(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('run_paused'),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('run_resumed'),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('catalog_frozen'),
    catalogHash: z.string().regex(/^[a-f0-9]{64}$/),
    tools: z.array(
      z.object({
        name: PublicId,
        description: z.string().min(1).max(1_000),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        tags: z.array(z.string().max(80)).max(100),
        contexts: z.array(z.string().max(80)).max(100),
        inputSchemaHash: z.string().regex(/^[a-f0-9]{64}$/),
        outputSchemaHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      }).strict(),
    ).max(1_000),
    ...TimelineEventCommon,
  }).strict(),
  RunEndEvent,
  z.object({
    kind: z.literal('user_message'),
    content: z.string(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('assistant_text'),
    content: z.string(),
    isDelta: z.boolean(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('public_progress'),
    operationId: PublicId,
    status: z.enum(['running', 'completed', 'failed']),
    summary: PublicSummary.optional(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('resource_usage'),
    operationId: PublicId,
    source: z.literal('model'),
    promptTokens: PublicCount.optional(),
    completionTokens: PublicCount.optional(),
    reasoningTokens: PublicCount.optional(),
    ...TimelineEventCommon,
  }).strict(),
  ResourceStateEvent,
  ContextFactEvent,
  z.object({
    kind: z.literal('tool_call'),
    toolCallId: PublicId,
    toolRef: ToolRefShape,
    status: z.literal('started'),
    summary: PublicSummary.optional(),
    details: PublicToolDetails.optional(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('tool_result'),
    toolCallId: PublicId,
    status: z.enum(['succeeded', 'failed', 'skipped']),
    summary: PublicSummary.optional(),
    details: PublicToolDetails.optional(),
    artifacts: z.array(PublicToolArtifact).max(32).optional(),
    errorCode: CommanderErrorCode.optional(),
    durationMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    skipped: z.literal(true).optional(),
    synthetic: z.literal(true).optional(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('tool_confirm_prompt'),
    toolCallId: PublicId,
    toolRef: ToolRefShape,
    tier: z.number().int().min(1).max(4),
    status: z.literal('awaiting_confirmation'),
    summary: PublicSummary.optional(),
    details: PublicToolDetails.optional(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('user_confirmation'),
    toolCallId: z.string(),
    approved: z.boolean(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('question_prompt'),
    questionId: z.string(),
    prompt: z.string(),
    options: z
      .array(
        z.object({
          id: PublicId,
          label: PublicLabel,
          description: z.string().max(1_000).optional(),
          previewAssetHash: PublicId.optional(),
        }).strict(),
      ).max(100)
      .optional(),
    allowFreeText: z.boolean(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('user_answer'),
    questionId: z.string(),
    answer: z.string(),
    selectedOptionId: z.string().optional(),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('phase_note'),
    note: z.enum([
      'llm_retry',
      'tool_skipped_dedup',
      'compacted',
      'prompt_loaded',
      'max_steps_warning',
    ]),
    params: z.record(z.string().max(80), TimelineParamValue).refine(
      (value) => Object.keys(value).length <= 32,
      'Too many phase-note parameters',
    ),
    ...TimelineEventCommon,
  }).strict(),
  z.object({
    kind: z.literal('cancelled'),
    reason: z.enum(['user', 'timeout', 'error']),
    completedToolCalls: z.number().int().nonnegative(),
    pendingToolCalls: z.number().int().nonnegative(),
    partialContent: z.string().optional(),
    ...TimelineEventCommon,
  }).strict(),
]);

const CommanderStreamPayload = z.object({
  wireVersion: z.literal(2),
  sessionId: z.string().min(1).max(160),
  event: TimelineEvent,
}).strict();
export const commanderStreamChannel = definePushChannel({
  channel: 'commander:stream',
  payload: CommanderStreamPayload,
});
export type CommanderStreamPayload = z.infer<typeof CommanderStreamPayload>;
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
export type CommanderCanvasDispatchPayload = z.infer<typeof CommanderCanvasDispatchPayload>;

// ── commander:entities:updated (push) ────────────────────────
const CommanderEntitiesUpdatedPayload = z.object({ toolName: z.string() });
export const commanderEntitiesUpdatedChannel = definePushChannel({
  channel: 'commander:entities:updated',
  payload: CommanderEntitiesUpdatedPayload,
});
export type CommanderEntitiesUpdatedPayload = z.infer<typeof CommanderEntitiesUpdatedPayload>;

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
export type CommanderSettingsDispatchPayload = z.infer<typeof CommanderSettingsDispatchPayload>;

const CommanderRunStatus = z.enum([
  'accepted',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'max_steps',
]);
const CommanderTerminalStatus = z.enum([
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'max_steps',
]);
const MAX_CONTEXT_CACHE_RUNS = 512;
const MAX_CONTEXT_ITEMS_PER_RUN = 5_000;
const MAX_CONTEXT_TEXT_CHARS = 64_000;

export const PublicContextItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('user_input'),
    runId: PublicId,
    seq: PublicCount,
    content: z.string().max(MAX_CONTEXT_TEXT_CHARS),
  }).strict(),
  z.object({
    kind: z.literal('run_context'),
    runId: PublicId,
    seq: PublicCount,
    facts: z.array(PublicContextFactSchema).min(1).max(128),
  }).strict(),
  z.object({
    kind: z.literal('assistant_text'),
    runId: PublicId,
    step: PublicCount,
    content: z.string().max(MAX_CONTEXT_TEXT_CHARS),
  }).strict(),
  z.object({
    kind: z.literal('tool_observation'),
    runId: PublicId,
    toolCallId: PublicId,
    toolName: PublicId,
    status: z.enum(['completed', 'failed']),
    summary: PublicSummary.optional(),
    details: PublicToolDetails.optional(),
    artifacts: z.array(PublicToolArtifact).max(32).optional(),
    contextFacts: z.array(PublicContextFactSchema).max(32).optional(),
  }).strict(),
  z.object({
    kind: z.literal('interaction'),
    runId: PublicId,
    seq: PublicCount,
    interaction: z.enum(['question', 'answer', 'confirmation']),
    content: z.string().max(MAX_CONTEXT_TEXT_CHARS).optional(),
  }).strict(),
  z.object({
    kind: z.literal('terminal_summary'),
    runId: PublicId,
    status: CommanderTerminalStatus,
    summary: PublicSummary.optional(),
    errorCode: CommanderErrorCode.optional(),
  }).strict(),
]);

const CommanderContextCacheRun = z.object({
  runId: PublicId,
  acceptedAt: PublicCount,
  status: CommanderRunStatus,
  throughSeq: PublicCount,
  eventHash: Sha256Hash,
  items: z.array(PublicContextItemSchema).max(MAX_CONTEXT_ITEMS_PER_RUN),
}).strict();

export const CommanderContextCacheSchema = z.object({
  kind: z.literal('commander_context_cache'),
  version: z.literal(2),
  projectorVersion: PublicCount,
  sessionId: PublicId,
  runs: z.array(CommanderContextCacheRun).max(MAX_CONTEXT_CACHE_RUNS),
  projectionHash: Sha256Hash,
}).strict();
export type PublicContextItem = z.infer<typeof PublicContextItemSchema>;
export type CommanderContextCache = z.infer<typeof CommanderContextCacheSchema>;

const CommanderRunRecord = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  defaultCanvasId: z.string().min(1).optional(),
  authorizedCanvasIds: z.array(z.string().min(1)),
  intent: z.string(),
  workType: CommanderWorkType.default('agent'),
  parentRunId: PublicId.optional(),
  retryOfRunId: PublicId.optional(),
  displayName: PublicLabel.optional(),
  objective: z.string().min(1).max(4_000).optional(),
  status: CommanderRunStatus,
  acceptedAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative().optional(),
  completedAt: z.number().int().nonnegative().optional(),
  lastSeq: z.number().int().nonnegative(),
  errorText: z.string().optional(),
  attachments: z.array(CommanderRunAttachment),
}).strict();

const CommanderRunGetRequest = z.object({ runId: z.string().min(1) });
const CommanderRunGetResponse = CommanderRunRecord;
export const commanderRunGetChannel = defineInvokeChannel({
  channel: 'commander:run:get',
  request: CommanderRunGetRequest,
  response: CommanderRunGetResponse,
});
export type CommanderRunGetRequest = z.infer<typeof CommanderRunGetRequest>;
export type CommanderRunGetResponse = z.infer<typeof CommanderRunGetResponse>;

// ── commander:run:control (invoke) ──────────────────────────
const CommanderRunControlAction = z.enum([
  'message',
  'pause',
  'resume',
  'cancel',
  'cancel_step',
  'retry',
]);
const CommanderRunControlRequest = z.discriminatedUnion('action', [
  z.object({
    runId: PublicId,
    action: z.literal('message'),
    message: z.string().trim().min(1).max(64_000),
  }).strict(),
  ...(['pause', 'resume', 'cancel', 'cancel_step', 'retry'] as const).map((action) =>
    z.object({ runId: PublicId, action: z.literal(action) }).strict(),
  ),
]);
const CommanderRunControlResponse = z.discriminatedUnion('accepted', [
  z.object({
    accepted: z.literal(true),
    action: CommanderRunControlAction,
    runId: PublicId,
    affectedRunIds: z.array(PublicId).max(1_000),
    retryRunId: PublicId.optional(),
  }).strict(),
  z.object({
    accepted: z.literal(false),
    action: CommanderRunControlAction,
    runId: PublicId,
    affectedRunIds: z.array(PublicId).max(1_000),
    code: z.enum(['run_not_found', 'runtime_unavailable', 'invalid_state']),
  }).strict(),
]);
export const commanderRunControlChannel = defineInvokeChannel({
  channel: 'commander:run:control',
  request: CommanderRunControlRequest,
  response: CommanderRunControlResponse,
});
export type CommanderRunControlRequest = z.infer<typeof CommanderRunControlRequest>;
export type CommanderRunControlResponse = z.infer<typeof CommanderRunControlResponse>;

// ── commander:run:tree (invoke) ─────────────────────────────
const CommanderRunTreeRequest = z.object({ sessionId: PublicId }).strict();
const CommanderRunTreeResponse = z.object({
  sessionId: PublicId,
  runs: z.array(CommanderRunRecord).max(1_000),
}).strict();
export const commanderRunTreeChannel = defineInvokeChannel({
  channel: 'commander:run:tree',
  request: CommanderRunTreeRequest,
  response: CommanderRunTreeResponse,
});
export type CommanderRunTreeRequest = z.infer<typeof CommanderRunTreeRequest>;
export type CommanderRunTreeResponse = z.infer<typeof CommanderRunTreeResponse>;

// ── commander:events:hydrate (invoke) ───────────────────────
const CommanderEventsHydrateRequest = z.object({
  runId: z.string().min(1),
  afterSeq: z.number().int().min(-1),
});
const CommanderEventsHydrateResponse = z.object({
  run: CommanderRunRecord,
  events: z.array(TimelineEvent),
});
export const commanderEventsHydrateChannel = defineInvokeChannel({
  channel: 'commander:events:hydrate',
  request: CommanderEventsHydrateRequest,
  response: CommanderEventsHydrateResponse,
});
export type CommanderEventsHydrateRequest = z.infer<typeof CommanderEventsHydrateRequest>;
export type CommanderEventsHydrateResponse = z.infer<typeof CommanderEventsHydrateResponse>;

// ── Channel tuples ──────────────────────────────────────────
export const commanderChannels = [
  commanderStartChannel,
  commanderCancelChannel,
  commanderCancelStepChannel,
  commanderInjectMessageChannel,
  commanderToolDecisionChannel,
  commanderToolAnswerChannel,
  commanderCompactChannel,
  commanderRunGetChannel,
  commanderRunControlChannel,
  commanderRunTreeChannel,
  commanderEventsHydrateChannel,
] as const;

export const commanderPushChannels = [
  commanderStreamChannel,
  commanderCanvasDispatchChannel,
  commanderEntitiesUpdatedChannel,
  commanderSettingsDispatchChannel,
] as const;
