import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_ROW_CLASSIFICATION_ROUTES,
  legacyRowClassifierFor,
} from './classification-routes.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';
import { classifyLegacyRootRows } from './root-row-classification.js';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseWithOneRowPerFrozenTable(
  databaseName: keyof typeof I0_LEGACY_SOURCE_SCHEMAS,
): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  for (const table of I0_LEGACY_SOURCE_SCHEMAS[databaseName].tables) {
    database.exec(
      `CREATE TABLE ${quoteIdentifier(table.name)} (${table.columns
        .map((column) => `${quoteIdentifier(column)} TEXT`)
        .join(', ')})`,
    );
    database.exec(`INSERT INTO ${quoteIdentifier(table.name)} DEFAULT VALUES`);
  }
  return database;
}

function mediaReport(hash: string): LegacyMediaPreflightReport {
  return {
    database: { assetCount: 1, declaredBytes: '10', nullOrZeroSizeCount: 0 },
    cas: { mediaFileCount: 1, mediaBytes: '10', sidecarFileCount: 0, sidecarBytes: '0' },
    verifiedAssetCount: 1,
    verifiedAssetHashes: [hash],
    fingerprint: createHash('sha256').update('route-coverage-media').digest('hex'),
    blockers: [],
    ok: true,
  };
}

describe('Legacy row classification routes', () => {
  it('assigns every frozen source table to exactly one explicit classifier owner', () => {
    const expected = (['main', 'prompts'] as const).flatMap((database) =>
      I0_LEGACY_SOURCE_SCHEMAS[database].tables.map((table) => `${database}.${table.name}`),
    );
    const actual = LEGACY_ROW_CLASSIFICATION_ROUTES.flatMap((route) =>
      route.tables.map((table) => `${route.database}.${table}`),
    );

    expect(actual).toHaveLength(39);
    expect(new Set(actual).size).toBe(actual.length);
    expect([...actual].sort()).toEqual([...expected].sort());
    expect(LEGACY_ROW_CLASSIFICATION_ROUTES.every((route) => route.tables.length > 0)).toBe(true);
  });

  it('returns exact split owners and rejects unsupported source names', () => {
    expect(legacyRowClassifierFor('main', 'canvases')).toBe('project_canvas');
    expect(legacyRowClassifierFor('main', 'asset_entries_fts')).toBe('derived_projection');
    expect(legacyRowClassifierFor('main', 'snapshots')).toBe('offline_snapshot');
    expect(legacyRowClassifierFor('main', 'preset_overrides')).toBe('legacy_skill_candidate');
    expect(legacyRowClassifierFor('prompts', 'process_prompts')).toBe('legacy_skill_candidate');
    expect(() => legacyRowClassifierFor('main', 'future_table')).toThrow(
      'Unsupported Legacy classification source main.future_table',
    );
  });

  it('produces an explicit root disposition for one row from every frozen source table', () => {
    const main = databaseWithOneRowPerFrozenTable('main');
    const prompts = databaseWithOneRowPerFrozenTable('prompts');
    const mediaHash = createHash('sha256').update('route-coverage-media-bytes').digest('hex');
    try {
      main
        .prepare(
          `UPDATE asset_contents
           SET hash = ?, type = 'image', format = 'png', file_size = '10'`,
        )
        .run(mediaHash);
      main
        .prepare(`UPDATE asset_entries SET id = 'asset.route-coverage', asset_hash = ?`)
        .run(mediaHash);

      const report = classifyLegacyRootRows(
        { main, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        mediaReport(mediaHash),
        {
          classifyLegacySkillRows: (rows) =>
            rows.map(({ subject }) => ({
              subject,
              disposition: 'blocking_error' as const,
              reasonCode: 'legacy_skill_candidate_requires_review',
              targetRefs: [],
              exportRef: null,
              blockerCode: 'legacy_skill_candidate_requires_review',
            })),
        },
      );

      expect(report.inventory.rowCount).toBe(39);
      expect(report.classification.counts).toMatchObject({
        subjectCount: 39,
        classifiedCount: 39,
      });
      expect(
        report.classification.blockers.every(({ kind }) => kind === 'classified_blocking_error'),
      ).toBe(true);
      expect(report.classification.entries).toHaveLength(39);
      expect(
        new Set(
          report.classification.entries.map(
            ({ subject }) => `${subject.database}.${subject.table}`,
          ),
        ),
      ).toEqual(
        new Set(
          LEGACY_ROW_CLASSIFICATION_ROUTES.flatMap((route) =>
            route.tables.map((table) => `${route.database}.${table}`),
          ),
        ),
      );
    } finally {
      prompts.close();
      main.close();
    }
  });
});
