import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from './schema-sql.js';
import {
  assertCanonicalSchema,
  CanonicalSchemaError,
  getCanonicalSchemaDifferences,
} from './schema-validation.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

describe('canonical SQLite schema validation', () => {
  let db: BetterSqlite3.Database | undefined;

  afterEach(() => db?.close());

  it('accepts exactly SCHEMA_SQL', () => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);

    expect(getCanonicalSchemaDifferences(db)).toEqual([]);
    expect(() => assertCanonicalSchema(db!)).not.toThrow();
  });

  it('rejects extra columns and missing indexes', () => {
    db = new Database(':memory:');
    db.exec(SCHEMA_SQL);
    db.exec('ALTER TABLE canvases ADD COLUMN legacy_probe TEXT');
    db.exec('DROP INDEX idx_characters_name');

    expect(getCanonicalSchemaDifferences(db)).toEqual(
      expect.arrayContaining([
        'extra column on table "canvases" "legacy_probe"',
        'missing index "idx_characters_name"',
      ]),
    );
    expect(() => assertCanonicalSchema(db!)).toThrow(CanonicalSchemaError);
  });

  it('rejects foreign-key and CHECK-clause drift', () => {
    const withoutForeignKey = SCHEMA_SQL.replace(
      'task_list_id        TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,',
      'task_list_id        TEXT NOT NULL,',
    );
    const drifted = withoutForeignKey.replace(
      "current_gate       TEXT CHECK (current_gate IS NULL OR current_gate IN ('production_plan', 'visual_constitution', 'delivery')),\n",
      'current_gate       TEXT,\n',
    );
    expect(withoutForeignKey).not.toBe(SCHEMA_SQL);
    expect(drifted).not.toBe(SCHEMA_SQL);

    db = new Database(':memory:');
    db.exec(drifted);

    expect(getCanonicalSchemaDifferences(db)).toEqual(
      expect.arrayContaining([
        'foreign keys on table "tasks" differ',
        'CHECK clauses on table "task_lists" differ',
      ]),
    );
  });
});
