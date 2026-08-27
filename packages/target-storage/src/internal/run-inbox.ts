import {
  DeliveryDestinationGrantV1Schema,
  EntityIdSchema,
  RunInboxMessageSchema,
  assertInboxOrdering,
  parseCanonical,
  type RunInboxMessage,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  decodeCanonicalRecord,
  decodeRunAcceptedSource,
  decodeSelectedContextRefs,
  encodeCanonicalRecord,
  encodeRunAcceptedSource,
  encodeSelectedContextRefs,
} from './canonical-codecs.js';
import { hashCanonical } from './hashes.js';

interface InboxRow {
  id: string;
  run_id: string;
  sequence: number;
  actor: RunInboxMessage['actor'];
  source_v1_json: string;
  selected_context_v1_json: string;
  export_destination_grant_v1_json: string | null;
  export_destination_grant_hash: string | null;
  content_hash: string;
  state: RunInboxMessage['state'];
  created_at: string;
}

function fromRow(row: InboxRow): RunInboxMessage {
  if (
    (row.export_destination_grant_v1_json === null) !==
    (row.export_destination_grant_hash === null)
  ) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Run Inbox ${row.id} export destination grant columns are inconsistent`,
    );
  }
  const exportDestinationGrant =
    row.export_destination_grant_v1_json === null
      ? null
      : decodeCanonicalRecord(
          'Run Inbox export destination grant',
          DeliveryDestinationGrantV1Schema,
          row.export_destination_grant_v1_json,
        );
  if (
    exportDestinationGrant !== null &&
    hashCanonical(exportDestinationGrant) !== row.export_destination_grant_hash
  ) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Run Inbox ${row.id} export destination grant hash is invalid`,
    );
  }
  return parseCanonical(RunInboxMessageSchema, {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    actor: row.actor,
    source: decodeRunAcceptedSource(row.source_v1_json),
    selectedContext: decodeSelectedContextRefs(row.selected_context_v1_json),
    exportDestinationGrant,
    contentHash: row.content_hash,
    state: row.state,
    createdAt: row.created_at,
  });
}

export function insertRunInboxMessage(database: DatabaseSync, inboxValue: RunInboxMessage): void {
  if (!database.isTransaction) {
    throw new TargetStorageError('INVALID_REQUEST', 'Inbox insert requires an active transaction');
  }
  const inbox = parseCanonical(RunInboxMessageSchema, inboxValue);
  const exportDestinationGrantJson =
    inbox.exportDestinationGrant === null
      ? null
      : encodeCanonicalRecord(DeliveryDestinationGrantV1Schema, inbox.exportDestinationGrant);
  const exportDestinationGrantHash =
    inbox.exportDestinationGrant === null ? null : hashCanonical(inbox.exportDestinationGrant);
  database
    .prepare(
      `INSERT INTO run_inbox_messages (
         id, run_id, sequence, actor, source_v1_json, selected_context_v1_json,
         export_destination_grant_v1_json, export_destination_grant_hash,
         content_hash, state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      inbox.id,
      inbox.runId,
      inbox.sequence,
      inbox.actor,
      encodeRunAcceptedSource(inbox.source),
      encodeSelectedContextRefs(inbox.selectedContext),
      exportDestinationGrantJson,
      exportDestinationGrantHash,
      inbox.contentHash,
      inbox.state,
      inbox.createdAt,
    );
}

export function listRunInbox(database: DatabaseSync, runIdValue: string): RunInboxMessage[] {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const rows = database
    .prepare('SELECT * FROM run_inbox_messages WHERE run_id = ? ORDER BY sequence')
    .all(runId) as unknown as InboxRow[];
  const messages = rows.map(fromRow);
  if (messages.some((message, index) => message.sequence !== index + 1)) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${runId} Inbox sequence is not contiguous`);
  }
  try {
    assertInboxOrdering(messages);
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${runId} Inbox order is invalid`, { cause });
  }
  return messages;
}

export function nextRunInboxSequence(database: DatabaseSync, runId: string): number {
  return (listRunInbox(database, runId).at(-1)?.sequence ?? 0) + 1;
}

export function updateRunInboxState(
  database: DatabaseSync,
  before: RunInboxMessage,
  state: RunInboxMessage['state'],
): RunInboxMessage {
  const update = database
    .prepare(
      `UPDATE run_inbox_messages
       SET state = ?
       WHERE id = ? AND run_id = ? AND sequence = ? AND state = ?`,
    )
    .run(state, before.id, before.runId, before.sequence, before.state);
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Inbox message ${before.id} changed concurrently`,
    );
  }
  return parseCanonical(RunInboxMessageSchema, { ...before, state });
}
