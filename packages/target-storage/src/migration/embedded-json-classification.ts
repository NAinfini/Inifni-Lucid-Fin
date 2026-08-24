import type { DatabaseSync } from 'node:sqlite';
import {
  CanvasAnnotationSchema,
  EntityIdSchema,
  GlobalMediaTagsSchema,
} from '@lucid-fin/target-contracts';
import { hashCanonical } from '../internal/hashes.js';
import {
  buildLegacyClassificationReport,
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
  type LegacyClassificationReport,
  type LegacyClassificationSubject,
  type LegacyClassificationTargetRefInput,
} from './classification-report.js';
import {
  scanLegacyRowsForClassification,
  type LegacyClassificationRow,
} from './classification-subjects.js';
import type { LegacySourceDatabases, LegacySourceExpectedSchemas } from './source-preflight.js';
import type { LegacyProjectOwnershipGraphReport } from './project-ownership-graph.js';

const SOURCE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_LEGACY_COMMANDER_SESSION_MESSAGES = 200;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface LegacyEmbeddedJsonSource {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly table: string;
  readonly columns: readonly string[];
}

/**
 * Frozen registry of Legacy columns whose text is authored and read as JSON.
 * Opaque strings and private BLOB recovery payloads deliberately stay out.
 */
export const LEGACY_EMBEDDED_JSON_SOURCES: readonly LegacyEmbeddedJsonSource[] = [
  { database: 'main', table: 'asset_contents', columns: ['generation_metadata'] },
  { database: 'main', table: 'asset_entries', columns: ['tags'] },
  { database: 'main', table: 'canvas_nodes', columns: ['data_json'] },
  {
    database: 'main',
    table: 'canvases',
    columns: [
      'delivery_sequence_json',
      'notes',
      'resolution_policy_json',
      'viewport',
      'visual_style_policy_json',
    ],
  },
  {
    database: 'main',
    table: 'characters',
    columns: [
      'body',
      'costumes',
      'distinct_traits',
      'face',
      'hair',
      'loadouts',
      'reference_images',
      'tags',
      'vocal_traits',
    ],
  },
  {
    database: 'main',
    table: 'color_styles',
    columns: ['exposure', 'gradients', 'palette', 'tags'],
  },
  { database: 'main', table: 'commander_events', columns: ['payload'] },
  {
    database: 'main',
    table: 'commander_sessions',
    columns: ['context_graph_json', 'messages'],
  },
  { database: 'main', table: 'custom_shot_templates', columns: ['tracks_json'] },
  {
    database: 'main',
    table: 'equipment',
    columns: ['reference_images', 'tags'],
  },
  {
    database: 'main',
    table: 'locations',
    columns: ['atmosphere_keywords', 'dominant_colors', 'key_features', 'reference_images', 'tags'],
  },
  { database: 'main', table: 'plan_documents', columns: ['content_json'] },
  { database: 'main', table: 'preset_overrides', columns: ['defaults', 'params'] },
  { database: 'main', table: 'project_settings', columns: ['value'] },
  {
    database: 'main',
    table: 'prompt_assemblies',
    columns: [
      'authority_json',
      'conditioning_manifest_json',
      'host_constraints_json',
      'input_json',
      'output_json',
      'provider_profile_json',
      'sources_json',
    ],
  },
  { database: 'main', table: 'scripts', columns: ['parsed_scenes'] },
  { database: 'main', table: 'snapshots', columns: ['data'] },
  { database: 'main', table: 'task_artifacts', columns: ['metadata_json'] },
  {
    database: 'main',
    table: 'task_attempts',
    columns: [
      'generation_spec_json',
      'input_json',
      'metadata_json',
      'output_json',
      'repair_delta_json',
    ],
  },
  { database: 'main', table: 'task_decisions', columns: ['options_json'] },
  {
    database: 'main',
    table: 'task_evaluations',
    columns: [
      'evidence_json',
      'frame_evidence_json',
      'metadata_json',
      'repair_delta_json',
      'risks_json',
      'scores_json',
      'strengths_json',
    ],
  },
  { database: 'main', table: 'task_events', columns: ['payload_json'] },
  {
    database: 'main',
    table: 'task_lists',
    columns: ['input_json', 'metadata_json', 'output_json'],
  },
  {
    database: 'main',
    table: 'tasks',
    columns: ['dependency_ids_json', 'input_json', 'output_json'],
  },
] as const;

export type LegacyEmbeddedJsonDocumentIssueReason =
  'not_text' | 'invalid_json' | 'duplicate_object_key' | 'uninspectable_structure';

export interface LegacyEmbeddedJsonDocumentIssue {
  readonly subject: LegacyClassificationSubject;
  readonly reason: LegacyEmbeddedJsonDocumentIssueReason;
}

export interface LegacyEmbeddedJsonSourceReport {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly table: string;
  readonly column: string;
  readonly documentCount: number;
  readonly subjectCount: number;
  readonly invalidDocumentCount: number;
  readonly contentFingerprint: string;
}

export interface LegacyEmbeddedJsonSubjectInventory {
  readonly schema: 'lucid-fin.legacy-embedded-json-subject-inventory/v1';
  readonly sourceFingerprint: string;
  readonly sourceCount: number;
  readonly documentCount: number;
  readonly subjectCount: number;
  readonly invalidDocumentCount: number;
  readonly bySource: readonly LegacyEmbeddedJsonSourceReport[];
  readonly subjects: readonly LegacyClassificationSubject[];
  readonly issues: readonly LegacyEmbeddedJsonDocumentIssue[];
  readonly fingerprint: string;
  readonly ok: boolean;
}

export interface LegacyEmbeddedJsonMember {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly table: string;
  readonly column: string;
  readonly rowSubject: LegacyClassificationRow['subject'];
  readonly subject: LegacyClassificationSubject;
  readonly memberPath: readonly (string | number)[];
  readonly value: unknown;
}

export type LegacyEmbeddedJsonMemberVisitor = (member: LegacyEmbeddedJsonMember) => void;

interface MutableSourceReport {
  readonly database: keyof LegacySourceExpectedSchemas;
  readonly table: string;
  readonly column: string;
  documentCount: number;
  subjectCount: number;
  invalidDocumentCount: number;
  readonly subjectFingerprints: string[];
  readonly issueFingerprints: string[];
}

interface JsonTreeRow {
  readonly id: unknown;
  readonly parent: unknown;
  readonly key: unknown;
  readonly type: unknown;
  readonly atom: unknown;
  readonly value: unknown;
}

interface ParsedTreeMember {
  readonly identity: string;
  readonly memberPath: readonly (string | number)[];
  readonly type: string;
  readonly value: unknown;
}

type JsonTreeStatement = ReturnType<DatabaseSync['prepare']>;

function tableKey(database: keyof LegacySourceExpectedSchemas, table: string): string {
  return `${database}\u0000${table}`;
}

function sourceKey(
  database: keyof LegacySourceExpectedSchemas,
  table: string,
  column: string,
): string {
  return `${database}\u0000${table}\u0000${column}`;
}

