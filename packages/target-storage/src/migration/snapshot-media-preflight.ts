import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import {
  validateOrderedDeliverySequence,
  validateOrderedDeliveryVideoTarget,
  type OrderedDeliverySequenceInvalidReason,
} from './ordered-delivery-sequence.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SNAPSHOT_TABLES = [
  'canvases',
  'characters',
  'equipment',
  'locations',
  'scripts',
  'preset_overrides',
] as const;
const MEDIA_TABLES = ['canvases', 'characters', 'equipment', 'locations'] as const;

type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];
type SnapshotMediaTable = (typeof MEDIA_TABLES)[number];
type SnapshotReferenceImageTable = 'characters' | 'equipment' | 'locations';
type SnapshotMediaColumn = 'ref_image' | 'reference_images' | 'delivery_sequence_json';

export const LEGACY_SNAPSHOT_MEDIA_COVERAGE = {
  source: 'snapshots.data',
  schemaVersion: 1,
  outerTables: SNAPSHOT_TABLES,
  paths: [
    '$.characters[*].ref_image',
    '$.characters[*].reference_images::$[*].assetHash',
    '$.characters[*].reference_images::$[*].variants[*]',
    '$.equipment[*].reference_images::$[*].assetHash',
    '$.equipment[*].reference_images::$[*].variants[*]',
    '$.locations[*].reference_images::$[*].assetHash',
    '$.locations[*].reference_images::$[*].variants[*]',
    '$.canvases[*].delivery_sequence_json::$.items[*].selectedVideoHash',
  ],
  excludedPaths: [
    '$.canvases[*].negative_prompt',
    '$.canvases[*].notes',
    '$.canvases[*].resolution_policy_json',
    '$.canvases[*].style_plate',
    '$.canvases[*].viewport',
    '$.canvases[*].visual_style_policy_json',
    '$.scripts[*]',
    '$.preset_overrides[*]',
  ],
  unknownReferenceImageFields: 'ignored',
  unknownEnvelopeAndRowFields: 'blocked',
  includesEverySnapshot: true,
  liveDeliveryMirror: 'unavailable_in_snapshot',
} as const;

interface BlockerLocation {
  readonly table: 'snapshots';
  readonly column: 'schema_version' | 'data';
  readonly rowKey: string;
  readonly path: string;
}

export type LegacySnapshotMediaPreflightBlocker =
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_schema_version';
      readonly column: 'schema_version';
      readonly path: '$column.schema_version';
      readonly reason: 'not_sqlite_integer' | 'unsupported_version';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_document';
      readonly column: 'data';
      readonly path: '$';
      readonly reason:
        'null_document' | 'empty_document' | 'not_text' | 'invalid_json' | 'not_object';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_table_set';
      readonly column: 'data';
      readonly path: '$';
      readonly missingTables: readonly string[];
      readonly unexpectedTables: readonly string[];
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_table_shape';
      readonly column: 'data';
      readonly snapshotTable: SnapshotTable;
      readonly expected: 'array';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_row_shape';
      readonly column: 'data';
      readonly snapshotTable: SnapshotTable;
      readonly expected: 'object';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_row_keys';
      readonly column: 'data';
      readonly snapshotTable: SnapshotTable;
      readonly missingFields: readonly string[];
      readonly unexpectedFields: readonly string[];
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_embedded_document';
      readonly column: 'data';
      readonly snapshotTable: SnapshotReferenceImageTable;
      readonly embeddedColumn: 'reference_images';
      readonly reason: 'not_text' | 'invalid_json' | 'not_array';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_shape';
      readonly column: 'data';
      readonly snapshotTable: SnapshotReferenceImageTable;
      readonly embeddedColumn: 'ref_image' | 'reference_images';
      readonly expected: 'object' | 'array' | 'string';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_hash';
      readonly column: 'data';
      readonly snapshotTable: SnapshotReferenceImageTable;
      readonly embeddedColumn: 'ref_image' | 'reference_images';
      readonly value: string;
      readonly reason: 'not_lowercase_sha256';
    })
  | (BlockerLocation & {
      readonly kind: 'missing_snapshot_media_target';
      readonly column: 'data';
      readonly snapshotTable: SnapshotMediaTable;
      readonly embeddedColumn: SnapshotMediaColumn;
      readonly hash: string;
      readonly expectedType: 'image' | 'video';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_media_target';
      readonly column: 'data';
      readonly snapshotTable: SnapshotMediaTable;
      readonly embeddedColumn: SnapshotMediaColumn;
      readonly hash: string;
      readonly expectedType: 'image' | 'video';
      readonly reason:
        | 'not_image'
        | 'not_video'
        | 'duration_unavailable'
        | 'trim_exceeds_duration'
        | 'embedded_audio_unconfirmed';
      readonly actualType?: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_snapshot_delivery_sequence';
      readonly column: 'data';
      readonly snapshotTable: 'canvases';
      readonly embeddedColumn: 'delivery_sequence_json';
      readonly reason: OrderedDeliverySequenceInvalidReason;
      readonly actual?: string;
    });

