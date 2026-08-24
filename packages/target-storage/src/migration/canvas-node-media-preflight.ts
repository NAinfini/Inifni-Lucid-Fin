import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const NODE_KINDS = ['image', 'video', 'audio', 'text', 'backdrop'] as const;
const MEDIA_NODE_KINDS = ['image', 'video', 'audio'] as const;
const ROOT_ENTITY_KEYS = ['characterRefs', 'equipmentRefs', 'locationRefs'] as const;
const ROOT_MEDIA_KEYS = [
  'assetHash',
  'variants',
  'sourceImageHash',
  'characterRefs',
  'equipmentRefs',
  'locationRefs',
  'firstFrameAssetHash',
  'lastFrameAssetHash',
  'generationHistory',
] as const;

type CanvasNodeKind = (typeof NODE_KINDS)[number];
type MediaNodeKind = (typeof MEDIA_NODE_KINDS)[number];
type MediaType = 'image' | 'video' | 'audio';
type CanvasLifecycle = 'active' | 'archived';

interface MediaPathDefinition {
  readonly path: string;
  readonly targetType: MediaType;
}

const HISTORY_IMAGE_PATHS = [
  '$.generationHistory[*].sourceImageHash',
  '$.generationHistory[*].frameReferenceHashes.first',
  '$.generationHistory[*].frameReferenceHashes.last',
  '$.generationHistory[*].characterRefs[*].imageHashes[*]',
  '$.generationHistory[*].equipmentRefs[*].imageHashes[*]',
  '$.generationHistory[*].locationRefs[*].imageHashes[*]',
] as const;

function mediaPath(path: string, targetType: MediaType): MediaPathDefinition {
  return { path, targetType };
}

function mediaNodePaths(kind: MediaNodeKind): readonly MediaPathDefinition[] {
  const paths: MediaPathDefinition[] = [
    mediaPath('$.assetHash', kind),
    mediaPath('$.variants[*]', kind),
  ];
  if (kind !== 'audio') {
    paths.push(
      mediaPath('$.sourceImageHash', 'image'),
      mediaPath('$.characterRefs[*].referenceImageHash', 'image'),
      mediaPath('$.equipmentRefs[*].referenceImageHash', 'image'),
      mediaPath('$.locationRefs[*].referenceImageHash', 'image'),
    );
  }
  if (kind === 'video') {
    paths.push(
      mediaPath('$.firstFrameAssetHash', 'image'),
      mediaPath('$.lastFrameAssetHash', 'image'),
    );
  }
  paths.push(mediaPath('$.generationHistory[*].assetHash', kind));
  for (const path of HISTORY_IMAGE_PATHS) paths.push(mediaPath(path, 'image'));
  return paths;
}

export const LEGACY_CANVAS_NODE_MEDIA_COVERAGE = {
  source: 'canvas_nodes.data_json',
  includesArchivedCanvases: true,
  byNodeKind: [
    { nodeKind: 'image', paths: mediaNodePaths('image') },
    { nodeKind: 'video', paths: mediaNodePaths('video') },
    { nodeKind: 'audio', paths: mediaNodePaths('audio') },
    { nodeKind: 'text', paths: [] },
    { nodeKind: 'backdrop', paths: [] },
  ],
} as const;

export type LegacyCanvasNodeMediaPreflightBlocker =
  | {
      readonly kind: 'unsupported_canvas_node_type';
      readonly table: 'canvas_nodes';
      readonly column: 'type';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly path: '$column.type';
      readonly actual: string;
      readonly value?: string;
    }
  | {
      readonly kind: 'invalid_canvas_node_media_document';
      readonly table: 'canvas_nodes';
      readonly column: 'data_json';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly nodeKind: string | null;
      readonly path: '$';
      readonly reason:
        'null_document' | 'empty_document' | 'not_text' | 'invalid_json' | 'not_object';
    }
  | {
      readonly kind: 'invalid_canvas_node_media_shape';
      readonly table: 'canvas_nodes';
      readonly column: 'data_json';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly nodeKind: CanvasNodeKind;
      readonly path: string;
      readonly expected: 'object' | 'array' | 'string';
      readonly actual: string;
    }
  | {
      readonly kind: 'invalid_canvas_node_media_hash';
      readonly table: 'canvas_nodes';
      readonly column: 'data_json';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly nodeKind: CanvasNodeKind;
      readonly path: string;
      readonly value: string;
      readonly reason: 'not_lowercase_sha256';
    }
  | {
      readonly kind: 'missing_canvas_node_media_target';
      readonly table: 'canvas_nodes';
      readonly column: 'data_json';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly nodeKind: CanvasNodeKind;
      readonly path: string;
      readonly hash: string;
      readonly expectedType: MediaType;
    }
  | {
      readonly kind: 'invalid_canvas_node_media_target';
      readonly table: 'canvas_nodes';
      readonly column: 'data_json';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly nodeKind: CanvasNodeKind;
      readonly path: string;
      readonly hash: string;
      readonly expectedType: MediaType;
      readonly actualType: string;
    }
  | {
      readonly kind: 'canvas_node_media_path_not_allowed';
      readonly table: 'canvas_nodes';
      readonly column: 'data_json';
      readonly rowKey: string;
      readonly lifecycle: CanvasLifecycle;
      readonly nodeKind: CanvasNodeKind;
      readonly path: string;
    };

