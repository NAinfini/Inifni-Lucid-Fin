import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getStoreDatabase } from './database-access.js';
import { hashCanonical } from './hashes.js';
import { appendRunEventBatch, loadPublicRunEvents } from './run-journal.js';
import { createStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T13:00:00.000Z';
const HASH = 'a'.repeat(64);
const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-run-journal-'));
  paths.push(directory);
  const store = await createStore(join(directory, 'project.sqlite'));
  const database = getStoreDatabase(store);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('PRAGMA defer_foreign_keys = ON');
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('project.1', 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.1', ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);
    database
      .prepare(
        `INSERT INTO chats (
           id, project_id, revision, content_hash, title, lifecycle, message_count,
           message_head_sequence, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('chat.1', 'project.1', 0, ?, 'Main', 'active', 1, 1, ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);
    database
      .prepare(
        `INSERT INTO messages (
           id, project_id, chat_id, sequence, role, status, originating_run_id,
           content_hash, supersedes_message_id, created_at
         ) VALUES ('message.1', 'project.1', 'chat.1', 1, 'user', 'accepted', NULL, ?, NULL, ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO message_payloads (message_id, blocks_v1_json, payload_hash, erased_at)
         VALUES ('message.1', '[{"text":"Start","type":"text"}]', ?, NULL)`,
      )
      .run(hashCanonical([{ type: 'text', text: 'Start' }]));
    database
      .prepare(
        `INSERT INTO runs (
           id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
           objective_message_id, objective_parent_event_id, objective_hash,
           child_display_name, child_public_summary, status, provider_profile_id, model,
           reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
           context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
           accepted_at, finished_at, terminal_summary
         ) VALUES ('run.1', 0, ?, 'run.1', NULL, 'project.1', 'chat.1', 'message.1', NULL, ?,
           NULL, NULL, 'running', NULL, 'model.1', NULL, 'reversible', '{}', 'context.1', ?,
           'catalog.1', ?, ?, NULL, NULL)`,
      )
      .run(HASH, HASH, HASH, HASH, NOW);
    database
      .prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, parent_event_id,
           manifest_hash, manifest_v1_json, created_at
         ) VALUES ('context.1', 'run.1', 'project.1', 'chat.1', 'message.1', NULL, ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO capability_catalog_snapshots (
           id, run_id, catalog_hash, catalog_v1_json, created_at
         ) VALUES ('catalog.1', 'run.1', ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { store, database };
}

const publicDraft = {
  eventId: 'run-event.public',
  visibility: 'public' as const,
  occurredAt: NOW,
  actor: 'commander' as const,
  causation: { kind: 'run' as const, runId: 'run.1' },
  correlationId: 'correlation.1',
  payload: { type: 'progress' as const, summary: 'Reviewing references.' },
};
const modelDraft = {
  eventId: 'run-event.model',
  visibility: 'model_surface' as const,
  occurredAt: LATER,
  actor: 'system' as const,
  causation: { kind: 'run' as const, runId: 'run.1' },
  correlationId: null,
  payload: {
    type: 'message_ref' as const,
    role: 'user' as const,
    messageId: 'message.1',
    messageHash: HASH,
  },
};

describe('RunJournal', () => {
  it('appends a mixed-surface batch on one continuous canonical hash chain', async () => {
    const { store, database } = await harness();
    try {
      const events = withImmediateTransaction(database, () =>
        appendRunEventBatch(database, {
          runId: 'run.1',
          commandId: 'command.journal.1',
          events: [publicDraft, modelDraft],
        }),
      );
      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ sequence: 1, previousEventHash: null });
      expect(events[1]).toMatchObject({ sequence: 2, previousEventHash: events[0]!.eventHash });
      expect(events[0]!.payloadHash).toBe(hashCanonical(publicDraft.payload));
      expect(events[1]!.payloadHash).toBe(hashCanonical(modelDraft.payload));
      const rows = database
        .prepare('SELECT sequence, idempotency_key FROM run_events ORDER BY sequence')
        .all() as Array<{ sequence: number; idempotency_key: string }>;
      expect(rows.map(({ sequence }) => sequence)).toEqual([1, 2]);
      expect(new Set(rows.map(({ idempotency_key }) => idempotency_key)).size).toBe(2);
      expect(rows.every(({ idempotency_key }) => idempotency_key.length <= 160)).toBe(true);
    } finally {
      store.close();
    }
  });

  it('lists only public events, binds payload redaction to the immutable envelope, and rejects tampering', async () => {
    const { store, database } = await harness();
    try {
      withImmediateTransaction(database, () =>
        appendRunEventBatch(database, {
          runId: 'run.1',
          commandId: 'command.journal.2',
          events: [publicDraft, modelDraft],
        }),
      );
      expect(loadPublicRunEvents(database, 'run.1')).toEqual([
        expect.objectContaining({
          eventId: publicDraft.eventId,
          sequence: 1,
          visibility: 'public',
        }),
      ]);
      database
        .prepare(
          `UPDATE run_event_payloads
           SET payload_v1_json = NULL, erased_at = ?
           WHERE run_event_id = ?`,
        )
        .run(LATER, publicDraft.eventId);
      const redacted = loadPublicRunEvents(database, 'run.1');
      expect(redacted).toEqual([
        expect.objectContaining({
          eventId: publicDraft.eventId,
          payloadState: { state: 'redacted', erasedAt: LATER },
        }),
      ]);
      expect(redacted[0]!.eventHash).toBe(
        (
          database
            .prepare('SELECT event_hash FROM run_events WHERE id = ?')
            .get(publicDraft.eventId) as { event_hash: string }
        ).event_hash,
      );
      database
        .prepare("UPDATE run_events SET event_hash = ? WHERE id = 'run-event.model'")
        .run('f'.repeat(64));
      expect(() => loadPublicRunEvents(database, 'run.1')).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      store.close();
    }
  });

  it('rolls back an entire batch without consuming a sequence when a later payload insert fails', async () => {
    const { store, database } = await harness();
    try {
      database.exec(
        `CREATE TRIGGER fail_second_run_payload
         BEFORE INSERT ON run_event_payloads
         WHEN NEW.run_event_id = 'run-event.model'
         BEGIN
           SELECT RAISE(ABORT, 'injected journal failure');
         END`,
      );
      expect(() =>
        withImmediateTransaction(database, () =>
          appendRunEventBatch(database, {
            runId: 'run.1',
            commandId: 'command.journal.rollback',
            events: [publicDraft, modelDraft],
          }),
        ),
      ).toThrow('injected journal failure');
      expect(database.prepare('SELECT COUNT(*) AS count FROM run_events').get()).toEqual({
        count: 0,
      });
      database.exec('DROP TRIGGER fail_second_run_payload');
      const [event] = withImmediateTransaction(database, () =>
        appendRunEventBatch(database, {
          runId: 'run.1',
          commandId: 'command.journal.after-rollback',
          events: [publicDraft],
        }),
      );
      expect(event?.sequence).toBe(1);
    } finally {
      store.close();
    }
  });
});
