import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { hashCanonical } from '../internal/hashes.js';
import type { LegacyMediaPreflightReport } from './media-preflight.js';
import { classifyLegacyRootRows } from './root-row-classification.js';
import type { LegacySourceExpectedSchemas } from './source-preflight.js';

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
  const count = hashes.length;
  return {
    database: { assetCount: count, declaredBytes: '10', nullOrZeroSizeCount: 0 },
    cas: { mediaFileCount: count, mediaBytes: '10', sidecarFileCount: 0, sidecarBytes: '0' },
    verifiedAssetCount: count,
    verifiedAssetHashes: hashes,
    fingerprint: digest('verified-media'),
    blockers: [],
    ok: true,
  };
}

describe('Legacy root-row classification', () => {
  it('binds Plan preflight evidence without inventing Production or UserChoice targets', () => {
    const content = { title: 'Private production plan' };
    const contentHash = hashCanonical(content);
    const manifestHash = digest('Private manifest');
    const resumeTokenHash = digest('Private resume token');
    const main = database(`
      CREATE TABLE plan_documents (
        content_hash TEXT,
        content_json TEXT,
        created_at INTEGER,
        document_type TEXT,
        id TEXT,
        logical_key TEXT,
        revision INTEGER,
        schema_version INTEGER,
        status TEXT,
        task_list_id TEXT,
        updated_at INTEGER
      );
      CREATE TABLE plan_approvals (
        created_at INTEGER,
        decided_at INTEGER,
        gate_key TEXT,
        id TEXT,
        manifest_hash TEXT,
        resume_token_hash TEXT,
        status TEXT,
        subject_hash TEXT,
        subject_logical_key TEXT,
        subject_revision INTEGER,
        task_list_id TEXT,
        updated_at INTEGER
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

    const first = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));
    const second = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      planHistory: {
        documentCount: 1,
        approvalCount: 1,
        approvedHeadCount: 1,
        blockers: [],
        ok: true,
      },
      classification: {
        counts: { subjectCount: 2, classifiedCount: 2, byDisposition: { blocking_error: 2 } },
        ok: false,
      },
      ok: false,
    });
    expect(
      first.classification.entries.every(
        ({ blockerCode, targetRefs, exportRef }) =>
          blockerCode === 'legacy_plan_target_mapping_unfrozen' &&
          targetRefs.length === 0 &&
          exportRef === null,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('Private production plan');
    expect(serialized).not.toContain(contentHash);
    expect(serialized).not.toContain(manifestHash);
    expect(serialized).not.toContain(resumeTokenHash);
    expect(main.prepare('SELECT * FROM plan_documents').all()).toEqual(before.documents);
    expect(main.prepare('SELECT * FROM plan_approvals').all()).toEqual(before.approvals);

    main.prepare("UPDATE plan_documents SET content_json = '{broken'").run();
    const beforeBlocked = {
      documents: main.prepare('SELECT * FROM plan_documents').all(),
      approvals: main.prepare('SELECT * FROM plan_approvals').all(),
    };
    const blocked = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(blocked.planHistory).toMatchObject({ ok: false });
    expect(
      blocked.classification.entries.every(
        ({ blockerCode }) => blockerCode === 'legacy_plan_history_preflight_blocked',
      ),
    ).toBe(true);
    expect(main.prepare('SELECT * FROM plan_documents').all()).toEqual(beforeBlocked.documents);
    expect(main.prepare('SELECT * FROM plan_approvals').all()).toEqual(beforeBlocked.approvals);
  });

  it('combines implemented classifiers without exposing source values', () => {
    const blobHash = digest('blob');
    const main = database(`
      CREATE TABLE asset_contents (hash TEXT, prompt TEXT);
      CREATE TABLE asset_entries (asset_hash TEXT, folder_id TEXT, id TEXT);
      CREATE VIRTUAL TABLE asset_entries_fts USING fts5(display_name, entry_id, prompt, tags);
      CREATE TABLE canvases (id TEXT);
      CREATE TABLE snapshots (id TEXT, label TEXT);
      INSERT INTO asset_contents VALUES ('${blobHash}', 'C:\\Users\\person\\secret.mov');
      INSERT INTO asset_entries VALUES ('${blobHash}', NULL, 'asset.1');
      INSERT INTO asset_entries_fts VALUES ('Private search title', 'asset.1', 'Private prompt', 'tag');
      INSERT INTO canvases VALUES ('canvas-1');
      INSERT INTO snapshots VALUES ('snapshot-1', 'Private backup label');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'asset_contents', kind: 'table', columns: ['hash', 'prompt'] },
          { name: 'asset_entries', kind: 'table', columns: ['asset_hash', 'folder_id', 'id'] },
          {
            name: 'asset_entries_fts',
            kind: 'virtual',
            columns: ['display_name', 'entry_id', 'prompt', 'tags'],
          },
          { name: 'canvases', kind: 'table', columns: ['id'] },
          { name: 'snapshots', kind: 'table', columns: ['id', 'label'] },
        ],
      },
      prompts: { tables: [] },
    };
    const before = main.prepare('SELECT * FROM canvases').all();

    const first = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([blobHash]));
    const second = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([blobHash]));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema: 'lucid-fin.legacy-root-row-classification/v1',
      scope: 'root_rows',
      inventory: { rowCount: 5 },
      ownership: {
        assignments: [{ table: 'canvases', disposition: 'single_project' }],
        blockers: [],
        ok: true,
      },
      classification: {
        counts: {
          subjectCount: 5,
          classifiedCount: 5,
          byDisposition: { migrated_current_state: 3, offline_legacy_export: 2 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('secret.mov');
    expect(JSON.stringify(first)).not.toContain('Private backup label');
    expect(JSON.stringify(first)).not.toContain('Private search title');
    expect(JSON.stringify(first)).not.toContain('Private prompt');
    expect(main.prepare('SELECT * FROM canvases').all()).toEqual(before);
  });

  it('classifies Project ownership assignments from the same root-row scan', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT);
      CREATE TABLE characters (default_loadout_id TEXT, id TEXT, loadouts TEXT);
      CREATE TABLE canvas_nodes (canvas_id TEXT, data_json TEXT, id TEXT, type TEXT);
      INSERT INTO canvases VALUES (NULL, 'project.1');
      INSERT INTO characters VALUES ('', 'character.1', '[]');
      INSERT INTO canvas_nodes VALUES (
        'project.1',
        '{"characterRefs":[{"characterId":"character.1","loadoutId":""}]}',
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

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report.ownership.sourceFingerprint).toBe(report.inventory.fingerprint);
    expect(report).toMatchObject({
      ownership: {
        canvasProjects: [{ canvasId: 'project.1', lifecycle: 'active' }],
        blockers: [],
        ok: true,
      },
      classification: {
        counts: {
          subjectCount: 3,
          classifiedCount: 3,
          targetRefCount: 4,
          byDisposition: { migrated_current_state: 3 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(
      report.ownership.assignments.map(({ table, projectIds, disposition }) => ({
        table,
        projectIds,
        disposition,
      })),
    ).toEqual(
      expect.arrayContaining([
        { table: 'characters', projectIds: ['project.1'], disposition: 'single_project' },
        { table: 'canvas_nodes', projectIds: ['project.1'], disposition: 'single_project' },
        { table: 'canvases', projectIds: ['project.1'], disposition: 'single_project' },
      ]),
    );
  });

  it('classifies unreferenced Production folder trees as one offline export per root row', () => {
    const main = database(`
      CREATE TABLE character_folders (id TEXT, name TEXT, parent_id TEXT);
      CREATE TABLE equipment_folders (id TEXT, name TEXT, parent_id TEXT);
      CREATE TABLE location_folders (id TEXT, name TEXT, parent_id TEXT);
      INSERT INTO character_folders VALUES ('character-folder.root', 'Private root', NULL);
      INSERT INTO character_folders VALUES (
        'character-folder.child',
        'Private child',
        'character-folder.root'
      );
      INSERT INTO equipment_folders VALUES ('equipment-folder.root', 'Private equipment', NULL);
      INSERT INTO location_folders VALUES ('location-folder.root', 'Private location', NULL);
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'character_folders',
            kind: 'table',
            columns: ['id', 'name', 'parent_id'],
          },
          {
            name: 'equipment_folders',
            kind: 'table',
            columns: ['id', 'name', 'parent_id'],
          },
          {
            name: 'location_folders',
            kind: 'table',
            columns: ['id', 'name', 'parent_id'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      ownership: { blockers: [], ok: true },
      classification: {
        counts: {
          subjectCount: 4,
          classifiedCount: 4,
          targetRefCount: 0,
          byDisposition: { offline_legacy_export: 4 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(
      report.ownership.assignments.every(
        ({ disposition, targetRefs }) =>
          disposition === 'offline_legacy_export' && targetRefs.length === 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('keeps unbound Legacy color styles in the offline export without inventing an owner', () => {
    const main = database(`
      CREATE TABLE color_styles (
        exposure TEXT,
        gradients TEXT,
        id TEXT,
        name TEXT,
        palette TEXT,
        source_asset TEXT,
        source_type TEXT,
        tags TEXT
      );
      INSERT INTO color_styles VALUES (
        '{"brightness":0}',
        '[]',
        'color-style.1',
        'Private color style',
        '[{"hex":"#010203","weight":1}]',
        NULL,
        'manual',
        '["Private tag"]'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'color_styles',
            kind: 'table',
            columns: [
              'exposure',
              'gradients',
              'id',
              'name',
              'palette',
              'source_asset',
              'source_type',
              'tags',
            ],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 1,
          classifiedCount: 1,
          targetRefCount: 0,
          byDisposition: { offline_legacy_export: 1 },
        },
        entries: [
          {
            disposition: 'offline_legacy_export',
            reasonCode: 'legacy_unbound_color_style_offline_export',
            targetRefs: [],
            blockerCode: null,
          },
        ],
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(JSON.stringify(report)).not.toContain('Private');
    expect(JSON.stringify(report)).not.toContain('#010203');
  });

  it('blocks Run event projection and attachment identity instead of guessing target evidence', () => {
    const main = database(`
      CREATE TABLE canvases (id TEXT);
      CREATE TABLE commander_sessions (default_canvas_id TEXT, id TEXT);
      CREATE TABLE commander_runs (
        default_canvas_id TEXT,
        id TEXT,
        parent_run_id TEXT,
        retry_of_run_id TEXT,
        session_id TEXT
      );
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
      CREATE TABLE commander_run_attachments (
        content_hash TEXT,
        mime_type TEXT,
        ordinal INTEGER,
        original_name TEXT,
        role TEXT,
        run_id TEXT
      );
      INSERT INTO canvases VALUES ('project.1');
      INSERT INTO commander_sessions VALUES ('project.1', 'chat.1');
      INSERT INTO commander_runs VALUES ('project.1', 'run.1', NULL, NULL, 'chat.1');
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
      INSERT INTO commander_run_attachments VALUES (
        '${digest('attachment')}',
        'video/private',
        0,
        'Private attachment.mov',
        'reference',
        'run.1'
      );
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'canvases', kind: 'table', columns: ['id'] },
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
          {
            name: 'commander_run_attachments',
            kind: 'table',
            columns: ['content_hash', 'mime_type', 'ordinal', 'original_name', 'role', 'run_id'],
          },
          {
            name: 'commander_runs',
            kind: 'table',
            columns: ['default_canvas_id', 'id', 'parent_run_id', 'retry_of_run_id', 'session_id'],
          },
          {
            name: 'commander_sessions',
            kind: 'table',
            columns: ['default_canvas_id', 'id'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 5,
          classifiedCount: 5,
          byDisposition: {
            migrated_current_state: 2,
            immutable_provenance_history: 1,
            blocking_error: 2,
          },
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      new Set(report.classification.entries.map(({ blockerCode }) => blockerCode).filter(Boolean)),
    ).toEqual(
      new Set([
        'legacy_run_attachment_asset_identity_unresolved',
        'legacy_commander_event_unmappable',
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private intent');
    expect(JSON.stringify(report)).not.toContain('Private attachment.mov');
    expect(JSON.stringify(report)).not.toContain('Private recovery');
  });

  it('blocks Legacy Task events that have no provable Target Run owner or event envelope', () => {
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
        'Private cause',
        'Private correlation',
        'Private event',
        1700000000000,
        '{"type":"task_list.created","publicSummary":"Private task event"}',
        1,
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

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 1,
          classifiedCount: 1,
          targetRefCount: 0,
          byDisposition: { blocking_error: 1 },
        },
        entries: [
          {
            disposition: 'blocking_error',
            reasonCode: 'legacy_task_event_run_owner_unresolved',
            targetRefs: [],
            exportRef: null,
            blockerCode: 'legacy_task_event_run_owner_unresolved',
          },
        ],
        ok: false,
      },
      ok: false,
    });
    expect(JSON.stringify(report)).not.toContain('Private task event');
    expect(JSON.stringify(report)).not.toContain('Private cause');
    expect(JSON.stringify(report)).not.toContain('Private correlation');
    expect(JSON.stringify(report)).not.toContain('Private event');
  });

  it('blocks Legacy Task decisions that cannot identify a Target Run interaction', () => {
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
        'private.key',
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

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 1,
          classifiedCount: 1,
          targetRefCount: 0,
          byDisposition: { blocking_error: 1 },
        },
        entries: [
          {
            disposition: 'blocking_error',
            reasonCode: 'legacy_task_decision_interaction_identity_unresolved',
            targetRefs: [],
            exportRef: null,
            blockerCode: 'legacy_task_decision_interaction_identity_unresolved',
          },
        ],
        ok: false,
      },
      ok: false,
    });
    expect(JSON.stringify(report)).not.toContain('Private answer');
    expect(JSON.stringify(report)).not.toContain('Private option');
    expect(JSON.stringify(report)).not.toContain('Private question');
  });

  it('blocks Delivery mirror rows that cannot identify target media or results', () => {
    const main = database(`
      CREATE TABLE canvases (id TEXT);
      CREATE TABLE delivery_asset_refs (asset_hash TEXT, canvas_id TEXT);
      INSERT INTO canvases VALUES ('project.1');
      INSERT INTO delivery_asset_refs VALUES ('${digest('delivery')}', 'project.1');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'canvases', kind: 'table', columns: ['id'] },
          {
            name: 'delivery_asset_refs',
            kind: 'table',
            columns: ['asset_hash', 'canvas_id'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 2,
          classifiedCount: 2,
          byDisposition: { migrated_current_state: 1, blocking_error: 1 },
        },
        entries: expect.arrayContaining([
          expect.objectContaining({
            disposition: 'blocking_error',
            reasonCode: 'legacy_delivery_target_identity_unresolved',
            targetRefs: [],
            exportRef: null,
            blockerCode: 'legacy_delivery_target_identity_unresolved',
          }),
        ]),
        ok: false,
      },
      ok: false,
    });
  });

  it('anchors a Project-resolved Legacy Task to its parent Target TaskList owner', () => {
    const main = database(`
      CREATE TABLE canvases (archived_at INTEGER, id TEXT);
      CREATE TABLE task_lists (entity_id TEXT, entity_type TEXT, id TEXT, metadata_json TEXT);
      CREATE TABLE tasks (id TEXT, task_list_id TEXT);
      INSERT INTO canvases VALUES (NULL, 'project.1');
      INSERT INTO task_lists VALUES ('project.1', 'canvas', 'task-list.1', '{}');
      INSERT INTO tasks VALUES ('task.1', 'task-list.1');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'canvases', kind: 'table', columns: ['archived_at', 'id'] },
          {
            name: 'task_lists',
            kind: 'table',
            columns: ['entity_id', 'entity_type', 'id', 'metadata_json'],
          },
          { name: 'tasks', kind: 'table', columns: ['id', 'task_list_id'] },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));
    const taskOwnership = report.ownership.assignments.find(({ table }) => table === 'tasks');

    expect(taskOwnership).toMatchObject({
      projectIds: ['project.1'],
      disposition: 'single_project',
      targetRefs: [{ authority: 'task_list', id: 'task-list.1', projectId: 'project.1' }],
      blockerCode: null,
    });
    expect(report.ownership.ok).toBe(true);
    expect(report.classification).toMatchObject({
      counts: {
        subjectCount: 3,
        classifiedCount: 3,
        byDisposition: { migrated_current_state: 1, immutable_provenance_history: 2 },
      },
      blockers: [],
      ok: true,
    });
    expect(report.ok).toBe(true);
  });

  it('keeps the removed Legacy Task dependency graph in the offline export', () => {
    const main = database(`
      CREATE TABLE task_dependencies (depends_on_task_id TEXT, task_id TEXT);
      INSERT INTO task_dependencies VALUES ('Private prerequisite', 'Private dependent');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'task_dependencies',
            kind: 'table',
            columns: ['depends_on_task_id', 'task_id'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 1,
          classifiedCount: 1,
          targetRefCount: 0,
          byDisposition: { offline_legacy_export: 1 },
        },
        entries: [
          {
            disposition: 'offline_legacy_export',
            reasonCode: 'legacy_task_dependency_graph_offline_export',
            targetRefs: [],
            blockerCode: null,
          },
        ],
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(JSON.stringify(report)).not.toContain('Private prerequisite');
    expect(JSON.stringify(report)).not.toContain('Private dependent');
  });

  it('classifies folders before resolving GlobalMediaAsset membership', () => {
    const blobHash = digest('foldered-blob');
    const main = database(`
      CREATE TABLE asset_contents (hash TEXT);
      CREATE TABLE asset_entries (asset_hash TEXT, folder_id TEXT, id TEXT);
      CREATE TABLE asset_folders (
        created_at INTEGER,
        id TEXT,
        name TEXT,
        parent_id TEXT,
        sort_order INTEGER,
        updated_at INTEGER
      );
      INSERT INTO asset_contents VALUES ('${blobHash}');
      INSERT INTO asset_folders VALUES (1700000000000, 'folder.root', 'Private root', NULL, 0, 1700000000100);
      INSERT INTO asset_folders VALUES (1700000000000, 'folder.child', 'Private child', 'folder.root', 1, 1700000000100);
      INSERT INTO asset_entries VALUES ('${blobHash}', 'folder.child', 'asset.foldered');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'asset_contents', kind: 'table', columns: ['hash'] },
          { name: 'asset_entries', kind: 'table', columns: ['asset_hash', 'folder_id', 'id'] },
          {
            name: 'asset_folders',
            kind: 'table',
            columns: ['created_at', 'id', 'name', 'parent_id', 'sort_order', 'updated_at'],
          },
        ],
      },
      prompts: { tables: [] },
    };

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([blobHash]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 4,
          classifiedCount: 4,
          targetRefCount: 4,
          byDisposition: { migrated_current_state: 4 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(JSON.stringify(report)).not.toContain('Private root');
    expect(JSON.stringify(report)).not.toContain('Private child');
  });

  it('routes all four Legacy Skill tables through one externally owned classifier', () => {
    const main = database(`
      CREATE TABLE preset_overrides (id TEXT);
      CREATE TABLE custom_shot_templates (id TEXT);
      INSERT INTO preset_overrides VALUES ('private-preset');
      INSERT INTO custom_shot_templates VALUES ('private-shot');
    `);
    const prompts = database(`
      CREATE TABLE process_prompts (process_key TEXT);
      CREATE TABLE t_prompt_overrides (code TEXT);
      INSERT INTO process_prompts VALUES ('private-process');
      INSERT INTO t_prompt_overrides VALUES ('private-template');
    `);
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          { name: 'custom_shot_templates', kind: 'table', columns: ['id'] },
          { name: 'preset_overrides', kind: 'table', columns: ['id'] },
        ],
      },
      prompts: {
        tables: [
          { name: 'process_prompts', kind: 'table', columns: ['process_key'] },
          { name: 't_prompt_overrides', kind: 'table', columns: ['code'] },
        ],
      },
    };
    const received: string[] = [];

    const withoutPlan = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));
    expect(withoutPlan.classification.counts.classifiedCount).toBe(0);
    expect(withoutPlan.classification.blockers).toHaveLength(4);
    expect(new Set(withoutPlan.classification.blockers.map(({ kind }) => kind))).toEqual(
      new Set(['unclassified_subject']),
    );
    expect(withoutPlan.ok).toBe(false);

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]), {
      classifyLegacySkillRows(rows) {
        return rows.map((row) => {
          received.push(`${row.database}.${row.table}`);
          return {
            subject: row.subject,
            disposition: 'migrated_current_state',
            reasonCode: 'legacy_skill_catalog_entry',
            targetRefs: [
              {
                authority: 'skill',
                id: `skill.${row.database}.${row.table}`,
                projectId: null,
              },
            ],
            exportRef: null,
            blockerCode: null,
          };
        });
      },
    });

    expect(received.sort()).toEqual([
      'main.custom_shot_templates',
      'main.preset_overrides',
      'prompts.process_prompts',
      'prompts.t_prompt_overrides',
    ]);
    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 4,
          classifiedCount: 4,
          targetRefCount: 4,
          byDisposition: { migrated_current_state: 4 },
        },
        blockers: [],
        ok: true,
      },
      ok: true,
    });
    expect(JSON.stringify(report)).not.toContain('private-');
  });

  it('classifies the frozen Legacy settings keys without treating the global KV store as Project truth', () => {
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

    const report = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(report).toMatchObject({
      classification: {
        counts: {
          subjectCount: 3,
          classifiedCount: 3,
          byDisposition: { offline_legacy_export: 1, blocking_error: 2 },
        },
        ok: false,
      },
      ok: false,
    });
    expect(
      report.classification.entries.map(({ disposition, reasonCode, blockerCode }) => ({
        disposition,
        reasonCode,
        blockerCode,
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          disposition: 'blocking_error',
          reasonCode: 'legacy_global_app_settings_target_unfrozen',
          blockerCode: 'legacy_global_app_settings_target_unfrozen',
        },
        {
          disposition: 'offline_legacy_export',
          reasonCode: 'legacy_unbound_style_guide_offline_export',
          blockerCode: null,
        },
        {
          disposition: 'blocking_error',
          reasonCode: 'unknown_legacy_project_setting_key',
          blockerCode: 'unknown_legacy_project_setting_key',
        },
      ]),
    );
    expect(JSON.stringify(report)).not.toContain('Private');
  });

  it('blocks Task and Prompt evidence rows until their Target lineage is frozen', () => {
    const main = database(`
      CREATE TABLE prompt_assemblies (id TEXT, output_json TEXT, source_attempt_id TEXT);
      CREATE TABLE task_artifacts (id TEXT, metadata_json TEXT);
      CREATE TABLE task_attempts (generation_spec_json TEXT, id TEXT);
      CREATE TABLE task_evaluations (evidence_json TEXT, id TEXT);
      INSERT INTO prompt_assemblies VALUES (
        'assembly.1',
        '{"Private prompt":"Private assembled prompt"}',
        'attempt.1'
      );
      INSERT INTO task_artifacts VALUES ('artifact.1', '{"Private path":"C:/Private/output.png"}');
      INSERT INTO task_attempts VALUES ('{"Private prompt":"Private attempt"}', 'attempt.1');
      INSERT INTO task_evaluations VALUES ('[{"Private finding":"Private evaluation"}]', 'evaluation.1');
    `);
    const prompts = database('PRAGMA user_version = 1;');
    const expected: LegacySourceExpectedSchemas = {
      main: {
        tables: [
          {
            name: 'prompt_assemblies',
            kind: 'table',
            columns: ['id', 'output_json', 'source_attempt_id'],
          },
          {
            name: 'task_artifacts',
            kind: 'table',
            columns: ['id', 'metadata_json'],
          },
          {
            name: 'task_attempts',
            kind: 'table',
            columns: ['generation_spec_json', 'id'],
          },
          {
            name: 'task_evaluations',
            kind: 'table',
            columns: ['evidence_json', 'id'],
          },
        ],
      },
      prompts: { tables: [] },
    };
    const before = {
      promptAssemblies: main.prepare('SELECT * FROM prompt_assemblies').all(),
      artifacts: main.prepare('SELECT * FROM task_artifacts').all(),
      attempts: main.prepare('SELECT * FROM task_attempts').all(),
      evaluations: main.prepare('SELECT * FROM task_evaluations').all(),
    };

    const first = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));
    const second = classifyLegacyRootRows({ main, prompts }, expected, mediaReport([]));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      classification: {
        counts: { subjectCount: 4, classifiedCount: 4, byDisposition: { blocking_error: 4 } },
        ok: false,
      },
      ok: false,
    });
    expect(
      Object.fromEntries(
        first.classification.entries.map(({ subject, blockerCode }) => [
          subject.table,
          blockerCode,
        ]),
      ),
    ).toEqual({
      prompt_assemblies: 'legacy_prompt_assembly_target_mapping_unfrozen',
      task_artifacts: 'legacy_task_artifact_target_mapping_unfrozen',
      task_attempts: 'legacy_task_attempt_target_mapping_unfrozen',
      task_evaluations: 'legacy_task_evaluation_target_mapping_unfrozen',
    });
    expect(
      first.classification.entries.every(
        ({ disposition, reasonCode, blockerCode, targetRefs, exportRef }) =>
          disposition === 'blocking_error' &&
          reasonCode === blockerCode &&
          targetRefs.length === 0 &&
          exportRef === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain('Private');
    expect(main.prepare('SELECT * FROM prompt_assemblies').all()).toEqual(before.promptAssemblies);
    expect(main.prepare('SELECT * FROM task_artifacts').all()).toEqual(before.artifacts);
    expect(main.prepare('SELECT * FROM task_attempts').all()).toEqual(before.attempts);
    expect(main.prepare('SELECT * FROM task_evaluations').all()).toEqual(before.evaluations);
  });
});
