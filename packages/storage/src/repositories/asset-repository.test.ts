import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { AssetHash } from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { AssetRepository } from './asset-repository.js';

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

CREATE VIRTUAL TABLE assets_fts USING fts5(hash, prompt, content='');

CREATE TABLE asset_embeddings (
  hash        TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  tokens      TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

describe('AssetRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: AssetRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new AssetRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('insert round-trips an asset with tags + timestamps', () => {
    repo.insert({
      hash: 'h1',
      type: 'image',
      format: 'png',
      tags: ['hero', 'shot'],
      fileSize: 1024,
      createdAt: 100,
    });
    const { rows } = repo.query({});
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      hash: 'h1',
      type: 'image',
      format: 'png',
      fileSize: 1024,
      tags: ['hero', 'shot'],
      createdAt: 100,
    });
  });

  it('query filters by type', () => {
    repo.insert({ hash: 'a', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    repo.insert({ hash: 'b', type: 'video', format: 'mp4', fileSize: 1, createdAt: 2 });
    repo.insert({ hash: 'c', type: 'image', format: 'jpg', fileSize: 1, createdAt: 3 });
    const { rows } = repo.query({ type: 'image' });
    expect(rows.map((r) => r.hash).sort()).toEqual(['a', 'c']);
  });

  it('query orders by createdAt DESC', () => {
    repo.insert({ hash: 'first', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    repo.insert({ hash: 'middle', type: 'image', format: 'png', fileSize: 1, createdAt: 5 });
    repo.insert({ hash: 'newest', type: 'image', format: 'png', fileSize: 1, createdAt: 9 });
    const { rows } = repo.query({});
    expect(rows.map((r) => r.hash)).toEqual(['newest', 'middle', 'first']);
  });

  it('query honors limit + offset', () => {
    for (let i = 0; i < 5; i += 1) {
      repo.insert({ hash: `h${i}`, type: 'image', format: 'png', fileSize: 1, createdAt: i });
    }
    const { rows } = repo.query({ limit: 2, offset: 1 });
    expect(rows.length).toBe(2);
  });

  it('delete removes the row', () => {
    repo.insert({ hash: 'h1', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    repo.delete('h1' as AssetHash);
    expect(repo.query({}).rows.length).toBe(0);
  });

  it('fault injection: query skips malformed row + reports degrade', () => {
    repo.insert({ hash: 'good', type: 'image', format: 'png', fileSize: 1, createdAt: 1 });
    // Inject a row with an invalid `type` — zod enum rejects.
    db.prepare(
      `INSERT INTO assets (hash, type, format, created_at, file_size, tags)
       VALUES (?, 'garbage', 'png', 2, 1, '[]')`,
    ).run('bad');
    const { rows, degradedCount } = repo.query({});
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.hash)).toEqual(['good']);
    expect(reports.length).toBe(1);
    expect(reports[0].schema).toBe('AssetMeta');
  });

  it('query tolerates legacy empty-string tags (pre-DEFAULT-[] migration)', () => {
    // Legacy rows written before the `tags DEFAULT '[]'` migration can
    // carry `tags = ''`. `JSON.parse('')` throws, so the repo must
    // normalize before parsing — otherwise query hard-fails.
    db.prepare(
      `INSERT INTO assets (hash, type, format, created_at, file_size, tags)
       VALUES (?, 'image', 'png', 1, 1, '')`,
    ).run('legacy');
    const { rows, degradedCount } = repo.query({});
    expect(degradedCount).toBe(0);
    expect(rows[0].hash).toBe('legacy');
    expect(rows[0].tags).toEqual([]);
  });

  it('insertEmbedding + queryEmbeddingByHash round-trip tokens array', () => {
    repo.insertEmbedding('h1' as AssetHash, 'desc', ['a', 'b', 'c'], 'model-x');
    const got = repo.queryEmbeddingByHash('h1' as AssetHash);
    expect(got).toBeDefined();
    expect(got!.tokens).toEqual(['a', 'b', 'c']);
    expect(got!.model).toBe('model-x');
    expect(got!.description).toBe('desc');
  });

  it('queryEmbeddingByHash returns undefined for missing hash', () => {
    expect(repo.queryEmbeddingByHash('missing' as AssetHash)).toBeUndefined();
  });

  it('searchByTokens returns jaccard-sorted results; 0 when no overlap', () => {
    repo.insertEmbedding('full', 'full match', ['x', 'y', 'z'], 'm');
    repo.insertEmbedding('partial', 'partial match', ['x', 'y'], 'm');
    repo.insertEmbedding('none', 'no match', ['p', 'q'], 'm');
    const results = repo.searchByTokens(['x', 'y', 'z'], 10);
    expect(results.length).toBe(2);
    expect(results[0].hash).toBe('full');
    expect(results[1].hash).toBe('partial');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('searchByTokens returns empty for empty query', () => {
    repo.insertEmbedding('h1' as AssetHash, 'desc', ['x'], 'm');
    expect(repo.searchByTokens([], 10)).toEqual([]);
  });

  it('getAllEmbeddedHashes lists inserted hashes', () => {
    repo.insertEmbedding('h1' as AssetHash, 'd', ['a'], 'm');
    repo.insertEmbedding('h2' as AssetHash, 'd', ['b'], 'm');
    const hashes = repo.getAllEmbeddedHashes();
    expect(hashes.sort()).toEqual(['h1', 'h2']);
  });

  it('methods accept a Tx argument', () => {
    const tx = db.transaction(() => {
      repo.insert({ hash: 'tx', type: 'image', format: 'png', fileSize: 1, createdAt: 1 }, db);
    });
    tx();
    expect(repo.query({}).rows.map((r) => r.hash)).toEqual(['tx']);
  });
});
