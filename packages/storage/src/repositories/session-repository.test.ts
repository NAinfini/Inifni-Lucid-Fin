import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import type { SessionId, ContextItem, ToolKey } from '@lucid-fin/contracts';
import { SessionRepository, type StoredSession } from './session-repository.js';

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
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function mkSession(id: string, overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: id as SessionId,
    canvasId: null,
    title: '',
    messages: '[]',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
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

  it('delete removes the row', () => {
    repo.upsert(mkSession('s1'));
    repo.delete('s1' as SessionId);
    expect(repo.get('s1' as SessionId)).toBeUndefined();
  });

  it('fault injection: list skips malformed row + increments degradedCount + reports', () => {
    repo.upsert(mkSession('good', { updatedAt: 20 }));
    // Inject a corrupt row (non-numeric created_at) bypassing the repository.
    db.prepare(
      `INSERT INTO commander_sessions (id, canvas_id, title, messages, created_at, updated_at)
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

  // ── G2a-5: ContextGraph persistence round-trip ─────────────

  it('getContextGraph returns null when no graph has been saved', () => {
    repo.upsert(mkSession('s1'));
    expect(repo.getContextGraph('s1' as SessionId)).toBeNull();
  });

  it('saveContextGraph and getContextGraph round-trip items', () => {
    repo.upsert(mkSession('s1'));

    const items: ContextItem[] = [
      {
        kind: 'user-message',
        itemId: 'item-1' as import('@lucid-fin/contracts').ContextItemId,
        producedAtStep: 0,
        content: 'Hello',
      },
      {
        kind: 'tool-result',
        itemId: 'item-2' as import('@lucid-fin/contracts').ContextItemId,
        producedAtStep: 1,
        toolKey: 'canvas.getState' as ToolKey,
        paramsHash: '{}',
        content: { success: true },
        schemaVersion: 1,
      },
    ];

    repo.saveContextGraph('s1' as SessionId, items);
    const loaded = repo.getContextGraph('s1' as SessionId);
    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(2);
    expect(loaded![0]!.kind).toBe('user-message');
    expect(loaded![1]!.kind).toBe('tool-result');
  });

  it('getContextGraph returns null on malformed JSON (fail-soft)', () => {
    repo.upsert(mkSession('bad-graph'));
    // Inject corrupt JSON directly
    db.prepare(`UPDATE commander_sessions SET context_graph_json = ? WHERE id = ?`).run(
      'not valid json {{{{',
      'bad-graph',
    );
    expect(repo.getContextGraph('bad-graph' as SessionId)).toBeNull();
  });

  it('getContextGraph returns null when id does not exist', () => {
    expect(repo.getContextGraph('nonexistent' as SessionId)).toBeNull();
  });
});
