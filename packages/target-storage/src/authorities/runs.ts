import {
  EntityIdSchema,
  IsoTimestampSchema,
  RevisionSchema,
  RunActivationEndReasonSchema,
  RunActivationSchema,
  RunInboxMessageSchema,
  RunTerminalStateSchema,
  SequenceSchema,
  Sha256Schema,
  WireSuccessV1Schema,
  assertInboxStateTransition,
  assertRunStateTransition,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type Run,
  type RunActivation,
  type RunEvent,
  type RunInboxMessage,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  executeWireMutation,
  readWireMutationReceipt,
  TargetCommandContextSchema,
  type TargetCommandContext,
} from '../internal/command.js';
import {
  appendMessageInTransaction,
  loadMessage,
  type AppendMessageInTransactionIdentity,
} from '../internal/conversation-write.js';
import {
  decodeCursor as decodeOpaqueCursor,
  encodeCursor as encodeOpaqueCursor,
} from '../internal/cursor.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import {
  closeRunActivation,
  loadActiveRunActivation,
  loadRunActivation,
  loadRunActivations,
} from '../internal/run-activation-records.js';
import {
  insertRunInboxMessage,
  listRunInbox,
  nextRunInboxSequence,
  updateRunInboxState,
} from '../internal/run-inbox.js';
import {
  appendRunEventBatch,
  loadPublicRunEventForCommand,
  loadPublicRunEvents,
  type AppendRunEventBatchInput,
} from '../internal/run-journal.js';
import { advanceRunJournalHead, loadRun } from '../internal/run-records.js';
import {
  acceptRootRunInTransaction,
  assertSelectedContext,
  findActiveRootRun,
  parseMessageSendAcceptanceSeed,
  type MessageSendAcceptanceSeed,
} from '../internal/root-run-acceptance.js';
import { hashCanonical } from '../internal/hashes.js';
import { finalizeTaskList, loadTaskList, replaceTaskList } from '../internal/task-list-records.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { PrivateRecoveryCodec } from '../kernel/private-recovery-codec.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import {
  delegateChildRun,
  type ChildDelegationInput,
  type ChildDelegationResult,
} from '../internal/child-run-delegation.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];

const RunEventCursorSchema = strictObject({
  filterHash: Sha256Schema,
  sequence: SequenceSchema,
});
const InboxTransitionInputSchema = strictObject({
  runId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  inboxMessageId: EntityIdSchema,
  sequence: SequenceSchema,
  action: z.enum(['deliver', 'consume', 'cancel']),
  commandId: EntityIdSchema,
});
const ActivationStartInputSchema = strictObject({
  runId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  commandId: EntityIdSchema,
});
const ActivationEndInputSchema = strictObject({
  runId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  activationNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: RunActivationEndReasonSchema,
  commandId: EntityIdSchema,
});
const HostRunTerminalizeInputSchema = strictObject({
  runId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  status: RunTerminalStateSchema,
  summary: z.string().trim().min(1).max(100_000),
  resultIds: z.array(EntityIdSchema).max(1_000),
  commandId: EntityIdSchema,
});

export type InboxTransitionInput = z.output<typeof InboxTransitionInputSchema>;
export type ActivationStartInput = z.output<typeof ActivationStartInputSchema>;
export type ActivationEndInput = z.output<typeof ActivationEndInputSchema>;
export type HostRunTerminalizeInput = z.output<typeof HostRunTerminalizeInputSchema>;

type RunEventDraft = AppendRunEventBatchInput['events'][number];

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) {
    throw new TargetStorageError('INVALID_REQUEST', `Expected Wire method ${method}`);
  }
  return request as Request<Method>;
}

function success<Method extends WireSuccessV1['method']>(
  request: Request<Method>,
  result: unknown,
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as Success<Method>;
}

function assertExpectedRun(run: Run, expectedRevision: number): void {
  if (run.revision !== expectedRevision) {
    throw new TargetStorageError('REVISION_CONFLICT', `Run ${run.id} revision does not match`);
  }
  if (RunTerminalStateSchema.safeParse(run.status).success) {
    throw new TargetStorageError('INVALID_REQUEST', `Terminal Run ${run.id} cannot be changed`);
  }
}

function journalContext(contextValue: TargetCommandContext): TargetCommandContext {
  return parseCanonical(TargetCommandContextSchema, contextValue);
}

function eventId(environment: TargetStorageEnvironment): string {
  return environment.createId('run_event');
}

