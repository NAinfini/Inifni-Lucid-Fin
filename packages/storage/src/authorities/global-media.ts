import {
  CountSchema,
  EntityIdSchema,
  GlobalMediaAssetSchema,
  IsoTimestampSchema,
  MediaTechnicalFactsSchema,
  OpaqueCapabilityTokenV1Schema,
  Sha256Schema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type GlobalMediaAsset,
  type GlobalMediaFolder,
  type MediaBlob,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  executeWireMutation,
  readWireMutationReceipt,
  type CommandContext,
} from '../internal/command.js';
import {
  decodeCursor as decodeOpaqueCursor,
  encodeCursor as encodeOpaqueCursor,
} from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  insertOrValidateMediaBlob,
  insertGlobalMediaAsset,
  listGlobalMediaFolders,
  loadGlobalMediaAsset,
  loadGlobalMediaFolder,
  loadMediaBlob,
} from '../internal/media-records.js';
import { StorageError } from '../kernel/errors.js';
import type {
  MediaCas,
  MediaImportCapabilityResolver,
  MediaImportDescriptor,
} from '../kernel/media-cas.js';
import type { Store } from '../kernel/store.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];

const MediaImportDescriptorSchema = strictObject({
  capabilityToken: OpaqueCapabilityTokenV1Schema,
  importId: EntityIdSchema,
  originalFileName: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine((value) => !/[\\/]/u.test(value), 'Original filename must be a leaf filename'),
  blobHash: Sha256Schema,
  byteLength: CountSchema,
  mimeType: z.string().trim().min(1).max(160),
  technicalFacts: MediaTechnicalFactsSchema,
});
const DisplayNameSchema = z.string().trim().min(1).max(240);
const GlobalMediaListCursorSchema = strictObject({
  kind: z.literal('global_media_list'),
  filterHash: Sha256Schema,
  updatedAt: IsoTimestampSchema,
  id: EntityIdSchema,
});

interface OrderedAssetRow {
  id: string;
  updated_at: string;
}

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) {
    throw new StorageError('INVALID_REQUEST', `Expected Wire method ${method}`);
  }
  return request as Request<Method>;
}

function success<Method extends WireSuccessV1['method']>(
  request: Request<Method>,
  result: unknown,
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as Success<Method>;
}

function parseImportDescriptor(value: unknown): MediaImportDescriptor {
  try {
    return parseCanonical(MediaImportDescriptorSchema, value) as MediaImportDescriptor;
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Resolved Media descriptor is invalid', {
      cause,
    });
  }
}

function resolveDisplayName(value: string): string {
  try {
    return parseCanonical(DisplayNameSchema, value);
  } catch (cause) {
    throw new StorageError(
      'INVALID_REQUEST',
      'A display name is required when the original filename is longer than 240 characters',
      { cause },
    );
  }
}

function encodeCursor(value: unknown): string {
  return encodeOpaqueCursor('media.global.list', canonicalJson(value));
}

function decodeCursor(cursor: string): z.output<typeof GlobalMediaListCursorSchema> {
  try {
    const key = decodeOpaqueCursor(cursor, 'media.global.list');
    if (key === null) throw new Error('Missing cursor key');
    return parseCanonical(GlobalMediaListCursorSchema, JSON.parse(key) as unknown);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Global Media cursor is invalid', { cause });
  }
}

function view(database: DatabaseSync, id: string) {
  const asset = loadGlobalMediaAsset(database, id);
  const blob = loadMediaBlob(database, asset.blobHash);
  return { asset, byteLength: blob.byteLength, mimeType: blob.mimeType };
}

