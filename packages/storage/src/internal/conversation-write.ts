import {
  ChatSchema,
  EntityIdSchema,
  MessageAttachmentSchema,
  MessageBlockSchema,
  MessageSchema,
  IsoTimestampSchema,
  strictObject,
  parseCanonical,
  type Chat,
  type Message,
  z,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { decodeMessageBlocks, encodeMessageBlocks } from './canonical-codecs.js';
import type { CommandContext } from './command.js';
import type { StorageEnvironment } from './environment.js';
import { hashCanonical, hashContentObject } from './hashes.js';
import { loadGlobalMediaAsset } from './media-records.js';
import { appendProjectEvent } from './project-events.js';
import { upsertProjectSearchDocument } from './search-projection.js';

const AppendMessageInputSchema = z.union([
  strictObject({
    chatId: EntityIdSchema,
    role: z.literal('user'),
    status: z.literal('accepted'),
    originatingRunId: z.null(),
    blocks: z.array(MessageBlockSchema).min(1).max(1_000),
    attachments: z.array(MessageAttachmentSchema).max(100),
    supersedesMessageId: EntityIdSchema.nullable(),
    idempotencyKey: EntityIdSchema,
  }),
  strictObject({
    chatId: EntityIdSchema,
    role: z.literal('assistant'),
    status: z.enum(['completed', 'interrupted']),
    originatingRunId: EntityIdSchema,
    blocks: z.array(MessageBlockSchema).min(1).max(1_000),
    attachments: z.array(MessageAttachmentSchema).max(100),
    supersedesMessageId: EntityIdSchema.nullable(),
    idempotencyKey: EntityIdSchema,
  }),
]);

export type AppendMessageInTransactionInput = z.input<typeof AppendMessageInputSchema>;
type ParsedAppendMessageInTransactionInput = z.output<typeof AppendMessageInputSchema>;

const AppendMessageIdentitySchema = strictObject({
  messageId: EntityIdSchema,
  eventId: EntityIdSchema,
  searchDocumentId: EntityIdSchema,
  createdAt: IsoTimestampSchema,
});

export type AppendMessageInTransactionIdentity = z.output<typeof AppendMessageIdentitySchema>;

export interface AppendMessageInTransactionResult {
  readonly message: Message;
  readonly eventId: string | null;
}

interface ChatRow {
  id: string;
  project_id: string;
  revision: number;
  content_hash: string;
  title: string;
  lifecycle: Chat['lifecycle'];
  message_count: number;
  message_head_sequence: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

interface MessageRow {
  id: string;
  project_id: string;
  chat_id: string;
  sequence: number;
  role: Message['role'];
  status: Message['status'];
  originating_run_id: string | null;
  content_hash: string;
  supersedes_message_id: string | null;
  created_at: string;
}

interface MessagePayloadRow {
  blocks_v1_json: string | null;
  payload_hash: string;
  erased_at: string | null;
}

interface MessageAttachmentRow {
  ordinal: number;
  project_media_ref_id: string;
  global_asset_id: string;
  blob_hash: string;
  role: Message['attachments'][number]['role'];
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function notFound(label: string, id: string): StorageError {
  return new StorageError('NOT_FOUND', `${label} was not found: ${id}`);
}

function assertContentHash(value: { readonly contentHash: string }, label: string): void {
  if (hashContentObject(value) !== value.contentHash) {
    throw corrupt(`${label} content hash does not match its stored value`);
  }
}

function chatFromRow(row: ChatRow): Chat {
  const chat = parseCanonical(ChatSchema, {
    authority: 'chat',
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    contentHash: row.content_hash,
    title: row.title,
    lifecycle: row.lifecycle,
    messageCount: row.message_count,
    messageHeadSequence: row.message_head_sequence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  });
  assertContentHash(chat, `Chat ${chat.id}`);
  return chat;
}

export function findChat(database: DatabaseSync, chatId: string): Chat | undefined {
  const id = parseCanonical(EntityIdSchema, chatId);
  const row = database.prepare('SELECT * FROM chats WHERE id = ?').get(id) as unknown as
    ChatRow | undefined;
  return row === undefined ? undefined : chatFromRow(row);
}

export function loadChat(database: DatabaseSync, chatId: string): Chat {
  const chat = findChat(database, chatId);
  if (chat === undefined) throw notFound('Chat', chatId);
  return chat;
}

function attachmentsForMessage(database: DatabaseSync, messageId: string): Message['attachments'] {
  const rows = database
    .prepare(
      `SELECT ordinal, project_media_ref_id, global_asset_id, blob_hash, role
       FROM message_attachments
       WHERE message_id = ?
       ORDER BY ordinal`,
    )
    .all(messageId) as unknown as MessageAttachmentRow[];
  return rows.map((row, index) => {
    if (row.ordinal !== index) {
      throw corrupt(`Message ${messageId} attachment ordinals are not contiguous`);
    }
    return parseCanonical(MessageAttachmentSchema, {
      projectMediaRefId: row.project_media_ref_id,
      globalAssetId: row.global_asset_id,
      blobHash: row.blob_hash,
      role: row.role,
    });
  });
}

function messageFromRow(database: DatabaseSync, row: MessageRow): Message {
  const payload = database
    .prepare(
      `SELECT blocks_v1_json, payload_hash, erased_at
       FROM message_payloads
       WHERE message_id = ?`,
    )
    .get(row.id) as unknown as MessagePayloadRow | undefined;
  if (payload === undefined) throw corrupt(`Message ${row.id} has no payload record`);
  if (payload.blocks_v1_json === null || payload.erased_at !== null) {
    throw notFound('Message payload', row.id);
  }
  const blocks = decodeMessageBlocks(payload.blocks_v1_json);
  if (hashCanonical(blocks) !== payload.payload_hash) {
    throw corrupt(`Message ${row.id} payload hash does not match its blocks`);
  }
  const message = parseCanonical(MessageSchema, {
    authority: 'message',
    id: row.id,
    projectId: row.project_id,
    chatId: row.chat_id,
    sequence: row.sequence,
    role: row.role,
    status: row.status,
    originatingRunId: row.originating_run_id,
    blocks,
    attachments: attachmentsForMessage(database, row.id),
    supersedesMessageId: row.supersedes_message_id,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  });
  assertContentHash(message, `Message ${message.id}`);
  return message;
}

export function findMessage(database: DatabaseSync, messageId: string): Message | undefined {
  const id = parseCanonical(EntityIdSchema, messageId);
  const row = database.prepare('SELECT * FROM messages WHERE id = ?').get(id) as unknown as
    MessageRow | undefined;
  return row === undefined ? undefined : messageFromRow(database, row);
}

export function loadMessage(database: DatabaseSync, messageId: string): Message {
  const message = findMessage(database, messageId);
  if (message === undefined) throw notFound('Message', messageId);
  return message;
}

function validateMediaSnapshot(
  database: DatabaseSync,
  projectId: string,
  projectMediaRefId: string,
  globalAssetId: string,
  blobHash: string,
): void {
  const row = database
    .prepare(
      `SELECT ref.project_id, ref.global_asset_id, ref.lifecycle
       FROM project_media_refs AS ref
       WHERE ref.id = ?`,
    )
    .get(projectMediaRefId) as unknown as
    | {
        project_id: string;
        global_asset_id: string;
        lifecycle: 'active' | 'detached';
      }
    | undefined;
  if (row === undefined) throw notFound('Project Media reference', projectMediaRefId);
  if (row.project_id !== projectId) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Project Media reference ${projectMediaRefId} belongs to another Project`,
    );
  }
  if (row.lifecycle !== 'active') {
    throw new StorageError(
      'INVALID_REQUEST',
      `Project Media reference ${projectMediaRefId} is detached`,
    );
  }
  const asset = loadGlobalMediaAsset(database, row.global_asset_id);
  if (row.global_asset_id !== globalAssetId || asset.blobHash !== blobHash) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Project Media snapshot ${projectMediaRefId} no longer matches`,
    );
  }
}

function validateProjectObjectBlock(
  database: DatabaseSync,
  projectId: string,
  block: Extract<Message['blocks'][number], { type: 'project_object' }>,
): void {
  const table =
    block.authority === 'project'
      ? 'projects'
      : block.authority === 'production'
        ? 'production_objects'
        : block.authority === 'canvas'
          ? 'canvas_documents'
          : 'delivery_plans';
  const row = database
    .prepare(
      table === 'projects'
        ? 'SELECT id AS project_id, revision, content_hash FROM projects WHERE id = ?'
        : `SELECT project_id, revision, content_hash FROM ${table} WHERE id = ?`,
    )
    .get(block.objectId) as unknown as
    { project_id: string; revision: number; content_hash: string } | undefined;
  if (row === undefined) throw notFound(`${block.authority} object`, block.objectId);
  if (row.project_id !== projectId) {
    throw new StorageError(
      'INVALID_REQUEST',
      `${block.authority} object ${block.objectId} belongs to another Project`,
    );
  }
  if (row.revision !== block.revision || row.content_hash !== block.contentHash) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `${block.authority} object ${block.objectId} does not match the selected revision`,
    );
  }
}

