import {
  ImportedHistoryWriteBundleSchema,
  canonicalJson,
  importedRunEventHashInput,
  parseCanonical,
  type ImportedHistoryRecordOwner,
  type ImportedHistoryWriteBundle,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { hashCanonical } from './hashes.js';

export interface ImportedHistoryWriteReceipt {
  readonly batchId: string;
  readonly runCount: number;
  readonly runEventCount: number;
  readonly taskListCount: number;
  readonly taskItemCount: number;
  readonly recordCount: number;
  readonly productionCollectionCount: number;
}

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function requireTransaction(database: DatabaseSync): void {
  if (!database.isTransaction) {
    throw invalid('Imported history writes require a transaction');
  }
}

function assertHash(label: string, value: unknown, expected: string): void {
  if (hashCanonical(value) !== expected) {
    throw invalid(`${label} hash does not match canonical payload`);
  }
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) throw invalid(`${label} contains duplicate identity: ${identity}`);
    seen.add(identity);
  }
}

function assertNoCycle(
  startId: string,
  parentOf: (id: string) => string | null,
  label: string,
): void {
  const seen = new Set<string>();
  let current: string | null = startId;
  while (current !== null) {
    if (seen.has(current)) throw invalid(`${label} cannot cycle`);
    seen.add(current);
    current = parentOf(current);
  }
}

