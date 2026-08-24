import type { LegacyClassificationEntryInput } from './classification-report.js';
import {
  buildLegacyClassificationReport,
  legacyClassificationSourceKey,
} from './classification-report.js';
import { legacyRowClassifierFor } from './classification-routes.js';
import {
  scanLegacyRowsForClassification,
  type LegacyClassificationRow,
  type LegacyClassificationSubjectInventory,
} from './classification-subjects.js';
import { classifyLegacyGlobalMediaAssetRows } from './global-media-asset-classifier.js';
import { classifyLegacyGlobalMediaFolderRows } from './global-media-folder-classifier.js';
import { classifyVerifiedLegacyMediaBlobRows } from './media-blob-classifier.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';
import {
  legacyPlanHistorySourceFingerprint,
  preflightLegacyPlanHistory,
  type LegacyPlanHistoryPreflightReport,
} from './plan-history-preflight.js';
import {
  classifyLegacyDerivedProjectionRows,
  classifyLegacyOfflineSnapshotRows,
} from './offline-snapshot-classifier.js';
import type { LegacySourceDatabases, LegacySourceExpectedSchemas } from './source-preflight.js';
import { hashCanonical } from '../internal/hashes.js';
import { classifyLegacyProjectSettingRows } from './project-settings-classifier.js';
import {
  LEGACY_PROJECT_OWNERSHIP_TABLES,
  resolveLegacyProjectOwnership,
  type LegacyProjectOwnershipAssignment,
  type LegacyProjectOwnershipGraphReport,
} from './project-ownership-graph.js';

export interface LegacyRootRowClassificationReport {
  readonly schema: 'lucid-fin.legacy-root-row-classification/v1';
  readonly scope: 'root_rows';
  readonly inventory: LegacyClassificationSubjectInventory;
  readonly ownership: LegacyProjectOwnershipGraphReport;
  readonly planHistory: LegacyPlanHistoryPreflightReport | null;
  readonly classification: ReturnType<typeof buildLegacyClassificationReport>;
  readonly fingerprint: string;
  readonly ok: boolean;
}

export type LegacySkillRowClassifier = (
  rows: readonly LegacyClassificationRow[],
) => readonly LegacyClassificationEntryInput[];

export interface LegacyRootRowClassificationOptions {
  readonly classifyLegacySkillRows?: LegacySkillRowClassifier;
}

const CURRENT_OWNERSHIP_TABLES = new Set([
  'canvas_edges',
  'canvas_nodes',
  'canvases',
  'characters',
  'commander_sessions',
  'equipment',
  'locations',
  'scripts',
]);

function ownershipEntry(
  assignment: LegacyProjectOwnershipAssignment,
  subject: LegacyClassificationRow['subject'],
): LegacyClassificationEntryInput {
  if (assignment.disposition === 'blocking_error') {
    if (assignment.blockerCode === null) {
      throw new Error('Blocking Project ownership assignment has no blocker code');
    }
    return {
      subject,
      disposition: 'blocking_error',
      reasonCode: assignment.blockerCode,
      targetRefs: [],
      exportRef: null,
      blockerCode: assignment.blockerCode,
    };
  }
  if (assignment.disposition === 'offline_legacy_export') {
    if (assignment.exportRef === null) {
      throw new Error('Offline Project ownership assignment has no export reference');
    }
    return {
      subject,
      disposition: 'offline_legacy_export',
      reasonCode: 'legacy_unlinked_production_offline_export',
      targetRefs: [],
      exportRef: assignment.exportRef,
      blockerCode: null,
    };
  }
  if (assignment.targetRefs.length === 0) {
    throw new Error(`Migrated Project ownership assignment has no target: ${assignment.sourceKey}`);
  }
  return {
    subject,
    disposition: CURRENT_OWNERSHIP_TABLES.has(assignment.table)
      ? 'migrated_current_state'
      : 'immutable_provenance_history',
    reasonCode:
      assignment.disposition === 'cloned_per_project'
        ? 'legacy_shared_production_cloned_per_project'
        : assignment.disposition === 'imported_chat_project'
          ? 'legacy_unassigned_chat_imported_project'
          : 'legacy_project_ownership_resolved',
    targetRefs: assignment.targetRefs,
    exportRef: null,
    blockerCode: null,
  };
}

function offlineRootEntry(
  row: LegacyClassificationRow,
  reasonCode: string,
): LegacyClassificationEntryInput {
  const sourceKey = legacyClassificationSourceKey(row.subject);
  return {
    subject: row.subject,
    disposition: 'offline_legacy_export',
    reasonCode,
    targetRefs: [],
    exportRef: `legacy-export/${row.database}/${row.table}/${sourceKey}`,
    blockerCode: null,
  };
}

function offlineColorStyleEntry(row: LegacyClassificationRow): LegacyClassificationEntryInput {
  return offlineRootEntry(row, 'legacy_unbound_color_style_offline_export');
}

function blockedRootEntry(
  row: LegacyClassificationRow,
  blockerCode: string,
): LegacyClassificationEntryInput {
  return {
    subject: row.subject,
    disposition: 'blocking_error',
    reasonCode: blockerCode,
    targetRefs: [],
    exportRef: null,
    blockerCode,
  };
}

