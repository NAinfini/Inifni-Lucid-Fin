import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatQueryDefinition, type Message } from '@lucid-fin/target-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { TargetCommandContext } from '../internal/command.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { appendMessageInTransaction } from '../internal/conversation-write.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { createTargetStore, openTargetStore } from '../kernel/store.js';
import { createConversationsAuthority } from './conversations.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const disposablePaths: string[] = [];

const context: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.chat' },
  correlationId: 'correlation.chat',
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

function messageIdentity() {
  return {
    messageId: environment.createId('message'),
    eventId: environment.createId('project_event'),
    searchDocumentId: environment.createId('project_search_document'),
    createdAt: environment.now(),
  };
}

afterEach(async () => {
  counters.clear();
  await Promise.all(
    disposablePaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('Conversation authority', () => {
  it('creates, hydrates, lists, renames, archives, and tombstones a Chat', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-conversations-'));
    disposablePaths.push(directory);
    const databasePath = join(directory, 'project.sqlite');
    const store = await createTargetStore(databasePath);
    const database = (await import('../internal/database-access.js')).getTargetStoreDatabase(store);
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('project.1', 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.create', ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);
    database
      .prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('project.2', 'Other film', 'active', 1, 0, ?, 'direct_ui', 'action.create.2', ?, ?, NULL, NULL)`,
      )
      .run(HASH, NOW, NOW);

    try {
      const chats = createConversationsAuthority(store, environment);
      const created = chats.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.create',
          method: 'chat.create',
          input: { projectId: 'project.1', title: 'Main thread' },
        },
        context,
      );

      expect(chats.getChat(created.result.id)).toEqual(created.result);
      expect(
        chats.listChats({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.list',
          method: 'chat.list',
          input: {
            projectId: 'project.1',
            lifecycle: ['active'],
            page: { cursor: null, limit: 10 },
          },
        }).result.items,
      ).toEqual([created.result]);

      const noOpRename = chats.renameChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.rename.no-op',
          method: 'chat.rename',
          input: { chatId: created.result.id, expectedRevision: 0, title: 'Main thread' },
        },
        context,
      );
      expect(noOpRename.result.revision).toBe(0);
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_events').get()).toEqual({
        count: 1,
      });

      const appended = withImmediateTransaction(database, () =>
        appendMessageInTransaction(
          database,
          environment,
          context,
          {
            chatId: created.result.id,
            role: 'user',
            status: 'accepted',
            originatingRunId: null,
            blocks: [
              { type: 'text', text: 'Heavy rain with long reverb.' },
              {
                type: 'project_object',
                authority: 'project',
                objectId: 'project.1',
                revision: 0,
                contentHash: HASH,
              },
            ],
            attachments: [],
            supersedesMessageId: null,
            idempotencyKey: 'message.append.1',
          },
          messageIdentity(),
        ),
      );
      expect(chats.getMessage(appended.message.id)).toEqual(appended.message);
      expect(
        chats.listMessages({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.message.list',
          method: 'message.list',
          input: {
            chatId: created.result.id,
            beforeSequence: null,
            page: { cursor: null, limit: 10 },
          },
        }).result.items,
      ).toEqual([appended.message]);
      expect(
        database
          .prepare(
            `SELECT source_state, search_text
             FROM project_search_documents
             WHERE source_kind = 'message' AND source_id = ?`,
          )
          .get(appended.message.id),
      ).toEqual({ source_state: 'current', search_text: 'Heavy rain with long reverb.' });

      expect(() =>
        withImmediateTransaction(database, () =>
          appendMessageInTransaction(
            database,
            environment,
            context,
            {
              chatId: created.result.id,
              role: 'user',
              status: 'accepted',
              originatingRunId: null,
              blocks: [
                {
                  type: 'project_object',
                  authority: 'project',
                  objectId: 'project.2',
                  revision: 0,
                  contentHash: HASH,
                },
              ],
              attachments: [],
              supersedesMessageId: null,
              idempotencyKey: 'message.append.cross-project',
            },
            messageIdentity(),
          ),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        withImmediateTransaction(database, () =>
          appendMessageInTransaction(
            database,
            environment,
            context,
            {
              chatId: created.result.id,
              role: 'assistant',
              status: 'completed',
              originatingRunId: 'run.missing',
              blocks: [{ type: 'text', text: 'No run may claim this output.' }],
              attachments: [],
              supersedesMessageId: null,
              idempotencyKey: 'message.append.missing-run',
            },
            messageIdentity(),
          ),
        ),
      ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));

      const otherChat = chats.createChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.create.other',
          method: 'chat.create',
          input: { projectId: 'project.1', title: 'Other thread' },
        },
        context,
      );
      expect(() =>
        withImmediateTransaction(database, () =>
          appendMessageInTransaction(
            database,
            environment,
            context,
            {
              chatId: otherChat.result.id,
              role: 'user',
              status: 'accepted',
              originatingRunId: null,
              blocks: [{ type: 'text', text: 'Cross-chat replacement.' }],
              attachments: [],
              supersedesMessageId: appended.message.id,
              idempotencyKey: 'message.append.cross-chat',
            },
            messageIdentity(),
          ),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const renamed = chats.renameChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.rename',
          method: 'chat.rename',
          input: { chatId: created.result.id, expectedRevision: 1, title: 'Production thread' },
        },
        context,
      );
      const archived = chats.archiveChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.archive',
          method: 'chat.archive',
          input: { chatId: created.result.id, expectedRevision: renamed.result.revision },
        },
        context,
      );
      const noOpArchive = chats.archiveChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.archive.no-op',
          method: 'chat.archive',
          input: { chatId: created.result.id, expectedRevision: archived.result.revision },
        },
        context,
      );
      expect(noOpArchive.result).toEqual(archived.result);
      expect(
        database
          .prepare(
            `SELECT source_state
             FROM project_search_documents
             WHERE source_kind = 'message' AND source_id = ?`,
          )
          .get(appended.message.id),
      ).toEqual({ source_state: 'historical' });
      const deleted = chats.deleteChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.delete',
          method: 'chat.delete',
          input: { chatId: created.result.id, expectedRevision: archived.result.revision },
        },
        context,
      );
      const noOpDelete = chats.deleteChat(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.chat.delete.no-op',
          method: 'chat.delete',
          input: { chatId: created.result.id, expectedRevision: deleted.result.revision },
        },
        context,
      );

      expect(noOpDelete.result).toEqual(deleted.result);
      expect(deleted.result).toMatchObject({
        lifecycle: 'deleted',
        archivedAt: null,
        deletedAt: NOW,
        title: 'Production thread',
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_events').get()).toEqual({
        count: 6,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM messages').get()).toEqual({
        count: 1,
      });
      expect(() =>
        chats.archiveChat(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.chat.resurrect',
            method: 'chat.archive',
            input: { chatId: created.result.id, expectedRevision: deleted.result.revision },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      store.close();
      const reopened = await openTargetStore(databasePath);
      try {
        const reopenedChats = createConversationsAuthority(reopened, environment);
        expect(reopenedChats.getChat(deleted.result.id)).toEqual(deleted.result);
        expect(reopenedChats.getMessage(appended.message.id)).toEqual(appended.message);
      } finally {
        reopened.close();
      }
    } finally {
      store.close();
    }
  });

  it('queries bounded public Messages with exact Chat, sequence, ID, and cursor scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-chat-query-'));
    disposablePaths.push(directory);
    const store = await createTargetStore(join(directory, 'project.sqlite'));
    const database = (await import('../internal/database-access.js')).getTargetStoreDatabase(store);
    for (const [id, name] of [
      ['project.1', 'Film'],
      ['project.2', 'Other film'],
    ] as const) {
      database
        .prepare(
          `INSERT INTO projects (
             id, name, lifecycle, schema_revision, revision, content_hash,
             created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
           ) VALUES (?, ?, 'active', 1, 0, ?, 'direct_ui', 'action.create', ?, ?, NULL, NULL)`,
        )
        .run(id, name, HASH, NOW, NOW);
    }

    try {
      const chats = createConversationsAuthority(store, environment);
      const createChat = (projectId: string, suffix: string) =>
        chats.createChat(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: `request.chat.query.${suffix}`,
            method: 'chat.create',
            input: { projectId, title: `Chat ${suffix}` },
          },
          context,
        ).result;
      const current = createChat('project.1', 'current');
      const sibling = createChat('project.1', 'sibling');
      const foreign = createChat('project.2', 'foreign');
      const append = (chatId: string, suffix: string) =>
        withImmediateTransaction(database, () =>
          appendMessageInTransaction(
            database,
            environment,
            context,
            {
              chatId,
              role: 'user',
              status: 'accepted',
              originatingRunId: null,
              blocks: [{ type: 'text', text: `Message ${suffix}` }],
              attachments: [],
              supersedesMessageId: null,
              idempotencyKey: `message.query.${suffix}`,
            },
            messageIdentity(),
          ),
        ).message;
      const messages = [1, 2, 3, 4].map((sequence) => append(current.id, `current.${sequence}`));
      const siblingMessage = append(sibling.id, 'sibling');
      append(foreign.id, 'foreign');
      const publicMessage = (message: Message) => ({
        id: message.id,
        sequence: message.sequence,
        role: message.role,
        status: message.status,
        originatingRunId: message.originatingRunId,
        blocks: message.blocks,
        contentHash: message.contentHash,
        createdAt: message.createdAt,
      });
      const input = ChatQueryDefinition.parseInput({
        chatId: null,
        beforeSequence: 4,
        afterSequence: 1,
        messageIds: [],
        page: { cursor: null, limit: 1 },
      });
      const first = chats.queryMessages('project.1', current.id, input);
      expect(first.items).toEqual([publicMessage(messages[2]!)]);
      expect(first.nextCursor).not.toBeNull();
      const second = chats.queryMessages('project.1', current.id, {
        ...input,
        page: { ...input.page, cursor: first.nextCursor },
      });
      expect(second).toEqual({ items: [publicMessage(messages[1]!)], nextCursor: null });
      expect(
        chats.queryMessages(
          'project.1',
          current.id,
          ChatQueryDefinition.parseInput({
            chatId: current.id,
            beforeSequence: null,
            afterSequence: null,
            messageIds: [messages[0]!.id, messages[3]!.id],
            page: { cursor: null, limit: 20 },
          }),
        ).items,
      ).toEqual([publicMessage(messages[0]!), publicMessage(messages[3]!)]);
      expect(
        chats.queryMessages(
          'project.1',
          current.id,
          ChatQueryDefinition.parseInput({
            chatId: sibling.id,
            beforeSequence: null,
            afterSequence: null,
            messageIds: [],
            page: { cursor: null, limit: 20 },
          }),
        ).items,
      ).toEqual([publicMessage(siblingMessage)]);
      expect(() =>
        chats.queryMessages('project.1', current.id, {
          ...input,
          afterSequence: 2,
          page: { ...input.page, cursor: first.nextCursor },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        chats.queryMessages('project.1', current.id, {
          ...input,
          chatId: foreign.id,
          page: { cursor: null, limit: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });
});
