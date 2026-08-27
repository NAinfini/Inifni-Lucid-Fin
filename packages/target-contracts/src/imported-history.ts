import { z } from 'zod';
import { strictObject } from './canonical.js';
import { JsonValueSchema } from './legacy-skill-content.js';
import { CountSchema, EntityIdSchema, IsoTimestampSchema, Sha256Schema } from './primitives.js';
import { ProductionCollectionMemberSchema, ProductionCollectionSchema } from './production.js';

const BoundedTextSchema = z.string().trim().min(1).max(4_000);
const LegacySequenceSchema = CountSchema;
export const ImportedHistoryPayloadV1Schema = JsonValueSchema;

export const ImportedHistoryBatchSchema = strictObject({
  authority: z.literal('imported_history_batch'),
  id: EntityIdSchema,
  sourceSchemaId: z.string().trim().min(1).max(160),
  sourceSnapshotHash: Sha256Schema,
  classificationHash: Sha256Schema,
  planHash: Sha256Schema,
  offlineEvidenceManifestHash: Sha256Schema.nullable(),
  reconciliationHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
});

export const ImportedPrivateEvidenceSchema = z.union([
  strictObject({ state: z.literal('none') }),
  strictObject({
    state: z.literal('unavailable'),
    payloadHash: Sha256Schema,
    offlineEvidenceId: EntityIdSchema,
  }),
]);

export const ImportedRunWorkTypeSchema = z.enum(['agent', 'subagent', 'tool_program']);
export const ImportedRunStatusSchema = z.enum([
  'accepted',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'blocked',
  'max_steps',
]);
export const ImportedRunHistorySchema = strictObject({
  authority: z.literal('imported_run_history'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  id: EntityIdSchema,
  batchId: EntityIdSchema,
  legacyRunId: EntityIdSchema,
  projectId: EntityIdSchema,
  chatId: EntityIdSchema.nullable(),
  legacySessionId: EntityIdSchema.nullable(),
  rootRunId: EntityIdSchema,
  parentRunId: EntityIdSchema.nullable(),
  retryOfRunId: EntityIdSchema.nullable(),
  workType: ImportedRunWorkTypeSchema,
  displayName: z.string().trim().min(1).max(240).nullable(),
  intent: z.string().trim().min(1).max(20_000),
  objective: z.string().trim().min(1).max(100_000).nullable(),
  status: ImportedRunStatusSchema,
  acceptedAt: IsoTimestampSchema,
  startedAt: IsoTimestampSchema.nullable(),
  finishedAt: IsoTimestampSchema.nullable(),
  lastSequence: LegacySequenceSchema.nullable(),
  sourcePayload: JsonValueSchema,
  sourcePayloadHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
}).superRefine((run, context) => {
  if (run.parentRunId === run.id || run.retryOfRunId === run.id) {
    context.addIssue({
      code: 'custom',
      path: ['parentRunId'],
      message: 'Imported Run cannot name itself as parent or retry source',
    });
  }
  if (run.rootRunId === run.id && run.parentRunId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['parentRunId'],
      message: 'Imported root Run cannot have a parent',
    });
  }
  if (run.rootRunId !== run.id && run.parentRunId === null) {
    context.addIssue({
      code: 'custom',
      path: ['rootRunId'],
      message: 'Imported root Run must name itself as rootRunId',
    });
  }
});

