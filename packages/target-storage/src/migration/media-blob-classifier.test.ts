import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildLegacyClassificationReport } from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import { classifyVerifiedLegacyMediaBlobRows } from './media-blob-classifier.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mediaRow(hash: string, label: string): LegacyClassificationRow {
  return {
    database: 'main',
    table: 'asset_contents',
    kind: 'table',
    columns: ['hash', 'prompt'],
    subject: { database: 'main', table: 'asset_contents', rowKey: digest(label), path: '$' },
    values: { hash, prompt: 'C:\\Users\\person\\private prompt.mov' },
  };
}

function verifiedMediaReport(count: number): LegacyMediaPreflightReport {
  return {
    database: { assetCount: count, declaredBytes: '20', nullOrZeroSizeCount: 0 },
    cas: { mediaFileCount: count, mediaBytes: '20', sidecarFileCount: 0, sidecarBytes: '0' },
    verifiedAssetCount: count,
    verifiedAssetHashes: Array.from({ length: count }, (_, index) => digest(`blob-${index + 1}`)),
    fingerprint: digest(`media:${count}`),
    blockers: [],
    ok: true,
  };
}

describe('Legacy MediaBlob classifier', () => {
  it('maps every verified asset_content hash to one target MediaBlob identity', () => {
    const first = mediaRow(digest('blob-1'), 'row-1');
    const second = mediaRow(digest('blob-2'), 'row-2');

    const entries = classifyVerifiedLegacyMediaBlobRows([second, first], verifiedMediaReport(2));
    const report = buildLegacyClassificationReport({
      sourceFingerprint: digest('source'),
      subjects: [first.subject, second.subject],
      entries,
    });

    expect(report).toMatchObject({
      ok: true,
      counts: {
        subjectCount: 2,
        classifiedCount: 2,
        targetRefCount: 2,
        byDisposition: { migrated_current_state: 2 },
      },
    });
    expect(report.entries.map(({ targetRefs }) => targetRefs)).toEqual(
      expect.arrayContaining([
        [{ authority: 'media_blob', id: first.values.hash, projectId: null, cloneOf: null }],
        [{ authority: 'media_blob', id: second.values.hash, projectId: null, cloneOf: null }],
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('private prompt.mov');
  });

  it('rejects unverified, mismatched, duplicate, or out-of-bound rows', () => {
    const valid = mediaRow(digest('blob-1'), 'row-1');
    expect(() =>
      classifyVerifiedLegacyMediaBlobRows([valid], {
        ...verifiedMediaReport(1),
        blockers: [
          { kind: 'missing_media_bytes', hash: digest('blob-1'), expectedRelativePath: '' },
        ],
        ok: false,
      }),
    ).toThrow('MediaBlob classification requires a successful media preflight');
    expect(() => classifyVerifiedLegacyMediaBlobRows([valid], verifiedMediaReport(2))).toThrow(
      'MediaBlob classification row count does not match the verified media report',
    );
    expect(() =>
      classifyVerifiedLegacyMediaBlobRows([valid], {
        ...verifiedMediaReport(1),
        verifiedAssetHashes: [digest('different-blob')],
      }),
    ).toThrow('MediaBlob classification hashes do not match the verified media report');
    expect(() =>
      classifyVerifiedLegacyMediaBlobRows(
        [valid, { ...valid, subject: { ...valid.subject, rowKey: digest('row-2') } }],
        verifiedMediaReport(2),
      ),
    ).toThrow('MediaBlob classification contains duplicate hashes');
    expect(() =>
      classifyVerifiedLegacyMediaBlobRows(
        [
          {
            ...valid,
            table: 'asset_entries',
            subject: { ...valid.subject, table: 'asset_entries' },
          },
        ],
        verifiedMediaReport(1),
      ),
    ).toThrow('MediaBlob classifier received main.asset_entries:$');
  });
});
