import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,119}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const EXPORT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,499}$/;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const LEGACY_MIGRATION_DISPOSITIONS = [
  'migrated_current_state',
  'immutable_provenance_history',
  'offline_legacy_export',
  'blocking_error',
] as const;

export type LegacyMigrationDisposition = (typeof LEGACY_MIGRATION_DISPOSITIONS)[number];

export interface LegacyClassificationSubject {
  readonly database: 'main' | 'prompts';
  readonly table: string;
  readonly rowKey: string;
  readonly path: string;
}

export interface LegacyClassificationTargetRefInput {
  readonly authority: string;
  readonly id: string;
  readonly projectId: string | null;
  readonly cloneOf?: string;
}

export interface LegacyClassificationEntryInput {
  readonly subject: LegacyClassificationSubject;
  readonly disposition: LegacyMigrationDisposition;
  readonly reasonCode: string;
  readonly targetRefs: readonly LegacyClassificationTargetRefInput[];
  readonly exportRef: string | null;
  readonly blockerCode: string | null;
}

export interface LegacyClassificationTargetRef {
  readonly authority: string;
  readonly id: string;
  readonly projectId: string | null;
  readonly cloneOf: string | null;
}

export interface LegacyClassificationEntry {
  readonly sourceKey: string;
  readonly subject: LegacyClassificationSubject;
  readonly disposition: LegacyMigrationDisposition;
  readonly reasonCode: string;
  readonly targetRefs: readonly LegacyClassificationTargetRef[];
  readonly exportRef: string | null;
  readonly blockerCode: string | null;
}

export type LegacyClassificationReportBlocker =
  | {
      readonly kind: 'invalid_classification_subject';
      readonly sourceKey: string;
    }
  | {
      readonly kind: 'duplicate_classification_subject';
      readonly sourceKey: string;
    }
  | {
      readonly kind: 'unclassified_subject';
      readonly sourceKey: string;
    }
  | {
      readonly kind: 'duplicate_classification_entry';
      readonly sourceKey: string;
    }
  | {
      readonly kind: 'unknown_classification_subject';
      readonly sourceKey: string;
    }
  | {
      readonly kind: 'invalid_classification_entry';
      readonly sourceKey: string;
      readonly reason:
        | 'invalid_disposition'
        | 'invalid_reason_code'
        | 'invalid_target_refs'
        | 'invalid_export_ref'
        | 'invalid_blocker_code';
    }
  | {
      readonly kind: 'classified_blocking_error';
      readonly sourceKey: string;
      readonly reasonCode: string;
      readonly blockerCode: string;
    };

export interface LegacyClassificationReport {
  readonly schema: 'lucid-fin.legacy-classification-report/v1';
  readonly sourceFingerprint: string;
  readonly counts: Readonly<{
    subjectCount: number;
    classifiedCount: number;
    targetRefCount: number;
    cloneRefCount: number;
    byDisposition: Readonly<Record<LegacyMigrationDisposition, number>>;
  }>;
  readonly entries: readonly LegacyClassificationEntry[];
  readonly blockers: readonly LegacyClassificationReportBlocker[];
  readonly reportHash: string;
  readonly ok: boolean;
}

export interface LegacyClassificationReportInput {
  readonly sourceFingerprint: string;
  readonly subjects: readonly LegacyClassificationSubject[];
  readonly entries: readonly LegacyClassificationEntryInput[];
}

const BLOCKER_KIND_ORDER: Readonly<Record<LegacyClassificationReportBlocker['kind'], number>> = {
  invalid_classification_subject: 0,
  duplicate_classification_subject: 1,
  unclassified_subject: 2,
  duplicate_classification_entry: 3,
  unknown_classification_subject: 4,
  invalid_classification_entry: 5,
  classified_blocking_error: 6,
};

function validJsonPath(path: string): boolean {
  if (path.length === 0 || path.length > 1_000 || !path.startsWith('$')) return false;
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (character === '\\' || code < 32 || code === 127) return false;
  }
  return true;
}