function appendInboxEvents(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  run: Run,
  inbox: RunInboxMessage,
  commandId: string,
  occurredAt: string,
  context: TargetCommandContext,
) {
  const events: AppendRunEventBatchInput['events'] = [
    {
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'inbox_state_changed',
        inboxMessageId: inbox.id,
        sequence: inbox.sequence,
        state: inbox.state,
      },
    },
  ];
  if (inbox.state === 'consumed') {
    events.push({
      eventId: eventId(environment),
      visibility: 'model_surface',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'inbox_consumed',
        inboxMessageId: inbox.id,
        sequence: inbox.sequence,
        contentHash: inbox.contentHash,
      },
    });
    if (inbox.source.kind === 'message') {
      const message = loadMessage(database, inbox.source.messageId);
      if (
        message.contentHash !== inbox.source.contentHash ||
        message.contentHash !== inbox.contentHash
      ) {
        throw new TargetStorageError(
          'CORRUPT_DATA',
          `Inbox ${inbox.id} Message content hash does not match`,
        );
      }
      events.push({
        eventId: eventId(environment),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'message_ref',
          role: message.role,
          messageId: message.id,
          messageHash: message.contentHash,
        },
      });
    }
  }
  const appended = appendRunEventBatch(database, {
    runId: run.id,
    commandId,
    events,
  });
  if (appended.length !== events.length)
    throw new TargetStorageError('CORRUPT_DATA', 'Inbox event was not appended');
  return appended;
}

function assertNoNonterminalDescendants(database: DatabaseSync, run: Run): void {
  const descendant = database
    .prepare(
      `WITH RECURSIVE descendants(id, status) AS (
         SELECT id, status FROM runs WHERE parent_run_id = ?
         UNION ALL
         SELECT child.id, child.status
         FROM runs AS child
         JOIN descendants AS parent ON child.parent_run_id = parent.id
       )
       SELECT id FROM descendants
       WHERE status NOT IN ('completed', 'blocked', 'failed', 'cancelled')
       LIMIT 1`,
    )
    .get(run.id) as unknown as { id: string } | undefined;
  if (descendant !== undefined) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Run ${run.id} has a nonterminal descendant: ${descendant.id}`,
    );
  }
}

function assertRunTransition(before: Run, status: Run['status']): void {
  try {
    assertRunStateTransition(before.status, status);
  } catch (cause) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Run transition ${before.status} -> ${status} is invalid`,
      { cause },
    );
  }
}

function terminalizeActiveTaskList(
  database: DatabaseSync,
  run: Run,
  status: z.output<typeof RunTerminalStateSchema>,
  occurredAt: string,
) {
  const before = loadTaskList(database, run.id);
  if (before === null || before.state !== 'active') return null;
  const after = finalizeTaskList({
    ...before,
    state: status === 'completed' ? 'completed' : 'cancelled',
    revision: before.revision + 1,
    updatedAt: occurredAt,
    terminalizedAt: occurredAt,
  });
  replaceTaskList(database, before, after);
  return after;
}

