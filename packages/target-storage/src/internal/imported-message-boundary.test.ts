import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  ChatQueryDefinition,
  type Message,
  type ProjectMemoryIndex,
} from '@lucid-fin/target-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createConversationsAuthority } from '../authorities/conversations.js';
import type { TargetCommandContext } from './command.js';
import { appendMessageInTransaction } from './conversation-write.js';
import {
  getTargetStoreDatabase,
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from './database-access.js';
import type { TargetStorageEnvironment } from './environment.js';
import { hashContentObject } from './hashes.js';
import { upsertProjectSearchDocument } from './search-projection.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import type { TargetStore } from '../kernel/store.js';
import { createProjectHistoryReadModel } from '../read-models/history.js';
import {
  computeProjectMemorySourceSetHash,
  createProjectMemoryReadModel,
} from '../read-models/memory.js';
import { createProjectSearchReadModel } from '../read-models/search.js';

const NOW = '2026-08-25T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const counters = new Map<string, number>();
const ddlUrl = new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url);

const context: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.imported-message-test' },
  correlationId: 'correlation.imported-message-test',
};

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
});

function registeredStore(): TargetStore {
  return {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {},
  };
}

function identity() {
  return {
    messageId: environment.createId('message'),
    eventId: environment.createId('project_event'),
    searchDocumentId: environment.createId('project_search_document'),
    createdAt: NOW,
  };
}

function insertImportedRun(
  database: ReturnType<typeof getTargetStoreDatabase>,
  chatId: string,
): void {
  database
    .prepare(
      `INSERT INTO imported_history_batches (
         id, source_schema_id, source_snapshot_hash, classification_hash, plan_hash,
         offline_evidence_manifest_hash, reconciliation_hash, created_at
       ) VALUES ('import.batch.1', 'legacy/v1', ?, ?, ?, NULL, ?, ?)`,
    )
    .run(HASH, HASH, HASH, HASH, NOW);
  database
    .prepare(
      `INSERT INTO imported_run_history (
         id, batch_id, legacy_run_id, project_id, chat_id, legacy_session_id, root_run_id,
         parent_run_id, retry_of_run_id, work_type, display_name, intent, objective, status,
         accepted_at, started_at, finished_at, last_sequence, source_payload_v1_json,
         source_payload_hash, created_at
       ) VALUES (
         'imported-run.1', 'import.batch.1', 'legacy-run.1', 'project.1', ?,
         'legacy-session.1', 'imported-run.1', NULL, NULL, 'agent', NULL,
         'Create an imported reply.', NULL, 'completed', ?, ?, ?, NULL, '{}', ?, ?
       )`,
    )
    .run(chatId, NOW, NOW, NOW, HASH, NOW);
}

