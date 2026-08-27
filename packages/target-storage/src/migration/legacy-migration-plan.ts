import { hashCanonical } from '../internal/hashes.js';
import {
  LEGACY_MIGRATION_DISPOSITIONS,
  buildLegacyClassificationReport,
  type LegacyClassificationEntry,
  type LegacyClassificationSubject,
  type LegacyClassificationTargetRef,
  type LegacyMigrationDisposition,
} from './classification-report.js';
import type { LegacyMigrationReadinessReport } from './migration-readiness.js';
import type { LegacyPhaseOneClassificationReport } from './phase-one-classification.js';

export const LEGACY_MIGRATION_PLAN_SCHEMA = 'lucid-fin.legacy-migration-plan/v1' as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const TARGET_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/;
const SOURCE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{0,119}$/;
const EXPORT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,499}$/;

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || unit === 0x7f) return true;
  }
  return false;
}

export type LegacyMigrationPlanScope = 'root_rows' | 'embedded_json_members';

export interface LegacyMigrationPlanSource {
  readonly schemaFingerprint: string;
  readonly contentFingerprint: string;
  readonly preflightFingerprint: string;
  readonly classificationFingerprint: string;
  readonly phaseOneFingerprint: string;
  readonly readinessFingerprint: string;
}

export interface LegacyMigrationPlanOperation {
  readonly ordinal: number;
  readonly scope: LegacyMigrationPlanScope;
  readonly disposition: LegacyMigrationDisposition;
  readonly reasonCode: string;
  readonly sourceKey: string;
  readonly subject: LegacyClassificationSubject;
  readonly targetRefs: readonly LegacyClassificationTargetRef[];
  readonly exportRef: string | null;
}

/** A non-lossy, source-keyed proof that plan targets equal Phase-1 targets. */
export interface LegacyMigrationPlanTargetRefProof {
  readonly scope: LegacyMigrationPlanScope;
  readonly sourceKey: string;
  readonly targetRefs: readonly LegacyClassificationTargetRef[];
}

export interface LegacyMigrationPlan {
  readonly schema: typeof LEGACY_MIGRATION_PLAN_SCHEMA;
  readonly planId: string;
  readonly batchId: string;
  readonly source: LegacyMigrationPlanSource;
  readonly operations: readonly LegacyMigrationPlanOperation[];
  readonly targetRefs: readonly LegacyMigrationPlanTargetRefProof[];
  readonly fingerprint: string;
}

export interface LegacyMigrationPlanInput {
  readonly readiness: LegacyMigrationReadinessReport;
  readonly phaseOne: LegacyPhaseOneClassificationReport;
}

export type LegacyMigrationPlanValidationError =
  | 'invalid_plan_shape'
  | 'invalid_plan_schema'
  | 'invalid_plan_source'
  | 'invalid_operation'
  | 'operation_order_mismatch'
  | 'target_ref_proof_mismatch'
  | 'blocking_disposition_present'
  | 'plan_fingerprint_mismatch'
  | 'plan_identity_mismatch';

