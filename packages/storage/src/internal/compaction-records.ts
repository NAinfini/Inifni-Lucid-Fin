import {
  CompactionCompletedSchema,
  CompactionInterruptedSchema,
  CompactionStartedSchema,
  CompactionViewDerivedSchema,
  CountSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PositiveCountSchema,
  SequenceSchema,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
  type CompactionEvent,
  type RunEvent,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { hashCanonical } from './hashes.js';
import { loadRunEvents } from './run-journal.js';

const CompactionStateSchema = z.enum(['started', 'view_derived', 'completed', 'interrupted']);
const InterruptionReasonSchema = z.enum([
  'process_restarted',
  'cancelled',
  'model_failed',
  'validation_failed',
]);
const CitationListSchema = z
  .array(SequenceSchema)
  .min(1)
  .max(10_000)
  .superRefine((items, ctx) => {
    if (items.some((item, index) => index > 0 && items[index - 1]! >= item)) {
      ctx.addIssue({ code: 'custom', message: 'Compaction citations must be strictly increasing' });
    }
  });

export const CompactionTransactionRecordSchema = strictObject({
  id: EntityIdSchema,
  runId: EntityIdSchema,
  activationNumber: PositiveCountSchema,
  sourceEventFrom: SequenceSchema,
  sourceEventTo: SequenceSchema,
  state: CompactionStateSchema,
  originalTokenCount: CountSchema,
  compactedTokenCount: CountSchema.nullable(),
  model: z.string().min(1).max(200),
  interruptionReason: InterruptionReasonSchema.nullable(),
  startedAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.nullable(),
});
export const CompactionViewRecordSchema = strictObject({
  id: EntityIdSchema,
  transactionId: EntityIdSchema,
  runId: EntityIdSchema,
  derivedViewHash: Sha256Schema,
  summary: z.string().min(1).max(200_000),
  citedEventSequences: CitationListSchema,
  compactedTokenCount: CountSchema,
  createdAt: IsoTimestampSchema,
});

export type CompactionTransactionRecord = z.output<typeof CompactionTransactionRecordSchema>;
export type CompactionViewRecord = z.output<typeof CompactionViewRecordSchema>;

interface TransactionRow {
  id: string;
  run_id: string;
  activation_run_id: string;
  activation_number: number;
  source_event_from: number;
  source_event_to: number;
  state: CompactionTransactionRecord['state'];
  original_token_count: number;
  compacted_token_count: number | null;
  model: string;
  interruption_reason: CompactionTransactionRecord['interruptionReason'];
  started_at: string;
  finished_at: string | null;
}

interface ViewRow {
  id: string;
  transaction_id: string;
  run_id: string;
  derived_view_hash: string;
  summary: string;
  cited_event_sequences_v1_json: string;
  compacted_token_count: number;
  created_at: string;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function transactionFromRow(row: TransactionRow): CompactionTransactionRecord {
  if (row.activation_run_id !== row.run_id) {
    throw corrupt(
      `Compaction transaction ${row.id} belongs to a different Run than its Activation`,
    );
  }
  const value = parseCanonical(CompactionTransactionRecordSchema, {
    id: row.id,
    runId: row.run_id,
    activationNumber: row.activation_number,
    sourceEventFrom: row.source_event_from,
    sourceEventTo: row.source_event_to,
    state: row.state,
    originalTokenCount: row.original_token_count,
    compactedTokenCount: row.compacted_token_count,
    model: row.model,
    interruptionReason: row.interruption_reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  });
  const terminal = value.state === 'completed' || value.state === 'interrupted';
  if (terminal !== (value.finishedAt !== null)) {
    throw corrupt(`Compaction transaction ${value.id} finish state is inconsistent`);
  }
  if ((value.state === 'interrupted') !== (value.interruptionReason !== null)) {
    throw corrupt(`Compaction transaction ${value.id} interruption state is inconsistent`);
  }
  if (value.state === 'started' && value.compactedTokenCount !== null) {
    throw corrupt(`Compaction transaction ${value.id} started state has compacted tokens`);
  }
  if (
    (value.state === 'view_derived' || value.state === 'completed') &&
    value.compactedTokenCount === null
  ) {
    throw corrupt(`Compaction transaction ${value.id} is missing compacted tokens`);
  }
  if (value.sourceEventTo < value.sourceEventFrom) {
    throw corrupt(`Compaction transaction ${value.id} source range is invalid`);
  }
  return value;
}

function viewFromRow(row: ViewRow): CompactionViewRecord {
  let citations: number[];
  try {
    citations = parseCanonical(
      CitationListSchema,
      JSON.parse(row.cited_event_sequences_v1_json) as unknown,
    );
  } catch (cause) {
    throw corrupt(`Compaction view ${row.id} citations are invalid`, cause);
  }
  if (canonicalJson(citations) !== row.cited_event_sequences_v1_json) {
    throw corrupt(`Compaction view ${row.id} citations are not canonical JSON`);
  }
  return parseCanonical(CompactionViewRecordSchema, {
    id: row.id,
    transactionId: row.transaction_id,
    runId: row.run_id,
    derivedViewHash: row.derived_view_hash,
    summary: row.summary,
    citedEventSequences: citations,
    compactedTokenCount: row.compacted_token_count,
    createdAt: row.created_at,
  });
}

export function compactionViewHash(input: {
  runId: string;
  transactionId: string;
  sourceEventFrom: number;
  sourceEventTo: number;
  summary: string;
  citedEventSequences: readonly number[];
  compactedTokenCount: number;
}): string {
  return hashCanonical(input);
}

export function loadCompactionTransactions(
  database: DatabaseSync,
  runIdValue: string,
): CompactionTransactionRecord[] {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  return (
    database
      .prepare(
        `SELECT tx.*, activation.activation_number, activation.run_id AS activation_run_id
         FROM compaction_transactions AS tx
         JOIN run_activations AS activation ON activation.id = tx.activation_id
         WHERE tx.run_id = ?
         ORDER BY tx.source_event_from, tx.source_event_to, tx.id`,
      )
      .all(runId) as unknown as TransactionRow[]
  ).map(transactionFromRow);
}

export function loadCompactionTransaction(
  database: DatabaseSync,
  runIdValue: string,
  transactionIdValue: string,
): CompactionTransactionRecord {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const transactionId = parseCanonical(EntityIdSchema, transactionIdValue);
  const transaction = loadCompactionTransactions(database, runId).find(
    ({ id }) => id === transactionId,
  );
  if (transaction === undefined) {
    throw new StorageError('NOT_FOUND', `Compaction transaction was not found: ${transactionId}`);
  }
  return transaction;
}

export function loadCompactionViews(
  database: DatabaseSync,
  runIdValue: string,
): CompactionViewRecord[] {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  return (
    database
      .prepare(
        `SELECT * FROM compaction_views
         WHERE run_id = ?
         ORDER BY created_at, id`,
      )
      .all(runId) as unknown as ViewRow[]
  ).map(viewFromRow);
}

export function loadCompactionView(
  database: DatabaseSync,
  runId: string,
  transactionId: string,
): CompactionViewRecord | null {
  return (
    loadCompactionViews(database, runId).find((view) => view.transactionId === transactionId) ??
    null
  );
}

export function insertCompactionTransaction(
  database: DatabaseSync,
  transaction: CompactionTransactionRecord,
  activationId: string,
): void {
  const value = parseCanonical(CompactionTransactionRecordSchema, transaction);
  database
    .prepare(
      `INSERT INTO compaction_transactions (
         id, run_id, activation_id, source_event_from, source_event_to, state,
         original_token_count, compacted_token_count, model, interruption_reason,
         started_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, 'started', ?, NULL, ?, NULL, ?, NULL)`,
    )
    .run(
      value.id,
      value.runId,
      activationId,
      value.sourceEventFrom,
      value.sourceEventTo,
      value.originalTokenCount,
      value.model,
      value.startedAt,
    );
}

export function insertCompactionView(database: DatabaseSync, view: CompactionViewRecord): void {
  const value = parseCanonical(CompactionViewRecordSchema, view);
  database
    .prepare(
      `INSERT INTO compaction_views (
         id, transaction_id, run_id, derived_view_hash, summary,
         cited_event_sequences_v1_json, compacted_token_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      value.id,
      value.transactionId,
      value.runId,
      value.derivedViewHash,
      value.summary,
      canonicalJson(value.citedEventSequences),
      value.compactedTokenCount,
      value.createdAt,
    );
}

export function updateCompactionTransaction(
  database: DatabaseSync,
  before: CompactionTransactionRecord,
  state: 'view_derived' | 'completed' | 'interrupted',
  input: {
    compactedTokenCount: number | null;
    interruptionReason: CompactionTransactionRecord['interruptionReason'];
    finishedAt: string | null;
  },
): void {
  const update = database
    .prepare(
      `UPDATE compaction_transactions
       SET state = ?, compacted_token_count = ?, interruption_reason = ?, finished_at = ?
       WHERE id = ? AND run_id = ? AND state = ?`,
    )
    .run(
      state,
      input.compactedTokenCount,
      input.interruptionReason,
      input.finishedAt,
      before.id,
      before.runId,
      before.state,
    );
  if (Number(update.changes) !== 1) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Compaction transaction ${before.id} changed concurrently`,
    );
  }
}

interface CompactionJournalStage {
  readonly event: RunEvent;
  readonly payload: CompactionEvent;
}

function availableCompactionStages(
  database: DatabaseSync,
  runId: string,
): CompactionJournalStage[] {
  return loadRunEvents(database, runId).flatMap((event) => {
    if (event.visibility !== 'model_surface' || event.payloadState.state !== 'available') return [];
    const parsed = (() => {
      try {
        return z
          .union([
            CompactionStartedSchema,
            CompactionViewDerivedSchema,
            CompactionCompletedSchema,
            CompactionInterruptedSchema,
          ])
          .safeParse(event.payloadState.payload);
      } catch {
        return { success: false } as const;
      }
    })();
    return parsed.success ? [{ event, payload: parsed.data }] : [];
  });
}

export function assertCompactionJournalProjection(database: DatabaseSync, runId: string): void {
  const transactions = loadCompactionTransactions(database, runId);
  const views = loadCompactionViews(database, runId);
  const stages = availableCompactionStages(database, runId);
  const transactionIds = new Set(transactions.map(({ id }) => id));
  const mismatchedView = database
    .prepare(
      `SELECT view.id
       FROM compaction_views AS view
       JOIN compaction_transactions AS tx ON tx.id = view.transaction_id
       WHERE (view.run_id = ? OR tx.run_id = ?)
         AND view.run_id <> tx.run_id
       LIMIT 1`,
    )
    .get(runId, runId) as unknown as { id: string } | undefined;
  if (mismatchedView !== undefined) {
    throw corrupt(
      `Compaction view ${mismatchedView.id} belongs to a different Run than its transaction`,
    );
  }
  if (views.some((view) => !transactionIds.has(view.transactionId))) {
    throw corrupt(`Run ${runId} has an orphan Compaction view`);
  }
  if (stages.some(({ payload }) => !transactionIds.has(payload.transactionId))) {
    throw corrupt(`Run ${runId} has an orphan Compaction event`);
  }
  for (const transaction of transactions) {
    const transactionStages = stages.filter(
      ({ payload }) => payload.transactionId === transaction.id,
    );
    const startedStage = transactionStages[0];
    const started = startedStage?.payload;
    if (
      startedStage === undefined ||
      started?.type !== 'compaction_started' ||
      startedStage.event.occurredAt !== transaction.startedAt ||
      started.activationNumber !== transaction.activationNumber ||
      started.sourceEventFrom !== transaction.sourceEventFrom ||
      started.sourceEventTo !== transaction.sourceEventTo ||
      started.originalTokenCount !== transaction.originalTokenCount ||
      started.model !== transaction.model
    ) {
      throw corrupt(`Compaction transaction ${transaction.id} does not match its started event`);
    }
    const view = views.find(({ transactionId }) => transactionId === transaction.id) ?? null;
    const viewStage = transactionStages.find(
      ({ payload }) => payload.type === 'compaction_view_derived',
    );
    const viewEvent = viewStage?.payload;
    if ((view === null) !== (viewEvent === undefined)) {
      throw corrupt(`Compaction transaction ${transaction.id} view projection is incomplete`);
    }
    if (view !== null) {
      if (
        view.citedEventSequences.some(
          (sequence) =>
            database
              .prepare('SELECT 1 FROM run_events WHERE run_id = ? AND sequence = ?')
              .get(runId, sequence) === undefined,
        )
      ) {
        throw corrupt(`Compaction view ${view.id} cites a missing Run event`);
      }
      if (
        viewStage === undefined ||
        viewEvent?.type !== 'compaction_view_derived' ||
        viewStage.event.occurredAt !== view.createdAt ||
        viewEvent.viewId !== view.id ||
        viewEvent.sourceEventFrom !== transaction.sourceEventFrom ||
        viewEvent.sourceEventTo !== transaction.sourceEventTo ||
        viewEvent.derivedViewHash !== view.derivedViewHash ||
        viewEvent.summary !== view.summary ||
        canonicalJson(viewEvent.citedEventSequences) !== canonicalJson(view.citedEventSequences) ||
        viewEvent.compactedTokenCount !== view.compactedTokenCount ||
        view.derivedViewHash !==
          compactionViewHash({
            runId,
            transactionId: transaction.id,
            sourceEventFrom: transaction.sourceEventFrom,
            sourceEventTo: transaction.sourceEventTo,
            summary: view.summary,
            citedEventSequences: view.citedEventSequences,
            compactedTokenCount: view.compactedTokenCount,
          })
      ) {
        throw corrupt(`Compaction view ${view.id} does not match its Journal event`);
      }
    }
    const terminalStage = transactionStages.at(-1);
    const terminal = terminalStage?.payload;
    if (
      transaction.state === 'started' &&
      (transactionStages.length !== 1 || transaction.finishedAt !== null)
    ) {
      throw corrupt(`Compaction transaction ${transaction.id} started state is inconsistent`);
    }
    if (
      transaction.state === 'view_derived' &&
      (transactionStages.length !== 2 || view === null || transaction.finishedAt !== null)
    ) {
      throw corrupt(`Compaction transaction ${transaction.id} view state is inconsistent`);
    }
    if (
      transaction.state === 'completed' &&
      (transactionStages.length !== 3 ||
        terminalStage === undefined ||
        terminal?.type !== 'compaction_completed' ||
        terminalStage.event.occurredAt !== transaction.finishedAt ||
        view === null ||
        terminal.viewId !== view.id ||
        terminal.derivedViewHash !== view.derivedViewHash)
    ) {
      throw corrupt(`Compaction transaction ${transaction.id} completion is inconsistent`);
    }
    if (
      transaction.state === 'interrupted' &&
      (terminalStage === undefined ||
        terminal?.type !== 'compaction_interrupted' ||
        terminalStage.event.occurredAt !== transaction.finishedAt ||
        terminal.reason !== transaction.interruptionReason ||
        transactionStages.length !== (view === null ? 2 : 3))
    ) {
      throw corrupt(`Compaction transaction ${transaction.id} interruption is inconsistent`);
    }
    if (
      (view?.compactedTokenCount ?? null) !== transaction.compactedTokenCount &&
      transaction.state !== 'started'
    ) {
      throw corrupt(`Compaction transaction ${transaction.id} token projection is inconsistent`);
    }
  }
}
