import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

export interface LegacySourceTableDefinition {
  readonly name: string;
  readonly kind: 'table' | 'virtual';
  readonly columns: readonly string[];
}

/**
 * The caller owns this inventory. It must be frozen from the Legacy schema
 * accepted by the corresponding one-way transform.
 */
export interface LegacySourceExpectedSchema {
  readonly tables: readonly LegacySourceTableDefinition[];
}

export interface LegacySourceExpectedSchemas {
  readonly main: LegacySourceExpectedSchema;
  readonly prompts: LegacySourceExpectedSchema;
}

export interface LegacySourceDatabases {
  readonly main: DatabaseSync;
  readonly prompts: DatabaseSync;
}

export type LegacySourcePreflightBlocker =
  | { readonly kind: 'integrity_check_failed'; readonly messages: readonly string[] }
  | ({ readonly kind: 'foreign_key_violation' } & LegacySourceForeignKeyViolation)
  | { readonly kind: 'missing_table'; readonly table: string }
  | { readonly kind: 'unknown_table'; readonly table: string }
  | {
      readonly kind: 'unexpected_table_kind';
      readonly table: string;
      readonly expected: LegacySourceTableDefinition['kind'];
      readonly actual: LegacySourceTableDefinition['kind'];
    }
  | { readonly kind: 'missing_column'; readonly table: string; readonly column: string }
  | { readonly kind: 'unknown_column'; readonly table: string; readonly column: string };

export interface LegacySourceTableFingerprint {
  readonly name: string;
  readonly kind: 'table' | 'virtual';
  readonly columns: readonly string[];
  readonly rowCount: number;
  readonly contentFingerprint: string;
}

export interface LegacySourceForeignKeyViolation {
  readonly table: string;
  readonly rowId: string | null;
  readonly parentTable: string;
  readonly foreignKeyId: number;
}

export interface LegacySourcePreflightReport {
  readonly integrity: Readonly<{
    ok: boolean;
    messages: readonly string[];
  }>;
  readonly foreignKeys: Readonly<{
    ok: boolean;
    violations: readonly LegacySourceForeignKeyViolation[];
  }>;
  readonly schemaFingerprint: string;
  readonly contentFingerprint: string;
  readonly tables: readonly LegacySourceTableFingerprint[];
  readonly blockers: readonly LegacySourcePreflightBlocker[];
  readonly ok: boolean;
}

export interface LegacySourceDatabasePreflightReport {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly report: LegacySourcePreflightReport;
}

export interface LegacySourceDatabasePreflightBlocker {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly blocker: LegacySourcePreflightBlocker;
}

export interface LegacySourcesPreflightReport {
  readonly databases: readonly LegacySourceDatabasePreflightReport[];
  readonly schemaFingerprint: string;
  readonly contentFingerprint: string;
  readonly blockers: readonly LegacySourceDatabasePreflightBlocker[];
  readonly ok: boolean;
}

interface TableListRow {
  readonly name: string;
  readonly schema: string;
  readonly type: string;
}

interface TableInfoRow {
  readonly name: string;
}

interface IntegrityRow {
  readonly integrity_check: string;
}

interface ForeignKeyCheckRow {
  readonly table: string;
  readonly rowid: bigint | null;
  readonly parent: string;
  readonly fkid: bigint;
}