export interface LegacyMigrationPlanValidationResult {
  readonly ok: boolean;
  readonly errors: readonly LegacyMigrationPlanValidationError[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  return (
    keys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function isAbsolutePath(value: string): boolean {
  return (
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('file:')
  );
}

function cloneSubject(subject: LegacyClassificationSubject): LegacyClassificationSubject {
  return {
    database: subject.database,
    table: subject.table,
    rowKey: subject.rowKey,
    path: subject.path,
  };
}

function cloneTargetRefs(
  targetRefs: readonly LegacyClassificationTargetRef[],
): readonly LegacyClassificationTargetRef[] {
  return targetRefs.map((targetRef) => ({
    authority: targetRef.authority,
    id: targetRef.id,
    projectId: targetRef.projectId,
    cloneOf: targetRef.cloneOf,
  }));
}

function operationsFor(
  phaseOne: LegacyPhaseOneClassificationReport,
): readonly LegacyMigrationPlanOperation[] {
  const entries: Array<{
    readonly scope: LegacyMigrationPlanScope;
    readonly entry: LegacyClassificationEntry;
  }> = [
    ...phaseOne.rootRows.classification.entries.map((entry) => ({
      scope: 'root_rows' as const,
      entry,
    })),
    ...phaseOne.embeddedJson.classification.entries.map((entry) => ({
      scope: 'embedded_json_members' as const,
      entry,
    })),
  ];
  entries.sort(
    (left, right) =>
      compareText(left.entry.sourceKey, right.entry.sourceKey) ||
      compareText(left.scope, right.scope),
  );
  return entries.map(({ scope, entry }, ordinal) => ({
    ordinal,
    scope,
    disposition: entry.disposition,
    reasonCode: entry.reasonCode,
    sourceKey: entry.sourceKey,
    subject: cloneSubject(entry.subject),
    targetRefs: cloneTargetRefs(entry.targetRefs),
    exportRef: entry.exportRef,
  }));
}

function targetRefProof(
  operations: readonly LegacyMigrationPlanOperation[],
): readonly LegacyMigrationPlanTargetRefProof[] {
  return operations.map(({ scope, sourceKey, targetRefs }) => ({
    scope,
    sourceKey,
    targetRefs: cloneTargetRefs(targetRefs),
  }));
}

function planFingerprintInput(
  source: LegacyMigrationPlanSource,
  operations: readonly LegacyMigrationPlanOperation[],
  targetRefs: readonly LegacyMigrationPlanTargetRefProof[],
) {
  return { schema: LEGACY_MIGRATION_PLAN_SCHEMA, source, operations, targetRefs };
}

function expectedPlanId(fingerprint: string): string {
  return `legacy.migration-plan.${fingerprint}`;
}

function expectedBatchId(source: LegacyMigrationPlanSource, fingerprint: string): string {
  return `import.batch.${hashCanonical({
    schema: 'lucid-fin.legacy-migration-batch-id/v1',
    sourceContentFingerprint: source.contentFingerprint,
    classificationFingerprint: source.classificationFingerprint,
    planFingerprint: fingerprint,
  })}`;
}

function validSubject(value: unknown): value is LegacyClassificationSubject {
  if (!isRecord(value) || !hasOnlyKeys(value, ['database', 'table', 'rowKey', 'path']))
    return false;
  return (
    (value.database === 'main' || value.database === 'prompts') &&
    typeof value.table === 'string' &&
    SOURCE_NAME_PATTERN.test(value.table) &&
    typeof value.rowKey === 'string' &&
    SHA256_PATTERN.test(value.rowKey) &&
    typeof value.path === 'string' &&
    value.path.startsWith('$') &&
    value.path.length <= 1_000 &&
    !value.path.includes('\\') &&
    !containsAsciiControl(value.path)
  );
}

function validTargetRefs(value: unknown): value is readonly LegacyClassificationTargetRef[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  let previous: LegacyClassificationTargetRef | undefined;
  for (const targetRef of value) {
    if (
      !isRecord(targetRef) ||
      !hasOnlyKeys(targetRef, ['authority', 'id', 'projectId', 'cloneOf']) ||
      typeof targetRef.authority !== 'string' ||
      !TARGET_REF_PATTERN.test(targetRef.authority) ||
      typeof targetRef.id !== 'string' ||
      !TARGET_REF_PATTERN.test(targetRef.id) ||
      (targetRef.projectId !== null &&
        (typeof targetRef.projectId !== 'string' ||
          !TARGET_REF_PATTERN.test(targetRef.projectId))) ||
      (targetRef.cloneOf !== null &&
        (typeof targetRef.cloneOf !== 'string' || !TARGET_REF_PATTERN.test(targetRef.cloneOf)))
    ) {
      return false;
    }
    const normalized: LegacyClassificationTargetRef = {
      authority: targetRef.authority,
      id: targetRef.id,
      projectId: targetRef.projectId,
      cloneOf: targetRef.cloneOf,
    };
    const key = hashCanonical(normalized);
    if (seen.has(key)) return false;
    seen.add(key);
    if (
      previous &&
      (compareText(previous.authority, normalized.authority) > 0 ||
        (previous.authority === normalized.authority &&
          compareText(previous.id, normalized.id) > 0) ||
        (previous.authority === normalized.authority &&
          previous.id === normalized.id &&
          compareText(previous.projectId ?? '', normalized.projectId ?? '') > 0) ||
        (previous.authority === normalized.authority &&
          previous.id === normalized.id &&
          previous.projectId === normalized.projectId &&
          compareText(previous.cloneOf ?? '', normalized.cloneOf ?? '') > 0))
    ) {
      return false;
    }
    previous = normalized;
  }
  return true;
}

function validOperation(value: unknown): value is LegacyMigrationPlanOperation {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'ordinal',
      'scope',
      'disposition',
      'reasonCode',
      'sourceKey',
      'subject',
      'targetRefs',
      'exportRef',
    ]) ||
    typeof value.ordinal !== 'number' ||
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 0 ||
    (value.scope !== 'root_rows' && value.scope !== 'embedded_json_members') ||
    typeof value.disposition !== 'string' ||
    !(LEGACY_MIGRATION_DISPOSITIONS as readonly string[]).includes(value.disposition) ||
    typeof value.reasonCode !== 'string' ||
    !REASON_CODE_PATTERN.test(value.reasonCode) ||
    typeof value.sourceKey !== 'string' ||
    !SHA256_PATTERN.test(value.sourceKey) ||
    !validSubject(value.subject) ||
    !validTargetRefs(value.targetRefs) ||
    (value.exportRef !== null &&
      (typeof value.exportRef !== 'string' ||
        !EXPORT_REF_PATTERN.test(value.exportRef) ||
        isAbsolutePath(value.exportRef)))
  ) {
    return false;
  }
  if (
    value.disposition === 'migrated_current_state' ||
    value.disposition === 'immutable_provenance_history'
  ) {
    return value.targetRefs.length > 0 && value.exportRef === null;
  }
  if (value.disposition === 'offline_legacy_export') {
    return value.targetRefs.length === 0 && value.exportRef !== null;
  }
  return value.targetRefs.length === 0 && value.exportRef === null;
}

