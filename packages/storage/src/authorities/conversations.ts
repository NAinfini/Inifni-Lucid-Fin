import {
  ChatQueryDefinition,
  ChatSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  SequenceSchema,
  Sha256Schema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type Chat,
  type Message,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { executeWireMutation, type CommandContext } from '../internal/command.js';
import { loadChat, loadMessage } from '../internal/conversation-write.js';
import {
  decodeCursor as decodeOpaqueCursor,
  encodeCursor as encodeOpaqueCursor,
} from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { updateChatMessageSearchState } from '../internal/search-projection.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';
import {
  MessageSendAcceptanceSeedSchema,
  acceptRootRunForMessage,
  type MessageSendAcceptanceSeed,
} from '../internal/root-run-acceptance.js';

export { MessageSendAcceptanceSeedSchema };
export type { MessageSendAcceptanceSeed };

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];
type ChatQueryInput = z.output<typeof ChatQueryDefinition.inputSchema>;
type ChatQuerySuccess = z.output<typeof ChatQueryDefinition.successSchema>;

const ChatListCursorSchema = strictObject({
  kind: z.literal('chat_list'),
  filterHash: Sha256Schema,
  updatedAt: IsoTimestampSchema,
  id: EntityIdSchema,
});
const MessageListCursorSchema = strictObject({
  kind: z.literal('message_list'),
  filterHash: Sha256Schema,
  beforeSequence: SequenceSchema,
});
const ChatQueryCursorSchema = strictObject({
  kind: z.literal('chat_query'),
  filterHash: Sha256Schema,
  beforeSequence: SequenceSchema,
});

interface OrderedRow {
  id: string;
  updated_at: string;
}

interface MessageSequenceRow {
  id: string;
  sequence: number;
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

function encodeCursor(scope: string, value: unknown): string {
  return encodeOpaqueCursor(scope, canonicalJson(value));
}

function decodeCursor<Schema extends z.ZodType>(
  cursor: string,
  scope: string,
  schema: Schema,
): z.output<Schema> {
  try {
    const key = decodeOpaqueCursor(cursor, scope);
    if (key === null) throw new Error('Missing cursor key');
    return parseCanonical(schema, JSON.parse(key) as unknown);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'List cursor is invalid', { cause });
  }
}

