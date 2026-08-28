import {
  MediaPreviewIssueInputV1Schema,
  canonicalJson,
  parseCanonical,
  type MediaPreviewIssueInputV1,
  type MediaPreviewSourceV1,
} from '@lucid-fin/contracts';
import { getStoreDatabase } from '../internal/database-access.js';
import {
  artifactForMediaBlob,
  loadGlobalMediaAsset,
  loadMediaBlob,
  loadProjectMediaRecord,
} from '../internal/media-records.js';
import { loadGeneratedResultRecord } from '../internal/operation-owner-records.js';
import {
  openVerifiedMediaCasRange,
  type MediaCas,
  type MediaCasByteRange,
} from '../kernel/media-cas.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';

export interface MediaPreviewSource {
  readonly kind: 'image' | 'video' | 'audio';
  readonly mimeType: string;
  readonly byteLength: number;
  verify(): Promise<void>;
  /**
   * Verifies its CAS object before yielding the first byte, so GET has one integrity boundary.
   */
  open(range: MediaCasByteRange): AsyncIterable<Uint8Array>;
}

export interface MediaPreviewSourceResolver {
  resolve(input: MediaPreviewIssueInputV1): MediaPreviewSource;
}

function unavailableSource(): never {
  throw new StorageError('NOT_FOUND', 'Media preview source was not found');
}

function corrupt(message: string): never {
  throw new StorageError('CORRUPT_DATA', message);
}

function requireProject(database: ReturnType<typeof getStoreDatabase>, projectId: string): void {
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    unavailableSource();
  }
}

function previewableKind(value: string): 'image' | 'video' | 'audio' {
  if (value === 'image' || value === 'video' || value === 'audio') return value;
  return corrupt('Media preview source does not have a previewable media kind');
}

function normalizePreviewMimeType(kind: 'image' | 'video' | 'audio', value: string): string {
  const match =
    /^\s*([A-Za-z0-9!#$&^_.+-]+)\/([A-Za-z0-9!#$&^_.+-]+)(?:\s*;[\x20-\x7e]+)?\s*$/u.exec(value);
  if (match === null || match[1]!.toLowerCase() !== kind) {
    return corrupt('Media preview MIME type does not match its media kind');
  }
  return `${kind}/${match[2]!.toLowerCase()}`;
}

function sourceForBlob(
  mediaCas: MediaCas,
  value: { readonly hash: string; readonly byteLength: number; readonly mimeType: string },
  kind: string,
): MediaPreviewSource {
  const expected = Object.freeze({ hash: value.hash, byteLength: value.byteLength });
  const previewKind = previewableKind(kind);
  return Object.freeze({
    kind: previewKind,
    mimeType: normalizePreviewMimeType(previewKind, value.mimeType),
    byteLength: value.byteLength,
    verify: () => mediaCas.verify(expected),
    open: (range: MediaCasByteRange) => openVerifiedMediaCasRange(mediaCas, expected, range),
  });
}

function resolveProjectMedia(
  database: ReturnType<typeof getStoreDatabase>,
  mediaCas: MediaCas,
  projectId: string,
  source: Extract<MediaPreviewSourceV1, { readonly kind: 'project_media_ref' }>,
): MediaPreviewSource {
  const ref = loadProjectMediaRecord(database, source.ref.id);
  if (
    ref.projectId !== projectId ||
    ref.lifecycle !== 'active' ||
    ref.revision !== source.ref.revision ||
    ref.contentHash !== source.ref.contentHash
  ) {
    return unavailableSource();
  }
  const asset = loadGlobalMediaAsset(database, ref.globalAssetId);
  const blob = loadMediaBlob(database, asset.blobHash);
  if (asset.kind !== blob.technicalFacts.kind) {
    return corrupt(`Project Media ${ref.id} does not match its Media Blob`);
  }
  return sourceForBlob(mediaCas, blob, asset.kind);
}

function resolveGeneratedResult(
  database: ReturnType<typeof getStoreDatabase>,
  mediaCas: MediaCas,
  projectId: string,
  source: Extract<MediaPreviewSourceV1, { readonly kind: 'generated_result' }>,
): MediaPreviewSource {
  const result = loadGeneratedResultRecord(database, source.result.id);
  if (
    result.projectId !== projectId ||
    result.revision !== source.result.revision ||
    result.contentHash !== source.result.contentHash
  ) {
    return unavailableSource();
  }
  const projectMedia = loadProjectMediaRecord(database, result.projectMediaRefId);
  const asset = loadGlobalMediaAsset(database, result.globalMediaAssetId);
  const blob = loadMediaBlob(database, result.mediaBlobHash);
  if (
    projectMedia.projectId !== projectId ||
    projectMedia.lifecycle !== 'active' ||
    projectMedia.globalAssetId !== asset.id ||
    asset.blobHash !== blob.hash ||
    asset.kind !== result.mediaKind ||
    blob.technicalFacts.kind !== result.mediaKind
  ) {
    return corrupt(`Generated Result ${result.id} media ownership does not match its artifact`);
  }
  const artifact = artifactForMediaBlob(
    database,
    result.id,
    result.mediaBlobHash,
    result.mediaKind,
  );
  if (canonicalJson(artifact) !== canonicalJson(source.artifact)) return unavailableSource();
  return sourceForBlob(mediaCas, blob, result.mediaKind);
}

export function createMediaPreviewSourceResolver(
  store: Store,
  mediaCas: MediaCas,
): MediaPreviewSourceResolver {
  return Object.freeze({
    resolve(inputValue: MediaPreviewIssueInputV1) {
      const input = parseCanonical(MediaPreviewIssueInputV1Schema, inputValue);
      const database = getStoreDatabase(store);
      requireProject(database, input.projectId);
      return input.source.kind === 'project_media_ref'
        ? resolveProjectMedia(database, mediaCas, input.projectId, input.source)
        : resolveGeneratedResult(database, mediaCas, input.projectId, input.source);
    },
  });
}
