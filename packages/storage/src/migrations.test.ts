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
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(CURRENT_SCHEMA_VERSION)).toBe(true);
  });
});
