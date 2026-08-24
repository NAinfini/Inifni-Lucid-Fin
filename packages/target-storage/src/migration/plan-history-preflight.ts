import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DOCUMENT_STATUSES = new Set(['draft', 'active', 'superseded', 'invalidated']);
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'invalidated']);
const APPROVAL_GATES = new Set(['production_plan', 'visual_constitution', 'delivery']);

export const LEGACY_PLAN_HISTORY_PREFLIGHT_COVERAGE = {
  documents: {
    table: 'plan_documents',
    subject: ['task_list_id', 'logical_key', 'revision'],
    content: 'content_json',
    contentHash: 'content_hash',
  },
  approvals: {
    table: 'plan_approvals',
    group: ['task_list_id', 'gate_key'],
    subject: ['subject_logical_key', 'subject_revision', 'subject_hash'],
  },
  approvedHeadComparability: 'same_logical_key_ordered_by_revision',
} as const;

export interface LegacyPlanHistorySourceRows {
  readonly documents: readonly Readonly<Record<string, unknown>>[];
  readonly approvals: readonly Readonly<Record<string, unknown>>[];
}

interface BlockerLocation {
  readonly rowKey: string;
  readonly path: string;
}

export type LegacyPlanHistoryPreflightBlocker =
  | (BlockerLocation & {
      readonly kind: 'invalid_plan_document_field';
      readonly table: 'plan_documents';
      readonly reason:
        | 'empty_text'
        | 'invalid_positive_integer'
        | 'invalid_timestamp'
        | 'invalid_sha256'
        | 'unknown_status';
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_plan_document_content';
      readonly table: 'plan_documents';
      readonly path: '$.content_json';
      readonly reason:
        | 'not_text'
        | 'invalid_json'
        | 'not_object'
        | 'duplicate_object_key'
        | 'uninspectable_structure';
    })
  | (BlockerLocation & {
      readonly kind: 'plan_document_content_hash_mismatch';
      readonly table: 'plan_documents';
      readonly path: '$.content_hash';
    })
  | {
      readonly kind: 'duplicate_plan_document_subject';
      readonly table: 'plan_documents';
      readonly subjectKey: string;
      readonly rowKeys: readonly string[];
    }
  | {
      readonly kind: 'plan_document_lineage_type_drift';
      readonly table: 'plan_documents';
      readonly lineageKey: string;
      readonly rowKeys: readonly string[];
    }
  | (BlockerLocation & {
      readonly kind: 'invalid_plan_approval_field';
      readonly table: 'plan_approvals';
      readonly reason:
        | 'empty_text'
        | 'invalid_positive_integer'
        | 'invalid_timestamp'
        | 'invalid_sha256'
        | 'unknown_gate'
        | 'unknown_status'
        | 'decision_timestamp_mismatch';
    })
  | (BlockerLocation & {
      readonly kind: 'missing_plan_approval_subject';
      readonly table: 'plan_approvals';
      readonly path: '$subject';
      readonly subjectKey: string;
    })
  | (BlockerLocation & {
      readonly kind: 'invalid_plan_approval_subject';
      readonly table: 'plan_approvals';
      readonly path: '$subject';
      readonly subjectKey: string;
    })
  | (BlockerLocation & {
      readonly kind: 'plan_approval_subject_hash_mismatch';
      readonly table: 'plan_approvals';
      readonly path: '$.subject_hash';
      readonly documentRowKey: string;
    })
  | {
      readonly kind: 'incomparable_approved_plan_heads';
      readonly table: 'plan_approvals';
      readonly groupKey: string;
      readonly reason: 'different_logical_keys' | 'duplicate_head_revision';
      readonly approvedCount: number;
      readonly rowKeys: readonly string[];
    };

export interface LegacyApprovedPlanHead {
  readonly groupKey: string;
  readonly approvalRowKey: string;
  readonly documentRowKey: string;
  readonly revision: number;
}

