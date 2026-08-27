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
import { legacyImportedRootEntry } from './legacy-migration-policy.js';
import {
  preflightLegacyRunHistory,
  type LegacyRunHistoryPreflightReport,
} from './run-history-preflight.js';
import {
  preflightLegacyTaskHistory,
  type LegacyTaskHistoryPreflightReport,
} from './task-history-preflight.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';

export interface LegacyRootRowClassificationReport {
  readonly schema: 'lucid-fin.legacy-root-row-classification/v1';
  readonly scope: 'root_rows';
  readonly inventory: LegacyClassificationSubjectInventory;
  readonly ownership: LegacyProjectOwnershipGraphReport;
  readonly planHistory: LegacyPlanHistoryPreflightReport | null;
  readonly runHistory: LegacyRunHistoryPreflightReport | null;
  readonly taskHistory: LegacyTaskHistoryPreflightReport | null;
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
  'character_folders',
  'characters',
  'commander_sessions',
  'equipment',
  'equipment_folders',
  'location_folders',
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
    reasonCode: assignment.targetRefs.every(({ authority }) => authority.startsWith('imported_'))
      ? 'legacy_execution_history_imported_read_only'
      : assignment.disposition === 'cloned_per_project'
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

function assignmentProjectId(
  assignments: readonly LegacyProjectOwnershipAssignment[],
  table: string,
  id: unknown,
): string | null {
  if (typeof id !== 'string') return null;
  const assignment = assignments.find(
    (candidate) => candidate.table === table && candidate.targetRefs.some((ref) => ref.id === id),
  );
  return assignment?.projectIds.length === 1 ? assignment.projectIds[0]! : null;
}

function importedHistoryProjectId(
  row: LegacyClassificationRow,
  assignments: readonly LegacyProjectOwnershipAssignment[],
): string | null {
  const values = row.values;
  if (row.table.startsWith('commander_')) {
    return assignmentProjectId(assignments, 'commander_runs', values.run_id);
  }
  if (row.table === 'delivery_asset_refs' || row.table === 'prompt_assemblies') {
    return assignmentProjectId(assignments, 'canvases', values.canvas_id);
  }
  if (row.table.startsWith('task_') || row.table.startsWith('plan_')) {
    return (
      assignmentProjectId(assignments, 'task_lists', values.task_list_id) ??
      assignmentProjectId(assignments, 'tasks', values.task_id)
    );
  }
  return null;
}

function importedHistoryEntry(
  row: LegacyClassificationRow,
  assignments: readonly LegacyProjectOwnershipAssignment[],
): LegacyClassificationEntryInput {
  const projectId = importedHistoryProjectId(row, assignments);
  if (projectId === null) {
    return blockedRootEntry(row, 'legacy_imported_history_project_owner_unresolved');
  }
  const entry = legacyImportedRootEntry(row, projectId);
  if (entry === null) {
    throw new Error(`Legacy imported-history policy is missing ${row.database}.${row.table}`);
  }
  return entry;
}

function hasFrozenMainTableShape(expected: LegacySourceExpectedSchemas, tableName: string): boolean {
  const actual = expected.main.tables.find(({ name }) => name === tableName);
  const frozen = I0_LEGACY_SOURCE_SCHEMAS.main.tables.find(({ name }) => name === tableName);
  if (!actual || !frozen || actual.kind !== frozen.kind) return false;
  const actualColumns = [...actual.columns].sort();
  const frozenColumns = [...frozen.columns].sort();
  return (
    actualColumns.length === frozenColumns.length &&
    actualColumns.every((column, index) => column === frozenColumns[index])
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
  const importedHistoryRows: LegacyClassificationRow[] = [];
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
    if (classifier === 'prompt_provenance' && row.table === 'prompt_assemblies')
      promptAssemblyRows.push(row);
    if (classifier === 'project_settings') projectSettingRows.push(row);
    if (classifier === 'production' && row.table === 'color_styles') colorStyleRows.push(row);
    if (classifier === 'delivery') importedHistoryRows.push(row);
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
      importedHistoryRows.push(row);
    }
    if (classifier === 'task_execution_history' && row.table === 'task_dependencies')
      taskDependencyRows.push(row);
    if (
      classifier === 'run_history' &&
      (row.table === 'commander_events' || row.table === 'commander_run_attachments')
    ) {
      importedHistoryRows.push(row);
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
  const hasCompleteRunHistorySource = [
    'commander_events',
    'commander_run_attachments',
    'commander_run_canvases',
    'commander_runs',
  ].every((table) => hasFrozenMainTableShape(expected, table));
  const verifiedMediaHashes = new Set(media.verifiedAssetHashes);
  const runHistory = hasCompleteRunHistorySource
    ? preflightLegacyRunHistory(databases.main, verifiedMediaHashes)
    : null;
  const hasCompleteTaskHistorySource = [
    'plan_approvals',
    'plan_documents',
    'prompt_assemblies',
    'task_artifacts',
    'task_attempts',
    'task_dependencies',
    'task_events',
    'task_lists',
    'tasks',
  ].every((table) => hasFrozenMainTableShape(expected, table));
  const taskHistory = hasCompleteTaskHistorySource
    ? preflightLegacyTaskHistory(databases.main, verifiedMediaHashes)
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
  importedHistoryRows.push(
    ...promptAssemblyRows,
    ...planDocumentRows,
    ...planApprovalRows,
    ...taskDependencyRows,
  );
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
    ...classifyLegacyProjectSettingRows(projectSettingRows),
    ...colorStyleRows.map(offlineColorStyleEntry),
    ...importedHistoryRows.map((row) => importedHistoryEntry(row, ownership.assignments)),
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
    runHistory,
    taskHistory,
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
      runHistoryFingerprint: runHistory?.fingerprint ?? null,
      taskHistoryFingerprint: taskHistory?.fingerprint ?? null,
      classificationReportHash: classification.reportHash,
    }),
    ok:
      classification.ok &&
      (planHistory?.ok ?? true) &&
      (runHistory?.ok ?? true) &&
      (taskHistory?.ok ?? true),
  };
}
