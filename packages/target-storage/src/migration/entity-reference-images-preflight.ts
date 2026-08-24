import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REFERENCE_PATHS = ['$[*].assetHash', '$[*].variants[*]'] as const;
const ENTITY_REFERENCE_SOURCES = ['characters', 'equipment', 'locations'] as const;

type EntityReferenceTable = (typeof ENTITY_REFERENCE_SOURCES)[number];
type EntityReferenceLifecycle = 'active' | 'soft_deleted';

export const LEGACY_ENTITY_REFERENCE_IMAGE_COVERAGE = ENTITY_REFERENCE_SOURCES.map((table) => ({
  source: `${table}.reference_images` as const,
  paths: REFERENCE_PATHS,
}));

export type LegacyEntityReferenceImagesPreflightBlocker =
  | {
      readonly kind: 'invalid_entity_reference_images_document';
      readonly table: EntityReferenceTable;
      readonly column: 'reference_images';
      readonly lifecycle: EntityReferenceLifecycle;
      readonly rowKey: string;
      readonly path: '$';
      readonly reason: 'not_text' | 'invalid_json' | 'not_array';
    }
  | {
      readonly kind: 'invalid_entity_reference_images_shape';
      readonly table: EntityReferenceTable;
      readonly column: 'reference_images';
      readonly lifecycle: EntityReferenceLifecycle;
      readonly rowKey: string;
      readonly path: string;
      readonly expected: 'object' | 'array' | 'string';
      readonly actual: string;
    }
  | {
      readonly kind: 'invalid_entity_reference_image_hash';
      readonly table: EntityReferenceTable;
      readonly column: 'reference_images';
      readonly lifecycle: EntityReferenceLifecycle;
      readonly rowKey: string;
      readonly path: string;
      readonly value: string;
      readonly reason: 'not_lowercase_sha256';
    }
  | {
      readonly kind: 'missing_entity_reference_image_target';
      readonly table: EntityReferenceTable;
      readonly column: 'reference_images';
      readonly lifecycle: EntityReferenceLifecycle;
      readonly rowKey: string;
      readonly path: string;
      readonly hash: string;
    };

export interface LegacyEntityReferenceLifecycleReport {
  readonly rowCount: number;
  readonly documentCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly nullValueCount: number;
  readonly emptyValueCount: number;
}

export interface LegacyEntityReferenceSourceReport {
  readonly table: EntityReferenceTable;
  readonly column: 'reference_images';
  readonly active: LegacyEntityReferenceLifecycleReport;
  readonly softDeleted: LegacyEntityReferenceLifecycleReport;
  readonly fingerprint: string;
}

export interface LegacyEntityReferenceImagesPreflightReport {
  readonly coverage: typeof LEGACY_ENTITY_REFERENCE_IMAGE_COVERAGE;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly bySource: readonly LegacyEntityReferenceSourceReport[];
  readonly fingerprint: string;
  readonly blockers: readonly LegacyEntityReferenceImagesPreflightBlocker[];
  readonly ok: boolean;
}

interface EntityReferenceRow {
  readonly id: unknown;
  readonly deleted_at: unknown;
  readonly reference_images: unknown;
}

interface AssetHashRow {
  readonly hash: unknown;
}

interface MutableLifecycleReport {
  rowCount: number;
  documentCount: number;
  referenceCount: number;
  nullValueCount: number;
  emptyValueCount: number;
  readonly hashes: Set<string>;
}

interface AuditContext {
  readonly table: EntityReferenceTable;
  readonly lifecycle: EntityReferenceLifecycle;
  readonly rowKey: string;
  readonly targets: ReadonlySet<string>;
  readonly allHashes: Set<string>;
  readonly lifecycleReport: MutableLifecycleReport;
  readonly blockers: LegacyEntityReferenceImagesPreflightBlocker[];
}

function emptyLifecycleReport(): MutableLifecycleReport {
  return {
    rowCount: 0,
    documentCount: 0,
    referenceCount: 0,
    nullValueCount: 0,
    emptyValueCount: 0,
    hashes: new Set<string>(),
  };
}

