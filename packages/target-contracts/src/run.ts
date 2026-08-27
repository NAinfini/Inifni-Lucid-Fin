import { z } from 'zod';
import {
  CapabilityCatalogSnapshotV1Schema,
  CapabilityIndexEntrySchema,
  SkillDocumentSchema,
} from './capability-catalog.js';
import { canonicalJson, strictObject } from './canonical.js';
import {
  ActorSchema,
  CausationRefSchema,
  CountAmountSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  EventHeadSchema,
  IsoTimestampSchema,
  PermissionModeSchema,
  PositiveCountSchema,
  ProviderModelSchema,
  ResourceAmountSchema,
  ResourceBudgetSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
  assertPolicyNarrowing,
} from './primitives.js';
import { ProjectSettingsSchema } from './project.js';
import {
  DeliveryDestinationGrantV1Schema,
  DeliveryFormatIntentSchema,
  DeliveryManifestRefSchema,
  DeliveryRefSchema,
} from './delivery.js';
import { ProductionRefSchema } from './production.js';
import { ProtectedFieldRefSchema } from './protection.js';
import {
  AttemptStateSchema,
  AttemptStateTransitions,
  OperationRefSchema,
  OperationPublicErrorCodeSchema,
} from './operation.js';
import { ToolVersionSchema } from './tools/common.js';
import { EXACT_TOOL_IDS, ToolIdSchema } from './tools/ids.js';

export const RunStateSchema = z.enum([
  'accepted',
  'running',
  'waiting_question',
  'waiting_confirmation',
  'paused',
  'recovering',
  'completed',
  'blocked',
  'failed',
  'cancelled',
]);

export const RunTerminalStateSchema = z.enum(['completed', 'blocked', 'failed', 'cancelled']);

export const RunStateTransitions = Object.freeze({
  accepted: Object.freeze(['running', 'cancelled']),
  running: Object.freeze([
    'waiting_question',
    'waiting_confirmation',
    'paused',
    'recovering',
    'completed',
    'blocked',
    'failed',
    'cancelled',
  ]),
  waiting_question: Object.freeze(['running', 'cancelled']),
  waiting_confirmation: Object.freeze(['running', 'cancelled']),
  paused: Object.freeze(['running', 'cancelled']),
  recovering: Object.freeze(['running', 'blocked', 'failed', 'cancelled']),
  completed: Object.freeze([]),
  blocked: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
} satisfies {
  [State in z.infer<typeof RunStateSchema>]: readonly z.infer<typeof RunStateSchema>[];
});

export function assertRunStateTransition(
  from: z.infer<typeof RunStateSchema>,
  to: z.infer<typeof RunStateSchema>,
): void {
  if (RunTerminalStateSchema.safeParse(from).success) {
    throw new Error(`Run terminal state ${from} cannot transition to ${to}`);
  }
  const allowed: readonly z.infer<typeof RunStateSchema>[] = RunStateTransitions[from];
  if (!allowed.includes(to)) throw new Error(`Illegal run transition ${from} -> ${to}`);
}

export const MessageAcceptedSourceSchema = strictObject({
  kind: z.literal('message'),
  messageId: EntityIdSchema,
  contentHash: Sha256Schema,
});
export const ParentDirectionSourceSchema = strictObject({
  kind: z.literal('parent_direction'),
  parentRunId: EntityIdSchema,
  parentEventId: EntityIdSchema,
  directionHash: Sha256Schema,
});
export const RunAcceptedSourceSchema = z.union([
  MessageAcceptedSourceSchema,
  ParentDirectionSourceSchema,
]);

export const RunTerminalOutcomeSchema = strictObject({
  status: RunTerminalStateSchema,
  summary: z.string().min(1).max(100_000),
  terminalEventId: EntityIdSchema,
  finishedAt: IsoTimestampSchema,
});

const runCommonShape = {
  authority: z.literal('run'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  rootRunId: EntityIdSchema,
  retryOfRunId: EntityIdSchema.nullable(),
  retrySeedHash: Sha256Schema.nullable(),
  projectId: EntityIdSchema,
  chatId: EntityIdSchema,
  status: RunStateSchema,
  model: ProviderModelSchema,
  permissionMode: PermissionModeSchema,
  budget: ResourceBudgetSchema,
  contextManifestId: EntityIdSchema,
  contextManifestHash: Sha256Schema,
  capabilityCatalogSnapshotId: EntityIdSchema,
  capabilityCatalogHash: Sha256Schema,
  publicEventHead: EventHeadSchema.nullable(),
  privateRecoveryHead: EventHeadSchema.nullable(),
  acceptedAt: IsoTimestampSchema,
  terminalOutcome: RunTerminalOutcomeSchema.nullable(),
} as const;

const RootRunSchema = strictObject({
  ...runCommonShape,
  parentRunId: z.null(),
  acceptedSource: MessageAcceptedSourceSchema,
}).superRefine((run, context) => {
  if (run.rootRunId !== run.id) {
    context.addIssue({
      code: 'custom',
      path: ['rootRunId'],
      message: 'Root Run must name itself as rootRunId',
    });
  }
  if ((run.retryOfRunId === null) !== (run.retrySeedHash === null)) {
    context.addIssue({
      code: 'custom',
      path: ['retrySeedHash'],
      message: 'Retry Run lineage ID and seed hash must be paired',
    });
  }
  if (run.retryOfRunId === run.id) {
    context.addIssue({
      code: 'custom',
      path: ['retryOfRunId'],
      message: 'Retry Run cannot name itself as its source Run',
    });
  }
});

const ChildRunSchema = strictObject({
  ...runCommonShape,
  parentRunId: EntityIdSchema,
  acceptedSource: ParentDirectionSourceSchema,
  displayName: z.string().trim().min(1).max(240),
  publicSummary: z.string().trim().min(1).max(20_000),
}).superRefine((run, context) => {
  if (run.rootRunId === run.id || run.parentRunId === run.id) {
    context.addIssue({
      code: 'custom',
      path: ['rootRunId'],
      message: 'Child Run cannot name itself as root or parent',
    });
  }
  if (run.acceptedSource.parentRunId !== run.parentRunId) {
    context.addIssue({
      code: 'custom',
      path: ['acceptedSource', 'parentRunId'],
      message: 'Child Run source must name the exact parent Run',
    });
  }
  if (run.retryOfRunId !== null || run.retrySeedHash !== null) {
    context.addIssue({
      code: 'custom',
      path: ['retryOfRunId'],
      message: 'Child Run cannot carry crash retry lineage',
    });
  }
});

export const RunSchema = z.union([RootRunSchema, ChildRunSchema]).superRefine((run, context) => {
  const terminal = RunTerminalStateSchema.safeParse(run.status).success;
  if (terminal !== (run.terminalOutcome !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['terminalOutcome'],
      message: 'Terminal Run state and terminal outcome must agree',
    });
  } else if (run.terminalOutcome !== null && run.terminalOutcome.status !== run.status) {
    context.addIssue({
      code: 'custom',
      path: ['terminalOutcome', 'status'],
      message: 'Terminal outcome status must match Run status',
    });
  }
});