function normalizedSources(
  expected: LegacySourceExpectedSchemas,
  sources: readonly LegacyEmbeddedJsonSource[],
): readonly LegacyEmbeddedJsonSource[] {
  const normalized: LegacyEmbeddedJsonSource[] = [];
  const seenTables = new Set<string>();
  for (const source of sources) {
    if (source.database !== 'main' && source.database !== 'prompts') {
      throw new TypeError(`Invalid Legacy embedded JSON database: ${String(source.database)}`);
    }
    if (!SOURCE_NAME_PATTERN.test(source.table)) {
      throw new TypeError(`Invalid Legacy embedded JSON table: ${source.table}`);
    }
    const key = tableKey(source.database, source.table);
    if (seenTables.has(key)) {
      throw new TypeError(
        `Duplicate Legacy embedded JSON source: ${source.database}.${source.table}`,
      );
    }
    seenTables.add(key);
    const table = expected[source.database].tables.find(({ name }) => name === source.table);
    if (!table) {
      throw new TypeError(`Unknown Legacy embedded JSON table: ${source.database}.${source.table}`);
    }
    const columns = [...source.columns].sort(compareText);
    if (
      columns.length === 0 ||
      columns.some((column) => !SOURCE_NAME_PATTERN.test(column)) ||
      new Set(columns).size !== columns.length
    ) {
      throw new TypeError(`Invalid Legacy embedded JSON columns for ${source.table}`);
    }
    const tableColumns = new Set(table.columns);
    const unknownColumn = columns.find((column) => !tableColumns.has(column));
    if (unknownColumn) {
      throw new TypeError(
        `Unknown Legacy embedded JSON column: ${source.database}.${source.table}.${unknownColumn}`,
      );
    }
    normalized.push({ ...source, columns });
  }
  return normalized.sort(
    (left, right) =>
      compareText(left.database, right.database) || compareText(left.table, right.table),
  );
}

function memberIdentity(
  parentIdentity: string,
  segment: string | number,
  duplicateOrdinal: number,
): string {
  return hashCanonical({
    parentIdentity,
    segment:
      typeof segment === 'number'
        ? { kind: 'array_index', index: segment }
        : { kind: 'object_key', key: segment },
    duplicateOrdinal,
  });
}

function jsonTreeValue(row: JsonTreeRow): unknown {
  if (row.type === 'null') return null;
  if (row.type === 'true') return true;
  if (row.type === 'false') return false;
  if (row.type === 'text' || row.type === 'integer' || row.type === 'real') return row.atom;
  if (row.type === 'object' || row.type === 'array') {
    if (typeof row.value !== 'string') throw new Error('Legacy JSON tree container is not text');
    return JSON.parse(row.value) as unknown;
  }
  throw new Error(`Legacy JSON tree returned unsupported type: ${String(row.type)}`);
}

function addSubject(
  subjects: LegacyClassificationSubject[],
  report: MutableSourceReport,
  subject: LegacyClassificationSubject,
): void {
  subjects.push(subject);
  report.subjectCount += 1;
  report.subjectFingerprints.push(hashCanonical(subject));
}

function addIssue(
  issues: LegacyEmbeddedJsonDocumentIssue[],
  report: MutableSourceReport,
  subject: LegacyClassificationSubject,
  reason: LegacyEmbeddedJsonDocumentIssueReason,
): void {
  const issue = { subject, reason } as const;
  issues.push(issue);
  report.invalidDocumentCount += 1;
  report.issueFingerprints.push(hashCanonical(issue));
}

function enumerateDocument(
  row: LegacyClassificationRow,
  column: string,
  jsonTree: JsonTreeStatement,
  report: MutableSourceReport,
  subjects: LegacyClassificationSubject[],
  issues: LegacyEmbeddedJsonDocumentIssue[],
  visit: LegacyEmbeddedJsonMemberVisitor | undefined,
): void {
  const raw = row.values[column];
  if (raw === null) return;

  report.documentCount += 1;
  const rootPath = `$.${column}`;
  const rootSubject: LegacyClassificationSubject = { ...row.subject, path: rootPath };
  addSubject(subjects, report, rootSubject);
  if (typeof raw !== 'string') {
    addIssue(issues, report, rootSubject, 'not_text');
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    addIssue(issues, report, rootSubject, 'invalid_json');
    return;
  }

  const rootIdentity = hashCanonical({
    database: row.database,
    table: row.table,
    rowKey: row.subject.rowKey,
    column,
  });
  let treeRows: JsonTreeRow[];
  try {
    treeRows = jsonTree.all(raw) as unknown as JsonTreeRow[];
  } catch {
    addIssue(issues, report, rootSubject, 'uninspectable_structure');
    return;
  }
  const root = treeRows[0];
  if (
    !root ||
    typeof root.id !== 'number' ||
    root.parent !== null ||
    root.key !== null ||
    typeof root.type !== 'string'
  ) {
    throw new Error('Legacy JSON tree did not return a valid root');
  }
  const membersById = new Map<number, ParsedTreeMember>([
    [root.id, { identity: rootIdentity, memberPath: [], type: root.type, value: parsed }],
  ]);
  const members: Array<{ readonly subject: LegacyClassificationSubject } & ParsedTreeMember> = [
    {
      subject: rootSubject,
      identity: rootIdentity,
      memberPath: [],
      type: root.type,
      value: parsed,
    },
  ];
  const objectKeyCounts = new Map<string, number>();
  let hasDuplicateObjectKey = false;
  for (const treeRow of treeRows.slice(1)) {
    if (
      typeof treeRow.id !== 'number' ||
      typeof treeRow.parent !== 'number' ||
      typeof treeRow.type !== 'string' ||
      (typeof treeRow.key !== 'string' && typeof treeRow.key !== 'number')
    ) {
      throw new Error('Legacy JSON tree returned an invalid member');
    }
    const parent = membersById.get(treeRow.parent);
    if (!parent || (parent.type !== 'object' && parent.type !== 'array')) {
      throw new Error('Legacy JSON tree returned an invalid parent');
    }
    if (
      (parent.type === 'object' && typeof treeRow.key !== 'string') ||
      (parent.type === 'array' && typeof treeRow.key !== 'number')
    ) {
      throw new Error('Legacy JSON tree member key does not match its parent');
    }
    const occurrenceKey = `${treeRow.parent}\u0000${String(treeRow.key)}`;
    const duplicateOrdinal =
      parent.type === 'object' ? (objectKeyCounts.get(occurrenceKey) ?? 0) : 0;
    if (parent.type === 'object') {
      objectKeyCounts.set(occurrenceKey, duplicateOrdinal + 1);
      if (duplicateOrdinal > 0) hasDuplicateObjectKey = true;
    }
    const identity = memberIdentity(parent.identity, treeRow.key, duplicateOrdinal);
    const subject: LegacyClassificationSubject = {
      ...row.subject,
      path: `${rootPath}#${identity}`,
    };
    addSubject(subjects, report, subject);
    const member: ParsedTreeMember = {
      identity,
      memberPath: [...parent.memberPath, treeRow.key],
      type: treeRow.type,
      value: jsonTreeValue(treeRow),
    };
    membersById.set(treeRow.id, member);
    members.push({
      subject,
      ...member,
    });
  }
  if (hasDuplicateObjectKey) {
    addIssue(issues, report, rootSubject, 'duplicate_object_key');
    return;
  }
  for (const member of members) {
    visit?.({
      database: row.database,
      table: row.table,
      column,
      rowSubject: row.subject,
      subject: member.subject,
      memberPath: member.memberPath,
      value: member.value,
    });
  }
}

