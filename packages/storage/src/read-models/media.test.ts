import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GlobalMediaAssetSchema,
  MediaQueryDefinition,
  ProjectMediaRefSchema,
  parseCanonical,
  type ProjectMediaRef,
} from '@lucid-fin/contracts';
import { getStoreDatabase } from '../internal/database-access.js';
import { hashContentObject } from '../internal/hashes.js';
import {
  insertGlobalMediaAsset,
  insertOrValidateMediaBlob,
  insertProjectMediaRecord,
} from '../internal/media-records.js';
import { createStore } from '../kernel/store.js';
import { createMediaQueryReadModel, type MediaQueryInput } from './media.js';

const NOW = '2026-08-23T12:00:00.000Z';
const HASHES = Object.freeze({
  harbor: 'a'.repeat(64),
  pageA: 'b'.repeat(64),
  pageB: 'c'.repeat(64),
  other: 'd'.repeat(64),
  detached: 'e'.repeat(64),
  global: 'f'.repeat(64),
});
const PROJECT_HASH = '0'.repeat(64);
const directories: string[] = [];

interface ProjectMediaSeed {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly collections: readonly string[];
  readonly roles: ProjectMediaRef['roles'];
  readonly notes: string;
  readonly updatedAt: string;
  readonly lifecycle?: 'active' | 'detached';
}

interface MediaSeed {
  readonly id: string;
  readonly blobHash: string;
  readonly filename: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly updatedAt: string;
  readonly projectMedia?: ProjectMediaSeed;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function insertProject(database: ReturnType<typeof getStoreDatabase>, id: string): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash,
         created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', 'action.media.query.seed', ?, ?, NULL, NULL)`,
    )
    .run(id, id, PROJECT_HASH, NOW, NOW);
}

function seedMedia(database: ReturnType<typeof getStoreDatabase>, value: MediaSeed) {
  insertOrValidateMediaBlob(
    database,
    {
      hash: value.blobHash,
      byteLength: 1,
      mimeType: 'image/png',
      technicalFacts: { kind: 'image', width: 1, height: 1 },
    },
    value.updatedAt,
  );
  const assetWithoutHash = {
    authority: 'global_media_asset' as const,
    id: value.id,
    revision: 0,
    contentHash: '',
    blobHash: value.blobHash,
    kind: 'image' as const,
    filename: value.filename,
    displayName: value.displayName,
    source: {
      kind: 'imported' as const,
      importId: `import.${value.id}`,
      originalFileName: value.filename,
    },
    folderId: null,
    tags: value.tags,
    createdAt: value.updatedAt,
    updatedAt: value.updatedAt,
  };
  const asset = insertGlobalMediaAsset(
    database,
    parseCanonical(GlobalMediaAssetSchema, {
      ...assetWithoutHash,
      contentHash: hashContentObject(assetWithoutHash),
    }),
  );
  if (value.projectMedia === undefined) return { asset, projectMedia: null };
  const projectMedia = value.projectMedia;
  const lifecycle = projectMedia.lifecycle ?? 'active';
  const refWithoutHash = {
    authority: 'project_media_ref' as const,
    id: projectMedia.id,
    projectId: projectMedia.projectId,
    globalAssetId: asset.id,
    revision: 0,
    contentHash: '',
    lifecycle,
    detachedAt: lifecycle === 'detached' ? projectMedia.updatedAt : null,
    label: projectMedia.label,
    collections: projectMedia.collections,
    roles: projectMedia.roles,
    notes: projectMedia.notes,
    productionLinks: [],
    createdBy: { kind: 'direct_ui' as const, actionId: 'action.media.query.seed' },
    createdAt: projectMedia.updatedAt,
    updatedAt: projectMedia.updatedAt,
  };
  return {
    asset,
    projectMedia: insertProjectMediaRecord(
      database,
      parseCanonical(ProjectMediaRefSchema, {
        ...refWithoutHash,
        contentHash: hashContentObject(refWithoutHash),
      }),
    ),
  };
}