export const SelectedContextRefSchema = strictObject({
  ref: DomainObjectRefSchema,
  role: z.enum(['selected', 'reference', 'target']),
});
export const ContextMediaRefSchema = strictObject({
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  blobHash: Sha256Schema,
  role: z.enum(['reference', 'input', 'attachment']),
});
export const ReadyMemoryContextSchema = strictObject({
  state: z.literal('ready'),
  derivationVersion: z.string().min(1).max(80),
  watermark: CountSchema,
  citedEntryIds: z.array(EntityIdSchema).max(1_000),
  sourceSetHash: Sha256Schema,
});
export const UnavailableMemoryContextSchema = strictObject({
  state: z.literal('unavailable'),
  reason: z.enum(['not_built', 'failed', 'disabled']),
});
export const StaleMemoryContextSchema = strictObject({
  state: z.literal('stale'),
  derivationVersion: z.string().min(1).max(80),
  watermark: CountSchema,
  activeHistoryWatermark: CountSchema,
  sourceSetHash: Sha256Schema,
});
export const MemoryContextSchema = z.union([
  ReadyMemoryContextSchema,
  UnavailableMemoryContextSchema,
  StaleMemoryContextSchema,
]);

export const ContextManifestSchema = strictObject({
  authority: z.literal('context_manifest'),
  id: EntityIdSchema,
  runId: EntityIdSchema,
  retryOfRunId: EntityIdSchema.nullable(),
  retrySeedHash: Sha256Schema.nullable(),
  projectId: EntityIdSchema,
  projectRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite(),
  projectSettings: ProjectSettingsSchema,
  chatId: EntityIdSchema,
  acceptedSource: RunAcceptedSourceSchema,
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
  selectedContext: z.array(SelectedContextRefSchema).max(1_000),
  projectMedia: z.array(ContextMediaRefSchema).max(1_000),
  attachments: z.array(ContextMediaRefSchema).max(100),
  historyWatermark: CountSchema,
  memory: MemoryContextSchema,
  model: ProviderModelSchema,
  permissionMode: PermissionModeSchema,
  budget: ResourceBudgetSchema,
  capabilityCatalogSnapshotId: EntityIdSchema,
  capabilityCatalogHash: Sha256Schema,
  capabilityIndex: z.array(CapabilityIndexEntrySchema).max(EXACT_TOOL_IDS.length),
  capabilityIndexDigest: Sha256Schema,
  skillCatalogDigest: Sha256Schema,
  createdAt: IsoTimestampSchema,
}).superRefine((manifest, context) => {
  if (manifest.acceptedSource.kind === 'message') {
    if ((manifest.retryOfRunId === null) !== (manifest.retrySeedHash === null)) {
      context.addIssue({
        code: 'custom',
        path: ['retrySeedHash'],
        message: 'Retry Manifest lineage ID and seed hash must be paired',
      });
    }
    if (manifest.retryOfRunId === manifest.runId) {
      context.addIssue({
        code: 'custom',
        path: ['retryOfRunId'],
        message: 'Retry Manifest cannot name its own Run as its source',
      });
    }
  } else if (manifest.retryOfRunId !== null || manifest.retrySeedHash !== null) {
    context.addIssue({
      code: 'custom',
      path: ['retryOfRunId'],
      message: 'Child Manifest cannot carry crash retry lineage',
    });
  }
  if (manifest.projectSettings.projectId !== manifest.projectId) {
    context.addIssue({
      code: 'custom',
      path: ['projectSettings', 'projectId'],
      message: 'Manifest Project settings must belong to the selected Project',
    });
  }
  if (manifest.acceptedSource.kind === 'message') {
    if (manifest.projectSettings.permission !== manifest.permissionMode) {
      context.addIssue({
        code: 'custom',
        path: ['permissionMode'],
        message: 'Root Manifest permission must exactly match Project settings',
      });
    }
    if (canonicalJson(manifest.projectSettings.budget) !== canonicalJson(manifest.budget)) {
      context.addIssue({
        code: 'custom',
        path: ['budget'],
        message: 'Root Manifest budget must exactly match Project settings',
      });
    }
  } else {
    try {
      assertPolicyNarrowing(
        manifest.projectSettings.permission,
        manifest.projectSettings.budget,
        manifest.permissionMode,
        manifest.budget,
      );
    } catch (cause) {
      context.addIssue({
        code: 'custom',
        path: ['permissionMode'],
        message: cause instanceof Error ? cause.message : 'Child Manifest policy exceeds settings',
      });
    }
  }
  if (
    manifest.capabilityIndex.some(
      (entry, index) => index > 0 && manifest.capabilityIndex[index - 1]!.name >= entry.name,
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['capabilityIndex'],
      message: 'Manifest capability index must be unique and sorted by name',
    });
  }
});