export interface LegacySnapshotMediaSourceReport {
  readonly table: SnapshotMediaTable;
  readonly rowCount: number;
  readonly documentCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
}

export interface LegacySnapshotMediaPreflightReport {
  readonly coverage: typeof LEGACY_SNAPSHOT_MEDIA_COVERAGE;
  readonly snapshotCount: number;
  readonly snapshotDocumentCount: number;
  readonly tableOccurrenceCount: number;
  readonly rowCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly bySource: readonly LegacySnapshotMediaSourceReport[];
  readonly fingerprint: string;
  readonly blockers: readonly LegacySnapshotMediaPreflightBlocker[];
  readonly ok: boolean;
}

interface SnapshotRow {
  readonly id: unknown;
  readonly schema_version: unknown;
  readonly schema_version_type: unknown;
  readonly data: unknown;
  readonly data_type: unknown;
}

interface AssetRow {
  readonly hash: unknown;
  readonly type: unknown;
  readonly duration: unknown;
  readonly has_audio: unknown;
}

interface TargetFact {
  readonly type: unknown;
  readonly duration: unknown;
  readonly hasAudio: unknown;
}

interface MutableSourceReport {
  readonly table: SnapshotMediaTable;
  rowCount: number;
  documentCount: number;
  referenceCount: number;
  readonly hashes: Set<string>;
}

interface AuditContext {
  readonly snapshotRowKey: string;
  readonly snapshotTable: SnapshotReferenceImageTable;
  readonly source: MutableSourceReport;
  readonly targets: ReadonlyMap<string, TargetFact>;
  readonly targetFacts: Map<string, unknown>;
  readonly allHashes: Set<string>;
  readonly blockers: LegacySnapshotMediaPreflightBlocker[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueType(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Uint8Array) return 'blob';
  return typeof value;
}

function rawValueFingerprint(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      type: 'blob',
      sha256: createHash('sha256').update(value).digest('hex'),
      byteLength: value.byteLength,
    };
  }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  return { type: typeof value, value };
}

function expectedColumns(table: SnapshotTable): readonly string[] {
  const definition = I0_LEGACY_SOURCE_SCHEMAS.main.tables.find(
    (candidate) => candidate.name === table,
  );
  if (!definition) throw new Error(`Missing frozen Legacy source schema for ${table}`);
  return definition.columns;
}

const SNAPSHOT_COLUMNS = new Map(
  SNAPSHOT_TABLES.map((table) => [table, expectedColumns(table)] as const),
);

function mediaTargets(database: DatabaseSync): ReadonlyMap<string, TargetFact> {
  const targets = new Map<string, TargetFact>();
  const statement = database.prepare(
    'SELECT hash, type, duration, has_audio FROM asset_contents ORDER BY hash',
  );
  statement.setReadBigInts(true);
  for (const row of statement.iterate() as Iterable<AssetRow>) {
    if (typeof row.hash === 'string') {
      targets.set(row.hash, {
        type: row.type,
        duration: row.duration,
        hasAudio: row.has_audio,
      });
    }
  }
  return targets;
}