function enumerate(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  sources: readonly LegacyEmbeddedJsonSource[],
  visit: LegacyEmbeddedJsonMemberVisitor | undefined,
): LegacyEmbeddedJsonSubjectInventory {
  const normalized = normalizedSources(expected, sources);
  const columnsByTable = new Map<string, readonly string[]>();
  const mutableReports = new Map<string, MutableSourceReport>();
  for (const source of normalized) {
    columnsByTable.set(tableKey(source.database, source.table), source.columns);
    for (const column of source.columns) {
      mutableReports.set(sourceKey(source.database, source.table, column), {
        database: source.database,
        table: source.table,
        column,
        documentCount: 0,
        subjectCount: 0,
        invalidDocumentCount: 0,
        subjectFingerprints: [],
        issueFingerprints: [],
      });
    }
  }

  const subjects: LegacyClassificationSubject[] = [];
  const issues: LegacyEmbeddedJsonDocumentIssue[] = [];
  const jsonTrees = {
    main: databases.main.prepare(
      'SELECT id, parent, key, type, atom, value FROM json_tree(?) ORDER BY id',
    ),
    prompts: databases.prompts.prepare(
      'SELECT id, parent, key, type, atom, value FROM json_tree(?) ORDER BY id',
    ),
  } as const;
  const rowInventory = scanLegacyRowsForClassification(databases, expected, (row) => {
    const columns = columnsByTable.get(tableKey(row.database, row.table));
    if (!columns) return;
    for (const column of columns) {
      const report = mutableReports.get(sourceKey(row.database, row.table, column));
      if (!report) throw new Error('Legacy embedded JSON source report disappeared');
      enumerateDocument(row, column, jsonTrees[row.database], report, subjects, issues, visit);
    }
  });

  const bySource = [...mutableReports.values()].map((report): LegacyEmbeddedJsonSourceReport => ({
    database: report.database,
    table: report.table,
    column: report.column,
    documentCount: report.documentCount,
    subjectCount: report.subjectCount,
    invalidDocumentCount: report.invalidDocumentCount,
    contentFingerprint: hashCanonical({
      database: report.database,
      table: report.table,
      column: report.column,
      subjectFingerprints: report.subjectFingerprints,
      issueFingerprints: report.issueFingerprints,
    }),
  }));
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-embedded-json-subject-inventory/v1' as const,
    sourceFingerprint: rowInventory.fingerprint,
    sourceCount: bySource.length,
    documentCount: bySource.reduce((total, source) => total + source.documentCount, 0),
    subjectCount: subjects.length,
    invalidDocumentCount: issues.length,
    bySource,
    subjects,
    issues,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: issues.length === 0,
  };
}

/** Enumerates opaque embedded subjects without exposing source values. */
export function enumerateLegacyEmbeddedJsonClassificationSubjects(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  sources: readonly LegacyEmbeddedJsonSource[] = LEGACY_EMBEDDED_JSON_SOURCES,
): LegacyEmbeddedJsonSubjectInventory {
  return enumerate(databases, expected, sources, undefined);
}

/** Visits parsed members synchronously; visitors must not persist or report raw values or keys. */
export function scanLegacyEmbeddedJsonMembersForClassification(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  visit: LegacyEmbeddedJsonMemberVisitor,
  sources: readonly LegacyEmbeddedJsonSource[] = LEGACY_EMBEDDED_JSON_SOURCES,
): LegacyEmbeddedJsonSubjectInventory {
  return enumerate(databases, expected, sources, visit);
}

export type LegacyEmbeddedJsonMemberClassifier = (
  members: readonly LegacyEmbeddedJsonMember[],
) => readonly LegacyClassificationEntryInput[];

export interface LegacyEmbeddedJsonClassificationOptions {
  readonly sources?: readonly LegacyEmbeddedJsonSource[];
  readonly ownership?: LegacyProjectOwnershipGraphReport;
  readonly rootClassification?: LegacyClassificationReport;
  readonly classifyMembers?: LegacyEmbeddedJsonMemberClassifier;
}

export interface LegacyEmbeddedJsonClassificationReport {
  readonly schema: 'lucid-fin.legacy-embedded-json-classification/v1';
  readonly scope: 'embedded_json_members';
  readonly inventory: LegacyEmbeddedJsonSubjectInventory;
  readonly classification: ReturnType<typeof buildLegacyClassificationReport>;
  readonly fingerprint: string;
  readonly ok: boolean;
}

function documentKey(subject: LegacyClassificationSubject): string {
  return `${subject.database}\u0000${subject.table}\u0000${subject.rowKey}\u0000${subject.path.split('#', 1)[0]}`;
}

function offlineEmbeddedEntry(
  subject: LegacyClassificationSubject,
): LegacyClassificationEntryInput | null {
  const isSnapshotData =
    subject.database === 'main' &&
    subject.table === 'snapshots' &&
    (subject.path === '$.data' || subject.path.startsWith('$.data#'));
  const isDiscardedContextGraph =
    subject.database === 'main' &&
    subject.table === 'commander_sessions' &&
    (subject.path === '$.context_graph_json' || subject.path.startsWith('$.context_graph_json#'));
  const isDiscardedTaskDependencyGraph =
    subject.database === 'main' &&
    subject.table === 'tasks' &&
    (subject.path === '$.dependency_ids_json' || subject.path.startsWith('$.dependency_ids_json#'));
  if (!isSnapshotData && !isDiscardedContextGraph && !isDiscardedTaskDependencyGraph) return null;
  return {
    subject,
    disposition: 'offline_legacy_export',
    reasonCode: isSnapshotData
      ? 'legacy_snapshot_embedded_offline_backup'
      : isDiscardedContextGraph
        ? 'legacy_context_graph_offline_rebuild'
        : 'legacy_task_dependency_embedded_offline_export',
    targetRefs: [],
    exportRef: `legacy-export/${subject.database}/${subject.table}/${legacyClassificationSourceKey(subject)}`,
    blockerCode: null,
  };
}

function memberEvidencePath(member: LegacyEmbeddedJsonMember): string {
  let path = `$.${member.column}`;
  for (const segment of member.memberPath) {
    path += typeof segment === 'number' ? `[${segment}]` : `.${segment}`;
  }
  return path;
}

function isPathPrefix(prefix: string, path: string): boolean {
  if (prefix === path) return true;
  if (!path.startsWith(prefix)) return false;
  const next = path[prefix.length];
  return next === '.' || next === '[';
}

function uniqueTargetRefs(
  refs: readonly LegacyClassificationTargetRefInput[],
): readonly LegacyClassificationTargetRefInput[] {
  const byHash = new Map(refs.map((ref) => [hashCanonical(ref), ref] as const));
  return [...byHash.values()].sort(
    (left, right) =>
      compareText(left.authority, right.authority) ||
      compareText(left.id, right.id) ||
      compareText(left.projectId ?? '', right.projectId ?? '') ||
      compareText(left.cloneOf ?? '', right.cloneOf ?? ''),
  );
}

function ownershipEmbeddedEntries(
  members: readonly LegacyEmbeddedJsonMember[],
  ownership: LegacyProjectOwnershipGraphReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!ownership) return [];
  const assignments = new Map(
    ownership.assignments.map((assignment) => [assignment.sourceKey, assignment] as const),
  );
  const entries: LegacyClassificationEntryInput[] = [];
  for (const member of members) {
    if (
      member.database !== 'main' ||
      member.table !== 'canvas_nodes' ||
      member.column !== 'data_json'
    ) {
      continue;
    }
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const assignment = assignments.get(rowSourceKey);
    if (!assignment) continue;
    const path = memberEvidencePath(member);
    if (member.memberPath.length === 0) {
      if (assignment.blockerCode !== null) {
        entries.push({
          subject: member.subject,
          disposition: 'blocking_error',
          reasonCode: assignment.blockerCode,
          targetRefs: [],
          exportRef: null,
          blockerCode: assignment.blockerCode,
        });
      } else if (assignment.targetRefs.length > 0) {
        entries.push({
          subject: member.subject,
          disposition: 'migrated_current_state',
          reasonCode: 'legacy_canvas_node_data_container',
          targetRefs: assignment.targetRefs,
          exportRef: null,
          blockerCode: null,
        });
      }
      continue;
    }

    const relatedBlocker = ownership.blockers
      .filter(
        (blocker) =>
          blocker.sourceKey === rowSourceKey &&
          blocker.evidencePath.startsWith('$.data_json') &&
          (isPathPrefix(path, blocker.evidencePath) || isPathPrefix(blocker.evidencePath, path)),
      )
      .sort((left, right) => compareText(left.blockerCode, right.blockerCode))[0];
    if (relatedBlocker) {
      entries.push({
        subject: member.subject,
        disposition: 'blocking_error',
        reasonCode: relatedBlocker.blockerCode,
        targetRefs: [],
        exportRef: null,
        blockerCode: relatedBlocker.blockerCode,
      });
      continue;
    }

    const refs = ownership.claims.flatMap((claim) => {
      const hasMatchingEvidence = claim.evidenceRefs.some(
        (evidence) => evidence.sourceKey === rowSourceKey && isPathPrefix(path, evidence.path),
      );
      if (
        (claim.kind !== 'node_entity_ref' && claim.kind !== 'node_generation_history_entity_ref') ||
        !hasMatchingEvidence
      ) {
        return [];
      }
      const target = assignments.get(claim.sourceKey);
      return target?.targetRefs.filter(({ projectId }) => projectId === claim.projectId) ?? [];
    });
    const targetRefs = uniqueTargetRefs(refs);
    if (targetRefs.length > 0) {
      entries.push({
        subject: member.subject,
        disposition: 'migrated_current_state',
        reasonCode: 'legacy_typed_canvas_entity_reference',
        targetRefs,
        exportRef: null,
        blockerCode: null,
      });
    }
  }
  return entries;
}

function classifyGlobalMediaAssetTagMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  const documents = new Map<string, LegacyEmbeddedJsonMember[]>();
  for (const member of members) {
    if (
      member.database !== 'main' ||
      member.table !== 'asset_entries' ||
      member.column !== 'tags'
    ) {
      continue;
    }
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const document = documents.get(rowSourceKey);
    if (document) document.push(member);
    else documents.set(rowSourceKey, [member]);
  }

  const entries: LegacyClassificationEntryInput[] = [];
  for (const rowSourceKey of [...documents.keys()].sort(compareText)) {
    const document = documents.get(rowSourceKey);
    if (!document) throw new Error('Legacy GlobalMediaAsset tag document disappeared');
    const rootEntry = rootEntries.get(rowSourceKey);
    if (!rootEntry) continue;
    if (rootEntry.disposition === 'blocking_error') {
      if (rootEntry.blockerCode === null) {
        throw new Error('Blocking Legacy GlobalMediaAsset row has no blocker code');
      }
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_global_media_asset_tags_owner_blocked',
          targetRefs: [],
          exportRef: null,
          blockerCode: rootEntry.blockerCode,
        })),
      );
      continue;
    }

    const targetRefs = rootEntry.targetRefs.filter(
      ({ authority, projectId, cloneOf }) =>
        authority === 'global_media_asset' && projectId === null && cloneOf === null,
    );
    if (
      rootEntry.disposition !== 'migrated_current_state' ||
      rootEntry.targetRefs.length !== 1 ||
      targetRefs.length !== 1
    ) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_global_media_asset_tags_owner_unresolved',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'unresolved_global_media_asset_tags_owner',
        })),
      );
      continue;
    }

    const rootMember = document.find(({ memberPath }) => memberPath.length === 0);
    if (!rootMember) throw new Error('Legacy GlobalMediaAsset tag document has no root member');
    if (!GlobalMediaTagsSchema.safeParse(rootMember.value).success) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'invalid_legacy_global_media_asset_tags',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'invalid_global_media_asset_tags',
        })),
      );
      continue;
    }

    const target = targetRefs[0];
    if (!target) throw new Error('Legacy GlobalMediaAsset tag target disappeared');
    entries.push(
      ...document.map(({ subject }): LegacyClassificationEntryInput => ({
        subject,
        disposition: 'migrated_current_state',
        reasonCode: 'legacy_global_media_asset_tags',
        targetRefs: [{ authority: target.authority, id: target.id, projectId: target.projectId }],
        exportRef: null,
        blockerCode: null,
      })),
    );
  }
  return entries;
}

function validLegacyCanvasViewport(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const viewport = value as Record<string, unknown>;
  const keys = Object.keys(viewport).sort(compareText);
  if (keys.length !== 3 || keys[0] !== 'x' || keys[1] !== 'y' || keys[2] !== 'zoom') return false;
  return [viewport.x, viewport.y, viewport.zoom].every(
    (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
  );
}

function classifyCanvasViewportMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  const documents = new Map<string, LegacyEmbeddedJsonMember[]>();
  for (const member of members) {
    if (member.database !== 'main' || member.table !== 'canvases' || member.column !== 'viewport') {
      continue;
    }
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const document = documents.get(rowSourceKey);
    if (document) document.push(member);
    else documents.set(rowSourceKey, [member]);
  }

  const entries: LegacyClassificationEntryInput[] = [];
  for (const rowSourceKey of [...documents.keys()].sort(compareText)) {
    const document = documents.get(rowSourceKey);
    if (!document) throw new Error('Legacy Canvas viewport document disappeared');
    const rootEntry = rootEntries.get(rowSourceKey);
    if (!rootEntry) continue;
    if (rootEntry.disposition === 'blocking_error') {
      if (rootEntry.blockerCode === null) {
        throw new Error('Blocking Legacy Canvas row has no blocker code');
      }
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_canvas_viewport_owner_blocked',
          targetRefs: [],
          exportRef: null,
          blockerCode: rootEntry.blockerCode,
        })),
      );
      continue;
    }

    const targetRefs = rootEntry.targetRefs.filter(
      ({ authority, projectId, cloneOf }) =>
        authority === 'canvas' && projectId !== null && cloneOf === null,
    );
    if (rootEntry.disposition !== 'migrated_current_state' || targetRefs.length !== 1) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_canvas_viewport_owner_unresolved',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'unresolved_canvas_viewport_owner',
        })),
      );
      continue;
    }

    const rootMember = document.find(({ memberPath }) => memberPath.length === 0);
    if (!rootMember) throw new Error('Legacy Canvas viewport document has no root member');
    if (!validLegacyCanvasViewport(rootMember.value)) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'invalid_legacy_canvas_viewport',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'invalid_canvas_viewport',
        })),
      );
      continue;
    }

    entries.push(
      ...document.map(({ subject }): LegacyClassificationEntryInput => ({
        subject,
        disposition: 'blocking_error',
        reasonCode: 'legacy_canvas_viewport_coordinate_mapping_unfrozen',
        targetRefs: [],
        exportRef: null,
        blockerCode: 'unresolved_canvas_viewport_coordinate_mapping',
      })),
    );
  }
  return entries;
}

function legacyIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function legacyCanvasNoteIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 50_000) return null;
  const ids: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return null;
    }
    const note = candidate as Record<string, unknown>;
    const keys = Object.keys(note).sort(compareText);
    if (
      keys.length !== 4 ||
      keys[0] !== 'content' ||
      keys[1] !== 'createdAt' ||
      keys[2] !== 'id' ||
      keys[3] !== 'updatedAt'
    ) {
      return null;
    }
    const createdAt = legacyIsoTimestamp(note.createdAt);
    const updatedAt = legacyIsoTimestamp(note.updatedAt);
    if (createdAt === null || updatedAt === null) return null;
    const annotation = CanvasAnnotationSchema.safeParse({
      id: note.id,
      placementId: null,
      text: note.content,
      geometry: null,
      revision: 0,
      createdAt,
      updatedAt,
    });
    if (!annotation.success) return null;
    ids.push(annotation.data.id);
  }
  return ids;
}

function classifyCanvasNoteMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  const documents = new Map<string, LegacyEmbeddedJsonMember[]>();
  for (const member of members) {
    if (member.database !== 'main' || member.table !== 'canvases' || member.column !== 'notes') {
      continue;
    }
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const document = documents.get(rowSourceKey);
    if (document) document.push(member);
    else documents.set(rowSourceKey, [member]);
  }

  const noteIdsByRow = new Map<string, readonly string[] | null>();
  const identityCounts = new Map<string, number>();
  for (const [rowSourceKey, document] of documents) {
    const rootMember = document.find(({ memberPath }) => memberPath.length === 0);
    if (!rootMember) throw new Error('Legacy Canvas notes document has no root member');
    const noteIds = legacyCanvasNoteIds(rootMember.value);
    noteIdsByRow.set(rowSourceKey, noteIds);
    const rootEntry = rootEntries.get(rowSourceKey);
    const hasCurrentCanvasOwner =
      rootEntry?.disposition === 'migrated_current_state' &&
      rootEntry.targetRefs.filter(
        ({ authority, projectId, cloneOf }) =>
          authority === 'canvas' && projectId !== null && cloneOf === null,
      ).length === 1;
    if (!hasCurrentCanvasOwner) continue;
    for (const id of noteIds ?? []) {
      identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1);
    }
  }

  const entries: LegacyClassificationEntryInput[] = [];
  for (const rowSourceKey of [...documents.keys()].sort(compareText)) {
    const document = documents.get(rowSourceKey);
    if (!document) throw new Error('Legacy Canvas notes document disappeared');
    const rootEntry = rootEntries.get(rowSourceKey);
    if (!rootEntry) continue;
    if (rootEntry.disposition === 'blocking_error') {
      if (rootEntry.blockerCode === null) {
        throw new Error('Blocking Legacy Canvas row has no blocker code');
      }
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_canvas_notes_owner_blocked',
          targetRefs: [],
          exportRef: null,
          blockerCode: rootEntry.blockerCode,
        })),
      );
      continue;
    }

    const targetRefs = rootEntry.targetRefs.filter(
      ({ authority, projectId, cloneOf }) =>
        authority === 'canvas' && projectId !== null && cloneOf === null,
    );
    if (rootEntry.disposition !== 'migrated_current_state' || targetRefs.length !== 1) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_canvas_notes_owner_unresolved',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'unresolved_canvas_notes_owner',
        })),
      );
      continue;
    }

    const noteIds = noteIdsByRow.get(rowSourceKey);
    if (noteIds === null || noteIds === undefined) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'invalid_legacy_canvas_notes',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'invalid_canvas_notes',
        })),
      );
      continue;
    }
    if (noteIds.some((id) => identityCounts.get(id) !== 1)) {
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'duplicate_legacy_canvas_annotation_identity',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'duplicate_canvas_annotation_id',
        })),
      );
      continue;
    }

    const target = targetRefs[0];
    if (!target) throw new Error('Legacy Canvas notes target disappeared');
    entries.push(
      ...document.map(({ subject }): LegacyClassificationEntryInput => ({
        subject,
        disposition: 'migrated_current_state',
        reasonCode: 'legacy_canvas_notes_annotations',
        targetRefs: [{ authority: target.authority, id: target.id, projectId: target.projectId }],
        exportRef: null,
        blockerCode: null,
      })),
    );
  }
  return entries;
}

function classifyLegacySkillEmbeddedMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  const membersByRow = new Map<string, LegacyEmbeddedJsonMember[]>();
  for (const member of members) {
    const isPresetContent =
      member.database === 'main' &&
      member.table === 'preset_overrides' &&
      (member.column === 'defaults' || member.column === 'params');
    const isShotTemplateContent =
      member.database === 'main' &&
      member.table === 'custom_shot_templates' &&
      member.column === 'tracks_json';
    if (!isPresetContent && !isShotTemplateContent) continue;
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const rowMembers = membersByRow.get(rowSourceKey);
    if (rowMembers) rowMembers.push(member);
    else membersByRow.set(rowSourceKey, [member]);
  }

  const entries: LegacyClassificationEntryInput[] = [];
  for (const rowSourceKey of [...membersByRow.keys()].sort(compareText)) {
    const rowMembers = membersByRow.get(rowSourceKey);
    if (!rowMembers) throw new Error('Legacy Skill embedded source row disappeared');
    const rootEntry = rootEntries.get(rowSourceKey);
    if (!rootEntry) continue;
    if (rootEntry.disposition === 'blocking_error') {
      if (rootEntry.blockerCode === null) {
        throw new Error('Blocking Legacy Skill row has no blocker code');
      }
      entries.push(
        ...rowMembers.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_skill_embedded_owner_blocked',
          targetRefs: [],
          exportRef: null,
          blockerCode: rootEntry.blockerCode,
        })),
      );
      continue;
    }

    const targetRefs = rootEntry.targetRefs.filter(
      ({ authority, projectId, cloneOf }) =>
        authority === 'skill' && projectId === null && cloneOf === null,
    );
    if (
      rootEntry.disposition !== 'migrated_current_state' ||
      rootEntry.targetRefs.length !== 1 ||
      targetRefs.length !== 1
    ) {
      entries.push(
        ...rowMembers.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_skill_embedded_owner_unresolved',
          targetRefs: [],
          exportRef: null,
          blockerCode: 'unresolved_legacy_skill_embedded_owner',
        })),
      );
      continue;
    }

    const target = targetRefs[0];
    if (!target) throw new Error('Legacy Skill embedded target disappeared');
    entries.push(
      ...rowMembers.map(({ subject }): LegacyClassificationEntryInput => ({
        subject,
        disposition: 'migrated_current_state',
        reasonCode: 'legacy_skill_embedded_source_content',
        targetRefs: [{ authority: target.authority, id: target.id, projectId: target.projectId }],
        exportRef: null,
        blockerCode: null,
      })),
    );
  }
  return entries;
}

function classifyLegacyProjectSettingMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  const membersByRow = new Map<string, LegacyEmbeddedJsonMember[]>();
  for (const member of members) {
    if (
      member.database !== 'main' ||
      member.table !== 'project_settings' ||
      member.column !== 'value'
    ) {
      continue;
    }
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const rowMembers = membersByRow.get(rowSourceKey);
    if (rowMembers) rowMembers.push(member);
    else membersByRow.set(rowSourceKey, [member]);
  }

  const entries: LegacyClassificationEntryInput[] = [];
  for (const rowSourceKey of [...membersByRow.keys()].sort(compareText)) {
    const rowMembers = membersByRow.get(rowSourceKey);
    if (!rowMembers) throw new Error('Legacy Project settings embedded row disappeared');
    const rootEntry = rootEntries.get(rowSourceKey);
    if (!rootEntry) continue;

    if (rootEntry.disposition === 'offline_legacy_export') {
      entries.push(
        ...rowMembers.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'offline_legacy_export',
          reasonCode: 'legacy_project_setting_embedded_offline_export',
          targetRefs: [],
          exportRef: `legacy-export/main/project_settings/${legacyClassificationSourceKey(subject)}`,
          blockerCode: null,
        })),
      );
      continue;
    }

    if (rootEntry.disposition === 'blocking_error') {
      if (rootEntry.blockerCode === null) {
        throw new Error('Blocking Legacy Project settings row has no blocker code');
      }
      entries.push(
        ...rowMembers.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'blocking_error',
          reasonCode: 'legacy_project_setting_embedded_owner_blocked',
          targetRefs: [],
          exportRef: null,
          blockerCode: rootEntry.blockerCode,
        })),
      );
      continue;
    }

    entries.push(
      ...rowMembers.map(({ subject }): LegacyClassificationEntryInput => ({
        subject,
        disposition: 'blocking_error',
        reasonCode: 'legacy_project_setting_embedded_owner_unresolved',
        targetRefs: [],
        exportRef: null,
        blockerCode: 'unresolved_legacy_project_setting_owner',
      })),
    );
  }
  return entries;
}

function classifyLegacyColorStyleMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  const columns = new Set(['exposure', 'gradients', 'palette', 'tags']);
  return members.flatMap((member): readonly LegacyClassificationEntryInput[] => {
    if (
      member.database !== 'main' ||
      member.table !== 'color_styles' ||
      !columns.has(member.column)
    ) {
      return [];
    }
    const rootEntry = rootEntries.get(legacyClassificationSourceKey(member.rowSubject));
    if (!rootEntry) return [];
    if (rootEntry.disposition === 'offline_legacy_export') {
      return [
        {
          subject: member.subject,
          disposition: 'offline_legacy_export',
          reasonCode: 'legacy_color_style_embedded_offline_export',
          targetRefs: [],
          exportRef: `legacy-export/main/color_styles/${legacyClassificationSourceKey(member.subject)}`,
          blockerCode: null,
        },
      ];
    }
    const blockerCode = rootEntry.blockerCode ?? 'unresolved_legacy_color_style_owner';
    return [
      {
        subject: member.subject,
        disposition: 'blocking_error',
        reasonCode:
          rootEntry.disposition === 'blocking_error'
            ? 'legacy_color_style_embedded_owner_blocked'
            : 'legacy_color_style_embedded_owner_unresolved',
        targetRefs: [],
        exportRef: null,
        blockerCode,
      },
    ];
  });
}

interface LegacyCommanderSessionPublicMessage {
  readonly id: string;
  readonly sequence: number;
  readonly role: 'user';
  readonly status: 'accepted';
  readonly originatingRunId: null;
  readonly blocks: readonly [{ readonly type: 'text'; readonly text: string }];
  readonly attachments: readonly [];
  readonly supersedesMessageId: null;
  readonly createdAt: string;
}

type LegacyCommanderSessionMessageTranscript =
  | Readonly<{
      kind: 'valid';
      hasAssistantMessage: boolean;
      hasUnmappedUserMessageFields: boolean;
      publicMessages: readonly LegacyCommanderSessionPublicMessage[];
    }>
  | Readonly<{ kind: 'invalid_core' }>
  | Readonly<{ kind: 'duplicate_id' }>;

function classifyLegacyCommanderSessionMessageTranscript(
  value: unknown,
): LegacyCommanderSessionMessageTranscript {
  if (!Array.isArray(value) || value.length > MAX_LEGACY_COMMANDER_SESSION_MESSAGES) {
    return { kind: 'invalid_core' };
  }
  const ids = new Set<string>();
  let hasAssistantMessage = false;
  let hasUnmappedUserMessageFields = false;
  const publicMessages: LegacyCommanderSessionPublicMessage[] = [];
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { kind: 'invalid_core' };
    }
    const message = candidate as Record<string, unknown>;
    const createdAt = legacyIsoTimestamp(message.timestamp);
    if (
      typeof message.id !== 'string' ||
      !EntityIdSchema.safeParse(message.id).success ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      message.content.length === 0 ||
      message.content.length > 200_000 ||
      createdAt === null
    ) {
      return { kind: 'invalid_core' };
    }
    if (ids.has(message.id)) return { kind: 'duplicate_id' };
    ids.add(message.id);
    hasAssistantMessage ||= message.role === 'assistant';
    if (message.role === 'user') {
      hasUnmappedUserMessageFields ||=
        Object.keys(message).some(
          (field) => field !== 'id' && field !== 'role' && field !== 'content' && field !== 'timestamp',
        );
      publicMessages.push({
        id: message.id,
        sequence: index + 1,
        role: 'user',
        status: 'accepted',
        originatingRunId: null,
        blocks: [{ type: 'text', text: message.content }],
        attachments: [],
        supersedesMessageId: null,
        createdAt,
      });
    }
  }
  return { kind: 'valid', hasAssistantMessage, hasUnmappedUserMessageFields, publicMessages };
}

function commanderSessionMessageBlockingEntries(
  document: readonly LegacyEmbeddedJsonMember[],
  reasonCode: string,
  blockerCode: string,
): readonly LegacyClassificationEntryInput[] {
  return document.map(({ subject }): LegacyClassificationEntryInput => ({
    subject,
    disposition: 'blocking_error',
    reasonCode,
    targetRefs: [],
    exportRef: null,
    blockerCode,
  }));
}

interface MigratableCommanderSessionMessageDocument {
  readonly sourceKey: string;
  readonly document: readonly LegacyEmbeddedJsonMember[];
  readonly chatId: string;
  readonly projectId: string;
  readonly publicMessages: readonly LegacyCommanderSessionPublicMessage[];
}

function migratedCommanderSessionMessageEntries(
  candidate: MigratableCommanderSessionMessageDocument,
): readonly LegacyClassificationEntryInput[] {
  const messageTargetRefs = candidate.publicMessages.map(({ id }) => ({
    authority: 'message',
    id,
    projectId: candidate.projectId,
  }));
  return candidate.document.map(({ subject, memberPath }): LegacyClassificationEntryInput => {
    if (memberPath.length === 0) {
      return {
        subject,
        disposition: 'migrated_current_state',
        reasonCode: 'legacy_commander_session_public_messages',
        targetRefs: [
          { authority: 'chat', id: candidate.chatId, projectId: candidate.projectId },
          ...messageTargetRefs,
        ],
        exportRef: null,
        blockerCode: null,
      };
    }
    const messageIndex = memberPath[0];
    const message =
      typeof messageIndex === 'number' ? candidate.publicMessages[messageIndex] : undefined;
    if (!message) throw new Error('Legacy Commander session message member has no public Message');
    return {
      subject,
      disposition: 'migrated_current_state',
      reasonCode: 'legacy_commander_session_public_messages',
      targetRefs: [{ authority: 'message', id: message.id, projectId: candidate.projectId }],
      exportRef: null,
      blockerCode: null,
    };
  });
}

function classifyLegacyCommanderSessionMessageMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
  ownership: LegacyProjectOwnershipGraphReport | undefined,
): readonly LegacyClassificationEntryInput[] {
  const rootEntries = new Map(
    (rootClassification?.entries ?? []).map((entry) => [entry.sourceKey, entry] as const),
  );
  const ownershipAssignments = new Map(
    (ownership?.assignments ?? []).map((assignment) => [assignment.sourceKey, assignment] as const),
  );
  const documents = new Map<string, LegacyEmbeddedJsonMember[]>();
  for (const member of members) {
    if (
      member.database !== 'main' ||
      member.table !== 'commander_sessions' ||
      member.column !== 'messages'
    ) {
      continue;
    }
    const rowSourceKey = legacyClassificationSourceKey(member.rowSubject);
    const document = documents.get(rowSourceKey);
    if (document) document.push(member);
    else documents.set(rowSourceKey, [member]);
  }

  const entries: LegacyClassificationEntryInput[] = [];
  const migratableDocuments: MigratableCommanderSessionMessageDocument[] = [];
  for (const rowSourceKey of [...documents.keys()].sort(compareText)) {
    const document = documents.get(rowSourceKey);
    if (!document) throw new Error('Legacy Commander session message document disappeared');
    const rootEntry = rootEntries.get(rowSourceKey);
    const ownershipAssignment = ownershipAssignments.get(rowSourceKey);
    const ownerBlockerCode =
      rootEntry?.disposition === 'blocking_error'
        ? rootEntry.blockerCode
        : ownershipAssignment?.disposition === 'blocking_error'
          ? ownershipAssignment.blockerCode
          : null;
    if (ownerBlockerCode !== null) {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          document,
          'legacy_commander_session_messages_owner_blocked',
          ownerBlockerCode,
        ),
      );
      continue;
    }

    const rootMember = document.find(({ memberPath }) => memberPath.length === 0);
    if (!rootMember)
      throw new Error('Legacy Commander session message document has no root member');
    const transcript = classifyLegacyCommanderSessionMessageTranscript(rootMember.value);
    if (transcript.kind === 'invalid_core') {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          document,
          'invalid_legacy_commander_session_messages_core',
          'invalid_legacy_commander_session_messages_core',
        ),
      );
      continue;
    }
    if (transcript.kind === 'duplicate_id') {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          document,
          'duplicate_legacy_commander_session_message_id',
          'duplicate_legacy_commander_session_message_id',
        ),
      );
      continue;
    }
    if (transcript.hasAssistantMessage) {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          document,
          'legacy_assistant_message_target_originating_run_provenance_unfrozen',
          'legacy_assistant_message_origin_unresolved',
        ),
      );
      continue;
    }
    if (rootEntry?.disposition === 'offline_legacy_export') {
      if (rootEntry.exportRef === null) {
        throw new Error('Offline Legacy Commander session owner has no export reference');
      }
      entries.push(
        ...document.map(({ subject }): LegacyClassificationEntryInput => ({
          subject,
          disposition: 'offline_legacy_export',
          reasonCode: 'legacy_commander_session_messages_offline_export',
          targetRefs: [],
          exportRef: rootEntry.exportRef,
          blockerCode: null,
        })),
      );
      continue;
    }

    const rootChatRefs = rootEntry?.targetRefs.filter(
      ({ authority, projectId, cloneOf }) =>
        authority === 'chat' && projectId !== null && cloneOf === null,
    );
    const rootChatRef = rootChatRefs?.length === 1 ? rootChatRefs[0] : undefined;
    if (rootEntry?.disposition !== 'migrated_current_state' || !rootChatRef) {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          document,
          'legacy_commander_session_messages_owner_unresolved',
          'unresolved_legacy_commander_session_messages_owner',
        ),
      );
      continue;
    }
    if (rootChatRef.projectId === null) {
      throw new Error('Migrated Legacy Commander session Chat has no Project');
    }
    if (transcript.hasUnmappedUserMessageFields) {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          document,
          'legacy_commander_session_user_message_fields_unmapped',
          'legacy_commander_session_user_message_fields_unmapped',
        ),
      );
      continue;
    }
    migratableDocuments.push({
      sourceKey: rowSourceKey,
      document,
      chatId: rootChatRef.id,
      projectId: rootChatRef.projectId,
      publicMessages: transcript.publicMessages,
    });
  }

  const sourcesByMessageId = new Map<string, Set<string>>();
  for (const candidate of migratableDocuments) {
    for (const { id } of candidate.publicMessages) {
      const sources = sourcesByMessageId.get(id) ?? new Set<string>();
      sources.add(candidate.sourceKey);
      sourcesByMessageId.set(id, sources);
    }
  }
  const duplicateMessageIds = new Set(
    [...sourcesByMessageId]
      .filter(([, sources]) => sources.size > 1)
      .map(([messageId]) => messageId),
  );
  for (const candidate of migratableDocuments) {
    if (candidate.publicMessages.some(({ id }) => duplicateMessageIds.has(id))) {
      entries.push(
        ...commanderSessionMessageBlockingEntries(
          candidate.document,
          'duplicate_legacy_commander_session_message_id',
          'duplicate_legacy_commander_session_message_id',
        ),
      );
      continue;
    }
    entries.push(...migratedCommanderSessionMessageEntries(candidate));
  }
  return entries;
}

function classifyRootBoundBlockingMembers(
  members: readonly LegacyEmbeddedJsonMember[],
  rootClassification: LegacyClassificationReport | undefined,
  policy: Readonly<{
    table: string;
    columns: readonly string[];
    blockedReasonCode: string;
    unresolvedReasonCode: string;
    unresolvedBlockerCode: string;
  }>,
): readonly LegacyClassificationEntryInput[] {
  if (!rootClassification) return [];
  const rootEntries = new Map(
    rootClassification.entries.map((entry) => [entry.sourceKey, entry] as const),
  );
  return members.flatMap((member): readonly LegacyClassificationEntryInput[] => {
    if (
      member.database !== 'main' ||
      member.table !== policy.table ||
      !policy.columns.includes(member.column)
    ) {
      return [];
    }
    const rootEntry = rootEntries.get(legacyClassificationSourceKey(member.rowSubject));
    if (!rootEntry) return [];
    return [
      {
        subject: member.subject,
        disposition: 'blocking_error',
        reasonCode:
          rootEntry.disposition === 'blocking_error'
            ? policy.blockedReasonCode
            : policy.unresolvedReasonCode,
        targetRefs: [],
        exportRef: null,
        blockerCode: rootEntry.blockerCode ?? policy.unresolvedBlockerCode,
      },
    ];
  });
}

/**
 * Builds the independent embedded-member report. Invalid documents and
 * explicitly frozen column policies receive blocking dispositions; other
 * valid members remain visibly unclassified until an owner maps them.
 */
