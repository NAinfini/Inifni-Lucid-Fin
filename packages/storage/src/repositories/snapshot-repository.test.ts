import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { SessionId, SnapshotId } from '@lucid-fin/contracts';
import {
  setDegradeReporter,
  type DegradeReporter,
} from '@lucid-fin/contracts-parse';
import { SnapshotRepository } from './snapshot-repository.js';
import type { StoredSnapshot } from './snapshot-repository.js';

const SCHEMA = `
CREATE TABLE commander_sessions (
  id TEXT PRIMARY KEY,
  canvas_id TEXT,
  title TEXT NOT NULL,
  messages TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  label TEXT NOT NULL,
  trigger TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES commander_sessions(id) ON DELETE CASCADE
);
CREATE TABLE canvases (
  id TEXT PRIMARY KEY, name TEXT, nodes TEXT, edges TEXT, viewport TEXT, notes TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE characters (
  id TEXT PRIMARY KEY, name TEXT, role TEXT, description TEXT, appearance TEXT, personality TEXT,
  ref_image TEXT, costumes TEXT, tags TEXT, age INTEGER, gender TEXT, voice TEXT,
  reference_images TEXT, loadouts TEXT, default_loadout_id TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE equipment (
  id TEXT PRIMARY KEY, name TEXT, type TEXT, subtype TEXT, description TEXT, function_desc TEXT,
  tags TEXT, reference_images TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE locations (
  id TEXT PRIMARY KEY, name TEXT, type TEXT, sub_location TEXT, description TEXT,
  time_of_day TEXT, mood TEXT, weather TEXT, lighting TEXT, tags TEXT, reference_images TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE scripts (
  id TEXT PRIMARY KEY, content TEXT, format TEXT, parsed_scenes TEXT,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE preset_overrides (
  id TEXT PRIMARY KEY, preset_id TEXT, category TEXT, name TEXT, description TEXT, prompt TEXT,
  params TEXT, defaults TEXT, is_user INTEGER, created_at INTEGER, updated_at INTEGER
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  db.prepare(
    `INSERT INTO commander_sessions (id, canvas_id, title, messages, created_at, updated_at)
     VALUES (?, null, '', '[]', 1, 1)`,
  ).run('sess-1');
  return db;
}

function mkSnap(id: string, overrides: Partial<StoredSnapshot> = {}): StoredSnapshot {
  return {
    id,
    sessionId: 'sess-1',
    label: `snap ${id}`,
    trigger: 'manual',
    data: '{}',
    createdAt: 100,
    ...overrides,
  };
}

describe('SnapshotRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: SnapshotRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new SnapshotRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('insert + get round-trips scalar fields', () => {
    repo.insert(mkSnap('s1', { trigger: 'auto', label: 'l1', data: '{"x":1}' }));
    const got = repo.get('s1' as SnapshotId)!;
    expect(got.trigger).toBe('auto');
    expect(got.label).toBe('l1');
    expect(got.data).toBe('{"x":1}');
  });

  it('insert is idempotent (INSERT OR IGNORE)', () => {
    repo.insert(mkSnap('s1', { label: 'first' }));
    repo.insert(mkSnap('s1', { label: 'second' }));
    expect(repo.get('s1' as SnapshotId)!.label).toBe('first');
  });

  it('list orders by created_at DESC', () => {
    repo.insert(mkSnap('old', { createdAt: 1 }));
    repo.insert(mkSnap('newest', { createdAt: 9 }));
    repo.insert(mkSnap('mid', { createdAt: 5 }));
    const { rows, degradedCount } = repo.list('sess-1' as SessionId);
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['newest', 'mid', 'old']);
  });

  it('delete removes the row', () => {
    repo.insert(mkSnap('s1'));
    repo.delete('s1' as SnapshotId);
    expect(repo.get('s1' as SnapshotId)).toBeUndefined();
  });

  it('prune keeps N newest auto snapshots; manual untouched', () => {
    for (let i = 1; i <= 5; i++) {
      repo.insert(mkSnap(`a${i}`, { trigger: 'auto', createdAt: i }));
    }
    repo.insert(mkSnap('manual-old', { trigger: 'manual', createdAt: 0 }));
    repo.prune('sess-1' as SessionId, 2);
    const ids = repo.list('sess-1' as SessionId).rows.map((r) => r.id).sort();
    expect(ids).toEqual(['a4', 'a5', 'manual-old'].sort());
  });

  it('capture inserts a snapshot row and auto-stubs the session FK', () => {
    const snap = repo.capture('new-session' as SessionId, 'cap-label', 'auto');
    expect(snap.sessionId).toBe('new-session');
    expect(snap.trigger).toBe('auto');
    const got = repo.get(snap.id as SnapshotId);
    expect(got?.label).toBe('cap-label');
    const session = db
      .prepare('SELECT id FROM commander_sessions WHERE id = ?')
      .get('new-session') as { id: string } | undefined;
    expect(session?.id).toBe('new-session');
  });

  it('capture + restore round-trips canvas rows', () => {
    db.prepare(`INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES ('c1', 'Test', '[]', '[]', '{}', '[]', 1, 1)`).run();
    const snap = repo.capture('sess-1' as SessionId, 'label', 'manual');
    db.prepare(`DELETE FROM canvases`).run();
    repo.restore(snap.id as SnapshotId);
    const canvas = db.prepare('SELECT id FROM canvases').get() as { id: string } | undefined;
    expect(canvas?.id).toBe('c1');
  });

  it('restore throws on unknown snapshot id', () => {
    expect(() => repo.restore('nope' as SnapshotId)).toThrowError(/Snapshot not found/);
  });

  it('fault injection: invalid trigger enum reports degrade + skips', () => {
    repo.insert(mkSnap('good'));
    db.prepare(
      `INSERT INTO snapshots (id, session_id, label, trigger, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('bad', 'sess-1', 'Bad', 'unknown-trigger', '{}', 1);
    const { rows, degradedCount } = repo.list('sess-1' as SessionId);
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Snapshot')).toBe(true);
  });

  it('accepts Tx argument on insert + delete', () => {
    const tx = db.transaction(() => {
      repo.insert(mkSnap('tx'), db);
    });
    tx();
    expect(repo.get('tx' as SnapshotId)?.label).toBe('snap tx');
    const txDel = db.transaction(() => {
      repo.delete('tx' as SnapshotId, db);
    });
    txDel();
    expect(repo.get('tx' as SnapshotId)).toBeUndefined();
  });
});
