import { EntityIdSchema, RunSchema, parseCanonical, type Run } from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { decodeResourceBudget } from './canonical-codecs.js';
import { hashContentObject } from './hashes.js';
import { loadRunEventHead, type RunEventHead } from './run-journal.js';

interface RunRow {
  id: string;
  revision: number;
  content_hash: string;
  root_run_id: string;
  parent_run_id: string | null;
  retry_of_run_id: string | null;
  retry_seed_hash: string | null;
  project_id: string;
  chat_id: string;
  objective_message_id: string | null;
  objective_parent_event_id: string | null;
  objective_hash: string;
  child_display_name: string | null;
  child_public_summary: string | null;
  status: Run['status'];
  provider_profile_id: string | null;
  model: string;
  reasoning_strength: string | null;
  permission_mode: Run['permissionMode'];
  budget_v1_json: string;
  context_manifest_id: string;
  context_manifest_hash: string;
  capability_catalog_snapshot_id: string;
  capability_catalog_hash: string;
  accepted_at: string;
  finished_at: string | null;
  terminal_summary: string | null;
}

interface RecoveryHeadRow {
  sequence: number;
  envelope_hash: string;
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function privateRecoveryHead(database: DatabaseSync, runId: string) {
  const row = database
    .prepare(
      `SELECT sequence, envelope_hash
       FROM private_recovery_envelopes
       WHERE run_id = ?
       ORDER BY sequence DESC
       LIMIT 1`,
    )
    .get(runId) as unknown as RecoveryHeadRow | undefined;
  return row === undefined ? null : { sequence: row.sequence, hash: row.envelope_hash };
}

function terminalEventId(row: RunRow, journalHead: RunEventHead | null): string | null {
  if (row.finished_at === null && row.terminal_summary === null) return null;
  if (row.finished_at === null || row.terminal_summary === null) {
    throw corrupt(`Run ${row.id} terminal columns are incomplete`);
  }
  if (journalHead === null) throw corrupt(`Terminal Run ${row.id} has no terminal event`);
  return journalHead.eventId;
}

function runFromRow(database: DatabaseSync, row: RunRow): Run {
  if (row.provider_profile_id === null) throw corrupt(`Run ${row.id} has no provider profile`);
  const journalHead = loadRunEventHead(database, row.id);
  const acceptedSource =
    row.parent_run_id === null
      ? {
          kind: 'message' as const,
          messageId: row.objective_message_id,
          contentHash: row.objective_hash,
        }
      : {
          kind: 'parent_direction' as const,
          parentRunId: row.parent_run_id,
          parentEventId: row.objective_parent_event_id,
          directionHash: row.objective_hash,
        };
  const terminalId = terminalEventId(row, journalHead);
  const candidate = {
    authority: 'run' as const,
    id: row.id,
    revision: row.revision,
    contentHash: row.content_hash,
    rootRunId: row.root_run_id,
    parentRunId: row.parent_run_id,
    retryOfRunId: row.retry_of_run_id,
    retrySeedHash: row.retry_seed_hash,
    projectId: row.project_id,
    chatId: row.chat_id,
    acceptedSource,
    status: row.status,
    model: {
      providerId: row.provider_profile_id,
      model: row.model,
      reasoningStrength: row.reasoning_strength,
    },
    permissionMode: row.permission_mode,
    budget: decodeResourceBudget(row.budget_v1_json),
    contextManifestId: row.context_manifest_id,
    contextManifestHash: row.context_manifest_hash,
    capabilityCatalogSnapshotId: row.capability_catalog_snapshot_id,
    capabilityCatalogHash: row.capability_catalog_hash,
    publicEventHead:
      journalHead === null ? null : { sequence: journalHead.sequence, hash: journalHead.eventHash },
    privateRecoveryHead: privateRecoveryHead(database, row.id),
    acceptedAt: row.accepted_at,
    terminalOutcome:
      terminalId === null
        ? null
        : {
            status: row.status,
            summary: row.terminal_summary,
            terminalEventId: terminalId,
            finishedAt: row.finished_at,
          },
    ...(row.parent_run_id === null
      ? {}
      : { displayName: row.child_display_name, publicSummary: row.child_public_summary }),
  };
  const run = parseCanonical(RunSchema, candidate);
  if (hashContentObject(run) !== run.contentHash) {
    throw corrupt(`Run ${run.id} content hash does not match its stored value`);
  }
  return run;
}

export function loadRun(database: DatabaseSync, runIdValue: string): Run {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const row = database.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as unknown as
    RunRow | undefined;
  if (row === undefined) throw new StorageError('NOT_FOUND', `Run was not found: ${runId}`);
  return runFromRow(database, row);
}

export function advanceRunJournalHead(
  database: DatabaseSync,
  before: Run,
  head: RunEventHead,
  transition?: Readonly<{
    status: Run['status'];
    terminalOutcome: Run['terminalOutcome'];
  }>,
): Run {
  if (!database.isTransaction) {
    throw new StorageError('INVALID_REQUEST', 'Run update requires an active transaction');
  }
  const actualHead = loadRunEventHead(database, before.id);
  if (
    actualHead === null ||
    actualHead.eventId !== head.eventId ||
    actualHead.sequence !== head.sequence ||
    actualHead.eventHash !== head.eventHash
  ) {
    throw new StorageError('CORRUPT_DATA', `Run ${before.id} Journal head is inconsistent`);
  }
  const nextWithoutHash = {
    ...before,
    revision: before.revision + 1,
    contentHash: '',
    publicEventHead: { sequence: head.sequence, hash: head.eventHash },
    status: transition === undefined ? before.status : transition.status,
    terminalOutcome: transition === undefined ? before.terminalOutcome : transition.terminalOutcome,
  };
  const after = parseCanonical(RunSchema, {
    ...nextWithoutHash,
    contentHash: hashContentObject(nextWithoutHash),
  });
  const update = database
    .prepare(
      `UPDATE runs
       SET revision = ?, content_hash = ?, status = ?, finished_at = ?, terminal_summary = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND status = ?`,
    )
    .run(
      after.revision,
      after.contentHash,
      after.status,
      after.terminalOutcome?.finishedAt ?? null,
      after.terminalOutcome?.summary ?? null,
      before.id,
      before.revision,
      before.contentHash,
      before.status,
    );
  if (Number(update.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `Run ${before.id} changed concurrently`);
  }
  return after;
}

/** Advances the public Journal and an appended private recovery head in one Run revision. */
export function advanceRunJournalAndPrivateRecoveryHead(
  database: DatabaseSync,
  before: Run,
  head: RunEventHead,
  privateHead: NonNullable<Run['privateRecoveryHead']>,
): Run {
  if (!database.isTransaction) {
    throw new StorageError('INVALID_REQUEST', 'Run update requires an active transaction');
  }
  const actualHead = loadRunEventHead(database, before.id);
  const actualPrivateHead = privateRecoveryHead(database, before.id);
  if (
    actualHead === null ||
    actualHead.eventId !== head.eventId ||
    actualHead.sequence !== head.sequence ||
    actualHead.eventHash !== head.eventHash ||
    actualPrivateHead === null ||
    actualPrivateHead.sequence !== privateHead.sequence ||
    actualPrivateHead.hash !== privateHead.hash ||
    before.privateRecoveryHead === null ||
    privateHead.sequence !== before.privateRecoveryHead.sequence + 1
  ) {
    throw new StorageError('CORRUPT_DATA', `Run ${before.id} head is inconsistent`);
  }
  const nextWithoutHash = {
    ...before,
    revision: before.revision + 1,
    contentHash: '',
    publicEventHead: { sequence: head.sequence, hash: head.eventHash },
    privateRecoveryHead: privateHead,
  };
  const after = parseCanonical(RunSchema, {
    ...nextWithoutHash,
    contentHash: hashContentObject(nextWithoutHash),
  });
  const update = database
    .prepare(
      `UPDATE runs
       SET revision = ?, content_hash = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND status = ?`,
    )
    .run(
      after.revision,
      after.contentHash,
      after.id,
      before.revision,
      before.contentHash,
      before.status,
    );
  if (Number(update.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `Run ${before.id} changed concurrently`);
  }
  return after;
}