export interface LegacyCanvasNodeMediaLifecycleReport {
  readonly rowCount: number;
  readonly documentCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly nullValueCount: number;
  readonly emptyValueCount: number;
}

export interface LegacyCanvasNodeMediaKindReport {
  readonly nodeKind: CanvasNodeKind;
  readonly active: LegacyCanvasNodeMediaLifecycleReport;
  readonly archived: LegacyCanvasNodeMediaLifecycleReport;
}

export interface LegacyCanvasNodeMediaPreflightReport {
  readonly coverage: typeof LEGACY_CANVAS_NODE_MEDIA_COVERAGE;
  readonly nodeCount: number;
  readonly archivedNodeCount: number;
  readonly documentCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly unsupportedNodeCount: number;
  readonly byNodeKind: readonly LegacyCanvasNodeMediaKindReport[];
  readonly fingerprint: string;
  readonly blockers: readonly LegacyCanvasNodeMediaPreflightBlocker[];
  readonly ok: boolean;
}

interface CanvasNodeRow {
  readonly id: unknown;
  readonly canvas_id: unknown;
  readonly type: unknown;
  readonly data_json: unknown;
  readonly archived_at: unknown;
}

interface AssetTargetRow {
  readonly hash: unknown;
  readonly type: unknown;
}

interface MutableLifecycleReport {
  rowCount: number;
  documentCount: number;
  referenceCount: number;
  nullValueCount: number;
  emptyValueCount: number;
  readonly hashes: Set<string>;
}

interface MutableKindReport {
  readonly nodeKind: CanvasNodeKind;
  readonly active: MutableLifecycleReport;
  readonly archived: MutableLifecycleReport;
}

