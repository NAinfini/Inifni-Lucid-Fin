import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import type { ProcessPromptKey } from '@lucid-fin/contracts';
import { ProcessPromptRepository } from './process-prompt-repository.js';

const SCHEMA = `
CREATE TABLE process_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_value TEXT NOT NULL,
  custom_value TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(SCHEMA);
  return db;
}

function seed(
  db: BetterSqlite3.Database,
  processKey: string,
  defaults: Partial<{
    name: string;
    description: string;
    defaultValue: string;
    customValue: string | null;
    createdAt: number;
    updatedAt: number;
  }> = {},
): void {
  db.prepare(
    `INSERT INTO process_prompts
       (process_key, name, description, default_value, custom_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    processKey,
    defaults.name ?? processKey,
    defaults.description ?? '',
    defaults.defaultValue ?? 'default',
    defaults.customValue ?? null,
    defaults.createdAt ?? 1,
    defaults.updatedAt ?? 1,
  );
}

describe('ProcessPromptRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: ProcessPromptRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    repo = new ProcessPromptRepository(db);
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('list returns rows ordered by id ASC with snake→camel alias', () => {
    seed(db, 'c', { defaultValue: 'c-default' });
    seed(db, 'a', { defaultValue: 'a-default' });
    seed(db, 'b', { defaultValue: 'b-default' });
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.processKey)).toEqual(['c', 'a', 'b']);
    expect(rows[0].defaultValue).toBe('c-default');
  });

  it('get returns null when key is missing', () => {
    expect(repo.get('missing' as ProcessPromptKey)).toBeNull();
  });

  it('get returns a single record with camelCase fields', () => {
    seed(db, 'foo', { defaultValue: 'def', customValue: 'cust' });
    const rec = repo.get('foo' as ProcessPromptKey);
    expect(rec).not.toBeNull();
    expect(rec!.processKey).toBe('foo');
    expect(rec!.defaultValue).toBe('def');
    expect(rec!.customValue).toBe('cust');
  });

  it('getEffectiveValue returns customValue when set, defaultValue otherwise', () => {
    seed(db, 'has-custom', { defaultValue: 'd1', customValue: 'c1' });
    seed(db, 'no-custom', { defaultValue: 'd2', customValue: null });
    expect(repo.getEffectiveValue('has-custom' as ProcessPromptKey)).toBe('c1');
    expect(repo.getEffectiveValue('no-custom' as ProcessPromptKey)).toBe('d2');
    expect(repo.getEffectiveValue('missing' as ProcessPromptKey)).toBeNull();
  });

  it('setCustom writes customValue + bumps updatedAt', async () => {
    seed(db, 'foo', { defaultValue: 'def', updatedAt: 1 });
    const before = repo.get('foo' as ProcessPromptKey)!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    repo.setCustom('foo' as ProcessPromptKey, 'new-value');
    const after = repo.get('foo' as ProcessPromptKey)!;
    expect(after.customValue).toBe('new-value');
    expect(after.updatedAt).toBeGreaterThan(before);
  });

  it('setCustom throws when key is missing', () => {
    expect(() => repo.setCustom('missing' as ProcessPromptKey, 'x')).toThrow(
      'Process prompt not found: missing',
    );
  });

  it('resetToDefault clears customValue', () => {
    seed(db, 'foo', { defaultValue: 'd', customValue: 'c' });
    repo.resetToDefault('foo' as ProcessPromptKey);
    expect(repo.get('foo' as ProcessPromptKey)!.customValue).toBeNull();
  });

  it('resetToDefault throws when key is missing', () => {
    expect(() => repo.resetToDefault('missing' as ProcessPromptKey)).toThrow(
      'Process prompt not found: missing',
    );
  });

  it('fault injection: list skips malformed row + increments degradedCount + reports', () => {
    seed(db, 'good', {});
    // Inject a corrupt row: non-numeric created_at violates z.number().
    // SQLite's NUMERIC affinity keeps the text value as-is when inserted
    // via a parameterized query from a JS string.
    db.prepare(
      `INSERT INTO process_prompts
         (process_key, name, description, default_value, custom_value, created_at, updated_at)
       VALUES (?, 'bad', '', 'd', NULL, ?, 1)`,
    ).run('bad', 'not-a-number' as unknown as number);
    const { rows, degradedCount } = repo.list();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.processKey)).toEqual(['good']);
    expect(reports.length).toBe(1);
    expect(reports[0].schema).toBe('ProcessPromptRecord');
  });

  it('methods accept a Tx argument (cross-repo atomicity entrypoint)', () => {
    seed(db, 'foo', { defaultValue: 'd' });
    const tx = db.transaction(() => {
      repo.setCustom('foo' as ProcessPromptKey, 'tx-value', db);
    });
    tx();
    expect(repo.get('foo' as ProcessPromptKey)!.customValue).toBe('tx-value');
  });
});
