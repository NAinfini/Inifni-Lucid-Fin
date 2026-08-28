import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectMediaRef } from '@lucid-fin/contracts';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashContentObject } from '../internal/hashes.js';
import { createProjectHistoryReadModel } from '../read-models/history.js';
import { createProjectSearchReadModel } from '../read-models/search.js';
import { createStore, openStore } from '../kernel/store.js';
import { createProductionAuthority } from './production.js';
import { createProjectMediaAuthority } from './project-media.js';

const NOW = '2026-08-16T12:00:00.000Z';
const LATER = '2026-08-16T12:01:00.000Z';
const LATEST = '2026-08-16T12:02:00.000Z';
const HASH_A = 'a'.repeat(64);
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
const directories: string[] = [];

const userContext = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.media.link' },
  correlationId: 'correlation.media.link',
};
const commanderContext = {
  actor: 'commander' as const,
  causation: { kind: 'run' as const, runId: 'run.media.link' },
  correlationId: 'correlation.media.link.commander',
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function linkRequest(
  requestId: string,
  mode: 'link' | 'unlink',
  mediaRef: Pick<ProjectMediaRef, 'id' | 'revision' | 'contentHash'>,
  target: { id: string; revision: number; contentHash: string },
  relation: 'depicts' | 'references' = 'references',
) {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'media.project.link' as const,
    input: {
      mode,
      mediaRef: {
        authority: 'project_media_ref' as const,
        id: mediaRef.id,
        revision: mediaRef.revision,
        contentHash: mediaRef.contentHash,
      },
      target: {
        authority: 'production' as const,
        id: target.id,
        revision: target.revision,
        contentHash: target.contentHash,
      },
      relation,
    },
  };
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-project-media-link-'));
  directories.push(directory);
  const databasePath = join(directory, 'project.sqlite');
  const store = await createStore(databasePath);
  const database = getStoreDatabase(store);
  database.exec(`
    INSERT INTO projects (
      id, name, lifecycle, schema_revision, revision, content_hash,
      created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
    ) VALUES
      ('project.1', 'Film', 'active', 1, 3, '${HASH_A}', 'direct_ui', 'action.create', '${NOW}', '${NOW}', NULL, NULL),
      ('project.2', 'Other Film', 'active', 1, 0, '${HASH_A}', 'direct_ui', 'action.create', '${NOW}', '${NOW}', NULL, NULL);
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
  let now = NOW;
  const counters = new Map<string, number>();
  const environment: StorageEnvironment = {
    now: () => now,
    createId: (kind) => {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${kind}.${next}`;
    },
  };
  const media = createProjectMediaAuthority(store, environment);
  const production = createProductionAuthority(store, environment);
  const attached = media.attach(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.media.attach.link-fixture',
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
    userContext,
  ).result.object;
  const createShot = (projectId: string, expectedProjectRevision: number, requestId: string) =>
    production.apply(
      {
        wireVersion: 1,
        kind: 'request',
        requestId,
        method: 'production.apply',
        input: {
          action: 'create',
          projectId,
          expectedProjectRevision,
          value: {
            objectType: 'shot',
            content: {
              title: `Shot for ${projectId}`,
              description: 'Rain crosses the frame.',
              durationMs: 5_000,
              shotSize: 'wide',
              cameraMovement: 'static',
            },
          },
          relations: [],
        },
      },
      commanderContext,
    ).result.object;
  const shot = createShot('project.1', 3, 'request.production.shot.link-fixture');
  const otherProjectShot = createShot('project.2', 0, 'request.production.other-shot.link-fixture');
  return {
    attached,
    database,
    databasePath,
    environment,
    media,
    otherProjectShot,
    production,
    setNow: (value: string) => {
      now = value;
    },
    shot,
    store,
  };
}