type FingerprintValue =
  | null
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'number'; value: number }>
  | Readonly<{ type: 'integer'; value: string }>
  | Readonly<{ type: 'blob'; sha256: string; byteLength: number }>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNullableBigInt(left: bigint | null, right: bigint | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left < right ? -1 : 1;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizedExpectedSchema(
  expected: LegacySourceExpectedSchema,
): ReadonlyMap<string, Omit<LegacySourceTableDefinition, 'name'>> {
  const normalized = new Map<string, Omit<LegacySourceTableDefinition, 'name'>>();
  for (const table of expected.tables) {
    if (!table.name) throw new TypeError('Expected Legacy table name must not be empty');
    if (normalized.has(table.name)) {
      throw new TypeError(`Expected Legacy table is duplicated: ${table.name}`);
    }
    if (table.kind !== 'table' && table.kind !== 'virtual') {
      throw new TypeError(`Expected Legacy table kind is invalid for ${table.name}`);
    }
    const columns = [...table.columns].sort(compareText);
    if (
      columns.length === 0 ||
      columns.some((column) => !column) ||
      new Set(columns).size !== columns.length
    ) {
      throw new TypeError(`Expected Legacy columns are invalid for ${table.name}`);
    }
    normalized.set(table.name, { kind: table.kind, columns });
  }
  return new Map([...normalized.entries()].sort(([left], [right]) => compareText(left, right)));
}

function sourceTables(database: DatabaseSync): Array<{ name: string; kind: 'table' | 'virtual' }> {
  // `table_list` labels FTS backing tables as `shadow`; they are SQLite-owned,
  // so only the declared virtual table participates in the source inventory.
  return (database.prepare('PRAGMA table_list').all() as unknown as TableListRow[])
    .filter(
      (row) =>
        row.schema === 'main' &&
        (row.type === 'table' || row.type === 'virtual') &&
        !row.name.startsWith('sqlite_'),
    )
    .map((row) => ({ name: row.name, kind: row.type as 'table' | 'virtual' }))
    .sort((left, right) => compareText(left.name, right.name));
}

function sourceColumns(database: DatabaseSync, table: string): readonly string[] {
  return (
    database
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all() as unknown as TableInfoRow[]
  )
    .map((row) => row.name)
    .sort(compareText);
}

function fingerprintValue(value: unknown): FingerprintValue {
  if (value === null) return null;
  if (typeof value === 'string') return { type: 'text', value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Legacy SQLite value is not finite');
    return { type: 'number', value };
  }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  if (value instanceof Uint8Array) {
    return {
      type: 'blob',
      sha256: createHash('sha256').update(value).digest('hex'),
      byteLength: value.byteLength,
    };
  }
  throw new TypeError(`Unsupported Legacy SQLite value: ${typeof value}`);
}

function tableFingerprint(
  database: DatabaseSync,
  table: { name: string; kind: 'table' | 'virtual' },
): LegacySourceTableFingerprint {
  const columns = sourceColumns(database, table.name);
  const quotedColumns = columns.map(quoteIdentifier).join(', ');
  const statement = database.prepare(
    `SELECT ${quotedColumns} FROM ${quoteIdentifier(table.name)} ORDER BY ${quotedColumns}`,
  );
  statement.setReadBigInts(true);
  const rows = statement.iterate() as Iterable<Record<string, unknown>>;
  const contentHash = createHash('sha256');
  let rowCount = 0;
  for (const row of rows) {
    contentHash.update(hashCanonical(columns.map((column) => fingerprintValue(row[column]))));
    rowCount += 1;
  }
  return {
    name: table.name,
    kind: table.kind,
    columns,
    rowCount,
    contentFingerprint: contentHash.digest('hex'),
  };
}

function integrity(database: DatabaseSync): LegacySourcePreflightReport['integrity'] {
  const messages = (database.prepare('PRAGMA integrity_check').all() as unknown as IntegrityRow[])
    .map((row) => row.integrity_check)
    .sort(compareText);
  return { ok: messages.length === 1 && messages[0] === 'ok', messages };
}

function foreignKeys(database: DatabaseSync): LegacySourcePreflightReport['foreignKeys'] {
  const statement = database.prepare('PRAGMA foreign_key_check');
  statement.setReadBigInts(true);
  const rows = statement.all() as unknown as ForeignKeyCheckRow[];
  rows.sort(
    (left, right) =>
      compareText(left.table, right.table) ||
      compareNullableBigInt(left.rowid, right.rowid) ||
      compareText(left.parent, right.parent) ||
      (left.fkid < right.fkid ? -1 : left.fkid > right.fkid ? 1 : 0),
  );
  const violations = rows.map((row): LegacySourceForeignKeyViolation => ({
    table: row.table,
    rowId: row.rowid?.toString() ?? null,
    parentTable: row.parent,
    foreignKeyId: Number(row.fkid),
  }));
  return { ok: violations.length === 0, violations };
}

/**
 * Read-only Legacy SQLite inspection. The caller opens the source handle in
 * read-only mode; this function only issues PRAGMA and SELECT statements.
 */
export function preflightLegacySource(
  database: DatabaseSync,
  expected: LegacySourceExpectedSchema,
): LegacySourcePreflightReport {
  const expectedTables = normalizedExpectedSchema(expected);
  const tables = sourceTables(database).map((table) => tableFingerprint(database, table));
  const actualTables = new Map(tables.map((table) => [table.name, table]));
  const integrityResult = integrity(database);
  const foreignKeyResult = foreignKeys(database);
  const blockers: LegacySourcePreflightBlocker[] = [];

  if (!integrityResult.ok) {
    blockers.push({ kind: 'integrity_check_failed', messages: integrityResult.messages });
  }
  blockers.push(
    ...foreignKeyResult.violations.map((violation) => ({
      kind: 'foreign_key_violation' as const,
      ...violation,
    })),
  );
  for (const table of expectedTables.keys()) {
    if (!actualTables.has(table)) blockers.push({ kind: 'missing_table', table });
  }
  for (const table of actualTables.keys()) {
    if (!expectedTables.has(table)) blockers.push({ kind: 'unknown_table', table });
  }
  for (const [table, expectedTable] of expectedTables) {
    const actual = actualTables.get(table);
    if (!actual) continue;
    if (actual.kind !== expectedTable.kind) {
      blockers.push({
        kind: 'unexpected_table_kind',
        table,
        expected: expectedTable.kind,
        actual: actual.kind,
      });
    }
    const expectedColumns = expectedTable.columns;
    const actualColumns = new Set(actual.columns);
    for (const column of expectedColumns) {
      if (!actualColumns.has(column)) blockers.push({ kind: 'missing_column', table, column });
    }
    const expectedColumnSet = new Set(expectedColumns);
    for (const column of actual.columns) {
      if (!expectedColumnSet.has(column)) blockers.push({ kind: 'unknown_column', table, column });
    }
  }

  return {
    integrity: integrityResult,
    foreignKeys: foreignKeyResult,
    schemaFingerprint: hashCanonical(
      tables.map(({ name, kind, columns }) => ({ name, kind, columns })),
    ),
    contentFingerprint: hashCanonical(
      tables.map(({ name, kind, rowCount, contentFingerprint }) => ({
        name,
        kind,
        rowCount,
        contentFingerprint,
      })),
    ),
    tables,
    blockers,
    ok: blockers.length === 0,
  };
}

export function preflightLegacySources(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
): LegacySourcesPreflightReport {
  const reports: LegacySourceDatabasePreflightReport[] = (['main', 'prompts'] as const).map(
    (database) => ({
      database,
      report: preflightLegacySource(databases[database], expected[database]),
    }),
  );
  const blockers = reports.flatMap(({ database, report }) =>
    report.blockers.map((blocker) => ({ database, blocker })),
  );

  return {
    databases: reports,
    schemaFingerprint: hashCanonical(
      reports.map(({ database, report }) => ({
        database,
        schemaFingerprint: report.schemaFingerprint,
      })),
    ),
    contentFingerprint: hashCanonical(
      reports.map(({ database, report }) => ({
        database,
        contentFingerprint: report.contentFingerprint,
      })),
    ),
    blockers,
    ok: blockers.length === 0,
  };
}
