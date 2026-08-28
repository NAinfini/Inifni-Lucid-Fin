import {
  EntityIdSchema,
  IsoTimestampSchema,
  MediaQueryDefinition,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
  type GlobalMediaAsset,
  type MediaBlob,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import {
  loadGlobalMediaAsset,
  loadMediaBlob,
  loadProjectMediaRecord,
} from '../internal/media-records.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';

export type MediaQueryInput = ReturnType<typeof MediaQueryDefinition.parseInput>;
export type MediaQuerySuccess = ReturnType<typeof MediaQueryDefinition.parseSuccess>;
type MediaQueryItem = MediaQuerySuccess['items'][number];

const MediaQueryCursorSchema = strictObject({
  filterHash: Sha256Schema,
  updatedAt: IsoTimestampSchema,
  id: EntityIdSchema,
});

interface OrderedMediaItem {
  readonly id: string;
  readonly updatedAt: string;
  readonly item: MediaQueryItem;
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function requireProject(database: DatabaseSync, value: string): string {
  const projectId = parseCanonical(EntityIdSchema, value);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new StorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  return projectId;
}

function encodeMediaQueryCursor(value: z.input<typeof MediaQueryCursorSchema>): string {
  return encodeCursor('media.query', canonicalJson(parseCanonical(MediaQueryCursorSchema, value)));
}

function decodeMediaQueryCursor(cursor: string | null) {
  const value = decodeCursor(cursor, 'media.query');
  if (value === null) return null;
  try {
    return parseCanonical(MediaQueryCursorSchema, JSON.parse(value) as unknown);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Media query cursor is invalid', { cause });
  }
}

function compareNewestFirst(
  left: Pick<OrderedMediaItem, 'updatedAt' | 'id'>,
  right: Pick<OrderedMediaItem, 'updatedAt' | 'id'>,
): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}

function matchesQuery(query: string, values: readonly string[]): boolean {
  if (query.length === 0) return true;
  const normalized = query.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function matchesBaseFilters(
  input: MediaQueryInput,
  asset: GlobalMediaAsset,
  blob: MediaBlob,
): boolean {
  return (
    (input.globalAssetIds.length === 0 || input.globalAssetIds.includes(asset.id)) &&
    (input.blobHashes.length === 0 || input.blobHashes.includes(blob.hash)) &&
    (input.mediaKinds.length === 0 || input.mediaKinds.includes(asset.kind)) &&
    (input.tags.length === 0 || asset.tags.some((tag) => input.tags.includes(tag))) &&
    (input.integrity.length === 0 || input.integrity.includes('unknown'))
  );
}

function loadAssetAndBlob(database: DatabaseSync, globalAssetId: string) {
  const asset = loadGlobalMediaAsset(database, globalAssetId);
  const blob = loadMediaBlob(database, asset.blobHash);
  if (blob.hash !== asset.blobHash || blob.technicalFacts.kind !== asset.kind) {
    throw corrupt(`Global Media Asset ${asset.id} does not match its Media Blob`);
  }
  return { asset, blob };
}

// ponytail: scan catalog IDs so every candidate uses canonical loaders; push filters into SQL if profiling requires it.
function projectItems(
  database: DatabaseSync,
  projectId: string,
  input: MediaQueryInput,
): OrderedMediaItem[] {
  const rows = database
    .prepare(
      `SELECT id
       FROM project_media_refs
       WHERE project_id = ? AND lifecycle = 'active'`,
    )
    .all(projectId) as unknown as Array<{ id: string }>;
  return rows.flatMap(({ id }) => {
    const ref = loadProjectMediaRecord(database, id);
    if (ref.projectId !== projectId || ref.lifecycle !== 'active') {
      throw corrupt(`Project Media reference ${ref.id} no longer matches its query row`);
    }
    const { asset, blob } = loadAssetAndBlob(database, ref.globalAssetId);
    const matches =
      matchesBaseFilters(input, asset, blob) &&
      (input.projectMediaRefIds.length === 0 || input.projectMediaRefIds.includes(ref.id)) &&
      (input.roles.length === 0 || ref.roles.some((role) => input.roles.includes(role))) &&
      matchesQuery(input.query, [
        asset.displayName,
        asset.filename,
        ...asset.tags,
        ref.label,
        ref.notes,
        ...ref.collections,
      ]);
    if (!matches) return [];
    return [
      {
        id: ref.id,
        updatedAt: ref.updatedAt,
        item: {
          scope: 'project',
          globalAssetId: asset.id,
          projectMediaRef: {
            authority: 'project_media_ref',
            id: ref.id,
            revision: ref.revision,
            contentHash: ref.contentHash,
          },
          blobHash: blob.hash,
          kind: asset.kind,
          displayName: asset.displayName,
          tags: asset.tags,
          roles: ref.roles,
          integrity: 'unknown',
        },
      },
    ];
  });
}

function globalItems(database: DatabaseSync, input: MediaQueryInput): OrderedMediaItem[] {
  const rows = database.prepare('SELECT id FROM global_media_assets').all() as unknown as Array<{
    id: string;
  }>;
  return rows.flatMap(({ id }) => {
    const { asset, blob } = loadAssetAndBlob(database, id);
    if (
      !matchesBaseFilters(input, asset, blob) ||
      !matchesQuery(input.query, [asset.displayName, asset.filename, ...asset.tags])
    ) {
      return [];
    }
    return [
      {
        id: asset.id,
        updatedAt: asset.updatedAt,
        item: {
          scope: 'global',
          globalAssetId: asset.id,
          projectMediaRef: null,
          blobHash: blob.hash,
          kind: asset.kind,
          displayName: asset.displayName,
          tags: asset.tags,
          roles: [],
          integrity: 'unknown',
        },
      },
    ];
  });
}

export interface MediaQueryReadModel {
  readonly query: (projectId: string, input: MediaQueryInput) => MediaQuerySuccess;
}

export function createMediaQueryReadModel(store: Store): MediaQueryReadModel {
  return Object.freeze({
    query(projectIdValue: string, inputValue: MediaQueryInput) {
      const input = MediaQueryDefinition.parseInput(inputValue);
      const database = getStoreDatabase(store);
      const projectId = requireProject(database, projectIdValue);
      const filterHash = hashCanonical({
        projectId,
        scope: input.scope,
        globalAssetIds: input.globalAssetIds,
        projectMediaRefIds: input.projectMediaRefIds,
        blobHashes: input.blobHashes,
        mediaKinds: input.mediaKinds,
        tags: input.tags,
        roles: input.roles,
        integrity: input.integrity,
        query: input.query,
      });
      const cursor = decodeMediaQueryCursor(input.page.cursor);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new StorageError('INVALID_REQUEST', 'Media query cursor belongs to another query');
      }
      if (
        (input.integrity.length > 0 && !input.integrity.includes('unknown')) ||
        (input.scope === 'global' &&
          (input.projectMediaRefIds.length > 0 || input.roles.length > 0))
      ) {
        return MediaQueryDefinition.parseSuccess({ items: [], nextCursor: null });
      }
      const candidates =
        input.scope === 'project'
          ? projectItems(database, projectId, input)
          : globalItems(database, input);
      candidates.sort(compareNewestFirst);
      const afterCursor =
        cursor === null
          ? candidates
          : candidates.filter((candidate) => compareNewestFirst(candidate, cursor) > 0);
      const page = afterCursor.slice(0, input.page.limit);
      const last = page.at(-1);
      return MediaQueryDefinition.parseSuccess({
        items: page.map(({ item }) => item),
        nextCursor:
          afterCursor.length > page.length && last !== undefined
            ? encodeMediaQueryCursor({ filterHash, updatedAt: last.updatedAt, id: last.id })
            : null,
      });
    },
  });
}
