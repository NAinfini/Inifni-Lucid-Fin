import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { withBatchFts, rebuildFtsIndex } from './fts-batch.js';

/**
 * Schema for tests — mirrors the production schema's assets table,
 * FTS5 virtual table, and triggers. Uses content=assets so the FTS
 * rebuild command can repopulate from source data.
 */
const SCHEMA = `
CREATE TABLE assets (
  hash        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  format      TEXT NOT NULL,
  tags        TEXT,
  prompt      TEXT,
  provider    TEXT,
  folder_id   TEXT,
  created_at  INTEGER NOT NULL,
  file_size   INTEGER,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  generation_metadata TEXT
);

CREATE VIRTUAL TABLE assets_fts USING fts5(
  tags, prompt, content=assets, content_rowid=rowid
);

CREATE TRIGGER assets_ai AFTER INSERT ON assets BEGIN
  INSERT INTO assets_fts(rowid, tags, prompt) VALUES (new.rowid, new.tags, new.prompt);
END;

CREATE TRIGGER assets_ad AFTER DELETE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, tags, prompt) VALUES('delete', old.rowid, old.tags, old.prompt);
END;

CREATE TRIGGER assets_au AFTER UPDATE ON assets BEGIN
  INSERT INTO assets_fts(assets_fts, rowid, tags, prompt) VALUES('delete', old.rowid, old.tags, old.prompt);
  INSERT INTO assets_fts(rowid, tags, prompt) VALUES (new.rowid, new.tags, new.prompt);
END;
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function insertAsset(db: BetterSqlite3.Database, hash: string, tags: string, prompt: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO assets (hash, type, format, tags, prompt, created_at, file_size)
     VALUES (?, 'image', 'png', ?, ?, ?, 1024)`,
  ).run(hash, tags, prompt, Date.now());
}

