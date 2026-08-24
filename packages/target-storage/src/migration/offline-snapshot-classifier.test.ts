import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildLegacyClassificationReport,
  legacyClassificationSourceKey,
  type LegacyClassificationSubject,
} from './classification-report.js';
import {
  classifyLegacyDerivedProjectionRows,
  classifyLegacyOfflineSnapshotRows,
} from './offline-snapshot-classifier.js';

function snapshotSubject(row: string): LegacyClassificationSubject {
  return {
    database: 'main',
    table: 'snapshots',
    rowKey: createHash('sha256').update(row).digest('hex'),
    path: '$',
  };
}

describe('Legacy offline Snapshot classifier', () => {
  it('classifies every Snapshot root as a stable offline export without target refs', () => {
    const first = snapshotSubject('snapshot-1');
    const second = snapshotSubject('snapshot-2');

    const entries = classifyLegacyOfflineSnapshotRows([second, first]);

    expect(entries.map(({ subject }) => legacyClassificationSourceKey(subject))).toEqual(
      [first, second]
        .map(legacyClassificationSourceKey)
        .sort((left, right) => left.localeCompare(right)),
    );
    expect(entries).toEqual(
      entries.map(({ subject }) => ({
        subject,
        disposition: 'offline_legacy_export',
        reasonCode: 'legacy_snapshot_offline_backup',
        targetRefs: [],
        exportRef: `legacy-export/main/snapshots/${legacyClassificationSourceKey(subject)}`,
        blockerCode: null,
      })),
    );
    expect(
      buildLegacyClassificationReport({
        sourceFingerprint: createHash('sha256').update('snapshot-source').digest('hex'),
        subjects: [first, second],
        entries,
      }),
    ).toMatchObject({
      ok: true,
      counts: {
        subjectCount: 2,
        classifiedCount: 2,
        byDisposition: { offline_legacy_export: 2 },
      },
    });
  });

  it('rejects subjects outside the exact main.snapshots root boundary', () => {
    const snapshot = snapshotSubject('snapshot-1');

    expect(() => classifyLegacyOfflineSnapshotRows([{ ...snapshot, table: 'canvases' }])).toThrow(
      'Offline Snapshot classifier received main.canvases:$',
    );
    expect(() => classifyLegacyOfflineSnapshotRows([{ ...snapshot, path: '$.data' }])).toThrow(
      'Offline Snapshot classifier received main.snapshots:$.data',
    );
  });

  it('accounts for derived FTS rows without treating them as target authority', () => {
    const projection = { ...snapshotSubject('projection-1'), table: 'asset_entries_fts' };

    expect(classifyLegacyDerivedProjectionRows([projection])).toEqual([
      {
        subject: projection,
        disposition: 'offline_legacy_export',
        reasonCode: 'legacy_derived_projection_rebuild',
        targetRefs: [],
        exportRef: `legacy-export/main/asset_entries_fts/${legacyClassificationSourceKey(projection)}`,
        blockerCode: null,
      },
    ]);
    expect(() =>
      classifyLegacyDerivedProjectionRows([{ ...projection, table: 'asset_entries' }]),
    ).toThrow('Derived Projection classifier received main.asset_entries:$');
  });
});
