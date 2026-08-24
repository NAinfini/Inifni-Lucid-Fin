import {
  CompactionCompletedSchema,
  CompactionInterruptedSchema,
  CompactionStartedSchema,
  CompactionViewDerivedSchema,
  CountSchema,
  EntityIdSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
  parseCanonical,
  strictObject,
  z,
  type ModelSurfaceRunEvent,
  type Run,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  CompactionTransactionRecordSchema,
  CompactionViewRecordSchema,
  assertCompactionJournalProjection,
  compactionViewHash,
  insertCompactionTransaction,
  insertCompactionView,
  loadCompactionTransaction,
  loadCompactionView,
  updateCompactionTransaction,
  type CompactionTransactionRecord,
  type CompactionViewRecord,
} from '../internal/compaction-records.js';
import { TargetCommandContextSchema, type TargetCommandContext } from '../internal/command.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadActiveRunActivation } from '../internal/run-activation-records.js';
import {
  appendRunEventBatch,
  loadRunEventForCommand,
  type AppendRunEventBatchInput,
} from '../internal/run-journal.js';
import { advanceRunJournalHead, loadRun } from '../internal/run-records.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

const StageCommonShape = {
  runId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  expectedRunHash: Sha256Schema,
  transactionId: EntityIdSchema,
} as const;
const CompactionStartInputSchema = strictObject({
  ...StageCommonShape,
  activationNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sourceEventFrom: SequenceSchema,
  sourceEventTo: SequenceSchema,
  originalTokenCount: CountSchema,
  model: z.string().min(1).max(200),
});
const CitationListSchema = z
  .array(SequenceSchema)
  .min(1)
  .max(10_000)
  .superRefine((items, ctx) => {
    if (items.some((item, index) => index > 0 && items[index - 1]! >= item)) {
      ctx.addIssue({ code: 'custom', message: 'Compaction citations must be strictly increasing' });
    }
  });
const CompactionDeriveViewInputSchema = strictObject({
  ...StageCommonShape,
  viewId: EntityIdSchema,
  sourceEventFrom: SequenceSchema,
  sourceEventTo: SequenceSchema,
  summary: z.string().min(1).max(200_000),
  citedEventSequences: CitationListSchema,
  compactedTokenCount: CountSchema,
});
const CompactionCompleteInputSchema = strictObject({
  ...StageCommonShape,
  viewId: EntityIdSchema,
  derivedViewHash: Sha256Schema,
});
const CompactionInterruptInputSchema = strictObject({
  ...StageCommonShape,
  reason: z.enum(['process_restarted', 'cancelled', 'model_failed', 'validation_failed']),
});
const CompactionRestartInputSchema = strictObject(StageCommonShape);

export type CompactionStartInput = z.output<typeof CompactionStartInputSchema>;
export type CompactionDeriveViewInput = z.output<typeof CompactionDeriveViewInputSchema>;
export type CompactionCompleteInput = z.output<typeof CompactionCompleteInputSchema>;
export type CompactionInterruptInput = z.output<typeof CompactionInterruptInputSchema>;
export type CompactionRestartInput = z.output<typeof CompactionRestartInputSchema>;

export interface CompactionStageResult {
  readonly event: ModelSurfaceRunEvent;
  readonly transaction: CompactionTransactionRecord;
  readonly view: CompactionViewRecord | null;
}

type Stage = 'started' | 'view_derived' | 'completed' | 'interrupted';
type RunEventDraft = AppendRunEventBatchInput['events'][number];
type ModelSurfaceRunEventDraft = Extract<RunEventDraft, { visibility: 'model_surface' }>;

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function conflict(message: string): TargetStorageError {
  return new TargetStorageError('IDEMPOTENCY_CONFLICT', message);
}

function parseStageInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  stage: Stage,
): z.output<Schema> {
  try {
    return parseCanonical(schema, value);
  } catch (cause) {
    throw invalid(`Compaction ${stage} input is invalid`, cause);
  }
}

function stageCommandId(transactionId: string, stage: Stage): string {
  return `compaction.${stage}.${hashCanonical({ transactionId, stage })}`;
}

function operationFingerprint(
  stage: Stage,
  input:
    | z.output<typeof CompactionStartInputSchema>
    | z.output<typeof CompactionDeriveViewInputSchema>
    | z.output<typeof CompactionCompleteInputSchema>
    | z.output<typeof CompactionInterruptInputSchema>,
  context: TargetCommandContext,
  semantics: unknown,
): string {
  return hashCanonical({
    operation: 'run.compaction',
    stage,
    runId: input.runId,
    transactionId: input.transactionId,
    expectedRunRevision: input.expectedRevision,
    expectedRunHash: input.expectedRunHash,
    semantics,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
  });
}