function validSource(value: unknown): value is LegacyMigrationPlanSource {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'schemaFingerprint',
      'contentFingerprint',
      'preflightFingerprint',
      'classificationFingerprint',
      'phaseOneFingerprint',
      'readinessFingerprint',
    ])
  ) {
    return false;
  }
  return Object.values(value).every(
    (fingerprint) => typeof fingerprint === 'string' && SHA256_PATTERN.test(fingerprint),
  );
}

function reportMatchesClassification(
  sourceFingerprint: string,
  subjects: readonly LegacyClassificationSubject[],
  report: LegacyPhaseOneClassificationReport['rootRows']['classification'],
): boolean {
  try {
    const rebuilt = buildLegacyClassificationReport({
      sourceFingerprint,
      subjects,
      entries: report.entries.map((entry) => ({
        subject: entry.subject,
        disposition: entry.disposition,
        reasonCode: entry.reasonCode,
        targetRefs: entry.targetRefs.map((targetRef) => ({
          authority: targetRef.authority,
          id: targetRef.id,
          projectId: targetRef.projectId,
          cloneOf: targetRef.cloneOf ?? undefined,
        })),
        exportRef: entry.exportRef,
        blockerCode: entry.blockerCode,
      })),
    });
    return rebuilt.reportHash === report.reportHash;
  } catch {
    return false;
  }
}

function assertClearReadiness(readiness: LegacyMigrationReadinessReport): void {
  const { fingerprint, ok: _ok, ...withoutFingerprint } = readiness;
  if (
    readiness.schema !== 'lucid-fin.legacy-migration-readiness/v1' ||
    !SHA256_PATTERN.test(readiness.source.schemaFingerprint) ||
    !SHA256_PATTERN.test(readiness.source.contentFingerprint) ||
    !SHA256_PATTERN.test(readiness.source.preflightFingerprint) ||
    !SHA256_PATTERN.test(readiness.source.classificationFingerprint) ||
    !SHA256_PATTERN.test(readiness.source.phaseOneFingerprint) ||
    !SHA256_PATTERN.test(fingerprint) ||
    hashCanonical(withoutFingerprint) !== fingerprint
  ) {
    throw new TypeError('Legacy migration readiness report fingerprint does not match');
  }
  if (
    !readiness.ok ||
    readiness.status !== 'ready_for_disposable_dry_run' ||
    readiness.blockers.length !== 0
  ) {
    throw new TypeError('Legacy migration readiness gate is blocked');
  }
}