function validSubject(subject: LegacyClassificationSubject): boolean {
  return (
    (subject.database === 'main' || subject.database === 'prompts') &&
    SOURCE_NAME_PATTERN.test(subject.table) &&
    SHA256_PATTERN.test(subject.rowKey) &&
    validJsonPath(subject.path)
  );
}

export function legacyClassificationSourceKey(subject: LegacyClassificationSubject): string {
  return hashCanonical({
    database: subject.database,
    table: subject.table,
    rowKey: subject.rowKey,
    path: subject.path,
  });
}

function isDisposition(value: unknown): value is LegacyMigrationDisposition {
  return (
    typeof value === 'string' &&
    (LEGACY_MIGRATION_DISPOSITIONS as readonly string[]).includes(value)
  );
}

function validTargetRef(value: LegacyClassificationTargetRefInput): boolean {
  return (
    OPAQUE_ID_PATTERN.test(value.authority) &&
    OPAQUE_ID_PATTERN.test(value.id) &&
    (value.projectId === null || OPAQUE_ID_PATTERN.test(value.projectId)) &&
    (value.cloneOf === undefined || OPAQUE_ID_PATTERN.test(value.cloneOf))
  );
}

function normalizedTargetRefs(
  values: readonly LegacyClassificationTargetRefInput[],
): readonly LegacyClassificationTargetRef[] | null {
  if (!Array.isArray(values) || values.some((value) => !validTargetRef(value))) return null;
  const normalized = values
    .map((value): LegacyClassificationTargetRef => ({
      authority: value.authority,
      id: value.id,
      projectId: value.projectId,
      cloneOf: value.cloneOf ?? null,
    }))
    .sort(
      (left, right) =>
        compareText(left.authority, right.authority) ||
        compareText(left.id, right.id) ||
        compareText(left.projectId ?? '', right.projectId ?? '') ||
        compareText(left.cloneOf ?? '', right.cloneOf ?? ''),
    );
  const keys = normalized.map((value) => hashCanonical(value));
  return new Set(keys).size === keys.length ? normalized : null;
}

function invalidEntryReason(
  input: LegacyClassificationEntryInput,
):
  | Extract<LegacyClassificationReportBlocker, { kind: 'invalid_classification_entry' }>['reason']
  | null {
  if (!isDisposition(input.disposition)) return 'invalid_disposition';
  if (!REASON_CODE_PATTERN.test(input.reasonCode)) return 'invalid_reason_code';
  const targetRefs = normalizedTargetRefs(input.targetRefs);
  if (targetRefs === null) return 'invalid_target_refs';

  if (
    input.disposition === 'migrated_current_state' ||
    input.disposition === 'immutable_provenance_history'
  ) {
    return targetRefs.length > 0 && input.exportRef === null && input.blockerCode === null
      ? null
      : 'invalid_target_refs';
  }
  if (input.disposition === 'offline_legacy_export') {
    return targetRefs.length === 0 &&
      typeof input.exportRef === 'string' &&
      EXPORT_REF_PATTERN.test(input.exportRef) &&
      input.blockerCode === null
      ? null
      : 'invalid_export_ref';
  }
  return targetRefs.length === 0 &&
    input.exportRef === null &&
    typeof input.blockerCode === 'string' &&
    REASON_CODE_PATTERN.test(input.blockerCode)
    ? null
    : 'invalid_blocker_code';
}

function emptyDispositionCounts(): Record<LegacyMigrationDisposition, number> {
  return {
    migrated_current_state: 0,
    immutable_provenance_history: 0,
    offline_legacy_export: 0,
    blocking_error: 0,
  };
}

function compareBlockers(
  left: LegacyClassificationReportBlocker,
  right: LegacyClassificationReportBlocker,
): number {
  return (
    BLOCKER_KIND_ORDER[left.kind] - BLOCKER_KIND_ORDER[right.kind] ||
    compareText(left.sourceKey, right.sourceKey) ||
    compareText(hashCanonical(left), hashCanonical(right))
  );
}

/**
 * Builds the canonical Phase-1 classification report. Callers must enumerate
 * every row and authoritative embedded item before providing classifications.
 */