interface AuditContext {
  readonly rowKey: string;
  readonly lifecycle: CanvasLifecycle;
  readonly nodeKind: CanvasNodeKind;
  readonly targets: ReadonlyMap<string, unknown>;
  readonly lifecycleReport: MutableLifecycleReport;
  readonly allHashes: Set<string>;
  readonly targetFingerprint: ReturnType<typeof createHash>;
  readonly blockers: LegacyCanvasNodeMediaPreflightBlocker[];
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

function lifecycleReport(value: MutableLifecycleReport): LegacyCanvasNodeMediaLifecycleReport {
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

function isNodeKind(value: unknown): value is CanvasNodeKind {
  return typeof value === 'string' && (NODE_KINDS as readonly string[]).includes(value);
}

function isMediaNodeKind(value: CanvasNodeKind): value is MediaNodeKind {
  return (MEDIA_NODE_KINDS as readonly string[]).includes(value);
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

function assetTargets(database: DatabaseSync): ReadonlyMap<string, unknown> {
  const targets = new Map<string, unknown>();
  const statement = database.prepare('SELECT hash, type FROM asset_contents ORDER BY hash');
  statement.setReadBigInts(true);
  for (const row of statement.iterate() as Iterable<AssetTargetRow>) {
    if (typeof row.hash === 'string') targets.set(row.hash, row.type);
  }
  return targets;
}

function shapeBlocker(
  context: AuditContext,
  path: string,
  expected: 'object' | 'array' | 'string',
  actual: unknown,
): void {
  context.blockers.push({
    kind: 'invalid_canvas_node_media_shape',
    table: 'canvas_nodes',
    column: 'data_json',
    rowKey: context.rowKey,
    lifecycle: context.lifecycle,
    nodeKind: context.nodeKind,
    path,
    expected,
    actual: actual === undefined ? 'missing' : valueType(actual),
  });
}

function auditHash(
  value: unknown,
  path: string,
  expectedType: MediaType,
  context: AuditContext,
): void {
  context.lifecycleReport.referenceCount += 1;
  if (typeof value !== 'string') {
    shapeBlocker(context, path, 'string', value);
    return;
  }
  if (!SHA256_PATTERN.test(value)) {
    context.blockers.push({
      kind: 'invalid_canvas_node_media_hash',
      table: 'canvas_nodes',
      column: 'data_json',
      rowKey: context.rowKey,
      lifecycle: context.lifecycle,
      nodeKind: context.nodeKind,
      path,
      value,
      reason: 'not_lowercase_sha256',
    });
    return;
  }
  context.lifecycleReport.hashes.add(value);
  context.allHashes.add(value);
  const targetExists = context.targets.has(value);
  const actualType = targetExists ? context.targets.get(value) : undefined;
  context.targetFingerprint.update(
    hashCanonical({
      rowKey: context.rowKey,
      path,
      hash: value,
      targetExists,
      targetType: targetExists ? rawValueFingerprint(actualType) : null,
    }),
  );
  if (!targetExists) {
    context.blockers.push({
      kind: 'missing_canvas_node_media_target',
      table: 'canvas_nodes',
      column: 'data_json',
      rowKey: context.rowKey,
      lifecycle: context.lifecycle,
      nodeKind: context.nodeKind,
      path,
      hash: value,
      expectedType,
    });
    return;
  }
  if (actualType !== expectedType) {
    context.blockers.push({
      kind: 'invalid_canvas_node_media_target',
      table: 'canvas_nodes',
      column: 'data_json',
      rowKey: context.rowKey,
      lifecycle: context.lifecycle,
      nodeKind: context.nodeKind,
      path,
      hash: value,
      expectedType,
      actualType: typeof actualType === 'string' ? actualType : valueType(actualType),
    });
  }
}

function auditOptionalHash(
  value: Record<string, unknown>,
  key: string,
  path: string,
  expectedType: MediaType,
  context: AuditContext,
): void {
  if (Object.hasOwn(value, key)) auditHash(value[key], path, expectedType, context);
}

function auditHashArray(
  value: unknown,
  path: string,
  expectedType: MediaType,
  context: AuditContext,
): void {
  if (!Array.isArray(value)) {
    shapeBlocker(context, path, 'array', value);
    return;
  }
  value.forEach((hash, index) => auditHash(hash, `${path}[${index}]`, expectedType, context));
}

function auditRootEntityReferences(
  value: Record<string, unknown>,
  key: (typeof ROOT_ENTITY_KEYS)[number],
  context: AuditContext,
): void {
  if (!Object.hasOwn(value, key)) return;
  const references = value[key];
  if (!Array.isArray(references)) {
    shapeBlocker(context, `$.${key}`, 'array', references);
    return;
  }
  references.forEach((reference, index) => {
    const path = `$.${key}[${index}]`;
    if (!isObject(reference)) {
      shapeBlocker(context, path, 'object', reference);
      return;
    }
    auditOptionalHash(
      reference,
      'referenceImageHash',
      `${path}.referenceImageHash`,
      'image',
      context,
    );
  });
}

function auditHistoryFrameReferences(
  history: Record<string, unknown>,
  path: string,
  context: AuditContext,
): void {
  if (!Object.hasOwn(history, 'frameReferenceHashes')) return;
  const frames = history.frameReferenceHashes;
  if (!isObject(frames)) {
    shapeBlocker(context, `${path}.frameReferenceHashes`, 'object', frames);
    return;
  }
  auditOptionalHash(frames, 'first', `${path}.frameReferenceHashes.first`, 'image', context);
  auditOptionalHash(frames, 'last', `${path}.frameReferenceHashes.last`, 'image', context);
}

function auditHistoryEntityReferences(
  history: Record<string, unknown>,
  key: (typeof ROOT_ENTITY_KEYS)[number],
  path: string,
  context: AuditContext,
): void {
  if (!Object.hasOwn(history, key)) return;
  const references = history[key];
  if (!Array.isArray(references)) {
    shapeBlocker(context, `${path}.${key}`, 'array', references);
    return;
  }
  references.forEach((reference, index) => {
    const referencePath = `${path}.${key}[${index}]`;
    if (!isObject(reference)) {
      shapeBlocker(context, referencePath, 'object', reference);
      return;
    }
    if (!Object.hasOwn(reference, 'imageHashes')) {
      shapeBlocker(context, `${referencePath}.imageHashes`, 'array', undefined);
      return;
    }
    auditHashArray(reference.imageHashes, `${referencePath}.imageHashes`, 'image', context);
  });
}

function auditGenerationHistory(
  value: Record<string, unknown>,
  mediaType: MediaType,
  context: AuditContext,
): void {
  if (!Object.hasOwn(value, 'generationHistory')) return;
  const history = value.generationHistory;
  if (!Array.isArray(history)) {
    shapeBlocker(context, '$.generationHistory', 'array', history);
    return;
  }
  history.forEach((entry, index) => {
    const path = `$.generationHistory[${index}]`;
    if (!isObject(entry)) {
      shapeBlocker(context, path, 'object', entry);
      return;
    }
    if (!Object.hasOwn(entry, 'assetHash')) {
      shapeBlocker(context, `${path}.assetHash`, 'string', undefined);
    } else {
      auditHash(entry.assetHash, `${path}.assetHash`, mediaType, context);
    }
    auditOptionalHash(entry, 'sourceImageHash', `${path}.sourceImageHash`, 'image', context);
    auditHistoryFrameReferences(entry, path, context);
    for (const key of ROOT_ENTITY_KEYS) {
      auditHistoryEntityReferences(entry, key, path, context);
    }
  });
}

function allowedRootMediaKeys(nodeKind: CanvasNodeKind): ReadonlySet<string> {
  if (nodeKind === 'text' || nodeKind === 'backdrop') return new Set<string>();
  if (nodeKind === 'audio') return new Set(['assetHash', 'variants', 'generationHistory']);
  const keys = new Set<string>([
    'assetHash',
    'variants',
    'sourceImageHash',
    'characterRefs',
    'equipmentRefs',
    'locationRefs',
    'generationHistory',
  ]);
  if (nodeKind === 'video') {
    keys.add('firstFrameAssetHash');
    keys.add('lastFrameAssetHash');
  }
  return keys;
}

function auditDisallowedMediaPaths(value: Record<string, unknown>, context: AuditContext): void {
  const allowed = allowedRootMediaKeys(context.nodeKind);
  for (const key of ROOT_MEDIA_KEYS) {
    if (Object.hasOwn(value, key) && !allowed.has(key)) {
      context.blockers.push({
        kind: 'canvas_node_media_path_not_allowed',
        table: 'canvas_nodes',
        column: 'data_json',
        rowKey: context.rowKey,
        lifecycle: context.lifecycle,
        nodeKind: context.nodeKind,
        path: `$.${key}`,
      });
    }
  }
}

function auditDocument(value: Record<string, unknown>, context: AuditContext): void {
  auditDisallowedMediaPaths(value, context);
  if (!isMediaNodeKind(context.nodeKind)) return;
  auditOptionalHash(value, 'assetHash', '$.assetHash', context.nodeKind, context);
  if (Object.hasOwn(value, 'variants')) {
    auditHashArray(value.variants, '$.variants', context.nodeKind, context);
  }
  if (context.nodeKind !== 'audio') {
    auditOptionalHash(value, 'sourceImageHash', '$.sourceImageHash', 'image', context);
    for (const key of ROOT_ENTITY_KEYS) auditRootEntityReferences(value, key, context);
  }
  if (context.nodeKind === 'video') {
    auditOptionalHash(value, 'firstFrameAssetHash', '$.firstFrameAssetHash', 'image', context);
    auditOptionalHash(value, 'lastFrameAssetHash', '$.lastFrameAssetHash', 'image', context);
  }
  auditGenerationHistory(value, context.nodeKind, context);
}

/**
 * Read-only audit of the explicit media-reference paths in Legacy Canvas node
 * payloads. Unknown keys are intentionally not traversed.
 */
export function preflightLegacyCanvasNodeMedia(
  database: DatabaseSync,
): LegacyCanvasNodeMediaPreflightReport {
  const targets = assetTargets(database);
  const blockers: LegacyCanvasNodeMediaPreflightBlocker[] = [];
  const allHashes = new Set<string>();
  const inputFingerprint = createHash('sha256');
  const targetFingerprint = createHash('sha256');
  const mutableByKind = new Map<CanvasNodeKind, MutableKindReport>(
    NODE_KINDS.map((nodeKind) => [
      nodeKind,
      { nodeKind, active: emptyLifecycleReport(), archived: emptyLifecycleReport() },
    ]),
  );
  const statement = database.prepare(
    `SELECT node.id, node.canvas_id, node.type, node.data_json, canvas.archived_at
       FROM canvas_nodes node
       LEFT JOIN canvases canvas ON canvas.id = node.canvas_id
      ORDER BY node.canvas_id, node.id`,
  );
  statement.setReadBigInts(true);
  let nodeCount = 0;
  let archivedNodeCount = 0;
  let documentCount = 0;
  let unsupportedNodeCount = 0;

  for (const row of statement.iterate() as Iterable<CanvasNodeRow>) {
    nodeCount += 1;
    const lifecycle: CanvasLifecycle = row.archived_at === null ? 'active' : 'archived';
    if (lifecycle === 'archived') archivedNodeCount += 1;
    const rowKey = hashCanonical({
      table: 'canvas_nodes',
      canvasId: rawValueFingerprint(row.canvas_id),
      id: rawValueFingerprint(row.id),
    });
    const nodeKind = typeof row.type === 'string' ? row.type : null;
    inputFingerprint.update(
      hashCanonical({
        rowKey,
        lifecycle,
        archivedAt: rawValueFingerprint(row.archived_at),
        nodeType: rawValueFingerprint(row.type),
        dataJson: rawValueFingerprint(row.data_json),
      }),
    );

    const supportedNodeKind = isNodeKind(row.type) ? row.type : null;
    const kindReport =
      supportedNodeKind === null ? undefined : mutableByKind.get(supportedNodeKind);
    const currentLifecycleReport =
      kindReport === undefined
        ? undefined
        : lifecycle === 'active'
          ? kindReport.active
          : kindReport.archived;
    if (currentLifecycleReport) currentLifecycleReport.rowCount += 1;
    if (supportedNodeKind === null) {
      unsupportedNodeCount += 1;
      blockers.push({
        kind: 'unsupported_canvas_node_type',
        table: 'canvas_nodes',
        column: 'type',
        rowKey,
        lifecycle,
        path: '$column.type',
        actual: valueType(row.type),
        ...(typeof row.type === 'string' ? { value: row.type } : {}),
      });
    }

    if (row.data_json === null) {
      if (currentLifecycleReport) currentLifecycleReport.nullValueCount += 1;
      blockers.push({
        kind: 'invalid_canvas_node_media_document',
        table: 'canvas_nodes',
        column: 'data_json',
        rowKey,
        lifecycle,
        nodeKind,
        path: '$',
        reason: 'null_document',
      });
      continue;
    }
    if (row.data_json === '') {
      if (currentLifecycleReport) currentLifecycleReport.emptyValueCount += 1;
      blockers.push({
        kind: 'invalid_canvas_node_media_document',
        table: 'canvas_nodes',
        column: 'data_json',
        rowKey,
        lifecycle,
        nodeKind,
        path: '$',
        reason: 'empty_document',
      });
      continue;
    }
    documentCount += 1;
    if (currentLifecycleReport) currentLifecycleReport.documentCount += 1;
    if (typeof row.data_json !== 'string') {
      blockers.push({
        kind: 'invalid_canvas_node_media_document',
        table: 'canvas_nodes',
        column: 'data_json',
        rowKey,
        lifecycle,
        nodeKind,
        path: '$',
        reason: 'not_text',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data_json);
    } catch {
      blockers.push({
        kind: 'invalid_canvas_node_media_document',
        table: 'canvas_nodes',
        column: 'data_json',
        rowKey,
        lifecycle,
        nodeKind,
        path: '$',
        reason: 'invalid_json',
      });
      continue;
    }
    if (!isObject(parsed)) {
      blockers.push({
        kind: 'invalid_canvas_node_media_document',
        table: 'canvas_nodes',
        column: 'data_json',
        rowKey,
        lifecycle,
        nodeKind,
        path: '$',
        reason: 'not_object',
      });
      continue;
    }
    if (supportedNodeKind === null || currentLifecycleReport === undefined) continue;

    auditDocument(parsed, {
      rowKey,
      lifecycle,
      nodeKind: supportedNodeKind,
      targets,
      lifecycleReport: currentLifecycleReport,
      allHashes,
      targetFingerprint,
      blockers,
    });
  }

  const byNodeKind = NODE_KINDS.map((nodeKind): LegacyCanvasNodeMediaKindReport => {
    const report = mutableByKind.get(nodeKind)!;
    return {
      nodeKind,
      active: lifecycleReport(report.active),
      archived: lifecycleReport(report.archived),
    };
  });
  const referenceCount = byNodeKind.reduce(
    (total, report) => total + report.active.referenceCount + report.archived.referenceCount,
    0,
  );
  return {
    coverage: LEGACY_CANVAS_NODE_MEDIA_COVERAGE,
    nodeCount,
    archivedNodeCount,
    documentCount,
    referenceCount,
    distinctHashCount: allHashes.size,
    unsupportedNodeCount,
    byNodeKind,
    fingerprint: hashCanonical({
      coverage: LEGACY_CANVAS_NODE_MEDIA_COVERAGE,
      inputFingerprint: inputFingerprint.digest('hex'),
      targetFingerprint: targetFingerprint.digest('hex'),
      nodeCount,
      archivedNodeCount,
      documentCount,
      referenceCount,
      distinctHashCount: allHashes.size,
      unsupportedNodeCount,
      byNodeKind,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
