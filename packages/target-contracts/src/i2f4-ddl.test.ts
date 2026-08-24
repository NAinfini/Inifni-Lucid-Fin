import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<DatabaseSync> {
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(ddlUrl, 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

function tableSql(db: DatabaseSync, table: string): string {
  return (
    db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table) as {
      sql: string;
    }
  ).sql;
}

describe('I2-F4 provider receipt DDL', () => {
  it('allows receipt-less unknown but still rejects receipt-less submitted for provider owners', async () => {
    const db = await openDatabase();
    try {
      const generation = db.prepare(`
        INSERT INTO generation_attempts (
          id, request_id, attempt_number, revision, content_hash, state,
          provider_profile_id, provider_v1_json, quote_v1_json,
          provider_operation_id, receipt_v1_json, usage_v1_json,
          prompt_provenance_v1_json, cancel_requested, progress_percent,
          public_error_code, created_at, finished_at
        ) VALUES (?, 'request.1', ?, 0, ?, ?, 'profile.1', '{}', NULL, NULL, NULL, NULL,
                  '{}', 0, NULL, ?, ?, NULL)
      `);
      expect(() =>
        generation.run('generation.unknown', 1, HASH_A, 'unknown', 'provider_state_unknown', NOW),
      ).not.toThrow();
      expect(() =>
        generation.run('generation.submitted', 2, HASH_A, 'submitted', null, NOW),
      ).toThrow();

      const media = db.prepare(`
        INSERT INTO media_derivation_attempts (
          id, derivation_id, attempt_number, revision, content_hash, state,
          provider_profile_id, provider_v1_json, provider_operation_id,
          receipt_v1_json, usage_v1_json, cancel_requested, progress_percent,
          public_error_code, created_at, finished_at
        ) VALUES (?, 'derivation.1', ?, 0, ?, ?, 'profile.1', '{}', NULL, NULL, NULL,
                  0, NULL, ?, ?, NULL)
      `);
      expect(() =>
        media.run('media.unknown', 1, HASH_A, 'unknown', 'provider_state_unknown', NOW),
      ).not.toThrow();
      expect(() => media.run('media.submitted', 2, HASH_A, 'submitted', null, NOW)).toThrow();

      const assessment = db.prepare(`
        INSERT INTO result_assessment_attempts (
          id, project_id, run_id, revision, content_hash, assessment_kind,
          request_v1_json, state, provider_profile_id, provider_v1_json,
          provider_operation_id, receipt_v1_json, usage_v1_json,
          request_hash, idempotency_key, cancel_requested, progress_percent,
          public_error_code, created_at, finished_at
        ) VALUES (?, 'project.1', 'run.1', 0, ?, 'coverage', '{}', ?, 'profile.1', '{}',
                  NULL, NULL, NULL, ?, ?, 0, NULL, ?, ?, NULL)
      `);
      expect(() =>
        assessment.run(
          'assessment.unknown',
          HASH_A,
          'unknown',
          HASH_A,
          HASH_A,
          'provider_state_unknown',
          NOW,
        ),
      ).not.toThrow();
      expect(() =>
        assessment.run('assessment.submitted', HASH_A, 'submitted', HASH_A, HASH_B, null, NOW),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('keeps local Review Cut and Delivery Export out of provider states', async () => {
    const db = await openDatabase();
    try {
      for (const table of ['review_cut_attempts', 'delivery_exports']) {
        expect(tableSql(db, table), table).toContain("state NOT IN ('submitted', 'unknown')");
      }
    } finally {
      db.close();
    }
  });
});
