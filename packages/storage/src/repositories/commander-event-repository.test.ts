import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { SessionId } from '@lucid-fin/contracts';
import {
  CommanderEventRepository,
  type StoredCommanderEvent,
} from './commander-event-repository.js';

const SCHEMA = `
CREATE TABLE commander_sessions (
  id          TEXT PRIMARY KEY,
  canvas_id   TEXT,
  title       TEXT NOT NULL DEFAULT '',
  messages    TEXT NOT NULL DEFAULT '[]',
  context_graph_json TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE commander_events (
  session_id   TEXT    NOT NULL,
  run_id       TEXT    NOT NULL,
  seq          INTEGER NOT NULL,
  kind         TEXT    NOT NULL,
  step         INTEGER NOT NULL,
  emitted_at   INTEGER NOT NULL,
  payload      TEXT    NOT NULL,
  PRIMARY KEY (session_id, run_id, seq),
  FOREIGN KEY (session_id) REFERENCES commander_sessions(id) ON DELETE CASCADE
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare(
    `INSERT INTO commander_sessions (id, canvas_id, title, messages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('s1', null, '', '[]', 1, 1);
  return db;
}

function mkEvent(overrides: Partial<StoredCommanderEvent> = {}): StoredCommanderEvent {
  return {
    sessionId: 's1' as SessionId,
    runId: 'run-1',
    seq: 0,
    kind: 'assistant_text',
    step: 0,
    emittedAt: 100,
    payload: JSON.stringify({ kind: 'assistant_text', content: 'hi' }),
    ...overrides,
  };
}

describe('CommanderEventRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: CommanderEventRepository;

  beforeEach(() => {
    db = openDb();
    repo = new CommanderEventRepository(db);
  });

  it('appends events and reads them back in (run_id, seq) order', () => {
    repo.append(mkEvent({ runId: 'run-2', seq: 0 }));
    repo.append(mkEvent({ runId: 'run-1', seq: 1, kind: 'run_end' }));
    repo.append(mkEvent({ runId: 'run-1', seq: 0, kind: 'run_start' }));

    const rows = repo.listBySession('s1' as SessionId);
    expect(rows.map((r) => [r.runId, r.seq, r.kind])).toEqual([
      ['run-1', 0, 'run_start'],
      ['run-1', 1, 'run_end'],
      ['run-2', 0, 'assistant_text'],
    ]);
  });

  it('listByRun returns only the matching run ordered by seq', () => {
    repo.append(mkEvent({ runId: 'run-a', seq: 0 }));
    repo.append(mkEvent({ runId: 'run-a', seq: 1, kind: 'tool_call' }));
    repo.append(mkEvent({ runId: 'run-b', seq: 0, kind: 'assistant_text' }));

    const rows = repo.listByRun('s1' as SessionId, 'run-a');
    expect(rows.map((r) => r.seq)).toEqual([0, 1]);
    expect(rows.every((r) => r.runId === 'run-a')).toBe(true);
  });

  it('append is idempotent on (session_id, run_id, seq) — later write wins payload', () => {
    repo.append(mkEvent({ payload: 'v1' }));
    repo.append(mkEvent({ payload: 'v2' }));

    const rows = repo.listByRun('s1' as SessionId, 'run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toBe('v2');
  });

  it('deleteBySession removes all rows for that session', () => {
    repo.append(mkEvent({ runId: 'r1', seq: 0 }));
    repo.append(mkEvent({ runId: 'r2', seq: 0 }));
    repo.deleteBySession('s1' as SessionId);
    expect(repo.listBySession('s1' as SessionId)).toEqual([]);
  });

  it('cascades on commander_sessions delete via FK', () => {
    repo.append(mkEvent({ runId: 'r1', seq: 0 }));
    db.prepare(`DELETE FROM commander_sessions WHERE id = ?`).run('s1');
    expect(repo.listBySession('s1' as SessionId)).toEqual([]);
  });
});
