import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Maps only rows whose source bytes passed the complete CAS preflight. */
export function classifyVerifiedLegacyMediaBlobRows(
  rows: readonly LegacyClassificationRow[],
  media: LegacyMediaPreflightReport,
): readonly LegacyClassificationEntryInput[] {
  if (!media.ok || media.blockers.length > 0) {
    throw new TypeError('MediaBlob classification requires a successful media preflight');
  }
  if (
    rows.length !== media.database.assetCount ||
    rows.length !== media.verifiedAssetCount ||
    rows.length !== media.verifiedAssetHashes.length
  ) {
    throw new TypeError(
      'MediaBlob classification row count does not match the verified media report',
    );
  }

  const hashes = new Set<string>();
  const entries = rows.map((row): LegacyClassificationEntryInput => {
    if (row.database !== 'main' || row.table !== 'asset_contents' || row.subject.path !== '$') {
      throw new TypeError(
        `MediaBlob classifier received ${row.database}.${row.table}:${row.subject.path}`,
      );
    }
    const hash = row.values.hash;
    if (typeof hash !== 'string' || !SHA256_PATTERN.test(hash)) {
      throw new TypeError('Verified MediaBlob row has an invalid hash');
    }
    if (hashes.has(hash)) throw new TypeError('MediaBlob classification contains duplicate hashes');
    hashes.add(hash);
    return {
      subject: row.subject,
      disposition: 'migrated_current_state',
      reasonCode: 'verified_legacy_media_blob',
      targetRefs: [{ authority: 'media_blob', id: hash, projectId: null }],
      exportRef: null,
      blockerCode: null,
    };
  });
  const actualHashes = [...hashes].sort((left, right) => left.localeCompare(right));
  const verifiedHashes = [...media.verifiedAssetHashes].sort((left, right) =>
    left.localeCompare(right),
  );
  if (
    new Set(verifiedHashes).size !== verifiedHashes.length ||
    actualHashes.some((hash, index) => hash !== verifiedHashes[index])
  ) {
    throw new TypeError('MediaBlob classification hashes do not match the verified media report');
  }
  return entries.sort((left, right) =>
    legacyClassificationSourceKey(left.subject).localeCompare(
      legacyClassificationSourceKey(right.subject),
    ),
  );
}
