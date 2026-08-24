import { z } from 'zod';
import { strictObject } from './canonical.js';
import { UserChoiceSubjectSchema } from './decision.js';
import {
  ActorSchema,
  AuthoritySchema,
  CausationRefSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
} from './primitives.js';

function revisionedSearchSource<
  const Kind extends
    | 'production'
    | 'project_media_ref'
    | 'delivery'
    | 'generated_result'
    | 'result_assessment'
    | 'review_cut'
    | 'delivery_export',
  const Authority extends
    | 'production'
    | 'project_media_ref'
    | 'delivery'
    | 'generated_result'
    | 'result_assessment_attempt'
    | 'review_cut_attempt'
    | 'delivery_export',
>(kind: Kind, authority: Authority) {
  return strictObject({
    kind: z.literal(kind),
    ref: DomainObjectRefSchema,
  }).refine((source) => source.ref.authority === authority, {
    path: ['ref', 'authority'],
    message: `${kind} search source must reference ${authority}`,
  });
}

export const ProjectSearchSourceV1Schema = z.union([
  revisionedSearchSource('production', 'production'),
  revisionedSearchSource('project_media_ref', 'project_media_ref'),
  revisionedSearchSource('delivery', 'delivery'),
  revisionedSearchSource('generated_result', 'generated_result'),
  revisionedSearchSource('result_assessment', 'result_assessment_attempt'),
  revisionedSearchSource('review_cut', 'review_cut_attempt'),
  revisionedSearchSource('delivery_export', 'delivery_export'),
  strictObject({
    kind: z.literal('message'),
    messageId: EntityIdSchema,
    chatId: EntityIdSchema,
    sequence: SequenceSchema,
    contentHash: Sha256Schema,
  }),
]);
export const ProjectSearchDocumentStateSchema = z.enum(['current', 'historical']);

export const ObjectRevisionChangedPayloadSchema = strictObject({
  type: z.literal('object_revision_changed'),
  beforeRevision: RevisionSchema,
  afterRevision: RevisionSchema,
  beforeHash: Sha256Schema,
  afterHash: Sha256Schema,
});
export const ObjectCreatedPayloadSchema = strictObject({
  type: z.literal('object_created'),
  revision: z.literal(0),
  contentHash: Sha256Schema,
});
export const MessageAppendedPayloadSchema = strictObject({
  type: z.literal('message_appended'),
  messageId: EntityIdSchema,
  chatId: EntityIdSchema,
  sequence: SequenceSchema,
  contentHash: Sha256Schema,
});
export const ChoiceRecordedPayloadSchema = strictObject({
  type: z.literal('choice_recorded'),
  choiceId: EntityIdSchema,
});
export const MediaAttachedPayloadSchema = strictObject({
  type: z.literal('media_attached'),
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  blobHash: Sha256Schema,
});
export const MediaDetachedPayloadSchema = strictObject({
  type: z.literal('media_detached'),
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const GeneratedResultRecordedPayloadSchema = strictObject({
  type: z.literal('generated_result_recorded'),
  resultId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const DeliveryChangedPayloadSchema = strictObject({
  type: z.literal('delivery_changed'),
  deliveryId: EntityIdSchema,
  beforeRevision: RevisionSchema,
  afterRevision: RevisionSchema,
  manifestHash: Sha256Schema.nullable(),
});
export const PayloadRedactedSchema = strictObject({
  type: z.literal('payload_redacted'),
  redactedEventId: EntityIdSchema,
  retainedPayloadHash: Sha256Schema,
  reason: z.enum(['privacy_request', 'retention_policy']),
});
export const ProjectEventPayloadSchema = z.union([
  ObjectCreatedPayloadSchema,
  ObjectRevisionChangedPayloadSchema,
  MessageAppendedPayloadSchema,
  ChoiceRecordedPayloadSchema,
  MediaAttachedPayloadSchema,
  MediaDetachedPayloadSchema,
  GeneratedResultRecordedPayloadSchema,
  DeliveryChangedPayloadSchema,
  PayloadRedactedSchema,
]);
export const ProjectEventTypeSchema = z.enum([
  'object_created',
  'object_revision_changed',
  'message_appended',
  'choice_recorded',
  'media_attached',
  'media_detached',
  'generated_result_recorded',
  'delivery_changed',
  'payload_redacted',
]);
export const ProjectEventSubjectSchema = strictObject({
  authority: AuthoritySchema,
  id: EntityIdSchema,
});
export const ProjectEventPayloadStateSchema = z.union([
  strictObject({
    state: z.literal('available'),
    payload: ProjectEventPayloadSchema,
  }),
  strictObject({
    state: z.literal('redacted'),
    erasedAt: IsoTimestampSchema,
  }),
]);

const projectEventViewFields = {
  projectId: EntityIdSchema,
  sequence: SequenceSchema,
  eventVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).finite(),
  eventType: ProjectEventTypeSchema,
  occurredAt: IsoTimestampSchema,
  actor: ActorSchema,
  subject: ProjectEventSubjectSchema,
  causation: CausationRefSchema,
  correlationId: EntityIdSchema,
  payloadHash: Sha256Schema,
  payloadState: ProjectEventPayloadStateSchema,
  previousEventHash: Sha256Schema.nullable(),
  eventHash: Sha256Schema,
} as const;

export const ProjectEventSchema = strictObject({
  authority: z.literal('project_event'),
  id: EntityIdSchema,
  ...projectEventViewFields,
  idempotencyKey: EntityIdSchema,
}).superRefine((event, context) => {
  if (
    event.payloadState.state === 'available' &&
    event.payloadState.payload.type !== event.eventType
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payloadState', 'payload', 'type'],
      message: 'ProjectEvent type must match its available payload',
    });
  }
});

export const ProjectEventViewSchema = strictObject({
  eventId: EntityIdSchema,
  ...projectEventViewFields,
}).superRefine((event, context) => {
  if (
    event.payloadState.state === 'available' &&
    event.payloadState.payload.type !== event.eventType
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payloadState', 'payload', 'type'],
      message: 'ProjectEvent type must match its available payload',
    });
  }
});