function validateMessageReferences(
  database: DatabaseSync,
  projectId: string,
  input: ParsedAppendMessageInTransactionInput,
): void {
  for (const attachment of input.attachments) {
    validateMediaSnapshot(
      database,
      projectId,
      attachment.projectMediaRefId,
      attachment.globalAssetId,
      attachment.blobHash,
    );
  }
  for (const block of input.blocks) {
    if (block.type === 'project_media') {
      validateMediaSnapshot(
        database,
        projectId,
        block.projectMediaRefId,
        block.globalAssetId,
        block.blobHash,
      );
    } else if (block.type === 'project_object') {
      validateProjectObjectBlock(database, projectId, block);
    } else if (block.type === 'generated_result') {
      const result = database
        .prepare('SELECT project_id FROM generated_results WHERE id = ?')
        .get(block.resultId) as unknown as { project_id: string } | undefined;
      if (result === undefined) throw notFound('Generated result', block.resultId);
      if (result.project_id !== projectId) {
        throw new StorageError(
          'INVALID_REQUEST',
          `Generated result ${block.resultId} belongs to another Project`,
        );
      }
    }
  }
}

function validateSupersedes(
  database: DatabaseSync,
  projectId: string,
  input: ParsedAppendMessageInTransactionInput,
): void {
  if (input.supersedesMessageId === null) return;
  const superseded = database
    .prepare('SELECT project_id, chat_id, role FROM messages WHERE id = ?')
    .get(input.supersedesMessageId) as unknown as
    { project_id: string; chat_id: string; role: Message['role'] } | undefined;
  if (superseded === undefined) throw notFound('Superseded Message', input.supersedesMessageId);
  if (
    superseded.project_id !== projectId ||
    superseded.chat_id !== input.chatId ||
    superseded.role !== input.role
  ) {
    throw new StorageError(
      'INVALID_REQUEST',
      'A Message may supersede only the same role in the same Chat and Project',
    );
  }
}