function cancelPendingRunWork(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  run: Run,
  occurredAt: string,
  context: TargetCommandContext,
): RunEventDraft[] {
  const invalidInteraction = database
    .prepare(
      `SELECT id FROM run_interactions
       WHERE run_id = ? AND state = 'pending'
         AND (answer_message_id IS NOT NULL OR resolved_at IS NOT NULL)
       LIMIT 1`,
    )
    .get(run.id) as unknown as { readonly id: string } | undefined;
  if (invalidInteraction !== undefined) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Pending Run interaction ${invalidInteraction.id} already has resolution evidence`,
    );
  }
  database
    .prepare(
      `UPDATE run_interactions
       SET state = 'cancelled', resolved_at = ?
       WHERE run_id = ? AND state = 'pending'`,
    )
    .run(occurredAt, run.id);

  return listRunInbox(database, run.id)
    .filter(({ state }) => state === 'queued')
    .map((before) => {
      const inbox = updateRunInboxState(database, before, 'cancelled');
      return {
        eventId: eventId(environment),
        visibility: 'public' as const,
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'inbox_state_changed' as const,
          inboxMessageId: inbox.id,
          sequence: inbox.sequence,
          state: inbox.state,
        },
      };
    });
}

export function terminalizeRunInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  before: Run,
  status: z.output<typeof RunTerminalStateSchema>,
  commandId: string,
  occurredAt: string,
  context: TargetCommandContext,
  terminal: { summary: string; resultIds: string[] },
  leadingEvents: RunEventDraft[] = [],
): { run: Run; events: RunEvent[] } {
  assertRunTransition(before, status);
  assertNoNonterminalDescendants(database, before);

  const activation = loadActiveRunActivation(database, before.id);
  const taskList = terminalizeActiveTaskList(database, before, status, occurredAt);
  const drafts: RunEventDraft[] = [
    ...leadingEvents,
    ...(status === 'cancelled'
      ? cancelPendingRunWork(database, environment, before, occurredAt, context)
      : []),
  ];
  let activationOrdinal: number | null = null;
  if (activation !== null) {
    activationOrdinal = drafts.length;
    drafts.push({
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'activation_changed',
        activationNumber: activation.activation.activationNumber,
        state: 'ended',
        endReason: 'terminal',
      },
    });
  }
  if (taskList !== null) {
    drafts.push({
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'task_list_changed',
        taskListId: taskList.id,
        revision: taskList.revision,
        publicSummary: terminal.summary,
      },
    });
  }
  drafts.push(
    {
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'run_state_changed',
        previousState: before.status,
        state: status,
        runRevision: before.revision + 1,
      },
    },
    {
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'terminal_summary',
        status,
        summary: terminal.summary,
        resultIds: terminal.resultIds,
      },
    },
  );
  const events = appendRunEventBatch(database, { runId: before.id, commandId, events: drafts });
  const head = events.at(-1);
  if (head === undefined) throw new TargetStorageError('CORRUPT_DATA', 'Run event batch is empty');
  if (activation !== null && activationOrdinal !== null) {
    closeRunActivation(
      database,
      activation,
      events[activationOrdinal]!.sequence,
      occurredAt,
      'terminal',
    );
  }
  const run = advanceRunJournalHead(
    database,
    before,
    { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
    {
      status,
      terminalOutcome: {
        status,
        summary: terminal.summary,
        terminalEventId: head.eventId,
        finishedAt: occurredAt,
      },
    },
  );
  return { run, events };
}

function transitionRun(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  before: Run,
  status: Run['status'],
  commandId: string,
  occurredAt: string,
  context: TargetCommandContext,
  terminal: { summary: string; resultIds: string[] } | null,
): Run {
  if (terminal !== null) {
    return terminalizeRunInTransaction(
      database,
      environment,
      before,
      parseCanonical(RunTerminalStateSchema, status),
      commandId,
      occurredAt,
      context,
      terminal,
    ).run;
  }
  assertRunTransition(before, status);

  const activation = status === 'paused' ? loadActiveRunActivation(database, before.id) : null;
  const drafts: RunEventDraft[] = [];
  let activationOrdinal: number | null = null;
  if (activation !== null) {
    activationOrdinal = drafts.length;
    drafts.push({
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'activation_changed',
        activationNumber: activation.activation.activationNumber,
        state: 'ended',
        endReason: 'paused',
      },
    });
  }
  drafts.push({
    eventId: eventId(environment),
    visibility: 'public',
    occurredAt,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
    payload: {
      type: 'run_state_changed',
      previousState: before.status,
      state: status,
      runRevision: before.revision + 1,
    },
  });
  const events = appendRunEventBatch(database, { runId: before.id, commandId, events: drafts });
  const head = events.at(-1);
  if (head === undefined) throw new TargetStorageError('CORRUPT_DATA', 'Run event batch is empty');
  if (activation !== null && activationOrdinal !== null) {
    closeRunActivation(
      database,
      activation,
      events[activationOrdinal]!.sequence,
      occurredAt,
      'paused',
    );
  }
  return advanceRunJournalHead(
    database,
    before,
    { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
    {
      status,
      terminalOutcome: null,
    },
  );
}

function runGet(database: DatabaseSync, request: Request<'run.get'>): Success<'run.get'> {
  return success<'run.get'>(request, loadRun(database, request.input.runId));
}

function listPublicEvents(
  database: DatabaseSync,
  request: Request<'run.events.list'>,
): Success<'run.events.list'> {
  loadRun(database, request.input.runId);
  const filterHash = hashCanonical({
    runId: request.input.runId,
    afterSequence: request.input.afterSequence,
  });
  const cursorValue = decodeOpaqueCursor(request.input.page.cursor, 'run.events.list');
  let cursor: z.output<typeof RunEventCursorSchema> | null = null;
  if (cursorValue !== null) {
    try {
      cursor = parseCanonical(RunEventCursorSchema, JSON.parse(cursorValue) as unknown);
    } catch (cause) {
      throw new TargetStorageError('INVALID_REQUEST', 'Run event cursor is invalid', { cause });
    }
    if (cursor.filterHash !== filterHash) {
      throw new TargetStorageError('INVALID_REQUEST', 'Run event cursor belongs to another query');
    }
  }
  const cutoff = cursor?.sequence ?? request.input.afterSequence ?? 0;
  const matching = loadPublicRunEvents(database, request.input.runId).filter(
    (event) => event.sequence > cutoff,
  );
  const items = matching.slice(0, request.input.page.limit);
  const last = items.at(-1);
  return success<'run.events.list'>(request, {
    items,
    nextCursor:
      matching.length > items.length && last !== undefined
        ? encodeOpaqueCursor(
            'run.events.list',
            canonicalJson({ filterHash, sequence: last.sequence }),
          )
        : null,
  });
}

interface FollowupEnqueueIds {
  readonly messageIdentity: AppendMessageInTransactionIdentity;
  readonly inboxId: string;
  readonly runEventId: string;
}

function createFollowupEnqueueIds(
  environment: TargetStorageEnvironment,
  occurredAt: string,
): FollowupEnqueueIds {
  return {
    messageIdentity: {
      messageId: environment.createId('message'),
      eventId: environment.createId('project_event'),
      searchDocumentId: environment.createId('project_search_document'),
      createdAt: occurredAt,
    },
    inboxId: environment.createId('run_inbox_message'),
    runEventId: eventId(environment),
  };
}

function enqueueFollowupInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'run.sendFollowup'>,
  context: TargetCommandContext,
  run: Run,
  ids: FollowupEnqueueIds,
  occurredAt: string,
): RunInboxMessage {
  assertSelectedContext(database, run.projectId, request.input.selectedContext);
  const { message } = appendMessageInTransaction(
    database,
    environment,
    context,
    {
      chatId: run.chatId,
      role: 'user',
      status: 'accepted',
      originatingRunId: null,
      blocks: [{ type: 'text', text: request.input.text }],
      attachments: [],
      supersedesMessageId: null,
      idempotencyKey: request.requestId,
    },
    ids.messageIdentity,
  );
  const inbox = parseCanonical(RunInboxMessageSchema, {
    id: ids.inboxId,
    runId: run.id,
    sequence: nextRunInboxSequence(database, run.id),
    actor: 'user',
    source: { kind: 'message', messageId: message.id, contentHash: message.contentHash },
    selectedContext: request.input.selectedContext,
    contentHash: message.contentHash,
    state: 'queued',
    createdAt: occurredAt,
  });
  insertRunInboxMessage(database, inbox);
  const [event] = appendRunEventBatch(database, {
    runId: run.id,
    commandId: request.requestId,
    events: [
      {
        eventId: ids.runEventId,
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'inbox_state_changed',
          inboxMessageId: inbox.id,
          sequence: inbox.sequence,
          state: inbox.state,
        },
      },
    ],
  });
  if (event === undefined) throw new TargetStorageError('CORRUPT_DATA', 'Follow-up event missing');
  advanceRunJournalHead(database, run, {
    eventId: event.eventId,
    sequence: event.sequence,
    eventHash: event.eventHash,
  });
  return inbox;
}

function sendFollowup(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'run.sendFollowup'>,
  contextValue: TargetCommandContext,
  seedInput: MessageSendAcceptanceSeed,
): Success<'run.sendFollowup'> {
  const receipt = readWireMutationReceipt<Request<'run.sendFollowup'>, Success<'run.sendFollowup'>>(
    database,
    request,
    contextValue,
    seedInput,
  );
  if (receipt !== undefined) return receipt;
  const seed = parseMessageSendAcceptanceSeed(seedInput);
  const context = journalContext(contextValue);
  const occurredAt = environment.now();
  return executeWireMutation(
    database,
    request,
    context,
    occurredAt,
    () => {
      const before = loadRun(database, request.input.runId);
      if (!RunTerminalStateSchema.safeParse(before.status).success) {
        assertExpectedRun(before, request.input.expectedRevision);
        const inbox = enqueueFollowupInTransaction(
          database,
          environment,
          request,
          context,
          before,
          createFollowupEnqueueIds(environment, occurredAt),
          occurredAt,
        );
        return {
          projectId: before.projectId,
          response: success<'run.sendFollowup'>(request, inbox),
        };
      }

      if (before.parentRunId !== null) {
        throw new TargetStorageError(
          'INVALID_REQUEST',
          `Terminal child Run ${before.id} cannot accept a follow-up`,
        );
      }
      if (request.input.expectedRevision > before.revision) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Run ${before.id} revision does not match`,
        );
      }

      const activeRoot = findActiveRootRun(database, before.chatId);
      if (activeRoot !== null) {
        const inbox = enqueueFollowupInTransaction(
          database,
          environment,
          request,
          context,
          activeRoot,
          createFollowupEnqueueIds(environment, occurredAt),
          occurredAt,
        );
        return {
          projectId: activeRoot.projectId,
          response: success<'run.sendFollowup'>(request, inbox),
        };
      }

      const accepted = acceptRootRunInTransaction(
        database,
        environment,
        {
          chatId: before.chatId,
          blocks: [{ type: 'text', text: request.input.text }],
          attachments: [],
          selectedContext: request.input.selectedContext,
          supersedesMessageId: null,
          idempotencyKey: request.requestId,
        },
        context,
        seed,
        occurredAt,
      );
      return {
        projectId: accepted.projectId,
        response: success<'run.sendFollowup'>(request, accepted.inbox),
      };
    },
    seed,
  );
}