function assertRunCas(run: Run, expectedRevision: number, expectedRunHash: string): void {
  if (run.revision !== expectedRevision || run.contentHash !== expectedRunHash) {
    throw new TargetStorageError('REVISION_CONFLICT', `Run ${run.id} CAS does not match`);
  }
  if (run.status !== 'running' && run.status !== 'recovering') {
    throw invalid(`Run ${run.id} cannot compact while ${run.status}`);
  }
}

function assertTransactionRun(database: DatabaseSync, runId: string, transactionId: string): void {
  const existing = database
    .prepare('SELECT run_id FROM compaction_transactions WHERE id = ?')
    .get(transactionId) as unknown as { run_id: string } | undefined;
  if (existing !== undefined && existing.run_id !== runId) {
    throw conflict(`Compaction transaction ${transactionId} belongs to another Run`);
  }
}

function stageResult(
  database: DatabaseSync,
  event: ModelSurfaceRunEvent,
  runId: string,
  transactionId: string,
): CompactionStageResult {
  assertCompactionJournalProjection(database, runId);
  return {
    event,
    transaction: loadCompactionTransaction(database, runId, transactionId),
    view: loadCompactionView(database, runId, transactionId),
  };
}

function replayStage(
  database: DatabaseSync,
  runId: string,
  transactionId: string,
  stage: Stage,
  fingerprint: string,
): CompactionStageResult | null {
  assertTransactionRun(database, runId, transactionId);
  const event = loadRunEventForCommand(database, runId, stageCommandId(transactionId, stage));
  if (event === undefined) return null;
  if (event.visibility !== 'model_surface' || event.payloadState.state !== 'available') {
    throw conflict(`Compaction ${transactionId}/${stage} has different semantics`);
  }
  const payload = event.payloadState.payload;
  const expectedType = `compaction_${stage}`;
  if (
    payload.type !== expectedType ||
    !('transactionId' in payload) ||
    payload.transactionId !== transactionId ||
    !('operationFingerprint' in payload) ||
    payload.operationFingerprint !== fingerprint
  ) {
    throw conflict(`Compaction ${transactionId}/${stage} has different semantics`);
  }
  return stageResult(database, event, runId, transactionId);
}

function appendStage(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  run: Run,
  transactionId: string,
  stage: Stage,
  occurredAt: string,
  context: TargetCommandContext,
  payload: ModelSurfaceRunEventDraft['payload'],
): ModelSurfaceRunEvent {
  const [event] = appendRunEventBatch(database, {
    runId: run.id,
    commandId: stageCommandId(transactionId, stage),
    events: [
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload,
      },
    ],
  });
  if (event?.visibility !== 'model_surface') {
    throw new TargetStorageError('CORRUPT_DATA', 'Compaction stage event was not appended');
  }
  advanceRunJournalHead(database, run, {
    eventId: event.eventId,
    sequence: event.sequence,
    eventHash: event.eventHash,
  });
  return event;
}

