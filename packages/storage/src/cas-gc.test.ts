import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type BetterSqlite3 from 'better-sqlite3';
import { collectGarbage } from '../src/cas-gc.js';
import { SCHEMA_SQL } from '../src/schema-sql.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-cas-gc-'));
}

/**
 * Create a fake CAS file at `<assetsRoot>/<type>/<prefix>/<hash>.<ext>`.
 * Also creates a companion `.meta.json`.
 * Returns the absolute path to the asset file.
 */
function createCasFile(
  assetsRoot: string,
  hash: string,
  type: 'image' | 'video' | 'audio' = 'image',
  ext = 'png',
  /** Override the file's mtime (epoch ms). */
  mtimeMs?: number,
): string {
  const prefix = hash.slice(0, 2);
  const dir = path.join(assetsRoot, type, prefix);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${hash}.${ext}`);
  const metaPath = path.join(dir, `${hash}.meta.json`);
  fs.writeFileSync(filePath, `fake-content-${hash}`);
  fs.writeFileSync(metaPath, JSON.stringify({ hash, type, format: ext }));
  if (mtimeMs !== undefined) {
    const mtime = new Date(mtimeMs);
    fs.utimesSync(filePath, mtime, mtime);
    fs.utimesSync(metaPath, mtime, mtime);
  }
  return filePath;
}

/** Generate a valid 64-char hex hash for testing. */
function fakeHash(seed: string): string {
  // Pad or truncate to 64 hex chars
  const base = seed.replace(/[^a-f0-9]/g, '');
  return (base + 'a'.repeat(64)).slice(0, 64);
}

describe('CAS Garbage Collector', () => {
  let base: string;
  let assetsRoot: string;
  let dbPath: string;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    base = tmpDir();
    assetsRoot = path.join(base, 'assets');
    fs.mkdirSync(assetsRoot, { recursive: true });
    dbPath = path.join(base, 'test.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    // Add columns/tables from migrations that aren't in SCHEMA_SQL
    try {
      db.exec('ALTER TABLE characters ADD COLUMN deleted_at TEXT');
    } catch { /* already exists */ }
    try {
      db.exec('ALTER TABLE equipment ADD COLUMN deleted_at TEXT');
    } catch { /* already exists */ }
    try {
      db.exec('ALTER TABLE locations ADD COLUMN deleted_at TEXT');
    } catch { /* already exists */ }
    db.exec(`
      CREATE TABLE IF NOT EXISTS canvas_nodes (
        id         TEXT PRIMARY KEY,
        canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
        type       TEXT NOT NULL,
        position_x REAL NOT NULL DEFAULT 0,
        position_y REAL NOT NULL DEFAULT 0,
        width      REAL,
        height     REAL,
        data_json  TEXT NOT NULL DEFAULT '{}',
        z_index    INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('returns empty result when CAS directory is empty', () => {
    const result = collectGarbage(db, assetsRoot);
    expect(result.orphans).toEqual([]);
    expect(result.totalBytes).toBe(0);
    expect(result.scannedFileCount).toBe(0);
    expect(result.deleted).toBe(false);
    expect(result.sourcesScanned.length).toBeGreaterThan(0);
  });

  it('identifies orphan files not referenced by any source', () => {
    const hashA = fakeHash('aaa');
    const hashB = fakeHash('bbb');
    const hashC = fakeHash('ccc');
    const hashD = fakeHash('ddd');
    const hashE = fakeHash('eee');

    // Insert hashes A, B, C into the assets table (referenced)
    for (const h of [hashA, hashB, hashC]) {
      db.prepare(
        'INSERT INTO assets (hash, type, format, created_at) VALUES (?, ?, ?, ?)',
      ).run(h, 'image', 'png', Date.now());
    }

    // Create CAS files for A, B, C, D, E
    const pastTime = Date.now() - 60_000;
    for (const h of [hashA, hashB, hashC, hashD, hashE]) {
      createCasFile(assetsRoot, h, 'image', 'png', pastTime);
    }

    const result = collectGarbage(db, assetsRoot);

    expect(result.deleted).toBe(false); // dry-run
    expect(result.liveHashCount).toBeGreaterThanOrEqual(3);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).toContain(hashD);
    expect(orphanHashes).toContain(hashE);
    expect(orphanHashes).not.toContain(hashA);
    expect(orphanHashes).not.toContain(hashB);
    expect(orphanHashes).not.toContain(hashC);
  });

  it('dry-run does not delete files', () => {
    const hash = fakeHash('orphan1');
    const pastTime = Date.now() - 60_000;
    const filePath = createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const result = collectGarbage(db, assetsRoot, { dryRun: true });

    expect(result.deleted).toBe(false);
    expect(result.orphans.length).toBe(1);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('actual run deletes orphan files and their meta.json', () => {
    const hash = fakeHash('orphan2');
    const pastTime = Date.now() - 60_000;
    const filePath = createCasFile(assetsRoot, hash, 'image', 'png', pastTime);
    const metaPath = path.join(path.dirname(filePath), `${hash}.meta.json`);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.existsSync(metaPath)).toBe(true);

    const result = collectGarbage(db, assetsRoot, { dryRun: false });

    expect(result.deleted).toBe(true);
    expect(result.orphans.length).toBe(1);
    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(metaPath)).toBe(false);
  });

  it('does not delete referenced assets', () => {
    const hashRef = fakeHash('referenced1');
    const pastTime = Date.now() - 60_000;
    const filePath = createCasFile(assetsRoot, hashRef, 'image', 'png', pastTime);

    db.prepare(
      'INSERT INTO assets (hash, type, format, created_at) VALUES (?, ?, ?, ?)',
    ).run(hashRef, 'image', 'png', Date.now());

    const result = collectGarbage(db, assetsRoot, { dryRun: false });

    expect(result.orphans.length).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('epoch mechanism excludes files written during GC', () => {
    const hash = fakeHash('concurrent1');
    // Create file with future mtime (simulates a file written "during" GC)
    const futureTime = Date.now() + 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', futureTime);

    const result = collectGarbage(db, assetsRoot);

    // The file has no DB reference but its mtime is after the epoch,
    // so it should NOT be listed as an orphan.
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from canvas_nodes.data_json', () => {
    const hash = fakeHash('canvasnode1');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    // Insert a canvas for the FK
    db.prepare(
      'INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c1', 'Test Canvas', '{"x":0,"y":0,"zoom":1}', '[]', Date.now(), Date.now());

    // Insert a canvas node referencing the hash
    db.prepare(
      "INSERT INTO canvas_nodes (id, canvas_id, type, position_x, position_y, data_json, z_index) VALUES (?, ?, ?, 0, 0, ?, 0)",
    ).run('n1', 'c1', 'image', JSON.stringify({ assetHash: hash, status: 'done', variants: [], selectedVariantIndex: 0 }));

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from canvas node variants array', () => {
    const hashMain = fakeHash('mainasset1');
    const hashVariant = fakeHash('variant01');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hashMain, 'image', 'png', pastTime);
    createCasFile(assetsRoot, hashVariant, 'image', 'png', pastTime);

    db.prepare(
      'INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c2', 'Test Canvas 2', '{"x":0,"y":0,"zoom":1}', '[]', Date.now(), Date.now());

    db.prepare(
      "INSERT INTO canvas_nodes (id, canvas_id, type, position_x, position_y, data_json, z_index) VALUES (?, ?, ?, 0, 0, ?, 0)",
    ).run('n2', 'c2', 'image', JSON.stringify({
      assetHash: hashMain,
      status: 'done',
      variants: [hashVariant],
      selectedVariantIndex: 0,
    }));

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hashMain);
    expect(orphanHashes).not.toContain(hashVariant);
  });

  it('collects hashes from character reference_images', () => {
    const hash = fakeHash('charref01');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const now = Date.now();
    db.prepare(
      'INSERT INTO characters (id, name, reference_images, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('ch1', 'Test Char', JSON.stringify([{ slot: 'main', assetHash: hash, isStandard: true }]), now, now);

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from equipment reference_images', () => {
    const hash = fakeHash('equipref1');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const now = Date.now();
    db.prepare(
      "INSERT INTO equipment (id, name, type, reference_images, created_at, updated_at) VALUES (?, ?, 'weapon', ?, ?, ?)",
    ).run('eq1', 'Test Equip', JSON.stringify([{ slot: 'ortho-grid', assetHash: hash, isStandard: true }]), now, now);

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from location reference_images', () => {
    const hash = fakeHash('locref001');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const now = Date.now();
    db.prepare(
      "INSERT INTO locations (id, name, type, reference_images, created_at, updated_at) VALUES (?, ?, 'interior', ?, ?, ?)",
    ).run('loc1', 'Test Loc', JSON.stringify([{ slot: 'bible', assetHash: hash, isStandard: true }]), now, now);

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from workflow_artifacts.asset_hash', () => {
    const hash = fakeHash('wfartif01');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const now = Date.now();
    // Need to insert prerequisite workflow run + stage run + task run
    db.prepare(
      "INSERT INTO workflow_runs (id, workflow_type, entity_type, trigger_source, status, created_at, updated_at) VALUES (?, 'gen', 'image', 'manual', 'completed', ?, ?)",
    ).run('wr1', now, now);
    db.prepare(
      "INSERT INTO workflow_stage_runs (id, workflow_run_id, stage_id, name, status, stage_order, updated_at) VALUES (?, 'wr1', 's1', 'stage1', 'completed', 0, ?)",
    ).run('wsr1', now);
    db.prepare(
      "INSERT INTO workflow_task_runs (id, workflow_run_id, stage_run_id, task_id, name, kind, status, updated_at) VALUES (?, 'wr1', 'wsr1', 't1', 'task1', 'generate', 'completed', ?)",
    ).run('wtr1', now);
    db.prepare(
      "INSERT INTO workflow_artifacts (id, workflow_run_id, task_run_id, artifact_type, asset_hash, created_at) VALUES (?, 'wr1', 'wtr1', 'image', ?, ?)",
    ).run('wa1', hash, now);

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from color_styles.source_asset', () => {
    const hash = fakeHash('colorst01');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const now = Date.now();
    db.prepare(
      'INSERT INTO color_styles (id, name, source_type, source_asset, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('cs1', 'Style1', 'extracted', hash, now, now);

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from asset_embeddings', () => {
    const hash = fakeHash('embed0001');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    db.prepare(
      'INSERT INTO asset_embeddings (hash, description, tokens, model, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(hash, 'test desc', '["a","b"]', 'test-model', Date.now());

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hash);
  });

  it('collects hashes from generationHistory nested in canvas node data', () => {
    const hashCurrent = fakeHash('genhist01');
    const hashHistory = fakeHash('genhist02');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hashCurrent, 'image', 'png', pastTime);
    createCasFile(assetsRoot, hashHistory, 'image', 'png', pastTime);

    db.prepare(
      'INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c3', 'Canvas 3', '{"x":0,"y":0,"zoom":1}', '[]', Date.now(), Date.now());

    db.prepare(
      "INSERT INTO canvas_nodes (id, canvas_id, type, position_x, position_y, data_json, z_index) VALUES (?, ?, ?, 0, 0, ?, 0)",
    ).run('n3', 'c3', 'image', JSON.stringify({
      assetHash: hashCurrent,
      status: 'done',
      variants: [],
      selectedVariantIndex: 0,
      generationHistory: [
        { assetHash: hashHistory, prompt: 'test', providerId: 'p1', createdAt: Date.now() },
      ],
    }));

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hashCurrent);
    expect(orphanHashes).not.toContain(hashHistory);
  });

  it('collects sourceImageHash from canvas node data', () => {
    const hashSource = fakeHash('srcimg001');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hashSource, 'image', 'png', pastTime);

    db.prepare(
      'INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('c4', 'Canvas 4', '{"x":0,"y":0,"zoom":1}', '[]', Date.now(), Date.now());

    db.prepare(
      "INSERT INTO canvas_nodes (id, canvas_id, type, position_x, position_y, data_json, z_index) VALUES (?, ?, ?, 0, 0, ?, 0)",
    ).run('n4', 'c4', 'image', JSON.stringify({
      sourceImageHash: hashSource,
      status: 'done',
      variants: [],
      selectedVariantIndex: 0,
    }));

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    expect(orphanHashes).not.toContain(hashSource);
  });

  it('reports summary stats correctly', () => {
    const hashLive = fakeHash('livestat1');
    const hashOrphan1 = fakeHash('orphstat1');
    const hashOrphan2 = fakeHash('orphstat2');
    const pastTime = Date.now() - 60_000;

    createCasFile(assetsRoot, hashLive, 'image', 'png', pastTime);
    createCasFile(assetsRoot, hashOrphan1, 'image', 'png', pastTime);
    createCasFile(assetsRoot, hashOrphan2, 'video', 'mp4', pastTime);

    db.prepare(
      'INSERT INTO assets (hash, type, format, created_at) VALUES (?, ?, ?, ?)',
    ).run(hashLive, 'image', 'png', Date.now());

    const result = collectGarbage(db, assetsRoot);

    expect(result.scannedFileCount).toBe(3);
    expect(result.liveHashCount).toBeGreaterThanOrEqual(1);
    expect(result.orphans.length).toBe(2);
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.sourcesScanned).toContain('assets.hash');
    expect(result.sourcesScanned).toContain('canvas_nodes.data_json');
  });

  it('handles non-existent assets root gracefully', () => {
    const result = collectGarbage(db, path.join(base, 'nonexistent'));
    expect(result.orphans).toEqual([]);
    expect(result.scannedFileCount).toBe(0);
  });

  it('ignores soft-deleted characters', () => {
    const hash = fakeHash('softdel01');
    const pastTime = Date.now() - 60_000;
    createCasFile(assetsRoot, hash, 'image', 'png', pastTime);

    const now = Date.now();
    db.prepare(
      "INSERT INTO characters (id, name, reference_images, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    ).run('ch2', 'Deleted Char', JSON.stringify([{ slot: 'main', assetHash: hash, isStandard: true }]), now, now);

    const result = collectGarbage(db, assetsRoot);
    const orphanHashes = result.orphans.map((o) => o.hash);
    // Soft-deleted entities are excluded from reference scan,
    // so the hash should be an orphan (unless referenced elsewhere)
    expect(orphanHashes).toContain(hash);
  });
});