function assertClearPhaseOne(phaseOne: LegacyPhaseOneClassificationReport): void {
  const { rootRows, embeddedJson } = phaseOne;
  const rootClassification = rootRows.classification;
  const embeddedClassification = embeddedJson.classification;
  if (
    phaseOne.schema !== 'lucid-fin.legacy-phase-one-classification/v1' ||
    !SHA256_PATTERN.test(phaseOne.sourceFingerprint) ||
    !SHA256_PATTERN.test(phaseOne.sourceContentFingerprint) ||
    !SHA256_PATTERN.test(phaseOne.fingerprint) ||
    rootRows.inventory.fingerprint !== phaseOne.sourceFingerprint ||
    rootRows.inventory.sourceContentFingerprint !== phaseOne.sourceContentFingerprint ||
    embeddedJson.inventory.sourceFingerprint !== phaseOne.sourceFingerprint ||
    rootRows.ownership.sourceFingerprint !== phaseOne.sourceFingerprint ||
    rootClassification.sourceFingerprint !== rootRows.inventory.fingerprint ||
    embeddedClassification.sourceFingerprint !== embeddedJson.inventory.fingerprint ||
    !reportMatchesClassification(
      rootRows.inventory.fingerprint,
      rootRows.inventory.subjects,
      rootClassification,
    ) ||
    !reportMatchesClassification(
      embeddedJson.inventory.fingerprint,
      embeddedJson.inventory.subjects,
      embeddedClassification,
    )
  ) {
    throw new TypeError('Legacy Phase-1 classification fingerprint does not match');
  }

  const expectedRootFingerprint = hashCanonical({
    schema: rootRows.schema,
    scope: rootRows.scope,
    inventoryFingerprint: rootRows.inventory.fingerprint,
    ownershipFingerprint: rootRows.ownership.fingerprint,
    planHistoryFingerprint: rootRows.planHistory?.fingerprint ?? null,
    runHistoryFingerprint: rootRows.runHistory?.fingerprint ?? null,
    taskHistoryFingerprint: rootRows.taskHistory?.fingerprint ?? null,
    classificationReportHash: rootClassification.reportHash,
  });
  const expectedEmbeddedFingerprint = hashCanonical({
    schema: embeddedJson.schema,
    scope: embeddedJson.scope,
    inventoryFingerprint: embeddedJson.inventory.fingerprint,
    conversationPreflightFingerprint: embeddedJson.conversationPreflight?.fingerprint ?? null,
    classificationReportHash: embeddedClassification.reportHash,
  });
  const expectedPhaseOneFingerprint = hashCanonical({
    schema: phaseOne.schema,
    sourceFingerprint: phaseOne.sourceFingerprint,
    sourceContentFingerprint: phaseOne.sourceContentFingerprint,
    ownershipFingerprint: rootRows.ownership.fingerprint,
    rootFingerprint: rootRows.fingerprint,
    embeddedJsonFingerprint: embeddedJson.fingerprint,
  });
  if (
    rootRows.fingerprint !== expectedRootFingerprint ||
    embeddedJson.fingerprint !== expectedEmbeddedFingerprint ||
    phaseOne.fingerprint !== expectedPhaseOneFingerprint
  ) {
    throw new TypeError('Legacy Phase-1 classification fingerprint does not match');
  }

  const expectedRootOk =
    rootClassification.ok &&
    (rootRows.planHistory?.ok ?? true) &&
    (rootRows.runHistory?.ok ?? true) &&
    (rootRows.taskHistory?.ok ?? true);
  const expectedEmbeddedOk =
    embeddedClassification.ok && (embeddedJson.conversationPreflight?.ok ?? true);
  if (
    !phaseOne.ok ||
    rootRows.ok !== expectedRootOk ||
    embeddedJson.ok !== expectedEmbeddedOk ||
    phaseOne.ok !== (rootRows.ok && embeddedJson.ok)
  ) {
    throw new TypeError('Legacy Phase-1 classification is blocked');
  }
}

