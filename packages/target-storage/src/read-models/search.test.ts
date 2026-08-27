import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTargetDataAccess } from '../kernel/data-access.js';
import { createTargetStore } from '../kernel/store.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { createProjectSearchReadModel } from './search.js';
import { ProjectSearchDefinition } from '@lucid-fin/target-contracts';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const directories: string[] = [];
const context = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.search.1' },
  correlationId: 'correlation.search.1',
};
const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('Media CAS is not used by Search tests');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('Media CAS is not used by Search tests');
  },
};
const unusedMediaImportCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('Media capabilities are not used by Search tests');
  },
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-search-read-'));
  directories.push(directory);
  const store = await createTargetStore(join(directory, 'project.sqlite'));
  let nextId = 0;
  const data = createTargetDataAccess(store, {
    now: () => NOW,
    createId: (authority) => `${authority}.${++nextId}`,
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedMediaImportCapabilities,
  });
  const created = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.project.${nextId}`,
      method: 'project.create',
      input: {
        name: 'Search Project',
        permissionMode: 'reversible',
        budget: {
          costUsd: { state: 'known', value: '20', currency: 'USD' },
          maxGenerationCount: 10,
          maxInputTokens: 100_000,
          maxOutputTokens: 20_000,
        },
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    context,
  );
  return {
    store,
    projectId: created.result.project.id,
    database: getTargetStoreDatabase(store),
    search: createProjectSearchReadModel(store),
  };
}

function insertSearchDocument(
  database: ReturnType<typeof getTargetStoreDatabase>,
  projectId: string,
  id: string,
  state: 'current' | 'historical',
  searchText: string,
): void {
  const source = {
    kind: 'message' as const,
    messageId: `message.${id}`,
    chatId: 'chat.search',
    sequence: Number(id),
    contentHash: HASH_A,
  };
  database
    .prepare(
      `INSERT INTO chats (
         id, project_id, revision, content_hash, title, lifecycle, message_count,
         message_head_sequence, created_at, updated_at, archived_at, deleted_at
       ) VALUES ('chat.search', ?, 0, ?, 'Search fixture', 'active', 0, NULL, ?, ?, NULL, NULL)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(projectId, HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO messages (
         id, project_id, chat_id, sequence, role, status, originating_run_id,
         originating_imported_run_id, content_hash, supersedes_message_id, created_at
       ) VALUES (?, ?, 'chat.search', ?, 'user', 'accepted', NULL, NULL, ?, NULL, ?)`,
    )
    .run(source.messageId, projectId, source.sequence, source.contentHash, NOW);
  database
    .prepare(
      `UPDATE chats
          SET message_count = (SELECT count(*) FROM messages WHERE chat_id = 'chat.search'),
              message_head_sequence = (SELECT max(sequence) FROM messages WHERE chat_id = 'chat.search')
        WHERE id = 'chat.search'`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO project_search_documents (
         id, project_id, source_kind, source_id, source_revision, source_hash,
         source_state, source_v1_json, search_text, updated_at
       ) VALUES (?, ?, 'message', ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      `search.${id}`,
      projectId,
      source.messageId,
      source.contentHash,
      state,
      JSON.stringify(source),
      searchText,
      NOW,
    );
  const row = database
    .prepare('SELECT search_document_id FROM project_search_documents WHERE id = ?')
    .get(`search.${id}`) as { search_document_id: number };
  database
    .prepare('INSERT INTO project_search_fts (rowid, search_text) VALUES (?, ?)')
    .run(row.search_document_id, searchText);
}

describe('Project Search read model', () => {
  it('isolates Project/state and returns exact sources with stable cursor pages', async () => {
    const { store, projectId, database, search } = await harness();
    try {
      insertSearchDocument(database, projectId, '1', 'current', 'moonlit harbor reference');
      insertSearchDocument(database, projectId, '2', 'current', 'moonlit harbor location');
      insertSearchDocument(database, projectId, '3', 'historical', 'moonlit harbor old');

      const first = search.query(projectId, {
        query: 'moonlit harbor',
        kinds: ['message'],
        state: 'current',
        page: { cursor: null, limit: 1 },
      });
      const second = search.query(projectId, {
        query: 'moonlit harbor',
        kinds: ['message'],
        state: 'current',
        page: { cursor: first.nextCursor, limit: 1 },
      });
      expect([...first.items, ...second.items]).toHaveLength(2);
      expect([...first.items, ...second.items]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'moonlit harbor reference',
            excerpt: 'moonlit harbor reference',
          }),
          expect.objectContaining({
            label: 'moonlit harbor location',
            excerpt: 'moonlit harbor location',
          }),
        ]),
      );
      expect(
        [...first.items, ...second.items].every(
          (hit) => Number.isFinite(hit.score) && hit.score >= 0 && hit.score <= 1,
        ),
      ).toBe(true);
      expect(() => ProjectSearchDefinition.parseSuccess(first)).not.toThrow();
      expect(second.nextCursor).toBeNull();
      expect(
        search.query(projectId, {
          query: 'moonlit harbor',
          kinds: [],
          state: 'historical',
          page: { cursor: null, limit: 10 },
        }).items,
      ).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  it('quotes FTS input and rejects a cursor from another query', async () => {
    const { store, projectId, database, search } = await harness();
    try {
      insertSearchDocument(database, projectId, '1', 'current', 'moonlit harbor');
      insertSearchDocument(database, projectId, '2', 'current', 'moonlit harbor location');
      expect(
        search.query(projectId, {
          query: '" OR *',
          kinds: [],
          state: 'any',
          page: { cursor: null, limit: 10 },
        }).items,
      ).toEqual([]);
      const first = search.query(projectId, {
        query: 'moonlit harbor',
        kinds: [],
        state: 'any',
        page: { cursor: null, limit: 1 },
      });
      expect(first.nextCursor).not.toBeNull();
      expect(() =>
        search.query(projectId, {
          query: 'different',
          kinds: [],
          state: 'any',
          page: { cursor: first.nextCursor, limit: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });

  it('fails closed when denormalized source columns drift from typed source JSON', async () => {
    const { store, projectId, database, search } = await harness();
    try {
      insertSearchDocument(database, projectId, '1', 'current', 'moonlit harbor');
      database
        .prepare("UPDATE project_search_documents SET source_hash = ? WHERE id = 'search.1'")
        .run(HASH_B);
      expect(() =>
        search.query(projectId, {
          query: 'moonlit harbor',
          kinds: [],
          state: 'any',
          page: { cursor: null, limit: 10 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      store.close();
    }
  });
});