describe('Project Media public Production links', () => {
  it('links, replays, unlinks, reopens, and projects one owner revision everywhere', async () => {
    const setup = await harness();
    let storeClosed = false;
    try {
      const targetBefore = setup.production.get(setup.shot.id).object;
      const eventCountBefore = setup.database
        .prepare('SELECT COUNT(*) AS count FROM project_events')
        .get() as { count: number };
      setup.setNow(LATER);
      const request = linkRequest(
        'request.media.link.references',
        'link',
        setup.attached,
        setup.shot,
      );
      const linked = setup.media.link(request, userContext);
      expect(linked.result).toMatchObject({
        object: {
          revision: setup.attached.revision + 1,
          updatedAt: LATER,
          productionLinks: [{ productionObjectId: setup.shot.id, relation: 'references' }],
        },
        previousRevision: setup.attached.revision,
        changedPaths: ['productionLinks'],
        undoRef: null,
      });
      expect(linked.result.object.contentHash).not.toBe(setup.attached.contentHash);
      expect(setup.production.get(setup.shot.id).object).toEqual(targetBefore);
      expect(setup.media.link(request, userContext)).toEqual(linked);
      expect(
        setup.database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get(),
      ).toEqual({ count: 1 });
      expect(setup.database.prepare('SELECT COUNT(*) AS count FROM project_events').get()).toEqual({
        count: eventCountBefore.count + 1,
      });
      expect(() =>
        setup.media.link(
          { ...request, input: { ...request.input, relation: 'depicts' } },
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
      expect(() =>
        setup.media.link(
          linkRequest('request.media.link.duplicate', 'link', linked.result.object, setup.shot),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const search = createProjectSearchReadModel(setup.store).query('project.1', {
        query: 'Heavy rain',
        kinds: ['project_media_ref'],
        state: 'current',
        page: { cursor: null, limit: 10 },
      });
      expect(search.items).toHaveLength(1);
      expect(search.items[0]?.source).toMatchObject({
        kind: 'project_media_ref',
        ref: {
          id: linked.result.object.id,
          revision: linked.result.object.revision,
          contentHash: linked.result.object.contentHash,
        },
      });

      setup.setNow(LATEST);
      const unlinked = setup.media.link(
        linkRequest('request.media.unlink.references', 'unlink', linked.result.object, setup.shot),
        commanderContext,
      );
      expect(unlinked.result).toMatchObject({
        object: {
          revision: linked.result.object.revision + 1,
          updatedAt: LATEST,
          productionLinks: [],
        },
        previousRevision: linked.result.object.revision,
        changedPaths: ['productionLinks'],
        undoRef: null,
      });
      expect(setup.production.get(setup.shot.id).object).toEqual(targetBefore);
      expect(() =>
        setup.media.link(
          linkRequest('request.media.unlink.missing', 'unlink', unlinked.result.object, setup.shot),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(
        setup.database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get(),
      ).toEqual({ count: 0 });
      expect(setup.database.prepare('SELECT COUNT(*) AS count FROM user_choices').get()).toEqual({
        count: 0,
      });
      expect(
        setup.database.prepare('SELECT COUNT(*) AS count FROM production_protections').get(),
      ).toEqual({ count: 0 });
      expect(
        setup.database.prepare("SELECT revision FROM projects WHERE id = 'project.1'").get(),
      ).toEqual({ revision: 3 });

      const history = createProjectHistoryReadModel(setup.store).query('project.1', {
        sources: ['project_event'],
        eventTypes: ['object_revision_changed'],
        subjects: [{ authority: 'project_media_ref', id: setup.attached.id }],
        actors: [],
        time: { from: null, to: null },
        page: { cursor: null, limit: 10 },
      });
      expect(history.items).toHaveLength(2);
      expect(
        history.items.map((entry) => entry.source === 'project_event' && entry.payloadState),
      ).toEqual([
        {
          state: 'available',
          payload: {
            type: 'object_revision_changed',
            beforeRevision: setup.attached.revision,
            afterRevision: linked.result.object.revision,
            beforeHash: setup.attached.contentHash,
            afterHash: linked.result.object.contentHash,
          },
        },
        {
          state: 'available',
          payload: {
            type: 'object_revision_changed',
            beforeRevision: linked.result.object.revision,
            afterRevision: unlinked.result.object.revision,
            beforeHash: linked.result.object.contentHash,
            afterHash: unlinked.result.object.contentHash,
          },
        },
      ]);

      setup.store.close();
      storeClosed = true;
      const reopened = await openStore(setup.databasePath);
      try {
        expect(
          createProjectMediaAuthority(reopened, setup.environment).get(setup.attached.id),
        ).toEqual(unlinked.result.object);
      } finally {
        reopened.close();
      }
    } finally {
      if (!storeClosed) setup.store.close();
    }
  });

  it('fails closed on stale, cross-Project, lifecycle, and untrusted actor contexts', async () => {
    const setup = await harness();
    try {
      const valid = linkRequest(
        'request.media.link.validation',
        'link',
        setup.attached,
        setup.shot,
        'depicts',
      );
      const invalidContexts = [
        { actor: 'system' as const, causation: userContext.causation, correlationId: 'system.1' },
        {
          actor: 'import' as const,
          causation: { kind: 'import' as const, importId: 'import.1' },
          correlationId: 'import.1',
        },
        {
          actor: 'user' as const,
          causation: commanderContext.causation,
          correlationId: 'user.run.1',
        },
        {
          actor: 'commander' as const,
          causation: userContext.causation,
          correlationId: 'commander.ui.1',
        },
      ];
      for (const [index, invalidContext] of invalidContexts.entries()) {
        expect(() =>
          setup.media.link(
            { ...valid, requestId: `request.media.link.invalid-actor.${index}` },
            invalidContext,
          ),
        ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      }
      expect(() =>
        setup.media.link(
          linkRequest(
            'request.media.link.stale-media',
            'link',
            { ...setup.attached, revision: setup.attached.revision + 1 },
            setup.shot,
          ),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() =>
        setup.media.link(
          linkRequest('request.media.link.stale-target', 'link', setup.attached, {
            ...setup.shot,
            contentHash: 'c'.repeat(64),
          }),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() =>
        setup.media.link(
          linkRequest(
            'request.media.link.cross-project',
            'link',
            setup.attached,
            setup.otherProjectShot,
          ),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const archived = setup.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.archive.link-target',
          method: 'production.apply',
          input: {
            action: 'replace',
            projectId: setup.shot.projectId,
            ref: {
              authority: 'production',
              id: setup.shot.id,
              revision: setup.shot.revision,
              contentHash: setup.shot.contentHash,
            },
            lifecycle: 'archived',
            value: { objectType: 'shot', content: setup.shot.content },
            relations: setup.shot.relations,
          },
        },
        commanderContext,
      ).result.object;
      expect(() =>
        setup.media.link(
          linkRequest('request.media.link.archived-target', 'link', setup.attached, archived),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const detached = setup.media.detach(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.media.detach.before-link',
          method: 'media.project.detach',
          input: {
            projectMediaRefId: setup.attached.id,
            expectedRevision: setup.attached.revision,
            expectedContentHash: setup.attached.contentHash,
          },
        },
        userContext,
      ).result.object;
      expect(() =>
        setup.media.link(
          linkRequest('request.media.link.detached-ref', 'link', detached, setup.otherProjectShot),
          userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(
        setup.database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get(),
      ).toEqual({ count: 0 });
    } finally {
      setup.store.close();
    }
  });

  it('cannot forge or delete Generation-owned generated_for links', async () => {
    const setup = await harness();
    try {
      setup.database
        .prepare(
          `INSERT INTO project_media_links (
             id, project_media_ref_id, production_object_id, relation, created_at
           ) VALUES (?, ?, ?, 'generated_for', ?)`,
        )
        .run('link.generated', setup.attached.id, setup.shot.id, NOW);
      const withGeneratedLink = {
        ...setup.attached,
        revision: setup.attached.revision + 1,
        contentHash: '',
        productionLinks: [
          { productionObjectId: setup.shot.id, relation: 'generated_for' as const },
        ],
      };
      setup.database
        .prepare('UPDATE project_media_refs SET revision = ?, content_hash = ? WHERE id = ?')
        .run(withGeneratedLink.revision, hashContentObject(withGeneratedLink), setup.attached.id);
      const current = setup.media.get(setup.attached.id);
      const linked = setup.media.link(
        linkRequest('request.media.link.alongside-generated', 'link', current, setup.shot),
        userContext,
      ).result.object;
      expect(linked.productionLinks).toEqual([
        { productionObjectId: setup.shot.id, relation: 'generated_for' },
        { productionObjectId: setup.shot.id, relation: 'references' },
      ]);
      const forged = {
        ...linkRequest('request.media.unlink.generated', 'unlink', linked, setup.shot),
        input: {
          ...linkRequest('request.media.unlink.generated', 'unlink', linked, setup.shot).input,
          relation: 'generated_for',
        },
      } as unknown as Parameters<typeof setup.media.link>[0];
      expect(() => setup.media.link(forged, userContext)).toThrow();
      expect(setup.media.get(setup.attached.id)).toEqual(linked);
      expect(
        setup.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_media_links WHERE relation = 'generated_for'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      setup.store.close();
    }
  });
});
