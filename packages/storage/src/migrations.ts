/**
 * Schema migration system.
 *
 * Uses SQLite PRAGMA user_version to track which migrations have been applied.
 * Migrations run inside a transaction for atomicity.
 */
import type Database from 'better-sqlite3';
import { WORKFLOW_PERSISTENCE_TABLES_SQL } from './schema-sql.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * Current schema version. Bump this when adding a new migration.
 * Version 1 = baseline (all existing tables via schema-sql.ts).
 */
export const CURRENT_SCHEMA_VERSION = 7;

/**
 * Ordered list of migrations. Each migration's `version` field is its
 * target user_version after the migration runs.
 *
 * Version 1 is the baseline — the existing schema-sql.ts tables.
 * Future migrations continue here as version 5, 6, etc.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    description: 'Add persistent workflow documents, approvals, events, and run CAS fields',
    up: (db) => {
      db.exec(`
        ALTER TABLE workflow_runs
          ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0 CHECK (row_version >= 0);
        ALTER TABLE workflow_runs
          ADD COLUMN current_gate TEXT CHECK (current_gate IS NULL OR current_gate IN ('production_plan', 'visual_constitution', 'final_export'));
        ALTER TABLE workflow_runs
          ADD COLUMN engine_version TEXT NOT NULL DEFAULT 'legacy';
        ALTER TABLE workflow_runs
          ADD COLUMN definition_version INTEGER NOT NULL DEFAULT 1 CHECK (definition_version > 0);
        ${WORKFLOW_PERSISTENCE_TABLES_SQL}
      `);
    },
  },
  {
    version: 3,
    description: 'Add persistent Final Export execution ledger',
    up: (db) => {
      db.exec(WORKFLOW_PERSISTENCE_TABLES_SQL);
    },
  },
  {
    version: 4,
    description: 'Add persistent production-media attempt and evaluation ledgers',
    up: (db) => {
      db.exec(WORKFLOW_PERSISTENCE_TABLES_SQL);
    },
  },
  {
    version: 5,
    description: 'Add durable workflow-bound AskUser decisions',
    up: (db) => {
      db.exec(WORKFLOW_PERSISTENCE_TABLES_SQL);
    },
  },
  {
    version: 6,
    description: 'Add canonical Canvas resolution policy JSON',
    up: (db) => {
      const canvasTable = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canvases'")
        .get();
      if (!canvasTable) return;
      const columns = db.pragma('table_info(canvases)') as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === 'resolution_policy_json')) {
        db.exec('ALTER TABLE canvases ADD COLUMN resolution_policy_json TEXT');
      }
    },
  },
  {
    version: 7,
    description: 'Add canonical Canvas visual-style draft policy JSON',
    up: (db) => {
      const canvasTable = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'canvases'")
        .get();
      if (!canvasTable) return;
      const columns = db.pragma('table_info(canvases)') as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === 'visual_style_policy_json')) {
        db.exec('ALTER TABLE canvases ADD COLUMN visual_style_policy_json TEXT');
      }
    },
  },
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
