/**
 * Migration 003 — Add folders infrastructure.
 *
 * Adds four `<kind>_folders` tables (character/equipment/location/asset) and
 * a `folder_id` column on each of the four entity tables.
 *
 * Idempotent: each `CREATE TABLE` uses `IF NOT EXISTS`; `ALTER TABLE ADD COLUMN`
 * is guarded by a `pragma table_info` probe so fresh-install DBs bootstrapped
 * from SCHEMA_SQL (which already carries these columns) skip the alter.
 */
import type { Migration } from './runner.js';

const FOLDER_TABLES = ['character_folders', 'equipment_folders', 'location_folders', 'asset_folders'] as const;

const ENTITY_TABLES_WITH_FOLDER_ID = ['characters', 'equipment', 'locations', 'assets'] as const;

export const migration003: Migration = {
  version: 3,
  name: 'add-folders',
  up(db) {
    // 1. Create folder tables if absent.
    for (const table of FOLDER_TABLES) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id         TEXT PRIMARY KEY,
          parent_id  TEXT,
          name       TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (parent_id) REFERENCES ${table}(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_${table}_parent ON ${table}(parent_id);
      `);
    }

    // 2. Add folder_id column to each entity table if absent.
    for (const table of ENTITY_TABLES_WITH_FOLDER_ID) {
      const info = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
      const hasColumn = info.some((col) => col.name === 'folder_id');
      if (!hasColumn) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN folder_id TEXT;`);
      }
    }
  },
};