export function assertRunContextManifest(
  runInput: unknown,
  manifestInput: unknown,
  catalogInput?: unknown,
): void {
  const run = RunSchema.parse(runInput);
  const manifest = ContextManifestSchema.parse(manifestInput);
  if (
    manifest.id !== run.contextManifestId ||
    manifest.runId !== run.id ||
    manifest.projectId !== run.projectId ||
    manifest.chatId !== run.chatId ||
    manifest.retryOfRunId !== run.retryOfRunId ||
    manifest.retrySeedHash !== run.retrySeedHash ||
    canonicalJson(manifest.acceptedSource) !== canonicalJson(run.acceptedSource) ||
    manifest.permissionMode !== run.permissionMode ||
    canonicalJson(manifest.budget) !== canonicalJson(run.budget) ||
    manifest.capabilityCatalogSnapshotId !== run.capabilityCatalogSnapshotId ||
    manifest.capabilityCatalogHash !== run.capabilityCatalogHash
  ) {
    throw new Error('Run and ContextManifest identities, source, policy, or catalog differ');
  }
  if (catalogInput !== undefined) {
    const catalog = CapabilityCatalogSnapshotV1Schema.parse(catalogInput);
    if (
      catalog.catalogHash !== manifest.capabilityCatalogHash ||
      catalog.capabilityIndexDigest !== manifest.capabilityIndexDigest ||
      catalog.skillCatalogDigest !== manifest.skillCatalogDigest ||
      canonicalJson(catalog.capabilityIndex) !== canonicalJson(manifest.capabilityIndex)
    ) {
      throw new Error('ContextManifest capability catalog projection differs from its snapshot');
    }
  }
}

const CrashRetrySeedSourceSchema = strictObject({
  sourceRunId: EntityIdSchema,
  sourceRunContentHash: Sha256Schema,
});

export function crashRetrySeedHashInput(input: unknown) {
  const source = CrashRetrySeedSourceSchema.parse(input);
  return {
    version: 1,
    kind: 'crash_retry',
    sourceRunId: source.sourceRunId,
    sourceRunContentHash: source.sourceRunContentHash,
  } as const;
}

export const TaskItemStateSchema = z.enum([
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
]);
export const TaskItemSchema = strictObject({
  id: EntityIdSchema,
  title: z.string().trim().min(1).max(500),
  state: TaskItemStateSchema,
  order: CountSchema,
  parentItemId: EntityIdSchema.nullable(),
  childRunIds: z.array(EntityIdSchema).max(100),
  publicNote: z.string().max(4_000),
});
export const TaskListStateSchema = z.enum(['active', 'completed', 'cancelled']);
export const TaskListSchema = strictObject({
  authority: z.literal('task_list'),
  id: EntityIdSchema,
  runId: EntityIdSchema,
  title: z.string().trim().min(1).max(500),
  state: TaskListStateSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  items: z.array(TaskItemSchema).max(1_000),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  terminalizedAt: IsoTimestampSchema.nullable(),
}).superRefine((taskList, context) => {
  const terminal = taskList.state !== 'active';
  if (terminal !== (taskList.terminalizedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['terminalizedAt'],
      message: 'TaskList state and terminal timestamp must agree',
    });
  }

  const itemById = new Map<string, (typeof taskList.items)[number]>();
  const childRunIds = new Set<string>();
  taskList.items.forEach((item, index) => {
    if (itemById.has(item.id)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'id'],
        message: 'Task item IDs must be unique',
      });
    }
    itemById.set(item.id, item);
    item.childRunIds.forEach((childRunId, childIndex) => {
      if (childRunIds.has(childRunId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'childRunIds', childIndex],
          message: 'A child Run may be attached to only one Task item',
        });
      }
      childRunIds.add(childRunId);
    });
  });

  const siblingOrders = new Map<string, number[]>();
  taskList.items.forEach((item, index) => {
    if (item.parentItemId !== null && !itemById.has(item.parentItemId)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'parentItemId'],
        message: 'Task parent must belong to the same TaskList',
      });
    }
    const siblingKey = item.parentItemId ?? '';
    const orders = siblingOrders.get(siblingKey) ?? [];
    orders.push(item.order);
    siblingOrders.set(siblingKey, orders);

    const visited = new Set([item.id]);
    let parentId = item.parentItemId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'parentItemId'],
          message: 'Task parent relationships cannot contain cycles',
        });
        break;
      }
      visited.add(parentId);
      parentId = itemById.get(parentId)?.parentItemId ?? null;
    }
  });
  for (const orders of siblingOrders.values()) {
    const sorted = [...orders].sort((left, right) => left - right);
    if (sorted.some((order, index) => order !== index)) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Sibling Task order must be unique and contiguous from zero',
      });
    }
  }
});

