import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const LEGACY_GENERATION_METADATA_MEDIA_PATHS = [
  '$.sourceImageHash',
  '$.referenceAssetHashes[*]',
  '$.sourceVideoHash',
  '$.frameReferenceHashes.first',
  '$.frameReferenceHashes.last',
  '$.characterRefs[*].imageHashes[*]',
  '$.equipmentRefs[*].imageHashes[*]',
  '$.locationRefs[*].imageHashes[*]',
] as const;

export type LegacyGenerationMetadataPreflightBlocker =
  | {
      readonly kind: 'invalid_generation_metadata_document';
      readonly table: 'asset_contents';
      readonly column: 'generation_metadata';
      readonly rowKey: string;
      readonly path: '$';
      readonly reason: 'not_text' | 'invalid_json' | 'not_object';
    }
  | {
      readonly kind: 'invalid_generation_metadata_shape';
      readonly table: 'asset_contents';
      readonly column: 'generation_metadata';
      readonly rowKey: string;
      readonly path: string;
      readonly expected: 'object' | 'array' | 'string';
      readonly actual: string;
    }
  | {
      readonly kind: 'invalid_generation_metadata_hash';
      readonly table: 'asset_contents';
      readonly column: 'generation_metadata';
      readonly rowKey: string;
      readonly path: string;
      readonly value: string;
      readonly reason: 'not_lowercase_sha256';
    }
  | {
      readonly kind: 'missing_generation_metadata_target';
      readonly table: 'asset_contents';
      readonly column: 'generation_metadata';
      readonly rowKey: string;
      readonly path: string;
      readonly hash: string;
    };

export interface LegacyGenerationMetadataPreflightReport {
  readonly coverage: Readonly<{
    source: 'asset_contents.generation_metadata';
    paths: typeof LEGACY_GENERATION_METADATA_MEDIA_PATHS;
  }>;
  readonly documentCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly fingerprint: string;
  readonly blockers: readonly LegacyGenerationMetadataPreflightBlocker[];
  readonly ok: boolean;
}

interface GenerationMetadataRow {
  readonly hash: unknown;
  readonly generation_metadata: unknown;
}

interface AssetHashRow {
  readonly hash: unknown;
}

interface AuditContext {
  readonly rowKey: string;
  readonly targets: ReadonlySet<string>;
  readonly hashes: Set<string>;
  readonly blockers: LegacyGenerationMetadataPreflightBlocker[];
  referenceCount: number;
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
  context.referenceCount += 1;
  if (typeof value !== 'string') {
    context.blockers.push({
      kind: 'invalid_generation_metadata_shape',
      table: 'asset_contents',
      column: 'generation_metadata',
      rowKey: context.rowKey,
      path,
      expected: 'string',
      actual: valueType(value),
    });
    return;
  }
  if (!SHA256_PATTERN.test(value)) {
    context.blockers.push({
      kind: 'invalid_generation_metadata_hash',
      table: 'asset_contents',
      column: 'generation_metadata',
      rowKey: context.rowKey,
      path,
      value,
      reason: 'not_lowercase_sha256',
    });
    return;
  }
  context.hashes.add(value);
  if (!context.targets.has(value)) {
    context.blockers.push({
      kind: 'missing_generation_metadata_target',
      table: 'asset_contents',
      column: 'generation_metadata',
      rowKey: context.rowKey,
      path,
      hash: value,
    });
  }
}

function auditOptionalHash(
  value: Record<string, unknown>,
  key: string,
  path: string,
  context: AuditContext,
): void {
  if (Object.hasOwn(value, key)) auditHash(value[key], path, context);
}

function auditHashArray(value: unknown, path: string, context: AuditContext): void {
  if (!Array.isArray(value)) {
    context.blockers.push({
      kind: 'invalid_generation_metadata_shape',
      table: 'asset_contents',
      column: 'generation_metadata',
      rowKey: context.rowKey,
      path,
      expected: 'array',
      actual: valueType(value),
    });
    return;
  }
  value.forEach((hash, index) => auditHash(hash, `${path}[${index}]`, context));
}

function auditOptionalHashArray(
  value: Record<string, unknown>,
  key: string,
  path: string,
  context: AuditContext,
): void {
  if (Object.hasOwn(value, key)) auditHashArray(value[key], path, context);
}

