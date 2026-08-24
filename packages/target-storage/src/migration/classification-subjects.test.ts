import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  enumerateLegacyRowClassificationSubjects,
  scanLegacyRowsForClassification,
} from './classification-subjects.js';
import { preflightLegacySources, type LegacySourceExpectedSchemas } from './source-preflight.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(schema: string): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  databases.push(value);
  value.exec(schema);
  return value;
}

describe('Legacy row classification subjects', () => {
  it('enumerates every source row with stable opaque identities and no source mutation', () => {
    const main = database(`
      CREATE TABLE alpha (id TEXT, body TEXT);
      CREATE TABLE duplicates (value TEXT);
      INSERT INTO alpha VALUES ('a-2', 'C:\\Users\\person\\private.mov');
      INSERT INTO alpha VALUES ('a-1', 'visible fact');
      INSERT INTO duplicates VALUES ('same');
      INSERT INTO duplicates VALUES ('same');
    `);
    const prompts = database(`
      CREATE TABLE prompt_rows (code TEXT, body TEXT);
      INSERT INTO prompt_rows VALUES ('prompt-1', 'private instruction');
    `);
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'alpha', kind: 'table', columns: ['body', 'id'] },
          { name: 'duplicates', kind: 'table', columns: ['value'] },
        ],
      },
      prompts: {
        tables: [{ name: 'prompt_rows', kind: 'table', columns: ['body', 'code'] }],
      },
    };
    const before = {
      alpha: main.prepare('SELECT * FROM alpha ORDER BY id').all(),
      duplicates: main.prepare('SELECT * FROM duplicates').all(),
      prompts: prompts.prepare('SELECT * FROM prompt_rows').all(),
    };

    const first = enumerateLegacyRowClassificationSubjects({ main, prompts }, expected);
    const second = enumerateLegacyRowClassificationSubjects({ main, prompts }, expected);
    const preflight = preflightLegacySources({ main, prompts }, expected);

    expect(first).toMatchObject({
      databaseCount: 2,
      sourceCount: 3,
      rowCount: 5,
      bySource: [
        { database: 'main', table: 'alpha', rowCount: 2 },
        { database: 'main', table: 'duplicates', rowCount: 2 },
        { database: 'prompts', table: 'prompt_rows', rowCount: 1 },
      ],
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sourceContentFingerprint).toBe(preflight.contentFingerprint);
    expect(first).toEqual(second);
    expect(first.subjects).toHaveLength(5);
    expect(first.subjects.every(({ path }) => path === '$')).toBe(true);
    expect(first.subjects.every(({ rowKey }) => /^[0-9a-f]{64}$/.test(rowKey))).toBe(true);
    const duplicateKeys = first.subjects
      .filter(({ table }) => table === 'duplicates')
      .map(({ rowKey }) => rowKey);
    expect(new Set(duplicateKeys).size).toBe(2);
    expect(JSON.stringify(first)).not.toContain('private.mov');
    expect(JSON.stringify(first)).not.toContain('private instruction');
    expect({
      alpha: main.prepare('SELECT * FROM alpha ORDER BY id').all(),
      duplicates: main.prepare('SELECT * FROM duplicates').all(),
      prompts: prompts.prepare('SELECT * FROM prompt_rows').all(),
    }).toEqual(before);
  });

  it('binds the inventory fingerprint to database ownership and frozen columns', () => {
    const main = database(`CREATE TABLE one (id TEXT); INSERT INTO one VALUES ('same');`);
    const prompts = database(`CREATE TABLE one (id TEXT); INSERT INTO one VALUES ('same');`);
    const expected: LegacySourceExpectedSchemas = {
      main: { tables: [{ name: 'one', kind: 'table', columns: ['id'] }] },
      prompts: { tables: [{ name: 'one', kind: 'table', columns: ['id'] }] },
    };

    const report = enumerateLegacyRowClassificationSubjects({ main, prompts }, expected);

    expect(report.subjects).toHaveLength(2);
    expect(new Set(report.subjects.map(({ rowKey }) => rowKey)).size).toBe(2);
    expect(report.bySource[0]!.contentFingerprint).not.toBe(report.bySource[1]!.contentFingerprint);
  });

  it('exposes source values only to the in-memory classifier visitor', () => {
    const main = database(`
      CREATE TABLE media (hash TEXT, private_path TEXT);
      INSERT INTO media VALUES ('abc', 'C:\\Users\\person\\secret.mov');
    `);
    const prompts = database(`CREATE TABLE prompts (id TEXT);`);
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'media', kind: 'table', columns: ['hash', 'private_path'] }],
      },
      prompts: { tables: [{ name: 'prompts', kind: 'table', columns: ['id'] }] },
    };
    const visited: Array<{ rowKey: string; hash: unknown; privatePath: unknown }> = [];

    const inventory = scanLegacyRowsForClassification({ main, prompts }, expected, (row) => {
      visited.push({
        rowKey: row.subject.rowKey,
        hash: row.values.hash,
        privatePath: row.values.private_path,
      });
    });

    expect(visited).toEqual([
      {
        rowKey: inventory.subjects[0]!.rowKey,
        hash: 'abc',
        privatePath: 'C:\\Users\\person\\secret.mov',
      },
    ]);
    expect(JSON.stringify(inventory)).not.toContain('secret.mov');
  });
});
