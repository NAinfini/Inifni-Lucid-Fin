import { hashCanonical } from '../internal/hashes.js';
import {
  LEGACY_MIGRATION_DISPOSITIONS,
  type LegacyMigrationDisposition,
} from './classification-report.js';
import type { LegacyPreflightReport } from './legacy-preflight.js';
import type { LegacyPhaseOneClassificationReport } from './phase-one-classification.js';

export type LegacyMigrationReadinessBlocker =
  | { readonly kind: 'source_snapshot_mismatch' }
  | { readonly kind: 'preflight_blocked'; readonly findingCount: number }
  | { readonly kind: 'run_history_preflight_blocked'; readonly findingCount: number }
  | { readonly kind: 'task_history_preflight_blocked'; readonly findingCount: number }
  | { readonly kind: 'conversation_preflight_blocked'; readonly findingCount: number }
  | { readonly kind: 'root_classification_blocked'; readonly findingCount: number }
  | { readonly kind: 'embedded_json_classification_blocked'; readonly findingCount: number };

export interface LegacyMigrationReadinessReport {
  readonly schema: 'lucid-fin.legacy-migration-readiness/v1';
  readonly status: 'ready_for_disposable_dry_run' | 'blocked_before_target_write';
  readonly source: Readonly<{
    schemaFingerprint: string;
    contentFingerprint: string;
    preflightFingerprint: string;
    classificationFingerprint: string;
    phaseOneFingerprint: string;
  }>;
  readonly counts: Readonly<{
    rootSubjectCount: number;
    embeddedSubjectCount: number;
    classifiedSubjectCount: number;
    targetRefCount: number;
    cloneRefCount: number;
    byDisposition: Readonly<Record<LegacyMigrationDisposition, number>>;
  }>;
  readonly blockers: readonly LegacyMigrationReadinessBlocker[];
  readonly fingerprint: string;
  readonly ok: boolean;
}

export interface LegacyMigrationReadinessInput {
  readonly preflight: LegacyPreflightReport;
  readonly phaseOne: LegacyPhaseOneClassificationReport;
}

function combinedDispositionCounts(
  phaseOne: LegacyPhaseOneClassificationReport,
): Record<LegacyMigrationDisposition, number> {
  return Object.fromEntries(
    LEGACY_MIGRATION_DISPOSITIONS.map((disposition) => [
      disposition,
      phaseOne.rootRows.classification.counts.byDisposition[disposition] +
        phaseOne.embeddedJson.classification.counts.byDisposition[disposition],
    ]),
  ) as Record<LegacyMigrationDisposition, number>;
}

/**
 * Binds read-only preflight and Phase-1 evidence before a disposable target
 * store may be created. This gate never opens or writes a target database.
 */
export function buildLegacyMigrationReadinessReport(
  input: LegacyMigrationReadinessInput,
): LegacyMigrationReadinessReport {
  const { preflight, phaseOne } = input;
  const blockers: LegacyMigrationReadinessBlocker[] = [];
  if (preflight.source.contentFingerprint !== phaseOne.sourceContentFingerprint) {
    blockers.push({ kind: 'source_snapshot_mismatch' });
  }
  if (!preflight.ok) {
    blockers.push({ kind: 'preflight_blocked', findingCount: preflight.blockers.length });
  }
  if (!phaseOne.rootRows.ok) {
    blockers.push({
      kind: 'root_classification_blocked',
      findingCount: phaseOne.rootRows.classification.blockers.length,
    });
  }
  if (phaseOne.rootRows.runHistory?.ok === false) {
    blockers.push({
      kind: 'run_history_preflight_blocked',
      findingCount: phaseOne.rootRows.runHistory.blockers.length,
    });
  }
  if (phaseOne.rootRows.taskHistory?.ok === false) {
    blockers.push({
      kind: 'task_history_preflight_blocked',
      findingCount: phaseOne.rootRows.taskHistory.blockers.length,
    });
  }
  if (phaseOne.embeddedJson.conversationPreflight?.ok === false) {
    blockers.push({
      kind: 'conversation_preflight_blocked',
      findingCount: phaseOne.embeddedJson.conversationPreflight.blockers.length,
    });
  }
  if (!phaseOne.embeddedJson.ok) {
    blockers.push({
      kind: 'embedded_json_classification_blocked',
      findingCount: phaseOne.embeddedJson.classification.blockers.length,
    });
  }

  const rootCounts = phaseOne.rootRows.classification.counts;
  const embeddedCounts = phaseOne.embeddedJson.classification.counts;
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-migration-readiness/v1' as const,
    status:
      blockers.length === 0
        ? ('ready_for_disposable_dry_run' as const)
        : ('blocked_before_target_write' as const),
    source: {
      schemaFingerprint: preflight.source.schemaFingerprint,
      contentFingerprint: preflight.source.contentFingerprint,
      preflightFingerprint: preflight.fingerprint,
      classificationFingerprint: phaseOne.sourceFingerprint,
      phaseOneFingerprint: phaseOne.fingerprint,
    },
    counts: {
      rootSubjectCount: rootCounts.subjectCount,
      embeddedSubjectCount: embeddedCounts.subjectCount,
      classifiedSubjectCount: rootCounts.classifiedCount + embeddedCounts.classifiedCount,
      targetRefCount: rootCounts.targetRefCount + embeddedCounts.targetRefCount,
      cloneRefCount: rootCounts.cloneRefCount + embeddedCounts.cloneRefCount,
      byDisposition: combinedDispositionCounts(phaseOne),
    },
    blockers,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
    ok: blockers.length === 0,
  };
}
