import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const LEGACY_TASK_EVALUATION_MEDIA_COVERAGE = {
  source: 'task_evaluations.frame_evidence_json',
  evaluationKind: 'production_media',
  path: '$[*].assetHash',
  timestampPath: '$[*].timestampSeconds',
  targetType: 'image',
  excludedColumns: [
    'scores_json',
    'strengths_json',
    'risks_json',
    'evidence_json',
    'repair_delta_json',
    'metadata_json',
  ],
  unknownFields: 'ignored',
} as const;

interface BlockerLocation {
  readonly table: 'task_evaluations';
  readonly column: 'kind' | 'media_type' | 'frame_evidence_json';
  readonly rowKey: string;
  readonly path: string;
}

export type LegacyTaskEvaluationMediaPreflightBlocker =
  | (BlockerLocation & {
      readonly kind: 'invalid_task_evaluation_kind';
      readonly column: 'kind';
      readonly path: '$column.kind';
      readonly reason: 'not_text' | 'unsupported_kind';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_task_evaluation_media_type';
      readonly column: 'media_type';
      readonly path: '$column.media_type';
      readonly reason: 'not_text' | 'unsupported_media_type';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_task_evaluation_frame_document';
      readonly column: 'frame_evidence_json';
      readonly path: '$';
      readonly reason:
        'null_document' | 'empty_document' | 'not_text' | 'invalid_json' | 'not_array';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_task_evaluation_frame_shape';
      readonly column: 'frame_evidence_json';
      readonly expected: 'object' | 'string' | 'nonnegative_finite_number';
      readonly actual: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_task_evaluation_media_hash';
      readonly column: 'frame_evidence_json';
      readonly value: string;
      readonly reason: 'not_lowercase_sha256';
    })
  | (BlockerLocation & {
      readonly kind: 'missing_task_evaluation_media_target';
      readonly column: 'frame_evidence_json';
      readonly hash: string;
      readonly expectedType: 'image';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_task_evaluation_media_target';
      readonly column: 'frame_evidence_json';
      readonly hash: string;
      readonly expectedType: 'image';
      readonly actualType: string;
    })
  | (BlockerLocation & {
      readonly kind: 'task_evaluation_frame_evidence_not_allowed';
      readonly column: 'frame_evidence_json';
      readonly path: '$';
      readonly mediaType: 'image';
      readonly reason: 'image_evaluation_must_use_empty_array';
    });

export interface LegacyTaskEvaluationMediaPreflightReport {
  readonly coverage: typeof LEGACY_TASK_EVALUATION_MEDIA_COVERAGE;
  readonly evaluationCount: number;
  readonly imageEvaluationCount: number;
  readonly videoEvaluationCount: number;
  readonly documentCount: number;
  readonly frameCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly fingerprint: string;
  readonly blockers: readonly LegacyTaskEvaluationMediaPreflightBlocker[];
  readonly ok: boolean;
}

