import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SqliteIndex } from './sqlite-index.js';

function tmpDb() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-snap-'));
  const db = new SqliteIndex(path.join(base, 'test.db'));
  return { db, cleanup: () => { db.close(); fs.rmSync(base, { recursive: true, force: true }); } };
}

const SESSION = {
  id: 'sess-1',
  canvasId: 'canvas-1',
  title: 'Test session',
  messages: '[]',
  createdAt: 1000,
  updatedAt: 1000,
};

const SNAP_DATA = {
  canvases: [],
  characters: [{ id: 'c1', name: 'Alice' }],
  equipment: [],
  locations: [],
  scripts: [],
  presetOverrides: [],
};

describe('sqlite-snapshots', () => {
  let db: SqliteIndex;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = tmpDb());
  });

  afterEach(() => cleanup());

  // --- Sessions ---

  it('upsertSession creates a new session', () => {
    db.upsertSession(SESSION);
    const rows = db.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sess-1');
    expect(rows[0].title).toBe('Test session');
  });

  it('upsertSession updates an existing session', () => {
    db.upsertSession(SESSION);
    db.upsertSession({ ...SESSION, title: 'Updated', updatedAt: 2000 });
    const rows = db.listSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Updated');
  });

  it('getSession returns undefined for unknown id', () => {
    expect(db.getSession('nope')).toBeUndefined();
  });

  it('getSession returns the session by id', () => {
    db.upsertSession(SESSION);
    const s = db.getSession('sess-1');
    expect(s).toBeDefined();
    expect(s!.canvasId).toBe('canvas-1');
  });

  it('deleteSession removes the session', () => {
    db.upsertSession(SESSION);
    db.deleteSession('sess-1');
    expect(db.listSessions()).toHaveLength(0);
  });

  it('listSessions returns newest first', () => {
    db.upsertSession({ ...SESSION, id: 'a', updatedAt: 1000 });
    db.upsertSession({ ...SESSION, id: 'b', updatedAt: 2000 });
    const rows = db.listSessions();
    expect(rows[0].id).toBe('b');
    expect(rows[1].id).toBe('a');
  });

  it('listSessions respects limit', () => {
    for (let i = 0; i < 10; i++) {
      db.upsertSession({ ...SESSION, id: `s${i}`, updatedAt: i });
    }
    expect(db.listSessions(5)).toHaveLength(5);
  });

  // --- Snapshots ---

  it('insertSnapshot creates a snapshot', () => {
    db.upsertSession(SESSION);
    db.insertSnapshot({
      id: 'snap-1',
      sessionId: 'sess-1',
      label: 'Before edit',
      trigger: 'auto',
      data: JSON.stringify(SNAP_DATA),
      createdAt: 1000,
    });
    const snaps = db.listSnapshots('sess-1');
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe('snap-1');
    expect(snaps[0].label).toBe('Before edit');
  });

  it('listSnapshots returns newest first', () => {
    db.upsertSession(SESSION);
    db.insertSnapshot({ id: 'a', sessionId: 'sess-1', label: 'a', trigger: 'auto', data: '{}', createdAt: 1000 });
    db.insertSnapshot({ id: 'b', sessionId: 'sess-1', label: 'b', trigger: 'auto', data: '{}', createdAt: 2000 });
    const snaps = db.listSnapshots('sess-1');
    expect(snaps[0].id).toBe('b');
  });

  it('deleteSnapshot removes the snapshot', () => {
    db.upsertSession(SESSION);
    db.insertSnapshot({ id: 'snap-1', sessionId: 'sess-1', label: '', trigger: 'auto', data: '{}', createdAt: 1000 });
    db.deleteSnapshot('snap-1');
    expect(db.listSnapshots('sess-1')).toHaveLength(0);
  });

  it('getSnapshot returns undefined for unknown id', () => {
    expect(db.getSnapshot('nope')).toBeUndefined();
  });

  it('getSnapshot returns snapshot data', () => {
    db.upsertSession(SESSION);
    db.insertSnapshot({ id: 'snap-1', sessionId: 'sess-1', label: '', trigger: 'auto', data: JSON.stringify(SNAP_DATA), createdAt: 1000 });
    const snap = db.getSnapshot('snap-1');
    expect(snap).toBeDefined();
    expect(JSON.parse(snap!.data).characters[0].name).toBe('Alice');
  });

  it('pruneSnapshots keeps only N newest auto snapshots per session (manual untouched)', () => {
    db.upsertSession(SESSION);
    for (let i = 0; i < 7; i++) {
      db.insertSnapshot({ id: `s${i}`, sessionId: 'sess-1', label: '', trigger: 'auto', data: '{}', createdAt: i });
    }
    db.insertSnapshot({ id: 'manual-1', sessionId: 'sess-1', label: 'user save', trigger: 'manual', data: '{}', createdAt: 100 });
    db.pruneSnapshots('sess-1', 5);
    const snaps = db.listSnapshots('sess-1');
    // 5 auto kept + 1 manual = 6
    expect(snaps).toHaveLength(6);
    expect(snaps.some(s => s.id === 'manual-1')).toBe(true);
  });

  it('pruneSnapshotsTiered deletes auto snapshots older than 30 days', () => {
    const now = Date.now();
    const DAY = 86_400_000;
    db.upsertSession(SESSION);
    // 35 days old — should be deleted
    db.insertSnapshot({ id: 'old', sessionId: 'sess-1', label: '', trigger: 'auto', data: '{}', createdAt: now - 35 * DAY });
    // 2 days old — should be kept
    db.insertSnapshot({ id: 'recent', sessionId: 'sess-1', label: '', trigger: 'auto', data: '{}', createdAt: now - 2 * DAY });
    db.pruneSnapshotsTiered();
    const snaps = db.listSnapshots('sess-1');
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe('recent');
  });

  it('pruneSnapshotsTiered never deletes manual snapshots', () => {
    const now = Date.now();
    const DAY = 86_400_000;
    db.upsertSession(SESSION);
    // 60 days old manual — should survive
    db.insertSnapshot({ id: 'manual-old', sessionId: 'sess-1', label: 'user save', trigger: 'manual', data: '{}', createdAt: now - 60 * DAY });
    db.pruneSnapshotsTiered();
    const snaps = db.listSnapshots('sess-1');
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe('manual-old');
  });

  it('pruneSnapshotsTiered thins 1-7 day range to 1 per 3-hour window', () => {
    const now = Date.now();
    const HOUR = 3_600_000;
    const DAY = 24 * HOUR;
    db.upsertSession(SESSION);
    // Create 6 auto snapshots within the same 3-hour window (2 days ago)
    const baseTime = now - 2 * DAY;
    for (let i = 0; i < 6; i++) {
      db.insertSnapshot({ id: `h${i}`, sessionId: 'sess-1', label: '', trigger: 'auto', data: '{}', createdAt: baseTime + i * 1000 });
    }
    db.pruneSnapshotsTiered();
    const snaps = db.listSnapshots('sess-1');
    // Only 1 should survive (the newest in that 3-hour window)
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe('h5');
  });

  it('pruneSnapshotsTiered keeps max 20 in last 24 hours', () => {
    const now = Date.now();
    db.upsertSession(SESSION);
    for (let i = 0; i < 25; i++) {
      db.insertSnapshot({ id: `r${i}`, sessionId: 'sess-1', label: '', trigger: 'auto', data: '{}', createdAt: now - i * 60_000 });
    }
    db.pruneSnapshotsTiered();
    const snaps = db.listSnapshots('sess-1');
    expect(snaps).toHaveLength(20);
  });

  it('captureSnapshot serialises all mutable tables', () => {
    // Pre-populate some data
    db.upsertCharacter({ id: 'c1', name: 'Hero' });
    db.upsertSession(SESSION);

    const snap = db.captureSnapshot('sess-1', 'test', 'manual');
    const parsed = JSON.parse(snap.data) as { characters: Array<{ name: string }> };
    expect(parsed.characters.some(c => c.name === 'Hero')).toBe(true);
  });

  it('restoreSnapshot replaces entity table data', () => {
    db.upsertCharacter({ id: 'c1', name: 'Before' });
    db.upsertSession(SESSION);
    const snap = db.captureSnapshot('sess-1', 'checkpoint', 'manual');

    // Mutate after snapshot
    db.upsertCharacter({ id: 'c2', name: 'After' });
    expect(db.listCharacters()).toHaveLength(2);

    db.restoreSnapshot(snap.id);

    const chars = db.listCharacters();
    expect(chars).toHaveLength(1);
    expect(chars[0].name).toBe('Before');
  });
});
