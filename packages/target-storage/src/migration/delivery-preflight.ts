import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';
import {
  validateOrderedDeliverySequence,
  validateOrderedDeliveryVideoTarget,
  type OrderedDeliverySequenceInvalidReason,
} from './ordered-delivery-sequence.js';

export const LEGACY_DELIVERY_MEDIA_PATHS = [
  '$.revision',
  '$.items[*].shotId',
  '$.items[*].selectedVideoHash',
  '$.items[*].trimInMs',
  '$.items[*].trimOutMs',
  '$.items[*].embeddedAudioEnabled',
  '$.updatedAt',
] as const;

export type LegacyDeliveryPreflightBlocker =
  | {
      readonly kind: 'invalid_delivery_sequence';
      readonly table: 'canvases';
      readonly column: 'delivery_sequence_json';
      readonly rowKey: string;
      readonly path: string;
      readonly reason: OrderedDeliverySequenceInvalidReason;
      readonly actual?: string;
    }
  | {
      readonly kind: 'missing_delivery_video_target';
      readonly table: 'canvases';
      readonly column: 'delivery_sequence_json';
      readonly rowKey: string;
      readonly path: string;
      readonly hash: string;
    }
  | {
      readonly kind: 'invalid_delivery_video_target';
      readonly table: 'canvases';
      readonly column: 'delivery_sequence_json';
      readonly rowKey: string;
      readonly path: string;
      readonly hash: string;
      readonly reason:
        | 'not_video'
        | 'duration_unavailable'
        | 'trim_exceeds_duration'
        | 'embedded_audio_unconfirmed';
    }
  | {
      readonly kind: 'delivery_asset_ref_set_mismatch';
      readonly table: 'canvases';
      readonly column: 'delivery_sequence_json';
      readonly rowKey: string;
      readonly missingFromMirror: readonly string[];
      readonly extraInMirror: readonly string[];
    };

export interface LegacyDeliveryPreflightReport {
  readonly coverage: Readonly<{
    source: 'canvases.delivery_sequence_json';
    paths: typeof LEGACY_DELIVERY_MEDIA_PATHS;
    mirror: 'delivery_asset_refs.asset_hash';
    includesArchivedCanvases: true;
  }>;
  readonly canvasCount: number;
  readonly archivedCanvasCount: number;
  readonly documentCount: number;
  readonly validDocumentCount: number;
  readonly nullDocumentCount: number;
  readonly emptyValueCount: number;
  readonly itemCount: number;
  readonly referenceCount: number;
  readonly distinctHashCount: number;
  readonly fingerprint: string;
  readonly blockers: readonly LegacyDeliveryPreflightBlocker[];
  readonly ok: boolean;
}

interface CanvasRow {
  readonly id: unknown;
  readonly archived_at: unknown;
  readonly delivery_sequence_json: unknown;
  readonly delivery_sequence_revision: unknown;
}

interface DeliveryAssetRefRow {
  readonly asset_hash: unknown;
}