export const ImportedRunEventHistorySchema = strictObject({
  authority: z.literal('imported_run_event_history'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  id: EntityIdSchema,
  batchId: EntityIdSchema,
  runId: EntityIdSchema,
  sequence: LegacySequenceSchema,
  kind: BoundedTextSchema,
  step: CountSchema,
  occurredAt: IsoTimestampSchema,
  publicPayload: JsonValueSchema,
  publicPayloadHash: Sha256Schema,
  privateEvidence: ImportedPrivateEvidenceSchema,
  previousEventHash: Sha256Schema.nullable(),
  eventHash: Sha256Schema,
});

export function importedRunEventHashInput(
  event: Omit<ImportedRunEventHistory, 'eventHash'> | ImportedRunEventHistory,
) {
  const { eventHash: _eventHash, ...envelope } = event as ImportedRunEventHistory;
  return envelope;
}

export const ImportedRunScopeHistorySchema = strictObject({
  authority: z.literal('imported_run_scope_history'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  batchId: EntityIdSchema,
  runId: EntityIdSchema,
  ordinal: CountSchema,
  kind: BoundedTextSchema,
  payload: JsonValueSchema,
  payloadHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
});

export const ImportedRunAttachmentRoleSchema = z.enum([
  'reference',
  'input',
  'attachment',
  'output',
]);

export const ImportedRunAttachmentHistorySchema = strictObject({
  authority: z.literal('imported_run_attachment_history'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  batchId: EntityIdSchema,
  runId: EntityIdSchema,
  ordinal: CountSchema,
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  blobHash: Sha256Schema,
  role: ImportedRunAttachmentRoleSchema,
  sourcePayloadHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
});

export const ImportedTaskListHistorySchema = strictObject({
  authority: z.literal('imported_task_list_history'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  id: EntityIdSchema,
  batchId: EntityIdSchema,
  legacyTaskListId: EntityIdSchema,
  projectId: EntityIdSchema,
  chatId: EntityIdSchema.nullable(),
  importedRunId: EntityIdSchema.nullable(),
  taskListType: BoundedTextSchema,
  triggerSource: BoundedTextSchema,
  status: BoundedTextSchema,
  summary: z.string().max(20_000),
  sourcePayload: JsonValueSchema,
  sourcePayloadHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema.nullable(),
});

export const ImportedTaskItemHistorySchema = strictObject({
  authority: z.literal('imported_task_item_history'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  id: EntityIdSchema,
  batchId: EntityIdSchema,
  projectId: EntityIdSchema,
  taskListId: EntityIdSchema,
  legacyTaskId: EntityIdSchema,
  parentItemId: EntityIdSchema.nullable(),
  phaseKey: BoundedTextSchema,
  phaseName: BoundedTextSchema,
  phaseOrder: CountSchema,
  taskKey: BoundedTextSchema,
  title: BoundedTextSchema,
  kind: BoundedTextSchema,
  status: BoundedTextSchema,
  sourcePayload: JsonValueSchema,
  sourcePayloadHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export const ImportedHistoryRecordSchemaIdSchema = z.enum([
  'legacy.task_dependency.v1',
  'legacy.task_artifact.v1',
  'legacy.task_attempt.v1',
  'legacy.task_event.v1',
  'legacy.task_decision.v1',
  'legacy.task_evaluation.v1',
  'legacy.plan_document.v1',
  'legacy.plan_approval.v1',
  'legacy.prompt_assembly.v1',
  'legacy.delivery_intent.v1',
  'legacy.generation_metadata.v1',
  'legacy.unmigrated_payload.v1',
]);
export const ImportedHistoryRecordOwnerSchema = z.union([
  strictObject({ kind: z.literal('project') }),
  strictObject({ kind: z.literal('chat'), chatId: EntityIdSchema }),
  strictObject({ kind: z.literal('imported_run'), runId: EntityIdSchema }),
  strictObject({ kind: z.literal('imported_task_list'), taskListId: EntityIdSchema }),
  strictObject({ kind: z.literal('imported_task_item'), taskItemId: EntityIdSchema }),
  strictObject({ kind: z.literal('production'), productionObjectId: EntityIdSchema }),
  strictObject({ kind: z.literal('project_media_ref'), projectMediaRefId: EntityIdSchema }),
]);
export const ImportedHistoryRecordSchema = strictObject({
  authority: z.literal('imported_history_record'),
  historical: z.literal(true),
  readOnly: z.literal(true),
  id: EntityIdSchema,
  batchId: EntityIdSchema,
  projectId: EntityIdSchema,
  schemaId: ImportedHistoryRecordSchemaIdSchema,
  sourceRecordId: EntityIdSchema,
  owner: ImportedHistoryRecordOwnerSchema,
  parentRecordId: EntityIdSchema.nullable(),
  sequence: LegacySequenceSchema.nullable(),
  occurredAt: IsoTimestampSchema.nullable(),
  publicPayload: JsonValueSchema,
  publicPayloadHash: Sha256Schema,
  privateEvidence: ImportedPrivateEvidenceSchema,
  createdAt: IsoTimestampSchema,
}).superRefine((record, context) => {
  if (record.parentRecordId === record.id) {
    context.addIssue({
      code: 'custom',
      path: ['parentRecordId'],
      message: 'Imported History Record cannot name itself as parent',
    });
  }
});

export const ImportedHistoryWriteBundleSchema = strictObject({
  batch: ImportedHistoryBatchSchema,
  runs: z.array(ImportedRunHistorySchema).max(100_000),
  runEvents: z.array(ImportedRunEventHistorySchema).max(1_000_000),
  runScopes: z.array(ImportedRunScopeHistorySchema).max(1_000_000),
  runAttachments: z.array(ImportedRunAttachmentHistorySchema).max(1_000_000),
  taskLists: z.array(ImportedTaskListHistorySchema).max(100_000),
  taskItems: z.array(ImportedTaskItemHistorySchema).max(1_000_000),
  records: z.array(ImportedHistoryRecordSchema).max(1_000_000),
  productionCollections: z.array(ProductionCollectionSchema).max(100_000),
  productionCollectionMembers: z.array(ProductionCollectionMemberSchema).max(1_000_000),
}).superRefine((bundle, context) => {
  const batchId = bundle.batch.id;
  const allRecords = [
    ...bundle.runs,
    ...bundle.runEvents,
    ...bundle.runScopes,
    ...bundle.runAttachments,
    ...bundle.taskLists,
    ...bundle.taskItems,
    ...bundle.records,
  ];
  for (const [index, record] of allRecords.entries()) {
    if (record.batchId !== batchId) {
      context.addIssue({
        code: 'custom',
        path: ['batchId'],
        message: `Imported record ${index} must belong to the bundle batch`,
      });
    }
  }
  for (const [index, collection] of bundle.productionCollections.entries()) {
    if (collection.importBatchId !== batchId) {
      context.addIssue({
        code: 'custom',
        path: ['productionCollections', index, 'importBatchId'],
        message: 'Production Collection must belong to the bundle batch',
      });
    }
  }
  for (const [index, member] of bundle.productionCollectionMembers.entries()) {
    if (member.importBatchId !== batchId) {
      context.addIssue({
        code: 'custom',
        path: ['productionCollectionMembers', index, 'importBatchId'],
        message: 'Production Collection member must belong to the bundle batch',
      });
    }
  }
});

export const ImportedHistoryEntrySourceSchema = z.enum([
  'imported_run',
  'imported_run_event',
  'imported_task_list',
  'imported_task_item',
  'imported_record',
  'production_collection',
]);
export const ImportedHistoryQueryInputSchema = strictObject({
  sources: z.array(ImportedHistoryEntrySourceSchema).max(6),
  batchIds: z.array(EntityIdSchema).max(200),
  runIds: z.array(EntityIdSchema).max(200),
  taskListIds: z.array(EntityIdSchema).max(200),
  limit: z.number().int().min(1).max(1_000).finite(),
});
export const ImportedHistoryEntryViewSchema = strictObject({
  historical: z.literal(true),
  readOnly: z.literal(true),
  source: ImportedHistoryEntrySourceSchema,
  entryId: EntityIdSchema,
  batchId: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema.nullable(),
  taskListId: EntityIdSchema.nullable(),
  schemaId: ImportedHistoryRecordSchemaIdSchema.nullable(),
  collectionId: EntityIdSchema.nullable(),
  occurredAt: IsoTimestampSchema,
  evidenceUnavailable: z.boolean(),
  summary: z.string().min(1).max(20_000),
});
export const ImportedHistoryQuerySuccessSchema = strictObject({
  projectId: EntityIdSchema,
  items: z.array(ImportedHistoryEntryViewSchema).max(1_000),
});

export type ImportedHistoryBatch = z.infer<typeof ImportedHistoryBatchSchema>;
export type ImportedPrivateEvidence = z.infer<typeof ImportedPrivateEvidenceSchema>;
export type ImportedRunHistory = z.infer<typeof ImportedRunHistorySchema>;
export type ImportedRunEventHistory = z.infer<typeof ImportedRunEventHistorySchema>;
export type ImportedRunScopeHistory = z.infer<typeof ImportedRunScopeHistorySchema>;
export type ImportedRunAttachmentHistory = z.infer<typeof ImportedRunAttachmentHistorySchema>;
export type ImportedTaskListHistory = z.infer<typeof ImportedTaskListHistorySchema>;
export type ImportedTaskItemHistory = z.infer<typeof ImportedTaskItemHistorySchema>;
export type ImportedHistoryRecordOwner = z.infer<typeof ImportedHistoryRecordOwnerSchema>;
export type ImportedHistoryRecord = z.infer<typeof ImportedHistoryRecordSchema>;
export type ImportedHistoryWriteBundle = z.infer<typeof ImportedHistoryWriteBundleSchema>;
export type ImportedHistoryQueryInput = z.infer<typeof ImportedHistoryQueryInputSchema>;
export type ImportedHistoryEntryView = z.infer<typeof ImportedHistoryEntryViewSchema>;
export type ImportedHistoryQuerySuccess = z.infer<typeof ImportedHistoryQuerySuccessSchema>;
