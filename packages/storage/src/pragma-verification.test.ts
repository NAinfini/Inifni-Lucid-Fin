import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { SqliteIndex } from '../src/sqlite-index.ts';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-pragma-'));
}

/** Access the private better-sqlite3 handle for pragma verification. */
function getDbHandle(idx: SqliteIndex): BetterSqlite3.Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (idx as any).db;
}

describe('SQLite pragma verification', () => {
  let idx: SqliteIndex;
  let base: string;

  afterEach(() => {
    idx.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('journal_mode is WAL', () => {
    base = tmpDir();
    idx = new SqliteIndex(path.join(base, 'test.db'));
    const rows = getDbHandle(idx).pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(rows[0].journal_mode).toBe('wal');
  });

  it('synchronous is NORMAL (1)', () => {
    base = tmpDir();
    idx = new SqliteIndex(path.join(base, 'test.db'));
    const rows = getDbHandle(idx).pragma('synchronous') as Array<{ synchronous: number }>;
    expect(rows[0].synchronous).toBe(1);
  });
});
