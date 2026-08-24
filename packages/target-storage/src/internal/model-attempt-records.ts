import {
  CanonicalModelRequestV1Schema,
  DurableCanonicalModelResponseV1Schema,
  EntityIdSchema,
  IsoTimestampSchema,
  ModelAttemptRecordV1Schema,
  ModelResourceQuoteV1Schema,
  ProviderModelSchema,
  Sha256Schema,
  assertAttemptStateTransition,
  canonicalModelRequestHashInput,
  durableCanonicalModelResponseHashInput,
  parseCanonical,
  type CanonicalModelRequestV1,
  type DurableCanonicalModelResponseV1,
  type ModelAttemptRecordV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { decodeCanonicalRecord, encodeCanonicalRecord } from './canonical-codecs.js';
import { hashCanonical } from './hashes.js';

interface ModelAttemptRow {
  id: string;
  run_id: string;
  activation_id: string;
  attempt_number: number;
  provider_v1_json: string;
  state: ModelAttemptRecordV1['state'];
  request_v1_json: string;
  request_hash: string;
  response_v1_json: string | null;
  response_hash: string | null;
  usage_v1_json: string | null;
  created_at: string;
  finished_at: string | null;
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function responseUsesOnlyMaterializedTools(
  request: CanonicalModelRequestV1,
  response: DurableCanonicalModelResponseV1,
): boolean {
  const materializedToolIds = new Set(request.materializedTools.map(({ id }) => id));
  return response.events.every(
    (event) => event.type !== 'tool_call' || materializedToolIds.has(event.toolId),
  );
}

function recordFromRow(row: ModelAttemptRow): ModelAttemptRecordV1 {
  let request: CanonicalModelRequestV1;
  let response: DurableCanonicalModelResponseV1 | null;
  try {
    request = decodeCanonicalRecord(
      `Model Attempt ${row.id} request`,
      CanonicalModelRequestV1Schema,
      row.request_v1_json,
    );
    response =
      row.response_v1_json === null
        ? null
        : decodeCanonicalRecord(
            `Model Attempt ${row.id} response`,
            DurableCanonicalModelResponseV1Schema,
            row.response_v1_json,
          );
    const record = parseCanonical(ModelAttemptRecordV1Schema, {
      id: parseCanonical(EntityIdSchema, row.id),
      runId: parseCanonical(EntityIdSchema, row.run_id),
      activationId: parseCanonical(EntityIdSchema, row.activation_id),
      attemptNumber: row.attempt_number,
      provider: decodeCanonicalRecord(
        `Model Attempt ${row.id} provider`,
        ProviderModelSchema,
        row.provider_v1_json,
      ),
      state: row.state,
      request,
      requestHash: parseCanonical(Sha256Schema, row.request_hash),
      response,
      responseHash:
        row.response_hash === null ? null : parseCanonical(Sha256Schema, row.response_hash),
      usage:
        row.usage_v1_json === null
          ? null
          : decodeCanonicalRecord(
              `Model Attempt ${row.id} usage`,
              ModelResourceQuoteV1Schema,
              row.usage_v1_json,
            ),
      createdAt: parseCanonical(IsoTimestampSchema, row.created_at),
      finishedAt:
        row.finished_at === null ? null : parseCanonical(IsoTimestampSchema, row.finished_at),
    });
    if (
      record.requestHash !== hashCanonical(canonicalModelRequestHashInput(record.request)) ||
      (record.response === null
        ? record.responseHash !== null
        : record.responseHash !==
          hashCanonical(durableCanonicalModelResponseHashInput(record.response)))
    ) {
      throw corrupt(`Model Attempt ${row.id} canonical hash does not match`);
    }
    if (
      record.response !== null &&
      !responseUsesOnlyMaterializedTools(record.request, record.response)
    ) {
      throw corrupt(`Model Attempt ${row.id} called a tool outside its materialized request`);
    }
    return Object.freeze(record);
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw corrupt(`Model Attempt ${row.id} is invalid`, cause);
  }
}

export function loadModelAttemptRecord(
  database: DatabaseSync,
  attemptIdValue: string,
): ModelAttemptRecordV1 {
  const attemptId = parseCanonical(EntityIdSchema, attemptIdValue);
  const row = database.prepare('SELECT * FROM model_attempts WHERE id = ?').get(attemptId) as
    ModelAttemptRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Model Attempt was not found: ${attemptId}`);
  }
  return recordFromRow(row);
}

export function listModelAttemptRecords(
  database: DatabaseSync,
  runIdValue: string,
  activationIdValue: string,
): ModelAttemptRecordV1[] {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const activationId = parseCanonical(EntityIdSchema, activationIdValue);
  const rows = database
    .prepare(
      `SELECT * FROM model_attempts
       WHERE run_id = ? AND activation_id = ?
       ORDER BY attempt_number`,
    )
    .all(runId, activationId) as unknown as ModelAttemptRow[];
  const records = rows.map(recordFromRow);
  records.forEach((record, index) => {
    if (record.attemptNumber !== index + 1) {
      throw corrupt(`Activation ${activationId} Model Attempt order is not contiguous`);
    }
  });
  return records;
}

export function insertPreparedModelAttempt(
  database: DatabaseSync,
  recordValue: ModelAttemptRecordV1,
): ModelAttemptRecordV1 {
  if (!database.isTransaction) {
    throw new TargetStorageError('INVALID_REQUEST', 'Model Attempt insert requires a transaction');
  }
  const record = parseCanonical(ModelAttemptRecordV1Schema, recordValue);
  if (
    record.state !== 'prepared' ||
    record.response !== null ||
    record.responseHash !== null ||
    record.usage !== null ||
    record.finishedAt !== null
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'A new Model Attempt must be prepared');
  }
  if (record.requestHash !== hashCanonical(canonicalModelRequestHashInput(record.request))) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'A new Model Attempt request hash must match its canonical request',
    );
  }
  database
    .prepare(
      `INSERT INTO model_attempts (
         id, run_id, activation_id, attempt_number, provider_v1_json, state,
         request_v1_json, request_hash, response_v1_json, response_hash,
         usage_v1_json, created_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, NULL, NULL, NULL, ?, NULL)`,
    )
    .run(
      record.id,
      record.runId,
      record.activationId,
      record.attemptNumber,
      encodeCanonicalRecord(ProviderModelSchema, record.provider),
      encodeCanonicalRecord(CanonicalModelRequestV1Schema, record.request),
      record.requestHash,
      record.createdAt,
    );
  return loadModelAttemptRecord(database, record.id);
}

export function markModelAttemptRecordRunning(
  database: DatabaseSync,
  attemptIdValue: string,
  requestHashValue: string,
): ModelAttemptRecordV1 {
  if (!database.isTransaction) {
    throw new TargetStorageError('INVALID_REQUEST', 'Model Attempt update requires a transaction');
  }
  const attemptId = parseCanonical(EntityIdSchema, attemptIdValue);
  const requestHash = parseCanonical(Sha256Schema, requestHashValue);
  const before = loadModelAttemptRecord(database, attemptId);
  if (before.requestHash !== requestHash) {
    throw new TargetStorageError(
      'IDEMPOTENCY_CONFLICT',
      `Model Attempt ${attemptId} request hash changed`,
    );
  }
  if (before.state === 'running') return before;
  try {
    assertAttemptStateTransition(before.state, 'running', false);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', `Model Attempt ${attemptId} cannot run`, {
      cause,
    });
  }
  const update = database
    .prepare("UPDATE model_attempts SET state = 'running' WHERE id = ? AND state = 'prepared'")
    .run(attemptId);
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Model Attempt ${attemptId} changed`);
  }
  return loadModelAttemptRecord(database, attemptId);
}