function transitionInbox(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: InboxTransitionInput,
  contextValue: TargetCommandContext,
): RunInboxMessage {
  const input = parseCanonical(InboxTransitionInputSchema, inputValue);
  const context = journalContext(contextValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
  return withImmediateTransaction(database, () => {
    const run = loadRun(database, input.runId);
    assertExpectedRun(run, input.expectedRevision);
    const inbox = listRunInbox(database, run.id);
    const earliest = inbox.find(({ state }) => state !== 'consumed' && state !== 'cancelled');
    if (
      earliest === undefined ||
      earliest.id !== input.inboxMessageId ||
      earliest.sequence !== input.sequence
    ) {
      throw new TargetStorageError('INVALID_REQUEST', 'Inbox messages must advance in FIFO order');
    }
    const state =
      input.action === 'deliver'
        ? ('delivered' as const)
        : input.action === 'consume'
          ? ('consumed' as const)
          : ('cancelled' as const);
    try {
      assertInboxStateTransition(earliest.state, state);
    } catch (cause) {
      throw new TargetStorageError('INVALID_REQUEST', `Inbox transition is invalid`, { cause });
    }
    const after = updateRunInboxState(database, earliest, state);
    const events = appendInboxEvents(
      database,
      environment,
      run,
      after,
      input.commandId,
      occurredAt,
      context,
    );
    const head = events.at(-1);
    if (head === undefined) throw new TargetStorageError('CORRUPT_DATA', 'Inbox event is missing');
    advanceRunJournalHead(database, run, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return after;
  });
}

function startActivation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: ActivationStartInput,
  contextValue: TargetCommandContext,
): RunActivation {
  const input = parseCanonical(ActivationStartInputSchema, inputValue);
  const context = journalContext(contextValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
  const activationId = environment.createId('run_activation');
  return withImmediateTransaction(database, () => {
    const run = loadRun(database, input.runId);
    assertExpectedRun(run, input.expectedRevision);
    if (run.status !== 'accepted' && run.status !== 'running' && run.status !== 'recovering') {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Run ${run.id} cannot start an Activation while ${run.status}`,
      );
    }
    const existing = loadRunActivations(database, run.id);
    if (existing.some(({ state }) => state === 'active')) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Run ${run.id} already has an active Activation`,
      );
    }
    if (run.parentRunId === null) {
      const competing = database
        .prepare(
          `SELECT activation.id
           FROM run_activations AS activation
           JOIN runs AS active_run ON active_run.id = activation.run_id
           WHERE active_run.chat_id = ? AND active_run.parent_run_id IS NULL
             AND active_run.id <> ? AND activation.state = 'active'
           LIMIT 1`,
        )
        .get(run.chatId, run.id);
      if (competing !== undefined) {
        throw new TargetStorageError(
          'INVALID_REQUEST',
          `Chat ${run.chatId} has an active root Run`,
        );
      }
    }
    const trigger = listRunInbox(database, run.id).find(
      ({ state }) => state !== 'consumed' && state !== 'cancelled',
    );
    if (trigger === undefined || trigger.state !== 'delivered') {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        'Activation requires the earliest Inbox message to be delivered',
      );
    }
    if ((existing.at(-1)?.triggerInboxSequence ?? 0) >= trigger.sequence) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        'A new Activation requires a later delivered Inbox message',
      );
    }
    const activationNumber = (existing.at(-1)?.activationNumber ?? 0) + 1;
    const startsRun = run.status === 'accepted';
    if (startsRun) assertRunTransition(run, 'running');
    const drafts: RunEventDraft[] = [];
    if (startsRun) {
      drafts.push({
        eventId: eventId(environment),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'run_state_changed',
          previousState: run.status,
          state: 'running',
          runRevision: run.revision + 1,
        },
      });
    }
    drafts.push({
      eventId: eventId(environment),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'activation_changed',
        activationNumber,
        state: 'active',
        endReason: null,
      },
    });
    const events = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: drafts,
    });
    const event = events.at(-1);
    if (event === undefined)
      throw new TargetStorageError('CORRUPT_DATA', 'Activation event missing');
    const activation = parseCanonical(RunActivationSchema, {
      runId: run.id,
      activationNumber,
      triggerInboxMessageId: trigger.id,
      triggerInboxSequence: trigger.sequence,
      state: 'active',
      eventStartSequence: event.sequence,
      eventEndSequence: null,
      startedAt: occurredAt,
      endedAt: null,
      endReason: null,
    });
    database
      .prepare(
        `INSERT INTO run_activations (
           id, run_id, activation_number, trigger_inbox_message_id, trigger_inbox_sequence,
           state, event_start_sequence, event_end_sequence, started_at, ended_at, end_reason
         ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, ?, NULL, NULL)`,
      )
      .run(
        activationId,
        activation.runId,
        activation.activationNumber,
        activation.triggerInboxMessageId,
        activation.triggerInboxSequence,
        activation.eventStartSequence,
        activation.startedAt,
      );
    advanceRunJournalHead(
      database,
      run,
      { eventId: event.eventId, sequence: event.sequence, eventHash: event.eventHash },
      startsRun ? { status: 'running', terminalOutcome: null } : undefined,
    );
    return activation;
  });
}

