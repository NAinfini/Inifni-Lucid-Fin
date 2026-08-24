import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function blockingEntry(
  row: LegacyClassificationRow,
  reasonCode: string,
  blockerCode: string,
): LegacyClassificationEntryInput {
  return {
    subject: row.subject,
    disposition: 'blocking_error',
    reasonCode,
    targetRefs: [],
    exportRef: null,
    blockerCode,
  };
}

/** Maps legacy catalog entries without copying names, tags, or paths into the report. */
export function classifyLegacyGlobalMediaAssetRows(
  rows: readonly LegacyClassificationRow[],
  verifiedBlobHashes: ReadonlySet<string>,
  verifiedFolderIds: ReadonlySet<string>,
): readonly LegacyClassificationEntryInput[] {
  const identityCounts = new Map<string, number>();
  for (const row of rows) {
    const id = row.values.id;
    if (typeof id === 'string' && ENTITY_ID_PATTERN.test(id)) {
      identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1);
    }
  }

  return rows
    .map((row): LegacyClassificationEntryInput => {
      if (row.database !== 'main' || row.table !== 'asset_entries' || row.subject.path !== '$') {
        throw new TypeError(
          `GlobalMediaAsset classifier received ${row.database}.${row.table}:${row.subject.path}`,
        );
      }
      const id = row.values.id;
      if (typeof id !== 'string' || !ENTITY_ID_PATTERN.test(id)) {
        return blockingEntry(
          row,
          'invalid_legacy_global_media_asset_identity',
          'invalid_global_media_asset_id',
        );
      }
      if (identityCounts.get(id) !== 1) {
        return blockingEntry(
          row,
          'duplicate_legacy_global_media_asset_identity',
          'duplicate_global_media_asset_id',
        );
      }
      const folderId = row.values.folder_id;
      if (folderId !== null) {
        if (typeof folderId !== 'string' || !ENTITY_ID_PATTERN.test(folderId)) {
          return blockingEntry(
            row,
            'invalid_legacy_global_media_folder_reference',
            'invalid_global_media_folder_id',
          );
        }
        if (!verifiedFolderIds.has(folderId)) {
          return blockingEntry(
            row,
            'unverified_legacy_global_media_folder_reference',
            'unverified_global_media_folder_reference',
          );
        }
      }
      const blobHash = row.values.asset_hash;
      if (typeof blobHash !== 'string' || !SHA256_PATTERN.test(blobHash)) {
        return blockingEntry(
          row,
          'invalid_legacy_media_blob_reference',
          'invalid_media_blob_reference',
        );
      }
      if (!verifiedBlobHashes.has(blobHash)) {
        return blockingEntry(
          row,
          'unverified_legacy_media_blob_reference',
          'unverified_media_blob_reference',
        );
      }
      return {
        subject: row.subject,
        disposition: 'migrated_current_state',
        reasonCode: 'legacy_global_media_asset_identity',
        targetRefs: [{ authority: 'global_media_asset', id, projectId: null }],
        exportRef: null,
        blockerCode: null,
      };
    })
    .sort((left, right) =>
      legacyClassificationSourceKey(left.subject).localeCompare(
        legacyClassificationSourceKey(right.subject),
      ),
    );
}
