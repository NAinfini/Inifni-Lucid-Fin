import { describe, expect, it } from 'vitest';
import {
  ImportedHistoryRecordSchema,
  ImportedHistoryWriteBundleSchema,
  ImportedRunHistorySchema,
  ProductionCollectionSchema,
} from './index.js';

const NOW = '2026-08-25T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const batch = {
  authority: 'imported_history_batch',
  id: 'import.batch.1',
  sourceSchemaId: 'legacy-main/v1',
  sourceSnapshotHash: HASH_A,
  classificationHash: HASH_A,
  planHash: HASH_A,
  offlineEvidenceManifestHash: null,
  reconciliationHash: HASH_A,
  createdAt: NOW,
} as const;

const run = {
  authority: 'imported_run_history',
  historical: true,
  readOnly: true,
  id: 'imported-run.1',
  batchId: batch.id,
  legacyRunId: 'legacy-run.1',
  projectId: 'project.1',
  chatId: null,
  legacySessionId: null,
  rootRunId: 'imported-run.1',
  parentRunId: null,
  retryOfRunId: null,
  workType: 'agent',
  displayName: null,
  intent: 'Create the sequence.',
  objective: null,
  status: 'completed',
  acceptedAt: NOW,
  startedAt: NOW,
  finishedAt: NOW,
  lastSequence: null,
  sourcePayload: {},
  sourcePayloadHash: HASH_A,
  createdAt: NOW,
} as const;

describe('Imported history contracts', () => {
  it('requires explicit historical/read-only lineage without accepting a fake live Run', () => {
    expect(ImportedRunHistorySchema.parse(run)).toEqual(run);
    expect(ImportedRunHistorySchema.safeParse({ ...run, historical: false }).success).toBe(false);
    expect(
      ImportedRunHistorySchema.safeParse({ ...run, rootRunId: 'other-run.1', parentRunId: null })
        .success,
    ).toBe(false);
    expect(ImportedRunHistorySchema.safeParse({ ...run, providerId: 'legacy' }).success).toBe(
      false,
    );
  });

  it('uses fixed record schema IDs and a single typed owner', () => {
    const record = {
      authority: 'imported_history_record',
      historical: true,
      readOnly: true,
      id: 'imported-record.1',
      batchId: batch.id,
      projectId: 'project.1',
      schemaId: 'legacy.task_attempt.v1',
      sourceRecordId: 'legacy-attempt.1',
      owner: { kind: 'imported_run', runId: run.id },
      parentRecordId: null,
      sequence: 0,
      occurredAt: NOW,
      publicPayload: { state: 'completed' },
      publicPayloadHash: HASH_A,
      privateEvidence: {
        state: 'unavailable',
        payloadHash: HASH_B,
        offlineEvidenceId: 'offline.1',
      },
      createdAt: NOW,
    } as const;
    expect(ImportedHistoryRecordSchema.parse(record)).toEqual(record);
    expect(
      ImportedHistoryRecordSchema.safeParse({
        ...record,
        owner: { kind: 'imported_run', runId: run.id, taskListId: 'task-list.1' },
      }).success,
    ).toBe(false);
    expect(
      ImportedHistoryRecordSchema.safeParse({ ...record, schemaId: 'legacy.unknown.v1' }).success,
    ).toBe(false);
  });

  it('keeps production collection hierarchy and clone evidence explicit', () => {
    const collection = {
      authority: 'production_collection',
      id: 'collection.1',
      projectId: 'project.1',
      revision: 0,
      contentHash: HASH_A,
      parentCollectionId: null,
      cloneOfCollectionId: null,
      sourceCollectionId: 'legacy-collection.1',
      importBatchId: batch.id,
      sourcePayloadHash: HASH_B,
      name: 'Characters',
      sortOrder: 0,
      createdAt: NOW,
      updatedAt: NOW,
    } as const;
    expect(ProductionCollectionSchema.parse(collection)).toEqual(collection);
    expect(
      ProductionCollectionSchema.safeParse({ ...collection, parentCollectionId: collection.id })
        .success,
    ).toBe(false);
    expect(
      ProductionCollectionSchema.safeParse({ ...collection, cloneOfCollectionId: collection.id })
        .success,
    ).toBe(false);
  });

  it('requires every bundled record to name the content-addressed batch', () => {
    expect(
      ImportedHistoryWriteBundleSchema.safeParse({
        batch,
        runs: [{ ...run, batchId: 'import.batch.other' }],
        runEvents: [],
        runScopes: [],
        runAttachments: [],
        taskLists: [],
        taskItems: [],
        records: [],
        productionCollections: [],
        productionCollectionMembers: [],
      }).success,
    ).toBe(false);
  });
});
