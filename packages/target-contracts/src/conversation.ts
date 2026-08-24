import { z } from 'zod';
import { strictObject } from './canonical.js';
import {
  CountSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
} from './primitives.js';

export const ChatLifecycleSchema = z.enum(['active', 'archived', 'deleted']);
export const ChatSchema = strictObject({
  authority: z.literal('chat'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  title: z.string().trim().min(1).max(240),
  lifecycle: ChatLifecycleSchema,
  messageCount: CountSchema,
  messageHeadSequence: SequenceSchema.nullable(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  archivedAt: IsoTimestampSchema.nullable(),
  deletedAt: IsoTimestampSchema.nullable(),
});

export const TextMessageBlockSchema = strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(200_000),
});
export const ProjectObjectMessageBlockSchema = strictObject({
  type: z.literal('project_object'),
  authority: z.enum(['project', 'production', 'canvas', 'delivery']),
  objectId: EntityIdSchema,
  revision: z.number().int().nonnegative().finite(),
  contentHash: Sha256Schema,
});
export const MediaMessageBlockSchema = strictObject({
  type: z.literal('project_media'),
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  blobHash: Sha256Schema,
});
export const ResultMessageBlockSchema = strictObject({
  type: z.literal('generated_result'),
  resultId: EntityIdSchema,
});
export const MessageBlockSchema = z.union([
  TextMessageBlockSchema,
  ProjectObjectMessageBlockSchema,
  MediaMessageBlockSchema,
  ResultMessageBlockSchema,
]);

export const MessageAttachmentSchema = strictObject({
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  blobHash: Sha256Schema,
  role: z.enum(['reference', 'input', 'attachment']),
});

const MessageBaseShape = {
  authority: z.literal('message'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  chatId: EntityIdSchema,
  sequence: SequenceSchema,
  blocks: z.array(MessageBlockSchema).min(1).max(1_000),
  attachments: z.array(MessageAttachmentSchema).max(100),
  supersedesMessageId: EntityIdSchema.nullable(),
  contentHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
} as const;

export const MessageStatusSchema = z.enum(['accepted', 'completed', 'interrupted']);
export const UserMessageSchema = strictObject({
  ...MessageBaseShape,
  role: z.literal('user'),
  status: z.literal('accepted'),
  originatingRunId: z.null(),
});
export const AssistantMessageSchema = strictObject({
  ...MessageBaseShape,
  role: z.literal('assistant'),
  status: z.enum(['completed', 'interrupted']),
  originatingRunId: EntityIdSchema,
});
export const MessageSchema = z.union([UserMessageSchema, AssistantMessageSchema]);
export const ConversationSchema = z.union([ChatSchema, MessageSchema]);

export type ChatLifecycle = z.infer<typeof ChatLifecycleSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type MessageBlock = z.infer<typeof MessageBlockSchema>;
export type MessageAttachment = z.infer<typeof MessageAttachmentSchema>;
export type MessageStatus = z.infer<typeof MessageStatusSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
