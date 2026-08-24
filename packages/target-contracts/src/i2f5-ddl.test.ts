import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const HASH_A = 'a'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(ddlUrl, 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

describe('I2-F5 result assessment search DDL', () => {
  it('admits only the exact result_assessment source kind', async () => {
    const db = await openDatabase();
    try {
      const table = db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'project_search_documents'",
        )
        .get() as { sql: string };
      expect(table.sql).toContain(
        "source_kind IN ('production', 'project_media_ref', 'delivery', 'generated_result', 'result_assessment', 'review_cut', 'delivery_export', 'message')",
      );

      const insert = db.prepare(`
        INSERT INTO project_search_documents (
          id, project_id, source_kind, source_id, source_revision, source_hash,
          source_state, source_v1_json, search_text, updated_at
        ) VALUES (?, 'project.1', ?, 'assessment.1', 1, ?, 'current', '{}', ?, ?)
      `);
      expect(() =>
        insert.run(
          'search.assessment.1',
          'result_assessment',
          HASH_A,
          'Continuity assessment',
          NOW,
        ),
      ).not.toThrow();
      expect(() =>
        insert.run('search.assessment.2', 'assessment', HASH_A, 'Legacy assessment', NOW),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