function recordTargetFact(
  hash: string,
  target: TargetFact | undefined,
  targetFacts: Map<string, unknown>,
): void {
  targetFacts.set(
    hash,
    target
      ? {
          hash,
          exists: true,
          type: rawValueFingerprint(target.type),
          duration: rawValueFingerprint(target.duration),
          hasAudio: rawValueFingerprint(target.hasAudio),
        }
      : { hash, exists: false },
  );
}

function auditImageHash(
  value: unknown,
  embeddedColumn: 'ref_image' | 'reference_images',
  path: string,
  context: AuditContext,
): void {
  context.source.referenceCount += 1;
  if (typeof value !== 'string') {
    context.blockers.push({
      kind: 'invalid_snapshot_media_shape',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn,
      path,
      expected: 'string',
      actual: valueType(value),
    });
    return;
  }
  if (!SHA256_PATTERN.test(value)) {
    context.blockers.push({
      kind: 'invalid_snapshot_media_hash',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn,
      path,
      value,
      reason: 'not_lowercase_sha256',
    });
    return;
  }
  context.source.hashes.add(value);
  context.allHashes.add(value);
  const target = context.targets.get(value);
  recordTargetFact(value, target, context.targetFacts);
  if (!target) {
    context.blockers.push({
      kind: 'missing_snapshot_media_target',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn,
      path,
      hash: value,
      expectedType: 'image',
    });
  } else if (target.type !== 'image') {
    context.blockers.push({
      kind: 'invalid_snapshot_media_target',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn,
      path,
      hash: value,
      expectedType: 'image',
      reason: 'not_image',
      actualType: typeof target.type === 'string' ? target.type : valueType(target.type),
    });
  }
}

function auditReferenceImages(raw: unknown, rowPath: string, context: AuditContext): void {
  if (raw === null || raw === '') return;
  context.source.documentCount += 1;
  const documentPath = `${rowPath}.reference_images`;
  if (typeof raw !== 'string') {
    context.blockers.push({
      kind: 'invalid_snapshot_embedded_document',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn: 'reference_images',
      path: `${documentPath}::$`,
      reason: 'not_text',
    });
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    context.blockers.push({
      kind: 'invalid_snapshot_embedded_document',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn: 'reference_images',
      path: `${documentPath}::$`,
      reason: 'invalid_json',
    });
    return;
  }
  if (!Array.isArray(parsed)) {
    context.blockers.push({
      kind: 'invalid_snapshot_embedded_document',
      table: 'snapshots',
      column: 'data',
      rowKey: context.snapshotRowKey,
      snapshotTable: context.snapshotTable,
      embeddedColumn: 'reference_images',
      path: `${documentPath}::$`,
      reason: 'not_array',
    });
    return;
  }
  parsed.forEach((item, index) => {
    const itemPath = `${documentPath}::$[${index}]`;
    if (!isObject(item)) {
      context.blockers.push({
        kind: 'invalid_snapshot_media_shape',
        table: 'snapshots',
        column: 'data',
        rowKey: context.snapshotRowKey,
        snapshotTable: context.snapshotTable,
        embeddedColumn: 'reference_images',
        path: itemPath,
        expected: 'object',
        actual: valueType(item),
      });
      return;
    }
    if (Object.hasOwn(item, 'assetHash')) {
      auditImageHash(item.assetHash, 'reference_images', `${itemPath}.assetHash`, context);
    }
    if (!Object.hasOwn(item, 'variants')) return;
    if (!Array.isArray(item.variants)) {
      context.blockers.push({
        kind: 'invalid_snapshot_media_shape',
        table: 'snapshots',
        column: 'data',
        rowKey: context.snapshotRowKey,
        snapshotTable: context.snapshotTable,
        embeddedColumn: 'reference_images',
        path: `${itemPath}.variants`,
        expected: 'array',
        actual: valueType(item.variants),
      });
      return;
    }
    item.variants.forEach((hash, variantIndex) =>
      auditImageHash(hash, 'reference_images', `${itemPath}.variants[${variantIndex}]`, context),
    );
  });
}

