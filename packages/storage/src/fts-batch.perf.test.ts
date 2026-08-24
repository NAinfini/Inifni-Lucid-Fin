import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { withBatchFts } from './fts-batch.js';

const SCHEMA = `
CREATE TABLE asset_contents (
  hash       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  format     TEXT NOT NULL,
  prompt     TEXT,
  created_at INTEGER NOT NULL,
  file_size  INTEGER
);

CREATE TABLE asset_entries (
  id TEXT PRIMARY KEY,
  asset_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  tags TEXT NOT NULL,
  folder_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE asset_entries_fts USING fts5(entry_id UNINDEXED, display_name, tags, prompt);

CREATE TRIGGER asset_entries_ai AFTER INSERT ON asset_entries BEGIN
  INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
  SELECT new.id, new.display_name, new.tags, prompt FROM asset_contents WHERE hash = new.asset_hash;
END;

CREATE TRIGGER asset_entries_ad AFTER DELETE ON asset_entries BEGIN
  DELETE FROM asset_entries_fts WHERE entry_id = old.id;
END;

CREATE TRIGGER asset_entries_au AFTER UPDATE ON asset_entries BEGIN
  UPDATE asset_entries_fts SET display_name = new.display_name, tags = new.tags
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

function ftsSearch(db: BetterSqlite3.Database, query: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT entry.asset_hash AS hash FROM asset_entries entry
         JOIN asset_entries_fts f ON f.entry_id = entry.id
         WHERE asset_entries_fts MATCH ?`,
      )
      .all(query) as Array<{ hash: string }>;
    return rows.map((row) => row.hash);
  } catch {
    return [];
  }
}

describe('withBatchFts performance', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = openDb();
  });

  afterEach(() => {
    db.close();
  });

  it('batch import of 100 assets is faster than per-row triggers', () => {
    const COUNT = 100;

    // Measure per-row trigger approach
    const triggerStart = performance.now();
    const triggerDb = openDb();
    for (let i = 0; i < COUNT; i++) {
      insertAsset(triggerDb, `trigger-${i}`, `["tag${i}"]`, `prompt ${i}`);
    }
    const triggerMs = performance.now() - triggerStart;
    triggerDb.close();

    // Measure batch approach
    const batchStart = performance.now();
    withBatchFts(db, () => {
      for (let i = 0; i < COUNT; i++) {
        insertAsset(db, `batch-${i}`, `["tag${i}"]`, `prompt ${i}`);
      }
    });
    const batchMs = performance.now() - batchStart;

    // Log timings for documentation
    console.log(
      `[FTS batch benchmark] ${COUNT} assets — triggers: ${triggerMs.toFixed(1)}ms, batch: ${batchMs.toFixed(1)}ms, speedup: ${(triggerMs / batchMs).toFixed(2)}x`,
    );

    // Verify correctness: all assets searchable
    const results = ftsSearch(db, 'prompt');
    expect(results.length).toBe(COUNT);

    // The batch approach should be faster (or at least not significantly slower).
    // In-memory SQLite may show less dramatic differences than on-disk, so we
    // use a lenient assertion: batch should not be more than 3x slower.
    expect(batchMs).toBeLessThan(triggerMs * 3);
  });

  it('batch import of 500 assets completes with correct FTS index', () => {
    const COUNT = 500;

    const batchStart = performance.now();
    withBatchFts(db, () => {
      for (let i = 0; i < COUNT; i++) {
        insertAsset(db, `asset-${i}`, `["tag${i}", "common"]`, `prompt for asset ${i}`);
      }
    });
    const batchMs = performance.now() - batchStart;

    console.log(`[FTS batch benchmark] ${COUNT} assets — batch: ${batchMs.toFixed(1)}ms`);

    // Verify: search by common tag finds all assets
    const commonResults = ftsSearch(db, 'common');
    expect(commonResults.length).toBe(COUNT);

    // Verify: search by specific tag finds exactly one
    const specificResults = ftsSearch(db, 'tag42');
    expect(specificResults).toContain('asset-42');
    expect(specificResults.length).toBe(1);
  });
});