interface AssetFactRow {
  readonly type: unknown;
  readonly duration: unknown;
  readonly has_audio: unknown;
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

function invalid(
  blockers: LegacyDeliveryPreflightBlocker[],
  rowKey: string,
  path: string,
  reason: OrderedDeliverySequenceInvalidReason,
  actual?: string,
): void {
  blockers.push({
    kind: 'invalid_delivery_sequence',
    table: 'canvases',
    column: 'delivery_sequence_json',
    rowKey,
    path,
    reason,
    ...(actual === undefined ? {} : { actual }),
  });
}

/**
 * Read-only audit of Legacy Delivery sequence media references, their exact
 * mirror set, and the video facts required by the current Delivery contract.
 */
export function preflightLegacyDelivery(database: DatabaseSync): LegacyDeliveryPreflightReport {
  const blockers: LegacyDeliveryPreflightBlocker[] = [];
  const allHashes = new Set<string>();
  const inputFingerprint = createHash('sha256');
  const canvasStatement = database.prepare(
    `SELECT id, archived_at, delivery_sequence_json, delivery_sequence_revision
       FROM canvases
      ORDER BY id`,
  );
  canvasStatement.setReadBigInts(true);
  const refsStatement = database.prepare(
    `SELECT asset_hash
       FROM delivery_asset_refs
      WHERE canvas_id = ?
      ORDER BY asset_hash`,
  );
  const assetStatement = database.prepare(
    'SELECT type, duration, has_audio FROM asset_contents WHERE hash = ?',
  );
  assetStatement.setReadBigInts(true);
  let canvasCount = 0;
  let archivedCanvasCount = 0;
  let documentCount = 0;
  let validDocumentCount = 0;
  let nullDocumentCount = 0;
  let emptyValueCount = 0;
  let itemCount = 0;
  let referenceCount = 0;

  for (const row of canvasStatement.iterate() as Iterable<CanvasRow>) {
    canvasCount += 1;
    if (row.archived_at !== null) archivedCanvasCount += 1;
    const rowKey = hashCanonical({ table: 'canvases', id: rawValueFingerprint(row.id) });
    const validation = validateOrderedDeliverySequence(
      row.delivery_sequence_json,
      row.delivery_sequence_revision,
    );
    for (const issue of validation.issues) {
      invalid(blockers, rowKey, issue.path, issue.reason, issue.actual);
    }
    inputFingerprint.update(
      hashCanonical({
        rowKey,
        archivedAt: rawValueFingerprint(row.archived_at),
        columnRevision: rawValueFingerprint(row.delivery_sequence_revision),
        document: rawValueFingerprint(row.delivery_sequence_json),
      }),
    );
    if (typeof row.id !== 'string') {
      invalid(blockers, rowKey, '$row.id', 'not_string', valueType(row.id));
      continue;
    }
    const mirrorRows = [...(refsStatement.iterate(row.id) as Iterable<DeliveryAssetRefRow>)];
    const mirrorRefs = mirrorRows.flatMap((ref) =>
      typeof ref.asset_hash === 'string' ? [ref.asset_hash] : [],
    );
    const mirrorHashes = new Set(mirrorRefs);
    inputFingerprint.update(
      hashCanonical({
        rowKey,
        mirrorRefs: mirrorRows.map((ref) => rawValueFingerprint(ref.asset_hash)),
      }),
    );

    if (row.delivery_sequence_json === null) {
      nullDocumentCount += 1;
      if (mirrorHashes.size > 0) {
        blockers.push({
          kind: 'delivery_asset_ref_set_mismatch',
          table: 'canvases',
          column: 'delivery_sequence_json',
          rowKey,
          missingFromMirror: [],
          extraInMirror: [...mirrorHashes].sort(),
        });
      }
      continue;
    }

    documentCount += 1;
    if (row.delivery_sequence_json === '') emptyValueCount += 1;
    const document = validation.document;
    if (!document) continue;

    validDocumentCount += 1;
    itemCount += document.items.length;
    referenceCount += document.items.length;
    const selectedHashes = new Set(document.items.map((item) => item.selectedVideoHash));
    for (const item of document.items) {
      allHashes.add(item.selectedVideoHash);
      const asset = assetStatement.get(item.selectedVideoHash) as AssetFactRow | undefined;
      inputFingerprint.update(
        hashCanonical({
          rowKey,
          path: item.path,
          hash: item.selectedVideoHash,
          asset:
            asset === undefined
              ? null
              : {
                  type: rawValueFingerprint(asset.type),
                  duration: rawValueFingerprint(asset.duration),
                  hasAudio: rawValueFingerprint(asset.has_audio),
                },
        }),
      );
      const targetIssues = validateOrderedDeliveryVideoTarget(
        item,
        asset
          ? { type: asset.type, duration: asset.duration, hasAudio: asset.has_audio }
          : undefined,
      );
      for (const issue of targetIssues) {
        if (issue.kind === 'missing') {
          blockers.push({
            kind: 'missing_delivery_video_target',
            table: 'canvases',
            column: 'delivery_sequence_json',
            rowKey,
            path: issue.path,
            hash: item.selectedVideoHash,
          });
        } else {
          blockers.push({
            kind: 'invalid_delivery_video_target',
            table: 'canvases',
            column: 'delivery_sequence_json',
            rowKey,
            path: issue.path,
            hash: item.selectedVideoHash,
            reason: issue.reason,
          });
        }
      }
    }

    const missingFromMirror = [...selectedHashes].filter((hash) => !mirrorHashes.has(hash)).sort();
    const extraInMirror = [...mirrorHashes].filter((hash) => !selectedHashes.has(hash)).sort();
    if (missingFromMirror.length > 0 || extraInMirror.length > 0) {
      blockers.push({
        kind: 'delivery_asset_ref_set_mismatch',
        table: 'canvases',
        column: 'delivery_sequence_json',
        rowKey,
        missingFromMirror,
        extraInMirror,
      });
    }
  }

  const coverage = {
    source: 'canvases.delivery_sequence_json',
    paths: LEGACY_DELIVERY_MEDIA_PATHS,
    mirror: 'delivery_asset_refs.asset_hash',
    includesArchivedCanvases: true,
  } as const;
  return {
    coverage,
    canvasCount,
    archivedCanvasCount,
    documentCount,
    validDocumentCount,
    nullDocumentCount,
    emptyValueCount,
    itemCount,
    referenceCount,
    distinctHashCount: allHashes.size,
    fingerprint: hashCanonical({
      coverage,
      inputFingerprint: inputFingerprint.digest('hex'),
      canvasCount,
      archivedCanvasCount,
      documentCount,
      validDocumentCount,
      nullDocumentCount,
      emptyValueCount,
      itemCount,
      referenceCount,
      distinctHashCount: allHashes.size,
      blockers,
    }),
    blockers,
    ok: blockers.length === 0,
  };
}
