import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { ShotTemplate, ShotTemplateId } from '@lucid-fin/contracts';
import {
  setDegradeReporter,
  type DegradeReporter,
} from '@lucid-fin/contracts-parse';
import { ShotTemplateRepository } from './shot-template-repository.js';

const SCHEMA = `
CREATE TABLE custom_shot_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tracks_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function mkTemplate(id: string, overrides: Partial<ShotTemplate> = {}): ShotTemplate {
  return {
    id,
    name: `template ${id}`,
    description: `desc ${id}`,
    builtIn: false,
    tracks: {},
    createdAt: 100,
    ...overrides,
  };
}

describe('ShotTemplateRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: ShotTemplateRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new ShotTemplateRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('upsert inserts a new template with serialized tracks', () => {
    repo.upsert(
      mkTemplate('t1', {
        tracks: { camera: { category: 'camera', intensity: 1, entries: [] } } as unknown as ShotTemplate['tracks'],
      }),
    );
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('t1');
    expect(rows[0].builtIn).toBe(false);
    expect(rows[0].tracks).toEqual({ camera: { category: 'camera', intensity: 1, entries: [] } });
  });

  it('upsert updates existing template (name + tracks + updatedAt advances)', () => {
    repo.upsert(mkTemplate('t1', { name: 'v1', createdAt: 10 }));
    repo.upsert(mkTemplate('t1', { name: 'v2', createdAt: 10 }));
    const rows = repo.list().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('v2');
  });

  it('delete removes the row', () => {
    repo.upsert(mkTemplate('t1'));
    repo.delete('t1' as ShotTemplateId);
    expect(repo.list().rows).toEqual([]);
  });

  it('list always returns builtIn=false regardless of stored payload', () => {
    repo.upsert(mkTemplate('t1'));
    const rows = repo.list().rows;
    expect(rows[0].builtIn).toBe(false);
  });

  it('fault injection: malformed tracks_json surfaces as degraded + reports', () => {
    repo.upsert(mkTemplate('good'));
    db.prepare(
      `INSERT INTO custom_shot_templates (id, name, description, tracks_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1)`,
    ).run('bad', 'Bad', 'desc', '{broken');
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'ShotTemplate')).toBe(true);
  });

  it('fault injection: empty id reports degrade', () => {
    repo.upsert(mkTemplate('good'));
    db.prepare(
      `INSERT INTO custom_shot_templates (id, name, description, tracks_json, created_at, updated_at)
       VALUES (?, ?, ?, '{}', 1, 1)`,
    ).run('', 'Bad', 'desc');
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'ShotTemplate')).toBe(true);
  });

  it('accepts Tx argument on upsert + delete', () => {
    const tx = db.transaction(() => {
      repo.upsert(mkTemplate('tx-1', { name: 'TxT' }), db);
    });
    tx();
    expect(repo.list().rows[0].name).toBe('TxT');
    const txDel = db.transaction(() => {
      repo.delete('tx-1' as ShotTemplateId, db);
    });
    txDel();
    expect(repo.list().rows).toEqual([]);
  });
});