function assertCommittedRange(
  database: DatabaseSync,
  run: Run,
  sourceEventFrom: number,
  sourceEventTo: number,
): void {
  if (
    sourceEventTo < sourceEventFrom ||
    run.publicEventHead === null ||
    sourceEventTo > run.publicEventHead.sequence
  ) {
    throw invalid('Compaction source range is not committed');
  }
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM run_events
       WHERE run_id = ? AND sequence BETWEEN ? AND ?`,
    )
    .get(run.id, sourceEventFrom, sourceEventTo) as unknown as { count: number };
  if (row.count !== sourceEventTo - sourceEventFrom + 1) {
    throw new TargetStorageError('CORRUPT_DATA', 'Compaction source range is not contiguous');
  }
}

function startCompaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: CompactionStartInput,
  contextValue: TargetCommandContext,
): CompactionStageResult {
  const input = parseStageInput(CompactionStartInputSchema, inputValue, 'started');
  const context = parseStageInput(TargetCommandContextSchema, contextValue, 'started');
  const semantics = {
    activationNumber: input.activationNumber,
    sourceEventFrom: input.sourceEventFrom,
    sourceEventTo: input.sourceEventTo,
    originalTokenCount: input.originalTokenCount,
    model: input.model,
  };
  const fingerprint = operationFingerprint('started', input, context, semantics);
  return withImmediateTransaction(database, () => {
    const replay = replayStage(database, input.runId, input.transactionId, 'started', fingerprint);
    if (replay !== null) return replay;
    const run = loadRun(database, input.runId);
    assertRunCas(run, input.expectedRevision, input.expectedRunHash);
    const activation = loadActiveRunActivation(database, run.id);
    if (activation?.activation.activationNumber !== input.activationNumber) {
      throw new TargetStorageError('REVISION_CONFLICT', 'Active Activation number does not match');
    }
    assertCommittedRange(database, run, input.sourceEventFrom, input.sourceEventTo);
    const occurredAt = environment.now();
    const transaction = parseCanonical(CompactionTransactionRecordSchema, {
      id: input.transactionId,
      runId: run.id,
      activationNumber: input.activationNumber,
      sourceEventFrom: input.sourceEventFrom,
      sourceEventTo: input.sourceEventTo,
      state: 'started',
      originalTokenCount: input.originalTokenCount,
      compactedTokenCount: null,
      model: input.model,
      interruptionReason: null,
      startedAt: occurredAt,
      finishedAt: null,
    });
    insertCompactionTransaction(database, transaction, activation.id);
    const payload = CompactionStartedSchema.parse({
      type: 'compaction_started',
      transactionId: input.transactionId,
      ...semantics,
      operationFingerprint: fingerprint,
    });
    const event = appendStage(
      database,
      environment,
      run,
      input.transactionId,
      'started',
      occurredAt,
      context,
      payload,
    );
    return stageResult(database, event, run.id, input.transactionId);
  });
}

function deriveCompactionView(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: CompactionDeriveViewInput,
  contextValue: TargetCommandContext,
): CompactionStageResult {
  const input = parseStageInput(CompactionDeriveViewInputSchema, inputValue, 'view_derived');
  const context = parseStageInput(TargetCommandContextSchema, contextValue, 'view_derived');
  const derivedViewHash = compactionViewHash({
    runId: input.runId,
    transactionId: input.transactionId,
    sourceEventFrom: input.sourceEventFrom,
    sourceEventTo: input.sourceEventTo,
    summary: input.summary,
    citedEventSequences: input.citedEventSequences,
    compactedTokenCount: input.compactedTokenCount,
  });
  const semantics = {
    viewId: input.viewId,
    sourceEventFrom: input.sourceEventFrom,
    sourceEventTo: input.sourceEventTo,
    derivedViewHash,
    summary: input.summary,
    citedEventSequences: input.citedEventSequences,
    compactedTokenCount: input.compactedTokenCount,
  };
  const fingerprint = operationFingerprint('view_derived', input, context, semantics);
  return withImmediateTransaction(database, () => {
    const replay = replayStage(
      database,
      input.runId,
      input.transactionId,
      'view_derived',
      fingerprint,
    );
    if (replay !== null) return replay;
    const run = loadRun(database, input.runId);
    assertRunCas(run, input.expectedRevision, input.expectedRunHash);
    const transaction = loadCompactionTransaction(database, run.id, input.transactionId);
    if (
      transaction.state !== 'started' ||
      transaction.sourceEventFrom !== input.sourceEventFrom ||
      transaction.sourceEventTo !== input.sourceEventTo
    ) {
      throw invalid(`Compaction transaction ${transaction.id} is not awaiting a matching view`);
    }
    for (const sequence of input.citedEventSequences) {
      if (
        sequence < transaction.sourceEventFrom ||
        sequence > transaction.sourceEventTo ||
        database
          .prepare('SELECT 1 FROM run_events WHERE run_id = ? AND sequence = ?')
          .get(run.id, sequence) === undefined
      ) {
        throw invalid(`Compaction citation ${sequence} is not in the committed source range`);
      }
    }
    if (database.prepare('SELECT 1 FROM compaction_views WHERE id = ?').get(input.viewId)) {
      throw conflict(`Compaction view ID was already used: ${input.viewId}`);
    }
    const occurredAt = environment.now();
    const view = parseCanonical(CompactionViewRecordSchema, {
      id: input.viewId,
      transactionId: input.transactionId,
      runId: run.id,
      derivedViewHash,
      summary: input.summary,
      citedEventSequences: input.citedEventSequences,
      compactedTokenCount: input.compactedTokenCount,
      createdAt: occurredAt,
    });
    insertCompactionView(database, view);
    updateCompactionTransaction(database, transaction, 'view_derived', {
      compactedTokenCount: view.compactedTokenCount,
      interruptionReason: null,
      finishedAt: null,
    });
    const payload = CompactionViewDerivedSchema.parse({
      type: 'compaction_view_derived',
      transactionId: input.transactionId,
      ...semantics,
      operationFingerprint: fingerprint,
    });
    const event = appendStage(
      database,
      environment,
      run,
      input.transactionId,
      'view_derived',
      occurredAt,
      context,
      payload,
    );
    return stageResult(database, event, run.id, input.transactionId);
  });
}

function completeCompaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: CompactionCompleteInput,
  contextValue: TargetCommandContext,
): CompactionStageResult {
  const input = parseStageInput(CompactionCompleteInputSchema, inputValue, 'completed');
  const context = parseStageInput(TargetCommandContextSchema, contextValue, 'completed');
  const semantics = { viewId: input.viewId, derivedViewHash: input.derivedViewHash };
  const fingerprint = operationFingerprint('completed', input, context, semantics);
  return withImmediateTransaction(database, () => {
    const replay = replayStage(
      database,
      input.runId,
      input.transactionId,
      'completed',
      fingerprint,
    );
    if (replay !== null) return replay;
    const run = loadRun(database, input.runId);
    assertRunCas(run, input.expectedRevision, input.expectedRunHash);
    const transaction = loadCompactionTransaction(database, run.id, input.transactionId);
    const view = loadCompactionView(database, run.id, input.transactionId);
    if (
      transaction.state !== 'view_derived' ||
      view === null ||
      view.id !== input.viewId ||
      view.derivedViewHash !== input.derivedViewHash
    ) {
      throw invalid(`Compaction transaction ${transaction.id} has no matching derived view`);
    }
    const occurredAt = environment.now();
    updateCompactionTransaction(database, transaction, 'completed', {
      compactedTokenCount: view.compactedTokenCount,
      interruptionReason: null,
      finishedAt: occurredAt,
    });
    const payload = CompactionCompletedSchema.parse({
      type: 'compaction_completed',
      transactionId: input.transactionId,
      ...semantics,
      operationFingerprint: fingerprint,
    });
    const event = appendStage(
      database,
      environment,
      run,
      input.transactionId,
      'completed',
      occurredAt,
      context,
      payload,
    );
    return stageResult(database, event, run.id, input.transactionId);
  });
}

function interruptCompaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: CompactionInterruptInput,
  contextValue: TargetCommandContext,
): CompactionStageResult {
  const input = parseStageInput(CompactionInterruptInputSchema, inputValue, 'interrupted');
  const context = parseStageInput(TargetCommandContextSchema, contextValue, 'interrupted');
  const semantics = { reason: input.reason };
  const fingerprint = operationFingerprint('interrupted', input, context, semantics);
  return withImmediateTransaction(database, () => {
    const replay = replayStage(
      database,
      input.runId,
      input.transactionId,
      'interrupted',
      fingerprint,
    );
    if (replay !== null) return replay;
    const run = loadRun(database, input.runId);
    assertRunCas(run, input.expectedRevision, input.expectedRunHash);
    const transaction = loadCompactionTransaction(database, run.id, input.transactionId);
    if (transaction.state !== 'started' && transaction.state !== 'view_derived') {
      throw invalid(`Compaction transaction ${transaction.id} is already terminal`);
    }
    const occurredAt = environment.now();
    updateCompactionTransaction(database, transaction, 'interrupted', {
      compactedTokenCount: transaction.compactedTokenCount,
      interruptionReason: input.reason,
      finishedAt: occurredAt,
    });
    const payload = CompactionInterruptedSchema.parse({
      type: 'compaction_interrupted',
      transactionId: input.transactionId,
      ...semantics,
      operationFingerprint: fingerprint,
    });
    const event = appendStage(
      database,
      environment,
      run,
      input.transactionId,
      'interrupted',
      occurredAt,
      context,
      payload,
    );
    return stageResult(database, event, run.id, input.transactionId);
  });
}

export interface CompactionsAuthority {
  readonly start: (
    input: CompactionStartInput,
    context: TargetCommandContext,
  ) => CompactionStageResult;
  readonly deriveView: (
    input: CompactionDeriveViewInput,
    context: TargetCommandContext,
  ) => CompactionStageResult;
  readonly complete: (
    input: CompactionCompleteInput,
    context: TargetCommandContext,
  ) => CompactionStageResult;
  readonly interrupt: (
    input: CompactionInterruptInput,
    context: TargetCommandContext,
  ) => CompactionStageResult;
  readonly interruptAfterRestart: (
    input: CompactionRestartInput,
    context: TargetCommandContext,
  ) => CompactionStageResult;
}

export function createCompactionsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): CompactionsAuthority {
  const authority: CompactionsAuthority = {
    start(input, context) {
      return startCompaction(getTargetStoreDatabase(store), environment, input, context);
    },
    deriveView(input, context) {
      return deriveCompactionView(getTargetStoreDatabase(store), environment, input, context);
    },
    complete(input, context) {
      return completeCompaction(getTargetStoreDatabase(store), environment, input, context);
    },
    interrupt(input, context) {
      return interruptCompaction(getTargetStoreDatabase(store), environment, input, context);
    },
    interruptAfterRestart(inputValue, context) {
      const input = parseStageInput(CompactionRestartInputSchema, inputValue, 'interrupted');
      return interruptCompaction(
        getTargetStoreDatabase(store),
        environment,
        { ...input, reason: 'process_restarted' },
        context,
      );
    },
  };
  return Object.freeze(authority);
}
