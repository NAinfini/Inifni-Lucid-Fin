/**
 * Migration 001 — Baseline column additions.
 *
 * Consolidates all legacy inline migrations (migrateCharacters, migrateJobs,
 * migrateCanvases, migrateAssets) into a single versioned migration.
 *
 * For existing databases: these columns likely already exist (added by the old
 * startup code). The "IF NOT EXISTS"-style checks via PRAGMA table_info ensure
 * this migration is safe to run on any database state.
 *
 * For brand-new databases: SCHEMA_SQL already includes these columns, so this
 * migration is a no-op. It still records its version to prevent re-execution.
 */
import type BetterSqlite3 from 'better-sqlite3';
import type { Migration } from './runner.js';

function addMissingColumns(
  db: BetterSqlite3.Database,
  table: string,
  additions: Array<[string, string]>,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const existing = new Set(cols.map((c) => c.name));
  for (const [col, def] of additions) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }
}

export const migration001: Migration = {
  version: 1,
  name: 'baseline-column-additions',
  up(db) {
    // Characters
    addMissingColumns(db, 'characters', [
      ['description', "TEXT DEFAULT ''"],
      ['appearance', "TEXT DEFAULT ''"],
      ['personality', "TEXT DEFAULT ''"],
      ['costumes', "TEXT DEFAULT '[]'"],
      ['created_at', 'INTEGER'],
      ['updated_at', 'INTEGER'],
      ['age', 'INTEGER'],
      ['gender', 'TEXT'],
      ['voice', 'TEXT'],
      ['reference_images', "TEXT DEFAULT '[]'"],
      ['loadouts', "TEXT DEFAULT '[]'"],
      ['default_loadout_id', "TEXT DEFAULT ''"],
    ]);

    // Jobs
    addMissingColumns(db, 'jobs', [
      ['progress', 'REAL'],
      ['completed_steps', 'INTEGER'],
      ['total_steps', 'INTEGER'],
      ['current_step', 'TEXT'],
      ['batch_id', 'TEXT'],
      ['batch_index', 'INTEGER'],
    ]);

    // Canvases
    addMissingColumns(db, 'canvases', [
      ['notes', "TEXT NOT NULL DEFAULT '[]'"],
    ]);

    // Assets
    addMissingColumns(db, 'assets', [
      ['width', 'INTEGER'],
      ['height', 'INTEGER'],
      ['duration', 'REAL'],
    ]);
  },
};