function escapeLike(value: string): string {
  return `%${value.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

function referencedTable(database: DatabaseSync, globalAssetId: string): string | undefined {
  const checks = [
    ['project_media_refs', 'global_asset_id'],
    ['media_derivation_outputs', 'global_asset_id'],
    ['generated_results', 'global_asset_id'],
  ] as const;
  for (const [table, column] of checks) {
    if (database.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(globalAssetId)) {
      return table;
    }
  }
  return undefined;
}

export interface GlobalMediaAuthority {
  readonly importGlobal: (
    request: Request<'media.global.import'>,
    context: CommandContext,
  ) => Promise<Success<'media.global.import'>>;
  readonly listGlobal: (request: Request<'media.global.list'>) => Success<'media.global.list'>;
  readonly removeGlobal: (
    request: Request<'media.global.remove'>,
    context: CommandContext,
  ) => Success<'media.global.remove'>;
  readonly getAsset: (globalAssetId: string) => GlobalMediaAsset;
  readonly getBlob: (blobHash: string) => MediaBlob;
  readonly getFolder: (folderId: string) => GlobalMediaFolder;
  readonly listFolders: () => readonly GlobalMediaFolder[];
}

export function createGlobalMediaAuthority(
  store: Store,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  mediaImportCapabilities: MediaImportCapabilityResolver,
): GlobalMediaAuthority {
  const authority: GlobalMediaAuthority = {
    async importGlobal(requestValue, context) {
      const request = exactRequest(requestValue, 'media.global.import');
      const receipt = readWireMutationReceipt<
        Request<'media.global.import'>,
        Success<'media.global.import'>
      >(getStoreDatabase(store), request, context);
      if (receipt !== undefined) return receipt;

      const resolved = await mediaImportCapabilities.resolve(request.input.capabilityToken);
      if (
        typeof resolved !== 'object' ||
        resolved === null ||
        typeof resolved.openBytes !== 'function'
      ) {
        throw new StorageError('INVALID_REQUEST', 'Resolved Media capability is invalid');
      }
      const descriptor = parseImportDescriptor(resolved.descriptor);
      if (descriptor.capabilityToken !== request.input.capabilityToken) {
        throw new StorageError(
          'INVALID_REQUEST',
          'Resolved Media capability does not match the requested token',
        );
      }
      const displayName = resolveDisplayName(
        request.input.displayName ?? descriptor.originalFileName,
      );
      const expected = { hash: descriptor.blobHash, byteLength: descriptor.byteLength };
      const stored = await mediaCas.putVerified(expected, resolved.openBytes());
      if (stored.hash !== expected.hash || stored.byteLength !== expected.byteLength) {
        throw new StorageError('CORRUPT_DATA', 'Media CAS returned a different object');
      }
      await mediaCas.verify(expected);

      const committedAt = environment.now();
      return executeWireMutation(getStoreDatabase(store), request, context, committedAt, () => {
        const database = getStoreDatabase(store);
        const blob = insertOrValidateMediaBlob(
          database,
          {
            hash: descriptor.blobHash,
            byteLength: descriptor.byteLength,
            mimeType: descriptor.mimeType,
            technicalFacts: descriptor.technicalFacts,
          },
          committedAt,
        );
        const assetWithoutHash = {
          authority: 'global_media_asset' as const,
          id: environment.createId('global_media_asset'),
          revision: 0,
          contentHash: '',
          blobHash: blob.hash,
          kind: descriptor.technicalFacts.kind,
          filename: descriptor.originalFileName,
          displayName,
          source: {
            kind: 'imported' as const,
            originalFileName: descriptor.originalFileName,
            importId: descriptor.importId,
          },
          folderId: null,
          tags: request.input.tags,
          createdAt: committedAt,
          updatedAt: committedAt,
        };
        const asset = parseCanonical(GlobalMediaAssetSchema, {
          ...assetWithoutHash,
          contentHash: hashContentObject(assetWithoutHash),
        });
        insertGlobalMediaAsset(database, asset);
        return {
          projectId: null,
          response: success<'media.global.import'>(request, {
            asset,
            byteLength: blob.byteLength,
            mimeType: blob.mimeType,
          }),
        };
      });
    },

    listGlobal(requestValue) {
      const request = exactRequest(requestValue, 'media.global.list');
      const database = getStoreDatabase(store);
      const filterHash = hashCanonical({ kinds: request.input.kinds, query: request.input.query });
      const cursor =
        request.input.page.cursor === null ? null : decodeCursor(request.input.page.cursor);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new StorageError('INVALID_REQUEST', 'Global Media cursor belongs to another query');
      }
      const kindClause =
        request.input.kinds.length === 0
          ? ''
          : ` AND asset.media_kind IN (${request.input.kinds.map(() => '?').join(', ')})`;
      const queryClause =
        request.input.query.length === 0
          ? ''
          : ` AND (
                asset.display_name LIKE ? ESCAPE '\\' COLLATE NOCASE
                OR asset.filename LIKE ? ESCAPE '\\' COLLATE NOCASE
                OR EXISTS (
                  SELECT 1 FROM json_each(asset.tags_v1_json)
                  WHERE value LIKE ? ESCAPE '\\' COLLATE NOCASE
                )
              )`;
      const cursorClause =
        cursor === null
          ? ''
          : ' AND (asset.updated_at < ? OR (asset.updated_at = ? AND asset.id < ?))';
      const parameters: Array<string | number> = [...request.input.kinds];
      if (request.input.query.length > 0) {
        const query = escapeLike(request.input.query);
        parameters.push(query, query, query);
      }
      if (cursor !== null) parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      parameters.push(request.input.page.limit + 1);
      const rows = database
        .prepare(
          `SELECT asset.id, asset.updated_at
           FROM global_media_assets AS asset
           WHERE 1 = 1${kindClause}${queryClause}${cursorClause}
           ORDER BY asset.updated_at DESC, asset.id DESC
           LIMIT ?`,
        )
        .all(...parameters) as unknown as OrderedAssetRow[];
      const hasMore = rows.length > request.input.page.limit;
      const pageRows = rows.slice(0, request.input.page.limit);
      const last = pageRows.at(-1);
      return success<'media.global.list'>(request, {
        items: pageRows.map((row) => view(database, row.id)),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor({
                kind: 'global_media_list',
                filterHash,
                updatedAt: last.updated_at,
                id: last.id,
              })
            : null,
      });
    },

    removeGlobal(requestValue, context) {
      const request = exactRequest(requestValue, 'media.global.remove');
      const committedAt = environment.now();
      return executeWireMutation(getStoreDatabase(store), request, context, committedAt, () => {
        const database = getStoreDatabase(store);
        const asset = loadGlobalMediaAsset(database, request.input.globalAssetId);
        if (
          asset.revision !== request.input.expectedRevision ||
          asset.contentHash !== request.input.expectedContentHash
        ) {
          throw new StorageError(
            'REVISION_CONFLICT',
            `Global Media Asset ${asset.id} revision does not match`,
          );
        }
        const reference = referencedTable(database, asset.id);
        if (reference !== undefined) {
          throw new StorageError(
            'INVALID_REQUEST',
            `Global Media Asset ${asset.id} is still referenced by ${reference}`,
          );
        }
        const deleted = database
          .prepare(
            `DELETE FROM global_media_assets
               WHERE id = ? AND revision = ? AND content_hash = ?`,
          )
          .run(asset.id, asset.revision, asset.contentHash);
        if (Number(deleted.changes) !== 1) {
          throw new StorageError(
            'REVISION_CONFLICT',
            `Global Media Asset ${asset.id} changed concurrently`,
          );
        }
        return {
          projectId: null,
          response: success<'media.global.remove'>(request, {
            globalAssetId: asset.id,
            removed: true,
            blobRetainedForGarbageCollection: true,
          }),
        };
      });
    },

    getAsset(globalAssetId) {
      return loadGlobalMediaAsset(getStoreDatabase(store), globalAssetId);
    },

    getBlob(blobHash) {
      return loadMediaBlob(getStoreDatabase(store), blobHash);
    },

    getFolder(folderId) {
      return loadGlobalMediaFolder(getStoreDatabase(store), folderId);
    },

    listFolders() {
      return listGlobalMediaFolders(getStoreDatabase(store));
    },
  };
  return Object.freeze(authority);
}