/** Search FTS and return matching asset hashes. */
function ftsSearch(db: BetterSqlite3.Database, query: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT a.hash FROM assets a
         JOIN assets_fts f ON a.rowid = f.rowid
         WHERE assets_fts MATCH ?`,
      )
      .all(query) as Array<{ hash: string }>;
    return rows.map((r) => r.hash);
  } catch {
    return [];
  }
}

/** Check whether a trigger exists by name. */
function triggerExists(db: BetterSqlite3.Database, name: string): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(name) as { cnt: number };
  return row.cnt > 0;
}

describe('withBatchFts', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = openDb();
  });

  afterEach(() => {
    db.close();
  });

  it('batch-inserts assets and FTS index is correct after rebuild', () => {
    withBatchFts(db, () => {
      for (let i = 0; i < 50; i++) {
        insertAsset(db, `asset-${i}`, `["tag${i}"]`, `prompt for asset ${i}`);
      }
    });

    // Verify all assets are searchable via FTS
    const results = ftsSearch(db, 'tag10');
    expect(results).toContain('asset-10');

    const results2 = ftsSearch(db, 'prompt');
    expect(results2.length).toBe(50);
  });

  it('restores triggers after batch operation', () => {
    withBatchFts(db, () => {
      insertAsset(db, 'batch-1', '["batch"]', 'batch prompt');
    });

    // Triggers should exist after batch completes
    expect(triggerExists(db, 'assets_ai')).toBe(true);
    expect(triggerExists(db, 'assets_ad')).toBe(true);
    expect(triggerExists(db, 'assets_au')).toBe(true);
  });

  it('individual inserts still trigger FTS after batch', () => {
    // Run a batch first
    withBatchFts(db, () => {
      insertAsset(db, 'batch-1', '["batch"]', 'batch prompt');
    });

    // Now insert a single asset — trigger should fire
    insertAsset(db, 'single-1', '["individual"]', 'individual prompt');

    // Both should be searchable
    expect(ftsSearch(db, 'batch')).toContain('batch-1');
    expect(ftsSearch(db, 'individual')).toContain('single-1');
  });

  it('rolls back entire transaction on batch failure', () => {
    // Pre-populate with one asset
    insertAsset(db, 'pre-existing', '["safe"]', 'safe prompt');

    expect(() => {
      withBatchFts(db, () => {
        insertAsset(db, 'will-rollback-1', '["doomed"]', 'doomed');
        insertAsset(db, 'will-rollback-2', '["doomed"]', 'doomed');
        throw new Error('intentional failure');
      });
    }).toThrow('intentional failure');

    // The pre-existing asset should still be there
    const row = db.prepare('SELECT hash FROM assets WHERE hash = ?').get('pre-existing');
    expect(row).toBeDefined();

    // The failed batch assets should NOT exist
    const rolled = db.prepare('SELECT hash FROM assets WHERE hash = ?').get('will-rollback-1');
    expect(rolled).toBeUndefined();

    // Triggers should still be intact
    expect(triggerExists(db, 'assets_ai')).toBe(true);
    expect(triggerExists(db, 'assets_ad')).toBe(true);
    expect(triggerExists(db, 'assets_au')).toBe(true);

    // FTS should still work for the pre-existing asset
    expect(ftsSearch(db, 'safe')).toContain('pre-existing');
  });

  it('returns the value from the batch function', () => {
    const result = withBatchFts(db, () => {
      insertAsset(db, 'r1', '["x"]', 'y');
      return 42;
    });
    expect(result).toBe(42);
  });

  it('handles empty batch (no inserts) gracefully', () => {
    withBatchFts(db, () => {
      // no-op
    });

    // Triggers should be restored
    expect(triggerExists(db, 'assets_ai')).toBe(true);

    // Individual insert should still work
    insertAsset(db, 'after-empty', '["test"]', 'test prompt');
    expect(ftsSearch(db, 'test')).toContain('after-empty');
  });
});

describe('rebuildFtsIndex', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = openDb();
  });

  afterEach(() => {
    db.close();
  });

  it('rebuilds FTS index to match source data', () => {
    // Insert assets normally (triggers populate FTS)
    insertAsset(db, 'a1', '["alpha"]', 'alpha prompt');
    insertAsset(db, 'a2', '["beta"]', 'beta prompt');

    // Verify FTS works before rebuild
    expect(ftsSearch(db, 'alpha').length).toBe(1);

    // Rebuild should not break anything
    rebuildFtsIndex(db);

    // FTS should still work correctly
    expect(ftsSearch(db, 'alpha')).toContain('a1');
    expect(ftsSearch(db, 'beta')).toContain('a2');
  });

  it('is idempotent — running twice produces same result', () => {
    insertAsset(db, 'a1', '["stable"]', 'stable prompt');

    rebuildFtsIndex(db);
    const first = ftsSearch(db, 'stable');

    rebuildFtsIndex(db);
    const second = ftsSearch(db, 'stable');

    expect(first).toEqual(second);
    expect(first).toContain('a1');
  });

  it('corrects a stale FTS index', () => {
    // Insert an asset via triggers
    insertAsset(db, 'a1', '["visible"]', 'visible prompt');
    expect(ftsSearch(db, 'visible')).toContain('a1');

    // Manually corrupt: drop triggers and insert without FTS
    db.exec('DROP TRIGGER assets_ai');
    insertAsset(db, 'a2', '["invisible"]', 'invisible prompt');

    // a2 is NOT in FTS yet
    expect(ftsSearch(db, 'invisible')).toEqual([]);

    // Rebuild restores correctness
    rebuildFtsIndex(db);
    expect(ftsSearch(db, 'invisible')).toContain('a2');
    expect(ftsSearch(db, 'visible')).toContain('a1');

    // Re-create trigger for cleanup
    db.exec(`
      CREATE TRIGGER assets_ai AFTER INSERT ON assets BEGIN
        INSERT INTO assets_fts(rowid, tags, prompt) VALUES (new.rowid, new.tags, new.prompt);
      END;
    `);
  });
});