function assertReadinessBindings(
  readiness: LegacyMigrationReadinessReport,
  phaseOne: LegacyPhaseOneClassificationReport,
): void {
  if (
    readiness.source.contentFingerprint !== phaseOne.sourceContentFingerprint ||
    readiness.source.classificationFingerprint !== phaseOne.sourceFingerprint ||
    readiness.source.phaseOneFingerprint !== phaseOne.fingerprint
  ) {
    throw new TypeError('Legacy migration plan fingerprint bindings do not match');
  }
  const rootCounts = phaseOne.rootRows.classification.counts;
  const embeddedCounts = phaseOne.embeddedJson.classification.counts;
  const expectedDispositions = Object.fromEntries(
    LEGACY_MIGRATION_DISPOSITIONS.map((disposition) => [
      disposition,
      rootCounts.byDisposition[disposition] + embeddedCounts.byDisposition[disposition],
    ]),
  ) as Record<LegacyMigrationDisposition, number>;
  const counts = readiness.counts;
  if (
    counts.rootSubjectCount !== rootCounts.subjectCount ||
    counts.embeddedSubjectCount !== embeddedCounts.subjectCount ||
    counts.classifiedSubjectCount !== rootCounts.classifiedCount + embeddedCounts.classifiedCount ||
    counts.targetRefCount !== rootCounts.targetRefCount + embeddedCounts.targetRefCount ||
    counts.cloneRefCount !== rootCounts.cloneRefCount + embeddedCounts.cloneRefCount ||
    hashCanonical(counts.byDisposition) !== hashCanonical(expectedDispositions)
  ) {
    throw new TypeError('Legacy migration plan fingerprint bindings do not match');
  }
}

/**
 * Returns only immutable classification metadata. It deliberately excludes
 * Legacy values, paths, credentials, wall-clock time, and randomness.
 */
export function buildLegacyMigrationPlan(input: LegacyMigrationPlanInput): LegacyMigrationPlan {
  assertClearReadiness(input.readiness);
  assertClearPhaseOne(input.phaseOne);
  assertReadinessBindings(input.readiness, input.phaseOne);

  const source: LegacyMigrationPlanSource = {
    schemaFingerprint: input.readiness.source.schemaFingerprint,
    contentFingerprint: input.readiness.source.contentFingerprint,
    preflightFingerprint: input.readiness.source.preflightFingerprint,
    classificationFingerprint: input.readiness.source.classificationFingerprint,
    phaseOneFingerprint: input.readiness.source.phaseOneFingerprint,
    readinessFingerprint: input.readiness.fingerprint,
  };
  const operations = operationsFor(input.phaseOne);
  const targetRefs = targetRefProof(operations);
  const fingerprint = hashCanonical(planFingerprintInput(source, operations, targetRefs));
  const plan: LegacyMigrationPlan = {
    schema: LEGACY_MIGRATION_PLAN_SCHEMA,
    planId: expectedPlanId(fingerprint),
    batchId: expectedBatchId(source, fingerprint),
    source,
    operations,
    targetRefs,
    fingerprint,
  };
  assertLegacyMigrationPlan(plan);
  return plan;
}

