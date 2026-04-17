import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { Canvas, CanvasId } from '@lucid-fin/contracts';
import {
  setDegradeReporter,
  type DegradeReporter,
} from '@lucid-fin/contracts-parse';
import { CanvasRepository } from './canvas-repository.js';

const SCHEMA = `
CREATE TABLE canvases (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  nodes       TEXT NOT NULL DEFAULT '[]',
  edges       TEXT NOT NULL DEFAULT '[]',
  viewport    TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  notes       TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function mkCanvas(id: string, overrides: Partial<Canvas> = {}): Canvas {
  return {
    id,
    name: `canvas ${id}`,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('CanvasRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: CanvasRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new CanvasRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('upsert inserts a new canvas', () => {
    repo.upsert(mkCanvas('c1', { name: 'first' }));
    const got = repo.get('c1' as CanvasId);
    expect(got).toBeDefined();
    expect(got!.name).toBe('first');
    expect(got!.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('upsert updates an existing canvas (createdAt preserved, updatedAt advances)', () => {
    repo.upsert(mkCanvas('c1', { name: 'v1', createdAt: 10, updatedAt: 10 }));
    repo.upsert(mkCanvas('c1', { name: 'v2', createdAt: 999, updatedAt: 20 }));
    const got = repo.get('c1' as CanvasId)!;
    expect(got.name).toBe('v2');
    expect(got.createdAt).toBe(10);
    expect(got.updatedAt).toBe(20);
  });

  it('get returns undefined on missing id', () => {
    expect(repo.get('missing' as CanvasId)).toBeUndefined();
  });

  it('list (summary) orders by updatedAt DESC and omits body', () => {
    repo.upsert(mkCanvas('old',    { updatedAt: 1 }));
    repo.upsert(mkCanvas('middle', { updatedAt: 5 }));
    repo.upsert(mkCanvas('newest', { updatedAt: 9 }));
    const rows = repo.list();
    expect(rows.map((r) => r.id)).toEqual(['newest', 'middle', 'old']);
    expect(rows[0]).not.toHaveProperty('nodes');
  });

  it('listFull returns canvases with bodies ordered by updatedAt DESC', () => {
    repo.upsert(mkCanvas('a', { updatedAt: 1 }));
    repo.upsert(mkCanvas('b', { updatedAt: 9 }));
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0].viewport).toBeDefined();
  });

  it('delete removes the row', () => {
    repo.upsert(mkCanvas('c1'));
    repo.delete('c1' as CanvasId);
    expect(repo.get('c1' as CanvasId)).toBeUndefined();
  });

  it('fault injection: get skips malformed canvas (invalid viewport JSON) + reports degrade', () => {
    repo.upsert(mkCanvas('good'));
    // Inject a row with an invalid viewport JSON payload.
    db.prepare(
      `INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES (?, 'bad', '[]', '[]', ?, '[]', 1, 1)`,
    ).run('bad', '{"broken":');
    // Missing id lookup returns undefined after degrade
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    // Telemetry parity with schema-mismatch path: reporter must fire.
    expect(reports.some((r) => r.schema === 'Canvas')).toBe(true);
  });

  it('fault injection: listFull reports degrade on schema mismatch', () => {
    repo.upsert(mkCanvas('good'));
    // Inject a row with a numeric viewport.zoom that parses JSON but fails the schema.
    db.prepare(
      `INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES (?, ?, '[]', '[]', ?, '[]', ?, ?)`,
    ).run('schema-bad', 'canvas bad', '{"x":"nope","y":0,"zoom":1}', 1, 1);
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Canvas')).toBe(true);
  });

  it('tolerates legacy empty-string body columns', () => {
    // Pre-default-value rows may have '' for body columns instead of valid JSON.
    db.prepare(
      `INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES (?, 'legacy', '', '', '', '', ?, ?)`,
    ).run('legacy', 1, 1);
    const got = repo.get('legacy' as CanvasId);
    expect(got).toBeDefined();
    expect(got!.nodes).toEqual([]);
    expect(got!.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('upsert accepts a Tx argument', () => {
    const tx = db.transaction(() => {
      repo.upsert(mkCanvas('tx-canvas', { name: 'tx' }), db);
    });
    tx();
    expect(repo.get('tx-canvas' as CanvasId)?.name).toBe('tx');
  });
});
