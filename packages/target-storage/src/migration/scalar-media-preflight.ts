import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface ScalarMediaReferenceSource {
  readonly table: string;
  readonly column: string;
  readonly identityColumns: readonly string[];
  readonly nullable: boolean;
  readonly foreignKey: boolean;
  readonly discriminatorColumn?: string;
}

const SCALAR_MEDIA_REFERENCE_SOURCES: readonly ScalarMediaReferenceSource[] = [
  {
    table: 'asset_entries',
    column: 'asset_hash',
    identityColumns: ['id'],
    nullable: false,
    foreignKey: true,
  },
  {
    table: 'delivery_asset_refs',
    column: 'asset_hash',
    identityColumns: ['canvas_id', 'asset_hash'],
    nullable: false,
    foreignKey: true,
  },
  {
    table: 'commander_run_attachments',
    column: 'content_hash',
    identityColumns: ['run_id', 'ordinal'],
    nullable: false,
    foreignKey: true,
  },
  {
    table: 'task_artifacts',
    column: 'asset_hash',
    identityColumns: ['id'],
    nullable: true,
    foreignKey: false,
    discriminatorColumn: 'artifact_type',
  },
  {
    table: 'task_attempts',
    column: 'asset_hash',
    identityColumns: ['id'],
    nullable: true,
    foreignKey: false,
    discriminatorColumn: 'kind',
  },
  {
    table: 'task_evaluations',
    column: 'asset_hash',
    identityColumns: ['id'],
    nullable: false,
    foreignKey: false,
    discriminatorColumn: 'media_type',
  },
  {
    table: 'prompt_assemblies',
    column: 'source_asset_hash',
    identityColumns: ['id'],
    nullable: true,
    foreignKey: false,
  },
  {
    table: 'characters',
    column: 'ref_image',
    identityColumns: ['id'],
    nullable: true,
    foreignKey: false,
  },
  {
    table: 'color_styles',
    column: 'source_asset',
    identityColumns: ['id'],
    nullable: true,
    foreignKey: false,
  },
];

type FingerprintValue =
  | null
  | Readonly<{ type: 'text'; value: string }>
  | Readonly<{ type: 'number'; value: number }>
  | Readonly<{ type: 'integer'; value: string }>
  | Readonly<{ type: 'blob'; sha256: string; byteLength: number }>;

export type LegacyScalarMediaReferenceBlocker =
  | {
      readonly kind: 'invalid_media_reference_hash';
      readonly table: string;
      readonly column: string;
      readonly rowKey: string;
      readonly value: string | null;
      readonly reason: 'not_text' | 'not_lowercase_sha256';
      readonly discriminator?: string;
    }
  | {
      readonly kind: 'missing_media_reference_target';
      readonly table: string;
      readonly column: string;
      readonly rowKey: string;
      readonly hash: string;
      readonly discriminator?: string;
    };

export interface LegacyScalarMediaReferenceSourceReport {
  readonly table: string;
  readonly column: string;
  readonly nullable: boolean;
  readonly foreignKey: boolean;
  readonly discriminatorColumn?: string;
  readonly occurrenceCount: number;
  readonly distinctHashCount: number;
  readonly fingerprint: string;
}

export interface LegacyScalarMediaPreflightReport {
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly bySource: readonly LegacyScalarMediaReferenceSourceReport[];
  readonly fingerprint: string;
  readonly blockers: readonly LegacyScalarMediaReferenceBlocker[];
  readonly ok: boolean;
}

interface ReferenceRow {
  readonly reference_value: unknown;
  readonly discriminator_value?: unknown;
  readonly [column: `identity_${number}`]: unknown;
}

