/**
 * Migration 002 — Add context_graph_json column to commander_sessions.
 *
 * Phase G2a-5: supports ContextGraph persistence per session.
 * The column is nullable TEXT (JSON); NULL means no graph has been persisted
 * for that session yet (old sessions remain valid).
 *
 * This migration is idempotent: if the column already exists (fresh-install
 * DBs bootstrapped from SCHEMA_SQL which already includes this column),
 * the migration is a no-op.
 */
import type { Migration } from './runner.js';

export const migration002: Migration = {
  version: 2,
  name: 'add-context-graph-json',
  up(db) {
    // Check if the column already exists before altering the table.
    // Fresh-install DBs bootstrapped from SCHEMA_SQL already have this column.
    const info = db.pragma(`table_info(commander_sessions)`) as Array<{ name: string }>;
    const hasColumn = info.some((col) => col.name === 'context_graph_json');
    if (!hasColumn) {
      db.exec(
        `ALTER TABLE commander_sessions ADD COLUMN context_graph_json TEXT;`,
      );
    }
  },
};