function responseState(response: DurableCanonicalModelResponseV1): ModelAttemptRecordV1['state'] {
  const terminal = response.events.at(-1)!;
  if (terminal.type === 'model_completed') return 'succeeded';
  if (terminal.type !== 'model_failed') {
    throw new TargetStorageError('INVALID_REQUEST', 'Model response has no terminal event');
  }
  if (terminal.typedCode === 'cancelled') return 'cancelled';
  if (terminal.providerState === 'unknown' || terminal.providerState === 'submitted')
    return 'unknown';
  return 'failed';
}

export function settleModelAttemptRecord(
  database: DatabaseSync,
  attemptIdValue: string,
  requestHashValue: string,
  responseValue: DurableCanonicalModelResponseV1,
  settledAtValue: string,
): ModelAttemptRecordV1 {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Model Attempt settlement requires a transaction',
    );
  }
  const attemptId = parseCanonical(EntityIdSchema, attemptIdValue);
  const requestHash = parseCanonical(Sha256Schema, requestHashValue);
  const response = parseCanonical(DurableCanonicalModelResponseV1Schema, responseValue);
  const responseHash = hashCanonical(durableCanonicalModelResponseHashInput(response));
  const settledAt = parseCanonical(IsoTimestampSchema, settledAtValue);
  const usage = response.events.find((event) => event.type === 'usage')!.usage;
  const state = responseState(response);
  const before = loadModelAttemptRecord(database, attemptId);
  if (before.requestHash !== requestHash) {
    throw new TargetStorageError(
      'IDEMPOTENCY_CONFLICT',
      `Model Attempt ${attemptId} request hash changed`,
    );
  }
  if (before.response !== null) {
    if (before.responseHash !== responseHash || before.state !== state) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Model Attempt ${attemptId} was settled differently`,
      );
    }
    return before;
  }
  if (!responseUsesOnlyMaterializedTools(before.request, response)) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Model Attempt ${attemptId} called a tool outside its materialized request`,
    );
  }
  try {
    assertAttemptStateTransition(before.state, state, false);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', `Model Attempt ${attemptId} cannot settle`, {
      cause,
    });
  }
  const finishedAt = state === 'unknown' ? null : settledAt;
  const update = database
    .prepare(
      `UPDATE model_attempts
       SET state = ?, response_v1_json = ?, response_hash = ?, usage_v1_json = ?, finished_at = ?
       WHERE id = ? AND request_hash = ? AND response_v1_json IS NULL AND state = ?`,
    )
    .run(
      state,
      encodeCanonicalRecord(DurableCanonicalModelResponseV1Schema, response),
      responseHash,
      encodeCanonicalRecord(ModelResourceQuoteV1Schema, usage),
      finishedAt,
      attemptId,
      requestHash,
      before.state,
    );
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Model Attempt ${attemptId} changed`);
  }
  return loadModelAttemptRecord(database, attemptId);
}