export const ProjectHistorySourceSchema = z.enum([
  'message',
  'run_event',
  'project_event',
  'generated_result',
  'user_choice',
]);

const historyEntryFields = {
  projectId: EntityIdSchema,
  occurredAt: IsoTimestampSchema,
  summary: z.string().min(1).max(20_000),
} as const;

export const MessageHistoryEntryViewSchema = strictObject({
  ...historyEntryFields,
  source: z.literal('message'),
  messageId: EntityIdSchema,
  chatId: EntityIdSchema,
  sequence: SequenceSchema,
  role: z.enum(['user', 'assistant']),
  contentHash: Sha256Schema,
});
export const RunEventHistoryEntryViewSchema = strictObject({
  ...historyEntryFields,
  source: z.literal('run_event'),
  runId: EntityIdSchema,
  eventId: EntityIdSchema,
  sequence: SequenceSchema,
  actor: ActorSchema,
  causation: CausationRefSchema,
  eventHash: Sha256Schema,
});
export const ProjectEventHistoryEntryViewSchema = strictObject({
  ...historyEntryFields,
  source: z.literal('project_event'),
  eventId: EntityIdSchema,
  sequence: SequenceSchema,
  eventVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).finite(),
  eventType: ProjectEventTypeSchema,
  actor: ActorSchema,
  subject: ProjectEventSubjectSchema,
  causation: CausationRefSchema,
  correlationId: EntityIdSchema,
  payloadHash: Sha256Schema,
  payloadState: ProjectEventPayloadStateSchema,
  previousEventHash: Sha256Schema.nullable(),
  eventHash: Sha256Schema,
}).superRefine((event, context) => {
  if (
    event.payloadState.state === 'available' &&
    event.payloadState.payload.type !== event.eventType
  ) {
    context.addIssue({
      code: 'custom',
      path: ['payloadState', 'payload', 'type'],
      message: 'ProjectEvent type must match its available payload',
    });
  }
});
export const GeneratedResultHistoryEntryViewSchema = strictObject({
  ...historyEntryFields,
  source: z.literal('generated_result'),
  resultId: EntityIdSchema,
  runId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const UserChoiceHistoryEntryViewSchema = strictObject({
  ...historyEntryFields,
  source: z.literal('user_choice'),
  choiceId: EntityIdSchema,
  actor: z.enum(['user', 'commander', 'import']),
  subject: UserChoiceSubjectSchema,
  causation: CausationRefSchema,
});
export const ProjectHistoryEntryViewSchema = z.union([
  MessageHistoryEntryViewSchema,
  RunEventHistoryEntryViewSchema,
  ProjectEventHistoryEntryViewSchema,
  GeneratedResultHistoryEntryViewSchema,
  UserChoiceHistoryEntryViewSchema,
]);
export const ProjectHistorySchema = strictObject({
  view: z.literal('project_history'),
  projectId: EntityIdSchema,
  watermark: CountSchema,
  entries: z.array(ProjectHistoryEntryViewSchema).max(50_000),
});

const RevisionedMemoryDomainRefSchema = DomainObjectRefSchema.refine(
  (ref) => ['project', 'project_media_ref', 'production', 'delivery'].includes(ref.authority),
  {
    path: ['authority'],
    message: 'Memory domain source must reference Project, Production, Project Media, or Delivery',
  },
);
const GeneratedResultRefSchema = DomainObjectRefSchema.refine(
  (ref) => ref.authority === 'generated_result',
  {
    path: ['authority'],
    message: 'Generated result Memory source must reference a GeneratedResult',
  },
);

export const MemorySourceSchema = z.union([
  strictObject({
    kind: z.literal('domain_object'),
    ref: RevisionedMemoryDomainRefSchema,
  }),
  strictObject({
    kind: z.literal('message'),
    messageId: EntityIdSchema,
    chatId: EntityIdSchema,
    sequence: SequenceSchema,
    contentHash: Sha256Schema,
  }),
  strictObject({
    kind: z.literal('user_choice'),
    choiceId: EntityIdSchema,
  }),
  strictObject({
    kind: z.literal('committed_run_change'),
    runId: EntityIdSchema,
    projectEventId: EntityIdSchema,
    projectEventSequence: SequenceSchema,
    projectEventHash: Sha256Schema,
  }),
  strictObject({
    kind: z.literal('generated_result'),
    ref: GeneratedResultRefSchema,
  }),
]);
export const ProjectMemoryCategorySchema = z.enum([
  'identity',
  'visual_direction',
  'story',
  'production',
  'media',
  'decision',
  'delivery',
]);
export const ProjectMemoryItemStateSchema = z.enum(['current', 'superseded', 'conflicted']);
export const ProjectMemoryIndexEntrySchema = strictObject({
  id: EntityIdSchema,
  category: ProjectMemoryCategorySchema,
  sources: z.array(MemorySourceSchema).min(1).max(100),
  state: ProjectMemoryItemStateSchema,
  tentative: z.boolean(),
  topics: z.array(z.string().trim().min(1).max(120)).max(100),
  searchableText: z.string().min(1).max(100_000),
  contentHash: Sha256Schema,
});
export const MemoryCompletenessSchema = z.enum(['complete', 'partial', 'failed']);
export const ProjectMemoryIndexSchema = strictObject({
  authority: z.literal('project_memory'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  derivationVersion: z.string().min(1).max(80),
  sourceSchemaVersion: z.string().min(1).max(80),
  historyWatermark: CountSchema,
  sourceSetHash: Sha256Schema,
  completeness: MemoryCompletenessSchema,
  entries: z.array(ProjectMemoryIndexEntrySchema).max(100_000),
  createdAt: IsoTimestampSchema,
});
export const ProjectMemorySummaryStatementSchema = strictObject({
  text: z.string().min(1).max(20_000),
  citedEntryIds: z.array(EntityIdSchema).min(1).max(1_000),
});
export const ProjectMemorySummaryViewSchema = strictObject({
  view: z.literal('project_memory_summary'),
  projectId: EntityIdSchema,
  memoryVersionId: EntityIdSchema,
  derivationVersion: z.string().min(1).max(80),
  sourceSchemaVersion: z.string().min(1).max(80),
  historyWatermark: CountSchema,
  sourceSetHash: Sha256Schema,
  completeness: MemoryCompletenessSchema,
  statements: z.array(ProjectMemorySummaryStatementSchema).max(10_000),
  derivedAt: IsoTimestampSchema,
});
export const HistoryMemorySchema = z.union([
  ProjectEventSchema,
  ProjectHistorySchema,
  ProjectMemoryIndexSchema,
  ProjectMemorySummaryViewSchema,
]);

export type ProjectSearchSourceV1 = z.infer<typeof ProjectSearchSourceV1Schema>;
export type ProjectEventPayload = z.infer<typeof ProjectEventPayloadSchema>;
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type ProjectEventView = z.infer<typeof ProjectEventViewSchema>;
export type ProjectHistoryEntryView = z.infer<typeof ProjectHistoryEntryViewSchema>;
export type ProjectHistory = z.infer<typeof ProjectHistorySchema>;
export type MemorySource = z.infer<typeof MemorySourceSchema>;
export type ProjectMemoryIndexEntry = z.infer<typeof ProjectMemoryIndexEntrySchema>;
export type ProjectMemoryIndex = z.infer<typeof ProjectMemoryIndexSchema>;
export type ProjectMemorySummaryView = z.infer<typeof ProjectMemorySummaryViewSchema>;
export type HistoryMemory = z.infer<typeof HistoryMemorySchema>;