function blockedRunHistoryEntry(row: LegacyClassificationRow): LegacyClassificationEntryInput {
  if (row.table === 'commander_events') {
    return blockedRootEntry(row, 'legacy_commander_event_unmappable');
  }
  if (row.table === 'commander_run_attachments') {
    return blockedRootEntry(row, 'legacy_run_attachment_asset_identity_unresolved');
  }
  throw new Error(`Unsupported blocked Legacy Run history table: ${row.table}`);
}

function blockedTaskHistoryEntry(row: LegacyClassificationRow): LegacyClassificationEntryInput {
  if (row.table === 'task_artifacts') {
    return blockedRootEntry(row, 'legacy_task_artifact_target_mapping_unfrozen');
  }
  if (row.table === 'task_attempts') {
    return blockedRootEntry(row, 'legacy_task_attempt_target_mapping_unfrozen');
  }
  if (row.table === 'task_events') {
    return blockedRootEntry(row, 'legacy_task_event_run_owner_unresolved');
  }
  if (row.table === 'task_decisions') {
    return blockedRootEntry(row, 'legacy_task_decision_interaction_identity_unresolved');
  }
  if (row.table === 'task_evaluations') {
    return blockedRootEntry(row, 'legacy_task_evaluation_target_mapping_unfrozen');
  }
  throw new Error(`Unsupported blocked Legacy Task history table: ${row.table}`);
}

function blockedPlanHistoryEntry(
  row: LegacyClassificationRow,
  planHistory: LegacyPlanHistoryPreflightReport | null,
): LegacyClassificationEntryInput {
  if (row.table !== 'plan_documents' && row.table !== 'plan_approvals') {
    throw new Error(`Unsupported Legacy Plan history table: ${row.table}`);
  }
  return blockedRootEntry(
    row,
    planHistory?.ok === true
      ? 'legacy_plan_target_mapping_unfrozen'
      : 'legacy_plan_history_preflight_blocked',
  );
}

/**
 * Classifies only root rows. Embedded JSON members remain a separate required
 * report scope and are never implied by this report's `ok` value.
 */
