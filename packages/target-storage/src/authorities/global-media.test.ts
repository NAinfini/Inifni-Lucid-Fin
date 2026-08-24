import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  type GlobalMediaAsset,
  type GlobalMediaFolder,
} from '@lucid-fin/target-contracts';
import type { TargetCommandContext } from '../internal/command.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashContentObject } from '../internal/hashes.js';
import {
  insertGlobalMediaAsset,
  insertGlobalMediaFolder,
  insertOrValidateMediaBlob,
} from '../internal/media-records.js';
import { createFilesystemMediaCas } from '../internal/filesystem-media-cas.js';
import type {
  MediaImportCapabilityResolver,
  ResolvedMediaImportCapability,
} from '../kernel/media-cas.js';
import { createTargetStore } from '../kernel/store.js';
import { createGlobalMediaAuthority } from './global-media.js';

const NOW = '2026-08-15T12:00:00.000Z';
const directories: string[] = [];
const context: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.media.import' },
  correlationId: 'correlation.media.import',
};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function deterministicEnvironment(): TargetStorageEnvironment {
  const counts = new Map<string, number>();
  return {
    now: () => NOW,
    createId: (kind) => {
      const count = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, count);
      return `${kind}.${count}`;
    },
  };
}

function importRequest(
  requestId: string,
  capabilityToken: string,
  displayName: string | null = null,
) {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'media.global.import' as const,
    input: { capabilityToken, displayName, tags: ['rain', 'reference'] },
  };
}

function capability(
  capabilityToken: string,
  importId: string,
  bytes: Uint8Array,
  onOpen: () => void,
): ResolvedMediaImportCapability {
  return {
    descriptor: {
      capabilityToken,
      importId,
      originalFileName: 'storm.png',
      blobHash: sha256(bytes),
      byteLength: bytes.byteLength,
      mimeType: 'image/png',
      technicalFacts: { kind: 'image', width: 1920, height: 1080 },
    },
    openBytes() {
      onOpen();
      return (async function* () {
        yield bytes;
      })();
    },
  };
}

