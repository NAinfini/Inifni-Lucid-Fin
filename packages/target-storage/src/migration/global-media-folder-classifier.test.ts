import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildLegacyClassificationReport } from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';
import { classifyLegacyGlobalMediaFolderRows } from './global-media-folder-classifier.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function folderRow(
  id: unknown,
  parentId: unknown,
  label: string,
  overrides: Readonly<Record<string, unknown>> = {},
): LegacyClassificationRow {
  return {
    database: 'main',
    table: 'asset_folders',
    kind: 'table',
    columns: ['created_at', 'id', 'name', 'parent_id', 'sort_order', 'updated_at'],
    subject: { database: 'main', table: 'asset_folders', rowKey: digest(label), path: '$' },
    values: {
      id,
      parent_id: parentId,
      name: `Folder ${label}`,
      sort_order: 0n,
      created_at: 1_700_000_000_000n,
      updated_at: 1_700_000_000_100n,
      ...overrides,
    },
  };
}

describe('Legacy GlobalMediaFolder classifier', () => {
  it('preserves stable identities for a valid hierarchy, including empty folders', () => {
    const root = folderRow('folder.root', null, 'private-root');
    const child = folderRow('folder.child', 'folder.root', 'private-child', { sort_order: -2n });
    const empty = folderRow('folder.empty', null, 'private-empty', { sort_order: 5n });

    const report = buildLegacyClassificationReport({
      sourceFingerprint: digest('source'),
      subjects: [root.subject, child.subject, empty.subject],
      entries: classifyLegacyGlobalMediaFolderRows([child, empty, root]),
    });

    expect(report).toMatchObject({
      ok: true,
      counts: {
        classifiedCount: 3,
        targetRefCount: 3,
        byDisposition: { migrated_current_state: 3 },
      },
    });
    expect(report.entries.flatMap(({ targetRefs }) => targetRefs.map(({ id }) => id))).toEqual(
      expect.arrayContaining(['folder.root', 'folder.child', 'folder.empty']),
    );
    expect(JSON.stringify(report)).not.toContain('private-root');
    expect(JSON.stringify(report)).not.toContain('private-child');
  });

  it('blocks invalid, orphaned, cyclic, ambiguous, and parent-dependent rows', () => {
    const duplicateOne = folderRow('folder.duplicate', null, 'duplicate-1');
    const duplicateTwo = folderRow('folder.duplicate', null, 'duplicate-2');
    const invalidName = folderRow('folder.invalid-name', null, 'invalid-name', {
      name: ' padded ',
    });
    const invalidTime = folderRow('folder.invalid-time', null, 'invalid-time', {
      created_at: 2_000n,
      updated_at: 1_000n,
    });
    const orphan = folderRow('folder.orphan', 'folder.missing', 'orphan');
    const self = folderRow('folder.self', 'folder.self', 'self');
    const cycleA = folderRow('folder.cycle-a', 'folder.cycle-b', 'cycle-a');
    const cycleB = folderRow('folder.cycle-b', 'folder.cycle-a', 'cycle-b');
    const cycleChild = folderRow('folder.cycle-child', 'folder.cycle-a', 'cycle-child');
    const rows = [
      duplicateOne,
      duplicateTwo,
      invalidName,
      invalidTime,
      orphan,
      self,
      cycleA,
      cycleB,
      cycleChild,
    ];

    const report = buildLegacyClassificationReport({
      sourceFingerprint: digest('source'),
      subjects: rows.map(({ subject }) => subject),
      entries: classifyLegacyGlobalMediaFolderRows(rows),
    });

    expect(report.counts.byDisposition.blocking_error).toBe(rows.length);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ blockerCode: 'duplicate_global_media_folder_id' }),
        expect.objectContaining({ blockerCode: 'invalid_global_media_folder_name' }),
        expect.objectContaining({ blockerCode: 'global_media_folder_timestamp_order' }),
        expect.objectContaining({ blockerCode: 'missing_global_media_folder_parent' }),
        expect.objectContaining({ blockerCode: 'self_referencing_global_media_folder' }),
        expect.objectContaining({ blockerCode: 'cyclic_global_media_folder_hierarchy' }),
        expect.objectContaining({ blockerCode: 'unmigratable_global_media_folder_parent' }),
      ]),
    );
    expect(report.ok).toBe(false);
  });
});