export const TaskListStateTransitions = Object.freeze({
  active: Object.freeze(['completed', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
} satisfies {
  [State in z.infer<typeof TaskListStateSchema>]: readonly z.infer<typeof TaskListStateSchema>[];
});

export const TaskItemStateTransitions = Object.freeze({
  pending: Object.freeze(['in_progress', 'blocked', 'completed', 'cancelled']),
  in_progress: Object.freeze(['pending', 'blocked', 'completed', 'cancelled']),
  blocked: Object.freeze(['pending', 'in_progress', 'cancelled']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
} satisfies {
  [State in z.infer<typeof TaskItemStateSchema>]: readonly z.infer<typeof TaskItemStateSchema>[];
});

export function assertTaskItemStateTransition(
  from: z.infer<typeof TaskItemStateSchema>,
  to: z.infer<typeof TaskItemStateSchema>,
): void {
  if (from === 'completed' || from === 'cancelled') {
    throw new Error(`Task item terminal state ${from} cannot transition to ${to}`);
  }
  const allowed: readonly z.infer<typeof TaskItemStateSchema>[] = TaskItemStateTransitions[from];
  if (!allowed.includes(to)) throw new Error(`Illegal Task item transition ${from} -> ${to}`);
}

export function assertTaskListStateTransition(
  from: z.infer<typeof TaskListStateSchema>,
  to: z.infer<typeof TaskListStateSchema>,
): void {
  if (from !== 'active')
    throw new Error(`TaskList terminal state ${from} cannot transition to ${to}`);
  const allowed: readonly z.infer<typeof TaskListStateSchema>[] = TaskListStateTransitions[from];
  if (!allowed.includes(to)) throw new Error(`Illegal TaskList transition ${from} -> ${to}`);
}

export const RunInboxStateSchema = z.enum(['queued', 'delivered', 'consumed', 'cancelled']);
export const RunInboxMessageSchema = strictObject({
  id: EntityIdSchema,
  runId: EntityIdSchema,
  sequence: SequenceSchema,
  actor: z.enum(['user', 'commander']),
  source: RunAcceptedSourceSchema,
  selectedContext: z.array(SelectedContextRefSchema).max(1_000),
  exportDestinationGrant: DeliveryDestinationGrantV1Schema.nullable(),
  contentHash: Sha256Schema,
  state: RunInboxStateSchema,
  createdAt: IsoTimestampSchema,
}).superRefine((message, context) => {
  const sourceHash =
    message.source.kind === 'message' ? message.source.contentHash : message.source.directionHash;
  if (sourceHash !== message.contentHash) {
    context.addIssue({
      code: 'custom',
      path: ['contentHash'],
      message: 'Inbox content hash must match its accepted source hash',
    });
  }
  if (
    message.exportDestinationGrant !== null &&
    (message.actor !== 'user' || message.source.kind !== 'message')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['exportDestinationGrant'],
      message: 'Only a user Message Inbox entry may carry an export destination grant',
    });
  }
});

export const RunInboxStateTransitions = Object.freeze({
  queued: Object.freeze(['delivered', 'cancelled']),
  delivered: Object.freeze(['consumed']),
  consumed: Object.freeze([]),
  cancelled: Object.freeze([]),
} satisfies {
  [State in z.infer<typeof RunInboxStateSchema>]: readonly z.infer<typeof RunInboxStateSchema>[];
});

export function assertInboxStateTransition(
  from: z.infer<typeof RunInboxStateSchema>,
  to: z.infer<typeof RunInboxStateSchema>,
): void {
  if (from === 'consumed' || from === 'cancelled') {
    throw new Error(`Inbox terminal state ${from} cannot transition to ${to}`);
  }
  const allowed: readonly z.infer<typeof RunInboxStateSchema>[] = RunInboxStateTransitions[from];
  if (!allowed.includes(to)) throw new Error(`Illegal Inbox transition ${from} -> ${to}`);
}

export function assertInboxOrdering(input: readonly unknown[]): void {
  const messages = input.map((message) => RunInboxMessageSchema.parse(message));
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const previous = messages[index - 1];
    if (previous !== undefined) {
      if (message.runId !== previous.runId) throw new Error('Inbox entries must belong to one Run');
      if (message.sequence <= previous.sequence)
        throw new Error('Inbox sequence must be monotonic');
    }
    if (
      message.state === 'consumed' &&
      messages
        .slice(0, index)
        .some((earlier) => earlier.state !== 'consumed' && earlier.state !== 'cancelled')
    ) {
      throw new Error('Inbox messages must be consumed FIFO');
    }
  }
}

export const RunActivationStateSchema = z.enum(['active', 'ended']);
export const RunActivationEndReasonSchema = z.enum([
  'safe_boundary',
  'waiting',
  'paused',
  'terminal',
  'process_exit',
  'failure',
]);
export const RunActivationSchema = strictObject({
  runId: EntityIdSchema,
  activationNumber: PositiveCountSchema,
  triggerInboxMessageId: EntityIdSchema,
  triggerInboxSequence: SequenceSchema,
  state: RunActivationStateSchema,
  eventStartSequence: SequenceSchema,
  eventEndSequence: SequenceSchema.nullable(),
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema.nullable(),
  endReason: RunActivationEndReasonSchema.nullable(),
}).superRefine((activation, context) => {
  const ended = activation.state === 'ended';
  const hasCompleteEnd =
    activation.eventEndSequence !== null &&
    activation.endedAt !== null &&
    activation.endReason !== null;
  const hasAnyEnd =
    activation.eventEndSequence !== null ||
    activation.endedAt !== null ||
    activation.endReason !== null;
  if ((ended && !hasCompleteEnd) || (!ended && hasAnyEnd)) {
    context.addIssue({
      code: 'custom',
      message: 'Activation end state requires end sequence, end time, and end reason',
    });
  }
  if (
    activation.eventEndSequence !== null &&
    activation.eventEndSequence < activation.eventStartSequence
  ) {
    context.addIssue({
      code: 'custom',
      path: ['eventEndSequence'],
      message: 'Invalid event range',
    });
  }
});

export function assertActivationStateTransition(
  from: z.infer<typeof RunActivationStateSchema>,
  to: z.infer<typeof RunActivationStateSchema>,
): void {
  if (from === 'ended')
    throw new Error(`Activation terminal state ${from} cannot transition to ${to}`);
  if (to !== 'ended') throw new Error(`Illegal Activation transition ${from} -> ${to}`);
}

export function assertActivationOrdering(input: readonly unknown[]): void {
  const activations = input.map((activation) => RunActivationSchema.parse(activation));
  for (let index = 1; index < activations.length; index += 1) {
    const previous = activations[index - 1];
    const current = activations[index];
    if (current.runId !== previous.runId) throw new Error('Activations must belong to one Run');
    if (current.activationNumber !== previous.activationNumber + 1) {
      throw new Error('Activation number must be monotonic and contiguous');
    }
    if (current.triggerInboxSequence <= previous.triggerInboxSequence) {
      throw new Error('Activation Inbox sequence must be monotonic');
    }
    if (
      previous.eventEndSequence === null ||
      current.eventStartSequence <= previous.eventEndSequence
    ) {
      throw new Error('Activation event ranges must be monotonic and non-overlapping');
    }
  }
}

export const RunTurnBoundarySchema = z.union([
  strictObject({
    type: z.literal('turn_started'),
    activationNumber: PositiveCountSchema,
    turnNumber: PositiveCountSchema,
    inboxMessageId: EntityIdSchema,
  }),
  strictObject({
    type: z.literal('turn_ended'),
    activationNumber: PositiveCountSchema,
    turnNumber: PositiveCountSchema,
    outcome: z.enum(['completed', 'interrupted']),
  }),
]);
export const RunStepBoundarySchema = z.union([
  strictObject({
    type: z.literal('step_started'),
    activationNumber: PositiveCountSchema,
    turnNumber: PositiveCountSchema,
    stepNumber: PositiveCountSchema,
    kind: z.enum(['model', 'tool', 'interaction', 'compaction']),
  }),
  strictObject({
    type: z.literal('step_ended'),
    activationNumber: PositiveCountSchema,
    turnNumber: PositiveCountSchema,
    stepNumber: PositiveCountSchema,
    outcome: z.enum(['completed', 'failed', 'blocked', 'interrupted']),
  }),
]);

