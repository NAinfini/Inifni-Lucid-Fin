import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { PresetId } from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { PresetRepository } from './preset-repository.js';

const SCHEMA = `
CREATE TABLE preset_overrides (
  id TEXT PRIMARY KEY,
  preset_id TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT,
  params TEXT,
  defaults TEXT,
  is_user INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

describe('PresetRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: PresetRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new PresetRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('upsertOverride + listOverrides round-trips typed fields', () => {
    repo.upsertOverride({
      id: 'o1',
      presetId: 'p1',
      category: 'camera',
      name: 'Wide',
      description: 'wide-angle',
      prompt: 'wide shot',
      params: [{ k: 'v' }],
      defaults: { lens: 24 },
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const { rows, degradedCount } = repo.listOverrides();
    expect(degradedCount).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].presetId).toBe('p1');
    expect(rows[0].params).toEqual([{ k: 'v' }]);
    expect(rows[0].defaults).toEqual({ lens: 24 });
    expect(rows[0].isUser).toBe(false);
  });

  it('upsertOverride updates an existing row', () => {
    repo.upsertOverride({
      id: 'o1',
      presetId: 'p1',
      category: 'camera',
      name: 'v1',
      isUser: false,
      createdAt: 10,
      updatedAt: 10,
    });
    repo.upsertOverride({
      id: 'o1',
      presetId: 'p1',
      category: 'camera',
      name: 'v2',
      isUser: true,
      createdAt: 999,
      updatedAt: 20,
    });
    const rows = repo.listOverrides().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('v2');
    expect(rows[0].isUser).toBe(true);
    expect(rows[0].updatedAt).toBe(20);
  });

  it('listOverrides orders by category then name', () => {
    repo.upsertOverride({
      id: '1',
      presetId: 'p',
      category: 'lighting',
      name: 'B',
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    repo.upsertOverride({
      id: '2',
      presetId: 'p',
      category: 'camera',
      name: 'Z',
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    repo.upsertOverride({
      id: '3',
      presetId: 'p',
      category: 'camera',
      name: 'A',
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    const rows = repo.listOverrides().rows;
    expect(rows.map((r) => r.id)).toEqual(['3', '2', '1']);
  });

  it('deleteOverride removes the row', () => {
    repo.upsertOverride({
      id: 'o1',
      presetId: 'p',
      category: 'c',
      name: 'n',
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    repo.deleteOverride('o1' as PresetId);
    expect(repo.listOverrides().rows).toEqual([]);
  });

  it('tolerates empty-string params/defaults columns (legacy rows)', () => {
    db.prepare(
      `INSERT INTO preset_overrides (id, preset_id, category, name, description, prompt, params, defaults, is_user, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', '', '', 0, 1, 1)`,
    ).run('legacy', 'p', 'c', 'n');
    const rows = repo.listOverrides().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].params).toEqual([]);
    expect(rows[0].defaults).toEqual({});
  });

  it('fault injection: malformed params JSON surfaces as degraded + reports', () => {
    repo.upsertOverride({
      id: 'good',
      presetId: 'p',
      category: 'c',
      name: 'n',
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    // Inject a row where the params payload is malformed AND the preset_id is
    // empty — zod's .min(1) on presetId triggers the degrade path deterministically.
    db.prepare(
      `INSERT INTO preset_overrides (id, preset_id, category, name, description, prompt, params, defaults, is_user, created_at, updated_at)
       VALUES (?, '', ?, ?, '', '', ?, '{}', 0, 1, 1)`,
    ).run('bad', 'c', 'n', '[broken');
    const { rows, degradedCount } = repo.listOverrides();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'PresetOverride')).toBe(true);
  });

  it('fault injection: non-numeric createdAt reports degrade', () => {
    repo.upsertOverride({
      id: 'good',
      presetId: 'p',
      category: 'c',
      name: 'n',
      isUser: false,
      createdAt: 1,
      updatedAt: 1,
    });
    db.prepare(
      `INSERT INTO preset_overrides (id, preset_id, category, name, description, prompt, params, defaults, is_user, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '', '[]', '{}', 0, ?, 1)`,
    ).run('bad', 'p', 'c', 'bad', 'not-a-number');
    const { rows, degradedCount } = repo.listOverrides();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'PresetOverride')).toBe(true);
  });

  it('accepts Tx argument on upsert/delete', () => {
    const tx = db.transaction(() => {
      repo.upsertOverride(
        {
          id: 'tx',
          presetId: 'p',
          category: 'c',
          name: 'TxN',
          isUser: false,
          createdAt: 1,
          updatedAt: 1,
        },
        db,
      );
    });
    tx();
    expect(repo.listOverrides().rows[0].name).toBe('TxN');
    const txDel = db.transaction(() => {
      repo.deleteOverride('tx' as PresetId, db);
    });
    txDel();
    expect(repo.listOverrides().rows).toEqual([]);
  });
});
