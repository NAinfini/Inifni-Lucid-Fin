import { createRequire } from 'node:module';
import type BetterSqlite3 from 'better-sqlite3';
import { SCHEMA_SQL } from './schema-sql.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof BetterSqlite3;

interface MasterRow {
  name: string;
  tbl_name: string;
  sql: string | null;
}

interface ColumnRow {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden?: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

interface IndexListRow {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexColumnRow {
  seqno: number;
  name: string | null;
  desc: number;
  coll: string | null;
  key: number;
}

interface SchemaSnapshot {
  tables: Map<string, MasterRow>;
  indexes: IndexShape[];
  triggers: Map<string, string>;
  views: Map<string, string>;
}

interface IndexShape {
  name: string;
  table: string;
  unique: number;
  origin: string;
  partial: number;
  predicate: string | null;
  columns: Array<[string | null, number, string | null]>;
  automatic: boolean;
}

export class CanonicalSchemaError extends Error {
  constructor(readonly differences: readonly string[]) {
    super(
      `SQLite schema does not match SCHEMA_SQL:\n${differences.map((line) => `- ${line}`).join('\n')}`,
    );
    this.name = 'CanonicalSchemaError';
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function canonicalText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function canonicalSqlExpression(value: string): string {
  return canonicalText(value).replace(/\s*([(),=<>+*/%])\s*/g, '$1');
}

function canonicalDefault(value: string | null): string | null {
  if (value === null || /^null$/i.test(value.trim())) return null;
  return canonicalText(value);
}

function isIdentifierChar(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$]/.test(character);
}

function skipQuoted(sql: string, start: number): number {
  const opener = sql[start];
  const closer = opener === '[' ? ']' : opener;
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== closer) {
      index += 1;
      continue;
    }
    if (closer !== ']' && sql[index + 1] === closer) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return sql.length;
}

function findKeyword(sql: string, keyword: string, offset = 0): number {
  const lowerKeyword = keyword.toLowerCase();
  for (let index = offset; index <= sql.length - keyword.length; index += 1) {
    const character = sql[index];
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      index = skipQuoted(sql, index) - 1;
      continue;
    }
    if (
      sql.slice(index, index + keyword.length).toLowerCase() === lowerKeyword &&
      !isIdentifierChar(sql[index - 1]) &&
      !isIdentifierChar(sql[index + keyword.length])
    ) {
      return index;
    }
  }
  return -1;
}

function findClosingParenthesis(sql: string, openingIndex: number): number {
  let depth = 0;
  for (let index = openingIndex; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "'" || character === '"' || character === '`' || character === '[') {
      index = skipQuoted(sql, index) - 1;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function checkClauses(sql: string | null): string[] {
  if (!sql) return [];
  const clauses: string[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const checkIndex = findKeyword(sql, 'check', offset);
    if (checkIndex === -1) break;
    let openingIndex = checkIndex + 'check'.length;
    while (/\s/.test(sql[openingIndex] ?? '')) openingIndex += 1;
    if (sql[openingIndex] !== '(') {
      offset = openingIndex;
      continue;
    }
    const closingIndex = findClosingParenthesis(sql, openingIndex);
    if (closingIndex === -1) {
      clauses.push('<unterminated CHECK>');
      break;
    }
    const expression = canonicalSqlExpression(sql.slice(openingIndex + 1, closingIndex)).replace(
      /\bIN\(('(?:''|[^'])*'|[A-Za-z0-9_.+-]+)\)/gi,
      '=$1',
    );
    clauses.push(canonicalSqlExpression(expression));
    offset = closingIndex + 1;
  }
  return clauses.sort();
}

function tableOptions(sql: string | null): [boolean, boolean] {
  const text = sql ?? '';
  return [/\bwithout\s+rowid\b/i.test(text), /\bstrict\b/i.test(text)];
}

function tableColumns(db: BetterSqlite3.Database, table: string): Map<string, string> {
  const rows = db.pragma(`table_xinfo(${quoteIdentifier(table)})`) as unknown as ColumnRow[];
  return new Map(
    rows.map((row) => [
      row.name,
      JSON.stringify([
        canonicalText(row.type ?? ''),
        Number(row.notnull),
        canonicalDefault(row.dflt_value),
        Number(row.pk),
        Number(row.hidden ?? 0),
      ]),
    ]),
  );
}

function tableForeignKeys(db: BetterSqlite3.Database, table: string): string[] {
  const rows = db.pragma(
    `foreign_key_list(${quoteIdentifier(table)})`,
  ) as unknown as ForeignKeyRow[];
  return rows
    .map((row) =>
      JSON.stringify([
        Number(row.id),
        Number(row.seq),
        row.table,
        row.from,
        row.to,
        row.on_update,
        row.on_delete,
        row.match,
      ]),
    )
    .sort();
}

function indexPredicate(sql: string | null): string | null {
  if (!sql) return null;
  const whereIndex = findKeyword(sql, 'where');
  return whereIndex === -1 ? null : canonicalText(sql.slice(whereIndex + 'where'.length));
}

function indexShapes(db: BetterSqlite3.Database): IndexShape[] {
  const masters = db
    .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all() as MasterRow[];
  const listByTable = new Map<string, Map<string, IndexListRow>>();
  return masters.map((master) => {
    let indexList = listByTable.get(master.tbl_name);
    if (!indexList) {
      indexList = new Map(
        (
          db.pragma(`index_list(${quoteIdentifier(master.tbl_name)})`) as unknown as IndexListRow[]
        ).map((row) => [row.name, row]),
      );
      listByTable.set(master.tbl_name, indexList);
    }
    const details = indexList.get(master.name);
    const columns = (
      db.pragma(`index_xinfo(${quoteIdentifier(master.name)})`) as unknown as IndexColumnRow[]
    )
      .filter((row) => Number(row.key) === 1)
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((row) => [row.name ?? null, Number(row.desc), row.coll ?? null]) as Array<
      [string | null, number, string | null]
    >;
    return {
      name: master.name,
      table: master.tbl_name,
      unique: Number(details?.unique ?? 0),
      origin: details?.origin ?? '',
      partial: Number(details?.partial ?? 0),
      predicate: indexPredicate(master.sql),
      columns,
      automatic: master.sql === null,
    };
  });
}

function schemaSnapshot(db: BetterSqlite3.Database): SchemaSnapshot {
  const tables = new Map(
    (
      db
        .prepare(
          "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as MasterRow[]
    ).map((row) => [row.name, row]),
  );
  const triggers = new Map(
    (
      db
        .prepare(
          "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
        )
        .all() as MasterRow[]
    ).map((row) => [row.name, JSON.stringify([row.tbl_name, canonicalText(row.sql ?? '')])]),
  );
  const views = new Map(
    (
      db
        .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name")
        .all() as MasterRow[]
    ).map((row) => [row.name, canonicalText(row.sql ?? '')]),
  );
  return { tables, indexes: indexShapes(db), triggers, views };
}

function compareNamed(
  label: string,
  expected: Map<string, string>,
  actual: Map<string, string>,
  differences: string[],
): void {
  for (const name of [...expected.keys()].filter((name) => !actual.has(name)).sort()) {
    differences.push(`missing ${label} "${name}"`);
  }
  for (const name of [...actual.keys()].filter((name) => !expected.has(name)).sort()) {
    differences.push(`extra ${label} "${name}"`);
  }
  for (const name of [...expected.keys()].filter((name) => actual.has(name)).sort()) {
    if (expected.get(name) !== actual.get(name)) differences.push(`${label} "${name}" differs`);
  }
}

function compareTable(
  expectedDb: BetterSqlite3.Database,
  actualDb: BetterSqlite3.Database,
  table: string,
  expected: MasterRow,
  actual: MasterRow,
  differences: string[],
): void {
  compareNamed(
    `column on table "${table}"`,
    tableColumns(expectedDb, table),
    tableColumns(actualDb, table),
    differences,
  );
  const expectedForeignKeys = tableForeignKeys(expectedDb, table);
  const actualForeignKeys = tableForeignKeys(actualDb, table);
  if (JSON.stringify(expectedForeignKeys) !== JSON.stringify(actualForeignKeys)) {
    differences.push(`foreign keys on table "${table}" differ`);
  }
  if (JSON.stringify(tableOptions(expected.sql)) !== JSON.stringify(tableOptions(actual.sql))) {
    differences.push(`table options on "${table}" differ`);
  }
  if (JSON.stringify(checkClauses(expected.sql)) !== JSON.stringify(checkClauses(actual.sql))) {
    differences.push(`CHECK clauses on table "${table}" differ`);
  }
}

function indexSignature(index: IndexShape): string {
  return JSON.stringify([
    index.table,
    index.unique,
    index.origin,
    index.partial,
    index.predicate,
    index.columns,
  ]);
}

function compareIndexes(expected: IndexShape[], actual: IndexShape[], differences: string[]): void {
  const expectedNamed = new Map(
    expected
      .filter((index) => !index.automatic)
      .map((index) => [index.name, indexSignature(index)]),
  );
  const actualNamed = new Map(
    actual.filter((index) => !index.automatic).map((index) => [index.name, indexSignature(index)]),
  );
  compareNamed('index', expectedNamed, actualNamed, differences);

  const automaticSignatures = (indexes: IndexShape[]) =>
    indexes
      .filter((index) => index.automatic)
      .map(indexSignature)
      .sort();
  const expectedAutomatic = automaticSignatures(expected);
  const actualAutomatic = automaticSignatures(actual);
  if (JSON.stringify(expectedAutomatic) !== JSON.stringify(actualAutomatic)) {
    differences.push('automatic indexes differ');
  }
}

/** Return every difference between an open database and the canonical storage schema. */
export function getCanonicalSchemaDifferences(db: BetterSqlite3.Database): string[] {
  const reference = new Database(':memory:');
  try {
    reference.exec(SCHEMA_SQL);
    const expected = schemaSnapshot(reference);
    const actual = schemaSnapshot(db);
    const differences: string[] = [];

    const expectedTables = new Map([...expected.tables].map(([name]) => [name, name]));
    const actualTables = new Map([...actual.tables].map(([name]) => [name, name]));
    compareNamed('table', expectedTables, actualTables, differences);
    for (const table of [...expected.tables.keys()]
      .filter((name) => actual.tables.has(name))
      .sort()) {
      compareTable(
        reference,
        db,
        table,
        expected.tables.get(table)!,
        actual.tables.get(table)!,
        differences,
      );
    }
    compareIndexes(expected.indexes, actual.indexes, differences);
    compareNamed('trigger', expected.triggers, actual.triggers, differences);
    compareNamed('view', expected.views, actual.views, differences);
    return differences;
  } finally {
    reference.close();
  }
}

/** Reject existing storage files whose schema is not exactly SCHEMA_SQL. */
export function assertCanonicalSchema(db: BetterSqlite3.Database): void {
  const differences = getCanonicalSchemaDifferences(db);
  if (differences.length > 0) throw new CanonicalSchemaError(differences);
}