export function classifyLegacyEmbeddedJsonMembers(
  databases: LegacySourceDatabases,
  expected: LegacySourceExpectedSchemas,
  options: LegacyEmbeddedJsonClassificationOptions = {},
): LegacyEmbeddedJsonClassificationReport {
  const members: LegacyEmbeddedJsonMember[] = [];
  const sources = options.sources ?? LEGACY_EMBEDDED_JSON_SOURCES;
  const inventory =
    options.classifyMembers ||
    options.ownership ||
    options.rootClassification ||
    sources.some(
      ({ database, table, columns }) =>
        database === 'main' && table === 'commander_sessions' && columns.includes('messages'),
    )
      ? scanLegacyEmbeddedJsonMembersForClassification(
          databases,
          expected,
          (member) => members.push(member),
          sources,
        )
      : enumerateLegacyEmbeddedJsonClassificationSubjects(databases, expected, sources);
  const invalidDocuments = new Map(
    inventory.issues.map(({ subject, reason }) => [documentKey(subject), reason] as const),
  );
  const invalidEntries: LegacyClassificationEntryInput[] = inventory.subjects.flatMap((subject) => {
    const reason = invalidDocuments.get(documentKey(subject));
    if (!reason) return [];
    return [
      {
        subject,
        disposition: 'blocking_error',
        reasonCode: 'invalid_legacy_embedded_json_document',
        targetRefs: [],
        exportRef: null,
        blockerCode:
          reason === 'not_text'
            ? 'legacy_embedded_json_document_not_text'
            : reason === 'invalid_json'
              ? 'legacy_embedded_json_document_invalid_json'
              : reason === 'duplicate_object_key'
                ? 'legacy_embedded_json_duplicate_object_key'
                : 'legacy_embedded_json_uninspectable_structure',
      },
    ];
  });
  const invalidSourceKeys = new Set(
    invalidEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const offlineEntries = inventory.subjects.flatMap((subject) => {
    if (invalidSourceKeys.has(legacyClassificationSourceKey(subject))) return [];
    const entry = offlineEmbeddedEntry(subject);
    return entry ? [entry] : [];
  });
  const offlineSourceKeys = new Set(
    offlineEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  if (options.ownership && options.ownership.sourceFingerprint !== inventory.sourceFingerprint) {
    throw new Error('Legacy embedded JSON ownership inspected a different source snapshot');
  }
  if (
    options.rootClassification &&
    options.rootClassification.sourceFingerprint !== inventory.sourceFingerprint
  ) {
    throw new Error(
      'Legacy embedded JSON root classification inspected a different source snapshot',
    );
  }
  const ownershipEntries = ownershipEmbeddedEntries(members, options.ownership).filter(
    ({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)),
  );
  const ownershipSourceKeys = new Set(
    ownershipEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const globalMediaAssetTagEntries = classifyGlobalMediaAssetTagMembers(
    members,
    options.rootClassification,
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const globalMediaAssetTagSourceKeys = new Set(
    globalMediaAssetTagEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const canvasViewportEntries = classifyCanvasViewportMembers(
    members,
    options.rootClassification,
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const canvasViewportSourceKeys = new Set(
    canvasViewportEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const canvasNoteEntries = classifyCanvasNoteMembers(members, options.rootClassification).filter(
    ({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)),
  );
  const canvasNoteSourceKeys = new Set(
    canvasNoteEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const legacySkillEmbeddedEntries = classifyLegacySkillEmbeddedMembers(
    members,
    options.rootClassification,
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const legacySkillEmbeddedSourceKeys = new Set(
    legacySkillEmbeddedEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const projectSettingEntries = classifyLegacyProjectSettingMembers(
    members,
    options.rootClassification,
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const projectSettingSourceKeys = new Set(
    projectSettingEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const colorStyleEntries = classifyLegacyColorStyleMembers(
    members,
    options.rootClassification,
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const colorStyleSourceKeys = new Set(
    colorStyleEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const commanderSessionMessageEntries = classifyLegacyCommanderSessionMessageMembers(
    members,
    options.rootClassification,
    options.ownership,
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const commanderSessionMessageSourceKeys = new Set(
    commanderSessionMessageEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const promptAssemblyEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'prompt_assemblies',
      columns: [
        'authority_json',
        'conditioning_manifest_json',
        'host_constraints_json',
        'input_json',
        'output_json',
        'provider_profile_json',
        'sources_json',
      ],
      blockedReasonCode: 'legacy_prompt_assembly_embedded_owner_blocked',
      unresolvedReasonCode: 'legacy_prompt_assembly_target_mapping_unfrozen',
      unresolvedBlockerCode: 'legacy_prompt_assembly_target_mapping_unfrozen',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const promptAssemblySourceKeys = new Set(
    promptAssemblyEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const commanderEventEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'commander_events',
      columns: ['payload'],
      blockedReasonCode: 'legacy_commander_event_payload_owner_blocked',
      unresolvedReasonCode: 'legacy_commander_event_payload_unmappable',
      unresolvedBlockerCode: 'legacy_commander_event_unmappable',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const commanderEventSourceKeys = new Set(
    commanderEventEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const taskEventEntries = classifyRootBoundBlockingMembers(members, options.rootClassification, {
    table: 'task_events',
    columns: ['payload_json'],
    blockedReasonCode: 'legacy_task_event_payload_owner_blocked',
    unresolvedReasonCode: 'legacy_task_event_run_owner_unresolved',
    unresolvedBlockerCode: 'legacy_task_event_run_owner_unresolved',
  }).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const taskEventSourceKeys = new Set(
    taskEventEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const taskDecisionEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'task_decisions',
      columns: ['options_json'],
      blockedReasonCode: 'legacy_task_decision_options_owner_blocked',
      unresolvedReasonCode: 'legacy_task_decision_interaction_identity_unresolved',
      unresolvedBlockerCode: 'legacy_task_decision_interaction_identity_unresolved',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const taskDecisionSourceKeys = new Set(
    taskDecisionEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const taskArtifactEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'task_artifacts',
      columns: ['metadata_json'],
      blockedReasonCode: 'legacy_task_artifact_embedded_owner_blocked',
      unresolvedReasonCode: 'legacy_task_artifact_target_mapping_unfrozen',
      unresolvedBlockerCode: 'legacy_task_artifact_target_mapping_unfrozen',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const taskArtifactSourceKeys = new Set(
    taskArtifactEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const taskAttemptEntries = classifyRootBoundBlockingMembers(members, options.rootClassification, {
    table: 'task_attempts',
    columns: [
      'generation_spec_json',
      'input_json',
      'metadata_json',
      'output_json',
      'repair_delta_json',
    ],
    blockedReasonCode: 'legacy_task_attempt_embedded_owner_blocked',
    unresolvedReasonCode: 'legacy_task_attempt_target_mapping_unfrozen',
    unresolvedBlockerCode: 'legacy_task_attempt_target_mapping_unfrozen',
  }).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const taskAttemptSourceKeys = new Set(
    taskAttemptEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const taskEvaluationEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'task_evaluations',
      columns: [
        'evidence_json',
        'frame_evidence_json',
        'metadata_json',
        'repair_delta_json',
        'risks_json',
        'scores_json',
        'strengths_json',
      ],
      blockedReasonCode: 'legacy_task_evaluation_embedded_owner_blocked',
      unresolvedReasonCode: 'legacy_task_evaluation_target_mapping_unfrozen',
      unresolvedBlockerCode: 'legacy_task_evaluation_target_mapping_unfrozen',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const taskEvaluationSourceKeys = new Set(
    taskEvaluationEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const deliverySequenceEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'canvases',
      columns: ['delivery_sequence_json'],
      blockedReasonCode: 'legacy_delivery_sequence_owner_blocked',
      unresolvedReasonCode: 'legacy_delivery_target_identity_unresolved',
      unresolvedBlockerCode: 'legacy_delivery_target_identity_unresolved',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const deliverySequenceSourceKeys = new Set(
    deliverySequenceEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const planDocumentEntries = classifyRootBoundBlockingMembers(
    members,
    options.rootClassification,
    {
      table: 'plan_documents',
      columns: ['content_json'],
      blockedReasonCode: 'legacy_plan_document_content_owner_blocked',
      unresolvedReasonCode: 'legacy_plan_document_target_mapping_unfrozen',
      unresolvedBlockerCode: 'legacy_plan_target_mapping_unfrozen',
    },
  ).filter(({ subject }) => !invalidSourceKeys.has(legacyClassificationSourceKey(subject)));
  const planDocumentSourceKeys = new Set(
    planDocumentEntries.map(({ subject }) => legacyClassificationSourceKey(subject)),
  );
  const classification = buildLegacyClassificationReport({
    sourceFingerprint: inventory.fingerprint,
    subjects: inventory.subjects,
    entries: [
      ...invalidEntries,
      ...offlineEntries,
      ...ownershipEntries,
      ...globalMediaAssetTagEntries,
      ...canvasViewportEntries,
      ...canvasNoteEntries,
      ...legacySkillEmbeddedEntries,
      ...projectSettingEntries,
      ...colorStyleEntries,
      ...commanderSessionMessageEntries,
      ...promptAssemblyEntries,
      ...commanderEventEntries,
      ...taskEventEntries,
      ...taskDecisionEntries,
      ...taskArtifactEntries,
      ...taskAttemptEntries,
      ...taskEvaluationEntries,
      ...deliverySequenceEntries,
      ...planDocumentEntries,
      ...(options.classifyMembers?.(
        members.filter(
          ({ subject }) =>
            !invalidSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !offlineSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !ownershipSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !globalMediaAssetTagSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !canvasViewportSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !canvasNoteSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !legacySkillEmbeddedSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !projectSettingSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !colorStyleSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !commanderSessionMessageSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !promptAssemblySourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !commanderEventSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !taskEventSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !taskDecisionSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !taskArtifactSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !taskAttemptSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !taskEvaluationSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !deliverySequenceSourceKeys.has(legacyClassificationSourceKey(subject)) &&
            !planDocumentSourceKeys.has(legacyClassificationSourceKey(subject)),
        ),
      ) ?? []),
    ],
  });
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-embedded-json-classification/v1' as const,
    scope: 'embedded_json_members' as const,
    inventory,
    classification,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical({
      schema: withoutFingerprint.schema,
      scope: withoutFingerprint.scope,
      inventoryFingerprint: inventory.fingerprint,
      classificationReportHash: classification.reportHash,
    }),
    ok: classification.ok,
  };
}