function queryInput(
  scope: MediaQueryInput['scope'],
  overrides: Partial<MediaQueryInput> = {},
): MediaQueryInput {
  return MediaQueryDefinition.parseInput({
    scope,
    globalAssetIds: [],
    projectMediaRefIds: [],
    blobHashes: [],
    mediaKinds: [],
    tags: [],
    roles: [],
    integrity: [],
    query: '',
    page: { cursor: null, limit: 100 },
    ...overrides,
  });
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-media-query-'));
  directories.push(directory);
  const store = await createStore(join(directory, 'project.sqlite'));
  const database = getStoreDatabase(store);
  insertProject(database, 'project.1');
  insertProject(database, 'project.2');
  const harbor = seedMedia(database, {
    id: 'asset.harbor',
    blobHash: HASHES.harbor,
    filename: 'moonlit-harbor.png',
    displayName: 'Moonlit Harbor',
    tags: ['harbor', 'night'],
    updatedAt: '2026-08-23T12:04:00.000Z',
    projectMedia: {
      id: 'media.harbor',
      projectId: 'project.1',
      label: 'Harbor Board',
      collections: ['Reference Board'],
      roles: ['reference', 'location'],
      notes: 'Blue water reflection',
      updatedAt: '2026-08-23T12:04:00.000Z',
    },
  });
  const pageA = seedMedia(database, {
    id: 'asset.page.a',
    blobHash: HASHES.pageA,
    filename: 'page-a.png',
    displayName: 'Page A',
    tags: ['page'],
    updatedAt: '2026-08-23T12:10:00.000Z',
    projectMedia: {
      id: 'media.page.a',
      projectId: 'project.1',
      label: 'Page A',
      collections: [],
      roles: ['reference'],
      notes: '',
      updatedAt: '2026-08-23T12:10:00.000Z',
    },
  });
  const pageB = seedMedia(database, {
    id: 'asset.page.b',
    blobHash: HASHES.pageB,
    filename: 'page-b.png',
    displayName: 'Page B',
    tags: ['page'],
    updatedAt: '2026-08-23T12:10:00.000Z',
    projectMedia: {
      id: 'media.page.b',
      projectId: 'project.1',
      label: 'Page B',
      collections: [],
      roles: ['reference'],
      notes: '',
      updatedAt: '2026-08-23T12:10:00.000Z',
    },
  });
  const other = seedMedia(database, {
    id: 'asset.other',
    blobHash: HASHES.other,
    filename: 'other-harbor.png',
    displayName: 'Other Harbor',
    tags: ['harbor'],
    updatedAt: '2026-08-23T12:05:00.000Z',
    projectMedia: {
      id: 'media.other',
      projectId: 'project.2',
      label: 'Other Project Harbor',
      collections: [],
      roles: ['reference'],
      notes: '',
      updatedAt: '2026-08-23T12:05:00.000Z',
    },
  });
  const detached = seedMedia(database, {
    id: 'asset.detached',
    blobHash: HASHES.detached,
    filename: 'detached-harbor.png',
    displayName: 'Detached Harbor',
    tags: ['harbor'],
    updatedAt: '2026-08-23T12:06:00.000Z',
    projectMedia: {
      id: 'media.detached',
      projectId: 'project.1',
      label: 'Detached Harbor',
      collections: [],
      roles: ['reference'],
      notes: '',
      updatedAt: '2026-08-23T12:06:00.000Z',
      lifecycle: 'detached',
    },
  });
  const global = seedMedia(database, {
    id: 'asset.global',
    blobHash: HASHES.global,
    filename: 'global-beacon.png',
    displayName: 'Global Beacon',
    tags: ['global'],
    updatedAt: '2026-08-23T12:07:00.000Z',
  });
  return {
    store,
    database,
    query: createMediaQueryReadModel(store),
    harbor,
    pageA,
    pageB,
    other,
    detached,
    global,
  };
}