export interface LegacyPlanHistoryPreflightReport {
  readonly schema: 'lucid-fin.legacy-plan-history-preflight/v1';
  readonly coverage: typeof LEGACY_PLAN_HISTORY_PREFLIGHT_COVERAGE;
  readonly sourceFingerprint: string;
  readonly documentCount: number;
  readonly validDocumentCount: number;
  readonly approvalCount: number;
  readonly validApprovalCount: number;
  readonly approvedApprovalCount: number;
  readonly approvedGroupCount: number;
  readonly approvedHeadCount: number;
  readonly approvedHeads: readonly LegacyApprovedPlanHead[];
  readonly fingerprint: string;
  readonly blockers: readonly LegacyPlanHistoryPreflightBlocker[];
  readonly ok: boolean;
}

interface PlanDocumentRow extends Record<string, unknown> {
  readonly content_hash: unknown;
  readonly content_json: unknown;
  readonly created_at: unknown;
  readonly document_type: unknown;
  readonly id: unknown;
  readonly logical_key: unknown;
  readonly revision: unknown;
  readonly schema_version: unknown;
  readonly status: unknown;
  readonly task_list_id: unknown;
  readonly updated_at: unknown;
}

interface PlanApprovalRow extends Record<string, unknown> {
  readonly created_at: unknown;
  readonly decided_at: unknown;
  readonly gate_key: unknown;
  readonly id: unknown;
  readonly manifest_hash: unknown;
  readonly resume_token_hash: unknown;
  readonly status: unknown;
  readonly subject_hash: unknown;
  readonly subject_logical_key: unknown;
  readonly subject_revision: unknown;
  readonly task_list_id: unknown;
  readonly updated_at: unknown;
}

interface DocumentState {
  readonly rowKey: string;
  readonly subjectKey: string | null;
  readonly contentHash: string | null;
  readonly taskListId: string | null;
  readonly logicalKey: string | null;
  readonly revision: number | null;
  readonly documentType: string | null;
  valid: boolean;
}

interface ApprovalState {
  readonly rowKey: string;
  readonly taskListId: string | null;
  readonly gateKey: string | null;
  readonly logicalKey: string | null;
  readonly revision: number | null;
  readonly status: string | null;
  readonly documentRowKey: string | null;
  valid: boolean;
}

interface JsonTreeShapeRow {
  readonly id: unknown;
  readonly parent: unknown;
  readonly key: unknown;
  readonly type: unknown;
}

type JsonTreeStatement = ReturnType<DatabaseSync['prepare']>;
type JsonStructureInspection = 'ok' | 'duplicate_object_key' | 'uninspectable_structure';

function rawValueFingerprint(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      type: 'blob',
      sha256: createHash('sha256').update(value).digest('hex'),
      byteLength: value.byteLength,
    };
  }
  if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
  return { type: typeof value, value };
}

function rawRowFingerprint(row: Readonly<Record<string, unknown>>): string {
  return hashCanonical(
    Object.keys(row)
      .sort()
      .map((column) => [column, rawValueFingerprint(row[column])]),
  );
}

