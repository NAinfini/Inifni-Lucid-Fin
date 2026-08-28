import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { CanonicalSchemaArtifacts } from './artifacts.js';
import { openConfiguredDatabase } from './database.js';
import { StorageError } from './errors.js';

interface IntegrityRow {
  integrity_check: string;
}

interface TableListRow {
  name: string;
  schema: string;
  strict: number;
  type: string;
}

interface SchemaRow {
  name: string;
  sql: string | null;
  tbl_name: string;
  type: string;
}

interface SchemaSnapshotRow {
  name: string;
  sqlSha256: string | null;
  table: string;
  type: string;
}

interface IndexListRow {
  name: string;
  origin: string;
  partial: number;
  unique: number;
}

interface IndexColumnRow {
  cid: number;
  coll: string | null;
  desc: number;
  key: number;
  name: string | null;
  seqno: number;
}

interface ForeignKeyRow {
  from: string;
  id: number;
  match: string;
  on_delete: string;
  on_update: string;
  seq: number;
  table: string;
  to: string;
}

export interface SchemaFingerprint {
  readonly userVersion: number;
  readonly sqliteSchema: readonly unknown[];
  readonly tableInventory: readonly unknown[];
  readonly indexInventory: readonly unknown[];
  readonly foreignKeyInventory: readonly unknown[];
  readonly schemaBindings: Readonly<{ count: number; sha256: string }>;
  readonly sha256: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function schemaRows(database: DatabaseSync): readonly SchemaRow[] {
  return (
    database
      .prepare(
        `SELECT type, name, tbl_name, sql
         FROM sqlite_schema
         WHERE name NOT LIKE 'sqlite_%'
         ORDER BY type, name, tbl_name`,
      )
      .all() as unknown as SchemaRow[]
  ).map(({ type, name, tbl_name: table, sql }) => ({ type, name, tbl_name: table, sql }));
}

function tableRows(database: DatabaseSync, schema: readonly SchemaRow[]): readonly unknown[] {
  const schemaSql = new Map(schema.map(({ name, sql }) => [name, sql]));
  return (database.prepare('PRAGMA table_list').all() as unknown as TableListRow[])
    .filter(
      ({ name, schema: databaseSchema }) =>
        databaseSchema === 'main' && !name.startsWith('sqlite_'),
    )
    .map(({ name, strict, type }) => {
      const module =
        schemaSql
          .get(name)
          ?.match(/\bUSING\s+([a-z0-9_]+)/i)?.[1]
          ?.toLowerCase() ?? null;
      return { name, type, strict: strict === 1, virtualModule: module };
    })
    .sort((left, right) => compareText(left.name, right.name));
}

function indexRows(database: DatabaseSync, tables: readonly unknown[]): readonly unknown[] {
  const inventory: unknown[] = [];
  for (const { name: table } of tables as Array<{ name: string }>) {
    const indexes = database
      .prepare(`PRAGMA index_list(${quoteIdentifier(table)})`)
      .all() as unknown as IndexListRow[];
    for (const { name, origin, partial, unique } of indexes) {
      const columns = (
        database
          .prepare(`PRAGMA index_xinfo(${quoteIdentifier(name)})`)
          .all() as unknown as IndexColumnRow[]
      )
        .map(({ cid, coll, desc, key, name: column, seqno }) => ({
          seqno,
          cid,
          column,
          descending: desc === 1,
          collation: coll,
          key: key === 1,
        }))
        .sort((left, right) => left.seqno - right.seqno);
      inventory.push({
        table,
        name,
        unique: unique === 1,
        origin,
        partial: partial === 1,
        columns,
      });
    }
  }
  return inventory.sort((left, right) => {
    const leftKey = `${(left as { table: string }).table}\0${(left as { name: string }).name}`;
    const rightKey = `${(right as { table: string }).table}\0${(right as { name: string }).name}`;
    return compareText(leftKey, rightKey);
  });
}

function foreignKeyRows(database: DatabaseSync, tables: readonly unknown[]): readonly unknown[] {
  const inventory: unknown[] = [];
  for (const { name: table } of tables as Array<{ name: string }>) {
    const rows = database
      .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
      .all() as unknown as ForeignKeyRow[];
    for (const row of rows) {
      inventory.push({
        table,
        id: row.id,
        sequence: row.seq,
        referencedTable: row.table,
        from: row.from,
        to: row.to,
        onUpdate: row.on_update,
        onDelete: row.on_delete,
        match: row.match,
      });
    }
  }
  return inventory.sort((left, right) => compareText(JSON.stringify(left), JSON.stringify(right)));
}

export function assertDatabaseHealthy(database: DatabaseSync): void {
  let integrityRows: IntegrityRow[];
  try {
    integrityRows = database.prepare('PRAGMA integrity_check').all() as unknown as IntegrityRow[];
  } catch (cause) {
    throw new StorageError(
      'INTEGRITY_CHECK_FAILED',
      'SQLite integrity validation could not be completed',
      { cause },
    );
  }
  if (integrityRows.length !== 1 || integrityRows[0]?.integrity_check !== 'ok') {
    throw new StorageError('INTEGRITY_CHECK_FAILED', 'SQLite integrity validation failed');
  }

  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length !== 0) {
    throw new StorageError(
      'FOREIGN_KEY_CHECK_FAILED',
      `SQLite foreign-key validation found ${violations.length} violation(s)`,
    );
  }
}

export function computeSchemaFingerprint(
  database: DatabaseSync,
  artifacts: CanonicalSchemaArtifacts,
): SchemaFingerprint {
  const userVersion = (database.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  const rawSchema = schemaRows(database);
  const sqliteSchema: readonly SchemaSnapshotRow[] = rawSchema.map(
    ({ type, name, tbl_name: table, sql }) => ({
      type,
      name,
      table,
      sqlSha256: sql === null ? null : createHash('sha256').update(sql).digest('hex'),
    }),
  );
  const tableInventory = tableRows(database, rawSchema);
  const indexInventory = indexRows(database, tableInventory);
  const foreignKeyInventory = foreignKeyRows(database, tableInventory);
  const schemaBindings = {
    count: artifacts.schemaBindings.length,
    sha256: artifacts.schemaBindingsSha256,
  };
  const payload = {
    userVersion,
    sqliteSchema,
    tableInventory,
    indexInventory,
    foreignKeyInventory,
    schemaBindings,
  };
  return Object.freeze({
    ...payload,
    sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  });
}

export function buildCanonicalSchemaFingerprint(
  artifacts: CanonicalSchemaArtifacts,
): SchemaFingerprint {
  const database = openConfiguredDatabase(':memory:', false);
  try {
    database.exec(artifacts.ddl);
    assertDatabaseHealthy(database);
    return computeSchemaFingerprint(database, artifacts);
  } finally {
    database.close();
  }
}

export function assertCanonicalFingerprint(
  actual: SchemaFingerprint,
  canonical: SchemaFingerprint,
): void {
  if (actual.sha256 !== canonical.sha256) {
    throw new StorageError(
      'SCHEMA_DRIFT',
      `SQLite schema fingerprint ${actual.sha256} does not match canonical ${canonical.sha256}`,
    );
  }
}
