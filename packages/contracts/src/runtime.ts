import { z } from 'zod';
import {
  CapabilityIndexEntrySchema,
  CapabilityToolDocumentV1Schema,
  SkillIndexEntrySchema,
} from './capability-catalog.js';
import { canonicalJson, parseCanonical, strictObject } from './canonical.js';
import { MessageAttachmentSchema, MessageBlockSchema } from './conversation.js';
import { ScopedDeliveryDestinationIntentSchema } from './delivery.js';
import { AttemptStateSchema, AttemptTerminalStateSchema } from './operation.js';
import {
  CountAmountSchema,
  EntityIdSchema,
  EventHeadSchema,
  IsoTimestampSchema,
  PositiveCountSchema,
  ProviderModelSchema,
  ResourceAmountSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
} from './primitives.js';
import { ProviderContinuationUnavailableSchema } from './run.js';
import { toolOutcomeSchema } from './tools/common.js';
import {
  AgentSendDurableInputSchema,
  AgentSpawnDurableInputSchema,
} from './tools/control-tools.js';
import { ToolProgramDurableInputSchema } from './tools/catalog.js';
import { EXACT_TOOL_IDS, ToolIdSchema } from './tools/ids.js';

export {
  AgentSendDurableInputSchema,
  AgentSpawnDurableInputSchema,
} from './tools/control-tools.js';
export { ToolProgramDurableInputSchema } from './tools/catalog.js';

export const MINIMAL_SYSTEM_PROMPT_VERSION = 'commander-minimal-v1' as const;

const CanonicalObjectSchema = z.record(z.string().min(1).max(200), z.json());

export const ModelResourceQuoteV1Schema = strictObject({
  inputTokens: CountAmountSchema,
  outputTokens: CountAmountSchema,
  cost: ResourceAmountSchema,
});

const AssistantDeltaEventSchema = strictObject({
  type: z.literal('assistant_delta'),
  publicText: z.string().min(1).max(200_000),
});
const ToolCallEventSchema = strictObject({
  type: z.literal('tool_call'),
  providerCallId: z.string().min(1).max(500),
  toolId: ToolIdSchema,
  canonicalArguments: CanonicalObjectSchema,
});
const DurableToolCallEventSchema = ToolCallEventSchema.superRefine((event, context) => {
  const schema =
    event.toolId === 'agent.spawn'
      ? AgentSpawnDurableInputSchema
      : event.toolId === 'agent.send'
        ? AgentSendDurableInputSchema
        : event.toolId === 'tool.program'
          ? ToolProgramDurableInputSchema
          : null;
  if (schema === null) return;
  const parsed = schema.safeParse(event.canonicalArguments);
  if (parsed.success) return;
  context.addIssue({
    code: 'custom',
    path: ['canonicalArguments'],
    message: `A durable ${event.toolId} model call must contain only its safe input`,
  });
});
const UsageEventSchema = strictObject({
  type: z.literal('usage'),
  usage: ModelResourceQuoteV1Schema,
});
const ModelCheckpointEventSchema = strictObject({
  type: z.literal('model_checkpoint'),
  continuation: ProviderContinuationUnavailableSchema,
});
const ModelCompletedEventSchema = strictObject({
  type: z.literal('model_completed'),
  finishReason: z.enum(['stop', 'tool_calls', 'length', 'content_filter']),
});
export const ModelAdapterFailureCodeSchema = z.enum([
  'cancelled',
  'invalid_request',
  'provider_unavailable',
  'provider_rejected',
  'provider_failed',
  'provider_state_unknown',
  'process_interrupted',
]);
export const ModelAdapterRetrySafetySchema = z.enum([
  'safe',
  'before_submission',
  'receipt_reconcile_only',
  'never',
]);
export const ModelAdapterProviderStateSchema = z.enum([
  'not_submitted',
  'submitted',
  'unknown',
  'terminal',
]);
const ModelFailedEventSchema = strictObject({
  type: z.literal('model_failed'),
  typedCode: ModelAdapterFailureCodeSchema,
  retrySafety: ModelAdapterRetrySafetySchema,
  providerState: ModelAdapterProviderStateSchema,
});

export const ModelAdapterEventSchema = z.union([
  AssistantDeltaEventSchema,
  ToolCallEventSchema,
  UsageEventSchema,
  ModelCheckpointEventSchema,
  ModelCompletedEventSchema,
  ModelFailedEventSchema,
]);

const DurableModelAdapterEventSchema = z.union([
  AssistantDeltaEventSchema,
  DurableToolCallEventSchema,
  UsageEventSchema,
  ModelCheckpointEventSchema,
  ModelCompletedEventSchema,
  ModelFailedEventSchema,
]);