export const CompactionStartedSchema = strictObject({
  type: z.literal('compaction_started'),
  transactionId: EntityIdSchema,
  activationNumber: PositiveCountSchema,
  sourceEventFrom: SequenceSchema,
  sourceEventTo: SequenceSchema,
  originalTokenCount: CountSchema,
  model: z.string().min(1).max(200),
  operationFingerprint: Sha256Schema,
});
export const CompactionViewDerivedSchema = strictObject({
  type: z.literal('compaction_view_derived'),
  transactionId: EntityIdSchema,
  viewId: EntityIdSchema,
  sourceEventFrom: SequenceSchema,
  sourceEventTo: SequenceSchema,
  derivedViewHash: Sha256Schema,
  summary: z.string().min(1).max(200_000),
  citedEventSequences: z.array(SequenceSchema).min(1).max(10_000),
  compactedTokenCount: CountSchema,
  operationFingerprint: Sha256Schema,
}).superRefine(({ citedEventSequences }, context) => {
  if (
    citedEventSequences.some(
      (sequence, index) => index > 0 && citedEventSequences[index - 1]! >= sequence,
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['citedEventSequences'],
      message: 'Compaction citations must be unique and strictly increasing',
    });
  }
});
export const CompactionCompletedSchema = strictObject({
  type: z.literal('compaction_completed'),
  transactionId: EntityIdSchema,
  viewId: EntityIdSchema,
  derivedViewHash: Sha256Schema,
  operationFingerprint: Sha256Schema,
});
export const CompactionInterruptedSchema = strictObject({
  type: z.literal('compaction_interrupted'),
  transactionId: EntityIdSchema,
  reason: z.enum(['process_restarted', 'cancelled', 'model_failed', 'validation_failed']),
  operationFingerprint: Sha256Schema,
});
export const CompactionEventSchema = z.union([
  CompactionStartedSchema,
  CompactionViewDerivedSchema,
  CompactionCompletedSchema,
  CompactionInterruptedSchema,
]);

export function validateCompactionTransaction(
  input: readonly unknown[],
): readonly z.infer<typeof CompactionEventSchema>[] {
  const events = input.map((event) => CompactionEventSchema.parse(event));
  const first = events[0];
  if (first?.type !== 'compaction_started') throw new Error('Compaction must start explicitly');
  if (first.sourceEventTo < first.sourceEventFrom)
    throw new Error('Invalid compaction source range');
  let view: z.infer<typeof CompactionViewDerivedSchema> | undefined;
  let terminal = false;

  for (const event of events.slice(1)) {
    if (terminal) throw new Error('Compaction transaction has events after terminal state');
    if (event.transactionId !== first.transactionId) {
      throw new Error('Compaction transaction identity changed');
    }
    if (event.type === 'compaction_view_derived') {
      if (view !== undefined) throw new Error('Compaction has more than one derived view');
      if (
        event.sourceEventFrom !== first.sourceEventFrom ||
        event.sourceEventTo !== first.sourceEventTo
      ) {
        throw new Error('Compaction derived view source range changed');
      }
      if (
        event.citedEventSequences.some(
          (sequence) => sequence < first.sourceEventFrom || sequence > first.sourceEventTo,
        )
      ) {
        throw new Error('Compaction citation falls outside source range');
      }
      view = event;
    } else if (event.type === 'compaction_completed') {
      if (view === undefined) throw new Error('Compaction completed without a derived view');
      if (event.derivedViewHash !== view.derivedViewHash) {
        throw new Error('Compaction completed with a different view hash');
      }
      if (event.viewId !== view.viewId) {
        throw new Error('Compaction completed with a different view identity');
      }
      terminal = true;
    } else if (event.type === 'compaction_interrupted') {
      terminal = true;
    } else {
      throw new Error('Compaction cannot restart inside a transaction');
    }
  }
  if (!terminal) throw new Error('Compaction transaction is not terminal');
  return events;
}

export const ProgressRunEventPayloadSchema = strictObject({
  type: z.literal('progress'),
  summary: z.string().min(1).max(10_000),
});
export const QuestionRunEventPayloadSchema = strictObject({
  type: z.literal('question'),
  interactionId: EntityIdSchema,
  prompt: z.string().min(1).max(20_000),
});

const ProductionMutationPlannedIdsSchema = z.union([
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_create'),
    productionObjectId: EntityIdSchema,
    containmentRelationId: EntityIdSchema.nullable(),
    objectEventId: EntityIdSchema,
    parentEventId: EntityIdSchema.nullable(),
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_update'),
    objectEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_relate_link'),
    relationId: EntityIdSchema,
    sourceEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_relate_unlink'),
    sourceEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_reorder'),
    parentEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_archive'),
    objectEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_restore'),
    objectEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('production.mutate'),
    variant: z.literal('production_cite'),
    factSourceId: EntityIdSchema,
    objectEventId: EntityIdSchema,
  }),
]);

export const ProtectedMutationPlannedIdsSchema = z.union([
  strictObject({
    tool: z.literal('decision.record'),
    userChoiceId: EntityIdSchema,
    projectEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('decision.protect'),
    userChoiceId: EntityIdSchema,
    projectEventId: EntityIdSchema,
  }),
  strictObject({
    tool: z.literal('delivery.mutate'),
    userChoiceId: EntityIdSchema,
    projectEventId: EntityIdSchema,
    deliveryPlanId: EntityIdSchema.nullable(),
    deliveryItemId: EntityIdSchema.nullable(),
  }),
  ProductionMutationPlannedIdsSchema,
]);

const DeliveryExportConfirmationDestinationSchema = strictObject({
  kind: z.enum(['user_selected_file', 'user_selected_folder']),
  displayLabel: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((label) => !label.includes('/') && !label.includes('\\'), {
      message: 'Delivery destination label must be a basename',
    }),
});

export const DeliveryExportConfirmationTargetSchema = strictObject({
  kind: z.literal('delivery_export'),
  manifest: DeliveryManifestRefSchema,
  formatIntent: DeliveryFormatIntentSchema,
  itemCount: z.number().int().min(0).max(20_000).finite(),
  destination: DeliveryExportConfirmationDestinationSchema,
  overwriteExisting: z.boolean(),
  cost: strictObject({
    state: z.literal('known'),
    value: z.literal('0'),
    currency: z.literal('USD'),
  }),
});

