import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, getSchemaVersion, runMigrations } from './migrations.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  return db;
}

describe('schema migrations', () => {
  it('sets version to CURRENT on fresh database (version 0)', () => {
    const db = createTestDb();
    expect(getSchemaVersion(db)).toBe(0);

    const applied = runMigrations(db);
    expect(applied).toBe(0);
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it('is a no-op when already at current version', () => {
    const db = createTestDb();
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);

    const applied = runMigrations(db);
    expect(applied).toBe(0);
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    db.close();
  });

  it('CURRENT_SCHEMA_VERSION is a positive integer', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(4);
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
  });

  it('migrates a version 1 workflow schema additively to the current version', () => {
    const db = createTestDb();
    db.exec(`
      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    db.pragma('user_version = 1');

    expect(runMigrations(db)).toBe(3);
    expect(getSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);

    const runColumns = db.pragma('table_info(workflow_runs)') as Array<{ name: string }>;
    expect(runColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'row_version',
        'current_gate',
        'engine_version',
        'definition_version',
      ]),
    );

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('workflow_documents', 'workflow_approvals', 'workflow_events', 'workflow_export_executions', 'workflow_media_attempts', 'workflow_media_evaluations') ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    expect(tables.map(({ name }) => name)).toEqual([
      'workflow_approvals',
      'workflow_documents',
      'workflow_events',
      'workflow_export_executions',
      'workflow_media_attempts',
      'workflow_media_evaluations',
    ]);

    expect(() =>
      db
        .prepare(
          `INSERT INTO workflow_approvals (
             id, workflow_run_id, gate_key, subject_logical_key, subject_revision,
             subject_hash, manifest_hash, resume_token_hash, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'a-invalid',
          'run-1',
          'fourth_gate',
          'plan',
          1,
          'hash',
          'manifest',
          'token',
          'pending',
          1,
          1,
        ),
    ).toThrow();

    db.close();
  });
});