function auditReferenceImageRow(
  table: SnapshotReferenceImageTable,
  row: Record<string, unknown>,
  rowPath: string,
  rowKey: string,
  source: MutableSourceReport,
  targets: ReadonlyMap<string, TargetFact>,
  targetFacts: Map<string, unknown>,
  allHashes: Set<string>,
  blockers: LegacySnapshotMediaPreflightBlocker[],
): void {
  const context: AuditContext = {
    snapshotRowKey: rowKey,
    snapshotTable: table,
    source,
    targets,
    targetFacts,
    allHashes,
    blockers,
  };
  if (table === 'characters' && row.ref_image !== null) {
    auditImageHash(row.ref_image, 'ref_image', `${rowPath}.ref_image`, context);
  }
  auditReferenceImages(row.reference_images, rowPath, context);
}

function auditDeliveryRow(
  row: Record<string, unknown>,
  rowPath: string,
  rowKey: string,
  source: MutableSourceReport,
  targets: ReadonlyMap<string, TargetFact>,
  targetFacts: Map<string, unknown>,
  allHashes: Set<string>,
  blockers: LegacySnapshotMediaPreflightBlocker[],
): void {
  const raw = row.delivery_sequence_json;
  if (raw !== null) source.documentCount += 1;
  const validation = validateOrderedDeliverySequence(raw, row.delivery_sequence_revision);
  const documentPath = `${rowPath}.delivery_sequence_json::`;
  for (const issue of validation.issues) {
    blockers.push({
      kind: 'invalid_snapshot_delivery_sequence',
      table: 'snapshots',
      column: 'data',
      rowKey,
      snapshotTable: 'canvases',
      embeddedColumn: 'delivery_sequence_json',
      path: `${documentPath}${issue.path}`,
      reason: issue.reason,
      ...(issue.actual === undefined ? {} : { actual: issue.actual }),
    });
  }
  if (!validation.document) return;

  source.referenceCount += validation.document.items.length;
  for (const item of validation.document.items) {
    source.hashes.add(item.selectedVideoHash);
    allHashes.add(item.selectedVideoHash);
    const target = targets.get(item.selectedVideoHash);
    recordTargetFact(item.selectedVideoHash, target, targetFacts);
    for (const issue of validateOrderedDeliveryVideoTarget(item, target)) {
      const path = `${documentPath}${issue.path}`;
      if (issue.kind === 'missing') {
        blockers.push({
          kind: 'missing_snapshot_media_target',
          table: 'snapshots',
          column: 'data',
          rowKey,
          snapshotTable: 'canvases',
          embeddedColumn: 'delivery_sequence_json',
          path,
          hash: item.selectedVideoHash,
          expectedType: 'video',
        });
      } else {
        blockers.push({
          kind: 'invalid_snapshot_media_target',
          table: 'snapshots',
          column: 'data',
          rowKey,
          snapshotTable: 'canvases',
          embeddedColumn: 'delivery_sequence_json',
          path,
          hash: item.selectedVideoHash,
          expectedType: 'video',
          reason: issue.reason,
          ...(issue.reason === 'not_video'
            ? {
                actualType:
                  typeof target?.type === 'string' ? target.type : valueType(target?.type),
              }
            : {}),
        });
      }
    }
  }
}

function isSnapshotTable(value: string): value is SnapshotTable {
  return (SNAPSHOT_TABLES as readonly string[]).includes(value);
}

/**
 * Read-only audit of exact media paths inside every frozen Legacy snapshot.
 * Unknown envelope/row shapes block; lookalike fields are never traversed.
 */