function folder(
  id: string,
  parentId: string | null,
  name: string,
  sortOrder: number,
): GlobalMediaFolder {
  const withoutHash = {
    authority: 'global_media_folder' as const,
    id,
    revision: 0,
    contentHash: '',
    parentId,
    name,
    sortOrder,
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { ...withoutHash, contentHash: hashContentObject(withoutHash) };
}

function globalAsset(id: string, blobHash: string, folderId: string | null): GlobalMediaAsset {
  const withoutHash = {
    authority: 'global_media_asset' as const,
    id,
    revision: 0,
    contentHash: '',
    blobHash,
    kind: 'image' as const,
    filename: `${id}.png`,
    displayName: id,
    source: {
      kind: 'imported' as const,
      originalFileName: `${id}.png`,
      importId: `import.${id}`,
    },
    folderId,
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
  return { ...withoutHash, contentHash: hashContentObject(withoutHash) };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe('Global Media authority', () => {
  it('round-trips a stable folder hierarchy and validates every asset folder reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-global-media-folders-'));
    directories.push(directory);
    const store = await createTargetStore(join(directory, 'project.sqlite'));
    const cas = createFilesystemMediaCas(join(directory, 'cas'));
    const resolver: MediaImportCapabilityResolver = {
      async resolve() {
        throw new Error('Folder storage test does not resolve import capabilities');
      },
    };
    const media = createGlobalMediaAuthority(store, deterministicEnvironment(), cas, resolver);

    try {
      const database = getTargetStoreDatabase(store);
      const root = folder('folder.root', null, 'Root', 2);
      const child = folder('folder.child', root.id, 'Child', 0);
      const empty = folder('folder.empty', null, 'Empty', -1);
      const orphan = folder('folder.orphan', 'folder.missing', 'Orphan', 0);

      expect(() => insertGlobalMediaFolder(database, orphan)).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
      expect(insertGlobalMediaFolder(database, root)).toEqual(root);
      expect(insertGlobalMediaFolder(database, child)).toEqual(child);
      expect(insertGlobalMediaFolder(database, empty)).toEqual(empty);
      expect(media.getFolder(child.id)).toEqual(child);
      expect(media.listFolders()).toEqual([empty, root, child]);
      expect(media.listFolders()).toEqual(media.listFolders());

      const bytes = Buffer.from('folder-shared-media');
      const blobHash = sha256(bytes);
      insertOrValidateMediaBlob(
        database,
        {
          hash: blobHash,
          byteLength: bytes.byteLength,
          mimeType: 'image/png',
          technicalFacts: { kind: 'image', width: 1920, height: 1080 },
        },
        NOW,
      );
      const unfiled = globalAsset('asset.unfiled', blobHash, null);
      const first = globalAsset('asset.foldered.1', blobHash, child.id);
      const second = globalAsset('asset.foldered.2', blobHash, child.id);
      expect(insertGlobalMediaAsset(database, unfiled)).toEqual(unfiled);
      expect(insertGlobalMediaAsset(database, first)).toEqual(first);
      expect(insertGlobalMediaAsset(database, second)).toEqual(second);
      expect(media.getAsset(unfiled.id).folderId).toBeNull();
      expect(media.getAsset(first.id).folderId).toBe(child.id);
      expect(media.getAsset(second.id).folderId).toBe(child.id);

      expect(() =>
        insertGlobalMediaAsset(
          database,
          globalAsset('asset.missing-folder', blobHash, 'folder.missing'),
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
      expect(() =>
        database.prepare('DELETE FROM global_media_folders WHERE id = ?').run(child.id),
      ).toThrow();

      database
        .prepare('UPDATE global_media_folders SET content_hash = ? WHERE id = ?')
        .run('f'.repeat(64), child.id);
      expect(() => media.getFolder(child.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      expect(() => media.getAsset(first.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
    } finally {
      store.close();
    }
  });

  it('imports verified bytes, reuses receipts before capability I/O, lists, and removes only the asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-global-media-'));
    directories.push(directory);
    const store = await createTargetStore(join(directory, 'project.sqlite'));
    const cas = createFilesystemMediaCas(join(directory, 'cas'));
    const bytes = Buffer.from('storm-reference');
    const capabilities = new Map<string, ResolvedMediaImportCapability>();
    let resolves = 0;
    let opens = 0;
    const resolver: MediaImportCapabilityResolver = {
      async resolve(token) {
        resolves += 1;
        const resolved = capabilities.get(token);
        if (resolved === undefined) throw new Error(`Unexpected token ${token}`);
        return resolved;
      },
    };
    const firstToken = 'cap_global_media_first_123';
    const secondToken = 'cap_global_media_second_12';
    capabilities.set(
      firstToken,
      capability(firstToken, 'import.1', bytes, () => (opens += 1)),
    );
    capabilities.set(
      secondToken,
      capability(secondToken, 'import.2', bytes, () => (opens += 1)),
    );
    const media = createGlobalMediaAuthority(store, deterministicEnvironment(), cas, resolver);

    try {
      const firstRequest = importRequest('request.media.import.1', firstToken, 'Heavy storm');
      const first = await media.importGlobal(firstRequest, context);
      expect(first.result.asset).toMatchObject({
        authority: 'global_media_asset',
        id: 'global_media_asset.1',
        revision: 0,
        blobHash: sha256(bytes),
        displayName: 'Heavy storm',
        source: { kind: 'imported', importId: 'import.1', originalFileName: 'storm.png' },
      });
      expect(first.result).toMatchObject({ byteLength: bytes.byteLength, mimeType: 'image/png' });
      expect(await media.importGlobal(firstRequest, context)).toEqual(first);
      expect({ resolves, opens }).toEqual({ resolves: 1, opens: 1 });

      await expect(
        media.importGlobal(
          { ...firstRequest, input: { ...firstRequest.input, displayName: 'Changed' } },
          context,
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
      expect({ resolves, opens }).toEqual({ resolves: 1, opens: 1 });

      const second = await media.importGlobal(
        importRequest('request.media.import.2', secondToken, 'Storm duplicate'),
        context,
      );
      expect(second.result.asset.id).toBe('global_media_asset.2');
      expect(second.result.asset.blobHash).toBe(first.result.asset.blobHash);
      expect(
        getTargetStoreDatabase(store).prepare('SELECT COUNT(*) AS count FROM media_blobs').get(),
      ).toEqual({ count: 1 });

      const pageOne = media.listGlobal({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.media.list.1',
        method: 'media.global.list',
        input: {
          kinds: ['image'],
          query: 'storm',
          page: { cursor: null, limit: 1 },
        },
      });
      const pageTwo = media.listGlobal({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.media.list.2',
        method: 'media.global.list',
        input: {
          kinds: ['image'],
          query: 'storm',
          page: { cursor: pageOne.result.nextCursor, limit: 1 },
        },
      });
      expect(
        [...pageOne.result.items, ...pageTwo.result.items].map((item) => item.asset.id),
      ).toEqual([second.result.asset.id, first.result.asset.id]);
      expect(() =>
        media.listGlobal({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.list.bad-cursor',
          method: 'media.global.list',
          input: {
            kinds: ['video'],
            query: 'storm',
            page: { cursor: pageOne.result.nextCursor, limit: 1 },
          },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const removeRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.media.remove.2',
        method: 'media.global.remove' as const,
        input: {
          globalAssetId: second.result.asset.id,
          expectedRevision: second.result.asset.revision,
          expectedContentHash: second.result.asset.contentHash,
        },
      };
      const removed = media.removeGlobal(removeRequest, context);
      expect(removed.result).toEqual({
        globalAssetId: second.result.asset.id,
        removed: true,
        blobRetainedForGarbageCollection: true,
      });
      expect(media.removeGlobal(removeRequest, context)).toEqual(removed);
      expect(() => media.getAsset(second.result.asset.id)).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
      expect(media.getBlob(first.result.asset.blobHash).hash).toBe(first.result.asset.blobHash);
      await expect(
        cas.verify({ hash: sha256(bytes), byteLength: bytes.byteLength }),
      ).resolves.toBeUndefined();
    } finally {
      store.close();
    }
  });

  it('rejects a mismatched capability descriptor and refuses to remove a referenced asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-global-media-reference-'));
    directories.push(directory);
    const store = await createTargetStore(join(directory, 'project.sqlite'));
    const cas = createFilesystemMediaCas(join(directory, 'cas'));
    const bytes = Buffer.from('referenced-media');
    let opens = 0;
    const token = 'cap_global_media_reference_1';
    const resolved = capability(token, 'import.reference', bytes, () => (opens += 1));
    const resolver: MediaImportCapabilityResolver = {
      async resolve(requestedToken) {
        return requestedToken === token
          ? resolved
          : { ...resolved, descriptor: { ...resolved.descriptor, capabilityToken: token } };
      },
    };
    const media = createGlobalMediaAuthority(store, deterministicEnvironment(), cas, resolver);

    try {
      await expect(
        media.importGlobal(
          importRequest('request.media.bad-token', 'cap_wrong_media_token_123'),
          context,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(opens).toBe(0);

      const pathToken = 'cap_global_media_path_12345';
      const pathCapability = capability(pathToken, 'import.path', bytes, () => (opens += 1));
      const pathResolver: MediaImportCapabilityResolver = {
        async resolve() {
          return {
            ...pathCapability,
            descriptor: {
              ...pathCapability.descriptor,
              originalFileName: 'C:\\Users\\owner\\private\\reference.png',
            },
          };
        },
      };
      const pathMedia = createGlobalMediaAuthority(
        store,
        deterministicEnvironment(),
        cas,
        pathResolver,
      );
      await expect(
        pathMedia.importGlobal(importRequest('request.media.path', pathToken), context),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(opens).toBe(0);

      const imported = await media.importGlobal(
        importRequest('request.media.reference', token),
        context,
      );
      const database = getTargetStoreDatabase(store);
      const projectWithoutHash = {
        authority: 'project' as const,
        id: 'project.reference',
        name: 'Reference project',
        lifecycle: 'active' as const,
        schemaRevision: 1,
        revision: 0,
        contentHash: '',
        createdBy: { kind: 'direct_ui' as const, actionId: 'action.project' },
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        deletedAt: null,
      };
      database
        .prepare(
          `INSERT INTO projects (
             id, name, lifecycle, schema_revision, revision, content_hash,
             created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
           ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', 'action.project', ?, ?, NULL, NULL)`,
        )
        .run(
          projectWithoutHash.id,
          projectWithoutHash.name,
          hashContentObject(projectWithoutHash),
          NOW,
          NOW,
        );
      database
        .prepare(
          `INSERT INTO project_media_refs (
             id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
             label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
             created_at, updated_at
           ) VALUES (
             'project_media_ref.reference', ?, ?, 0, ?, 'active', NULL,
             'Reference', '[]', '["reference"]', '', 'direct_ui', 'action.attach', ?, ?
           )`,
        )
        .run(projectWithoutHash.id, imported.result.asset.id, 'b'.repeat(64), NOW, NOW);

      expect(() =>
        media.removeGlobal(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.media.remove.stale',
            method: 'media.global.remove',
            input: {
              globalAssetId: imported.result.asset.id,
              expectedRevision: imported.result.asset.revision + 1,
              expectedContentHash: imported.result.asset.contentHash,
            },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      expect(() =>
        media.removeGlobal(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.media.remove.reference',
            method: 'media.global.remove',
            input: {
              globalAssetId: imported.result.asset.id,
              expectedRevision: imported.result.asset.revision,
              expectedContentHash: imported.result.asset.contentHash,
            },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(media.getAsset(imported.result.asset.id)).toEqual(imported.result.asset);
      expect(database.prepare('SELECT COUNT(*) AS count FROM wire_command_receipts').get()).toEqual(
        {
          count: 1,
        },
      );
    } finally {
      store.close();
    }
  });

  it('rejects conflicting immutable Blob metadata and every explicit asset reference owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-global-media-guards-'));
    directories.push(directory);
    const store = await createTargetStore(join(directory, 'project.sqlite'));
    const cas = createFilesystemMediaCas(join(directory, 'cas'));
    const bytes = Buffer.from('shared-guard-bytes');
    const capabilities = new Map<string, ResolvedMediaImportCapability>();
    const resolver: MediaImportCapabilityResolver = {
      async resolve(token) {
        const resolved = capabilities.get(token);
        if (resolved === undefined) throw new Error(`Unexpected token ${token}`);
        return resolved;
      },
    };
    const environment = deterministicEnvironment();
    const media = createGlobalMediaAuthority(store, environment, cas, resolver);
    const tokens = [
      'cap_media_guard_base_12345',
      'cap_media_guard_conflict_12',
      'cap_media_guard_derive_1234',
      'cap_media_guard_result_1234',
    ];
    tokens.forEach((token, index) => {
      capabilities.set(
        token,
        capability(token, `import.guard.${index}`, bytes, () => undefined),
      );
    });

    try {
      const base = await media.importGlobal(
        importRequest('request.media.guard.base', tokens[0]),
        context,
      );
      const conflict = capabilities.get(tokens[1])!;
      capabilities.set(tokens[1], {
        ...conflict,
        descriptor: {
          ...conflict.descriptor,
          mimeType: 'image/jpeg',
          technicalFacts: { kind: 'image', width: 1280, height: 720 },
        },
      });
      await expect(
        media.importGlobal(importRequest('request.media.guard.conflict', tokens[1]), context),
      ).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
      expect(
        media
          .listGlobal({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.media.guard.list',
            method: 'media.global.list',
            input: { kinds: [], query: '', page: { cursor: null, limit: 10 } },
          })
          .result.items.map(({ asset }) => asset.id),
      ).toEqual([base.result.asset.id]);

      const derivationAsset = await media.importGlobal(
        importRequest('request.media.guard.derive', tokens[2]),
        context,
      );
      const generatedAsset = await media.importGlobal(
        importRequest('request.media.guard.result', tokens[3]),
        context,
      );
      const database = getTargetStoreDatabase(store);
      database.exec('PRAGMA foreign_keys = OFF');
      database
        .prepare(
          `INSERT INTO media_derivation_outputs (
             id, derivation_attempt_id, blob_hash, global_asset_id, ordinal
           ) VALUES ('derivation_output.guard', 'missing.attempt', ?, ?, 0)`,
        )
        .run(derivationAsset.result.asset.blobHash, derivationAsset.result.asset.id);
      database
        .prepare(
          `INSERT INTO generated_results (
             id, project_id, request_id, attempt_id, revision, content_hash, blob_hash,
             global_asset_id, project_media_ref_id, media_kind, variant_index,
             submitted_prompt, submitted_negative_prompt, prompt_provenance_v1_json,
             reference_bindings_v1_json, provider_v1_json, seed, receipt_v1_json,
             usage_v1_json, technical_validation_v1_json, created_at
           ) VALUES (
             'generated_result.guard', 'missing.project', 'missing.request', 'missing.attempt',
             0, ?, ?, ?, 'missing.ref', 'image', 0, 'Guard prompt', NULL, ?, ?, ?, NULL,
             ?, ?, ?, ?
           )`,
        )
        .run(
          'c'.repeat(64),
          generatedAsset.result.asset.blobHash,
          generatedAsset.result.asset.id,
          canonicalJson({
            sourceObjectId: 'shot.guard',
            sourceRevision: 0,
            sourceHash: 'd'.repeat(64),
            assemblyHash: 'e'.repeat(64),
            loadedSkillDigests: [],
          }),
          canonicalJson([]),
          canonicalJson({
            providerId: 'provider.guard',
            model: 'guard-model',
            reasoningStrength: null,
          }),
          canonicalJson({
            providerOperationId: 'provider-operation.guard',
            submittedAt: NOW,
            reconciledAt: NOW,
            receiptHash: 'f'.repeat(64),
          }),
          canonicalJson({
            inputTokens: { state: 'known', value: 0 },
            outputTokens: { state: 'known', value: 0 },
            generatedUnits: { state: 'known', value: 1 },
            cost: { state: 'known', value: '0', currency: 'USD' },
          }),
          canonicalJson({
            state: 'valid',
            mimeTypeValid: true,
            dimensionsValid: true,
            durationValid: null,
            failureCode: null,
          }),
          NOW,
        );
      database.exec('PRAGMA foreign_keys = ON');

      for (const [label, asset] of [
        ['derivation', derivationAsset.result.asset],
        ['generated result', generatedAsset.result.asset],
      ] as const) {
        expect(() =>
          media.removeGlobal(
            {
              wireVersion: 1,
              kind: 'request',
              requestId: `request.media.guard.remove.${label.replace(' ', '_')}`,
              method: 'media.global.remove',
              input: {
                globalAssetId: asset.id,
                expectedRevision: asset.revision,
                expectedContentHash: asset.contentHash,
              },
            },
            context,
          ),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      }
    } finally {
      store.close();
    }
  });
});
