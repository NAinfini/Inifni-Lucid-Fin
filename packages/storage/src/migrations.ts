/**
 * Schema migration system.
 *
 * Uses SQLite PRAGMA user_version to track which migrations have been applied.
 * Migrations run inside a transaction for atomicity.
 */
import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * Current schema version. Bump this when adding a new migration.
 * Version 1 = baseline (all existing tables via schema-sql.ts).
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Ordered list of migrations. Each migration's `version` field is its
 * target user_version after the migration runs.
 *
 * Version 1 is the baseline — the existing schema-sql.ts tables.
 * Future migrations go here as version 2, 3, etc.
 */
export const MIGRATIONS: Migration[] = [
  // Version 1 is the baseline schema (schema-sql.ts). No migration needed.
  // Example for future:
  // {
  //   version: 2,
  //   description: 'Add soft-delete GC index',
  //   up: (db) => {
  //     db.exec(`CREATE INDEX IF NOT EXISTS idx_characters_deleted_at ON characters(deleted_at) WHERE deleted_at IS NOT NULL`);
  //   },
  // },
];

/**
 * Read current schema version from the database.
 */
export function getSchemaVersion(db: Database.Database): number {
  const row = db.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}

/**
 * Set schema version.
 */
function setSchemaVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

/**
 * Run all pending migrations in order inside a transaction.
 * Returns the number of migrations applied.
 */
export function runMigrations(db: Database.Database): number {
  const current = getSchemaVersion(db);

  if (current >= CURRENT_SCHEMA_VERSION) return 0;

  // If version is 0, this is a fresh database — set to current version
  // (schema-sql.ts already created all tables).
  if (current === 0) {
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    return 0;
  }

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    // No migration code but version needs bumping (shouldn't happen, but safe).
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    return 0;
  }

  const runAll = db.transaction(() => {
    for (const migration of pending) {
      migration.up(db);
      setSchemaVersion(db, migration.version);
    }
  });

  runAll();
  return pending.length;
}
