import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import type { CommanderContextCache, SessionId } from '@lucid-fin/contracts';
import { SessionRepository, type StoredSession } from './session-repository.js';

const SCHEMA = `
CREATE TABLE commander_sessions (
  id          TEXT PRIMARY KEY,
  default_canvas_id TEXT,
  title       TEXT NOT NULL DEFAULT '',
  messages    TEXT NOT NULL DEFAULT '[]',
  context_graph_json TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE commander_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES commander_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL
);
CREATE TABLE task_lists (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function mkSession(id: string, overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: id as SessionId,
    defaultCanvasId: null,
    title: '',
    messages: '[]',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function insertTaskList(
  db: BetterSqlite3.Database,
  id: string,
  sessionId: string,
  status: string,
): void {
  db.prepare(`INSERT INTO task_lists (id, status, metadata_json) VALUES (?, ?, ?)`).run(
    id,
    status,
    JSON.stringify({ commanderSessionId: sessionId }),
  );
}

describe('SessionRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: SessionRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new SessionRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('upsert inserts a new row', () => {
    repo.upsert(mkSession('s1', { title: 'first', createdAt: 10, updatedAt: 10 }));
    const got = repo.get('s1' as SessionId);
    expect(got).toBeDefined();
    expect(got!.title).toBe('first');
    expect(got!.createdAt).toBe(10);
  });

  it('upsert updates an existing row (createdAt preserved, updatedAt advances)', () => {
    repo.upsert(mkSession('s1', { title: 'v1', createdAt: 10, updatedAt: 10 }));
    repo.upsert(mkSession('s1', { title: 'v2', createdAt: 999, updatedAt: 20 }));
    const got = repo.get('s1' as SessionId)!;
    expect(got.title).toBe('v2');
    // ON CONFLICT DO UPDATE does not touch created_at
    expect(got.createdAt).toBe(10);
    expect(got.updatedAt).toBe(20);
  });

  it('get returns undefined when id not present', () => {
    expect(repo.get('missing' as SessionId)).toBeUndefined();
  });

  it('list returns rows ordered by updatedAt DESC', () => {
    repo.upsert(mkSession('old', { updatedAt: 1 }));
    repo.upsert(mkSession('middle', { updatedAt: 5 }));
    repo.upsert(mkSession('newest', { updatedAt: 9 }));
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['newest', 'middle', 'old']);
  });

  it('list honors the limit argument', () => {
    for (let i = 0; i < 5; i += 1) {
      repo.upsert(mkSession(`s${i}`, { updatedAt: i }));
    }
    const { rows } = repo.list(2);
    expect(rows.length).toBe(2);
  });

  it('listSummaries derives messageCount without returning message payloads', () => {
    repo.upsert(mkSession('s1', { messages: '[{"role":"user"},{"role":"assistant"}]' }));
    const { rows, degradedCount } = repo.listSummaries();
    expect(degradedCount).toBe(0);
    expect(rows).toEqual([expect.objectContaining({ id: 's1', messageCount: 2 })]);
    expect(rows[0]).not.toHaveProperty('messages');
  });

  it('delete removes the row', () => {
    repo.upsert(mkSession('s1'));
    repo.delete('s1' as SessionId);
    expect(repo.get('s1' as SessionId)).toBeUndefined();
  });

  it('rejects deleting an active session and deletes it after the run is terminal', () => {
    repo.upsert(mkSession('s1'));
    db.prepare(
      `INSERT INTO commander_runs (id, session_id, status) VALUES ('run-1', 's1', 'running')`,
    ).run();
    expect(() => repo.delete('s1' as SessionId)).toThrow('has an active run');
    expect(repo.get('s1' as SessionId)).toBeDefined();
    expect(repo.deleteTerminal('s1' as SessionId)).toBe(false);

    db.prepare(`UPDATE commander_runs SET status = 'completed' WHERE id = 'run-1'`).run();
    expect(repo.deleteTerminal('s1' as SessionId)).toBe(true);
    expect(repo.get('s1' as SessionId)).toBeUndefined();
  });

  it('guards move, delete, and ownership-changing upsert while a Task List is unfinished', () => {
    repo.upsert(mkSession('s1', { defaultCanvasId: 'canvas-a', title: 'before' }));
    insertTaskList(db, 'task-list-1', 's1', 'running');

    expect(() => repo.move('s1' as SessionId, 'canvas-b')).toThrow('unfinished Task List');
    expect(() => repo.delete('s1' as SessionId)).toThrow('unfinished Task List');
    expect(() =>
      repo.upsert(mkSession('s1', { defaultCanvasId: 'canvas-b', title: 'must-not-persist' })),
    ).toThrow('unfinished Task List');
    expect(repo.get('s1' as SessionId)).toMatchObject({
      defaultCanvasId: 'canvas-a',
      title: 'before',
    });

    repo.upsert(
      mkSession('s1', {
        defaultCanvasId: 'canvas-a',
        title: 'message-sync-still-allowed',
        messages: '[{"role":"user"}]',
      }),
    );
    expect(repo.get('s1' as SessionId)).toMatchObject({
      defaultCanvasId: 'canvas-a',
      title: 'message-sync-still-allowed',
    });

    db.prepare(`UPDATE task_lists SET status = 'completed' WHERE id = 'task-list-1'`).run();
    repo.move('s1' as SessionId, 'canvas-b');
    expect(repo.get('s1' as SessionId)?.defaultCanvasId).toBe('canvas-b');
    repo.delete('s1' as SessionId);
    expect(repo.get('s1' as SessionId)).toBeUndefined();
  });

  it('rejects moving an active session without partially changing its Canvas', () => {
    repo.upsert(mkSession('s1', { defaultCanvasId: 'canvas-a' }));
    db.prepare(
      `INSERT INTO commander_runs (id, session_id, status) VALUES ('run-1', 's1', 'accepted')`,
    ).run();
    expect(() => repo.move('s1' as SessionId, 'canvas-b')).toThrow('has an active run');
    expect(repo.get('s1' as SessionId)?.defaultCanvasId).toBe('canvas-a');
  });

  it('fault injection: list skips malformed row + increments degradedCount + reports', () => {
    repo.upsert(mkSession('good', { updatedAt: 20 }));
    // Inject a corrupt row (non-numeric created_at) bypassing the repository.
    db.prepare(
      `INSERT INTO commander_sessions (id, default_canvas_id, title, messages, created_at, updated_at)
       VALUES (?, NULL, '', '[]', ?, ?)`,
    ).run('bad', 'not-a-number' as unknown as number, 30);
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.length).toBe(1);
    expect(reports[0].schema).toBe('StoredSession');
  });

  it('upsert accepts a Tx argument (cross-repo atomicity entrypoint)', () => {
    // withTx is exercised by transactions.test.ts; here we just prove the
    // repo's tx parameter threads through a db.transaction() callback.
    const tx = db.transaction(() => {
      repo.upsert(mkSession('tx-session', { title: 'tx' }), db);
    });
    tx();
    expect(repo.get('tx-session' as SessionId)?.title).toBe('tx');
  });

  it('distinguishes missing, invalid, and valid Commander context caches', () => {
    repo.upsert(mkSession('s1'));
    expect(repo.readContextCache('s1' as SessionId)).toEqual({ state: 'missing' });

    const cache: CommanderContextCache = {
      kind: 'commander_context_cache',
      version: 2,
      projectorVersion: 1,
      sessionId: 's1',
      runs: [],
      projectionHash: 'a'.repeat(64),
    };
    repo.saveContextCache('s1' as SessionId, cache);
    expect(repo.readContextCache('s1' as SessionId)).toEqual({ state: 'valid', cache });

    db.prepare(`UPDATE commander_sessions SET context_graph_json = ? WHERE id = ?`).run(
      JSON.stringify([{ kind: 'user-message', content: 'legacy private graph' }]),
      's1',
    );
    expect(repo.readContextCache('s1' as SessionId)).toEqual({ state: 'invalid' });

    db.prepare(`UPDATE commander_sessions SET context_graph_json = ? WHERE id = ?`).run(
      'not valid json {{{{',
      's1',
    );
    expect(repo.readContextCache('s1' as SessionId)).toEqual({ state: 'invalid' });

    repo.clearContextCache('s1' as SessionId);
    expect(repo.readContextCache('s1' as SessionId)).toEqual({ state: 'missing' });
    expect(repo.readContextCache('nonexistent' as SessionId)).toEqual({ state: 'missing' });
  });
});
