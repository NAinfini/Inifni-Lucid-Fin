import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import {
  importedRunEventHashInput,
  type ImportedHistoryWriteBundle,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import { registerTargetStoreDatabase, unregisterTargetStoreDatabase } from './database-access.js';
import { hashCanonical } from './hashes.js';
import { writeImportedHistoryBundleInTransaction } from './imported-history-records.js';
import { createImportedHistoryReadModel } from '../read-models/imported-history.js';
import type { TargetStore } from '../kernel/store.js';

const NOW = '2026-08-25T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const ddlUrl = new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec(await readFile(ddlUrl, 'utf8'));
  database
    .prepare(
      `INSERT INTO projects (
       id, name, lifecycle, schema_revision, revision, content_hash, created_by_kind, created_by_id,
       created_at, updated_at, archived_at, deleted_at
     ) VALUES ('project.1', 'Project', 'active', 1, 0, ?, 'import', 'import.batch.1', ?, ?, NULL, NULL)`,
    )
    .run(HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO chats (
       id, project_id, revision, content_hash, title, lifecycle, message_count,
       message_head_sequence, created_at, updated_at, archived_at, deleted_at
     ) VALUES ('chat.1', 'project.1', 0, ?, 'Chat', 'active', 0, NULL, ?, ?, NULL, NULL)`,
    )
    .run(HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO media_blobs (
       hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
     ) VALUES (?, 1, 'image/png', 'image', '{}', ?)`,
    )
    .run(HASH_A, NOW);
  database
    .prepare(
      `INSERT INTO global_media_assets (
       id, revision, content_hash, blob_hash, media_kind, filename, display_name, source_v1_json,
       folder_id, tags_v1_json, created_at, updated_at
     ) VALUES ('asset.1', 0, ?, ?, 'image', 'frame.png', 'Frame', '{}', NULL, '[]', ?, ?)`,
    )
    .run(HASH_B, HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO project_media_refs (
       id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at, label,
       collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id, created_at, updated_at
     ) VALUES ('project-media.1', 'project.1', 'asset.1', 0, ?, 'active', NULL, 'Frame', '[]',
       '["reference"]', '', 'import', 'import.batch.1', ?, ?)`,
    )
    .run(HASH_C, NOW, NOW);
  database
    .prepare(
      `INSERT INTO production_objects (
       id, project_id, object_type, revision, content_hash, lifecycle, content_v1_json,
       created_by_kind, created_by_id, updated_by_kind, updated_by_id, created_at, updated_at
     ) VALUES ('production.1', 'project.1', 'character', 0, ?, 'active', '{}', 'import',
       'import.batch.1', 'import', 'import.batch.1', ?, ?)`,
    )
    .run(HASH_B, NOW, NOW);
  return database;
}

function bundle(): ImportedHistoryWriteBundle {
  const runPayload = { legacy: 'run' };
  const eventPayload = { sentinel: 'must-not-reach-history-ui' };
  const taskListPayload = { legacy: 'task-list' };
  const taskItemPayload = { legacy: 'task-item' };
  const recordPayload = { legacy: 'record' };
  const event = {
    authority: 'imported_run_event_history',
    historical: true,
    readOnly: true,
    id: 'imported-run-event.1',
    batchId: 'import.batch.1',
    runId: 'imported-run.1',
    sequence: 0,
    kind: 'run_start',
    step: 0,
    occurredAt: NOW,
    publicPayload: eventPayload,
    publicPayloadHash: hashCanonical(eventPayload),
    privateEvidence: {
      state: 'unavailable',
      payloadHash: HASH_A,
      offlineEvidenceId: 'offline-evidence.1',
    },
    previousEventHash: null,
  } as const;
  return {
    batch: {
      authority: 'imported_history_batch',
      id: 'import.batch.1',
      sourceSchemaId: 'legacy-main/v1',
      sourceSnapshotHash: HASH_A,
      classificationHash: HASH_A,
      planHash: HASH_A,
      offlineEvidenceManifestHash: HASH_B,
      reconciliationHash: HASH_C,
      createdAt: NOW,
    },
    runs: [
      {
        authority: 'imported_run_history',
        historical: true,
        readOnly: true,
        id: 'imported-run.1',
        batchId: 'import.batch.1',
        legacyRunId: 'legacy-run.1',
        projectId: 'project.1',
        chatId: 'chat.1',
        legacySessionId: 'legacy-session.1',
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
        lastSequence: 0,
        sourcePayload: runPayload,
        sourcePayloadHash: hashCanonical(runPayload),
        createdAt: NOW,
      },
    ],
    runEvents: [
      {
        ...event,
        eventHash: hashCanonical(importedRunEventHashInput(event)),
      },
    ],
    runScopes: [],
    runAttachments: [
      {
        authority: 'imported_run_attachment_history',
        historical: true,
        readOnly: true,
        batchId: 'import.batch.1',
        runId: 'imported-run.1',
        ordinal: 0,
        projectMediaRefId: 'project-media.1',
        globalAssetId: 'asset.1',
        blobHash: HASH_A,
        role: 'reference',
        sourcePayloadHash: HASH_A,
        createdAt: NOW,
      },
    ],
    taskLists: [
      {
        authority: 'imported_task_list_history',
        historical: true,
        readOnly: true,
        id: 'imported-task-list.1',
        batchId: 'import.batch.1',
        legacyTaskListId: 'legacy-task-list.1',
        projectId: 'project.1',
        chatId: 'chat.1',
        importedRunId: 'imported-run.1',
        taskListType: 'generation',
        triggerSource: 'manual',
        status: 'completed',
        summary: 'Finished',
        sourcePayload: taskListPayload,
        sourcePayloadHash: hashCanonical(taskListPayload),
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: NOW,
      },
    ],
    taskItems: [
      {
        authority: 'imported_task_item_history',
        historical: true,
        readOnly: true,
        id: 'imported-task-item.1',
        batchId: 'import.batch.1',
        projectId: 'project.1',
        taskListId: 'imported-task-list.1',
        legacyTaskId: 'legacy-task.1',
        parentItemId: null,
        phaseKey: 'generate',
        phaseName: 'Generate',
        phaseOrder: 0,
        taskKey: 'generate-frame',
        title: 'Generate frame',
        kind: 'adapter_generation',
        status: 'completed',
        sourcePayload: taskItemPayload,
        sourcePayloadHash: hashCanonical(taskItemPayload),
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    records: [
      {
        authority: 'imported_history_record',
        historical: true,
        readOnly: true,
        id: 'imported-record.1',
        batchId: 'import.batch.1',
        projectId: 'project.1',
        schemaId: 'legacy.task_attempt.v1',
        sourceRecordId: 'legacy-attempt.1',
        owner: { kind: 'imported_task_item', taskItemId: 'imported-task-item.1' },
        parentRecordId: null,
        sequence: null,
        occurredAt: NOW,
        publicPayload: recordPayload,
        publicPayloadHash: hashCanonical(recordPayload),
        privateEvidence: { state: 'none' },
        createdAt: NOW,
      },
    ],
    productionCollections: [
      {
        authority: 'production_collection',
        id: 'collection.1',
        projectId: 'project.1',
        revision: 0,
        contentHash: HASH_C,
        parentCollectionId: null,
        cloneOfCollectionId: null,
        sourceCollectionId: 'legacy-collection.1',
        importBatchId: 'import.batch.1',
        sourcePayloadHash: HASH_A,
        name: 'Characters',
        sortOrder: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    productionCollectionMembers: [
      {
        collectionId: 'collection.1',
        productionObjectId: 'production.1',
        ordinal: 0,
        importBatchId: 'import.batch.1',
        sourcePayloadHash: HASH_A,
        createdAt: NOW,
      },
    ],
  };
}

function registeredStore(): TargetStore {
  return {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {},
  };
}

describe('Imported history record writer', () => {
  it('writes immutable imported evidence and exposes only historical/read-only metadata', async () => {
    const database = await openDatabase();
    const store = registeredStore();
    try {
      database.exec('BEGIN');
      const receipt = writeImportedHistoryBundleInTransaction(database, bundle());
      database.exec('COMMIT');
      expect(receipt).toMatchObject({
        batchId: 'import.batch.1',
        runCount: 1,
        runEventCount: 1,
        taskListCount: 1,
        taskItemCount: 1,
        recordCount: 1,
        productionCollectionCount: 1,
      });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM imported_run_attachment_history').get(),
      ).toEqual({ count: 1 });

      registerTargetStoreDatabase(store, database);
      const result = createImportedHistoryReadModel(store).query('project.1', {
        sources: [],
        batchIds: [],
        runIds: [],
        taskListIds: [],
        limit: 100,
      });
      expect(result.items).toHaveLength(6);
      expect(result.items.every((item) => item.historical && item.readOnly)).toBe(true);
      expect(
        result.items.find((item) => item.source === 'imported_run_event')?.evidenceUnavailable,
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain('must-not-reach-history-ui');
      expect(JSON.stringify(result)).not.toContain('offline-evidence.1');
    } finally {
      unregisterTargetStoreDatabase(store);
      database.close();
    }
  });

  it('rejects a non-contiguous legacy event chain before inserting a batch', async () => {
    const database = await openDatabase();
    try {
      const invalid = bundle();
      invalid.runs[0]!.lastSequence = 1;
      invalid.runEvents[0]!.sequence = 1;
      database.exec('BEGIN');
      expect(() => writeImportedHistoryBundleInTransaction(database, invalid)).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
      database.exec('ROLLBACK');
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM imported_history_batches').get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('rejects an event hash that is not the canonical imported-event envelope', async () => {
    const database = await openDatabase();
    try {
      const invalid = bundle();
      invalid.runEvents[0]!.eventHash = HASH_A;
      database.exec('BEGIN');
      expect(() => writeImportedHistoryBundleInTransaction(database, invalid)).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
      database.exec('ROLLBACK');
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM imported_history_batches').get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('rejects a record lineage that crosses Projects before inserting a batch', async () => {
    const database = await openDatabase();
    try {
      const invalid = bundle();
      const parent = {
        ...invalid.records[0]!,
        id: 'imported-record.other-project',
        projectId: 'project.other',
        sourceRecordId: 'legacy-attempt.other-project',
        owner: { kind: 'project' as const },
      };
      invalid.records[0]!.parentRecordId = parent.id;
      invalid.records.push(parent);
      database.exec('BEGIN');
      expect(() => writeImportedHistoryBundleInTransaction(database, invalid)).toThrow(
        expect.objectContaining({ code: 'INVALID_REQUEST' }),
      );
      database.exec('ROLLBACK');
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM imported_history_batches').get(),
      ).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });
});
