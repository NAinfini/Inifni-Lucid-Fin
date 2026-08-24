import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';
import type { LegacyClassificationSubject } from './classification-report.js';
import type {
  LegacySourceDatabases,
  LegacySourceExpectedSchema,
  LegacySourceExpectedSchemas,
  LegacySourceTableDefinition,
} from './source-preflight.js';

export interface LegacyClassificationSubjectSourceReport {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly table: string;
  readonly kind: LegacySourceTableDefinition['kind'];
  readonly columns: readonly string[];
  readonly rowCount: number;
  readonly contentFingerprint: string;
  readonly sourceContentFingerprint: string;
}

export interface LegacyClassificationSubjectInventory {
  readonly databaseCount: 2;
  readonly sourceCount: number;
  readonly rowCount: number;
  readonly sourceContentFingerprint: string;
  readonly bySource: readonly LegacyClassificationSubjectSourceReport[];
  readonly subjects: readonly LegacyClassificationSubject[];
  readonly fingerprint: string;
}

export interface LegacyClassificationRow {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly table: string;
  readonly kind: LegacySourceTableDefinition['kind'];
  readonly columns: readonly string[];
  readonly subject: LegacyClassificationSubject;
  readonly values: Readonly<Record<string, unknown>>;
}

export type LegacyClassificationRowVisitor = (row: LegacyClassificationRow) => void;

type FingerprintValue =
  | null
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'number'; value: number }>
  | Readonly<{ type: 'integer'; value: string }>
  | Readonly<{ type: 'blob'; sha256: string; byteLength: number }>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
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

function normalizedTables(
  expected: LegacySourceExpectedSchema,
): readonly LegacySourceTableDefinition[] {
  const names = new Set<string>();
  return [...expected.tables]
    .map((table): LegacySourceTableDefinition => {
      if (!table.name || names.has(table.name)) {
        throw new TypeError(`Invalid or duplicate Legacy source table: ${table.name}`);
      }
      names.add(table.name);
      const columns = [...table.columns].sort(compareText);
      if (
        columns.length === 0 ||
        columns.some((column) => !column) ||
        new Set(columns).size !== columns.length
      ) {
        throw new TypeError(`Invalid Legacy source columns for ${table.name}`);
      }
      return { name: table.name, kind: table.kind, columns };
    })
    .sort((left, right) => compareText(left.name, right.name));
}

function enumerateSource(
  databaseName: keyof LegacySourceExpectedSchemas,
  database: DatabaseSync,
  table: LegacySourceTableDefinition,
  visit: LegacyClassificationRowVisitor | undefined,
): {
  readonly report: LegacyClassificationSubjectSourceReport;
  readonly subjects: readonly LegacyClassificationSubject[];
} {
  const quotedColumns = table.columns.map(quoteIdentifier).join(', ');
  const statement = database.prepare(
    `SELECT ${quotedColumns} FROM ${quoteIdentifier(table.name)} ORDER BY ${quotedColumns}`,
  );
  statement.setReadBigInts(true);
  const duplicateOrdinals = new Map<string, number>();
  const rowFingerprints: string[] = [];
  const sourceContentHash = createHash('sha256');
  const subjects: LegacyClassificationSubject[] = [];

  for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
    const rowFingerprint = hashCanonical(
      table.columns.map((column) => fingerprintValue(row[column])),
    );
    const duplicateOrdinal = duplicateOrdinals.get(rowFingerprint) ?? 0;
    duplicateOrdinals.set(rowFingerprint, duplicateOrdinal + 1);
    rowFingerprints.push(rowFingerprint);
    sourceContentHash.update(rowFingerprint);
    const subject: LegacyClassificationSubject = {
      database: databaseName,
      table: table.name,
      rowKey: hashCanonical({
        database: databaseName,
        table: table.name,
        rowFingerprint,
        duplicateOrdinal,
      }),
      path: '$',
    };
    subjects.push(subject);
    visit?.({
      database: databaseName,
      table: table.name,
      kind: table.kind,
      columns: table.columns,
      subject,
      values: row,
    });
  }

  return {
    report: {
      database: databaseName,
      table: table.name,
      kind: table.kind,
      columns: table.columns,
      rowCount: subjects.length,
      contentFingerprint: hashCanonical({
        database: databaseName,
        table: table.name,
        kind: table.kind,
        columns: table.columns,
        rowFingerprints,
      }),
      sourceContentFingerprint: sourceContentHash.digest('hex'),
    },
    subjects,
  };
}

/**
 * Enumerates one opaque root subject for every row in the frozen Legacy
 * schema. Embedded JSON subject enumerators extend this inventory later.
 */
function enumerateLegacyRows(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  visit: LegacyClassificationRowVisitor | undefined,
): LegacyClassificationSubjectInventory {
  const bySource: LegacyClassificationSubjectSourceReport[] = [];
  const subjects: LegacyClassificationSubject[] = [];
  for (const databaseName of ['main', 'prompts'] as const) {
    for (const table of normalizedTables(expected[databaseName])) {
      const result = enumerateSource(databaseName, databases[databaseName], table, visit);
      bySource.push(result.report);
      subjects.push(...result.subjects);
    }
  }
  const sourceContentFingerprint = hashCanonical(
    (['main', 'prompts'] as const).map((database) => ({
      database,
      contentFingerprint: hashCanonical(
        bySource
          .filter((source) => source.database === database)
          .map(({ table, kind, rowCount, sourceContentFingerprint }) => ({
            name: table,
            kind,
            rowCount,
            contentFingerprint: sourceContentFingerprint,
          })),
      ),
    })),
  );
  return {
    databaseCount: 2,
    sourceCount: bySource.length,
    rowCount: subjects.length,
    sourceContentFingerprint,
    bySource,
    subjects,
    fingerprint: hashCanonical({ sourceContentFingerprint, bySource, subjects }),
  };
}

/**
 * Visits raw source values synchronously for classification without including
 * them in the returned inventory. Visitors must not persist or report them.
 */
export function scanLegacyRowsForClassification(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  visit: LegacyClassificationRowVisitor,
): LegacyClassificationSubjectInventory {
  return enumerateLegacyRows(databases, expected, visit);
}

/** Enumerates opaque subjects without exposing source values to the caller. */
export function enumerateLegacyRowClassificationSubjects(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
): LegacyClassificationSubjectInventory {
  return enumerateLegacyRows(databases, expected, undefined);
}