interface AssetHashRow {
  readonly hash: unknown;
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

function rowKey(source: ScalarMediaReferenceSource, row: ReferenceRow): string {
  return hashCanonical({
    table: source.table,
    identity: source.identityColumns.map((_, index) => fingerprintValue(row[`identity_${index}`])),
  });
}

function discriminator(row: ReferenceRow): string | undefined {
  return typeof row.discriminator_value === 'string' ? row.discriminator_value : undefined;
}

function referenceRows(
  database: DatabaseSync,
  source: ScalarMediaReferenceSource,
): Iterable<ReferenceRow> {
  const identities = source.identityColumns.map(
    (column, index) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`identity_${index}`)}`,
  );
  const columns = [
    ...identities,
    `${quoteIdentifier(source.column)} AS reference_value`,
    ...(source.discriminatorColumn
      ? [`${quoteIdentifier(source.discriminatorColumn)} AS discriminator_value`]
      : []),
  ];
  const order = source.identityColumns.map(quoteIdentifier).join(', ');
  const statement = database.prepare(
    `SELECT ${columns.join(', ')} FROM ${quoteIdentifier(source.table)} ` +
      `WHERE ${quoteIdentifier(source.column)} IS NOT NULL ORDER BY ${order}`,
  );
  statement.setReadBigInts(true);
  return statement.iterate() as Iterable<ReferenceRow>;
}

function mediaTargets(database: DatabaseSync): ReadonlySet<string> {
  const targets = new Set<string>();
  const rows = database
    .prepare('SELECT hash FROM asset_contents ORDER BY hash')
    .iterate() as Iterable<AssetHashRow>;
  for (const row of rows) {
    if (typeof row.hash === 'string') targets.add(row.hash);
  }
  return targets;
}

/**
 * Audits every explicit scalar Legacy media reference. Schema and CAS byte
 * preflights are prerequisites; JSON-embedded references belong to M0.4b.
 */
export function preflightLegacyScalarMediaReferences(
  database: DatabaseSync,
): LegacyScalarMediaPreflightReport {
  const targets = mediaTargets(database);
  const blockers: LegacyScalarMediaReferenceBlocker[] = [];
  const allHashes = new Set<string>();
  let referenceCount = 0;

  const bySource = SCALAR_MEDIA_REFERENCE_SOURCES.map(
    (source): LegacyScalarMediaReferenceSourceReport => {
      const hashes = new Set<string>();
      const sourceHash = createHash('sha256');
      let occurrenceCount = 0;

      for (const row of referenceRows(database, source)) {
        const key = rowKey(source, row);
        const context = discriminator(row);
        const reference = row.reference_value;
        occurrenceCount += 1;
        referenceCount += 1;
        sourceHash.update(
          hashCanonical({
            rowKey: key,
            reference: fingerprintValue(reference),
            discriminator: fingerprintValue(row.discriminator_value ?? null),
          }),
        );

        if (typeof reference !== 'string' || !SHA256_PATTERN.test(reference)) {
          blockers.push({
            kind: 'invalid_media_reference_hash',
            table: source.table,
            column: source.column,
            rowKey: key,
            value: typeof reference === 'string' ? reference : null,
            reason: typeof reference === 'string' ? 'not_lowercase_sha256' : 'not_text',
            ...(context === undefined ? {} : { discriminator: context }),
          });
          continue;
        }

        hashes.add(reference);
        allHashes.add(reference);
        if (!targets.has(reference)) {
          blockers.push({
            kind: 'missing_media_reference_target',
            table: source.table,
            column: source.column,
            rowKey: key,
            hash: reference,
            ...(context === undefined ? {} : { discriminator: context }),
          });
        }
      }

      return {
        table: source.table,
        column: source.column,
        nullable: source.nullable,
        foreignKey: source.foreignKey,
        ...(source.discriminatorColumn === undefined
          ? {}
          : { discriminatorColumn: source.discriminatorColumn }),
        occurrenceCount,
        distinctHashCount: hashes.size,
        fingerprint: sourceHash.digest('hex'),
      };
    },
  );

  return {
    referenceCount,
    distinctHashCount: allHashes.size,
    bySource,
    fingerprint: hashCanonical({ bySource, blockers }),
    blockers,
    ok: blockers.length === 0,
  };
}
