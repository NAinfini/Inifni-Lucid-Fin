import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
  type LegacyClassificationSubject,
} from './classification-report.js';

const REASON_CODE = 'legacy_snapshot_offline_backup';

function offlineEntry(
  subject: LegacyClassificationSubject,
  reasonCode: string,
): LegacyClassificationEntryInput {
  const sourceKey = legacyClassificationSourceKey(subject);
  return {
    subject,
    disposition: 'offline_legacy_export',
    reasonCode,
    targetRefs: [],
    exportRef: `legacy-export/${subject.database}/${subject.table}/${sourceKey}`,
    blockerCode: null,
  };
}

function sorted(
  entries: readonly LegacyClassificationEntryInput[],
): readonly LegacyClassificationEntryInput[] {
  return [...entries].sort((left, right) =>
    legacyClassificationSourceKey(left.subject).localeCompare(
      legacyClassificationSourceKey(right.subject),
    ),
  );
}

/** Classifies frozen Snapshot rows, which are retained only in the migration bundle. */
export function classifyLegacyOfflineSnapshotRows(
  subjects: readonly LegacyClassificationSubject[],
): readonly LegacyClassificationEntryInput[] {
  return sorted(
    subjects.map((subject): LegacyClassificationEntryInput => {
      if (subject.database !== 'main' || subject.table !== 'snapshots' || subject.path !== '$') {
        throw new TypeError(
          `Offline Snapshot classifier received ${subject.database}.${subject.table}:${subject.path}`,
        );
      }
      return offlineEntry(subject, REASON_CODE);
    }),
  );
}

/** Accounts for Legacy FTS rows while rebuilding search from target catalog authority. */
export function classifyLegacyDerivedProjectionRows(
  subjects: readonly LegacyClassificationSubject[],
): readonly LegacyClassificationEntryInput[] {
  return sorted(
    subjects.map((subject): LegacyClassificationEntryInput => {
      if (
        subject.database !== 'main' ||
        subject.table !== 'asset_entries_fts' ||
        subject.path !== '$'
      ) {
        throw new TypeError(
          `Derived Projection classifier received ${subject.database}.${subject.table}:${subject.path}`,
        );
      }
      return offlineEntry(subject, 'legacy_derived_projection_rebuild');
    }),
  );
}