export const ConfirmationTargetSchema = z.union([
  strictObject({ kind: z.literal('domain_object'), ref: DomainObjectRefSchema }),
  DeliveryExportConfirmationTargetSchema,
  strictObject({
    kind: z.literal('skill_registration'),
    projectId: EntityIdSchema,
    skill: SkillDocumentSchema.superRefine((skill, context) => {
      if (skill.provenance !== 'project') {
        context.addIssue({
          code: 'custom',
          path: ['provenance'],
          message: 'Registered Skill provenance must be Project',
        });
      }
      if (skill.trust !== 'reviewed') {
        context.addIssue({
          code: 'custom',
          path: ['trust'],
          message: 'Registered Skill trust must be reviewed',
        });
      }
    }),
    expectedProjectSettingsRevision: RevisionSchema,
    expectedProjectSettingsContentHash: Sha256Schema,
    proposedEffectHash: Sha256Schema,
  }),
  strictObject({
    kind: z.literal('protected_mutation'),
    dispatch: strictObject({
      operationId: EntityIdSchema,
      toolId: ToolIdSchema,
      toolVersion: ToolVersionSchema,
      inputHash: Sha256Schema,
      fingerprint: Sha256Schema,
      authorityWatermarkHash: Sha256Schema.nullable(),
    }),
    owner: z.union([ProductionRefSchema, DeliveryRefSchema]),
    fields: z
      .array(ProtectedFieldRefSchema)
      .min(1)
      .max(200)
      .refine(
        (fields) =>
          fields.every(
            (field, index) =>
              index === 0 ||
              canonicalJson(fields[index - 1]).localeCompare(canonicalJson(field)) < 0,
          ),
        { message: 'Confirmation fields must be unique and canonically sorted' },
      ),
    activeChoiceIds: z
      .array(EntityIdSchema)
      .max(200)
      .refine(
        (choiceIds) =>
          choiceIds.every((choiceId, index) => index === 0 || choiceIds[index - 1]! < choiceId),
        { message: 'Active Choice IDs must be unique and sorted' },
      ),
    plannedIds: ProtectedMutationPlannedIdsSchema,
    proposedEffectHash: Sha256Schema,
  }).superRefine((target, context) => {
    if (target.plannedIds.tool !== target.dispatch.toolId) {
      context.addIssue({
        code: 'custom',
        path: ['plannedIds', 'tool'],
        message: 'Confirmation planned IDs must belong to the dispatched tool',
      });
    }
    for (const [index, field] of target.fields.entries()) {
      const matches =
        (field.owner === 'production' &&
          target.owner.authority === 'production' &&
          field.objectId === target.owner.id) ||
        (field.owner === 'delivery' &&
          target.owner.authority === 'delivery' &&
          field.deliveryId === target.owner.id);
      if (!matches) {
        context.addIssue({
          code: 'custom',
          path: ['fields', index],
          message: 'Confirmation fields must belong to the exact owner',
        });
      }
    }
  }),
]);