export function buildLegacyClassificationReport(
  input: LegacyClassificationReportInput,
): LegacyClassificationReport {
  if (!SHA256_PATTERN.test(input.sourceFingerprint)) {
    throw new TypeError('Legacy classification sourceFingerprint must be lowercase SHA-256');
  }

  const blockers: LegacyClassificationReportBlocker[] = [];
  const subjects = new Map<string, LegacyClassificationSubject>();
  for (const subject of input.subjects) {
    const sourceKey = legacyClassificationSourceKey(subject);
    if (!validSubject(subject)) {
      blockers.push({ kind: 'invalid_classification_subject', sourceKey });
      continue;
    }
    if (subjects.has(sourceKey)) {
      blockers.push({ kind: 'duplicate_classification_subject', sourceKey });
      continue;
    }
    subjects.set(sourceKey, subject);
  }

  const entryGroups = new Map<string, LegacyClassificationEntryInput[]>();
  for (const entry of input.entries) {
    const sourceKey = legacyClassificationSourceKey(entry.subject);
    const group = entryGroups.get(sourceKey);
    if (group) group.push(entry);
    else entryGroups.set(sourceKey, [entry]);
  }
  for (const sourceKey of [...subjects.keys()].sort()) {
    if (!entryGroups.has(sourceKey)) blockers.push({ kind: 'unclassified_subject', sourceKey });
  }

  const entries: LegacyClassificationEntry[] = [];
  for (const sourceKey of [...entryGroups.keys()].sort()) {
    const group = entryGroups.get(sourceKey);
    if (!group) throw new Error('Legacy classification entry group disappeared');
    if (group.length > 1) {
      blockers.push({ kind: 'duplicate_classification_entry', sourceKey });
    }
    const expectedSubject = subjects.get(sourceKey);
    if (!expectedSubject) {
      blockers.push({ kind: 'unknown_classification_subject', sourceKey });
      continue;
    }
    if (group.length > 1) continue;
    const inputEntry = group[0];
    if (!inputEntry) throw new Error('Legacy classification entry group is empty');
    const invalidReason = invalidEntryReason(inputEntry);
    if (invalidReason) {
      blockers.push({ kind: 'invalid_classification_entry', sourceKey, reason: invalidReason });
      continue;
    }
    const targetRefs = normalizedTargetRefs(inputEntry.targetRefs);
    if (!targetRefs) throw new Error('Validated Legacy target refs became invalid');
    const entry: LegacyClassificationEntry = {
      sourceKey,
      subject: expectedSubject,
      disposition: inputEntry.disposition,
      reasonCode: inputEntry.reasonCode,
      targetRefs,
      exportRef: inputEntry.exportRef,
      blockerCode: inputEntry.blockerCode,
    };
    entries.push(entry);
    if (entry.disposition === 'blocking_error' && entry.blockerCode !== null) {
      blockers.push({
        kind: 'classified_blocking_error',
        sourceKey,
        reasonCode: entry.reasonCode,
        blockerCode: entry.blockerCode,
      });
    }
  }
  entries.sort((left, right) => compareText(left.sourceKey, right.sourceKey));
  blockers.sort(compareBlockers);

  const byDisposition = emptyDispositionCounts();
  let targetRefCount = 0;
  let cloneRefCount = 0;
  for (const entry of entries) {
    byDisposition[entry.disposition] += 1;
    targetRefCount += entry.targetRefs.length;
    cloneRefCount += entry.targetRefs.filter(({ cloneOf }) => cloneOf !== null).length;
  }
  const counts = {
    subjectCount: subjects.size,
    classifiedCount: entries.length,
    targetRefCount,
    cloneRefCount,
    byDisposition,
  } as const;
  const withoutHash = {
    schema: 'lucid-fin.legacy-classification-report/v1' as const,
    sourceFingerprint: input.sourceFingerprint,
    counts,
    entries,
    blockers,
  };
  return {
    ...withoutHash,
    reportHash: hashCanonical(withoutHash),
    ok: blockers.length === 0,
  };
}