export function classifyLegacyRootRows(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  media: LegacyMediaPreflightReport,
  options: LegacyRootRowClassificationOptions = {},
): LegacyRootRowClassificationReport {
  const mediaRows: LegacyClassificationRow[] = [];
  const globalMediaAssetRows: LegacyClassificationRow[] = [];
  const globalMediaFolderRows: LegacyClassificationRow[] = [];
  const snapshotSubjects: LegacyClassificationRow['subject'][] = [];
  const derivedProjectionSubjects: LegacyClassificationRow['subject'][] = [];
  const legacySkillRows: LegacyClassificationRow[] = [];
  const promptAssemblyRows: LegacyClassificationRow[] = [];
  const projectSettingRows: LegacyClassificationRow[] = [];
  const colorStyleRows: LegacyClassificationRow[] = [];
  const blockedRunHistoryRows: LegacyClassificationRow[] = [];
  const deliveryRows: LegacyClassificationRow[] = [];
  const blockedTaskHistoryRows: LegacyClassificationRow[] = [];
  const planDocumentRows: LegacyClassificationRow[] = [];
  const planApprovalRows: LegacyClassificationRow[] = [];
  const taskDependencyRows: LegacyClassificationRow[] = [];
  const ownershipRows: LegacyClassificationRow[] = [];
  const ownershipTableSet = new Set<string>(LEGACY_PROJECT_OWNERSHIP_TABLES);
  const inventory = scanLegacyRowsForClassification(databases, expected, (row) => {
    const classifier = legacyRowClassifierFor(row.database, row.table);
    if (classifier === 'media_blob') mediaRows.push(row);
    if (classifier === 'global_media_catalog' && row.table === 'asset_entries') {
      globalMediaAssetRows.push(row);
    }
    if (classifier === 'global_media_catalog' && row.table === 'asset_folders') {
      globalMediaFolderRows.push(row);
    }
    if (classifier === 'offline_snapshot') snapshotSubjects.push(row.subject);
    if (classifier === 'derived_projection') derivedProjectionSubjects.push(row.subject);
    if (classifier === 'legacy_skill_candidate') legacySkillRows.push(row);
    if (classifier === 'prompt_provenance' && row.table === 'prompt_assemblies') {
      promptAssemblyRows.push(row);
    }
    if (classifier === 'project_settings') projectSettingRows.push(row);
    if (classifier === 'production' && row.table === 'color_styles') colorStyleRows.push(row);
    if (classifier === 'delivery') deliveryRows.push(row);
    if (classifier === 'task_execution_history' && row.table === 'plan_documents') {
      planDocumentRows.push(row);
    }
    if (classifier === 'task_execution_history' && row.table === 'plan_approvals') {
      planApprovalRows.push(row);
    }
    if (
      classifier === 'task_execution_history' &&
      (row.table === 'task_artifacts' ||
        row.table === 'task_attempts' ||
        row.table === 'task_decisions' ||
        row.table === 'task_evaluations' ||
        row.table === 'task_events')
    ) {
      blockedTaskHistoryRows.push(row);
    }
    if (classifier === 'task_execution_history' && row.table === 'task_dependencies') {
      taskDependencyRows.push(row);
    }
    if (
      classifier === 'run_history' &&
      (row.table === 'commander_events' || row.table === 'commander_run_attachments')
    ) {
      blockedRunHistoryRows.push(row);
    }
    if (row.database === 'main' && ownershipTableSet.has(row.table)) ownershipRows.push(row);
  });
  for (const source of inventory.bySource) {
    legacyRowClassifierFor(source.database, source.table);
  }

  const expectedPlanTables = new Set(expected.main.tables.map(({ name }) => name));
  const hasCompletePlanHistorySource =
    expectedPlanTables.has('plan_documents') && expectedPlanTables.has('plan_approvals');
  const planHistory = hasCompletePlanHistorySource
    ? preflightLegacyPlanHistory(databases.main)
    : null;
  if (
    planHistory !== null &&
    planHistory.sourceFingerprint !==
      legacyPlanHistorySourceFingerprint({
        documents: planDocumentRows.map(({ values }) => values),
        approvals: planApprovalRows.map(({ values }) => values),
      })
  ) {
    throw new Error('Legacy Plan preflight inspected a different source snapshot');
  }

  const mediaEntries = classifyVerifiedLegacyMediaBlobRows(mediaRows, media);
  const verifiedBlobHashes = new Set(
    mediaEntries.flatMap(({ targetRefs }) => targetRefs.map(({ id }) => id)),
  );
  const globalMediaFolderEntries = classifyLegacyGlobalMediaFolderRows(globalMediaFolderRows);
  const verifiedFolderIds = new Set(
    globalMediaFolderEntries
      .filter(({ disposition }) => disposition === 'migrated_current_state')
      .flatMap(({ targetRefs }) => targetRefs.map(({ id }) => id)),
  );
  const ownership = resolveLegacyProjectOwnership(inventory.fingerprint, ownershipRows);
  if (ownership.sourceFingerprint !== inventory.fingerprint) {
    throw new Error('Legacy Project ownership inspected a different source snapshot');
  }
  const ownershipSubjects = new Map(
    ownershipRows.map((row) => [legacyClassificationSourceKey(row.subject), row.subject] as const),
  );
  const ownershipEntries = ownership.assignments.flatMap((assignment) => {
    const subject = ownershipSubjects.get(assignment.sourceKey);
    if (!subject) throw new Error('Legacy Project ownership assignment has no root subject');
    if (
      assignment.disposition !== 'blocking_error' &&
      assignment.disposition !== 'offline_legacy_export' &&
      assignment.targetRefs.length === 0
    ) {
      return [];
    }
    return [ownershipEntry(assignment, subject)];
  });
  const entries: LegacyClassificationEntryInput[] = [
    ...mediaEntries,
    ...globalMediaFolderEntries,
    ...classifyLegacyGlobalMediaAssetRows(
      globalMediaAssetRows,
      verifiedBlobHashes,
      verifiedFolderIds,
    ),
    ...classifyLegacyOfflineSnapshotRows(snapshotSubjects),
    ...classifyLegacyDerivedProjectionRows(derivedProjectionSubjects),
    ...promptAssemblyRows.map((row) =>
      blockedRootEntry(row, 'legacy_prompt_assembly_target_mapping_unfrozen'),
    ),
    ...classifyLegacyProjectSettingRows(projectSettingRows),
    ...colorStyleRows.map(offlineColorStyleEntry),
    ...blockedRunHistoryRows.map(blockedRunHistoryEntry),
    ...deliveryRows.map((row) =>
      blockedRootEntry(row, 'legacy_delivery_target_identity_unresolved'),
    ),
    ...blockedTaskHistoryRows.map(blockedTaskHistoryEntry),
    ...[...planDocumentRows, ...planApprovalRows].map((row) =>
      blockedPlanHistoryEntry(row, planHistory),
    ),
    ...taskDependencyRows.map((row) =>
      offlineRootEntry(row, 'legacy_task_dependency_graph_offline_export'),
    ),
    ...ownershipEntries,
    ...(options.classifyLegacySkillRows?.(legacySkillRows) ?? []),
  ];
  const classification = buildLegacyClassificationReport({
    sourceFingerprint: inventory.fingerprint,
    subjects: inventory.subjects,
    entries,
  });
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-root-row-classification/v1' as const,
    scope: 'root_rows' as const,
    inventory,
    ownership,
    planHistory,
    classification,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical({
      schema: withoutFingerprint.schema,
      scope: withoutFingerprint.scope,
      inventoryFingerprint: inventory.fingerprint,
      ownershipFingerprint: ownership.fingerprint,
      planHistoryFingerprint: planHistory?.fingerprint ?? null,
      classificationReportHash: classification.reportHash,
    }),
    ok: classification.ok && (planHistory?.ok ?? true),
  };
}
