import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildLegacyClassificationReport } from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import { classifyLegacyGlobalMediaAssetRows } from './global-media-asset-classifier.js';
import { classifyLegacyGlobalMediaFolderRows } from './global-media-folder-classifier.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assetRow(
  id: unknown,
  assetHash: unknown,
  label: string,
  folderId: unknown = null,
): LegacyClassificationRow {
  return {
    database: 'main',
    table: 'asset_entries',
    kind: 'table',
    columns: ['asset_hash', 'display_name', 'folder_id', 'id'],
    subject: { database: 'main', table: 'asset_entries', rowKey: digest(label), path: '$' },
    values: { id, asset_hash: assetHash, folder_id: folderId, display_name: 'Private media title' },
  };
}

describe('Legacy GlobalMediaAsset classifier', () => {
  it('preserves stable entry identity only when its MediaBlob is verified', () => {
    const blobHash = digest('blob');
    const row = assetRow('asset.1', blobHash, 'row-1');

    const report = buildLegacyClassificationReport({
      sourceFingerprint: digest('source'),
      subjects: [row.subject],
      entries: classifyLegacyGlobalMediaAssetRows([row], new Set([blobHash]), new Set()),
    });

    expect(report).toMatchObject({
      ok: true,
      counts: { classifiedCount: 1, targetRefCount: 1 },
      entries: [
        {
          disposition: 'migrated_current_state',
          reasonCode: 'legacy_global_media_asset_identity',
          targetRefs: [
            {
              authority: 'global_media_asset',
              id: 'asset.1',
              projectId: null,
              cloneOf: null,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(report)).not.toContain('Private media title');
  });

  it('classifies invalid identities and unresolved Blob refs as blocking errors', () => {
    const validBlob = digest('valid');
    const rows = [
      assetRow('bad id', validBlob, 'invalid-id'),
      assetRow('asset.invalid-hash', 'NOT-A-HASH', 'invalid-hash'),
      assetRow('asset.missing', digest('missing'), 'missing'),
      assetRow('asset.duplicate', validBlob, 'duplicate-1'),
      assetRow('asset.duplicate', validBlob, 'duplicate-2'),
      assetRow('asset.invalid-folder', validBlob, 'invalid-folder', 'bad folder'),
      assetRow('asset.missing-folder', validBlob, 'missing-folder', 'folder.missing'),
    ];

    const report = buildLegacyClassificationReport({
      sourceFingerprint: digest('source'),
      subjects: rows.map(({ subject }) => subject),
      entries: classifyLegacyGlobalMediaAssetRows(rows, new Set([validBlob]), new Set()),
    });

    expect(report.counts).toMatchObject({
      classifiedCount: 7,
      byDisposition: { blocking_error: 7 },
    });
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockerCode: 'invalid_global_media_asset_id' }),
        expect.objectContaining({ blockerCode: 'invalid_media_blob_reference' }),
        expect.objectContaining({ blockerCode: 'unverified_media_blob_reference' }),
        expect.objectContaining({ blockerCode: 'duplicate_global_media_asset_id' }),
        expect.objectContaining({ blockerCode: 'invalid_global_media_folder_id' }),
        expect.objectContaining({ blockerCode: 'unverified_global_media_folder_reference' }),
      ]),
    );
    expect(report.ok).toBe(false);
  });

  it('migrates a foldered asset only through a verified GlobalMediaFolder identity', () => {
    const blobHash = digest('blob');
    const asset = assetRow('asset.foldered', blobHash, 'asset', 'folder.1');
    const folder: LegacyClassificationRow = {
      database: 'main',
      table: 'asset_folders',
      kind: 'table',
      columns: ['created_at', 'id', 'name', 'parent_id', 'sort_order', 'updated_at'],
      subject: { database: 'main', table: 'asset_folders', rowKey: digest('folder'), path: '$' },
      values: {
        id: 'folder.1',
        parent_id: null,
        name: 'Private folder',
        sort_order: 0n,
        created_at: 1_700_000_000_000n,
        updated_at: 1_700_000_000_100n,
      },
    };
    const folderEntries = classifyLegacyGlobalMediaFolderRows([folder]);
    const verifiedFolderIds = new Set(
      folderEntries.flatMap(({ targetRefs }) => targetRefs.map(({ id }) => id)),
    );

    const report = buildLegacyClassificationReport({
      sourceFingerprint: digest('source'),
      subjects: [asset.subject, folder.subject],
      entries: [
        ...folderEntries,
        ...classifyLegacyGlobalMediaAssetRows([asset], new Set([blobHash]), verifiedFolderIds),
      ],
    });

    expect(report.counts.byDisposition.migrated_current_state).toBe(2);
    expect(report.blockers).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('Private folder');
    expect(report.ok).toBe(true);
  });
});
