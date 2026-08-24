import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { withBatchFts, rebuildFtsIndex } from './fts-batch.js';

/**
 * Schema for tests — mirrors canonical content, logical entries, FTS, and triggers.
 */
const SCHEMA = `
CREATE TABLE asset_contents (
  hash        TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  format      TEXT NOT NULL,
  prompt      TEXT,
  provider    TEXT,
  created_at  INTEGER NOT NULL,
  file_size   INTEGER,
  width       INTEGER,
  height      INTEGER,
  duration    REAL,
  generation_metadata TEXT
);

CREATE TABLE asset_entries (
  id TEXT PRIMARY KEY,
  asset_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  folder_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE asset_entries_fts USING fts5(
  entry_id UNINDEXED, display_name, tags, prompt
);

CREATE TRIGGER asset_entries_ai AFTER INSERT ON asset_entries BEGIN
  INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
  SELECT new.id, new.display_name, new.tags, prompt
    FROM asset_contents WHERE hash = new.asset_hash;
END;

CREATE TRIGGER asset_entries_ad AFTER DELETE ON asset_entries BEGIN
  DELETE FROM asset_entries_fts WHERE entry_id = old.id;
END;

CREATE TRIGGER asset_entries_au AFTER UPDATE ON asset_entries BEGIN
  UPDATE asset_entries_fts
     SET display_name = new.display_name,
         tags = new.tags,
         prompt = (SELECT prompt FROM asset_contents WHERE hash = new.asset_hash)
   WHERE entry_id = old.id;
END;

CREATE TRIGGER asset_contents_prompt_au AFTER UPDATE OF prompt ON asset_contents BEGIN
  UPDATE asset_entries_fts SET prompt = new.prompt
   WHERE entry_id IN (SELECT id FROM asset_entries WHERE asset_hash = new.hash);
END;
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function insertAsset(db: BetterSqlite3.Database, hash: string, tags: string, prompt: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO asset_contents (hash, type, format, prompt, created_at, file_size)
     VALUES (?, 'image', 'png', ?, ?, 1024)`,
  ).run(hash, prompt, Date.now());
  db.prepare(
    `INSERT OR REPLACE INTO asset_entries
       (id, asset_hash, display_name, tags, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hash, hash, hash, tags, Date.now());
}

/** Search FTS and return matching asset hashes. */
function ftsSearch(db: BetterSqlite3.Database, query: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT entry.asset_hash AS hash FROM asset_entries entry
         JOIN asset_entries_fts f ON f.entry_id = entry.id
         WHERE asset_entries_fts MATCH ?`,
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
    expect(triggerExists(db, 'asset_entries_ai')).toBe(true);
    expect(triggerExists(db, 'asset_entries_ad')).toBe(true);
    expect(triggerExists(db, 'asset_entries_au')).toBe(true);
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
    const row = db.prepare('SELECT hash FROM asset_contents WHERE hash = ?').get('pre-existing');
    expect(row).toBeDefined();

    // The failed batch assets should NOT exist
    const rolled = db
      .prepare('SELECT hash FROM asset_contents WHERE hash = ?')
      .get('will-rollback-1');
    expect(rolled).toBeUndefined();

    // Triggers should still be intact
    expect(triggerExists(db, 'asset_entries_ai')).toBe(true);
    expect(triggerExists(db, 'asset_entries_ad')).toBe(true);
    expect(triggerExists(db, 'asset_entries_au')).toBe(true);

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
    expect(triggerExists(db, 'asset_entries_ai')).toBe(true);

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
    db.exec('DROP TRIGGER asset_entries_ai');
    insertAsset(db, 'a2', '["invisible"]', 'invisible prompt');

    // a2 is NOT in FTS yet
    expect(ftsSearch(db, 'invisible')).toEqual([]);

    // Rebuild restores correctness
    rebuildFtsIndex(db);
    expect(ftsSearch(db, 'invisible')).toContain('a2');
    expect(ftsSearch(db, 'visible')).toContain('a1');

    // Re-create trigger for cleanup
    db.exec(`
      CREATE TRIGGER asset_entries_ai AFTER INSERT ON asset_entries BEGIN
        INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
        SELECT new.id, new.display_name, new.tags, prompt
          FROM asset_contents WHERE hash = new.asset_hash;
      END;
    `);
  });
});