/** Validates a serialized plan before a writer accepts it. */
export function validateLegacyMigrationPlan(plan: unknown): LegacyMigrationPlanValidationResult {
  const errors = new Set<LegacyMigrationPlanValidationError>();
  if (
    !isRecord(plan) ||
    !hasOnlyKeys(plan, [
      'schema',
      'planId',
      'batchId',
      'source',
      'operations',
      'targetRefs',
      'fingerprint',
    ])
  ) {
    return { ok: false, errors: ['invalid_plan_shape'] };
  }
  if (plan.schema !== LEGACY_MIGRATION_PLAN_SCHEMA) errors.add('invalid_plan_schema');
  if (!validSource(plan.source)) errors.add('invalid_plan_source');
  if (!Array.isArray(plan.operations) || !Array.isArray(plan.targetRefs)) {
    errors.add('invalid_plan_shape');
  }

  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  const targetRefs = Array.isArray(plan.targetRefs) ? plan.targetRefs : [];
  const sourceKeys = new Set<string>();
  let previous: LegacyMigrationPlanOperation | undefined;
  for (const [index, operation] of operations.entries()) {
    if (!validOperation(operation)) {
      errors.add('invalid_operation');
      continue;
    }
    if (
      operation.ordinal !== index ||
      sourceKeys.has(`${operation.scope}\u0000${operation.sourceKey}`)
    ) {
      errors.add('operation_order_mismatch');
    }
    sourceKeys.add(`${operation.scope}\u0000${operation.sourceKey}`);
    if (
      previous &&
      (compareText(previous.sourceKey, operation.sourceKey) > 0 ||
        (previous.sourceKey === operation.sourceKey &&
          compareText(previous.scope, operation.scope) > 0))
    ) {
      errors.add('operation_order_mismatch');
    }
    if (operation.disposition === 'blocking_error') {
      errors.add('blocking_disposition_present');
    }
    previous = operation;
  }
  if (operations.length !== targetRefs.length) errors.add('target_ref_proof_mismatch');
  for (const [index, proof] of targetRefs.entries()) {
    const operation = operations[index];
    if (
      !isRecord(proof) ||
      !hasOnlyKeys(proof, ['scope', 'sourceKey', 'targetRefs']) ||
      (proof.scope !== 'root_rows' && proof.scope !== 'embedded_json_members') ||
      typeof proof.sourceKey !== 'string' ||
      !SHA256_PATTERN.test(proof.sourceKey) ||
      !validTargetRefs(proof.targetRefs) ||
      !validOperation(operation) ||
      proof.scope !== operation.scope ||
      proof.sourceKey !== operation.sourceKey ||
      hashCanonical(proof.targetRefs) !== hashCanonical(operation.targetRefs)
    ) {
      errors.add('target_ref_proof_mismatch');
    }
  }

  if (
    typeof plan.fingerprint !== 'string' ||
    !SHA256_PATTERN.test(plan.fingerprint) ||
    !validSource(plan.source) ||
    operations.some((operation) => !validOperation(operation)) ||
    targetRefs.some(
      (proof) =>
        !isRecord(proof) ||
        !hasOnlyKeys(proof, ['scope', 'sourceKey', 'targetRefs']) ||
        !validTargetRefs(proof.targetRefs),
    )
  ) {
    errors.add('plan_fingerprint_mismatch');
  } else {
    const fingerprint = hashCanonical(
      planFingerprintInput(
        plan.source,
        operations as readonly LegacyMigrationPlanOperation[],
        targetRefs as readonly LegacyMigrationPlanTargetRefProof[],
      ),
    );
    if (plan.fingerprint !== fingerprint) errors.add('plan_fingerprint_mismatch');
    if (
      typeof plan.planId !== 'string' ||
      typeof plan.batchId !== 'string' ||
      !ENTITY_ID_PATTERN.test(plan.planId) ||
      !ENTITY_ID_PATTERN.test(plan.batchId) ||
      plan.planId !== expectedPlanId(fingerprint) ||
      plan.batchId !== expectedBatchId(plan.source, fingerprint)
    ) {
      errors.add('plan_identity_mismatch');
    }
  }
  return { ok: errors.size === 0, errors: [...errors].sort(compareText) };
}

export function assertLegacyMigrationPlan(plan: unknown): asserts plan is LegacyMigrationPlan {
  const validation = validateLegacyMigrationPlan(plan);
  if (validation.ok) return;
  if (validation.errors.includes('target_ref_proof_mismatch')) {
    throw new TypeError('Legacy migration plan target reference proof does not match');
  }
  throw new TypeError(`Legacy migration plan is invalid: ${validation.errors.join(', ')}`);
}