function validateOriginatingRun(
  database: DatabaseSync,
  projectId: string,
  input: ParsedAppendMessageInTransactionInput,
): void {
  if (input.role === 'user') return;
  const run = database
    .prepare('SELECT project_id, chat_id FROM runs WHERE id = ?')
    .get(input.originatingRunId) as unknown as { project_id: string; chat_id: string } | undefined;
  if (run === undefined) throw notFound('Originating Run', input.originatingRunId);
  if (run.project_id !== projectId || run.chat_id !== input.chatId) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Originating Run ${input.originatingRunId} belongs to another Chat or Project`,
    );
  }
}

export function appendMessageInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  context: CommandContext,
  inputValue: AppendMessageInTransactionInput,
  identityValue: AppendMessageInTransactionIdentity,
): AppendMessageInTransactionResult {
  if (!database.isTransaction) {
    throw new StorageError(
      'INVALID_REQUEST',
      'appendMessageInTransaction requires an active transaction',
    );
  }
  const input = parseCanonical(AppendMessageInputSchema, inputValue);
  const identity = parseCanonical(AppendMessageIdentitySchema, identityValue);
  const chat = loadChat(database, input.chatId);
  if (chat.lifecycle !== 'active') {
    throw new StorageError('INVALID_REQUEST', `Chat ${chat.id} is not active`);
  }
  if (chat.messageCount !== (chat.messageHeadSequence ?? 0)) {
    throw corrupt(`Chat ${chat.id} Message head does not match its count`);
  }
  validateMessageReferences(database, chat.projectId, input);
  validateSupersedes(database, chat.projectId, input);
  validateOriginatingRun(database, chat.projectId, input);

  const sequence = (chat.messageHeadSequence ?? 0) + 1;
  const messageWithoutHash = {
    authority: 'message' as const,
    id: identity.messageId,
    projectId: chat.projectId,
    chatId: chat.id,
    sequence,
    role: input.role,
    status: input.status,
    originatingRunId: input.originatingRunId,
    blocks: input.blocks,
    attachments: input.attachments,
    supersedesMessageId: input.supersedesMessageId,
    contentHash: '',
    createdAt: identity.createdAt,
  };
  const message = parseCanonical(MessageSchema, {
    ...messageWithoutHash,
    contentHash: hashContentObject(messageWithoutHash),
  });
  const blocksJson = encodeMessageBlocks(message.blocks);

  database
    .prepare(
      `INSERT INTO messages (
         id, project_id, chat_id, sequence, role, status, originating_run_id,
         content_hash, supersedes_message_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      message.id,
      message.projectId,
      message.chatId,
      message.sequence,
      message.role,
      message.status,
      message.originatingRunId,
      message.contentHash,
      message.supersedesMessageId,
      message.createdAt,
    );
  database
    .prepare(
      `INSERT INTO message_payloads (message_id, blocks_v1_json, payload_hash, erased_at)
       VALUES (?, ?, ?, NULL)`,
    )
    .run(message.id, blocksJson, hashCanonical(message.blocks));
  const insertAttachment = database.prepare(
    `INSERT INTO message_attachments (
       message_id, ordinal, project_media_ref_id, global_asset_id, blob_hash, role
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  message.attachments.forEach((attachment, ordinal) => {
    insertAttachment.run(
      message.id,
      ordinal,
      attachment.projectMediaRefId,
      attachment.globalAssetId,
      attachment.blobHash,
      attachment.role,
    );
  });

  const nextChatWithoutHash = {
    ...chat,
    revision: chat.revision + 1,
    messageCount: chat.messageCount + 1,
    messageHeadSequence: message.sequence,
    updatedAt: message.createdAt,
    contentHash: '',
  };
  const nextChat = parseCanonical(ChatSchema, {
    ...nextChatWithoutHash,
    contentHash: hashContentObject(nextChatWithoutHash),
  });
  const update = database
    .prepare(
      `UPDATE chats
       SET revision = ?, content_hash = ?, message_count = ?, message_head_sequence = ?, updated_at = ?
       WHERE id = ? AND revision = ?`,
    )
    .run(
      nextChat.revision,
      nextChat.contentHash,
      nextChat.messageCount,
      nextChat.messageHeadSequence,
      nextChat.updatedAt,
      chat.id,
      chat.revision,
    );
  if (Number(update.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `Chat ${chat.id} changed concurrently`);
  }

  const event = appendProjectEvent(database, {
    eventId: identity.eventId,
    projectId: message.projectId,
    occurredAt: message.createdAt,
    actor: context.actor,
    subject: { authority: 'message', id: message.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: input.idempotencyKey,
    payload: {
      type: 'message_appended',
      messageId: message.id,
      chatId: message.chatId,
      sequence: message.sequence,
      contentHash: message.contentHash,
    },
  });
  upsertProjectSearchDocument(
    database,
    environment,
    message.projectId,
    {
      kind: 'message',
      messageId: message.id,
      chatId: message.chatId,
      sequence: message.sequence,
      contentHash: message.contentHash,
    },
    'current',
    message.blocks
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n'),
    message.createdAt,
    identity.searchDocumentId,
  );
  return { message, eventId: event.id };
}
