import { hashCanonical } from '../internal/hashes.js';
import type {
  LegacyClassificationEntryInput,
  LegacyClassificationSubject,
  LegacyClassificationTargetRefInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;

export const LEGACY_IMPORTED_HISTORY_SCHEMA_IDS = Object.freeze({
  deliveryAssetRef: 'legacy.delivery_intent.v1',
  planApproval: 'legacy.plan_approval.v1',
  planDocument: 'legacy.plan_document.v1',
  promptAssembly: 'legacy.prompt_assembly.v1',
  taskArtifact: 'legacy.task_artifact.v1',
  taskAttempt: 'legacy.task_attempt.v1',
  taskDecision: 'legacy.task_decision.v1',
  taskDependency: 'legacy.task_dependency.v1',
  taskEvaluation: 'legacy.task_evaluation.v1',
  taskEvent: 'legacy.task_event.v1',
  generationMetadata: 'legacy.generation_metadata.v1',
  unmigratedPayload: 'legacy.unmigrated_payload.v1',
} as const);

export type LegacyImportedHistorySchemaId =
  (typeof LEGACY_IMPORTED_HISTORY_SCHEMA_IDS)[keyof typeof LEGACY_IMPORTED_HISTORY_SCHEMA_IDS];

export type LegacyProjectSettingPolicy =
  | Readonly<{
      key: 'appSettings' | 'styleGuide';
      disposition: 'offline_legacy_export';
      reasonCode: string;
    }>
  | Readonly<{
      key: '*';
      disposition: 'blocking_error';
      reasonCode: 'unknown_legacy_project_setting_key';
    }>;

/**
 * Frozen ownership policy for the Legacy global settings store. Neither known
 * key is Project-owned target state; both are retained in the restricted
 * offline export. Unknown keys remain blockers instead of being guessed.
 */
export const LEGACY_PROJECT_SETTING_POLICIES: readonly LegacyProjectSettingPolicy[] = [
  {
    key: 'appSettings',
    disposition: 'offline_legacy_export',
    reasonCode: 'legacy_global_app_settings_offline_export',
  },
  {
    key: 'styleGuide',
    disposition: 'offline_legacy_export',
    reasonCode: 'legacy_unbound_style_guide_offline_export',
  },
  {
    key: '*',
    disposition: 'blocking_error',
    reasonCode: 'unknown_legacy_project_setting_key',
  },
] as const;

const IMPORTED_RECORD_TABLE_SCHEMAS = new Map<string, LegacyImportedHistorySchemaId>([
  ['delivery_asset_refs', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.deliveryAssetRef],
  ['plan_approvals', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.planApproval],
  ['plan_documents', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.planDocument],
  ['prompt_assemblies', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.promptAssembly],
  ['task_artifacts', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.taskArtifact],
  ['task_attempts', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.taskAttempt],
  ['task_decisions', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.taskDecision],
  ['task_dependencies', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.taskDependency],
  ['task_evaluations', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.taskEvaluation],
  ['task_events', LEGACY_IMPORTED_HISTORY_SCHEMA_IDS.taskEvent],
]);

function validEntityId(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_ID_PATTERN.test(value);
}

function contentAddressedId(kind: string, input: unknown): string {
  return `${kind}.${hashCanonical(input)}`;
}

function sqliteIdentityValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
}

export function legacyImportedRunScopeTargetId(
  runId: string,
  ordinal: unknown,
  canvasId: unknown,
): string {
  return contentAddressedId('imported.run-scope', {
    schema: 'lucid-fin.legacy-imported-run-scope-id/v1',
    runId,
    ordinal: sqliteIdentityValue(ordinal),
    canvasId,
  });
}

export function legacyImportedRunAttachmentTargetId(
  runId: string,
  ordinal: unknown,
  role: unknown,
  contentHash: unknown,
): string {
  return contentAddressedId('imported.run-attachment', {
    schema: 'lucid-fin.legacy-imported-run-attachment-id/v1',
    runId,
    ordinal: sqliteIdentityValue(ordinal),
    role,
    contentHash,
  });
}

function importedRecordTarget(
  subject: LegacyClassificationSubject,
  projectId: string | null,
): LegacyClassificationTargetRefInput {
  return {
    authority: 'imported_history_record',
    id: contentAddressedId('imported.record', {
      schema: 'lucid-fin.legacy-imported-history-record-id/v1',
      database: subject.database,
      table: subject.table,
      rowKey: subject.rowKey,
      projectId,
    }),
    projectId,
  };
}