export const ConfirmationRunEventPayloadSchema = strictObject({
  type: z.literal('confirmation_requested'),
  interactionId: EntityIdSchema,
  confirmationId: EntityIdSchema,
  summary: z.string().min(1).max(20_000),
  target: ConfirmationTargetSchema,
  immutableInputHash: Sha256Schema,
});
export const ToolSummaryRunEventPayloadSchema = strictObject({
  type: z.literal('tool_summary'),
  toolName: z.string().min(1).max(160),
  status: z.enum(['succeeded', 'failed', 'blocked']),
  summary: z.string().min(1).max(20_000),
});
export const UsageRunEventPayloadSchema = strictObject({
  type: z.literal('usage'),
  inputTokens: CountAmountSchema,
  outputTokens: CountAmountSchema,
  cost: ResourceAmountSchema,
});
export const ResultRunEventPayloadSchema = strictObject({
  type: z.literal('result_published'),
  resultId: EntityIdSchema,
  summary: z.string().min(1).max(20_000),
});
export const BlockerRunEventPayloadSchema = strictObject({
  type: z.literal('blocker'),
  code: z.enum([
    'permission_denied',
    'budget_exceeded',
    'revision_conflict',
    'provider_state_unknown',
    'recovery_required',
    'missing_capability',
    'invalid_input',
  ]),
  message: z.string().min(1).max(20_000),
});
export const TerminalSummaryRunEventPayloadSchema = strictObject({
  type: z.literal('terminal_summary'),
  status: RunTerminalStateSchema,
  summary: z.string().min(1).max(100_000),
  resultIds: z.array(EntityIdSchema).max(1_000),
});
export const TaskListRunEventPayloadSchema = strictObject({
  type: z.literal('task_list_changed'),
  taskListId: EntityIdSchema,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite(),
  publicSummary: z.string().min(1).max(10_000),
});
export const ChildRunDelegatedRunEventPayloadSchema = strictObject({
  type: z.literal('child_run_delegated'),
  childRunId: EntityIdSchema,
  displayName: z.string().trim().min(1).max(240),
  publicSummary: z.string().trim().min(1).max(20_000),
  directionHash: Sha256Schema,
  operationFingerprint: Sha256Schema,
});
export const RunStateChangedRunEventPayloadSchema = strictObject({
  type: z.literal('run_state_changed'),
  previousState: RunStateSchema,
  state: RunStateSchema,
  runRevision: RevisionSchema,
}).superRefine((payload, context) => {
  try {
    assertRunStateTransition(payload.previousState, payload.state);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: error instanceof Error ? error.message : 'Invalid Run state transition',
    });
  }
});
export const OperationStateChangedRunEventPayloadSchema = strictObject({
  type: z.literal('operation_state_changed'),
  operation: OperationRefSchema,
  previousRevision: RevisionSchema.nullable(),
  previousState: AttemptStateSchema.nullable(),
  previousCancelRequested: z.boolean().nullable(),
  state: AttemptStateSchema,
  cancelRequested: z.boolean(),
  publicErrorCode: OperationPublicErrorCodeSchema.nullable(),
}).superRefine((payload, context) => {
  const previousValues = [
    payload.previousRevision,
    payload.previousState,
    payload.previousCancelRequested,
  ];
  const initial = previousValues.every((value) => value === null);
  if (!initial && previousValues.some((value) => value === null)) {
    context.addIssue({
      code: 'custom',
      path: ['previousRevision'],
      message: 'Previous Operation fields must be all null or all present',
    });
    return;
  }
  if (initial) {
    if (payload.operation.revision !== 0 || payload.cancelRequested) {
      context.addIssue({
        code: 'custom',
        path: ['operation', 'revision'],
        message: 'Initial Operation event must be uncancelled revision zero',
      });
    }
  } else {
    const previousRevision = payload.previousRevision!;
    const previousState = payload.previousState!;
    const previousCancelRequested = payload.previousCancelRequested!;
    if (payload.operation.revision !== previousRevision + 1) {
      context.addIssue({
        code: 'custom',
        path: ['operation', 'revision'],
        message: 'Operation event revision must advance by one',
      });
    }
    if (previousCancelRequested && !payload.cancelRequested) {
      context.addIssue({
        code: 'custom',
        path: ['cancelRequested'],
        message: 'Operation cancellation intent cannot be withdrawn',
      });
    }
    const stateChanged = previousState !== payload.state;
    const allowedStates: readonly z.output<typeof AttemptStateSchema>[] =
      AttemptStateTransitions[previousState];
    const legalStateChange = allowedStates.includes(payload.state);
    const cancelIntentRecorded =
      !stateChanged && !previousCancelRequested && payload.cancelRequested;
    if ((stateChanged && !legalStateChange) || (!stateChanged && !cancelIntentRecorded)) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Operation event must record a legal state transition or new cancellation intent',
      });
    }
  }
  const expectedError =
    payload.state === 'unknown'
      ? 'provider_state_unknown'
      : payload.state === 'cancelled'
        ? 'cancelled'
        : null;
  if (expectedError !== null && payload.publicErrorCode !== expectedError) {
    context.addIssue({
      code: 'custom',
      path: ['publicErrorCode'],
      message: `Operation state ${payload.state} requires ${expectedError}`,
    });
  } else if (
    payload.state !== 'unknown' &&
    payload.state !== 'cancelled' &&
    payload.state !== 'failed' &&
    payload.publicErrorCode !== null
  ) {
    context.addIssue({
      code: 'custom',
      path: ['publicErrorCode'],
      message: `Operation state ${payload.state} forbids a public error`,
    });
  }
  if (
    payload.state === 'failed' &&
    ![
      'invalid_request',
      'permission_denied',
      'budget_exceeded',
      'provider_failed',
      'execution_failed',
    ].includes(payload.publicErrorCode ?? '')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['publicErrorCode'],
      message: 'Failed Operation state requires a public failure code',
    });
  }
});
export const InboxRunEventPayloadSchema = strictObject({
  type: z.literal('inbox_state_changed'),
  inboxMessageId: EntityIdSchema,
  sequence: SequenceSchema,
  state: RunInboxStateSchema,
});
export const ActivationRunEventPayloadSchema = strictObject({
  type: z.literal('activation_changed'),
  activationNumber: PositiveCountSchema,
  state: RunActivationStateSchema,
  endReason: RunActivationEndReasonSchema.nullable(),
});
export const PublicRunEventPayloadSchema = z.union([
  ProgressRunEventPayloadSchema,
  QuestionRunEventPayloadSchema,
  ConfirmationRunEventPayloadSchema,
  ToolSummaryRunEventPayloadSchema,
  UsageRunEventPayloadSchema,
  ResultRunEventPayloadSchema,
  BlockerRunEventPayloadSchema,
  TerminalSummaryRunEventPayloadSchema,
  TaskListRunEventPayloadSchema,
  ChildRunDelegatedRunEventPayloadSchema,
  RunStateChangedRunEventPayloadSchema,
  OperationStateChangedRunEventPayloadSchema,
  InboxRunEventPayloadSchema,
  ActivationRunEventPayloadSchema,
  RunTurnBoundarySchema,
  RunStepBoundarySchema,
]);

export const MessageRefModelSurfacePayloadSchema = strictObject({
  type: z.literal('message_ref'),
  role: z.enum(['user', 'assistant']),
  messageId: EntityIdSchema,
  messageHash: Sha256Schema,
});
export const DeliveryDestinationRefModelSurfacePayloadSchema = strictObject({
  type: z.literal('delivery_destination_ref'),
  inboxMessageId: EntityIdSchema,
  grantBindingHash: Sha256Schema,
});
export const ToolCallRefModelSurfacePayloadSchema = strictObject({
  type: z.literal('tool_call_ref'),
  callId: EntityIdSchema,
  toolName: z.string().min(1).max(160),
  capabilityCatalogSnapshotId: EntityIdSchema,
  inputPayloadId: EntityIdSchema,
  inputSchemaHash: Sha256Schema,
  inputHash: Sha256Schema,
});
export const ToolResultRefModelSurfacePayloadSchema = strictObject({
  type: z.literal('tool_result_ref'),
  callId: EntityIdSchema,
  toolName: z.string().min(1).max(160),
  outputPayloadId: EntityIdSchema,
  outputSchemaHash: Sha256Schema,
  outputHash: Sha256Schema,
  success: z.boolean(),
});
export const SkillLoadedModelSurfacePayloadSchema = strictObject({
  type: z.literal('skill_loaded'),
  skillId: EntityIdSchema,
  version: z.string().min(1).max(80),
  contentHash: Sha256Schema,
});
export const InboxConsumedModelSurfacePayloadSchema = strictObject({
  type: z.literal('inbox_consumed'),
  inboxMessageId: EntityIdSchema,
  sequence: SequenceSchema,
  contentHash: Sha256Schema,
});
export const InteractionAnsweredModelSurfacePayloadSchema = strictObject({
  type: z.literal('interaction_answered'),
  interactionId: EntityIdSchema,
  messageId: EntityIdSchema,
  messageHash: Sha256Schema,
});
export const ConfirmationAnsweredModelSurfacePayloadSchema = strictObject({
  type: z.literal('confirmation_answered'),
  confirmationId: EntityIdSchema,
  approved: z.boolean(),
  messageId: EntityIdSchema,
  messageHash: Sha256Schema,
});
export const ModelSurfaceRunEventPayloadSchema = z.union([
  MessageRefModelSurfacePayloadSchema,
  DeliveryDestinationRefModelSurfacePayloadSchema,
  ToolCallRefModelSurfacePayloadSchema,
  ToolResultRefModelSurfacePayloadSchema,
  SkillLoadedModelSurfacePayloadSchema,
  InboxConsumedModelSurfacePayloadSchema,
  InteractionAnsweredModelSurfacePayloadSchema,
  ConfirmationAnsweredModelSurfacePayloadSchema,
  CompactionStartedSchema,
  CompactionViewDerivedSchema,
  CompactionCompletedSchema,
  CompactionInterruptedSchema,
]);