function endActivation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: ActivationEndInput,
  contextValue: TargetCommandContext,
): RunActivation {
  const input = parseCanonical(ActivationEndInputSchema, inputValue);
  const context = journalContext(contextValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
  const runEventId = eventId(environment);
  return withImmediateTransaction(database, () => {
    const run = loadRun(database, input.runId);
    assertExpectedRun(run, input.expectedRevision);
    const record = loadRunActivation(database, run.id, input.activationNumber);
    if (record === null) {
      throw new TargetStorageError(
        'NOT_FOUND',
        `Run Activation was not found: ${run.id}/${input.activationNumber}`,
      );
    }
    const before = record.activation;
    if (before.state !== 'active') {
      throw new TargetStorageError('INVALID_REQUEST', `Activation ${input.activationNumber} ended`);
    }
    const [event] = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: [
        {
          eventId: runEventId,
          visibility: 'public',
          occurredAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'activation_changed',
            activationNumber: before.activationNumber,
            state: 'ended',
            endReason: input.reason,
          },
        },
      ],
    });
    if (event === undefined)
      throw new TargetStorageError('CORRUPT_DATA', 'Activation event missing');
    const after = parseCanonical(RunActivationSchema, {
      ...before,
      state: 'ended',
      eventEndSequence: event.sequence,
      endedAt: occurredAt,
      endReason: input.reason,
    });
    closeRunActivation(database, record, event.sequence, occurredAt, input.reason);
    advanceRunJournalHead(database, run, {
      eventId: event.eventId,
      sequence: event.sequence,
      eventHash: event.eventHash,
    });
    return after;
  });
}

