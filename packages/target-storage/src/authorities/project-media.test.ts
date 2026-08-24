import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TargetCommandContext } from '../internal/command.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashContentObject } from '../internal/hashes.js';
import { createTargetStore, openTargetStore } from '../kernel/store.js';
import { createProjectMediaAuthority } from './project-media.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const BLOB_HASH = 'b'.repeat(64);
const ASSET_HASH = hashContentObject({
  authority: 'global_media_asset',
  id: 'asset.1',
  revision: 0,
  contentHash: '',
  blobHash: BLOB_HASH,
  kind: 'image',
  filename: 'rain.png',
  displayName: 'Rain',
  source: { importId: 'import.1', kind: 'imported', originalFileName: 'rain.png' },
  folderId: null,
  tags: [],
  createdAt: NOW,
  updatedAt: NOW,
});
const disposablePaths: string[] = [];

const context: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.media' },
  correlationId: 'correlation.media',
};

const counters = new Map<string, number>();
const environment: TargetStorageEnvironment = {
  now: () => NOW,
  createId: (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}.${next}`;
  },
};

afterEach(async () => {
  counters.clear();
  await Promise.all(
    disposablePaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Project Media authority', () => {
  it('attaches, detaches, and reattaches one stable relationship tombstone', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-project-media-'));
    disposablePaths.push(directory);
    const databasePath = join(directory, 'project.sqlite');
    const store = await createTargetStore(databasePath);
    const database = getTargetStoreDatabase(store);
    database.exec(`
      INSERT INTO projects (
        id, name, lifecycle, schema_revision, revision, content_hash,
        created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
      ) VALUES ('project.1', 'Film', 'active', 1, 3, '${HASH}', 'direct_ui', 'action.create', '${NOW}', '${NOW}', NULL, NULL);
      INSERT INTO media_blobs (
        hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
      ) VALUES ('${BLOB_HASH}', 12, 'image/png', 'image', '{"height":100,"kind":"image","width":100}', '${NOW}');
      INSERT INTO global_media_assets (
        id, revision, content_hash, blob_hash, media_kind, filename, display_name,
        source_v1_json, folder_id, tags_v1_json, created_at, updated_at
      ) VALUES (
        'asset.1', 0, '${ASSET_HASH}', '${BLOB_HASH}', 'image', 'rain.png', 'Rain',
        '{"importId":"import.1","kind":"imported","originalFileName":"rain.png"}',
        NULL, '[]', '${NOW}', '${NOW}'
      );
    `);

    try {
      const media = createProjectMediaAuthority(store, environment);
      const attached = media.attach(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.attach',
          method: 'media.project.attach',
          input: {
            projectId: 'project.1',
            expectedProjectRevision: 3,
            globalAssetId: 'asset.1',
            expectedExistingRef: null,
            label: 'Heavy rain',
            collections: ['Weather'],
            roles: ['reference'],
            notes: 'High-intensity rain reference.',
          },
        },
        context,
      );
      database.exec(`
        INSERT INTO production_objects (
          id, project_id, object_type, revision, content_hash, lifecycle, content_v1_json,
          created_by_kind, created_by_id, updated_by_kind, updated_by_id, created_at, updated_at
        ) VALUES (
          'production.1', 'project.1', 'shot', 0, '${HASH}', 'active', '{}',
          'direct_ui', 'action.production', 'direct_ui', 'action.production', '${NOW}', '${NOW}'
        );
        INSERT INTO project_media_links (
          id, project_media_ref_id, production_object_id, relation, created_at
        ) VALUES (
          'link.1', '${attached.result.object.id}', 'production.1', 'references', '${NOW}'
        );
      `);
      const linkedWithoutHash = {
        ...attached.result.object,
        revision: attached.result.object.revision + 1,
        contentHash: '',
        productionLinks: [{ productionObjectId: 'production.1', relation: 'references' as const }],
      };
      database
        .prepare('UPDATE project_media_refs SET revision = ?, content_hash = ? WHERE id = ?')
        .run(
          linkedWithoutHash.revision,
          hashContentObject(linkedWithoutHash),
          attached.result.object.id,
        );
      const linked = media.get(attached.result.object.id);
      const initialSearchDocument = database
        .prepare(
          `SELECT id
           FROM project_search_documents
           WHERE source_kind = 'project_media_ref' AND source_id = ?`,
        )
        .get(attached.result.object.id) as { id: string };
      const detached = media.detach(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.detach',
          method: 'media.project.detach',
          input: {
            projectMediaRefId: attached.result.object.id,
            expectedRevision: linked.revision,
            expectedContentHash: linked.contentHash,
          },
        },
        context,
      );
      expect(
        database
          .prepare(
            `SELECT id, source_state
             FROM project_search_documents
             WHERE source_kind = 'project_media_ref' AND source_id = ?`,
          )
          .get(attached.result.object.id),
      ).toEqual({ id: initialSearchDocument.id, source_state: 'historical' });
      const reattached = media.attach(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.reattach',
          method: 'media.project.attach',
          input: {
            projectId: 'project.1',
            expectedProjectRevision: 3,
            globalAssetId: 'asset.1',
            expectedExistingRef: {
              id: detached.result.object.id,
              expectedRevision: detached.result.object.revision,
              expectedContentHash: detached.result.object.contentHash,
            },
            label: 'Heavy rain',
            collections: ['Weather'],
            roles: ['reference'],
            notes: 'High-intensity rain reference.',
          },
        },
        context,
      );

      expect(reattached.result.object.id).toBe(attached.result.object.id);
      expect(reattached.result.object.lifecycle).toBe('active');
      expect(reattached.result.object.productionLinks).toEqual(linked.productionLinks);
      expect(detached.result.undoRef).toBeNull();
      expect(
        database.prepare("SELECT revision FROM projects WHERE id = 'project.1'").get(),
      ).toEqual({ revision: 3 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_media_refs').get()).toEqual({
        count: 1,
      });
      expect(
        database
          .prepare(
            `SELECT id, source_state
             FROM project_search_documents
             WHERE source_kind = 'project_media_ref' AND source_id = ?`,
          )
          .get(attached.result.object.id),
      ).toEqual({ id: initialSearchDocument.id, source_state: 'current' });
      expect(
        media.list({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.list',
          method: 'media.project.list',
          input: {
            projectId: 'project.1',
            roles: ['reference'],
            query: 'rain',
            page: { cursor: null, limit: 10 },
          },
        }).result.items,
      ).toEqual([reattached.result.object]);
      expect(() =>
        media.attach(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.media.attach.no-op',
            method: 'media.project.attach',
            input: {
              projectId: 'project.1',
              expectedProjectRevision: 3,
              globalAssetId: 'asset.1',
              expectedExistingRef: {
                id: reattached.result.object.id,
                expectedRevision: reattached.result.object.revision,
                expectedContentHash: reattached.result.object.contentHash,
              },
              label: 'Heavy rain',
              collections: ['Weather'],
              roles: ['reference'],
              notes: 'High-intensity rain reference.',
            },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_events').get()).toEqual({
        count: 3,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM wire_command_receipts').get()).toEqual(
        {
          count: 3,
        },
      );

      store.close();
      const reopened = await openTargetStore(databasePath);
      try {
        const reopenedMedia = createProjectMediaAuthority(reopened, environment);
        expect(reopenedMedia.get(reattached.result.object.id)).toEqual(reattached.result.object);
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });
});