function auditFrameReferences(value: Record<string, unknown>, context: AuditContext): void {
  if (!Object.hasOwn(value, 'frameReferenceHashes')) return;
  const frameReferences = value.frameReferenceHashes;
  if (!isObject(frameReferences)) {
    context.blockers.push({
      kind: 'invalid_generation_metadata_shape',
      table: 'asset_contents',
      column: 'generation_metadata',
      rowKey: context.rowKey,
      path: '$.frameReferenceHashes',
      expected: 'object',
      actual: valueType(frameReferences),
    });
    return;
  }
  auditOptionalHash(frameReferences, 'first', '$.frameReferenceHashes.first', context);
  auditOptionalHash(frameReferences, 'last', '$.frameReferenceHashes.last', context);
}

function auditEntityReferences(
  value: Record<string, unknown>,
  key: 'characterRefs' | 'equipmentRefs' | 'locationRefs',
  context: AuditContext,
): void {
  if (!Object.hasOwn(value, key)) return;
  const references = value[key];
  if (!Array.isArray(references)) {
    context.blockers.push({
      kind: 'invalid_generation_metadata_shape',
      table: 'asset_contents',
      column: 'generation_metadata',
      rowKey: context.rowKey,
      path: `$.${key}`,
      expected: 'array',
      actual: valueType(references),
    });
    return;
  }
  references.forEach((reference, index) => {
    const itemPath = `$.${key}[${index}]`;
    if (!isObject(reference)) {
      context.blockers.push({
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: context.rowKey,
        path: itemPath,
        expected: 'object',
        actual: valueType(reference),
      });
      return;
    }
    if (!Object.hasOwn(reference, 'imageHashes')) {
      context.blockers.push({
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: context.rowKey,
        path: `${itemPath}.imageHashes`,
        expected: 'array',
        actual: 'missing',
      });
      return;
    }
    auditHashArray(reference.imageHashes, `${itemPath}.imageHashes`, context);
  });
}

function auditDocument(value: Record<string, unknown>, context: AuditContext): void {
  auditOptionalHash(value, 'sourceImageHash', '$.sourceImageHash', context);
  auditOptionalHashArray(value, 'referenceAssetHashes', '$.referenceAssetHashes', context);
  auditOptionalHash(value, 'sourceVideoHash', '$.sourceVideoHash', context);
  auditFrameReferences(value, context);
  auditEntityReferences(value, 'characterRefs', context);
  auditEntityReferences(value, 'equipmentRefs', context);
  auditEntityReferences(value, 'locationRefs', context);
}

/**
 * Read-only audit of the explicit media-reference paths in Legacy
 * asset_contents.generation_metadata. It does not recursively inspect any
 * unknown field and does not claim coverage of other JSON columns.
 */
export function preflightLegacyGenerationMetadata(
  database: DatabaseSync,
): LegacyGenerationMetadataPreflightReport {
  const targets = mediaTargets(database);
  const hashes = new Set<string>();
  const blockers: LegacyGenerationMetadataPreflightBlocker[] = [];
  const documentFingerprint = createHash('sha256');
  const statement = database.prepare(
    `SELECT hash, generation_metadata
       FROM asset_contents
      WHERE generation_metadata IS NOT NULL
      ORDER BY hash`,
  );
  statement.setReadBigInts(true);
  let documentCount = 0;
  let referenceCount = 0;

  for (const row of statement.iterate() as Iterable<GenerationMetadataRow>) {
    if (row.generation_metadata === '') continue;
    documentCount += 1;
    const rowKey = hashCanonical({
      table: 'asset_contents',
      hash: rawValueFingerprint(row.hash),
    });
    documentFingerprint.update(
      hashCanonical({ rowKey, value: rawValueFingerprint(row.generation_metadata) }),
    );
    if (typeof row.generation_metadata !== 'string') {
      blockers.push({
        kind: 'invalid_generation_metadata_document',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey,
        path: '$',
        reason: 'not_text',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.generation_metadata);
    } catch {
      blockers.push({
        kind: 'invalid_generation_metadata_document',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey,
        path: '$',
        reason: 'invalid_json',
      });
      continue;
    }
    if (!isObject(parsed)) {
      blockers.push({
        kind: 'invalid_generation_metadata_document',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey,
        path: '$',
        reason: 'not_object',
      });
      continue;
    }

    const context: AuditContext = { rowKey, targets, hashes, blockers, referenceCount: 0 };
    auditDocument(parsed, context);
    referenceCount += context.referenceCount;
  }

  const coverage = {
    source: 'asset_contents.generation_metadata',
    paths: LEGACY_GENERATION_METADATA_MEDIA_PATHS,
  } as const;
  return {
    coverage,
    documentCount,
    referenceCount,
    distinctHashCount: hashes.size,
    fingerprint: hashCanonical({
      coverage,
      documentFingerprint: documentFingerprint.digest('hex'),
      referenceCount,
      distinctHashCount: hashes.size,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