function requireProject(database: DatabaseSync, projectId: string): void {
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new StorageError('NOT_FOUND', `Project was not found: ${projectId}`);
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

function queryMessages(
  database: DatabaseSync,
  projectIdValue: string,
  defaultChatIdValue: string,
  inputValue: ChatQueryInput,
): ChatQuerySuccess {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const defaultChatId = parseCanonical(EntityIdSchema, defaultChatIdValue);
  const input = ChatQueryDefinition.parseInput(inputValue);
  requireProject(database, projectId);
  const defaultChat = loadChat(database, defaultChatId);
  if (defaultChat.projectId !== projectId) {
    throw new StorageError('INVALID_REQUEST', 'Default Chat belongs to another Project');
  }
  const chat = input.chatId === null ? defaultChat : loadChat(database, input.chatId);
  if (chat.projectId !== projectId) {
    throw new StorageError('INVALID_REQUEST', `Chat ${chat.id} belongs to another Project`);
  }
  const filterHash = hashCanonical({
    projectId,
    chatId: chat.id,
    beforeSequence: input.beforeSequence,
    afterSequence: input.afterSequence,
    messageIds: [...input.messageIds].sort(),
  });
  const cursor =
    input.page.cursor === null
      ? null
      : decodeCursor(input.page.cursor, 'chat.query', ChatQueryCursorSchema);
  if (cursor !== null && cursor.filterHash !== filterHash) {
    throw new StorageError('INVALID_REQUEST', 'Chat query cursor belongs to another query');
  }
  const upperBounds = [input.beforeSequence, cursor?.beforeSequence].filter(
    (value): value is number => value !== null && value !== undefined,
  );
  const upperBound = upperBounds.length === 0 ? null : Math.min(...upperBounds);
  const upperClause = upperBound === null ? '' : ' AND sequence < ?';
  const lowerClause = input.afterSequence === null ? '' : ' AND sequence > ?';
  const idClause =
    input.messageIds.length === 0
      ? ''
      : ` AND id IN (${input.messageIds.map(() => '?').join(', ')})`;
  const parameters: Array<string | number> = [
    chat.id,
    ...(upperBound === null ? [] : [upperBound]),
    ...(input.afterSequence === null ? [] : [input.afterSequence]),
    ...input.messageIds,
    input.page.limit + 1,
  ];
  const rows = database
    .prepare(
      `SELECT id, sequence
       FROM messages
       WHERE chat_id = ?${upperClause}${lowerClause}${idClause}
       ORDER BY sequence DESC
       LIMIT ?`,
    )
    .all(...parameters) as unknown as MessageSequenceRow[];
  const hasMore = rows.length > input.page.limit;
  const pageRows = rows.slice(0, input.page.limit);
  const oldest = pageRows.at(-1);
  return ChatQueryDefinition.parseSuccess({
    items: [...pageRows].reverse().map((row) => publicMessage(loadMessage(database, row.id))),
    nextCursor:
      hasMore && oldest !== undefined
        ? encodeCursor('chat.query', {
            kind: 'chat_query',
            filterHash,
            beforeSequence: oldest.sequence,
          })
        : null,
  });
}

function createChat(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'chat.create'>,
  context: CommandContext,
): Success<'chat.create'> {
  const committedAt = environment.now();
  return executeWireMutation(database, request, context, committedAt, () => {
    requireProject(database, request.input.projectId);
    const chatWithoutHash = {
      authority: 'chat' as const,
      id: environment.createId('chat'),
      projectId: request.input.projectId,
      revision: 0,
      contentHash: '',
      title: request.input.title,
      lifecycle: 'active' as const,
      messageCount: 0,
      messageHeadSequence: null,
      createdAt: committedAt,
      updatedAt: committedAt,
      archivedAt: null,
      deletedAt: null,
    };
    const chat = parseCanonical(ChatSchema, {
      ...chatWithoutHash,
      contentHash: hashContentObject(chatWithoutHash),
    });
    database
      .prepare(
        `INSERT INTO chats (
           id, project_id, revision, content_hash, title, lifecycle,
           message_count, message_head_sequence, created_at, updated_at, archived_at, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chat.id,
        chat.projectId,
        chat.revision,
        chat.contentHash,
        chat.title,
        chat.lifecycle,
        chat.messageCount,
        chat.messageHeadSequence,
        chat.createdAt,
        chat.updatedAt,
        chat.archivedAt,
        chat.deletedAt,
      );
    appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: chat.projectId,
      occurredAt: committedAt,
      actor: context.actor,
      subject: { authority: 'chat', id: chat.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: request.requestId,
      payload: { type: 'object_created', revision: 0, contentHash: chat.contentHash },
    });
    return { projectId: chat.projectId, response: success<'chat.create'>(request, chat) };
  });
}

type ChatMutationMethod = 'chat.rename' | 'chat.archive' | 'chat.restore' | 'chat.delete';
type ChatMutationRequest = Request<ChatMutationMethod>;
type ChatMutationSuccess = Success<ChatMutationMethod>;

function chatMutationSuccess(request: ChatMutationRequest, result: Chat): ChatMutationSuccess {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as ChatMutationSuccess;
}

function mutateChat(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: ChatMutationRequest,
  context: CommandContext,
): ChatMutationSuccess {
  const committedAt = environment.now();
  return executeWireMutation(database, request, context, committedAt, () => {
    const before = loadChat(database, request.input.chatId);
    if (before.revision !== request.input.expectedRevision) {
      throw new StorageError('REVISION_CONFLICT', `Chat ${before.id} revision does not match`);
    }
    if (
      (request.method === 'chat.rename' && request.input.title === before.title) ||
      (request.method === 'chat.archive' && before.lifecycle === 'archived') ||
      (request.method === 'chat.restore' && before.lifecycle === 'active') ||
      (request.method === 'chat.delete' && before.lifecycle === 'deleted')
    ) {
      return {
        projectId: before.projectId,
        response: chatMutationSuccess(request, before),
      };
    }
    if (before.lifecycle === 'deleted') {
      throw new StorageError(
        'INVALID_REQUEST',
        `Deleted Chat ${before.id} cannot be renamed, archived, or restored`,
      );
    }
    const lifecycle =
      request.method === 'chat.archive'
        ? 'archived'
        : request.method === 'chat.restore'
          ? 'active'
        : request.method === 'chat.delete'
          ? 'deleted'
          : before.lifecycle;
    const nextWithoutHash = {
      ...before,
      revision: before.revision + 1,
      contentHash: '',
      title: request.method === 'chat.rename' ? request.input.title : before.title,
      lifecycle,
      updatedAt: committedAt,
      archivedAt:
        request.method === 'chat.archive'
          ? committedAt
          : request.method === 'chat.restore'
            ? null
          : request.method === 'chat.delete'
            ? null
            : before.archivedAt,
      deletedAt: request.method === 'chat.delete' ? committedAt : before.deletedAt,
    };
    const after = parseCanonical(ChatSchema, {
      ...nextWithoutHash,
      contentHash: hashContentObject(nextWithoutHash),
    });
    const update = database
      .prepare(
        `UPDATE chats
         SET revision = ?, content_hash = ?, title = ?, lifecycle = ?, updated_at = ?,
             archived_at = ?, deleted_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(
        after.revision,
        after.contentHash,
        after.title,
        after.lifecycle,
        after.updatedAt,
        after.archivedAt,
        after.deletedAt,
        after.id,
        before.revision,
      );
    if (Number(update.changes) !== 1) {
      throw new StorageError('REVISION_CONFLICT', `Chat ${before.id} changed concurrently`);
    }
    if (request.method === 'chat.archive' || request.method === 'chat.delete') {
      updateChatMessageSearchState(database, after.projectId, after.id, 'historical', committedAt);
    } else if (request.method === 'chat.restore') {
      updateChatMessageSearchState(database, after.projectId, after.id, 'current', committedAt);
    }
    appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: after.projectId,
      occurredAt: committedAt,
      actor: context.actor,
      subject: { authority: 'chat', id: after.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: request.requestId,
      payload: {
        type: 'object_revision_changed',
        beforeRevision: before.revision,
        afterRevision: after.revision,
        beforeHash: before.contentHash,
        afterHash: after.contentHash,
      },
    });
    return { projectId: after.projectId, response: chatMutationSuccess(request, after) };
  });
}

export interface ConversationAuthority {
  readonly createChat: (
    request: Request<'chat.create'>,
    context: CommandContext,
  ) => Success<'chat.create'>;
  readonly renameChat: (
    request: Request<'chat.rename'>,
    context: CommandContext,
  ) => Success<'chat.rename'>;
  readonly archiveChat: (
    request: Request<'chat.archive'>,
    context: CommandContext,
  ) => Success<'chat.archive'>;
  readonly restoreChat: (
    request: Request<'chat.restore'>,
    context: CommandContext,
  ) => Success<'chat.restore'>;
  readonly deleteChat: (
    request: Request<'chat.delete'>,
    context: CommandContext,
  ) => Success<'chat.delete'>;
  readonly getChat: (chatId: string) => Chat;
  readonly listChats: (request: Request<'chat.list'>) => Success<'chat.list'>;
  readonly getMessage: (messageId: string) => Message;
  readonly listMessages: (request: Request<'message.list'>) => Success<'message.list'>;
  readonly queryMessages: (
    projectId: string,
    defaultChatId: string,
    input: ChatQueryInput,
  ) => ChatQuerySuccess;
  readonly sendMessage: (
    request: Request<'message.send'>,
    context: CommandContext,
    seed: MessageSendAcceptanceSeed,
  ) => Success<'message.send'>;
}

export function createConversationsAuthority(
  store: Store,
  environment: StorageEnvironment,
): ConversationAuthority {
  const authority: ConversationAuthority = {
    createChat(request, context) {
      const parsed = exactRequest(request, 'chat.create');
      return createChat(getStoreDatabase(store), environment, parsed, context);
    },
    renameChat(request, context) {
      const parsed = exactRequest(request, 'chat.rename');
      return mutateChat(
        getStoreDatabase(store),
        environment,
        parsed,
        context,
      ) as Success<'chat.rename'>;
    },
    archiveChat(request, context) {
      const parsed = exactRequest(request, 'chat.archive');
      return mutateChat(
        getStoreDatabase(store),
        environment,
        parsed,
        context,
      ) as Success<'chat.archive'>;
    },
    restoreChat(request, context) {
      const parsed = exactRequest(request, 'chat.restore');
      return mutateChat(
        getStoreDatabase(store),
        environment,
        parsed,
        context,
      ) as Success<'chat.restore'>;
    },
    deleteChat(request, context) {
      const parsed = exactRequest(request, 'chat.delete');
      return mutateChat(
        getStoreDatabase(store),
        environment,
        parsed,
        context,
      ) as Success<'chat.delete'>;
    },
    getChat(chatId) {
      return loadChat(getStoreDatabase(store), chatId);
    },
    listChats(request) {
      const parsed = exactRequest(request, 'chat.list');
      const database = getStoreDatabase(store);
      requireProject(database, parsed.input.projectId);
      const filterHash = hashCanonical({
        projectId: parsed.input.projectId,
        lifecycle: parsed.input.lifecycle,
      });
      const cursor =
        parsed.input.page.cursor === null
          ? null
          : decodeCursor(parsed.input.page.cursor, 'chat.list', ChatListCursorSchema);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new StorageError('INVALID_REQUEST', 'Chat cursor belongs to another query');
      }
      const lifecycleClause =
        parsed.input.lifecycle.length === 0
          ? ''
          : ` AND lifecycle IN (${parsed.input.lifecycle.map(() => '?').join(', ')})`;
      const cursorClause =
        cursor === null ? '' : ' AND (updated_at < ? OR (updated_at = ? AND id < ?))';
      const parameters: Array<string | number> = [
        parsed.input.projectId,
        ...parsed.input.lifecycle,
      ];
      if (cursor !== null) parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      parameters.push(parsed.input.page.limit + 1);
      const rows = database
        .prepare(
          `SELECT id, updated_at
           FROM chats
           WHERE project_id = ?${lifecycleClause}${cursorClause}
           ORDER BY updated_at DESC, id DESC
           LIMIT ?`,
        )
        .all(...parameters) as unknown as OrderedRow[];
      const hasMore = rows.length > parsed.input.page.limit;
      const pageRows = rows.slice(0, parsed.input.page.limit);
      const last = pageRows.at(-1);
      return success<'chat.list'>(parsed, {
        items: pageRows.map((row) => loadChat(database, row.id)),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor('chat.list', {
                kind: 'chat_list',
                filterHash,
                updatedAt: last.updated_at,
                id: last.id,
              })
            : null,
      });
    },
    getMessage(messageId) {
      return loadMessage(getStoreDatabase(store), messageId);
    },
    listMessages(request) {
      const parsed = exactRequest(request, 'message.list');
      const database = getStoreDatabase(store);
      loadChat(database, parsed.input.chatId);
      const filterHash = hashCanonical({ chatId: parsed.input.chatId });
      const cursor =
        parsed.input.page.cursor === null
          ? null
          : decodeCursor(parsed.input.page.cursor, 'message.list', MessageListCursorSchema);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new StorageError('INVALID_REQUEST', 'Message cursor belongs to another Chat');
      }
      const cutoffs = [parsed.input.beforeSequence, cursor?.beforeSequence].filter(
        (value): value is number => value !== null && value !== undefined,
      );
      const cutoff = cutoffs.length === 0 ? null : Math.min(...cutoffs);
      const rows = database
        .prepare(
          `SELECT id, sequence
           FROM messages
           WHERE chat_id = ?${cutoff === null ? '' : ' AND sequence < ?'}
           ORDER BY sequence DESC
           LIMIT ?`,
        )
        .all(
          ...[
            parsed.input.chatId,
            ...(cutoff === null ? [] : [cutoff]),
            parsed.input.page.limit + 1,
          ],
        ) as unknown as MessageSequenceRow[];
      const hasMore = rows.length > parsed.input.page.limit;
      const pageRows = rows.slice(0, parsed.input.page.limit);
      const oldest = pageRows.at(-1);
      return success<'message.list'>(parsed, {
        items: [...pageRows].reverse().map((row) => loadMessage(database, row.id)),
        nextCursor:
          hasMore && oldest !== undefined
            ? encodeCursor('message.list', {
                kind: 'message_list',
                filterHash,
                beforeSequence: oldest.sequence,
              })
            : null,
      });
    },
    queryMessages(projectId, defaultChatId, input) {
      return queryMessages(getStoreDatabase(store), projectId, defaultChatId, input);
    },
    sendMessage(request, context, seed) {
      const parsed = exactRequest(request, 'message.send');
      return acceptRootRunForMessage(getStoreDatabase(store), environment, parsed, context, seed);
    },
  };
  return Object.freeze(authority);
}
