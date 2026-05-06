import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { CanvasEdge } from '@lucid-fin/contracts';
import { CanvasEdgeRepository } from './canvas-edge-repository.js';

const SCHEMA = `
CREATE TABLE canvases (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  viewport   TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  notes      TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE canvas_edges (
  id            TEXT PRIMARY KEY,
  canvas_id     TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  target        TEXT NOT NULL,
  source_handle TEXT,
  target_handle TEXT,
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'idle',
  auto_label    INTEGER NOT NULL DEFAULT 0,
  z_index       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_canvas_edges_canvas_id ON canvas_edges(canvas_id);
CREATE INDEX idx_canvas_edges_source ON canvas_edges(source);
CREATE INDEX idx_canvas_edges_target ON canvas_edges(target);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function insertCanvas(db: BetterSqlite3.Database, id: string): void {
  db.prepare('INSERT INTO canvases (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, `Canvas ${id}`, 100, 100);
}

function mkEdge(id: string, overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id,
    source: 'source-node',
    target: 'target-node',
    data: {
      label: `Edge ${id}`,
      status: 'idle',
      autoLabel: false,
    },
    ...overrides,
  };
}

describe('CanvasEdgeRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: CanvasEdgeRepository;

  beforeEach(() => {
    db = openDb();
    repo = new CanvasEdgeRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsertMany inserts edges and getByCanvasId retrieves them', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [
      mkEdge('e1', { sourceHandle: 'out', targetHandle: 'in' }),
      mkEdge('e2', { source: 'n2', target: 'n3' }),
    ]);

    const result = repo.getByCanvasId('c1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 'e1',
      source: 'source-node',
      target: 'target-node',
      sourceHandle: 'out',
      targetHandle: 'in',
      data: { label: 'Edge e1', status: 'idle', autoLabel: false },
    });
    expect(result[1]).toMatchObject({ id: 'e2', source: 'n2', target: 'n3' });
  });

  it('upsertMany replaces stale edges for a canvas', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkEdge('e1'), mkEdge('e2'), mkEdge('e3')]);

    repo.upsertMany('c1', [mkEdge('e1'), mkEdge('e3')]);

    expect(repo.getByCanvasId('c1').map((edge) => edge.id)).toEqual(['e1', 'e3']);
  });

  it('upsertMany with empty array clears all edges for the canvas', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkEdge('e1'), mkEdge('e2')]);

    repo.upsertMany('c1', []);

    expect(repo.getByCanvasId('c1')).toEqual([]);
  });

  it('preserves array order through z_index', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkEdge('back'), mkEdge('middle'), mkEdge('front')]);

    expect(repo.getByCanvasId('c1').map((edge) => edge.id)).toEqual([
      'back',
      'middle',
      'front',
    ]);
  });

  it('deleting a canvas cascades to canvas_edges', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkEdge('e1'), mkEdge('e2')]);

    db.prepare('DELETE FROM canvases WHERE id = ?').run('c1');

    expect(repo.getByCanvasId('c1')).toEqual([]);
  });
});