export function legacyImportedRecordSchemaId(table: string): LegacyImportedHistorySchemaId | null {
  return IMPORTED_RECORD_TABLE_SCHEMAS.get(table) ?? null;
}

export function legacyImportedRootTargetRefs(
  row: LegacyClassificationRow,
  projectId: string | null,
): readonly LegacyClassificationTargetRefInput[] | null {
  if (row.database !== 'main' || row.subject.path !== '$') return null;
  if (row.table === 'commander_runs') {
    return validEntityId(row.values.id)
      ? [{ authority: 'imported_run_history', id: row.values.id, projectId }]
      : null;
  }
  if (row.table === 'commander_run_canvases') {
    return validEntityId(row.values.run_id)
      ? [
          {
            authority: 'imported_run_scope_history',
            id: legacyImportedRunScopeTargetId(
              row.values.run_id,
              row.values.ordinal,
              row.values.canvas_id,
            ),
            projectId,
          },
        ]
      : null;
  }
  if (row.table === 'commander_events') {
    return validEntityId(row.values.run_id)
      ? [
          {
            authority: 'imported_run_event_history',
            id: contentAddressedId('imported.run-event', {
              schema: 'lucid-fin.legacy-imported-run-event-id/v1',
              runId: row.values.run_id,
              sequence: sqliteIdentityValue(row.values.seq),
            }),
            projectId,
          },
        ]
      : null;
  }
  if (row.table === 'commander_run_attachments') {
    return validEntityId(row.values.run_id)
      ? [
          {
            authority: 'imported_run_attachment_history',
            id: legacyImportedRunAttachmentTargetId(
              row.values.run_id,
              row.values.ordinal,
              row.values.role,
              row.values.content_hash,
            ),
            projectId,
          },
        ]
      : null;
  }
  if (row.table === 'task_lists') {
    return validEntityId(row.values.id)
      ? [{ authority: 'imported_task_list_history', id: row.values.id, projectId }]
      : null;
  }
  if (row.table === 'tasks') {
    return validEntityId(row.values.id)
      ? [{ authority: 'imported_task_item_history', id: row.values.id, projectId }]
      : null;
  }
  if (legacyImportedRecordSchemaId(row.table) !== null) {
    return [importedRecordTarget(row.subject, projectId)];
  }
  return null;
}

export function legacyImportedRootEntry(
  row: LegacyClassificationRow,
  projectId: string | null,
): LegacyClassificationEntryInput | null {
  const targetRefs = legacyImportedRootTargetRefs(row, projectId);
  if (targetRefs === null || targetRefs.length === 0) return null;
  const reasonCode = row.table.startsWith('commander_')
    ? 'legacy_run_history_imported_read_only'
    : row.table.startsWith('task_') || row.table.startsWith('plan_')
      ? 'legacy_task_history_imported_read_only'
      : row.table === 'delivery_asset_refs'
        ? 'legacy_delivery_history_imported_read_only'
        : 'legacy_provenance_imported_read_only';
  return {
    subject: row.subject,
    disposition: 'immutable_provenance_history',
    reasonCode,
    targetRefs,
    exportRef: null,
    blockerCode: null,
  };
}

/** Every valid JSON member of an imported record shares its immutable owner. */
export function legacyImportedEmbeddedEntry(
  subject: LegacyClassificationSubject,
  rootTargetRefs: readonly LegacyClassificationTargetRefInput[],
): LegacyClassificationEntryInput {
  return {
    subject,
    disposition: 'immutable_provenance_history',
    reasonCode: 'legacy_imported_history_embedded_evidence',
    targetRefs: rootTargetRefs,
    exportRef: null,
    blockerCode: null,
  };
}

export function legacyCanvasEvidenceTarget(
  subject: LegacyClassificationSubject,
  projectId: string,
): LegacyClassificationTargetRefInput {
  return importedRecordTarget(subject, projectId);
}

export function legacyProductionCollectionId(
  table: 'character_folders' | 'equipment_folders' | 'location_folders',
  sourceId: string,
  projectId: string,
): string {
  return contentAddressedId('production.collection.import', {
    schema: 'lucid-fin.legacy-production-collection-id/v1',
    table,
    sourceId,
    projectId,
  });
}

export function legacyProductionCollectionSourceId(
  table: 'character_folders' | 'equipment_folders' | 'location_folders',
  sourceId: string,
): string {
  return contentAddressedId('legacy.production.collection', {
    schema: 'lucid-fin.legacy-production-collection-source-id/v1',
    table,
    sourceId,
  });
}
