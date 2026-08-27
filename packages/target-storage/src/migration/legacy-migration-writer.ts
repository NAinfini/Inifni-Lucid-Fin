import { canonicalJson, type ProjectMediaRef } from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  encodeProjectFormatPolicy,
  encodeProjectMediaCollections,
  encodeProjectMediaRoles,
  encodeProductionContent,
  encodeResourceBudget,
} from '../internal/canonical-codecs.js';
import { causationColumns } from '../internal/causation.js';
import { appendMessageInTransaction } from '../internal/conversation-write.js';
import { hashCanonical } from '../internal/hashes.js';
import { writeImportedHistoryBundleInTransaction } from '../internal/imported-history-records.js';
import {
  insertGlobalMediaAsset,
  insertGlobalMediaFolder,
  insertOrValidateMediaBlob,
  loadProjectMediaRecord,
} from '../internal/media-records.js';
import { insertCanvas } from '../internal/canvas-records.js';
import { registerGlobalSkillInTransaction } from '../internal/skill-registration.js';
import { loadCanonicalSchemaArtifacts } from '../kernel/artifacts.js';
import { openConfiguredDatabase } from '../kernel/database.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import type { LegacyMigrationMaterialization } from './legacy-migration-materialization.js';
import {
  legacyImportedRunAttachmentTargetId,
  legacyImportedRunScopeTargetId,
} from './legacy-migration-policy.js';
import { assertLegacyMigrationPlan, type LegacyMigrationPlan } from './legacy-migration-plan.js';
import {
  validateLegacySkillMigrationPlan,
  type LegacySkillMigrationPlan,
} from './legacy-skill-migration.js';

export interface LegacyMigrationReconciliationExpectationInput {
  readonly plan: LegacyMigrationPlan;
  readonly skillPlan: LegacySkillMigrationPlan;
  readonly offlineEvidenceManifestHash: string | null;
  readonly browserStateFingerprint: string;
}