export function preflightLegacySnapshotMedia(
  database: DatabaseSync,
): LegacySnapshotMediaPreflightReport {
  const targets = mediaTargets(database);
  const targetFacts = new Map<string, unknown>();
  const allHashes = new Set<string>();
  const blockers: LegacySnapshotMediaPreflightBlocker[] = [];
  const inputFingerprint = createHash('sha256');
  const bySourceMutable = MEDIA_TABLES.map((table): MutableSourceReport => ({
    table,
    rowCount: 0,
    documentCount: 0,
    referenceCount: 0,
    hashes: new Set<string>(),
  }));
  const sourceByTable = new Map(bySourceMutable.map((source) => [source.table, source] as const));
  const statement = database.prepare(
    `SELECT id,
            schema_version,
            typeof(schema_version) AS schema_version_type,
            data,
            typeof(data) AS data_type
       FROM snapshots
      ORDER BY id`,
  );
  statement.setReadBigInts(true);
  let snapshotCount = 0;
  let snapshotDocumentCount = 0;
  let tableOccurrenceCount = 0;
  let rowCount = 0;

  for (const snapshot of statement.iterate() as Iterable<SnapshotRow>) {
    snapshotCount += 1;
    const snapshotRowKey = hashCanonical({
      table: 'snapshots',
      id: rawValueFingerprint(snapshot.id),
    });
    inputFingerprint.update(
      hashCanonical({
        rowKey: snapshotRowKey,
        schemaVersion: rawValueFingerprint(snapshot.schema_version),
        schemaVersionType: rawValueFingerprint(snapshot.schema_version_type),
        data: rawValueFingerprint(snapshot.data),
        dataType: rawValueFingerprint(snapshot.data_type),
      }),
    );

    if (snapshot.schema_version_type !== 'integer') {
      blockers.push({
        kind: 'invalid_snapshot_schema_version',
        table: 'snapshots',
        column: 'schema_version',
        rowKey: snapshotRowKey,
        path: '$column.schema_version',
        reason: 'not_sqlite_integer',
        actual:
          typeof snapshot.schema_version_type === 'string'
            ? snapshot.schema_version_type
            : valueType(snapshot.schema_version_type),
      });
      continue;
    }
    const version =
      typeof snapshot.schema_version === 'bigint'
        ? snapshot.schema_version
        : typeof snapshot.schema_version === 'number' &&
            Number.isSafeInteger(snapshot.schema_version)
          ? BigInt(snapshot.schema_version)
          : null;
    if (version !== 1n) {
      blockers.push({
        kind: 'invalid_snapshot_schema_version',
        table: 'snapshots',
        column: 'schema_version',
        rowKey: snapshotRowKey,
        path: '$column.schema_version',
        reason: 'unsupported_version',
        actual: version === null ? valueType(snapshot.schema_version) : version.toString(),
      });
      continue;
    }

    if (snapshot.data !== null) snapshotDocumentCount += 1;
    if (snapshot.data === null) {
      blockers.push({
        kind: 'invalid_snapshot_media_document',
        table: 'snapshots',
        column: 'data',
        rowKey: snapshotRowKey,
        path: '$',
        reason: 'null_document',
      });
      continue;
    }
    if (snapshot.data_type !== 'text' || typeof snapshot.data !== 'string') {
      blockers.push({
        kind: 'invalid_snapshot_media_document',
        table: 'snapshots',
        column: 'data',
        rowKey: snapshotRowKey,
        path: '$',
        reason: 'not_text',
      });
      continue;
    }
    if (snapshot.data.length === 0) {
      blockers.push({
        kind: 'invalid_snapshot_media_document',
        table: 'snapshots',
        column: 'data',
        rowKey: snapshotRowKey,
        path: '$',
        reason: 'empty_document',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(snapshot.data);
    } catch {
      blockers.push({
        kind: 'invalid_snapshot_media_document',
        table: 'snapshots',
        column: 'data',
        rowKey: snapshotRowKey,
        path: '$',
        reason: 'invalid_json',
      });
      continue;
    }
    if (!isObject(parsed)) {
      blockers.push({
        kind: 'invalid_snapshot_media_document',
        table: 'snapshots',
        column: 'data',
        rowKey: snapshotRowKey,
        path: '$',
        reason: 'not_object',
      });
      continue;
    }

    const actualTables = Object.keys(parsed).sort();
    const missingTables = SNAPSHOT_TABLES.filter((table) => !Object.hasOwn(parsed, table));
    const unexpectedTables = actualTables.filter((table) => !isSnapshotTable(table));
    if (missingTables.length > 0 || unexpectedTables.length > 0) {
      blockers.push({
        kind: 'invalid_snapshot_media_table_set',
        table: 'snapshots',
        column: 'data',
        rowKey: snapshotRowKey,
        path: '$',
        missingTables,
        unexpectedTables,
      });
      continue;
    }

    for (const table of SNAPSHOT_TABLES) {
      tableOccurrenceCount += 1;
      const rows = parsed[table];
      if (!Array.isArray(rows)) {
        blockers.push({
          kind: 'invalid_snapshot_media_table_shape',
          table: 'snapshots',
          column: 'data',
          rowKey: snapshotRowKey,
          snapshotTable: table,
          path: `$.${table}`,
          expected: 'array',
          actual: valueType(rows),
        });
        continue;
      }
      const source = sourceByTable.get(table as SnapshotMediaTable);
      rows.forEach((row, index) => {
        rowCount += 1;
        if (source) source.rowCount += 1;
        const rowPath = `$.${table}[${index}]`;
        if (!isObject(row)) {
          blockers.push({
            kind: 'invalid_snapshot_media_row_shape',
            table: 'snapshots',
            column: 'data',
            rowKey: snapshotRowKey,
            snapshotTable: table,
            path: rowPath,
            expected: 'object',
            actual: valueType(row),
          });
          return;
        }
        const columns = SNAPSHOT_COLUMNS.get(table);
        if (!columns) throw new Error(`Missing frozen Snapshot columns for ${table}`);
        const missingFields = columns.filter((column) => !Object.hasOwn(row, column));
        const allowedFields = new Set(columns);
        const unexpectedFields = Object.keys(row)
          .filter((column) => !allowedFields.has(column))
          .sort();
        if (missingFields.length > 0 || unexpectedFields.length > 0) {
          blockers.push({
            kind: 'invalid_snapshot_media_row_keys',
            table: 'snapshots',
            column: 'data',
            rowKey: snapshotRowKey,
            snapshotTable: table,
            path: rowPath,
            missingFields,
            unexpectedFields,
          });
          return;
        }
        const nestedRowKey = hashCanonical({
          snapshotRowKey,
          snapshotTable: table,
          rowIndex: index,
          id: rawValueFingerprint(row.id),
        });
        if (table === 'canvases' && source) {
          auditDeliveryRow(
            row,
            rowPath,
            nestedRowKey,
            source,
            targets,
            targetFacts,
            allHashes,
            blockers,
          );
        } else if (
          (table === 'characters' || table === 'equipment' || table === 'locations') &&
          source
        ) {
          auditReferenceImageRow(
            table,
            row,
            rowPath,
            nestedRowKey,
            source,
            targets,
            targetFacts,
            allHashes,
            blockers,
          );
        }
      });
    }
  }

  const bySource = bySourceMutable.map((source): LegacySnapshotMediaSourceReport => ({
    table: source.table,
    rowCount: source.rowCount,
    documentCount: source.documentCount,
    referenceCount: source.referenceCount,
    distinctHashCount: source.hashes.size,
  }));
  const referenceCount = bySource.reduce((total, source) => total + source.referenceCount, 0);
  return {
    coverage: LEGACY_SNAPSHOT_MEDIA_COVERAGE,
    snapshotCount,
    snapshotDocumentCount,
    tableOccurrenceCount,
    rowCount,
    referenceCount,
    distinctHashCount: allHashes.size,
    bySource,
    fingerprint: hashCanonical({
      coverage: LEGACY_SNAPSHOT_MEDIA_COVERAGE,
      inputFingerprint: inputFingerprint.digest('hex'),
      targetFacts: [...targetFacts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      snapshotCount,
      snapshotDocumentCount,
      tableOccurrenceCount,
      rowCount,
      referenceCount,
      distinctHashCount: allHashes.size,
      bySource,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
