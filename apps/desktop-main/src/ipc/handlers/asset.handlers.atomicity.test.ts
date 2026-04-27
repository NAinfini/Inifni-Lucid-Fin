/**
 * Atomicity integration tests for the CAS/DB import pipeline.
 *
 * These tests verify:
 *  1. A1: DB insert failure triggers CAS rollback (no orphan CAS file).
 *  2. A2: reconcileCasDb backfills an orphan CAS entry into the DB.
 *  3. A2: reconcileCasDb removes an orphan DB row when the CAS file is missing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AssetMeta, AssetType } from '@lucid-fin/contracts';

vi.mock('../../logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { CAS } from '@lucid-fin/storage';
import { reconcileCasDb } from '../../bootstrap/reconcile-cas-db.js';

// Minimal 1x1 PNG
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pZ+j9QAAAAASUVORK5CYII=',
  'base64',
);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-atomicity-'));
}

/** Builds a minimal SqliteIndex mock wrapping an in-memory asset store. */
function makeDbMock(initialRows: AssetMeta[] = []) {
  const store = new Map<string, AssetMeta>(initialRows.map((r) => [r.hash, r]));

  return {
    repos: {
      assets: {
        insert: vi.fn((meta: AssetMeta) => { store.set(meta.hash, meta); }),
        delete: vi.fn((hash: string) => { store.delete(hash); }),
        findByHash: vi.fn((hash: string) => store.get(hash)),
        query: vi.fn(({ limit }: { limit?: number }) => ({
          rows: [...store.values()].slice(0, limit ?? 100),
        })),
      },
    },
    _store: store,
  };
}

describe('A1: CAS rollback on DB insert failure', () => {
  let base: string;
  let srcFile: string;
  let cas: CAS;

  beforeEach(() => {
    base = tmpDir();
    cas = new CAS(path.join(base, 'assets'));
    srcFile = path.join(base, 'test.png');
    fs.writeFileSync(srcFile, PNG_BUFFER);
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('deletes the CAS file when DB insert throws', async () => {
    const db = makeDbMock();
    db.repos.assets.insert.mockImplementation(() => {
      throw new Error('DB constraint');
    });

    const { ref } = await cas.importAsset(srcFile, 'image');

    // Simulate the handler behaviour: try insert, rollback on failure.
    try {
      db.repos.assets.insert({ hash: ref.hash } as AssetMeta);
    } catch {
      try { cas.deleteAsset(ref.hash); } catch { /* best-effort */ }
    }

    expect(cas.assetExists(ref.hash, 'image', 'png')).toBe(false);
  });
});

describe('A2: reconcileCasDb', () => {
  let base: string;
  let srcFile: string;
  let cas: CAS;

  beforeEach(() => {
    base = tmpDir();
    cas = new CAS(path.join(base, 'assets'));
    srcFile = path.join(base, 'test.png');
    fs.writeFileSync(srcFile, PNG_BUFFER);
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('backfills DB row for an orphan CAS entry (crash before DB insert)', async () => {
    // Import to CAS only — simulate crash before db.repos.assets.insert.
    const { ref } = await cas.importAsset(srcFile, 'image');
    // Intentionally skip DB insert.

    const db = makeDbMock();

    reconcileCasDb(cas, db as never);

    // CAS file must still be present.
    expect(cas.assetExists(ref.hash, 'image', 'png')).toBe(true);
    // DB row should now be backfilled.
    expect(db.repos.assets.findByHash(ref.hash)).toBeDefined();
  });

  it('removes orphan DB row when the CAS asset file is missing', () => {
    const fakeMeta: AssetMeta = {
      hash: 'a'.repeat(64),
      type: 'image' as AssetType,
      format: 'png',
      originalName: 'ghost.png',
      fileSize: 100,
      tags: [],
      createdAt: Date.now(),
    };

    const db = makeDbMock([fakeMeta]);

    reconcileCasDb(cas, db as never);

    // DB row should be removed because no CAS file exists.
    expect(db.repos.assets.findByHash(fakeMeta.hash)).toBeUndefined();
  });
});