export function legacyPlanHistorySourceFingerprint(rows: LegacyPlanHistorySourceRows): string {
  return hashCanonical({
    documents: rows.documents.map(rawRowFingerprint).sort(compareText),
    approvals: rows.approvals.map(rawRowFingerprint).sort(compareText),
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function integerValue(value: unknown): number | null {
  if (typeof value === 'bigint') {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
  const integer = integerValue(value);
  return integer !== null && integer > 0 ? integer : null;
}

function validTimestamp(value: unknown): boolean {
  const integer = integerValue(value);
  return integer !== null && integer >= 0;
}

function inspectJsonStructure(statement: JsonTreeStatement, raw: string): JsonStructureInspection {
  let rows: JsonTreeShapeRow[];
  try {
    rows = statement.all(raw) as unknown as JsonTreeShapeRow[];
  } catch {
    return 'uninspectable_structure';
  }
  const root = rows[0];
  if (
    !root ||
    typeof root.id !== 'number' ||
    root.parent !== null ||
    root.key !== null ||
    typeof root.type !== 'string'
  ) {
    return 'uninspectable_structure';
  }
  const nodeTypes = new Map<number, string>([[root.id, root.type]]);
  const objectMembers = new Set<string>();
  for (const row of rows.slice(1)) {
    if (
      typeof row.id !== 'number' ||
      typeof row.parent !== 'number' ||
      typeof row.type !== 'string' ||
      (typeof row.key !== 'string' && typeof row.key !== 'number') ||
      nodeTypes.has(row.id)
    ) {
      return 'uninspectable_structure';
    }
    const parentType = nodeTypes.get(row.parent);
    if (
      (parentType !== 'object' && parentType !== 'array') ||
      (parentType === 'object' && typeof row.key !== 'string') ||
      (parentType === 'array' && typeof row.key !== 'number')
    ) {
      return 'uninspectable_structure';
    }
    if (parentType === 'object') {
      const member = `${row.parent}\u0000${row.key}`;
      if (objectMembers.has(member)) return 'duplicate_object_key';
      objectMembers.add(member);
    }
    nodeTypes.set(row.id, row.type);
  }
  return 'ok';
}

function documentRowKey(row: PlanDocumentRow): string {
  return hashCanonical({
    table: 'plan_documents',
    id: rawValueFingerprint(row.id),
    taskListId: rawValueFingerprint(row.task_list_id),
    logicalKey: rawValueFingerprint(row.logical_key),
    revision: rawValueFingerprint(row.revision),
  });
}

function approvalRowKey(row: PlanApprovalRow): string {
  return hashCanonical({
    table: 'plan_approvals',
    id: rawValueFingerprint(row.id),
    taskListId: rawValueFingerprint(row.task_list_id),
    gateKey: rawValueFingerprint(row.gate_key),
    logicalKey: rawValueFingerprint(row.subject_logical_key),
    revision: rawValueFingerprint(row.subject_revision),
  });
}

function subjectKey(taskListId: string, logicalKey: string, revision: number): string {
  return hashCanonical({ taskListId, logicalKey, revision });
}

function invalidDocumentField(
  blockers: LegacyPlanHistoryPreflightBlocker[],
  rowKey: string,
  path: string,
  reason: Extract<
    LegacyPlanHistoryPreflightBlocker,
    { kind: 'invalid_plan_document_field' }
  >['reason'],
): void {
  blockers.push({
    kind: 'invalid_plan_document_field',
    table: 'plan_documents',
    rowKey,
    path,
    reason,
  });
}

function invalidApprovalField(
  blockers: LegacyPlanHistoryPreflightBlocker[],
  rowKey: string,
  path: string,
  reason: Extract<
    LegacyPlanHistoryPreflightBlocker,
    { kind: 'invalid_plan_approval_field' }
  >['reason'],
): void {
  blockers.push({
    kind: 'invalid_plan_approval_field',
    table: 'plan_approvals',
    rowKey,
    path,
    reason,
  });
}

/**
 * Audits the immutable Legacy Plan document/approval relationship without
 * projecting mixed document types into Target Production or UserChoice data.
 */
export function preflightLegacyPlanHistory(
  database: DatabaseSync,
): LegacyPlanHistoryPreflightReport {
  const documentStatement = database.prepare(`
    SELECT content_hash, content_json, created_at, document_type, id, logical_key,
           revision, schema_version, status, task_list_id, updated_at
      FROM plan_documents
  `);
  const approvalStatement = database.prepare(`
    SELECT created_at, decided_at, gate_key, id, manifest_hash, resume_token_hash,
           status, subject_hash, subject_logical_key, subject_revision,
           task_list_id, updated_at
      FROM plan_approvals
  `);
  const jsonTreeStatement = database.prepare(
    'SELECT id, parent, key, type FROM json_tree(?) ORDER BY id',
  );
  documentStatement.setReadBigInts(true);
  approvalStatement.setReadBigInts(true);
  const documentRows = [...(documentStatement.iterate() as Iterable<PlanDocumentRow>)];
  const approvalRows = [...(approvalStatement.iterate() as Iterable<PlanApprovalRow>)];
  const sourceFingerprint = legacyPlanHistorySourceFingerprint({
    documents: documentRows,
    approvals: approvalRows,
  });
  const blockers: LegacyPlanHistoryPreflightBlocker[] = [];
  const documents: DocumentState[] = [];
  const documentsBySubject = new Map<string, DocumentState[]>();
  const documentsByLineage = new Map<string, DocumentState[]>();

  for (const row of documentRows) {
    const rowKey = documentRowKey(row);
    const blockerStart = blockers.length;
    if (!nonEmptyText(row.id)) invalidDocumentField(blockers, rowKey, '$.id', 'empty_text');
    const taskListId = nonEmptyText(row.task_list_id) ? row.task_list_id : null;
    if (taskListId === null) {
      invalidDocumentField(blockers, rowKey, '$.task_list_id', 'empty_text');
    }
    const logicalKey = nonEmptyText(row.logical_key) ? row.logical_key : null;
    if (logicalKey === null) {
      invalidDocumentField(blockers, rowKey, '$.logical_key', 'empty_text');
    }
    const documentType = nonEmptyText(row.document_type) ? row.document_type : null;
    if (documentType === null) {
      invalidDocumentField(blockers, rowKey, '$.document_type', 'empty_text');
    }
    const revision = positiveInteger(row.revision);
    if (revision === null) {
      invalidDocumentField(blockers, rowKey, '$.revision', 'invalid_positive_integer');
    }
    if (positiveInteger(row.schema_version) === null) {
      invalidDocumentField(blockers, rowKey, '$.schema_version', 'invalid_positive_integer');
    }
    if (typeof row.status !== 'string' || !DOCUMENT_STATUSES.has(row.status)) {
      invalidDocumentField(blockers, rowKey, '$.status', 'unknown_status');
    }
    if (!validTimestamp(row.created_at)) {
      invalidDocumentField(blockers, rowKey, '$.created_at', 'invalid_timestamp');
    }
    if (!validTimestamp(row.updated_at)) {
      invalidDocumentField(blockers, rowKey, '$.updated_at', 'invalid_timestamp');
    }

    let parsedContent: unknown;
    if (typeof row.content_json !== 'string') {
      blockers.push({
        kind: 'invalid_plan_document_content',
        table: 'plan_documents',
        rowKey,
        path: '$.content_json',
        reason: 'not_text',
      });
    } else {
      try {
        parsedContent = JSON.parse(row.content_json) as unknown;
        if (
          typeof parsedContent !== 'object' ||
          parsedContent === null ||
          Array.isArray(parsedContent)
        ) {
          blockers.push({
            kind: 'invalid_plan_document_content',
            table: 'plan_documents',
            rowKey,
            path: '$.content_json',
            reason: 'not_object',
          });
        }
        const inspection = inspectJsonStructure(jsonTreeStatement, row.content_json);
        if (inspection !== 'ok') {
          blockers.push({
            kind: 'invalid_plan_document_content',
            table: 'plan_documents',
            rowKey,
            path: '$.content_json',
            reason: inspection,
          });
        }
      } catch {
        blockers.push({
          kind: 'invalid_plan_document_content',
          table: 'plan_documents',
          rowKey,
          path: '$.content_json',
          reason: 'invalid_json',
        });
      }
    }
    const contentHash =
      typeof row.content_hash === 'string' && SHA256_PATTERN.test(row.content_hash)
        ? row.content_hash
        : null;
    if (contentHash === null) {
      invalidDocumentField(blockers, rowKey, '$.content_hash', 'invalid_sha256');
    } else if (parsedContent !== undefined && hashCanonical(parsedContent) !== contentHash) {
      blockers.push({
        kind: 'plan_document_content_hash_mismatch',
        table: 'plan_documents',
        rowKey,
        path: '$.content_hash',
      });
    }

    const key =
      taskListId !== null && logicalKey !== null && revision !== null
        ? subjectKey(taskListId, logicalKey, revision)
        : null;
    const state: DocumentState = {
      rowKey,
      subjectKey: key,
      contentHash,
      taskListId,
      logicalKey,
      revision,
      documentType,
      valid: blockers.length === blockerStart,
    };
    documents.push(state);
    if (key !== null) {
      const group = documentsBySubject.get(key) ?? [];
      group.push(state);
      documentsBySubject.set(key, group);
    }
    if (taskListId !== null && logicalKey !== null && revision !== null && documentType !== null) {
      const lineageKey = hashCanonical({ taskListId, logicalKey });
      const lineage = documentsByLineage.get(lineageKey) ?? [];
      lineage.push(state);
      documentsByLineage.set(lineageKey, lineage);
    }
  }

  for (const [key, group] of documentsBySubject) {
    if (group.length < 2) continue;
    for (const document of group) document.valid = false;
    blockers.push({
      kind: 'duplicate_plan_document_subject',
      table: 'plan_documents',
      subjectKey: key,
      rowKeys: group.map(({ rowKey }) => rowKey).sort(compareText),
    });
  }

  for (const [lineageKey, lineage] of documentsByLineage) {
    if (new Set(lineage.map(({ documentType }) => documentType)).size < 2) continue;
    for (const document of lineage) document.valid = false;
    blockers.push({
      kind: 'plan_document_lineage_type_drift',
      table: 'plan_documents',
      lineageKey,
      rowKeys: lineage.map(({ rowKey }) => rowKey).sort(compareText),
    });
  }

  const approvals: ApprovalState[] = [];
  let approvedApprovalCount = 0;
  for (const row of approvalRows) {
    const rowKey = approvalRowKey(row);
    const blockerStart = blockers.length;
    if (!nonEmptyText(row.id)) invalidApprovalField(blockers, rowKey, '$.id', 'empty_text');
    const taskListId = nonEmptyText(row.task_list_id) ? row.task_list_id : null;
    if (taskListId === null) {
      invalidApprovalField(blockers, rowKey, '$.task_list_id', 'empty_text');
    }
    const gateKey =
      typeof row.gate_key === 'string' && APPROVAL_GATES.has(row.gate_key) ? row.gate_key : null;
    if (gateKey === null) invalidApprovalField(blockers, rowKey, '$.gate_key', 'unknown_gate');
    const logicalKey = nonEmptyText(row.subject_logical_key) ? row.subject_logical_key : null;
    if (logicalKey === null) {
      invalidApprovalField(blockers, rowKey, '$.subject_logical_key', 'empty_text');
    }
    const revision = positiveInteger(row.subject_revision);
    if (revision === null) {
      invalidApprovalField(blockers, rowKey, '$.subject_revision', 'invalid_positive_integer');
    }
    const status =
      typeof row.status === 'string' && APPROVAL_STATUSES.has(row.status) ? row.status : null;
    if (status === null) invalidApprovalField(blockers, rowKey, '$.status', 'unknown_status');
    if (status === 'approved') approvedApprovalCount += 1;
    if (!validTimestamp(row.created_at)) {
      invalidApprovalField(blockers, rowKey, '$.created_at', 'invalid_timestamp');
    }
    if (!validTimestamp(row.updated_at)) {
      invalidApprovalField(blockers, rowKey, '$.updated_at', 'invalid_timestamp');
    }
    const decidedAtIsValid = row.decided_at === null || validTimestamp(row.decided_at);
    if (!decidedAtIsValid) {
      invalidApprovalField(blockers, rowKey, '$.decided_at', 'invalid_timestamp');
    } else if (
      (status === 'pending' && row.decided_at !== null) ||
      (status !== null && status !== 'pending' && row.decided_at === null)
    ) {
      invalidApprovalField(blockers, rowKey, '$.decided_at', 'decision_timestamp_mismatch');
    }
    for (const [column, value] of [
      ['subject_hash', row.subject_hash],
      ['manifest_hash', row.manifest_hash],
      ['resume_token_hash', row.resume_token_hash],
    ] as const) {
      if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
        invalidApprovalField(blockers, rowKey, `$.${column}`, 'invalid_sha256');
      }
    }

    const key =
      taskListId !== null && logicalKey !== null && revision !== null
        ? subjectKey(taskListId, logicalKey, revision)
        : null;
    let documentRowKey: string | null = null;
    if (key !== null) {
      const subjects = documentsBySubject.get(key) ?? [];
      if (subjects.length === 0) {
        blockers.push({
          kind: 'missing_plan_approval_subject',
          table: 'plan_approvals',
          rowKey,
          path: '$subject',
          subjectKey: key,
        });
      } else if (subjects.length !== 1 || !subjects[0]!.valid) {
        blockers.push({
          kind: 'invalid_plan_approval_subject',
          table: 'plan_approvals',
          rowKey,
          path: '$subject',
          subjectKey: key,
        });
      } else if (row.subject_hash !== subjects[0]!.contentHash) {
        blockers.push({
          kind: 'plan_approval_subject_hash_mismatch',
          table: 'plan_approvals',
          rowKey,
          path: '$.subject_hash',
          documentRowKey: subjects[0]!.rowKey,
        });
      } else {
        documentRowKey = subjects[0]!.rowKey;
      }
    }
    approvals.push({
      rowKey,
      taskListId,
      gateKey,
      logicalKey,
      revision,
      status,
      documentRowKey,
      valid: blockers.length === blockerStart,
    });
  }

  const approvedGroups = new Map<string, ApprovalState[]>();
  for (const approval of approvals) {
    if (
      !approval.valid ||
      approval.status !== 'approved' ||
      approval.taskListId === null ||
      approval.gateKey === null
    ) {
      continue;
    }
    const key = hashCanonical({ taskListId: approval.taskListId, gateKey: approval.gateKey });
    const group = approvedGroups.get(key) ?? [];
    group.push(approval);
    approvedGroups.set(key, group);
  }

  const approvedHeads: LegacyApprovedPlanHead[] = [];
  for (const [groupKey, group] of approvedGroups) {
    const logicalKeys = new Set(group.map(({ logicalKey }) => logicalKey));
    if (logicalKeys.size !== 1) {
      blockers.push({
        kind: 'incomparable_approved_plan_heads',
        table: 'plan_approvals',
        groupKey,
        reason: 'different_logical_keys',
        approvedCount: group.length,
        rowKeys: group.map(({ rowKey }) => rowKey).sort(compareText),
      });
      continue;
    }
    const headRevision = Math.max(...group.map(({ revision }) => revision ?? 0));
    const heads = group.filter(({ revision }) => revision === headRevision);
    if (heads.length !== 1) {
      blockers.push({
        kind: 'incomparable_approved_plan_heads',
        table: 'plan_approvals',
        groupKey,
        reason: 'duplicate_head_revision',
        approvedCount: group.length,
        rowKeys: heads.map(({ rowKey }) => rowKey).sort(compareText),
      });
      continue;
    }
    const head = heads[0]!;
    if (head.documentRowKey === null || head.revision === null) {
      throw new Error('Valid approved Plan head lost its bound document identity');
    }
    approvedHeads.push({
      groupKey,
      approvalRowKey: head.rowKey,
      documentRowKey: head.documentRowKey,
      revision: head.revision,
    });
  }
  approvedHeads.sort(
    (left, right) =>
      compareText(left.groupKey, right.groupKey) ||
      compareText(left.approvalRowKey, right.approvalRowKey),
  );

  blockers.sort((left, right) => compareText(hashCanonical(left), hashCanonical(right)));
  const counts = {
    documentCount: documentRows.length,
    validDocumentCount: documents.filter(({ valid }) => valid).length,
    approvalCount: approvalRows.length,
    validApprovalCount: approvals.filter(({ valid }) => valid).length,
    approvedApprovalCount,
    approvedGroupCount: approvedGroups.size,
    approvedHeadCount: approvedHeads.length,
  };
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-plan-history-preflight/v1' as const,
    coverage: LEGACY_PLAN_HISTORY_PREFLIGHT_COVERAGE,
    sourceFingerprint,
    ...counts,
    approvedHeads,
    blockers,
    ok: blockers.length === 0,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical({
      schema: withoutFingerprint.schema,
      sourceFingerprint,
      coverage: withoutFingerprint.coverage,
      counts,
      approvedHeads,
      blockers,
    }),
  };
}