export interface LegacyMigrationReconciliationReport {
  readonly schema: 'lucid-fin.legacy-migration-reconciliation/v1';
  readonly expectationHash: string;
  readonly planFingerprint: string;
  readonly materializationFingerprint: string;
  readonly targetRefCount: number;
  readonly realizedTargetRefCount: number;
  readonly counts: Readonly<Record<string, number>>;
  readonly targetFingerprint: string;
  readonly foreignKeyViolationCount: 0;
  readonly fingerprint: string;
  readonly ok: true;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function contentAddressedId(prefix: string, value: unknown): string {
  return `${prefix}.${hashCanonical(value)}`;
}

export function legacyMigrationReconciliationExpectationHash(
  input: LegacyMigrationReconciliationExpectationInput,
): string {
  assertLegacyMigrationPlan(input.plan);
  const skillPlan = validateLegacySkillMigrationPlan(input.skillPlan);
  return hashCanonical({
    schema: 'lucid-fin.legacy-migration-reconciliation-expectation/v1',
    planFingerprint: input.plan.fingerprint,
    sourceContentFingerprint: input.plan.source.contentFingerprint,
    targetRefs: input.plan.targetRefs,
    skillPlanHash: skillPlan.planHash,
    offlineEvidenceManifestHash: input.offlineEvidenceManifestHash,
    browserStateFingerprint: input.browserStateFingerprint,
  });
}

function insertProjects(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
): void {
  const insertProject = database.prepare(
    `INSERT INTO projects (
       id, name, lifecycle, schema_revision, revision, content_hash, created_by_kind,
       created_by_id, created_at, updated_at, archived_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const project of materialization.projects) {
    const createdBy = causationColumns(project.createdBy);
    insertProject.run(
      project.id,
      project.name,
      project.lifecycle,
      project.schemaRevision,
      project.revision,
      project.contentHash,
      createdBy[0],
      createdBy[1],
      project.createdAt,
      project.updatedAt,
      project.archivedAt,
      project.deletedAt,
    );
  }
  const insertSettings = database.prepare(
    `INSERT INTO project_settings (
       project_id, revision, content_hash, default_provider_profile_id,
       format_policy_v1_json, permission_mode, budget_v1_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const settings of materialization.projectSettings) {
    if (settings.enabledSkills.length !== 0) {
      throw new TypeError('Imported Project settings must start with no enabled Skills');
    }
    insertSettings.run(
      settings.projectId,
      settings.revision,
      settings.contentHash,
      settings.defaultProviderProfileId,
      encodeProjectFormatPolicy(settings.formatPolicy),
      settings.permission,
      encodeResourceBudget(settings.budget),
      settings.updatedAt,
    );
  }
}

function insertProduction(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
): void {
  const insert = database.prepare(
    `INSERT INTO production_objects (
       id, project_id, object_type, revision, content_hash, lifecycle, content_v1_json,
       created_by_kind, created_by_id, updated_by_kind, updated_by_id, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const object of materialization.productionObjects) {
    if (object.relations.length !== 0 || object.protections.length !== 0) {
      throw new TypeError('Legacy Production import must materialize relations separately');
    }
    const createdBy = causationColumns(object.createdBy);
    const updatedBy = causationColumns(object.updatedBy);
    insert.run(
      object.id,
      object.projectId,
      object.type,
      object.revision,
      object.contentHash,
      object.lifecycle,
      encodeProductionContent(object.type, object.content),
      createdBy[0],
      createdBy[1],
      updatedBy[0],
      updatedBy[1],
      object.createdAt,
      object.updatedAt,
    );
  }
}

function insertProjectMediaRefRows(database: DatabaseSync, ref: ProjectMediaRef): void {
  const createdBy = causationColumns(ref.createdBy);
  database
    .prepare(
      `INSERT INTO project_media_refs (
         id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
         label, collections_v1_json, roles_v1_json, notes, created_by_kind, created_by_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref.id,
      ref.projectId,
      ref.globalAssetId,
      ref.revision,
      ref.contentHash,
      ref.lifecycle,
      ref.detachedAt,
      ref.label,
      encodeProjectMediaCollections(ref.collections),
      encodeProjectMediaRoles(ref.roles),
      ref.notes,
      createdBy[0],
      createdBy[1],
      ref.createdAt,
      ref.updatedAt,
    );
}

function insertProjectMedia(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
): void {
  for (const ref of materialization.projectMediaRefs) insertProjectMediaRefRows(database, ref);
  const insertLink = database.prepare(
    `INSERT INTO project_media_links (
       id, project_media_ref_id, production_object_id, relation, created_at
     ) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const ref of materialization.projectMediaRefs) {
    for (const link of ref.productionLinks) {
      insertLink.run(
        contentAddressedId('project.media-link.import', {
          projectMediaRefId: ref.id,
          productionObjectId: link.productionObjectId,
          relation: link.relation,
        }),
        ref.id,
        link.productionObjectId,
        link.relation,
        ref.createdAt,
      );
    }
    const persisted = loadProjectMediaRecord(database, ref.id);
    if (canonicalJson(persisted) !== canonicalJson(ref)) {
      throw new Error(`Imported Project Media reference ${ref.id} did not persist exactly`);
    }
  }
}

function insertChats(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
): void {
  const insert = database.prepare(
    `INSERT INTO chats (
       id, project_id, revision, content_hash, title, lifecycle, message_count,
       message_head_sequence, created_at, updated_at, archived_at, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const chat of materialization.chats) {
    insert.run(
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
  }
}

function insertMessages(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
): void {
  const batchId = materialization.importedHistory.batch.id;
  const environment = Object.freeze({
    now: () => materialization.importedHistory.batch.createdAt,
    createId: () => {
      throw new Error('Legacy Message import requires explicit deterministic identities');
    },
  });
  const context = {
    actor: 'import' as const,
    causation: { kind: 'import' as const, importId: batchId },
    correlationId: batchId,
  };
  const nextSequence = new Map<string, number>();
  for (const seed of materialization.messages) {
    const expectedSequence = (nextSequence.get(seed.chatId) ?? 0) + 1;
    if (seed.sequence !== expectedSequence) {
      throw new Error(`Imported Chat ${seed.chatId} Message sequence is not contiguous`);
    }
    const identitySeed = { batchId, chatId: seed.chatId, messageId: seed.messageId };
    const input =
      seed.role === 'user'
        ? {
            chatId: seed.chatId,
            role: 'user' as const,
            status: 'accepted' as const,
            originatingRunId: null,
            originatingImportedRunId: null,
            blocks: seed.blocks,
            attachments: seed.attachments,
            supersedesMessageId: null,
            idempotencyKey: contentAddressedId('message.import.idempotency', identitySeed),
          }
        : {
            chatId: seed.chatId,
            role: 'assistant' as const,
            status: seed.status,
            originatingRunId: null,
            originatingImportedRunId: seed.originatingImportedRunId!,
            blocks: seed.blocks,
            attachments: seed.attachments,
            supersedesMessageId: null,
            idempotencyKey: contentAddressedId('message.import.idempotency', identitySeed),
          };
    const result = appendMessageInTransaction(database, environment, context, input, {
      messageId: seed.messageId,
      eventId: contentAddressedId('project.event.message-import', identitySeed),
      searchDocumentId: contentAddressedId('project.search.message-import', identitySeed),
      createdAt: seed.createdAt,
    });
    if (result.message.id !== seed.messageId || result.message.sequence !== seed.sequence) {
      throw new Error(`Imported Message ${seed.messageId} persisted with a different identity`);
    }
    if ((seed.role === 'assistant') !== (result.eventId === null)) {
      throw new Error(`Imported Message ${seed.messageId} event isolation differs`);
    }
    nextSequence.set(seed.chatId, seed.sequence);
  }
}

/** Writes every database record under the caller's one active IMMEDIATE transaction. */
export function writeLegacyMigrationMaterializationInTransaction(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
): void {
  if (!database.isTransaction) {
    throw new TypeError('Legacy migration materialization requires one active transaction');
  }
  const { fingerprint, ...fingerprintInput } = materialization;
  if (hashCanonical(fingerprintInput) !== fingerprint) {
    throw new TypeError('Legacy migration materialization fingerprint does not match');
  }
  insertProjects(database, materialization);
  for (const blob of materialization.mediaBlobs) {
    insertOrValidateMediaBlob(
      database,
      {
        hash: blob.hash,
        byteLength: blob.byteLength,
        mimeType: blob.mimeType,
        technicalFacts: blob.technicalFacts,
      },
      blob.createdAt,
    );
  }
  for (const folder of materialization.globalMediaFolders)
    insertGlobalMediaFolder(database, folder);
  for (const asset of materialization.globalMediaAssets) insertGlobalMediaAsset(database, asset);
  insertProduction(database, materialization);
  insertProjectMedia(database, materialization);
  insertChats(database, materialization);
  for (const canvas of materialization.canvases) insertCanvas(database, canvas);
  writeImportedHistoryBundleInTransaction(database, materialization.importedHistory);
  insertMessages(database, materialization);
  for (const document of materialization.skillDocuments) {
    registerGlobalSkillInTransaction(
      database,
      { document, projectId: null },
      materialization.importedHistory.batch.createdAt,
    );
  }
}

function rows(database: DatabaseSync, sql: string): readonly Record<string, unknown>[] {
  return database.prepare(sql).all() as unknown as readonly Record<string, unknown>[];
}

type SnapshotValue =
  null | string | number | { readonly integer: string } | { readonly blob: string };

interface TargetDatabaseSnapshot {
  readonly schema: 'lucid-fin.target-database-snapshot/v1';
  readonly tables: readonly {
    readonly name: string;
    readonly rows: readonly Readonly<Record<string, SnapshotValue>>[];
  }[];
}

function snapshotValue(value: unknown): SnapshotValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return { integer: value.toString() };
  if (value instanceof Uint8Array) return { blob: Buffer.from(value).toString('base64') };
  throw new TypeError(`Target snapshot cannot encode SQLite ${typeof value}`);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseSnapshot(database: DatabaseSync): TargetDatabaseSnapshot {
  const tableNames = rows(
    database,
    `SELECT name FROM sqlite_schema
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`,
  ).map(({ name }) => {
    if (typeof name !== 'string') throw new Error('Target schema returned an invalid table name');
    return name;
  });
  return {
    schema: 'lucid-fin.target-database-snapshot/v1',
    tables: tableNames.map((name) => {
      const tableRows = rows(database, `SELECT * FROM ${quoteIdentifier(name)}`)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row)
              .sort(([left], [right]) => compareText(left, right))
              .map(([column, value]) => [column, snapshotValue(value)]),
          ),
        )
        .sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
      return { name, rows: tableRows };
    }),
  };
}

async function expectedSnapshot(
  materialization: LegacyMigrationMaterialization,
): Promise<TargetDatabaseSnapshot> {
  const artifacts = await loadCanonicalSchemaArtifacts();
  const reference = openConfiguredDatabase(':memory:', false);
  try {
    reference.exec(artifacts.ddl);
    withImmediateTransaction(reference, () => {
      writeLegacyMigrationMaterializationInTransaction(reference, materialization);
    });
    return databaseSnapshot(reference);
  } finally {
    reference.close();
  }
}

function targetRefKey(authority: string, id: string, projectId: string | null): string {
  return `${authority}\0${id}\0${projectId ?? ''}`;
}

function realizedTargetRefKeys(database: DatabaseSync): ReadonlySet<string> {
  const keys = new Set<string>();
  const add = (authority: string, id: string, projectId: string | null): void => {
    keys.add(targetRefKey(authority, id, projectId));
  };
  const addSelectedRows = (authority: string, sql: string): void => {
    for (const row of rows(database, sql)) {
      if (typeof row.id !== 'string') {
        throw new Error(`Stored ${authority} target has an invalid identity`);
      }
      if (row.project_id !== null && typeof row.project_id !== 'string') {
        throw new Error(`Stored ${authority} target has an invalid Project identity`);
      }
      add(authority, row.id, row.project_id as string | null);
    }
  };

  addSelectedRows('project', 'SELECT id, id AS project_id FROM projects');
  addSelectedRows('project_settings', 'SELECT project_id AS id, project_id FROM project_settings');
  addSelectedRows('media_blob', 'SELECT hash AS id, NULL AS project_id FROM media_blobs');
  addSelectedRows('global_media_folder', 'SELECT id, NULL AS project_id FROM global_media_folders');
  addSelectedRows('global_media_asset', 'SELECT id, NULL AS project_id FROM global_media_assets');
  addSelectedRows('project_media_ref', 'SELECT id, project_id FROM project_media_refs');
  addSelectedRows('production', 'SELECT id, project_id FROM production_objects');
  addSelectedRows('canvas', 'SELECT id, project_id FROM canvas_documents');
  addSelectedRows('chat', 'SELECT id, project_id FROM chats');
  addSelectedRows('message', 'SELECT id, project_id FROM messages');
  addSelectedRows(
    'imported_history_batch',
    'SELECT id, NULL AS project_id FROM imported_history_batches',
  );
  addSelectedRows('imported_run_history', 'SELECT id, project_id FROM imported_run_history');
  addSelectedRows(
    'imported_run_event_history',
    `SELECT event.id, run.project_id
       FROM imported_run_event_history AS event
       JOIN imported_run_history AS run ON run.id = event.run_id`,
  );

  for (const scope of rows(
    database,
    `SELECT scope.run_id, scope.ordinal, scope.payload_v1_json, run.project_id
       FROM imported_run_scope_history AS scope
       JOIN imported_run_history AS run ON run.id = scope.run_id`,
  )) {
    if (
      typeof scope.run_id !== 'string' ||
      (typeof scope.ordinal !== 'number' && typeof scope.ordinal !== 'bigint') ||
      typeof scope.payload_v1_json !== 'string' ||
      typeof scope.project_id !== 'string'
    ) {
      throw new Error('Stored imported Run scope identity is incomplete');
    }
    const payload: unknown = JSON.parse(scope.payload_v1_json);
    const canvasId =
      typeof payload === 'object' &&
      payload !== null &&
      !Array.isArray(payload) &&
      typeof (payload as { readonly canvasId?: unknown }).canvasId === 'string'
        ? (payload as { readonly canvasId: string }).canvasId
        : null;
    if (canvasId === null) throw new Error('Stored imported Run scope has no Canvas identity');
    add(
      'imported_run_scope_history',
      legacyImportedRunScopeTargetId(scope.run_id, scope.ordinal, canvasId),
      scope.project_id,
    );
  }

  for (const attachment of rows(
    database,
    `SELECT attachment.run_id, attachment.ordinal, attachment.role, attachment.blob_hash,
            run.project_id
       FROM imported_run_attachment_history AS attachment
       JOIN imported_run_history AS run ON run.id = attachment.run_id`,
  )) {
    if (
      typeof attachment.run_id !== 'string' ||
      (typeof attachment.ordinal !== 'number' && typeof attachment.ordinal !== 'bigint') ||
      typeof attachment.role !== 'string' ||
      typeof attachment.blob_hash !== 'string' ||
      typeof attachment.project_id !== 'string'
    ) {
      throw new Error('Stored imported Run attachment identity is incomplete');
    }
    add(
      'imported_run_attachment_history',
      legacyImportedRunAttachmentTargetId(
        attachment.run_id,
        attachment.ordinal,
        attachment.role,
        attachment.blob_hash,
      ),
      attachment.project_id,
    );
  }
  addSelectedRows(
    'imported_task_list_history',
    'SELECT id, project_id FROM imported_task_list_history',
  );
  addSelectedRows(
    'imported_task_item_history',
    'SELECT id, project_id FROM imported_task_item_history',
  );
  addSelectedRows('imported_history_record', 'SELECT id, project_id FROM imported_history_records');
  addSelectedRows('production_collection', 'SELECT id, project_id FROM production_collections');
  addSelectedRows('skill', 'SELECT id, NULL AS project_id FROM skills');
  return keys;
}

export async function reconcileLegacyMigration(
  database: DatabaseSync,
  materialization: LegacyMigrationMaterialization,
  plan: LegacyMigrationPlan,
  expectationHash: string,
): Promise<LegacyMigrationReconciliationReport> {
  assertLegacyMigrationPlan(plan);
  if (materialization.planFingerprint !== plan.fingerprint) {
    throw new TypeError('Legacy reconciliation plan differs from materialization');
  }
  if (materialization.importedHistory.batch.reconciliationHash !== expectationHash) {
    throw new TypeError('Legacy reconciliation expectation differs from imported batch');
  }
  const expected = await expectedSnapshot(materialization);
  const actual = databaseSnapshot(database);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error('Disposable Target content differs from migration materialization');
  }
  const foreignKeyViolations = rows(database, 'PRAGMA foreign_key_check');
  if (foreignKeyViolations.length !== 0) {
    throw new Error('Disposable Target contains foreign-key violations');
  }
  const uniqueRefs = new Map(
    plan.targetRefs.flatMap(({ targetRefs }) =>
      targetRefs.map((ref) => [targetRefKey(ref.authority, ref.id, ref.projectId), ref] as const),
    ),
  );
  const realizedRefs = realizedTargetRefKeys(database);
  let realizedTargetRefCount = 0;
  for (const ref of uniqueRefs.values()) {
    if (!realizedRefs.has(targetRefKey(ref.authority, ref.id, ref.projectId))) {
      throw new Error(`Migration target was not realized: ${ref.authority}/${ref.id}`);
    }
    realizedTargetRefCount += 1;
  }
  const counts = Object.fromEntries(actual.tables.map((table) => [table.name, table.rows.length]));
  const targetFingerprint = hashCanonical(actual);
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-migration-reconciliation/v1' as const,
    expectationHash,
    planFingerprint: plan.fingerprint,
    materializationFingerprint: materialization.fingerprint,
    targetRefCount: uniqueRefs.size,
    realizedTargetRefCount,
    counts,
    targetFingerprint,
    foreignKeyViolationCount: 0 as const,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: true,
  };
}