function reportLifecycle(value: MutableLifecycleReport): LegacyEntityReferenceLifecycleReport {
  return {
    rowCount: value.rowCount,
    documentCount: value.documentCount,
    referenceCount: value.referenceCount,
    distinctHashCount: value.hashes.size,
    nullValueCount: value.nullValueCount,
    emptyValueCount: value.emptyValueCount,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueType(value: unknown): string {
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

function auditHash(value: unknown, path: string, context: AuditContext): void {
  context.lifecycleReport.referenceCount += 1;
  if (typeof value !== 'string') {
    context.blockers.push({
      kind: 'invalid_entity_reference_images_shape',
      table: context.table,
      column: 'reference_images',
      lifecycle: context.lifecycle,
      rowKey: context.rowKey,
      path,
      expected: 'string',
      actual: valueType(value),
    });
    return;
  }
  if (!SHA256_PATTERN.test(value)) {
    context.blockers.push({
      kind: 'invalid_entity_reference_image_hash',
      table: context.table,
      column: 'reference_images',
      lifecycle: context.lifecycle,
      rowKey: context.rowKey,
      path,
      value,
      reason: 'not_lowercase_sha256',
    });
    return;
  }
  context.lifecycleReport.hashes.add(value);
  context.allHashes.add(value);
  if (!context.targets.has(value)) {
    context.blockers.push({
      kind: 'missing_entity_reference_image_target',
      table: context.table,
      column: 'reference_images',
      lifecycle: context.lifecycle,
      rowKey: context.rowKey,
      path,
      hash: value,
    });
  }
}

function auditDocument(value: readonly unknown[], context: AuditContext): void {
  value.forEach((item, index) => {
    const itemPath = `$[${index}]`;
    if (!isObject(item)) {
      context.blockers.push({
        kind: 'invalid_entity_reference_images_shape',
        table: context.table,
        column: 'reference_images',
        lifecycle: context.lifecycle,
        rowKey: context.rowKey,
        path: itemPath,
        expected: 'object',
        actual: valueType(item),
      });
      return;
    }
    if (Object.hasOwn(item, 'assetHash')) {
      auditHash(item.assetHash, `${itemPath}.assetHash`, context);
    }
    if (!Object.hasOwn(item, 'variants')) return;
    if (!Array.isArray(item.variants)) {
      context.blockers.push({
        kind: 'invalid_entity_reference_images_shape',
        table: context.table,
        column: 'reference_images',
        lifecycle: context.lifecycle,
        rowKey: context.rowKey,
        path: `${itemPath}.variants`,
        expected: 'array',
        actual: valueType(item.variants),
      });
      return;
    }
    item.variants.forEach((hash, variantIndex) =>
      auditHash(hash, `${itemPath}.variants[${variantIndex}]`, context),
    );
  });
}

/**
 * Read-only audit of the explicit media-reference paths in all Legacy entity
 * reference_images documents, including soft-deleted rows. Unknown keys are
 * intentionally not traversed.
 */
export function preflightLegacyEntityReferenceImages(
  database: DatabaseSync,
): LegacyEntityReferenceImagesPreflightReport {
  const targets = mediaTargets(database);
  const blockers: LegacyEntityReferenceImagesPreflightBlocker[] = [];
  const allHashes = new Set<string>();

  const bySource = ENTITY_REFERENCE_SOURCES.map((table): LegacyEntityReferenceSourceReport => {
    const active = emptyLifecycleReport();
    const softDeleted = emptyLifecycleReport();
    const sourceFingerprint = createHash('sha256');
    const statement = database.prepare(
      `SELECT id, deleted_at, reference_images FROM "${table}" ORDER BY id`,
    );
    statement.setReadBigInts(true);

    for (const row of statement.iterate() as Iterable<EntityReferenceRow>) {
      const lifecycle: EntityReferenceLifecycle =
        row.deleted_at === null ? 'active' : 'soft_deleted';
      const lifecycleReport = lifecycle === 'active' ? active : softDeleted;
      lifecycleReport.rowCount += 1;
      const rowKey = hashCanonical({ table, id: rawValueFingerprint(row.id) });
      sourceFingerprint.update(
        hashCanonical({
          rowKey,
          lifecycle,
          deletedAt: rawValueFingerprint(row.deleted_at),
          referenceImages: rawValueFingerprint(row.reference_images),
        }),
      );
      if (row.reference_images === null) {
        lifecycleReport.nullValueCount += 1;
        continue;
      }
      if (row.reference_images === '') {
        lifecycleReport.emptyValueCount += 1;
        continue;
      }
      lifecycleReport.documentCount += 1;
      const context: AuditContext = {
        table,
        lifecycle,
        rowKey,
        targets,
        allHashes,
        lifecycleReport,
        blockers,
      };
      if (typeof row.reference_images !== 'string') {
        blockers.push({
          kind: 'invalid_entity_reference_images_document',
          table,
          column: 'reference_images',
          lifecycle,
          rowKey,
          path: '$',
          reason: 'not_text',
        });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(row.reference_images);
      } catch {
        blockers.push({
          kind: 'invalid_entity_reference_images_document',
          table,
          column: 'reference_images',
          lifecycle,
          rowKey,
          path: '$',
          reason: 'invalid_json',
        });
        continue;
      }
      if (!Array.isArray(parsed)) {
        blockers.push({
          kind: 'invalid_entity_reference_images_document',
          table,
          column: 'reference_images',
          lifecycle,
          rowKey,
          path: '$',
          reason: 'not_array',
        });
        continue;
      }
      auditDocument(parsed, context);
    }

    return {
      table,
      column: 'reference_images',
      active: reportLifecycle(active),
      softDeleted: reportLifecycle(softDeleted),
      fingerprint: sourceFingerprint.digest('hex'),
    };
  });

  const referenceCount = bySource.reduce(
    (total, source) => total + source.active.referenceCount + source.softDeleted.referenceCount,
    0,
  );
  return {
    coverage: LEGACY_ENTITY_REFERENCE_IMAGE_COVERAGE,
    referenceCount,
    distinctHashCount: allHashes.size,
    bySource,
    fingerprint: hashCanonical({
      coverage: LEGACY_ENTITY_REFERENCE_IMAGE_COVERAGE,
      referenceCount,
      distinctHashCount: allHashes.size,
      bySource,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