interface EvaluationRow {
  readonly id: unknown;
  readonly kind: unknown;
  readonly media_type: unknown;
  readonly frame_evidence_json: unknown;
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
  readonly blockers: LegacyTaskEvaluationMediaPreflightBlocker[];
  referenceCount: number;
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

function timestampType(value: unknown): string {
  if (typeof value !== 'number') return valueType(value);
  if (!Number.isFinite(value)) return 'nonfinite_number';
  if (value < 0) return 'negative_number';
  return 'number';
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
  expected: 'object' | 'string' | 'nonnegative_finite_number',
  actual: string,
): void {
  context.blockers.push({
    kind: 'invalid_task_evaluation_frame_shape',
    table: 'task_evaluations',
    column: 'frame_evidence_json',
    rowKey: context.rowKey,
    path,
    expected,
    actual,
  });
}

function auditHash(value: unknown, path: string, context: AuditContext): void {
  context.referenceCount += 1;
  if (typeof value !== 'string') {
    shapeBlocker(context, path, 'string', valueType(value));
    return;
  }
  if (!SHA256_PATTERN.test(value)) {
    context.blockers.push({
      kind: 'invalid_task_evaluation_media_hash',
      table: 'task_evaluations',
      column: 'frame_evidence_json',
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
      kind: 'missing_task_evaluation_media_target',
      table: 'task_evaluations',
      column: 'frame_evidence_json',
      rowKey: context.rowKey,
      path,
      hash: value,
      expectedType: 'image',
    });
    return;
  }
  if (target.type !== 'image') {
    context.blockers.push({
      kind: 'invalid_task_evaluation_media_target',
      table: 'task_evaluations',
      column: 'frame_evidence_json',
      rowKey: context.rowKey,
      path,
      hash: value,
      expectedType: 'image',
      actualType: typeof target.type === 'string' ? target.type : valueType(target.type),
    });
  }
}

function auditFrames(frames: readonly unknown[], context: AuditContext): void {
  frames.forEach((frame, index) => {
    const itemPath = `$[${index}]`;
    if (!isObject(frame)) {
      shapeBlocker(context, itemPath, 'object', valueType(frame));
      return;
    }
    if (!Object.hasOwn(frame, 'timestampSeconds')) {
      shapeBlocker(context, `${itemPath}.timestampSeconds`, 'nonnegative_finite_number', 'missing');
    } else if (
      typeof frame.timestampSeconds !== 'number' ||
      !Number.isFinite(frame.timestampSeconds) ||
      frame.timestampSeconds < 0
    ) {
      shapeBlocker(
        context,
        `${itemPath}.timestampSeconds`,
        'nonnegative_finite_number',
        timestampType(frame.timestampSeconds),
      );
    }
    if (!Object.hasOwn(frame, 'assetHash')) {
      shapeBlocker(context, `${itemPath}.assetHash`, 'string', 'missing');
    } else {
      auditHash(frame.assetHash, `${itemPath}.assetHash`, context);
    }
  });
}

/**
 * Read-only audit of exact timestamped image references in Legacy Task
 * evaluations. Other evaluation JSON columns remain explicitly out of scope.
 */
export function preflightLegacyTaskEvaluationMedia(
  database: DatabaseSync,
): LegacyTaskEvaluationMediaPreflightReport {
  const targets = mediaTargets(database);
  const targetFacts = new Map<string, unknown>();
  const hashes = new Set<string>();
  const blockers: LegacyTaskEvaluationMediaPreflightBlocker[] = [];
  const documentFingerprint = createHash('sha256');
  const statement = database.prepare(
    `SELECT id, kind, media_type, frame_evidence_json
       FROM task_evaluations
      ORDER BY id`,
  );
  statement.setReadBigInts(true);
  let evaluationCount = 0;
  let imageEvaluationCount = 0;
  let videoEvaluationCount = 0;
  let documentCount = 0;
  let frameCount = 0;
  let referenceCount = 0;

  for (const row of statement.iterate() as Iterable<EvaluationRow>) {
    evaluationCount += 1;
    const rowKey = hashCanonical({
      table: 'task_evaluations',
      id: rawValueFingerprint(row.id),
    });
    documentFingerprint.update(
      hashCanonical({
        rowKey,
        kind: rawValueFingerprint(row.kind),
        mediaType: rawValueFingerprint(row.media_type),
        frameEvidence: rawValueFingerprint(row.frame_evidence_json),
      }),
    );

    if (row.kind !== 'production_media') {
      blockers.push({
        kind: 'invalid_task_evaluation_kind',
        table: 'task_evaluations',
        column: 'kind',
        rowKey,
        path: '$column.kind',
        reason: typeof row.kind === 'string' ? 'unsupported_kind' : 'not_text',
        actual: typeof row.kind === 'string' ? row.kind : valueType(row.kind),
      });
      continue;
    }

    if (row.media_type === 'image') imageEvaluationCount += 1;
    else if (row.media_type === 'video') videoEvaluationCount += 1;
    else {
      blockers.push({
        kind: 'invalid_task_evaluation_media_type',
        table: 'task_evaluations',
        column: 'media_type',
        rowKey,
        path: '$column.media_type',
        reason: typeof row.media_type === 'string' ? 'unsupported_media_type' : 'not_text',
        actual: typeof row.media_type === 'string' ? row.media_type : valueType(row.media_type),
      });
    }

    if (row.frame_evidence_json !== null) documentCount += 1;
    if (row.frame_evidence_json === null) {
      blockers.push({
        kind: 'invalid_task_evaluation_frame_document',
        table: 'task_evaluations',
        column: 'frame_evidence_json',
        rowKey,
        path: '$',
        reason: 'null_document',
      });
      continue;
    }
    if (typeof row.frame_evidence_json !== 'string') {
      blockers.push({
        kind: 'invalid_task_evaluation_frame_document',
        table: 'task_evaluations',
        column: 'frame_evidence_json',
        rowKey,
        path: '$',
        reason: 'not_text',
      });
      continue;
    }
    if (row.frame_evidence_json.length === 0) {
      blockers.push({
        kind: 'invalid_task_evaluation_frame_document',
        table: 'task_evaluations',
        column: 'frame_evidence_json',
        rowKey,
        path: '$',
        reason: 'empty_document',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.frame_evidence_json);
    } catch {
      blockers.push({
        kind: 'invalid_task_evaluation_frame_document',
        table: 'task_evaluations',
        column: 'frame_evidence_json',
        rowKey,
        path: '$',
        reason: 'invalid_json',
      });
      continue;
    }
    if (!Array.isArray(parsed)) {
      blockers.push({
        kind: 'invalid_task_evaluation_frame_document',
        table: 'task_evaluations',
        column: 'frame_evidence_json',
        rowKey,
        path: '$',
        reason: 'not_array',
      });
      continue;
    }

    frameCount += parsed.length;
    if (row.media_type === 'image' && parsed.length > 0) {
      blockers.push({
        kind: 'task_evaluation_frame_evidence_not_allowed',
        table: 'task_evaluations',
        column: 'frame_evidence_json',
        rowKey,
        path: '$',
        mediaType: 'image',
        reason: 'image_evaluation_must_use_empty_array',
      });
    }
    const context: AuditContext = {
      rowKey,
      targets,
      targetFacts,
      hashes,
      blockers,
      referenceCount: 0,
    };
    auditFrames(parsed, context);
    referenceCount += context.referenceCount;
  }

  return {
    coverage: LEGACY_TASK_EVALUATION_MEDIA_COVERAGE,
    evaluationCount,
    imageEvaluationCount,
    videoEvaluationCount,
    documentCount,
    frameCount,
    referenceCount,
    distinctHashCount: hashes.size,
    fingerprint: hashCanonical({
      coverage: LEGACY_TASK_EVALUATION_MEDIA_COVERAGE,
      documentFingerprint: documentFingerprint.digest('hex'),
      targetFacts: [...targetFacts.entries()].sort(([left], [right]) => left.localeCompare(right)),
      evaluationCount,
      imageEvaluationCount,
      videoEvaluationCount,
      documentCount,
      frameCount,
      referenceCount,
      distinctHashCount: hashes.size,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
