import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type ProjectMemoryIndex } from '@lucid-fin/contracts';
import { getStoreDatabase } from '../internal/database-access.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { createStore } from '../kernel/store.js';
import { computeProjectMemorySourceSetHash, createProjectMemoryReadModel } from './memory.js';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T13:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-memory-'));
  paths.push(directory);
  const store = await createStore(join(directory, 'project.sqlite'));
  const database = getStoreDatabase(store);
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash,
         created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES ('project.1', 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.create', ?, ?, NULL, NULL)`,
    )
    .run(HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO project_events (
         id, project_id, sequence, event_version, event_type, occurred_at, actor,
         subject_authority, subject_id, causation_kind, causation_id, correlation_id,
         idempotency_key, payload_hash, previous_event_hash, event_hash
       ) VALUES (
         'project-event.1', 'project.1', 1, 1, 'object_created', ?, 'user', 'project',
         'project.1', 'direct_ui', 'action.create', 'correlation.1', 'event.1', ?, NULL, ?
       )`,
    )
    .run(NOW, hashCanonical({ type: 'object_created', revision: 0, contentHash: HASH_A }), HASH_A);
  database
    .prepare(
      `INSERT INTO project_event_payloads (project_event_id, payload_v1_json, erased_at)
       VALUES ('project-event.1', ?, NULL)`,
    )
    .run(canonicalJson({ type: 'object_created', revision: 0, contentHash: HASH_A }));
  return { store, database, memory: createProjectMemoryReadModel(store) };
}

function memoryIndex(
  id: string,
  historyWatermark: number,
  completeness: ProjectMemoryIndex['completeness'] = 'complete',
): ProjectMemoryIndex {
  const source = {
    kind: 'domain_object' as const,
    ref: { authority: 'project' as const, id: 'project.1', revision: 0, contentHash: HASH_A },
  };
  const withoutHash = {
    id: `${id}.item`,
    category: 'visual_direction' as const,
    sources: [source],
    state: 'current' as const,
    tentative: false,
    topics: ['lighting', 'moonlight'],
    searchableText: 'Use cold moonlight and restrained contrast.',
    contentHash: '',
  };
  const entry = { ...withoutHash, contentHash: hashContentObject(withoutHash) };
  return {
    authority: 'project_memory',
    id,
    projectId: 'project.1',
    derivationVersion: id,
    sourceSchemaVersion: 'source-v1',
    historyWatermark,
    sourceSetHash: computeProjectMemorySourceSetHash([entry]),
    completeness,
    entries: [entry],
    createdAt: NOW,
  };
}

describe('Project Memory read model', () => {
  it('records immutable typed versions and hashes a canonical deduplicated source set', async () => {
    const { store, memory } = await harness();
    try {
      const index = memoryIndex('memory.1', 1);
      expect(memory.recordVersion(index)).toEqual(index);
      expect(() => memory.recordVersion(index)).toThrowError(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
      expect(
        computeProjectMemorySourceSetHash([
          index.entries[0],
          { ...index.entries[0], id: 'duplicate-source.item' },
        ]),
      ).toBe(index.sourceSetHash);
      expect(() =>
        memory.recordVersion({ ...memoryIndex('memory.bad-hash', 1), sourceSetHash: HASH_B }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      store.close();
    }
  });

  it('publishes only complete versions with head CAS and returns ready then stale views', async () => {
    const { store, database, memory } = await harness();
    try {
      const index = memory.recordVersion(memoryIndex('memory.1', 1));
      expect(
        memory.publishHead({
          projectId: 'project.1',
          memoryVersionId: index.id,
          expectedHeadRevision: null,
          updatedAt: NOW,
        }),
      ).toEqual({
        state: 'ready',
        index,
        headRevision: 0,
        activeHistoryWatermark: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_events').get()).toEqual({
        count: 1,
      });
      expect(memory.getHead('project.1')).toEqual({
        state: 'ready',
        index,
        headRevision: 0,
        activeHistoryWatermark: 1,
      });
      expect(
        memory.query('project.1', {
          query: 'moonlight',
          categories: ['visual_direction'],
          itemKeys: [],
          limit: 10,
        }),
      ).toEqual({
        state: 'ready',
        head: {
          memoryVersionId: index.id,
          headRevision: 0,
          derivationVersion: index.derivationVersion,
          sourceSchemaVersion: index.sourceSchemaVersion,
          historyWatermark: 1,
          sourceSetHash: index.sourceSetHash,
          completeness: 'complete',
          createdAt: NOW,
        },
        activeHistoryWatermark: 1,
        items: [
          {
            itemId: index.entries[0].id,
            category: 'visual_direction',
            text: index.entries[0].searchableText,
            state: 'current',
            tentative: false,
            sources: index.entries[0].sources,
            contentHash: index.entries[0].contentHash,
          },
        ],
      });

      const secondPayload = {
        type: 'object_revision_changed',
        beforeRevision: 0,
        afterRevision: 1,
        beforeHash: HASH_A,
        afterHash: HASH_B,
      };
      database
        .prepare(
          `INSERT INTO project_events (
             id, project_id, sequence, event_version, event_type, occurred_at, actor,
             subject_authority, subject_id, causation_kind, causation_id, correlation_id,
             idempotency_key, payload_hash, previous_event_hash, event_hash
           ) VALUES (
             'project-event.2', 'project.1', 2, 1, 'object_revision_changed', ?, 'user',
             'project', 'project.1', 'direct_ui', 'action.update', 'correlation.2', 'event.2',
             ?, ?, ?
           )`,
        )
        .run(LATER, hashCanonical(secondPayload), HASH_A, HASH_B);
      database
        .prepare(
          `INSERT INTO project_event_payloads (project_event_id, payload_v1_json, erased_at)
           VALUES ('project-event.2', ?, NULL)`,
        )
        .run(canonicalJson(secondPayload));
      expect(memory.getHead('project.1')).toMatchObject({
        state: 'stale',
        headRevision: 0,
        activeHistoryWatermark: 2,
      });

      const partial = memory.recordVersion(memoryIndex('memory.partial', 2, 'partial'));
      expect(() =>
        memory.publishHead({
          projectId: 'project.1',
          memoryVersionId: partial.id,
          expectedHeadRevision: 0,
          updatedAt: LATER,
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const next = memory.recordVersion(memoryIndex('memory.2', 2));
      expect(() =>
        memory.publishHead({
          projectId: 'project.1',
          memoryVersionId: next.id,
          expectedHeadRevision: 4,
          updatedAt: LATER,
        }),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(
        memory.publishHead({
          projectId: 'project.1',
          memoryVersionId: next.id,
          expectedHeadRevision: 0,
          updatedAt: LATER,
        }),
      ).toMatchObject({ state: 'ready', index: next, headRevision: 1, activeHistoryWatermark: 2 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_events').get()).toEqual({
        count: 2,
      });
    } finally {
      store.close();
    }
  });
});