function canonicalModelResponseSchema<EventSchema extends z.ZodType>(eventSchema: EventSchema) {
  return strictObject({
    version: z.literal(1),
    events: z.array(eventSchema).min(2).max(10_000),
  }).superRefine(({ events }, context) => {
    const modelEvents = events as readonly z.output<typeof ModelAdapterEventSchema>[];
    const terminalIndexes = modelEvents.flatMap((event, index) =>
      event.type === 'model_completed' || event.type === 'model_failed' ? [index] : [],
    );
    if (terminalIndexes.length !== 1 || terminalIndexes[0] !== modelEvents.length - 1) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'A canonical model response must end at exactly one terminal event',
      });
    }

    const usageCount = modelEvents.filter(({ type }) => type === 'usage').length;
    if (usageCount !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'A canonical model response must contain exactly one usage event',
      });
    }
    if (modelEvents.filter(({ type }) => type === 'model_checkpoint').length > 1) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'A canonical model response may contain at most one checkpoint marker',
      });
    }

    const calls = modelEvents.filter((event) => event.type === 'tool_call');
    if (new Set(calls.map(({ providerCallId }) => providerCallId)).size !== calls.length) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Provider tool call IDs must be unique within one canonical response',
      });
    }
    const terminal = modelEvents.at(-1);
    if (terminal?.type === 'model_completed') {
      if ((terminal.finishReason === 'tool_calls') !== calls.length > 0) {
        context.addIssue({
          code: 'custom',
          path: ['events', modelEvents.length - 1, 'finishReason'],
          message: 'Tool calls must have one explicit completed tool-call boundary',
        });
      }
    } else if (calls.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'A failed model response cannot leave an orphan tool call',
      });
    }
  });
}

/** In-process raw adapter output; agent.spawn objectives must never be persisted or surfaced. */
export const CanonicalModelResponseV1Schema = canonicalModelResponseSchema(ModelAdapterEventSchema);

/** Persisted ModelAttempt response; agent.spawn has been irreversibly sanitized. */
export const DurableCanonicalModelResponseV1Schema = canonicalModelResponseSchema(
  DurableModelAdapterEventSchema,
);

export const RuntimeLoopOutcomeSchema = toolOutcomeSchema(CanonicalObjectSchema);

const MessageModelFactSchema = strictObject({
  type: z.literal('message'),
  eventSequence: SequenceSchema,
  messageId: EntityIdSchema,
  role: z.enum(['user', 'assistant']),
  messageHash: Sha256Schema,
  blocks: z.array(MessageBlockSchema).min(1).max(1_000),
  attachments: z.array(MessageAttachmentSchema).max(100),
});
const DeliveryDestinationModelFactSchema = strictObject({
  type: z.literal('delivery_destination'),
  eventSequence: SequenceSchema,
  inboxMessageId: EntityIdSchema,
  destination: ScopedDeliveryDestinationIntentSchema,
  expiresAt: IsoTimestampSchema,
  grantBindingHash: Sha256Schema,
});
const ToolCallModelFactSchema = strictObject({
  type: z.literal('tool_call'),
  eventSequence: SequenceSchema,
  dispatchOperationId: EntityIdSchema,
  providerCallId: z.string().min(1).max(500),
  toolId: ToolIdSchema,
  canonicalArguments: CanonicalObjectSchema,
  argumentsHash: Sha256Schema,
});
const ToolResultModelFactSchema = strictObject({
  type: z.literal('tool_result'),
  eventSequence: SequenceSchema,
  dispatchOperationId: EntityIdSchema,
  providerCallId: z.string().min(1).max(500),
  toolId: ToolIdSchema,
  outcome: RuntimeLoopOutcomeSchema,
  outcomeHash: Sha256Schema,
});
const ParentDirectionModelFactSchema = strictObject({
  type: z.literal('parent_direction'),
  eventSequence: SequenceSchema,
  inboxMessageId: EntityIdSchema,
  parentRunId: EntityIdSchema,
  parentEventId: EntityIdSchema,
  directionHash: Sha256Schema,
});
export const CanonicalModelFactV1Schema = z.union([
  MessageModelFactSchema,
  DeliveryDestinationModelFactSchema,
  ToolCallModelFactSchema,
  ToolResultModelFactSchema,
  ParentDirectionModelFactSchema,
]);

const ImmutableIdentitySchema = strictObject({ id: EntityIdSchema, hash: Sha256Schema });
const CompactionModelViewSchema = strictObject({
  id: EntityIdSchema,
  hash: Sha256Schema,
  summary: z.string().min(1).max(200_000),
});