function controlRun(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'run.control'>,
  contextValue: TargetCommandContext,
): Success<'run.control'> {
  const receipt = readWireMutationReceipt<Request<'run.control'>, Success<'run.control'>>(
    database,
    request,
    contextValue,
  );
  if (receipt !== undefined) return receipt;
  const context = journalContext(contextValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
  return executeWireMutation(database, request, context, occurredAt, () => {
    const before = loadRun(database, request.input.runId);
    if (before.revision !== request.input.expectedRevision) {
      throw new TargetStorageError('REVISION_CONFLICT', `Run ${before.id} revision does not match`);
    }
    if (before.status !== request.input.expectedStatus) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Run ${before.id} status does not match ${request.input.expectedStatus}`,
      );
    }
    const status =
      request.input.action === 'pause'
        ? ('paused' as const)
        : request.input.action === 'resume'
          ? ('running' as const)
          : ('cancelled' as const);
    const after = transitionRun(
      database,
      environment,
      before,
      status,
      request.requestId,
      occurredAt,
      context,
      request.input.action === 'cancel'
        ? { summary: request.input.terminalSummary, resultIds: [] }
        : null,
    );
    return { projectId: before.projectId, response: success<'run.control'>(request, after) };
  });
}

function terminalizeRun(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: HostRunTerminalizeInput,
  contextValue: TargetCommandContext,
): Run {
  const input = parseCanonical(HostRunTerminalizeInputSchema, inputValue);
  const context = journalContext(contextValue);
  const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
  return withImmediateTransaction(database, () => {
    if (loadPublicRunEventForCommand(database, input.runId, input.commandId) !== undefined) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Run terminal command was already applied: ${input.commandId}`,
      );
    }
    const before = loadRun(database, input.runId);
    if (before.revision !== input.expectedRevision) {
      throw new TargetStorageError('REVISION_CONFLICT', `Run ${before.id} revision does not match`);
    }
    return transitionRun(
      database,
      environment,
      before,
      input.status,
      input.commandId,
      occurredAt,
      context,
      { summary: input.summary, resultIds: input.resultIds },
    );
  });
}

