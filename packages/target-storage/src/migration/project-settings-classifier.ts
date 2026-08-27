import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import { LEGACY_PROJECT_SETTING_POLICIES } from './legacy-migration-policy.js';

function compareEntries(
  left: LegacyClassificationEntryInput,
  right: LegacyClassificationEntryInput,
): number {
  const leftKey = legacyClassificationSourceKey(left.subject);
  const rightKey = legacyClassificationSourceKey(right.subject);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

/**
 * Applies the one frozen key-owner registry. The table is global KV state
 * despite its name, so known values are retained offline and unknown keys
 * stop cutover instead of being guessed into Project truth.
 */
export function classifyLegacyProjectSettingRows(
  rows: readonly LegacyClassificationRow[],
): readonly LegacyClassificationEntryInput[] {
  return rows
    .map((row): LegacyClassificationEntryInput => {
      if (row.database !== 'main' || row.table !== 'project_settings' || row.subject.path !== '$') {
        throw new TypeError(
          `Legacy Project settings classifier received ${row.database}.${row.table}:${row.subject.path}`,
        );
      }

      const exactPolicy = LEGACY_PROJECT_SETTING_POLICIES.find(
        (policy) => policy.key === row.values.key,
      );
      const policy = exactPolicy ?? LEGACY_PROJECT_SETTING_POLICIES.find(({ key }) => key === '*');
      if (!policy) throw new Error('Legacy Project setting policy registry has no fallback');

      if (policy.disposition === 'offline_legacy_export') {
        return {
          subject: row.subject,
          disposition: 'offline_legacy_export',
          reasonCode: policy.reasonCode,
          targetRefs: [],
          exportRef: `legacy-export/main/project_settings/${legacyClassificationSourceKey(row.subject)}`,
          blockerCode: null,
        };
      }

      return {
        subject: row.subject,
        disposition: 'blocking_error',
        reasonCode: policy.reasonCode,
        targetRefs: [],
        exportRef: null,
        blockerCode: policy.reasonCode,
      };
    })
    .sort(compareEntries);
}