describe('Media query read model', () => {
  it('scopes Project Media to the current Project and combines typed filters', async () => {
    const fixture = await harness();
    try {
      const projectHarbor = fixture.query.query(
        'project.1',
        queryInput('project', { query: 'harbor' }),
      );
      expect(projectHarbor.items.map(({ projectMediaRef }) => projectMediaRef?.id)).toEqual([
        fixture.harbor.projectMedia!.id,
      ]);
      expect(
        fixture.query
          .query('project.2', queryInput('project', { query: 'harbor' }))
          .items.map(({ projectMediaRef }) => projectMediaRef?.id),
      ).toEqual([fixture.other.projectMedia!.id]);
      expect(
        fixture.query.query('project.1', queryInput('project', { query: 'reference board' })).items,
      ).toHaveLength(1);

      const combined = fixture.query.query(
        'project.1',
        queryInput('project', {
          globalAssetIds: [fixture.global.asset.id, fixture.harbor.asset.id],
          projectMediaRefIds: [fixture.pageA.projectMedia!.id, fixture.harbor.projectMedia!.id],
          blobHashes: [fixture.pageA.asset.blobHash, fixture.harbor.asset.blobHash],
          mediaKinds: ['image'],
          tags: ['page', 'harbor'],
          roles: ['equipment', 'location'],
          integrity: ['valid', 'unknown'],
          query: 'BLUE WATER',
        }),
      );
      expect(combined.items).toEqual([
        expect.objectContaining({
          scope: 'project',
          globalAssetId: fixture.harbor.asset.id,
          projectMediaRef: {
            authority: 'project_media_ref',
            id: fixture.harbor.projectMedia!.id,
            revision: fixture.harbor.projectMedia!.revision,
            contentHash: fixture.harbor.projectMedia!.contentHash,
          },
          roles: ['reference', 'location'],
          integrity: 'unknown',
        }),
      ]);
    } finally {
      fixture.store.close();
    }
  });

  it('returns only global asset projections and validates the current Project first', async () => {
    const fixture = await harness();
    try {
      const global = fixture.query.query(
        'project.1',
        queryInput('global', {
          globalAssetIds: [fixture.harbor.asset.id, fixture.global.asset.id],
        }),
      );
      expect(global.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            scope: 'global',
            globalAssetId: fixture.harbor.asset.id,
            projectMediaRef: null,
            roles: [],
            integrity: 'unknown',
          }),
          expect.objectContaining({ globalAssetId: fixture.global.asset.id }),
        ]),
      );
      expect(
        fixture.query.query(
          'project.1',
          queryInput('global', { projectMediaRefIds: [fixture.harbor.projectMedia!.id] }),
        ).items,
      ).toEqual([]);
      expect(
        fixture.query.query('project.1', queryInput('global', { roles: ['reference'] })).items,
      ).toEqual([]);
      expect(() =>
        fixture.query.query('project.missing', queryInput('global', { roles: ['reference'] })),
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    } finally {
      fixture.store.close();
    }
  });

  it('reports every asset as unknown integrity until a persisted verifier exists', async () => {
    const fixture = await harness();
    try {
      expect(
        fixture.query.query(
          'project.1',
          queryInput('project', { integrity: ['valid'], query: 'harbor' }),
        ).items,
      ).toEqual([]);
      const unknown = fixture.query.query(
        'project.1',
        queryInput('project', { integrity: ['missing', 'unknown'], query: 'harbor' }),
      );
      expect(unknown.items).toHaveLength(1);
      expect(unknown.items.every(({ integrity }) => integrity === 'unknown')).toBe(true);
    } finally {
      fixture.store.close();
    }
  });

  it('uses stable descending pages and binds cursors to every filter', async () => {
    const fixture = await harness();
    try {
      const first = fixture.query.query(
        'project.1',
        queryInput('project', { tags: ['page'], page: { cursor: null, limit: 1 } }),
      );
      expect(first.items.map(({ projectMediaRef }) => projectMediaRef?.id)).toEqual([
        fixture.pageB.projectMedia!.id,
      ]);
      expect(first.nextCursor).not.toBeNull();
      const second = fixture.query.query(
        'project.1',
        queryInput('project', { tags: ['page'], page: { cursor: first.nextCursor, limit: 1 } }),
      );
      expect(second.items.map(({ projectMediaRef }) => projectMediaRef?.id)).toEqual([
        fixture.pageA.projectMedia!.id,
      ]);
      expect(second.nextCursor).toBeNull();
      expect(() =>
        fixture.query.query(
          'project.1',
          queryInput('project', { tags: ['harbor'], page: { cursor: first.nextCursor, limit: 1 } }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  });

  it('fails closed when a selected media record is corrupt', async () => {
    const fixture = await harness();
    try {
      fixture.database
        .prepare('UPDATE global_media_assets SET content_hash = ? WHERE id = ?')
        .run(PROJECT_HASH, fixture.harbor.asset.id);
      expect(() =>
        fixture.query.query(
          'project.1',
          queryInput('project', { globalAssetIds: [fixture.harbor.asset.id] }),
        ),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      fixture.store.close();
    }
  });
});
