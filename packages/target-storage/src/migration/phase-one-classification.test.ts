import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCanonical } from '../internal/hashes.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';
import { classifyLegacyPhaseOne } from './phase-one-classification.js';
import { preflightLegacyProductionMediaAttempts } from './production-media-attempt-preflight.js';
import { preflightLegacyScalarMediaReferences } from './scalar-media-preflight.js';
import type { LegacySourceExpectedSchemas } from './source-preflight.js';
import { preflightLegacyTaskEvaluationMedia } from './task-evaluation-media-preflight.js';

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function database(schema: string): DatabaseSync {
  const value = new DatabaseSync(':memory:');
  databases.push(value);
  value.exec(schema);
  return value;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function mediaReport(hashes: readonly string[]): LegacyMediaPreflightReport {
  return {
    database: {
      assetCount: hashes.length,
      declaredBytes: hashes.length === 0 ? '0' : '10',
      nullOrZeroSizeCount: 0,
    },
    cas: {
      mediaFileCount: hashes.length,
      mediaBytes: hashes.length === 0 ? '0' : '10',
      sidecarFileCount: 0,
      sidecarBytes: '0',
    },
    verifiedAssetCount: hashes.length,
    verifiedAssetHashes: hashes,
    fingerprint: digest('verified-media'),
    blockers: [],
    ok: true,
  };
}

describe('Legacy Phase-1 classification gate', () => {
  it('uses one missing-Project-owner conclusion for Plan rows and every valid content member', () => {
    const content = { Private: { value: 1 } };
    const contentHash = hashCanonical(content);
    const manifestHash = digest('Private manifest');
    const resumeTokenHash = digest('Private resume token');
    const main = database(`
      CREATE TABLE plan_documents (
        content_hash TEXT, content_json TEXT, created_at INTEGER, document_type TEXT,
        id TEXT, logical_key TEXT, revision INTEGER, schema_version INTEGER,
        status TEXT, task_list_id TEXT, updated_at INTEGER
      );
      CREATE TABLE plan_approvals (
        created_at INTEGER, decided_at INTEGER, gate_key TEXT, id TEXT,
        manifest_hash TEXT, resume_token_hash TEXT, status TEXT, subject_hash TEXT,
        subject_logical_key TEXT, subject_revision INTEGER, task_list_id TEXT, updated_at INTEGER
      );
    `);
    main
      .prepare('INSERT INTO plan_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        contentHash,
        JSON.stringify(content),
        1_700_000_000_000,
        'production_plan',
        'document.1',
        'production-plan',
        1,
        1,
        'active',
        'task-list.1',
        1_700_000_000_000,
      );
    main
      .prepare('INSERT INTO plan_approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        1_700_000_000_000,
        1_700_000_000_100,
        'production_plan',
        'approval.1',
        manifestHash,
        resumeTokenHash,
        'approved',
        contentHash,
        'production-plan',
        1,
        'task-list.1',
        1_700_000_000_100,
      );
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'plan_approvals',
            kind: 'table',
            columns: [
              'created_at',
              'decided_at',
              'gate_key',
              'id',
              'manifest_hash',
              'resume_token_hash',
              'status',
              'subject_hash',
              'subject_logical_key',
              'subject_revision',
              'task_list_id',
              'updated_at',
            ],
          },
          {
            name: 'plan_documents',
            kind: 'table',
            columns: [
              'content_hash',
              'content_json',
              'created_at',
              'document_type',
              'id',
              'logical_key',
              'revision',
              'schema_version',
              'status',
              'task_list_id',
              'updated_at',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const before = {
      documents: main.prepare('SELECT * FROM plan_documents').all(),
      approvals: main.prepare('SELECT * FROM plan_approvals').all(),
    };
    const sources = [
      { database: 'main', table: 'plan_documents', columns: ['content_json'] },
    ] as const;
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const first = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources,
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });
    const second = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: { sources },
    });

    expect(first).toEqual(second);
    expect(remainingPaths).toEqual([]);
    expect(first).toMatchObject({
      rootRows: {
        planHistory: { blockers: [], ok: true },
        classification: {
          counts: { subjectCount: 2, classifiedCount: 2, byDisposition: { blocking_error: 2 } },
          ok: false,
        },
        ok: false,
      },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 3, classifiedCount: 3, byDisposition: { blocking_error: 3 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      first.rootRows.classification.entries.every(
        ({ blockerCode, targetRefs, exportRef }) =>
          blockerCode === 'legacy_imported_history_project_owner_unresolved' &&
          targetRefs.length === 0 &&
          exportRef === null,
      ),
    ).toBe(true);
    expect(
      first.embeddedJson.classification.entries.every(
        ({ blockerCode, targetRefs, exportRef }) =>
          blockerCode === 'legacy_imported_history_project_owner_unresolved' &&
          targetRefs.length === 0 &&
          exportRef === null,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain(contentHash);
    expect(serialized).not.toContain(manifestHash);
    expect(serialized).not.toContain(resumeTokenHash);
    expect(main.prepare('SELECT * FROM plan_documents').all()).toEqual(before.documents);
    expect(main.prepare('SELECT * FROM plan_approvals').all()).toEqual(before.approvals);
  });

  it('requires and binds both root-row and embedded-member reports to one snapshot', () => {
    const main = database(`
      CREATE TABLE snapshots (data TEXT, id TEXT, label TEXT);
      INSERT INTO snapshots VALUES ('{"Private snapshot":1}', 'snapshot-1', 'Private label');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'snapshots', kind: 'table', columns: ['data', 'id', 'label'] }],
      },
      prompts: { tables: [] },
    };

    const first = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'snapshots', columns: ['data'] }],
      },
    });
    const second = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'snapshots', columns: ['data'] }],
      },
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: 'lucid-fin.legacy-phase-one-classification/v1',
      rootRows: { classification: { counts: { subjectCount: 1 }, ok: true }, ok: true },
      embeddedJson: {
        inventory: { subjectCount: 2, ok: true },
        classification: { counts: { subjectCount: 2 }, ok: true },
        ok: true,
      },
      ok: true,
    });
    expect(first.sourceFingerprint).toBe(first.rootRows.inventory.fingerprint);
    expect(first.sourceFingerprint).toBe(first.embeddedJson.inventory.sourceFingerprint);
    expect(first.sourceContentFingerprint).toBe(first.rootRows.inventory.sourceContentFingerprint);
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('Private');
  });

  it('cannot pass when a valid embedded member has no explicit owner', () => {
    const blobHash = digest('blob');
    const main = database(`
      CREATE TABLE asset_contents (generation_metadata TEXT, hash TEXT);
      INSERT INTO asset_contents VALUES ('{}', '${blobHash}');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'asset_contents',
            kind: 'table',
            columns: ['generation_metadata', 'hash'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const sources = [
      { database: 'main', table: 'asset_contents', columns: ['generation_metadata'] },
    ] as const;

    const incomplete = classifyLegacyPhaseOne(
      { main, prompts },
      expected,
      mediaReport([blobHash]),
      { embeddedJson: { sources } },
    );
    expect(incomplete).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: { blockers: [{ kind: 'unclassified_subject' }], ok: false },
        ok: false,
      },
      ok: false,
    });

    const complete = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([blobHash]), {
      embeddedJson: {
        sources,
        classifyMembers(members) {
          return members.map(({ subject }) => ({
            subject,
            disposition: 'immutable_provenance_history',
            reasonCode: 'legacy_generation_metadata_provenance',
            targetRefs: [{ authority: 'media_blob', id: blobHash, projectId: null }],
            exportRef: null,
            blockerCode: null,
          }));
        },
      },
    });
    expect(complete).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 1, byDisposition: { immutable_provenance_history: 1 } },
          blockers: [],
          ok: true,
        },
        ok: true,
      },
      ok: true,
    });
  });

  it('reuses root ownership for exact node entity paths without claiming sibling content', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT);
      CREATE TABLE characters (default_loadout_id TEXT, id TEXT, loadouts TEXT);
      CREATE TABLE canvas_nodes (canvas_id TEXT, data_json TEXT, id TEXT, type TEXT);
      INSERT INTO canvases VALUES (NULL, 'project.1');
      INSERT INTO characters VALUES ('', 'character.1', '[]');
      INSERT INTO canvas_nodes VALUES (
        'project.1',
        '{"characterRefs":[{"characterId":"character.1","loadoutId":""}],"prompt":"Private prompt"}',
        'node.1',
        'image'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'canvases', kind: 'table', columns: ['archived_at', 'id'] },
          {
            name: 'characters',
            kind: 'table',
            columns: ['default_loadout_id', 'id', 'loadouts'],
          },
          {
            name: 'canvas_nodes',
            kind: 'table',
            columns: ['canvas_id', 'data_json', 'id', 'type'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const sources = [{ database: 'main', table: 'canvas_nodes', columns: ['data_json'] }] as const;

    const incomplete = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: { sources },
    });
    expect(incomplete).toMatchObject({
      ownership: { blockers: [], ok: true },
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 6, classifiedCount: 5 },
          blockers: [{ kind: 'unclassified_subject' }],
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      incomplete.embeddedJson.classification.entries.filter(
        ({ reasonCode }) => reasonCode === 'legacy_typed_canvas_entity_reference',
      ),
    ).toHaveLength(3);
    expect(
      incomplete.embeddedJson.classification.entries
        .filter(({ reasonCode }) => reasonCode === 'legacy_typed_canvas_entity_reference')
        .every(({ targetRefs }) =>
          targetRefs.some(
            ({ authority, id, projectId }) =>
              authority === 'production' && id === 'character.1' && projectId === 'project.1',
          ),
        ),
    ).toBe(true);

    const remainingPaths: Array<readonly (string | number)[]> = [];
    const complete = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources,
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return members.map(({ subject }) => ({
            subject,
            disposition: 'offline_legacy_export',
            reasonCode: 'test_remaining_node_provenance',
            targetRefs: [],
            exportRef: `legacy-export/test/${digest(`${subject.rowKey}:${subject.path}`)}`,
            blockerCode: null,
          }));
        },
      },
    });

    expect(remainingPaths).toEqual([['prompt']]);
    expect(complete.ok).toBe(true);
    expect(complete.sourceFingerprint).toBe(complete.ownership.sourceFingerprint);
    expect(JSON.stringify(complete)).not.toContain('Private prompt');
  });

  it('keeps non-selected Canvas annotation candidates offline', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT);
      CREATE TABLE canvas_nodes (canvas_id TEXT, data_json TEXT, id TEXT, type TEXT);
      INSERT INTO canvases VALUES (NULL, 'project.1');
    `);
    main
      .prepare('INSERT INTO canvas_nodes VALUES (?, ?, ?, ?)')
      .run(
        'project.1',
        JSON.stringify({ text: ' private whitespace ', content: 'Canonical content' }),
        'node.1',
        'text',
      );
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'canvases', kind: 'table', columns: ['archived_at', 'id'] },
          {
            name: 'canvas_nodes',
            kind: 'table',
            columns: ['canvas_id', 'data_json', 'id', 'type'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvas_nodes', columns: ['data_json'] }],
      },
    });

    expect(
      report.embeddedJson.classification.entries.filter(
        ({ reasonCode }) => reasonCode === 'legacy_canvas_annotation_source_offline_export',
      ),
    ).toHaveLength(1);
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ reasonCode }) => reasonCode === 'legacy_canvas_annotation_text_materialized',
      ),
    ).toHaveLength(1);
    expect(report.ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain('private whitespace');
    expect(JSON.stringify(report)).not.toContain('Canonical content');
  });

  it('binds valid asset tag members to the frozen GlobalMediaAsset identity', () => {
    const blobHash = digest('tagged-blob');
    const main = database(`
      CREATE TABLE asset_contents (hash TEXT);
      CREATE TABLE asset_entries (asset_hash TEXT, folder_id TEXT, id TEXT, tags TEXT);
      INSERT INTO asset_contents VALUES ('${blobHash}');
      INSERT INTO asset_entries VALUES (
        '${blobHash}',
        NULL,
        'asset.tagged',
        '[" Private tag ","editorial"]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'asset_contents', kind: 'table', columns: ['hash'] },
          {
            name: 'asset_entries',
            kind: 'table',
            columns: ['asset_hash', 'folder_id', 'id', 'tags'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([blobHash]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'asset_entries', columns: ['tags'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: {
            subjectCount: 3,
            classifiedCount: 3,
            byDisposition: { migrated_current_state: 3 },
          },
          blockers: [],
          ok: true,
        },
        ok: true,
      },
      ok: true,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, targetRefs }) =>
          reasonCode === 'legacy_global_media_asset_tags' &&
          targetRefs.length === 1 &&
          targetRefs[0]?.authority === 'global_media_asset' &&
          targetRefs[0].id === 'asset.tagged' &&
          targetRefs[0].projectId === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private tag');
  });

  it('blocks every asset tag member when the tag array violates the Target contract', () => {
    const blobHash = digest('invalid-tag-blob');
    const main = database(`
      CREATE TABLE asset_contents (hash TEXT);
      CREATE TABLE asset_entries (asset_hash TEXT, folder_id TEXT, id TEXT, tags TEXT);
      INSERT INTO asset_contents VALUES ('${blobHash}');
      INSERT INTO asset_entries VALUES (
        '${blobHash}',
        NULL,
        'asset.invalid-tags',
        '["","Private forbidden tag"]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'asset_contents', kind: 'table', columns: ['hash'] },
          {
            name: 'asset_entries',
            kind: 'table',
            columns: ['asset_hash', 'folder_id', 'id', 'tags'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([blobHash]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'asset_entries', columns: ['tags'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 3, classifiedCount: 3, byDisposition: { blocking_error: 3 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.blockers.every(
        (blocker) =>
          blocker.kind === 'classified_blocking_error' &&
          blocker.blockerCode === 'invalid_global_media_asset_tags',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private forbidden tag');
  });

  it('propagates a blocked GlobalMediaAsset owner to all of its tag members', () => {
    const blobHash = digest('blocked-tag-owner-blob');
    const main = database(`
      CREATE TABLE asset_contents (hash TEXT);
      CREATE TABLE asset_entries (asset_hash TEXT, folder_id TEXT, id TEXT, tags TEXT);
      INSERT INTO asset_contents VALUES ('${blobHash}');
      INSERT INTO asset_entries VALUES ('${blobHash}', NULL, 'bad id', '["Private tag"]');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'asset_contents', kind: 'table', columns: ['hash'] },
          {
            name: 'asset_entries',
            kind: 'table',
            columns: ['asset_hash', 'folder_id', 'id', 'tags'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([blobHash]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'asset_entries', columns: ['tags'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: false },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 2, classifiedCount: 2, byDisposition: { blocking_error: 2 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'legacy_global_media_asset_tags_owner_blocked' &&
          blockerCode === 'invalid_global_media_asset_id',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private tag');
  });

  it('preserves a valid Legacy Canvas viewport as evidence before resetting the target view', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, viewport TEXT);
      INSERT INTO canvases VALUES (NULL, 'project.viewport', '{"x":12.5,"y":-4,"zoom":2}');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'viewport'] }],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['viewport'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: {
            subjectCount: 4,
            classifiedCount: 4,
            targetRefCount: 8,
            byDisposition: { immutable_provenance_history: 4 },
          },
          ok: true,
        },
        ok: true,
      },
      ok: true,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, blockerCode, targetRefs }) =>
          reasonCode === 'legacy_canvas_viewport_preserved_target_view_reset' &&
          blockerCode === null &&
          targetRefs.length === 2 &&
          targetRefs.some(({ authority }) => authority === 'canvas') &&
          targetRefs.some(({ authority }) => authority === 'imported_history_record'),
      ),
    ).toBe(true);
  });

  it('blocks every Canvas viewport member when its spatial payload is not exactly recoverable', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, viewport TEXT);
      INSERT INTO canvases VALUES (
        NULL,
        'project.invalid-viewport',
        '{"x":0,"y":0,"zoom":0,"Private key":1}'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'viewport'] }],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['viewport'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 5, classifiedCount: 5, byDisposition: { blocking_error: 5 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.blockers.every(
        (blocker) =>
          blocker.kind === 'classified_blocking_error' &&
          blocker.blockerCode === 'invalid_canvas_viewport',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private key');
  });

  it('propagates a blocked Project/Canvas owner to all viewport members', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, viewport TEXT);
      INSERT INTO canvases VALUES (NULL, 'bad id', '{"x":0,"y":0,"zoom":1}');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'viewport'] }],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['viewport'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: false },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 4, classifiedCount: 4, byDisposition: { blocking_error: 4 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'legacy_canvas_viewport_owner_blocked' &&
          blockerCode === 'invalid_legacy_canvas_id',
      ),
    ).toBe(true);
  });

  it('maps valid Legacy Canvas notes to typed annotations under the same Canvas', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, notes TEXT);
      INSERT INTO canvases VALUES (
        NULL,
        'project.notes',
        '[{"id":"note.1","content":"Private annotation","createdAt":1700000000000,"updatedAt":1700000001000}]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'notes'] }],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['notes'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: {
            subjectCount: 6,
            classifiedCount: 6,
            byDisposition: { migrated_current_state: 6 },
          },
          blockers: [],
          ok: true,
        },
        ok: true,
      },
      ok: true,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, targetRefs }) =>
          reasonCode === 'legacy_canvas_notes_annotations' &&
          targetRefs.length === 1 &&
          targetRefs[0]?.authority === 'canvas' &&
          targetRefs[0].id === 'project.notes' &&
          targetRefs[0].projectId === 'project.notes',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private annotation');
  });

  it('blocks the whole Canvas notes document when a note cannot form a Target annotation', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, notes TEXT);
      INSERT INTO canvases VALUES (
        NULL,
        'project.invalid-notes',
        '[{"id":"note.1","content":"","createdAt":1700000000000,"updatedAt":1700000001000,"Private key":true}]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'notes'] }],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['notes'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 7, classifiedCount: 7, byDisposition: { blocking_error: 7 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.blockers.every(
        (blocker) =>
          blocker.kind === 'classified_blocking_error' &&
          blocker.blockerCode === 'invalid_canvas_notes',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private key');
  });

  it('blocks every affected notes document when annotation identity is duplicated', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, notes TEXT);
      INSERT INTO canvases VALUES (
        NULL,
        'project.notes-a',
        '[{"id":"note.shared","content":"Private A","createdAt":1700000000000,"updatedAt":1700000001000}]'
      );
      INSERT INTO canvases VALUES (
        NULL,
        'project.notes-b',
        '[{"id":"note.shared","content":"Private B","createdAt":1700000002000,"updatedAt":1700000003000}]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'notes'] }],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['notes'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: {
            subjectCount: 12,
            classifiedCount: 12,
            byDisposition: { blocking_error: 12 },
          },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'duplicate_legacy_canvas_annotation_identity' &&
          blockerCode === 'duplicate_canvas_annotation_id',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private A');
    expect(JSON.stringify(report)).not.toContain('Private B');
  });

  it('does not let a blocked Canvas reserve an annotation ID in a valid target Canvas', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT, notes TEXT);
      INSERT INTO canvases VALUES (
        NULL,
        'bad id',
        '[{"id":"note.shared","content":"Private blocked","createdAt":1700000000000,"updatedAt":1700000001000}]'
      );
      INSERT INTO canvases VALUES (
        NULL,
        'project.notes-valid',
        '[{"id":"note.shared","content":"Private valid","createdAt":1700000002000,"updatedAt":1700000003000}]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [{ name: 'canvases', kind: 'table', columns: ['archived_at', 'id', 'notes'] }],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['notes'] }],
      },
    });

    expect(report.embeddedJson.classification.counts.byDisposition).toMatchObject({
      migrated_current_state: 6,
      blocking_error: 6,
    });
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ reasonCode }) => reasonCode === 'legacy_canvas_notes_annotations',
      ),
    ).toHaveLength(6);
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'legacy_canvas_notes_owner_blocked' &&
          blockerCode === 'invalid_legacy_canvas_id',
      ),
    ).toHaveLength(6);
    expect(JSON.stringify(report)).not.toContain('Private blocked');
    expect(JSON.stringify(report)).not.toContain('Private valid');
  });

  it('binds preset and shot-template JSON members to their verified root Skills', () => {
    const main = database(`
      CREATE TABLE preset_overrides (defaults TEXT, id TEXT, params TEXT);
      CREATE TABLE custom_shot_templates (id TEXT, tracks_json TEXT);
      INSERT INTO preset_overrides VALUES (
        '{"Private default":{"nested":1}}',
        'preset.dynamic',
        '["Private parameter",{"Private option":true}]'
      );
      INSERT INTO custom_shot_templates VALUES (
        'shot.dynamic',
        '{"Private track":{"weight":1}}'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'custom_shot_templates',
            kind: 'table',
            columns: ['id', 'tracks_json'],
          },
          {
            name: 'preset_overrides',
            kind: 'table',
            columns: ['defaults', 'id', 'params'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      root: {
        classifyLegacySkillRows(rows) {
          return rows.map((row) => ({
            subject: row.subject,
            disposition: 'migrated_current_state',
            reasonCode: 'legacy_skill_catalog_entry',
            targetRefs: [
              {
                authority: 'skill',
                id:
                  row.table === 'preset_overrides' ? 'skill.preset.dynamic' : 'skill.shot.dynamic',
                projectId: null,
              },
            ],
            exportRef: null,
            blockerCode: null,
          }));
        },
      },
      embeddedJson: {
        sources: [
          { database: 'main', table: 'custom_shot_templates', columns: ['tracks_json'] },
          { database: 'main', table: 'preset_overrides', columns: ['defaults', 'params'] },
        ],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: { ok: true },
      embeddedJson: {
        classification: {
          counts: {
            subjectCount: 10,
            classifiedCount: 10,
            byDisposition: { migrated_current_state: 10 },
          },
          blockers: [],
          ok: true,
        },
        ok: true,
      },
      ok: true,
    });
    expect(
      report.embeddedJson.classification.entries.every(({ subject, reasonCode, targetRefs }) => {
        const expectedId =
          subject.table === 'preset_overrides' ? 'skill.preset.dynamic' : 'skill.shot.dynamic';
        return (
          reasonCode === 'legacy_skill_embedded_source_content' &&
          targetRefs.length === 1 &&
          targetRefs[0]?.authority === 'skill' &&
          targetRefs[0].id === expectedId &&
          targetRefs[0].projectId === null
        );
      }),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('propagates a blocked Skill migration plan to all nested template members', () => {
    const main = database(`
      CREATE TABLE custom_shot_templates (id TEXT, tracks_json TEXT);
      INSERT INTO custom_shot_templates VALUES (
        'shot.unresolved',
        '{"Private track":{"weight":1}}'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'custom_shot_templates',
            kind: 'table',
            columns: ['id', 'tracks_json'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      root: {
        classifyLegacySkillRows(rows) {
          return rows.map((row) => ({
            subject: row.subject,
            disposition: 'blocking_error',
            reasonCode: 'legacy_skill_source_plan_mismatch',
            targetRefs: [],
            exportRef: null,
            blockerCode: 'legacy_skill_source_plan_mismatch',
          }));
        },
      },
      embeddedJson: {
        sources: [{ database: 'main', table: 'custom_shot_templates', columns: ['tracks_json'] }],
      },
    });

    expect(report).toMatchObject({
      rootRows: { ok: false },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 3, classifiedCount: 3, byDisposition: { blocking_error: 3 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, blockerCode }) =>
          reasonCode === 'legacy_skill_embedded_owner_blocked' &&
          blockerCode === 'legacy_skill_source_plan_mismatch',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private track');
  });

  it('keeps color-style documents offline while invalid JSON remains a blocker', () => {
    const main = database(`
      CREATE TABLE color_styles (
        exposure TEXT,
        gradients TEXT,
        id TEXT,
        name TEXT,
        palette TEXT,
        tags TEXT
      );
      INSERT INTO color_styles VALUES (
        '{"Private exposure":1}',
        '[]',
        'color-style.valid',
        'Private valid style',
        '[{"hex":"#010203","weight":1}]',
        '["Private tag"]'
      );
      INSERT INTO color_styles VALUES (
        '{}',
        '[]',
        'color-style.invalid',
        'Private invalid style',
        '{broken',
        '[]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'color_styles',
            kind: 'table',
            columns: ['exposure', 'gradients', 'id', 'name', 'palette', 'tags'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [
          {
            database: 'main',
            table: 'color_styles',
            columns: ['exposure', 'gradients', 'palette', 'tags'],
          },
        ],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report.rootRows).toMatchObject({
      classification: {
        counts: {
          subjectCount: 2,
          classifiedCount: 2,
          byDisposition: { offline_legacy_export: 2 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(report.embeddedJson.classification.counts.classifiedCount).toBe(
      report.embeddedJson.classification.counts.subjectCount,
    );
    expect(report.embeddedJson.classification.counts.byDisposition.blocking_error).toBe(1);
    expect(
      report.embeddedJson.classification.entries
        .filter(({ disposition }) => disposition === 'offline_legacy_export')
        .every(({ reasonCode }) => reasonCode === 'legacy_color_style_embedded_offline_export'),
    ).toBe(true);
    expect(report.embeddedJson.classification.blockers).toEqual([
      expect.objectContaining({
        kind: 'classified_blocking_error',
        blockerCode: 'legacy_embedded_json_document_invalid_json',
      }),
    ]);
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain('Private');
    expect(JSON.stringify(report)).not.toContain('#010203');
  });

  it('propagates missing Project ownership for Legacy Run events while invalid JSON stays authoritative', () => {
    const main = database(`
      CREATE TABLE commander_events (
        emitted_at INTEGER,
        kind TEXT,
        payload TEXT,
        private_payload BLOB,
        run_id TEXT,
        seq INTEGER,
        session_id TEXT,
        step INTEGER
      );
      INSERT INTO commander_events VALUES (
        1700000000000,
        'run_start',
        '{"kind":"run_start","intent":"Private intent"}',
        x'50726976617465207265636f76657279',
        'run.1',
        0,
        'chat.1',
        0
      );
      INSERT INTO commander_events VALUES (
        1700000001000,
        'assistant_text',
        '{broken',
        NULL,
        'run.1',
        1,
        'chat.1',
        0
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'commander_events',
            kind: 'table',
            columns: [
              'emitted_at',
              'kind',
              'payload',
              'private_payload',
              'run_id',
              'seq',
              'session_id',
              'step',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'commander_events', columns: ['payload'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: {
        classification: {
          counts: { subjectCount: 2, classifiedCount: 2, byDisposition: { blocking_error: 2 } },
          ok: false,
        },
        ok: false,
      },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 4, classifiedCount: 4, byDisposition: { blocking_error: 4 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ blockerCode }) => blockerCode === 'legacy_imported_history_project_owner_unresolved',
      ),
    ).toHaveLength(3);
    expect(report.embeddedJson.classification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'classified_blocking_error',
          blockerCode: 'legacy_embedded_json_document_invalid_json',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private intent');
    expect(JSON.stringify(report)).not.toContain('Private recovery');
  });

  it('propagates missing Project ownership for Legacy Task events while invalid JSON stays authoritative', () => {
    const main = database(`
      CREATE TABLE task_events (
        actor TEXT,
        causation_id TEXT,
        correlation_id TEXT,
        event_id TEXT,
        event_timestamp INTEGER,
        payload_json TEXT,
        seq INTEGER,
        task_list_id TEXT
      );
      INSERT INTO task_events VALUES (
        'assistant',
        NULL,
        'correlation.1',
        'event.1',
        1700000000000,
        '{"type":"task_list.created","publicSummary":"Private task event"}',
        1,
        'task-list.1'
      );
      INSERT INTO task_events VALUES (
        'system',
        NULL,
        NULL,
        'event.2',
        1700000001000,
        '{broken',
        2,
        'task-list.1'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'task_events',
            kind: 'table',
            columns: [
              'actor',
              'causation_id',
              'correlation_id',
              'event_id',
              'event_timestamp',
              'payload_json',
              'seq',
              'task_list_id',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'task_events', columns: ['payload_json'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: {
        classification: {
          counts: { subjectCount: 2, classifiedCount: 2, byDisposition: { blocking_error: 2 } },
          ok: false,
        },
        ok: false,
      },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 4, classifiedCount: 4, byDisposition: { blocking_error: 4 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ blockerCode }) => blockerCode === 'legacy_imported_history_project_owner_unresolved',
      ),
    ).toHaveLength(3);
    expect(report.embeddedJson.classification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'classified_blocking_error',
          blockerCode: 'legacy_embedded_json_document_invalid_json',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private task event');
  });

  it('propagates missing Project ownership for Task decisions while invalid JSON stays authoritative', () => {
    const main = database(`
      CREATE TABLE task_decisions (
        allow_free_text INTEGER,
        answer TEXT,
        answered_at INTEGER,
        canvas_id TEXT,
        created_at INTEGER,
        decision_key TEXT,
        id TEXT,
        options_json TEXT,
        question TEXT,
        question_id TEXT,
        row_version INTEGER,
        selected_option_id TEXT,
        status TEXT,
        subject_revision INTEGER,
        task_id TEXT,
        task_list_id TEXT,
        updated_at INTEGER
      );
      INSERT INTO task_decisions VALUES (
        0,
        'Private answer',
        1700000001000,
        'project.1',
        1700000000000,
        'decision.key.1',
        'decision.1',
        '[{"id":"option.1","label":"Private option"}]',
        'Private question',
        'question.1',
        1,
        'option.1',
        'answered',
        1,
        'task.1',
        'task-list.1',
        1700000001000
      );
      INSERT INTO task_decisions VALUES (
        1,
        NULL,
        NULL,
        'project.1',
        1700000002000,
        'decision.key.2',
        'decision.2',
        '{broken',
        'Private broken question',
        'question.2',
        0,
        NULL,
        'pending',
        1,
        'task.1',
        'task-list.1',
        1700000002000
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'task_decisions',
            kind: 'table',
            columns: [
              'allow_free_text',
              'answer',
              'answered_at',
              'canvas_id',
              'created_at',
              'decision_key',
              'id',
              'options_json',
              'question',
              'question_id',
              'row_version',
              'selected_option_id',
              'status',
              'subject_revision',
              'task_id',
              'task_list_id',
              'updated_at',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'task_decisions', columns: ['options_json'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: {
        classification: {
          counts: { subjectCount: 2, classifiedCount: 2, byDisposition: { blocking_error: 2 } },
          ok: false,
        },
        ok: false,
      },
      embeddedJson: {
        classification: {
          counts: { subjectCount: 5, classifiedCount: 5, byDisposition: { blocking_error: 5 } },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ blockerCode }) => blockerCode === 'legacy_imported_history_project_owner_unresolved',
      ),
    ).toHaveLength(4);
    expect(report.embeddedJson.classification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'classified_blocking_error',
          blockerCode: 'legacy_embedded_json_document_invalid_json',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private option');
    expect(JSON.stringify(report)).not.toContain('Private question');
    expect(JSON.stringify(report)).not.toContain('Private broken question');
  });

  it('blocks Delivery sequence members without inventing result or Project media identities', () => {
    const selectedVideoHash = digest('delivery-video');
    const main = database(`
      CREATE TABLE canvases (delivery_sequence_json TEXT, id TEXT);
      INSERT INTO canvases VALUES (
        '{"items":[{"embeddedAudioEnabled":true,"selectedVideoHash":"${selectedVideoHash}","shotId":"Private shot","trimInMs":0,"trimOutMs":1000}],"revision":1,"updatedAt":1700000000000}',
        'project.valid'
      );
      INSERT INTO canvases VALUES ('{broken', 'project.invalid');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'canvases',
            kind: 'table',
            columns: ['delivery_sequence_json', 'id'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'canvases', columns: ['delivery_sequence_json'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report.rootRows).toMatchObject({
      classification: {
        counts: {
          subjectCount: 2,
          classifiedCount: 2,
          byDisposition: { migrated_current_state: 2 },
        },
        ok: true,
      },
      ok: true,
    });
    expect(report.embeddedJson.classification.counts.classifiedCount).toBe(
      report.embeddedJson.classification.counts.subjectCount,
    );
    expect(report.embeddedJson.classification.counts.byDisposition).toMatchObject({
      blocking_error: 1,
      offline_legacy_export: report.embeddedJson.classification.counts.subjectCount - 1,
    });
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ reasonCode }) => reasonCode === 'legacy_delivery_sequence_offline_export',
      ),
    ).toHaveLength(report.embeddedJson.classification.counts.subjectCount - 1);
    expect(report.embeddedJson.classification.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'classified_blocking_error',
          blockerCode: 'legacy_embedded_json_document_invalid_json',
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private shot');
  });

  it('imports Task dependency members with the read-only Task history owner', () => {
    const main = database(`
      CREATE TABLE canvases (id TEXT);
      CREATE TABLE task_lists (entity_id TEXT, entity_type TEXT, id TEXT, metadata_json TEXT);
      CREATE TABLE tasks (dependency_ids_json TEXT, id TEXT, task_list_id TEXT);
      INSERT INTO canvases VALUES ('project.1');
      INSERT INTO task_lists VALUES ('project.1', 'canvas', 'task-list.1', '{}');
      INSERT INTO tasks VALUES ('["Private prerequisite"]', 'task.1', 'task-list.1');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'canvases', kind: 'table', columns: ['id'] },
          {
            name: 'task_lists',
            kind: 'table',
            columns: ['entity_id', 'entity_type', 'id', 'metadata_json'],
          },
          {
            name: 'tasks',
            kind: 'table',
            columns: ['dependency_ids_json', 'id', 'task_list_id'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'tasks', columns: ['dependency_ids_json'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report.rootRows).toMatchObject({
      classification: {
        counts: {
          subjectCount: 3,
          classifiedCount: 3,
          byDisposition: { migrated_current_state: 1, immutable_provenance_history: 2 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(report.embeddedJson).toMatchObject({
      classification: {
        counts: {
          subjectCount: 2,
          classifiedCount: 2,
          targetRefCount: 2,
          byDisposition: { immutable_provenance_history: 2 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(
      report.embeddedJson.classification.entries.every(
        ({ reasonCode, targetRefs }) =>
          reasonCode === 'legacy_imported_history_embedded_evidence' &&
          targetRefs.length === 1 &&
          targetRefs[0]?.authority === 'imported_task_item_history' &&
          targetRefs[0]?.id === 'task.1',
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private prerequisite');
  });

  it('propagates the frozen Legacy settings registry to every nested value member', () => {
    const main = database(`
      CREATE TABLE project_settings (key TEXT, updated_at INTEGER, value TEXT);
      INSERT INTO project_settings VALUES (
        'appSettings',
        1700000000000,
        '{"analyticsEnabled":true,"Private provider":"Private endpoint"}'
      );
      INSERT INTO project_settings VALUES (
        'styleGuide',
        1700000001000,
        '{"global":{"Private style":"Private value"},"sceneOverrides":{}}'
      );
      INSERT INTO project_settings VALUES (
        'Private unknown key',
        1700000002000,
        '{"Private unknown value":true}'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'project_settings',
            kind: 'table',
            columns: ['key', 'updated_at', 'value'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const remainingPaths: Array<readonly (string | number)[]> = [];

    const report = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources: [{ database: 'main', table: 'project_settings', columns: ['value'] }],
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ memberPath }) => memberPath));
          return [];
        },
      },
    });

    expect(remainingPaths).toEqual([]);
    expect(report).toMatchObject({
      rootRows: {
        classification: {
          counts: {
            subjectCount: 3,
            classifiedCount: 3,
            byDisposition: { offline_legacy_export: 2, blocking_error: 1 },
          },
          ok: false,
        },
        ok: false,
      },
      embeddedJson: {
        classification: {
          counts: {
            subjectCount: 9,
            classifiedCount: 9,
            byDisposition: { offline_legacy_export: 7, blocking_error: 2 },
          },
          ok: false,
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.embeddedJson.classification.entries.filter(
        ({ disposition }) => disposition === 'offline_legacy_export',
      ),
    ).toHaveLength(7);
    expect(
      new Set(
        report.embeddedJson.classification.entries
          .filter(({ disposition }) => disposition === 'blocking_error')
          .map(({ blockerCode }) => blockerCode),
      ),
    ).toEqual(new Set(['unknown_legacy_project_setting_key']));
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('keeps locally valid Task attempt evidence blocked until Project ownership is proven', () => {
    const assetHash = digest('Task evidence asset');
    const main = database(`
      CREATE TABLE asset_contents (hash TEXT PRIMARY KEY, type TEXT NOT NULL);
      CREATE TABLE asset_entries (asset_hash TEXT NOT NULL, id TEXT PRIMARY KEY);
      CREATE TABLE canvases (archived_at INTEGER, id TEXT PRIMARY KEY);
      CREATE TABLE characters (id TEXT PRIMARY KEY, ref_image TEXT);
      CREATE TABLE color_styles (id TEXT PRIMARY KEY, source_asset TEXT);
      CREATE TABLE commander_run_attachments (
        content_hash TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        run_id TEXT NOT NULL
      );
      CREATE TABLE delivery_asset_refs (asset_hash TEXT NOT NULL, canvas_id TEXT NOT NULL);
      CREATE TABLE prompt_assemblies (
        authority_json TEXT,
        conditioning_manifest_json TEXT,
        host_constraints_json TEXT,
        id TEXT PRIMARY KEY,
        input_json TEXT,
        output_json TEXT,
        provider_profile_json TEXT,
        source_asset_hash TEXT,
        source_attempt_id TEXT,
        source_evaluation_id TEXT,
        sources_json TEXT
      );
      CREATE TABLE task_artifacts (
        artifact_type TEXT NOT NULL,
        asset_hash TEXT,
        id TEXT PRIMARY KEY,
        metadata_json TEXT
      );
      CREATE TABLE task_attempts (
        asset_hash TEXT,
        canvas_id TEXT,
        generation_spec_json TEXT,
        id TEXT PRIMARY KEY,
        input_json TEXT,
        kind TEXT NOT NULL,
        media_type TEXT,
        metadata_json TEXT,
        output_json TEXT,
        repair_delta_json TEXT
      );
      CREATE TABLE task_evaluations (
        asset_hash TEXT NOT NULL,
        evidence_json TEXT,
        frame_evidence_json TEXT,
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        media_type TEXT NOT NULL,
        metadata_json TEXT,
        repair_delta_json TEXT,
        risks_json TEXT,
        scores_json TEXT,
        strengths_json TEXT
      );
    `);
    main.prepare('INSERT INTO asset_contents VALUES (?, ?)').run(assetHash, 'image');
    main.prepare('INSERT INTO canvases VALUES (?, ?)').run(null, 'canvas.1');
    main
      .prepare('INSERT INTO task_artifacts VALUES (?, ?, ?, ?)')
      .run('media_output', assetHash, 'artifact.1', '{"Private artifact":1}');
    main.prepare('INSERT INTO task_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      assetHash,
      'canvas.1',
      JSON.stringify({
        specVersion: 3,
        mediaType: 'image',
        referenceEvidence: [{ assetHash, roles: [] }],
        request: { type: 'image' },
        Private: 'Private generation spec',
      }),
      'attempt.1',
      '{"Private input":1}',
      'production_media',
      'image',
      '{"Private metadata":1}',
      '{"Private output":1}',
      '{"Private repair":1}',
    );
    main
      .prepare('INSERT INTO task_evaluations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        assetHash,
        '{"Private evidence":1}',
        '[]',
        'evaluation.1',
        'production_media',
        'image',
        '{"Private evaluation metadata":1}',
        '{"Private evaluation repair":1}',
        '{"Private risk":1}',
        '{"Private score":1}',
        '{"Private strength":1}',
      );
    main
      .prepare('INSERT INTO prompt_assemblies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        '{"Private authority":1}',
        '{"Private conditioning":1}',
        '{"Private constraint":1}',
        'assembly.1',
        '{"Private prompt input":1}',
        '{"Private prompt output":1}',
        '{"Private provider":1}',
        assetHash,
        'attempt.1',
        'evaluation.1',
        '{"Private source":1}',
      );
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'prompt_assemblies',
            kind: 'table',
            columns: [
              'authority_json',
              'conditioning_manifest_json',
              'host_constraints_json',
              'id',
              'input_json',
              'output_json',
              'provider_profile_json',
              'source_asset_hash',
              'source_attempt_id',
              'source_evaluation_id',
              'sources_json',
            ],
          },
          {
            name: 'task_artifacts',
            kind: 'table',
            columns: ['artifact_type', 'asset_hash', 'id', 'metadata_json'],
          },
          {
            name: 'task_attempts',
            kind: 'table',
            columns: [
              'asset_hash',
              'canvas_id',
              'generation_spec_json',
              'id',
              'input_json',
              'kind',
              'media_type',
              'metadata_json',
              'output_json',
              'repair_delta_json',
            ],
          },
          {
            name: 'task_evaluations',
            kind: 'table',
            columns: [
              'asset_hash',
              'evidence_json',
              'frame_evidence_json',
              'id',
              'kind',
              'media_type',
              'metadata_json',
              'repair_delta_json',
              'risks_json',
              'scores_json',
              'strengths_json',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const sources = [
      {
        database: 'main',
        table: 'prompt_assemblies',
        columns: [
          'authority_json',
          'conditioning_manifest_json',
          'host_constraints_json',
          'input_json',
          'output_json',
          'provider_profile_json',
          'sources_json',
        ],
      },
      { database: 'main', table: 'task_artifacts', columns: ['metadata_json'] },
      {
        database: 'main',
        table: 'task_attempts',
        columns: [
          'generation_spec_json',
          'input_json',
          'metadata_json',
          'output_json',
          'repair_delta_json',
        ],
      },
      {
        database: 'main',
        table: 'task_evaluations',
        columns: [
          'evidence_json',
          'frame_evidence_json',
          'metadata_json',
          'repair_delta_json',
          'risks_json',
          'scores_json',
          'strengths_json',
        ],
      },
    ] as const;
    const before = {
      promptAssemblies: main.prepare('SELECT * FROM prompt_assemblies').all(),
      artifacts: main.prepare('SELECT * FROM task_artifacts').all(),
      attempts: main.prepare('SELECT * FROM task_attempts').all(),
      evaluations: main.prepare('SELECT * FROM task_evaluations').all(),
    };
    expect(preflightLegacyScalarMediaReferences(main).ok).toBe(true);
    expect(preflightLegacyProductionMediaAttempts(main).ok).toBe(true);
    expect(preflightLegacyTaskEvaluationMedia(main).ok).toBe(true);
    const remainingPaths: string[] = [];

    const first = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: {
        sources,
        classifyMembers(members) {
          remainingPaths.push(...members.map(({ subject }) => subject.path));
          return [];
        },
      },
    });
    const second = classifyLegacyPhaseOne({ main, prompts }, expected, mediaReport([]), {
      embeddedJson: { sources },
    });

    expect(first).toEqual(second);
    expect(remainingPaths).toEqual([]);
    expect(first.rootRows.classification.counts).toMatchObject({
      subjectCount: 4,
      classifiedCount: 4,
      byDisposition: { blocking_error: 4 },
    });
    expect(first.embeddedJson.classification.counts.classifiedCount).toBe(
      first.embeddedJson.classification.counts.subjectCount,
    );
    expect(first.embeddedJson.classification.counts.byDisposition).toMatchObject({
      blocking_error: first.embeddedJson.classification.counts.subjectCount,
    });
    const expectedBlockerCodes = new Set(['legacy_imported_history_project_owner_unresolved']);
    expect(
      new Set(first.rootRows.classification.entries.map(({ blockerCode }) => blockerCode)),
    ).toEqual(expectedBlockerCodes);
    expect(
      new Set(first.embeddedJson.classification.entries.map(({ blockerCode }) => blockerCode)),
    ).toEqual(expectedBlockerCodes);
    expect(
      [
        ...first.rootRows.classification.entries,
        ...first.embeddedJson.classification.entries,
      ].every(
        ({ disposition, targetRefs, exportRef }) =>
          disposition === 'blocking_error' && targetRefs.length === 0 && exportRef === null,
      ),
    ).toBe(true);
    expect(first.ok).toBe(false);
    expect(JSON.stringify(first)).not.toContain('Private');
    expect(main.prepare('SELECT * FROM prompt_assemblies').all()).toEqual(before.promptAssemblies);
    expect(main.prepare('SELECT * FROM task_artifacts').all()).toEqual(before.artifacts);
    expect(main.prepare('SELECT * FROM task_attempts').all()).toEqual(before.attempts);
    expect(main.prepare('SELECT * FROM task_evaluations').all()).toEqual(before.evaluations);
  });
});
