import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(ddlUrl, 'utf8'));
  database.exec('PRAGMA foreign_keys = OFF');
  return database;
}

describe('I3-K2 crash retry lineage DDL', () => {
  it('stores retry lineage as one paired self-FK with unique seeds', async () => {
    const database = await openDatabase();
    try {
      const columns = (
        database.prepare('PRAGMA table_info("runs")').all() as { name: string }[]
      ).map(({ name }) => name);
      expect(columns).toEqual(expect.arrayContaining(['retry_of_run_id', 'retry_seed_hash']));

      const retryForeignKey = (
        database.prepare('PRAGMA foreign_key_list("runs")').all() as {
          from: string;
          on_delete: string;
          table: string;
          to: string;
        }[]
      ).find(({ from }) => from === 'retry_of_run_id');
      expect(retryForeignKey).toMatchObject({
        from: 'retry_of_run_id',
        on_delete: 'RESTRICT',
        table: 'runs',
        to: 'id',
      });

      const insertRoot = database.prepare(`
        INSERT INTO runs (
          id, revision, content_hash, root_run_id, parent_run_id,
          retry_of_run_id, retry_seed_hash, project_id, chat_id,
          objective_message_id, objective_parent_event_id, objective_hash,
          child_display_name, child_public_summary, status, model,
          permission_mode, budget_v1_json, context_manifest_id, context_manifest_hash,
          capability_catalog_snapshot_id, capability_catalog_hash, accepted_at,
          finished_at, terminal_summary
        ) VALUES (
          ?, 0, ?, ?, NULL, ?, ?, 'project.1', 'chat.1',
          'message.1', NULL, ?, NULL, NULL, 'accepted', 'model.1',
          'reversible', '{}', ?, ?, 'catalog.1', ?,
          '2026-08-16T12:00:00.000Z', NULL, NULL
        )
      `);
      const root = (id: string, retryOfRunId: string | null, retrySeedHash: string | null) =>
        insertRoot.run(
          id,
          HASH_A,
          id,
          retryOfRunId,
          retrySeedHash,
          HASH_A,
          `manifest.${id}`,
          HASH_B,
          HASH_A,
        );

      expect(() => root('run.initial', null, null)).not.toThrow();
      expect(() => root('run.retry', 'run.initial', HASH_B)).not.toThrow();
      expect(() => root('run.duplicate', 'run.initial', HASH_B)).toThrow();
      expect(() => root('run.duplicate-other-seed', 'run.initial', HASH_A)).toThrow();
      expect(() => root('run.partial-id', 'run.initial', null)).toThrow();
      expect(() => root('run.partial-seed', null, HASH_B)).toThrow();
      expect(() => root('run.self', 'run.self', HASH_B)).toThrow();

      const insertChild = database.prepare(`
        INSERT INTO runs (
          id, revision, content_hash, root_run_id, parent_run_id,
          retry_of_run_id, retry_seed_hash, project_id, chat_id,
          objective_message_id, objective_parent_event_id, objective_hash,
          child_display_name, child_public_summary, status, model,
          permission_mode, budget_v1_json, context_manifest_id, context_manifest_hash,
          capability_catalog_snapshot_id, capability_catalog_hash, accepted_at,
          finished_at, terminal_summary
        ) VALUES (
          ?, 0, ?, 'run.initial', 'run.initial', ?, ?, 'project.1', 'chat.1',
          NULL, 'event.delegate', ?, 'Child', 'Delegated child work.', 'accepted', 'model.1',
          'reversible', '{}', ?, ?, 'catalog.1', ?,
          '2026-08-16T12:00:00.000Z', NULL, NULL
        )
      `);
      const child = (id: string, retryOfRunId: string | null, retrySeedHash: string | null) =>
        insertChild.run(
          id,
          HASH_A,
          retryOfRunId,
          retrySeedHash,
          HASH_A,
          `manifest.${id}`,
          HASH_B,
          HASH_A,
        );

      expect(() => child('run.child', null, null)).not.toThrow();
      expect(() => child('run.child-retry', 'run.initial', HASH_A)).toThrow();
    } finally {
      database.close();
    }
  });
});
