import {
  RunActivationSchema,
  assertActivationOrdering,
  type RunActivation,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { loadRun } from './run-records.js';

interface ActivationRow {
  id: string;
  run_id: string;
  activation_number: number;
  trigger_inbox_message_id: string;
  trigger_inbox_sequence: number;
  state: RunActivation['state'];
  event_start_sequence: number;
  event_end_sequence: number | null;
  started_at: string;
  ended_at: string | null;
  end_reason: RunActivation['endReason'];
}

export interface StoredRunActivation {
  readonly id: string;
  readonly activation: RunActivation;
}

function activationFromRow(row: ActivationRow): RunActivation {
  return RunActivationSchema.parse({
    runId: row.run_id,
    activationNumber: row.activation_number,
    triggerInboxMessageId: row.trigger_inbox_message_id,
    triggerInboxSequence: row.trigger_inbox_sequence,
    state: row.state,
    eventStartSequence: row.event_start_sequence,
    eventEndSequence: row.event_end_sequence,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
  });
}

function activationRows(database: DatabaseSync, runId: string): StoredRunActivation[] {
  loadRun(database, runId);
  const rows = database
    .prepare('SELECT * FROM run_activations WHERE run_id = ? ORDER BY activation_number')
    .all(runId) as unknown as ActivationRow[];
  const records = rows.map((row) => ({ id: row.id, activation: activationFromRow(row) }));
  try {
    assertActivationOrdering(records.map(({ activation }) => activation));
  } catch (cause) {
    throw new StorageError('CORRUPT_DATA', `Run ${runId} Activation order is invalid`, {
      cause,
    });
  }
  return records;
}

export function loadRunActivations(database: DatabaseSync, runId: string): RunActivation[] {
  return activationRows(database, runId).map(({ activation }) => activation);
}

export function loadRunActivation(
  database: DatabaseSync,
  runId: string,
  activationNumber: number,
): StoredRunActivation | null {
  return (
    activationRows(database, runId).find(
      ({ activation }) => activation.activationNumber === activationNumber,
    ) ?? null
  );
}

export function loadActiveRunActivation(
  database: DatabaseSync,
  runId: string,
): StoredRunActivation | null {
  return (
    activationRows(database, runId).find(({ activation }) => activation.state === 'active') ?? null
  );
}

export function closeRunActivation(
  database: DatabaseSync,
  record: StoredRunActivation,
  eventSequence: number,
  endedAt: string,
  reason: NonNullable<RunActivation['endReason']>,
): void {
  const update = database
    .prepare(
      `UPDATE run_activations
       SET state = 'ended', event_end_sequence = ?, ended_at = ?, end_reason = ?
       WHERE id = ? AND run_id = ? AND activation_number = ? AND state = 'active'`,
    )
    .run(
      eventSequence,
      endedAt,
      reason,
      record.id,
      record.activation.runId,
      record.activation.activationNumber,
    );
  if (Number(update.changes) !== 1) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Activation ${record.activation.activationNumber} changed concurrently`,
    );
  }
}