export const CanonicalModelRequestV1Schema = strictObject({
  version: z.literal(1),
  runId: EntityIdSchema,
  modelAttemptId: EntityIdSchema,
  activationId: EntityIdSchema,
  activationNumber: PositiveCountSchema,
  attemptNumber: PositiveCountSchema,
  provider: ProviderModelSchema,
  runRevision: RevisionSchema,
  runContentHash: Sha256Schema,
  contextManifest: ImmutableIdentitySchema,
  capabilityCatalog: ImmutableIdentitySchema,
  eventHead: EventHeadSchema,
  compactionView: CompactionModelViewSchema.nullable(),
  facts: z.array(CanonicalModelFactV1Schema).min(1).max(10_000),
  capabilityIndex: z.array(CapabilityIndexEntrySchema).length(EXACT_TOOL_IDS.length),
  skillIndex: z.array(SkillIndexEntrySchema).max(500),
  materializedTools: z.array(CapabilityToolDocumentV1Schema).max(EXACT_TOOL_IDS.length),
  locale: z
    .string()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/),
  limits: strictObject({
    maxInputTokens: PositiveCountSchema,
    maxOutputTokens: PositiveCountSchema,
  }),
  reasoningStrength: z.string().trim().min(1).max(80).nullable(),
  systemPromptVersion: z.literal(MINIMAL_SYSTEM_PROMPT_VERSION),
}).superRefine((request, context) => {
  if (request.reasoningStrength !== request.provider.reasoningStrength) {
    context.addIssue({
      code: 'custom',
      path: ['reasoningStrength'],
      message: 'Request reasoning strength must match the resolved provider',
    });
  }
  request.capabilityIndex.forEach((entry, index) => {
    if (entry.name !== EXACT_TOOL_IDS[index]) {
      context.addIssue({
        code: 'custom',
        path: ['capabilityIndex', index, 'name'],
        message: `A model request must retain the exact ordered ${EXACT_TOOL_IDS.length}-tool index`,
      });
    }
  });
  request.skillIndex.forEach((entry, index) => {
    const previous = request.skillIndex[index - 1];
    if (
      previous !== undefined &&
      (previous.id > entry.id || (previous.id === entry.id && previous.version >= entry.version))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['skillIndex', index],
        message: 'Skill index entries must be unique and sorted by ID and version',
      });
    }
  });

  const indexByName = new Map(request.capabilityIndex.map((entry) => [entry.name, entry]));
  request.materializedTools.forEach((tool, index) => {
    const previous = request.materializedTools[index - 1];
    const entry = indexByName.get(tool.id);
    if (previous !== undefined && previous.id >= tool.id) {
      context.addIssue({
        code: 'custom',
        path: ['materializedTools', index],
        message: 'Materialized tools must be unique and sorted by ID',
      });
    }
    if (
      entry === undefined ||
      entry.version !== tool.version ||
      entry.schemaDigest !== tool.schemaDigest
    ) {
      context.addIssue({
        code: 'custom',
        path: ['materializedTools', index],
        message: 'A materialized tool must match the frozen capability index',
      });
    }
  });

  const openCalls = new Map<string, { providerCallId: string; toolId: string; index: number }>();
  request.facts.forEach((fact, index) => {
    const previous = request.facts[index - 1];
    if (previous !== undefined && previous.eventSequence >= fact.eventSequence) {
      context.addIssue({
        code: 'custom',
        path: ['facts', index, 'eventSequence'],
        message: 'Model facts must be unique and strictly ordered by Run event sequence',
      });
    }
    if (fact.eventSequence > request.eventHead.sequence) {
      context.addIssue({
        code: 'custom',
        path: ['facts', index, 'eventSequence'],
        message: 'A model fact cannot be newer than the bound Run event head',
      });
    }
    if (fact.type === 'tool_call') {
      if (openCalls.has(fact.dispatchOperationId)) {
        context.addIssue({
          code: 'custom',
          path: ['facts', index, 'dispatchOperationId'],
          message: 'A dispatch Operation can appear as a tool call only once',
        });
      }
      openCalls.set(fact.dispatchOperationId, {
        providerCallId: fact.providerCallId,
        toolId: fact.toolId,
        index,
      });
    }
    if (fact.type === 'tool_result') {
      const call = openCalls.get(fact.dispatchOperationId);
      if (
        call === undefined ||
        call.providerCallId !== fact.providerCallId ||
        call.toolId !== fact.toolId
      ) {
        context.addIssue({
          code: 'custom',
          path: ['facts', index],
          message: 'A tool result must match one earlier canonical tool call',
        });
      } else {
        openCalls.delete(fact.dispatchOperationId);
      }
    }
  });
  for (const { index } of openCalls.values()) {
    context.addIssue({
      code: 'custom',
      path: ['facts', index],
      message: 'A canonical model request cannot contain an unresolved tool call',
    });
  }
});

