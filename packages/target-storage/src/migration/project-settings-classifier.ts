import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';

const APP_SETTINGS_KEY = 'appSettings';
const STYLE_GUIDE_KEY = 'styleGuide';

function compareEntries(
  left: LegacyClassificationEntryInput,
  right: LegacyClassificationEntryInput,
): number {
  const leftKey = legacyClassificationSourceKey(left.subject);
  const rightKey = legacyClassificationSourceKey(right.subject);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

/**
 * Freezes the only two keys read from project_settings by the Legacy runtime.
 * The table is global KV state despite its name: appSettings has no frozen
 * Target owner yet, while the unbound style guide belongs only in the Legacy
 * export. Unknown keys stop cutover instead of being silently dropped.
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

      if (row.values.key === STYLE_GUIDE_KEY) {
        return {
          subject: row.subject,
          disposition: 'offline_legacy_export',
          reasonCode: 'legacy_unbound_style_guide_offline_export',
          targetRefs: [],
          exportRef: `legacy-export/main/project_settings/${legacyClassificationSourceKey(row.subject)}`,
          blockerCode: null,
        };
      }

      const blockerCode =
        row.values.key === APP_SETTINGS_KEY
          ? 'legacy_global_app_settings_target_unfrozen'
          : 'unknown_legacy_project_setting_key';
      return {
        subject: row.subject,
        disposition: 'blocking_error',
        reasonCode: blockerCode,
        targetRefs: [],
        exportRef: null,
        blockerCode,
      };
    })
    .sort(compareEntries);
}
