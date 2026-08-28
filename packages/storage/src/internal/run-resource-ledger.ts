import {
  CountAmountSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  ResourceAmountSchema,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  strictObject,
  type ResourceAmount,
  z,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { decodeCanonicalRecord, encodeCanonicalRecord } from './canonical-codecs.js';
import type { StorageEnvironment } from './environment.js';
import { addExactDecimals, compareExactDecimals, parseExactDecimal } from './exact-decimal.js';

export const RunResourceKindSchema = z.enum([
  'cost',
  'input_tokens',
  'output_tokens',
  'generation_count',
  'duration_ms',
]);
export const RunResourcePhaseSchema = z.enum(['reserved', 'consumed', 'released']);
export const RunResourceSourceSchema = z.union([
  strictObject({ kind: z.literal('dispatch_operation'), id: EntityIdSchema }),
  strictObject({ kind: z.literal('model_attempt'), id: EntityIdSchema }),
]);
const RUN_RESOURCE_ENTRY_SCALAR_FIELDS = {
  runId: EntityIdSchema,
  phase: RunResourcePhaseSchema,
  reservationEntryId: EntityIdSchema.nullable(),
  kind: RunResourceKindSchema,
  idempotencyKey: Sha256Schema,
  recordedAt: IsoTimestampSchema,
} as const;
const RunResourceEntryScalarSchema = strictObject(RUN_RESOURCE_ENTRY_SCALAR_FIELDS);
const RunResourceEntryInputSchema = strictObject({
  ...RUN_RESOURCE_ENTRY_SCALAR_FIELDS,
  source: RunResourceSourceSchema,
  amount: z.union([ResourceAmountSchema, CountAmountSchema]),
});

export type RunResourceKind = z.output<typeof RunResourceKindSchema>;
export type RunResourcePhase = z.output<typeof RunResourcePhaseSchema>;
export type RunResourceSource = z.output<typeof RunResourceSourceSchema>;
export type RunResourceAmount =
  z.output<typeof ResourceAmountSchema> | z.output<typeof CountAmountSchema>;
export type RunResourceEntryInput = z.output<typeof RunResourceEntryInputSchema>;
export interface RunResourceEntry extends RunResourceEntryInput {
  readonly id: string;
}

interface ResourceEntryRow {
  id: string;
  run_id: string;
  dispatch_operation_id: string | null;
  model_attempt_id: string | null;
  phase: RunResourcePhase;
  reservation_entry_id: string | null;
  kind: RunResourceKind;
  amount_v1_json: string;
  idempotency_key: string;
  recorded_at: string;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function invalid(message: string, cause?: unknown): StorageError {
  return new StorageError('INVALID_REQUEST', message, cause === undefined ? undefined : { cause });
}

function amountSchema(kind: RunResourceKind) {
  return kind === 'cost' ? ResourceAmountSchema : CountAmountSchema;
}

function sourceFromRow(row: ResourceEntryRow): RunResourceSource {
  if ((row.dispatch_operation_id === null) === (row.model_attempt_id === null)) {
    throw corrupt(`Run resource entry ${row.id} source is not exclusive`);
  }
  return parseCanonical(
    RunResourceSourceSchema,
    row.dispatch_operation_id === null
      ? { kind: 'model_attempt', id: row.model_attempt_id }
      : { kind: 'dispatch_operation', id: row.dispatch_operation_id },
  );
}

function entryFromRow(row: ResourceEntryRow): RunResourceEntry {
  let scalar;
  try {
    scalar = parseCanonical(RunResourceEntryScalarSchema, {
      runId: row.run_id,
      phase: row.phase,
      reservationEntryId: row.reservation_entry_id,
      kind: row.kind,
      idempotencyKey: row.idempotency_key,
      recordedAt: row.recorded_at,
    });
    parseCanonical(EntityIdSchema, row.id);
  } catch (cause) {
    throw corrupt(`Run resource entry ${row.id} scalar columns are invalid`, cause);
  }
  return Object.freeze({
    id: row.id,
    ...scalar,
    source: sourceFromRow(row),
    amount: decodeCanonicalRecord(
      `Run resource entry ${row.id} amount`,
      amountSchema(scalar.kind),
      row.amount_v1_json,
    ),
  }) as RunResourceEntry;
}

function sourceKey(source: RunResourceSource): string {
  return `${source.kind}:${source.id}`;
}

function assertSource(
  database: DatabaseSync,
  runId: string,
  source: RunResourceSource,
  errorCode: 'CORRUPT_DATA' | 'INVALID_REQUEST' = 'CORRUPT_DATA',
): void {
  const row =
    source.kind === 'dispatch_operation'
      ? (database
          .prepare('SELECT run_id FROM dispatch_operations WHERE id = ?')
          .get(source.id) as unknown as { run_id: string } | undefined)
      : (database
          .prepare('SELECT run_id FROM model_attempts WHERE id = ?')
          .get(source.id) as unknown as { run_id: string } | undefined);
  if (row === undefined || row.run_id !== runId) {
    throw new StorageError(
      errorCode,
      `Run resource source ${sourceKey(source)} does not belong to Run ${runId}`,
    );
  }
}

function assertAmountKind(entry: RunResourceEntry): void {
  const parsed = amountSchema(entry.kind).safeParse(entry.amount);
  if (!parsed.success) throw corrupt(`Run resource entry ${entry.id} amount kind does not match`);
}

function assertClosure(reservation: RunResourceEntry, closures: readonly RunResourceEntry[]): void {
  if (reservation.phase !== 'reserved' || reservation.reservationEntryId !== null) {
    throw corrupt(`Run resource reservation ${reservation.id} is invalid`);
  }
  const consumed = closures.filter(({ phase }) => phase === 'consumed');
  const released = closures.filter(({ phase }) => phase === 'released');
  if (consumed.length > 1 || released.length > 1) {
    throw corrupt(`Run resource reservation ${reservation.id} has duplicate closure phases`);
  }
  for (const closure of closures) {
    if (
      closure.runId !== reservation.runId ||
      sourceKey(closure.source) !== sourceKey(reservation.source) ||
      closure.kind !== reservation.kind
    ) {
      throw corrupt(`Run resource closure ${closure.id} crosses reservation boundaries`);
    }
  }
  if (reservation.amount.state === 'unknown') {
    const reservationCurrency =
      reservation.kind === 'cost'
        ? (reservation.amount as Extract<ResourceAmount, { state: 'unknown' }>).currency
        : null;
    const currencyMismatch =
      reservation.kind === 'cost' &&
      closures.some(
        ({ amount }) =>
          amount.state !== 'unknown' ||
          !('currency' in amount) ||
          amount.currency !== reservationCurrency,
      );
    if (
      closures.length > 1 ||
      closures.some(({ amount }) => amount.state !== 'unknown') ||
      currencyMismatch
    ) {
      throw corrupt(`Unknown reservation ${reservation.id} requires one unknown closure at most`);
    }
    return;
  }
  if (closures.some(({ amount }) => amount.state === 'unknown')) {
    throw corrupt(`Known reservation ${reservation.id} cannot have an unknown closure`);
  }
  if (reservation.kind === 'cost') {
    const reserved = reservation.amount as ResourceAmount & { state: 'known' | 'estimated' };
    let total = parseExactDecimal('0');
    for (const closure of closures) {
      const amount = closure.amount as ResourceAmount & { state: 'known' | 'estimated' };
      if (amount.currency !== reserved.currency) {
        throw corrupt(`Run resource closure ${closure.id} currency does not match its reservation`);
      }
      total = addExactDecimals(total, parseExactDecimal(amount.value));
    }
    if (compareExactDecimals(total, parseExactDecimal(reserved.value)) > 0) {
      throw corrupt(`Run resource reservation ${reservation.id} is over-closed`);
    }
  } else {
    const reserved = reservation.amount as { state: 'known' | 'estimated'; value: number };
    const total = closures.reduce((sum, closure) => {
      const amount = closure.amount as { state: 'known' | 'estimated'; value: number };
      return sum + BigInt(amount.value);
    }, 0n);
    if (total > BigInt(reserved.value)) {
      throw corrupt(`Run resource reservation ${reservation.id} is over-closed`);
    }
  }
}

function validateEntries(database: DatabaseSync, entries: readonly RunResourceEntry[]): void {
  const byId = new Map<string, RunResourceEntry>();
  const closuresByReservation = new Map<string, RunResourceEntry[]>();
  for (const entry of entries) {
    assertAmountKind(entry);
    assertSource(database, entry.runId, entry.source);
    if (entry.phase === 'reserved' && entry.reservationEntryId !== null) {
      throw corrupt(`Run resource reservation ${entry.id} cannot have a parent`);
    }
    if (entry.phase === 'released' && entry.reservationEntryId === null) {
      throw corrupt(`Run resource release ${entry.id} requires a reservation`);
    }
    if (byId.has(entry.id)) throw corrupt(`Run resource entry id is duplicated: ${entry.id}`);
    byId.set(entry.id, entry);
    if (entry.reservationEntryId !== null) {
      const closures = closuresByReservation.get(entry.reservationEntryId) ?? [];
      closures.push(entry);
      closuresByReservation.set(entry.reservationEntryId, closures);
    }
  }
  for (const reservation of entries.filter(({ phase }) => phase === 'reserved')) {
    assertClosure(reservation, closuresByReservation.get(reservation.id) ?? []);
  }
  for (const entry of entries) {
    if (
      entry.reservationEntryId !== null &&
      byId.get(entry.reservationEntryId)?.phase !== 'reserved'
    ) {
      throw corrupt(`Run resource entry ${entry.id} parent is not a reservation`);
    }
  }
}

export function loadRunResourceEntries(
  database: DatabaseSync,
  runIdValue: string,
): RunResourceEntry[] {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  if (database.prepare('SELECT 1 FROM runs WHERE id = ?').get(runId) === undefined) {
    throw new StorageError('NOT_FOUND', `Run was not found: ${runId}`);
  }
  const entries = (
    database
      .prepare('SELECT * FROM run_resource_entries WHERE run_id = ? ORDER BY rowid')
      .all(runId) as unknown as ResourceEntryRow[]
  ).map(entryFromRow);
  validateEntries(database, entries);
  return entries;
}

export function appendRunResourceEntry(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: RunResourceEntryInput,
): RunResourceEntry {
  if (!database.isTransaction) throw invalid('Run resource append requires a transaction');
  let input: RunResourceEntryInput;
  try {
    input = parseCanonical(RunResourceEntryInputSchema, inputValue);
    parseCanonical(amountSchema(input.kind), input.amount);
  } catch (cause) {
    throw invalid('Run resource entry input is invalid', cause);
  }
  const existingRow = database
    .prepare('SELECT * FROM run_resource_entries WHERE run_id = ? AND idempotency_key = ?')
    .get(input.runId, input.idempotencyKey) as unknown as ResourceEntryRow | undefined;
  if (existingRow !== undefined) {
    const existing = entryFromRow(existingRow);
    const { id: _id, ...existingInput } = existing;
    if (canonicalJson(existingInput) !== canonicalJson(input)) {
      throw new StorageError(
        'IDEMPOTENCY_CONFLICT',
        `Run resource idempotency key ${input.idempotencyKey} has different semantics`,
      );
    }
    validateEntries(database, loadRunResourceEntries(database, input.runId));
    return existing;
  }
  assertSource(database, input.runId, input.source, 'INVALID_REQUEST');
  const current = loadRunResourceEntries(database, input.runId);
  const candidate: RunResourceEntry = Object.freeze({
    id: parseCanonical(EntityIdSchema, environment.createId('run_resource_entry')),
    ...input,
  });
  try {
    validateEntries(database, [...current, candidate]);
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === 'CORRUPT_DATA') {
      throw invalid(cause.message, cause);
    }
    throw cause;
  }
  database
    .prepare(
      `INSERT INTO run_resource_entries (
         id, run_id, dispatch_operation_id, model_attempt_id, phase,
         reservation_entry_id, kind, amount_v1_json, idempotency_key, recorded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.id,
      candidate.runId,
      candidate.source.kind === 'dispatch_operation' ? candidate.source.id : null,
      candidate.source.kind === 'model_attempt' ? candidate.source.id : null,
      candidate.phase,
      candidate.reservationEntryId,
      candidate.kind,
      encodeCanonicalRecord(amountSchema(candidate.kind), candidate.amount),
      candidate.idempotencyKey,
      candidate.recordedAt,
    );
  return loadRunResourceEntries(database, input.runId).find(({ id }) => id === candidate.id)!;
}
