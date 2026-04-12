import type { Migration } from './runner.js';

export const migration002: Migration = {
  version: 2,
  name: 'custom-shot-templates',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS custom_shot_templates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tracks_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cst_project ON custom_shot_templates(project_id)`);
  },
};
