import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
type AttemptKind = 'task' | 'production_media' | 'batch_export';

export const LEGACY_PRODUCTION_MEDIA_ATTEMPT_COVERAGE = {
  source: 'task_attempts.generation_spec_json',
  attemptKind: 'production_media',
  specVersion: 3,
  targetType: 'image',
  paths: [
    '$.referenceEvidence[*].assetHash',
    '$.request.sourceImageHash',
    '$.request.referenceImages[*]',
    '$.request.frameReferenceImages.first',
    '$.request.frameReferenceImages.last',
  ],
  forbiddenPaths: ['$.request.sourceImagePath', '$.request.params.sourceImagePath'],
  unknownFields: 'ignored',
} as const;

interface BlockerLocation {
  readonly table: 'task_attempts';
  readonly column: 'kind' | 'media_type' | 'generation_spec_json';
  readonly rowKey: string;
  readonly path: string;
}

export type LegacyProductionMediaAttemptPreflightBlocker =
  | (BlockerLocation & {
      readonly kind: 'invalid_production_media_attempt_kind';
      readonly column: 'kind';
      readonly path: '$column.kind';
      readonly reason: 'not_text' | 'unsupported_kind';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'production_media_generation_spec_not_allowed';
      readonly column: 'generation_spec_json';
      readonly path: '$';
      readonly attemptKind: 'task' | 'batch_export';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_production_media_generation_spec_document';
      readonly column: 'generation_spec_json';
      readonly path: '$';
      readonly reason:
        'null_document' | 'empty_document' | 'not_text' | 'invalid_json' | 'not_object';
    })
  | (BlockerLocation & {
      readonly kind: 'unsupported_production_media_generation_spec_version';
      readonly column: 'generation_spec_json';
      readonly path: '$.specVersion';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_production_media_generation_spec_shape';
      readonly expected: 'object' | 'array' | 'string' | 'image_or_video';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'production_media_generation_spec_media_type_mismatch';
      readonly column: 'generation_spec_json';
      readonly path: '$.mediaType|$.request.type|$column.media_type';
      readonly columnMediaType: 'image' | 'video';
      readonly specMediaType: 'image' | 'video';
      readonly requestMediaType: 'image' | 'video';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_production_media_attempt_media_hash';
      readonly column: 'generation_spec_json';
      readonly value: string;
      readonly reason: 'not_lowercase_sha256';
    })
  | (BlockerLocation & {
      readonly kind: 'missing_production_media_attempt_media_target';
      readonly column: 'generation_spec_json';
      readonly hash: string;
      readonly expectedType: 'image';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_production_media_attempt_media_target';
      readonly column: 'generation_spec_json';
      readonly hash: string;
      readonly expectedType: 'image';
      readonly actualType: string;
    })
  | (BlockerLocation & {
      readonly kind: 'production_media_attempt_path_reference_not_allowed';
      readonly column: 'generation_spec_json';
      readonly path: '$.request.sourceImagePath' | '$.request.params.sourceImagePath';
      readonly reason: 'persistent_path_reference';
    });

export interface LegacyProductionMediaAttemptPreflightReport {
  readonly coverage: typeof LEGACY_PRODUCTION_MEDIA_ATTEMPT_COVERAGE;
  readonly attemptCount: number;
  readonly productionMediaAttemptCount: number;
  readonly archivedProductionMediaAttemptCount: number;
  readonly documentCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly wrongKindDocumentCount: number;
  readonly fingerprint: string;
  readonly blockers: readonly LegacyProductionMediaAttemptPreflightBlocker[];
  readonly ok: boolean;
}

interface AttemptRow {
  readonly id: unknown;
  readonly kind: unknown;
  readonly media_type: unknown;
  readonly generation_spec_json: unknown;
  readonly archived: unknown;
}

interface AssetRow {
  readonly hash: unknown;
  readonly type: unknown;
}

interface TargetFact {
  readonly exists: true;
  readonly type: unknown;
}