export interface RunsAuthority {
  readonly get: (request: Request<'run.get'>) => Success<'run.get'>;
  readonly listPublicEvents: (request: Request<'run.events.list'>) => Success<'run.events.list'>;
  readonly sendFollowup: (
    request: Request<'run.sendFollowup'>,
    context: TargetCommandContext,
    seed: MessageSendAcceptanceSeed,
  ) => Success<'run.sendFollowup'>;
  readonly control: (
    request: Request<'run.control'>,
    context: TargetCommandContext,
  ) => Success<'run.control'>;
  readonly terminalize: (input: HostRunTerminalizeInput, context: TargetCommandContext) => Run;
  readonly spawnChild: (
    input: ChildDelegationInput,
    context: TargetCommandContext,
  ) => ChildDelegationResult;
  readonly listInbox: (runId: string) => RunInboxMessage[];
  readonly transitionInbox: (
    input: InboxTransitionInput,
    context: TargetCommandContext,
  ) => RunInboxMessage;
  readonly listActivations: (runId: string) => RunActivation[];
  readonly startActivation: (
    input: ActivationStartInput,
    context: TargetCommandContext,
  ) => RunActivation;
  readonly endActivation: (
    input: ActivationEndInput,
    context: TargetCommandContext,
  ) => RunActivation;
}

export function createRunsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
): RunsAuthority {
  const authority: RunsAuthority = {
    get(request) {
      return runGet(getTargetStoreDatabase(store), exactRequest(request, 'run.get'));
    },
    listPublicEvents(request) {
      return listPublicEvents(
        getTargetStoreDatabase(store),
        exactRequest(request, 'run.events.list'),
      );
    },
    sendFollowup(request, context, seed) {
      return sendFollowup(
        getTargetStoreDatabase(store),
        environment,
        exactRequest(request, 'run.sendFollowup'),
        context,
        seed,
      );
    },
    control(request, context) {
      return controlRun(
        getTargetStoreDatabase(store),
        environment,
        exactRequest(request, 'run.control'),
        context,
      );
    },
    terminalize(input, context) {
      return terminalizeRun(getTargetStoreDatabase(store), environment, input, context);
    },
    spawnChild(input, context) {
      return delegateChildRun(
        getTargetStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    listInbox(runId) {
      const database = getTargetStoreDatabase(store);
      loadRun(database, runId);
      return listRunInbox(database, runId);
    },
    transitionInbox(input, context) {
      return transitionInbox(getTargetStoreDatabase(store), environment, input, context);
    },
    listActivations(runId) {
      return loadRunActivations(getTargetStoreDatabase(store), runId);
    },
    startActivation(input, context) {
      return startActivation(getTargetStoreDatabase(store), environment, input, context);
    },
    endActivation(input, context) {
      return endActivation(getTargetStoreDatabase(store), environment, input, context);
    },
  };
  return Object.freeze(authority);
}