const runEventEnvelope = {
  eventId: EntityIdSchema,
  eventVersion: PositiveCountSchema,
  runId: EntityIdSchema,
  sequence: SequenceSchema,
  occurredAt: IsoTimestampSchema,
  actor: ActorSchema,
  causation: CausationRefSchema,
  correlationId: EntityIdSchema.nullable(),
  idempotencyKey: EntityIdSchema.nullable(),
  payloadHash: Sha256Schema,
  previousEventHash: Sha256Schema.nullable(),
  eventHash: Sha256Schema,
} as const;

export const PublicRunEventSchema = strictObject({
  visibility: z.literal('public'),
  ...runEventEnvelope,
  payloadState: z.union([
    strictObject({ state: z.literal('available'), payload: PublicRunEventPayloadSchema }),
    strictObject({ state: z.literal('redacted'), erasedAt: IsoTimestampSchema }),
  ]),
});

export const ModelSurfaceRunEventSchema = strictObject({
  visibility: z.literal('model_surface'),
  ...runEventEnvelope,
  payloadState: z.union([
    strictObject({ state: z.literal('available'), payload: ModelSurfaceRunEventPayloadSchema }),
    strictObject({ state: z.literal('redacted'), erasedAt: IsoTimestampSchema }),
  ]),
});

export const ChildObjectiveRecoveryPayloadV1Schema = strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('child_objective'),
  runId: EntityIdSchema,
  inboxMessageId: EntityIdSchema,
  parentRunId: EntityIdSchema,
  parentEventId: EntityIdSchema,
  parentDispatchOperationId: EntityIdSchema.nullable(),
  directionHash: Sha256Schema,
  objective: z.string().min(1).max(20_000),
});

export const AgentSendRecoveryPayloadV1Schema = strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('agent_send'),
  runId: EntityIdSchema,
  inboxMessageId: EntityIdSchema,
  inboxSequence: SequenceSchema,
  parentRunId: EntityIdSchema,
  parentEventId: EntityIdSchema,
  parentDispatchOperationId: EntityIdSchema,
  directionHash: Sha256Schema,
  message: z.string().min(1).max(20_000),
});

export const EncryptedRecoveryEnvelopeSchema = strictObject({
  boundary: z.literal('private_recovery'),
  id: EntityIdSchema,
  runId: EntityIdSchema,
  sequence: SequenceSchema,
  activationNumber: PositiveCountSchema,
  schemaVersion: PositiveCountSchema,
  algorithm: z.literal('aes-256-gcm'),
  encryptionKeyId: EntityIdSchema,
  nonceBase64: z.string().min(16).max(256),
  ciphertextBase64: z.string().min(1).max(8_000_000),
  authenticationTagBase64: z.string().min(16).max(256),
  ciphertextHash: Sha256Schema,
  aadHash: Sha256Schema,
  previousEnvelopeHash: Sha256Schema.nullable(),
  envelopeHash: Sha256Schema,
  byteLength: CountSchema,
  createdAt: IsoTimestampSchema,
});
export const RunEventSchema = z.union([PublicRunEventSchema, ModelSurfaceRunEventSchema]);

export const ProviderContinuationUnavailableSchema = strictObject({
  state: z.literal('unavailable'),
  reason: z.literal('not_persisted'),
});
export const PROVIDER_CONTINUATION_UNAVAILABLE = Object.freeze(
  ProviderContinuationUnavailableSchema.parse({
    state: 'unavailable',
    reason: 'not_persisted',
  }),
);

export function assertAppendOnlyRunEvents(input: readonly unknown[]): void {
  const events = input.map((event) => RunEventSchema.parse(event));
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const previous = events[index - 1];
    if (previous === undefined) {
      if (event.sequence !== 1 || event.previousEventHash !== null) {
        throw new Error('Run event sequence must start at 1 with no previous hash');
      }
      continue;
    }
    if (event.runId !== previous.runId) throw new Error('Run events must belong to one Run');
    if (event.sequence !== previous.sequence + 1) {
      throw new Error('Run event sequence must be contiguous');
    }
    if (event.previousEventHash !== previous.eventHash) {
      throw new Error('Run event hash chain is broken');
    }
  }
}

export type RunState = z.infer<typeof RunStateSchema>;
export type ProtectedMutationPlannedIds = z.infer<typeof ProtectedMutationPlannedIdsSchema>;
export type RunAcceptedSource = z.infer<typeof RunAcceptedSourceSchema>;
export type SelectedContextRef = z.infer<typeof SelectedContextRefSchema>;
export type Run = z.infer<typeof RunSchema>;
export type ContextManifest = z.infer<typeof ContextManifestSchema>;
export type TaskItem = z.infer<typeof TaskItemSchema>;
export type TaskList = z.infer<typeof TaskListSchema>;
export type RunInboxMessage = z.infer<typeof RunInboxMessageSchema>;
export type RunActivation = z.infer<typeof RunActivationSchema>;
export type RunTurnBoundary = z.infer<typeof RunTurnBoundarySchema>;
export type RunStepBoundary = z.infer<typeof RunStepBoundarySchema>;
export type CompactionEvent = z.infer<typeof CompactionEventSchema>;
export type PublicRunEvent = z.infer<typeof PublicRunEventSchema>;
export type ModelSurfaceRunEvent = z.infer<typeof ModelSurfaceRunEventSchema>;
export type ChildObjectiveRecoveryPayloadV1 = z.infer<typeof ChildObjectiveRecoveryPayloadV1Schema>;
export type AgentSendRecoveryPayloadV1 = z.infer<typeof AgentSendRecoveryPayloadV1Schema>;
export type EncryptedRecoveryEnvelope = z.infer<typeof EncryptedRecoveryEnvelopeSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type ProviderContinuationUnavailable = z.infer<typeof ProviderContinuationUnavailableSchema>;