interface AuditContext {
  readonly rowKey: string;
  readonly targets: ReadonlyMap<string, TargetFact>;
  readonly targetFacts: Map<string, unknown>;
  readonly hashes: Set<string>;
  readonly blockers: LegacyProductionMediaAttemptPreflightBlocker[];
  referenceCount: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMediaType(value: unknown): value is 'image' | 'video' {
  return value === 'image' || value === 'video';
}

function isAttemptKind(value: unknown): value is AttemptKind {
  return value === 'task' || value === 'production_media' || value === 'batch_export';
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

function mediaTargets(database: DatabaseSync): ReadonlyMap<string, TargetFact> {
  const targets = new Map<string, TargetFact>();
  const statement = database.prepare('SELECT hash, type FROM asset_contents ORDER BY hash');
  statement.setReadBigInts(true);
  for (const row of statement.iterate() as Iterable<AssetRow>) {
    if (typeof row.hash === 'string') targets.set(row.hash, { exists: true, type: row.type });
  }
  return targets;
}

function shapeBlocker(
  context: AuditContext,
  path: string,
  expected: 'object' | 'array' | 'string' | 'image_or_video',
  actual: unknown,
  column: 'media_type' | 'generation_spec_json' = 'generation_spec_json',
): void {
  context.blockers.push({
    kind: 'invalid_production_media_generation_spec_shape',
    table: 'task_attempts',
    column,
    rowKey: context.rowKey,
    path,
    expected,
    actual:
      valueType(actual) === 'string' && typeof actual === 'string' ? actual : valueType(actual),
  });
}

function auditHash(value: unknown, path: string, context: AuditContext): void {
  context.referenceCount += 1;
  if (typeof value !== 'string') {
    shapeBlocker(context, path, 'string', value);
    return;
  }
  if (!SHA256_PATTERN.test(value)) {
    context.blockers.push({
      kind: 'invalid_production_media_attempt_media_hash',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path,
      value,
      reason: 'not_lowercase_sha256',
    });
    return;
  }
  context.hashes.add(value);
  const target = context.targets.get(value);
  context.targetFacts.set(
    value,
    target
      ? { hash: value, exists: true, type: rawValueFingerprint(target.type) }
      : { hash: value, exists: false },
  );
  if (!target) {
    context.blockers.push({
      kind: 'missing_production_media_attempt_media_target',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path,
      hash: value,
      expectedType: 'image',
    });
    return;
  }
  if (target.type !== 'image') {
    context.blockers.push({
      kind: 'invalid_production_media_attempt_media_target',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path,
      hash: value,
      expectedType: 'image',
      actualType: typeof target.type === 'string' ? target.type : valueType(target.type),
    });
  }
}

function auditReferenceEvidence(document: Record<string, unknown>, context: AuditContext): void {
  const evidence = document.referenceEvidence;
  if (!Array.isArray(evidence)) {
    shapeBlocker(context, '$.referenceEvidence', 'array', evidence);
    return;
  }
  evidence.forEach((item, index) => {
    const itemPath = `$.referenceEvidence[${index}]`;
    if (!isObject(item)) {
      shapeBlocker(context, itemPath, 'object', item);
      return;
    }
    if (!Object.hasOwn(item, 'assetHash')) {
      shapeBlocker(context, `${itemPath}.assetHash`, 'string', undefined);
      return;
    }
    auditHash(item.assetHash, `${itemPath}.assetHash`, context);
  });
}

function auditRequestReferences(request: Record<string, unknown>, context: AuditContext): void {
  if (Object.hasOwn(request, 'sourceImagePath')) {
    context.blockers.push({
      kind: 'production_media_attempt_path_reference_not_allowed',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path: '$.request.sourceImagePath',
      reason: 'persistent_path_reference',
    });
  }
  if (isObject(request.params) && Object.hasOwn(request.params, 'sourceImagePath')) {
    context.blockers.push({
      kind: 'production_media_attempt_path_reference_not_allowed',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path: '$.request.params.sourceImagePath',
      reason: 'persistent_path_reference',
    });
  }
  if (Object.hasOwn(request, 'sourceImageHash')) {
    auditHash(request.sourceImageHash, '$.request.sourceImageHash', context);
  }
  if (Object.hasOwn(request, 'referenceImages')) {
    if (!Array.isArray(request.referenceImages)) {
      shapeBlocker(context, '$.request.referenceImages', 'array', request.referenceImages);
    } else {
      request.referenceImages.forEach((reference, index) =>
        auditHash(reference, `$.request.referenceImages[${index}]`, context),
      );
    }
  }
  if (!Object.hasOwn(request, 'frameReferenceImages')) return;
  if (!isObject(request.frameReferenceImages)) {
    shapeBlocker(context, '$.request.frameReferenceImages', 'object', request.frameReferenceImages);
    return;
  }
  if (Object.hasOwn(request.frameReferenceImages, 'first')) {
    auditHash(request.frameReferenceImages.first, '$.request.frameReferenceImages.first', context);
  }
  if (Object.hasOwn(request.frameReferenceImages, 'last')) {
    auditHash(request.frameReferenceImages.last, '$.request.frameReferenceImages.last', context);
  }
}

function auditGenerationSpec(
  document: Record<string, unknown>,
  columnMediaType: unknown,
  context: AuditContext,
): void {
  if (document.specVersion !== 3) {
    context.blockers.push({
      kind: 'unsupported_production_media_generation_spec_version',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path: '$.specVersion',
      actual: valueType(document.specVersion),
    });
    return;
  }

  const request = document.request;
  if (!isMediaType(columnMediaType)) {
    shapeBlocker(context, '$column.media_type', 'image_or_video', columnMediaType, 'media_type');
  }
  if (!isMediaType(document.mediaType)) {
    shapeBlocker(context, '$.mediaType', 'image_or_video', document.mediaType);
  }
  if (!isObject(request)) {
    shapeBlocker(context, '$.request', 'object', request);
  } else if (!isMediaType(request.type)) {
    shapeBlocker(context, '$.request.type', 'image_or_video', request.type);
  }
  if (
    isMediaType(columnMediaType) &&
    isMediaType(document.mediaType) &&
    isObject(request) &&
    isMediaType(request.type) &&
    (columnMediaType !== document.mediaType || document.mediaType !== request.type)
  ) {
    context.blockers.push({
      kind: 'production_media_generation_spec_media_type_mismatch',
      table: 'task_attempts',
      column: 'generation_spec_json',
      rowKey: context.rowKey,
      path: '$.mediaType|$.request.type|$column.media_type',
      columnMediaType,
      specMediaType: document.mediaType,
      requestMediaType: request.type,
    });
  }

  auditReferenceEvidence(document, context);
  if (isObject(request)) auditRequestReferences(request, context);
}

/**
 * Read-only audit of the exact v3 image-reference paths persisted by Legacy
 * production-media attempts. Unknown fields and provider-specific payloads are
 * deliberately not traversed.
 */
export function preflightLegacyProductionMediaAttempts(
  database: DatabaseSync,
): LegacyProductionMediaAttemptPreflightReport {
  const targets = mediaTargets(database);
  const targetFacts = new Map<string, unknown>();
  const hashes = new Set<string>();
  const blockers: LegacyProductionMediaAttemptPreflightBlocker[] = [];
  const documentFingerprint = createHash('sha256');
  const statement = database.prepare(
    `SELECT attempt.id,
            attempt.kind,
            attempt.media_type,
            attempt.generation_spec_json,
            CASE WHEN canvas.archived_at IS NULL THEN 0 ELSE 1 END AS archived
       FROM task_attempts AS attempt
       LEFT JOIN canvases AS canvas ON canvas.id = attempt.canvas_id
      ORDER BY attempt.id`,
  );
  statement.setReadBigInts(true);
  let attemptCount = 0;
  let productionMediaAttemptCount = 0;
  let archivedProductionMediaAttemptCount = 0;
  let documentCount = 0;
  let referenceCount = 0;
  let wrongKindDocumentCount = 0;

  for (const row of statement.iterate() as Iterable<AttemptRow>) {
    attemptCount += 1;
    const rowKey = hashCanonical({
      table: 'task_attempts',
      id: rawValueFingerprint(row.id),
    });
    documentFingerprint.update(
      hashCanonical({
        rowKey,
        kind: rawValueFingerprint(row.kind),
        mediaType: rawValueFingerprint(row.media_type),
        generationSpec: rawValueFingerprint(row.generation_spec_json),
        archived: rawValueFingerprint(row.archived),
      }),
    );

    if (!isAttemptKind(row.kind)) {
      blockers.push({
        kind: 'invalid_production_media_attempt_kind',
        table: 'task_attempts',
        column: 'kind',
        rowKey,
        path: '$column.kind',
        reason: typeof row.kind === 'string' ? 'unsupported_kind' : 'not_text',
        actual: typeof row.kind === 'string' ? row.kind : valueType(row.kind),
      });
      continue;
    }

    if (row.kind !== 'production_media') {
      if (row.generation_spec_json !== null) {
        wrongKindDocumentCount += 1;
        blockers.push({
          kind: 'production_media_generation_spec_not_allowed',
          table: 'task_attempts',
          column: 'generation_spec_json',
          rowKey,
          path: '$',
          attemptKind: row.kind,
          actual: valueType(row.generation_spec_json),
        });
      }
      continue;
    }

    productionMediaAttemptCount += 1;
    if (row.archived === 1 || row.archived === 1n) archivedProductionMediaAttemptCount += 1;
    if (row.generation_spec_json !== null) documentCount += 1;
    if (row.generation_spec_json === null) {
      blockers.push({
        kind: 'invalid_production_media_generation_spec_document',
        table: 'task_attempts',
        column: 'generation_spec_json',
        rowKey,
        path: '$',
        reason: 'null_document',
      });
      continue;
    }
    if (typeof row.generation_spec_json !== 'string') {
      blockers.push({
        kind: 'invalid_production_media_generation_spec_document',
        table: 'task_attempts',
        column: 'generation_spec_json',
        rowKey,
        path: '$',
        reason: 'not_text',
      });
      continue;
    }
    if (row.generation_spec_json.length === 0) {
      blockers.push({
        kind: 'invalid_production_media_generation_spec_document',
        table: 'task_attempts',
        column: 'generation_spec_json',
        rowKey,
        path: '$',
        reason: 'empty_document',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.generation_spec_json);
    } catch {
      blockers.push({
        kind: 'invalid_production_media_generation_spec_document',
        table: 'task_attempts',
        column: 'generation_spec_json',
        rowKey,
        path: '$',
        reason: 'invalid_json',
      });
      continue;
    }
    if (!isObject(parsed)) {
      blockers.push({
        kind: 'invalid_production_media_generation_spec_document',
        table: 'task_attempts',
        column: 'generation_spec_json',
        rowKey,
        path: '$',
        reason: 'not_object',
      });
      continue;
    }

    const context: AuditContext = {
      rowKey,
      targets,
      targetFacts,
      hashes,
      blockers,
      referenceCount: 0,
    };
    auditGenerationSpec(parsed, row.media_type, context);
    referenceCount += context.referenceCount;
  }

  return {
    coverage: LEGACY_PRODUCTION_MEDIA_ATTEMPT_COVERAGE,
    attemptCount,
    productionMediaAttemptCount,
    archivedProductionMediaAttemptCount,
    documentCount,
    referenceCount,
    distinctHashCount: hashes.size,
    wrongKindDocumentCount,
    fingerprint: hashCanonical({
      coverage: LEGACY_PRODUCTION_MEDIA_ATTEMPT_COVERAGE,
      documentFingerprint: documentFingerprint.digest('hex'),
      targetFacts: [...targetFacts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      attemptCount,
      productionMediaAttemptCount,
      archivedProductionMediaAttemptCount,
      documentCount,
      referenceCount,
      distinctHashCount: hashes.size,
      wrongKindDocumentCount,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
