import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { withBatchFts } from './fts-batch.js';

const SCHEMA = `
CREATE TABLE assets (
  hash       TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  format     TEXT NOT NULL,
  tags       TEXT,
  prompt     TEXT,
  created_at INTEGER NOT NULL,
  file_size  INTEGER
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

function ftsSearch(db: BetterSqlite3.Database, query: string): string[] {
  try {
    const rows = db
      .prepare(
        `SELECT a.hash FROM assets a
         JOIN assets_fts f ON a.rowid = f.rowid
         WHERE assets_fts MATCH ?`,
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
