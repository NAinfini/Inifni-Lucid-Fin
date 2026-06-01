import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from './schema-sql.js';
import { purgeSoftDeleted } from './gc.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

describe('purgeSoftDeleted', () => {
  it('purges rows older than retention period', () => {
    const db = createTestDb();
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

    db.prepare(
      `INSERT INTO characters (id, name, role, description, reference_images, loadouts, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?)`,
    ).run('old-1', 'Old Char', 'extra', 'desc', 0, 0, oldDate);

    db.prepare(
      `INSERT INTO characters (id, name, role, description, reference_images, loadouts, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, '[]', '[]', ?, ?, ?)`,
    ).run('recent-1', 'Recent Char', 'extra', 'desc', 0, 0, recentDate);

    db.prepare(
      `INSERT INTO characters (id, name, role, description, reference_images, loadouts, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', '[]', ?, ?)`,
    ).run('alive-1', 'Alive Char', 'extra', 'desc', 0, 0);

    const result = purgeSoftDeleted(db);
    expect(result.characters).toBe(1); // only old-1 purged
    expect(result.total).toBe(1);

    const remaining = db.prepare('SELECT id FROM characters').all();
    expect(remaining.map((r: any) => r.id).sort()).toEqual(['alive-1', 'recent-1']);
    db.close();
  });

  it('returns zero counts when nothing to purge', () => {
    const db = createTestDb();
    const result = purgeSoftDeleted(db);
    expect(result.total).toBe(0);
    db.close();
  });
});