function insertLiveRun(
  database: ReturnType<typeof getTargetStoreDatabase>,
  chatId: string,
  userMessageId: string,
): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('PRAGMA defer_foreign_keys = ON');
    database
      .prepare(
        `INSERT INTO runs (
           id, revision, content_hash, root_run_id, parent_run_id, retry_of_run_id,
           retry_seed_hash, project_id, chat_id, objective_message_id, objective_parent_event_id,
           objective_hash, child_display_name, child_public_summary, status, provider_profile_id,
           model, reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
           context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
           accepted_at, finished_at, terminal_summary
         ) VALUES (
           'run.1', 0, ?, 'run.1', NULL, NULL, NULL, 'project.1', ?, ?, NULL, ?, NULL,
           NULL, 'running', NULL, 'test-model', NULL, 'reversible', '{}', 'context.1', ?,
           'catalog.1', ?, ?, NULL, NULL
         )`,
      )
      .run(HASH, chatId, userMessageId, HASH, HASH, HASH, NOW);
    database
      .prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, parent_event_id, manifest_hash,
           manifest_v1_json, created_at
         ) VALUES ('context.1', 'run.1', 'project.1', ?, ?, NULL, ?, '{}', ?)`,
      )
      .run(chatId, userMessageId, HASH, NOW);
    database
      .prepare(
        `INSERT INTO capability_catalog_snapshots (
           id, run_id, catalog_hash, catalog_v1_json, created_at
         ) VALUES ('catalog.1', 'run.1', ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

function publicMessage(message: Message) {
  return {
    id: message.id,
    sequence: message.sequence,
    role: message.role,
    status: message.status,
    originatingRunId: message.originatingRunId,
    blocks: message.blocks,
    contentHash: message.contentHash,
    createdAt: message.createdAt,
  };
}

function memoryIndex(
  id: string,
  source: Extract<ProjectMemoryIndex['entries'][number]['sources'][number], { kind: 'message' }>,
  historyWatermark: number,
): ProjectMemoryIndex {
  const withoutHash = {
    id: `${id}.item`,
    category: 'visual_direction' as const,
    sources: [source],
    state: 'current' as const,
    tentative: false,
    topics: ['imported-message-boundary'],
    searchableText: 'Model-visible memory candidate.',
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
    completeness: 'complete',
    entries: [entry],
    createdAt: NOW,
  };
}

describe('Imported assistant Message boundary', () => {
  it('keeps imported assistant Messages in desktop conversation reads and out of every model read path', async () => {
    const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
    database.exec(await readFile(ddlUrl, 'utf8'));
    const store = registeredStore();
    registerTargetStoreDatabase(store, database);
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('project.1', 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.create', ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);

    try {
      const conversations = createConversationsAuthority(store, environment);
      const chat = conversations.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.create',
          method: 'chat.create',
          input: { projectId: 'project.1', title: 'Imported transcript' },
        },
        context,
      ).result;
      insertImportedRun(database, chat.id);

      const user = withImmediateTransaction(
        database,
        () =>
          appendMessageInTransaction(
            database,
            environment,
            context,
            {
              chatId: chat.id,
              role: 'user',
              status: 'accepted',
              originatingRunId: null,
              blocks: [{ type: 'text', text: 'Ordinary user message.' }],
              attachments: [],
              supersedesMessageId: null,
              idempotencyKey: 'message.user',
            },
            identity(),
          ).message,
      );
      const importedAppend = withImmediateTransaction(database, () =>
        appendMessageInTransaction(
          database,
          environment,
          context,
          {
            chatId: chat.id,
            role: 'assistant',
            status: 'completed',
            originatingRunId: null,
            originatingImportedRunId: 'imported-run.1',
            blocks: [{ type: 'text', text: 'Imported assistant sentinel.' }],
            attachments: [],
            supersedesMessageId: null,
            idempotencyKey: 'message.imported',
          },
          identity(),
        ),
      );
      const imported = importedAppend.message;
      insertLiveRun(database, chat.id, user.id);
      const liveAppend = withImmediateTransaction(database, () =>
        appendMessageInTransaction(
          database,
          environment,
          context,
          {
            chatId: chat.id,
            role: 'assistant',
            status: 'completed',
            originatingRunId: 'run.1',
            blocks: [{ type: 'text', text: 'Live assistant response.' }],
            attachments: [],
            supersedesMessageId: null,
            idempotencyKey: 'message.live',
          },
          identity(),
        ),
      );
      const live = liveAppend.message;

      expect(user.originatingImportedRunId).toBeNull();
      expect(imported).toMatchObject({
        role: 'assistant',
        originatingRunId: null,
        originatingImportedRunId: 'imported-run.1',
      });
      expect(live).toMatchObject({
        role: 'assistant',
        originatingRunId: 'run.1',
        originatingImportedRunId: null,
      });
      expect(importedAppend.eventId).toBeNull();
      expect(liveAppend.eventId).not.toBeNull();
      expect(
        database
          .prepare(
            `SELECT originating_run_id, originating_imported_run_id
             FROM messages WHERE id = ?`,
          )
          .get(imported.id),
      ).toEqual({ originating_run_id: null, originating_imported_run_id: 'imported-run.1' });
      expect(
        conversations.listMessages({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.message.list',
          method: 'message.list',
          input: { chatId: chat.id, beforeSequence: null, page: { cursor: null, limit: 10 } },
        }).result.items,
      ).toEqual([user, imported, live]);
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM project_search_documents
             WHERE source_kind = 'message' AND source_id = ?`,
          )
          .get(imported.id),
      ).toEqual({ count: 0 });

      expect(
        conversations.queryMessages(
          'project.1',
          chat.id,
          ChatQueryDefinition.parseInput({
            chatId: chat.id,
            beforeSequence: null,
            afterSequence: null,
            messageIds: [],
            page: { cursor: null, limit: 10 },
          }),
        ),
      ).toEqual({ items: [publicMessage(user), publicMessage(live)], nextCursor: null });

      const history = createProjectHistoryReadModel(store);
      const query = {
        eventTypes: [],
        subjects: [],
        actors: [],
        time: { from: null, to: null },
        page: { cursor: null, limit: 100 },
      } as const;
      expect(
        history
          .query('project.1', { ...query, sources: ['message'] })
          .items.map((entry) => entry.messageId),
      ).toEqual([user.id, live.id]);
      expect(
        history
          .query('project.1', { ...query, sources: ['project_event'] })
          .items.some(
            (entry) => entry.source === 'project_event' && entry.subject.id === imported.id,
          ),
      ).toBe(false);

      upsertProjectSearchDocument(
        database,
        environment,
        'project.1',
        {
          kind: 'message',
          messageId: imported.id,
          chatId: imported.chatId,
          sequence: imported.sequence,
          contentHash: imported.contentHash,
        },
        'current',
        'Imported assistant sentinel.',
        NOW,
        'project-search-document.imported-stale',
      );
      const search = createProjectSearchReadModel(store);
      expect(
        search.query('project.1', {
          query: 'Imported assistant sentinel.',
          kinds: ['message'],
          state: 'any',
          page: { cursor: null, limit: 10 },
        }).items,
      ).toEqual([]);
      expect(
        search
          .query('project.1', {
            query: 'Ordinary user message.',
            kinds: ['message'],
            state: 'any',
            page: { cursor: null, limit: 10 },
          })
          .items.map((item) => item.source),
      ).toEqual([
        {
          kind: 'message',
          messageId: user.id,
          chatId: user.chatId,
          sequence: user.sequence,
          contentHash: user.contentHash,
        },
      ]);

      const historyWatermark = Number(
        (
          database
            .prepare('SELECT MAX(sequence) AS watermark FROM project_events WHERE project_id = ?')
            .get('project.1') as { watermark: number }
        ).watermark,
      );
      const memory = createProjectMemoryReadModel(store);
      const importedSource = {
        kind: 'message' as const,
        messageId: imported.id,
        chatId: imported.chatId,
        sequence: imported.sequence,
        contentHash: imported.contentHash,
      };
      expect(() =>
        memory.recordVersion(memoryIndex('memory.imported', importedSource, historyWatermark)),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(
        memory.recordVersion(
          memoryIndex(
            'memory.live',
            {
              kind: 'message',
              messageId: live.id,
              chatId: live.chatId,
              sequence: live.sequence,
              contentHash: live.contentHash,
            },
            historyWatermark,
          ),
        ),
      ).toMatchObject({ id: 'memory.live' });
    } finally {
      unregisterTargetStoreDatabase(store);
      database.close();
    }
  });
});