function assertBundleIntegrity(bundle: ImportedHistoryWriteBundle): void {
  assertUnique(bundle.runs, (run) => run.id, 'Imported Runs');
  assertUnique(bundle.runEvents, (event) => event.id, 'Imported Run events');
  assertUnique(
    bundle.runEvents,
    (event) => `${event.runId}\0${event.sequence}`,
    'Imported Run sequences',
  );
  assertUnique(
    bundle.runScopes,
    (scope) => `${scope.runId}\0${scope.ordinal}`,
    'Imported Run scopes',
  );
  assertUnique(
    bundle.runAttachments,
    (attachment) => `${attachment.runId}\0${attachment.ordinal}`,
    'Imported Run attachments',
  );
  assertUnique(bundle.taskLists, (list) => list.id, 'Imported Task Lists');
  assertUnique(bundle.taskItems, (item) => item.id, 'Imported Task Items');
  assertUnique(bundle.records, (record) => record.id, 'Imported History Records');
  assertUnique(
    bundle.productionCollections,
    (collection) => collection.id,
    'Production Collections',
  );
  assertUnique(
    bundle.productionCollectionMembers,
    (member) => `${member.collectionId}\0${member.productionObjectId}`,
    'Production Collection members',
  );

  const runs = new Map(bundle.runs.map((run) => [run.id, run]));
  for (const run of bundle.runs) {
    for (const [kind, relatedId] of [
      ['root', run.rootRunId],
      ['parent', run.parentRunId],
      ['retry', run.retryOfRunId],
    ] as const) {
      if (relatedId === null) continue;
      const related = runs.get(relatedId);
      if (related === undefined) throw invalid(`Imported Run ${run.id} ${kind} is not in bundle`);
      if (related.batchId !== run.batchId || related.projectId !== run.projectId) {
        throw invalid(`Imported Run ${run.id} ${kind} crosses batch or Project`);
      }
    }
    assertNoCycle(run.id, (id) => runs.get(id)?.parentRunId ?? null, 'Imported Run parent lineage');
    assertNoCycle(run.id, (id) => runs.get(id)?.retryOfRunId ?? null, 'Imported Run retry lineage');
    let lineage = run;
    while (lineage.parentRunId !== null) {
      lineage = runs.get(lineage.parentRunId)!;
    }
    if (lineage.id !== run.rootRunId) {
      throw invalid(`Imported Run ${run.id} root lineage does not reach rootRunId`);
    }
    assertHash(`Imported Run ${run.id} source payload`, run.sourcePayload, run.sourcePayloadHash);
  }

  const eventsByRun = new Map<string, typeof bundle.runEvents>();
  for (const event of bundle.runEvents) {
    if (!runs.has(event.runId)) throw invalid(`Imported Run event ${event.id} has no bundled Run`);
    assertHash(
      `Imported Run event ${event.id} public payload`,
      event.publicPayload,
      event.publicPayloadHash,
    );
    assertHash(
      `Imported Run event ${event.id} envelope`,
      importedRunEventHashInput(event),
      event.eventHash,
    );
    const events = eventsByRun.get(event.runId) ?? [];
    events.push(event);
    eventsByRun.set(event.runId, events);
  }
  for (const run of bundle.runs) {
    const events = [...(eventsByRun.get(run.id) ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
    if (events.length === 0) {
      if (run.lastSequence !== null) {
        throw invalid(`Imported Run ${run.id} last sequence requires an event chain`);
      }
      continue;
    }
    if (run.lastSequence !== events.at(-1)!.sequence) {
      throw invalid(`Imported Run ${run.id} last sequence does not match event chain`);
    }
    let previousHash: string | null = null;
    for (const [index, event] of events.entries()) {
      if (event.sequence !== index || event.previousEventHash !== previousHash) {
        throw invalid(`Imported Run ${run.id} event chain is not contiguous`);
      }
      previousHash = event.eventHash;
    }
  }
  for (const scope of bundle.runScopes) {
    if (!runs.has(scope.runId))
      throw invalid(`Imported Run scope has no bundled Run: ${scope.runId}`);
    assertHash(
      `Imported Run scope ${scope.runId}:${scope.ordinal}`,
      scope.payload,
      scope.payloadHash,
    );
  }
  for (const attachment of bundle.runAttachments) {
    if (!runs.has(attachment.runId)) {
      throw invalid(`Imported Run attachment has no bundled Run: ${attachment.runId}`);
    }
  }

  const taskLists = new Map(bundle.taskLists.map((list) => [list.id, list]));
  for (const list of bundle.taskLists) {
    assertHash(
      `Imported Task List ${list.id} source payload`,
      list.sourcePayload,
      list.sourcePayloadHash,
    );
    if (list.importedRunId === null) continue;
    const run = runs.get(list.importedRunId);
    if (run === undefined || run.projectId !== list.projectId || run.batchId !== list.batchId) {
      throw invalid(`Imported Task List ${list.id} Run owner crosses batch or Project`);
    }
  }
  const taskItems = new Map(bundle.taskItems.map((item) => [item.id, item]));
  for (const item of bundle.taskItems) {
    const taskList = taskLists.get(item.taskListId);
    if (
      taskList === undefined ||
      taskList.projectId !== item.projectId ||
      taskList.batchId !== item.batchId
    ) {
      throw invalid(`Imported Task Item ${item.id} has no matching bundled Task List`);
    }
    if (item.parentItemId !== null) {
      const parent = taskItems.get(item.parentItemId);
      if (parent === undefined || parent.taskListId !== item.taskListId) {
        throw invalid(`Imported Task Item ${item.id} parent is not in its Task List`);
      }
    }
    assertNoCycle(
      item.id,
      (id) => taskItems.get(id)?.parentItemId ?? null,
      'Imported Task Item lineage',
    );
    assertHash(
      `Imported Task Item ${item.id} source payload`,
      item.sourcePayload,
      item.sourcePayloadHash,
    );
  }

  const records = new Map(bundle.records.map((record) => [record.id, record]));
  for (const record of bundle.records) {
    if (record.parentRecordId !== null) {
      const parent = records.get(record.parentRecordId);
      if (parent === undefined) {
        throw invalid(`Imported History Record ${record.id} parent is not in bundle`);
      }
      if (parent.batchId !== record.batchId || parent.projectId !== record.projectId) {
        throw invalid(`Imported History Record ${record.id} parent crosses batch or Project`);
      }
    }
    assertNoCycle(
      record.id,
      (id) => records.get(id)?.parentRecordId ?? null,
      'Imported History Record lineage',
    );
    assertHash(
      `Imported History Record ${record.id} public payload`,
      record.publicPayload,
      record.publicPayloadHash,
    );
  }

  const collections = new Map(
    bundle.productionCollections.map((collection) => [collection.id, collection]),
  );
  for (const collection of bundle.productionCollections) {
    if (collection.parentCollectionId !== null) {
      const parent = collections.get(collection.parentCollectionId);
      if (parent === undefined || parent.projectId !== collection.projectId) {
        throw invalid(`Production Collection ${collection.id} parent is not in its Project bundle`);
      }
    }
    assertNoCycle(
      collection.id,
      (id) => collections.get(id)?.parentCollectionId ?? null,
      'Production Collection hierarchy',
    );
  }
  for (const member of bundle.productionCollectionMembers) {
    const collection = collections.get(member.collectionId);
    if (collection === undefined) {
      throw invalid(
        `Production Collection member has no bundled Collection: ${member.collectionId}`,
      );
    }
    if (collection.importBatchId !== member.importBatchId) {
      throw invalid(`Production Collection member ${member.collectionId} crosses import batch`);
    }
  }
}

function ownerColumns(owner: ImportedHistoryRecordOwner, projectId: string) {
  switch (owner.kind) {
    case 'project':
      return [projectId, null, null, null, null, null, null] as const;
    case 'chat':
      return [null, owner.chatId, null, null, null, null, null] as const;
    case 'imported_run':
      return [null, null, owner.runId, null, null, null, null] as const;
    case 'imported_task_list':
      return [null, null, null, owner.taskListId, null, null, null] as const;
    case 'imported_task_item':
      return [null, null, null, null, owner.taskItemId, null, null] as const;
    case 'production':
      return [null, null, null, null, null, owner.productionObjectId, null] as const;
    case 'project_media_ref':
      return [null, null, null, null, null, null, owner.projectMediaRefId] as const;
  }
}

export function writeImportedHistoryBundleInTransaction(
  database: DatabaseSync,
  inputValue: ImportedHistoryWriteBundle,
): ImportedHistoryWriteReceipt {
  requireTransaction(database);
  let bundle: ImportedHistoryWriteBundle;
  try {
    bundle = parseCanonical(ImportedHistoryWriteBundleSchema, inputValue);
  } catch (cause) {
    throw invalid('Imported history bundle is invalid', cause);
  }
  assertBundleIntegrity(bundle);

  const { batch } = bundle;
  database
    .prepare(
      `INSERT INTO imported_history_batches (
         id, source_schema_id, source_snapshot_hash, classification_hash, plan_hash,
         offline_evidence_manifest_hash, reconciliation_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      batch.id,
      batch.sourceSchemaId,
      batch.sourceSnapshotHash,
      batch.classificationHash,
      batch.planHash,
      batch.offlineEvidenceManifestHash,
      batch.reconciliationHash,
      batch.createdAt,
    );

  const writeRun = database.prepare(
    `INSERT INTO imported_run_history (
       id, batch_id, legacy_run_id, project_id, chat_id, legacy_session_id, root_run_id,
       parent_run_id, retry_of_run_id, work_type, display_name, intent, objective, status,
       accepted_at, started_at, finished_at, last_sequence, source_payload_v1_json, source_payload_hash,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const run of bundle.runs) {
    writeRun.run(
      run.id,
      run.batchId,
      run.legacyRunId,
      run.projectId,
      run.chatId,
      run.legacySessionId,
      run.rootRunId,
      run.parentRunId,
      run.retryOfRunId,
      run.workType,
      run.displayName,
      run.intent,
      run.objective,
      run.status,
      run.acceptedAt,
      run.startedAt,
      run.finishedAt,
      run.lastSequence,
      canonicalJson(run.sourcePayload),
      run.sourcePayloadHash,
      run.createdAt,
    );
  }

  const writeRunEvent = database.prepare(
    `INSERT INTO imported_run_event_history (
       id, batch_id, run_id, sequence, event_kind, step, occurred_at, public_payload_v1_json,
       public_payload_hash, private_payload_present, private_payload_hash, offline_evidence_id,
       previous_event_hash, event_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of bundle.runEvents) {
    const privateEvidence = event.privateEvidence;
    writeRunEvent.run(
      event.id,
      event.batchId,
      event.runId,
      event.sequence,
      event.kind,
      event.step,
      event.occurredAt,
      canonicalJson(event.publicPayload),
      event.publicPayloadHash,
      privateEvidence.state === 'unavailable' ? 1 : 0,
      privateEvidence.state === 'unavailable' ? privateEvidence.payloadHash : null,
      privateEvidence.state === 'unavailable' ? privateEvidence.offlineEvidenceId : null,
      event.previousEventHash,
      event.eventHash,
    );
  }

  const writeScope = database.prepare(
    `INSERT INTO imported_run_scope_history (
       batch_id, run_id, ordinal, scope_kind, payload_v1_json, payload_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const scope of bundle.runScopes) {
    writeScope.run(
      scope.batchId,
      scope.runId,
      scope.ordinal,
      scope.kind,
      canonicalJson(scope.payload),
      scope.payloadHash,
      scope.createdAt,
    );
  }

  const writeAttachment = database.prepare(
    `INSERT INTO imported_run_attachment_history (
       batch_id, run_id, ordinal, project_media_ref_id, global_asset_id, blob_hash, role,
       source_payload_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const attachment of bundle.runAttachments) {
    writeAttachment.run(
      attachment.batchId,
      attachment.runId,
      attachment.ordinal,
      attachment.projectMediaRefId,
      attachment.globalAssetId,
      attachment.blobHash,
      attachment.role,
      attachment.sourcePayloadHash,
      attachment.createdAt,
    );
  }

  const writeTaskList = database.prepare(
    `INSERT INTO imported_task_list_history (
       id, batch_id, legacy_task_list_id, project_id, chat_id, imported_run_id, task_list_type,
       trigger_source, status, summary, source_payload_v1_json, source_payload_hash, created_at,
       updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const list of bundle.taskLists) {
    writeTaskList.run(
      list.id,
      list.batchId,
      list.legacyTaskListId,
      list.projectId,
      list.chatId,
      list.importedRunId,
      list.taskListType,
      list.triggerSource,
      list.status,
      list.summary,
      canonicalJson(list.sourcePayload),
      list.sourcePayloadHash,
      list.createdAt,
      list.updatedAt,
      list.completedAt,
    );
  }

  const writeTaskItem = database.prepare(
    `INSERT INTO imported_task_item_history (
       id, batch_id, project_id, task_list_id, legacy_task_id, parent_item_id, phase_key,
       phase_name, phase_order, task_key, title, task_kind, status, source_payload_v1_json,
       source_payload_hash, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of bundle.taskItems) {
    writeTaskItem.run(
      item.id,
      item.batchId,
      item.projectId,
      item.taskListId,
      item.legacyTaskId,
      item.parentItemId,
      item.phaseKey,
      item.phaseName,
      item.phaseOrder,
      item.taskKey,
      item.title,
      item.kind,
      item.status,
      canonicalJson(item.sourcePayload),
      item.sourcePayloadHash,
      item.createdAt,
      item.updatedAt,
    );
  }

  const writeRecord = database.prepare(
    `INSERT INTO imported_history_records (
       id, batch_id, project_id, schema_id, source_record_id, owner_kind, owner_project_id,
       owner_chat_id, owner_imported_run_id, owner_imported_task_list_id,
       owner_imported_task_item_id, owner_production_object_id, owner_project_media_ref_id,
       parent_record_id, sequence, occurred_at, public_payload_v1_json, public_payload_hash,
       private_payload_present, private_payload_hash, offline_evidence_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const record of bundle.records) {
    const owner = ownerColumns(record.owner, record.projectId);
    const privateEvidence = record.privateEvidence;
    writeRecord.run(
      record.id,
      record.batchId,
      record.projectId,
      record.schemaId,
      record.sourceRecordId,
      record.owner.kind,
      ...owner,
      record.parentRecordId,
      record.sequence,
      record.occurredAt,
      canonicalJson(record.publicPayload),
      record.publicPayloadHash,
      privateEvidence.state === 'unavailable' ? 1 : 0,
      privateEvidence.state === 'unavailable' ? privateEvidence.payloadHash : null,
      privateEvidence.state === 'unavailable' ? privateEvidence.offlineEvidenceId : null,
      record.createdAt,
    );
  }

  const writeCollection = database.prepare(
    `INSERT INTO production_collections (
       id, project_id, revision, content_hash, parent_collection_id, clone_of_collection_id,
       source_collection_id, import_batch_id, source_payload_hash, name, sort_order, created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const collection of bundle.productionCollections) {
    writeCollection.run(
      collection.id,
      collection.projectId,
      collection.revision,
      collection.contentHash,
      collection.parentCollectionId,
      collection.cloneOfCollectionId,
      collection.sourceCollectionId,
      collection.importBatchId,
      collection.sourcePayloadHash,
      collection.name,
      collection.sortOrder,
      collection.createdAt,
      collection.updatedAt,
    );
  }

  const writeCollectionMember = database.prepare(
    `INSERT INTO production_collection_members (
       collection_id, production_object_id, ordinal, import_batch_id, source_payload_hash, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const member of bundle.productionCollectionMembers) {
    writeCollectionMember.run(
      member.collectionId,
      member.productionObjectId,
      member.ordinal,
      member.importBatchId,
      member.sourcePayloadHash,
      member.createdAt,
    );
  }

  return Object.freeze({
    batchId: batch.id,
    runCount: bundle.runs.length,
    runEventCount: bundle.runEvents.length,
    taskListCount: bundle.taskLists.length,
    taskItemCount: bundle.taskItems.length,
    recordCount: bundle.records.length,
    productionCollectionCount: bundle.productionCollections.length,
  });
}