export const ModelAttemptRecordV1Schema = strictObject({
  id: EntityIdSchema,
  runId: EntityIdSchema,
  activationId: EntityIdSchema,
  attemptNumber: PositiveCountSchema,
  provider: ProviderModelSchema,
  state: AttemptStateSchema,
  request: CanonicalModelRequestV1Schema,
  requestHash: Sha256Schema,
  response: DurableCanonicalModelResponseV1Schema.nullable(),
  responseHash: Sha256Schema.nullable(),
  usage: ModelResourceQuoteV1Schema.nullable(),
  createdAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.nullable(),
}).superRefine((attempt, context) => {
  if (
    attempt.runId !== attempt.request.runId ||
    attempt.id !== attempt.request.modelAttemptId ||
    attempt.activationId !== attempt.request.activationId ||
    attempt.attemptNumber !== attempt.request.attemptNumber ||
    canonicalJson(attempt.provider) !== canonicalJson(attempt.request.provider)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['request'],
      message: 'Model Attempt identity and provider must match its canonical request',
    });
  }

  const terminalState = AttemptTerminalStateSchema.safeParse(attempt.state).success;
  if (terminalState !== (attempt.finishedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['finishedAt'],
      message: 'Model Attempt terminal state and finishedAt must agree',
    });
  }
  if (
    (attempt.response === null) !== (attempt.responseHash === null) ||
    (attempt.response === null) !== (attempt.usage === null)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: 'Canonical response, response hash, and usage must share one persistence boundary',
    });
    return;
  }
  if (terminalState && attempt.response === null) {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: 'A terminal Model Attempt requires its canonical response',
    });
    return;
  }
  if (
    (attempt.state === 'prepared' ||
      attempt.state === 'running' ||
      attempt.state === 'submitted') &&
    attempt.response !== null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: `Model Attempt state ${attempt.state} cannot have a terminal response`,
    });
  }
  if (attempt.response === null || attempt.usage === null) return;

  const responseUsage = attempt.response.events.find((event) => event.type === 'usage');
  if (
    responseUsage === undefined ||
    canonicalJson(responseUsage.usage) !== canonicalJson(attempt.usage)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['usage'],
      message: 'Persisted model usage must match the canonical response usage event',
    });
  }
  const responseTerminal = attempt.response.events.at(-1);
  if (attempt.state === 'succeeded' && responseTerminal?.type !== 'model_completed') {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: 'A succeeded Model Attempt requires a completed response',
    });
  }
  if (
    (attempt.state === 'failed' || attempt.state === 'cancelled' || attempt.state === 'unknown') &&
    responseTerminal?.type !== 'model_failed'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: `Model Attempt state ${attempt.state} requires a failed response`,
    });
  }
  if (
    attempt.state === 'unknown' &&
    responseTerminal?.type === 'model_failed' &&
    responseTerminal.providerState !== 'unknown' &&
    responseTerminal.providerState !== 'submitted'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: 'An unknown Model Attempt requires unresolved provider state',
    });
  }
  if (
    attempt.state === 'cancelled' &&
    responseTerminal?.type === 'model_failed' &&
    responseTerminal.typedCode !== 'cancelled'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: 'A cancelled Model Attempt requires the typed cancellation code',
    });
  }
});

export function canonicalModelRequestHashInput(
  request: z.input<typeof CanonicalModelRequestV1Schema>,
) {
  return parseCanonical(CanonicalModelRequestV1Schema, request);
}

export function canonicalModelResponseHashInput(
  response: z.input<typeof CanonicalModelResponseV1Schema>,
) {
  return parseCanonical(CanonicalModelResponseV1Schema, response);
}

export function durableCanonicalModelResponseHashInput(
  response: z.input<typeof DurableCanonicalModelResponseV1Schema>,
) {
  return parseCanonical(DurableCanonicalModelResponseV1Schema, response);
}

export function runtimeLoopOutcomeHashInput(outcome: z.input<typeof RuntimeLoopOutcomeSchema>) {
  return parseCanonical(RuntimeLoopOutcomeSchema, outcome);
}

export type ModelResourceQuoteV1 = z.infer<typeof ModelResourceQuoteV1Schema>;
export type ModelAdapterEvent = z.infer<typeof ModelAdapterEventSchema>;
export type CanonicalModelResponseV1 = z.infer<typeof CanonicalModelResponseV1Schema>;
export type DurableCanonicalModelResponseV1 = z.infer<typeof DurableCanonicalModelResponseV1Schema>;
export type RuntimeLoopOutcome = z.infer<typeof RuntimeLoopOutcomeSchema>;
export type CanonicalModelFactV1 = z.infer<typeof CanonicalModelFactV1Schema>;
export type CanonicalModelRequestV1 = z.infer<typeof CanonicalModelRequestV1Schema>;
export type ModelAttemptRecordV1 = z.infer<typeof ModelAttemptRecordV1Schema>;
