import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_BINDINGS_V1 } from '../../../scripts/generate-target-contracts.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const NOW = '2026-08-24T12:00:00.000Z';

const EXPECTED_TABLES = `
canvas_annotations
canvas_documents
canvas_edges
canvas_group_members
canvas_groups
canvas_placements
canvas_saved_views
capability_catalog_snapshots
chats
compaction_transactions
compaction_views
context_manifests
delivery_exports
delivery_field_choices
delivery_items
delivery_manifest_choices
delivery_manifest_items
delivery_manifest_protections
delivery_manifests
delivery_plans
delivery_protections
dispatch_operations
generated_results
generation_attempts
generation_requests
global_media_assets
global_media_folders
media_blobs
media_derivation_attempts
media_derivation_outputs
media_derivations
message_attachments
message_payloads
messages
model_attempts
private_recovery_envelopes
production_fact_sources
production_objects
production_protections
production_relations
production_result_decisions
project_event_payloads
project_events
project_media_links
project_media_refs
project_memory_heads
project_memory_items
project_memory_versions
project_search_documents
project_search_fts
project_settings
projects
provider_profiles
result_assessment_attempts
result_assessment_subjects
result_assessments
review_cut_attempts
run_activations
run_confirmations
run_event_payloads
run_events
run_inbox_messages
run_interactions
run_resource_entries
runs
skill_effective_versions
skill_enablements
skill_quarantines
skills
task_items
task_lists
user_choice_supersessions
user_choices
wire_command_receipts
`
  .trim()
  .split('\n');

const EXPECTED_INDEXES = `
idx_canvas_annotations_canvas
idx_canvas_edges_canvas
idx_canvas_placements_canvas_z
idx_chats_project_updated
idx_compaction_transactions_run
idx_delivery_exports_manifest
idx_delivery_plans_project
idx_dispatch_operations_guard
idx_dispatch_operations_kind
idx_generated_results_project
idx_generation_attempts_state
idx_generation_requests_run
idx_global_media_assets_blob
idx_global_media_folders_parent_order_name
idx_media_derivation_attempts_state
idx_media_derivations_run
idx_message_attachments_media
idx_messages_project_created
idx_model_attempts_run
idx_private_recovery_run
idx_production_fact_sources_object
idx_production_objects_project_type
idx_production_protections_object
idx_production_relations_target
idx_project_events_subject
idx_project_media_links_object
idx_project_media_refs_project
idx_project_memory_items_version
idx_project_memory_versions_project
idx_project_search_documents_project
idx_provider_profiles_status
idx_result_assessment_attempts_run
idx_result_assessment_subjects_lookup
idx_review_cut_attempts_manifest
idx_run_activations_state
idx_run_events_run_surface
idx_run_inbox_state
idx_run_interactions_state
idx_run_resource_entries_model_phase_kind
idx_run_resource_entries_operation_phase_kind
idx_run_resource_entries_run
idx_runs_parent
idx_runs_project_status
idx_skill_enablements_project
idx_skills_project
idx_task_items_list_order
idx_user_choices_project
uniq_active_delivery_item_order
uniq_active_delivery_item_protection
uniq_active_delivery_plan_protection
uniq_active_production_protection
uniq_delivery_item_field_choice
uniq_delivery_manifest_item_choice
uniq_delivery_manifest_item_protection
uniq_delivery_manifest_plan_choice
uniq_delivery_manifest_plan_protection
uniq_delivery_plan_field_choice
uniq_dispatch_operations_confirmation
uniq_dispatch_operations_owner
uniq_generation_attempts_provider_operation
uniq_media_derivation_attempts_provider_operation
uniq_production_contains_child
uniq_result_assessment_attempts_provider_operation
uniq_run_resource_entries_reservation_phase
uniq_shot_selected_result
`
  .trim()
  .split('\n');

const EXPECTED_FOREIGN_KEY_COUNT = 189;
const EXPECTED_FOREIGN_KEY_HASH =
  '43ef2ab3b1b5e6314c469c3a7bd9d6efd3090b16fd049d4ee1bdef0ba293e88a';

interface NameRow {
  name: string;
}

interface TableListRow {
  name: string;
  schema: string;
  strict: number;
  type: string;
}

interface ForeignKeyRow {
  from: string;
  on_delete: string;
  table: string;
  to: string;
}

interface TableColumnRow {
  name: string;
}

interface SqlRow {
  sql: string | null;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexColumnRow {
  name: string;
  seqno: number;
}

const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<{ db: DatabaseSync; ddl: string }> {
  const ddl = await readFile(ddlUrl, 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(ddl);
  return { db, ddl };
}

function authoritativeTables(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND (name = 'project_search_fts' OR name NOT GLOB 'project_search_fts_*')
         ORDER BY name`,
      )
      .all() as unknown as NameRow[]
  ).map(({ name }) => name);
}

function namedIndexes(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        `SELECT name
         FROM sqlite_schema
         WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`,
      )
      .all() as unknown as NameRow[]
  ).map(({ name }) => name);
}

function foreignKeys(db: DatabaseSync): string[] {
  const inventory: string[] = [];
  for (const table of EXPECTED_TABLES.filter((name) => name !== 'project_search_fts')) {
    const rows = db
      .prepare(`PRAGMA foreign_key_list("${table}")`)
      .all() as unknown as ForeignKeyRow[];
    for (const row of rows) inventory.push(`${table}.${row.from}->${row.table}.${row.to}`);
  }
  return inventory.sort();
}

function schemaSnapshot(db: DatabaseSync): readonly unknown[] {
  return db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all();
}

function jsonColumnsFromDdl(ddl: string): string[] {
  const columns: string[] = [];
  for (const tableMatch of ddl.matchAll(/CREATE TABLE ([a-z0-9_]+) \(([\s\S]*?)\n\) STRICT;/g)) {
    const [, table, body] = tableMatch;
    for (const columnMatch of body.matchAll(/^\s+([a-z0-9_]+_v1_json)\s+/gm)) {
      columns.push(`${table}.${columnMatch[1]}`);
    }
  }
  return columns.sort();
}

describe('project-v1 DDL', () => {
  it('creates the exact v1 table, index, and foreign-key inventories', async () => {
    const { db } = await openDatabase();
    try {
      expect(authoritativeTables(db)).toEqual(EXPECTED_TABLES);
      expect(namedIndexes(db)).toEqual(EXPECTED_INDEXES);

      const inventory = foreignKeys(db);
      expect(inventory).toHaveLength(EXPECTED_FOREIGN_KEY_COUNT);
      expect(createHash('sha256').update(JSON.stringify(inventory)).digest('hex')).toBe(
        EXPECTED_FOREIGN_KEY_HASH,
      );
      expect(
        (db.prepare('PRAGMA foreign_key_list(messages)').all() as unknown as ForeignKeyRow[]).find(
          ({ from }) => from === 'chat_id',
        )?.on_delete,
      ).toBe('RESTRICT');
    } finally {
      db.close();
    }
  });

  it('allows each child one incoming parent-to-child containment relation', async () => {
    const { db } = await openDatabase();
    try {
      db.prepare(
        `INSERT INTO projects (
           id, name, lifecycle, schema_revision, revision, content_hash,
           created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
         ) VALUES ('project.relations', 'Relations', 'active', 1, 0, ?, 'direct_ui', 'test', ?, ?, NULL, NULL)`,
      ).run(HASH_A, NOW, NOW);
      const insertObject = db.prepare(
        `INSERT INTO production_objects (
           id, project_id, object_type, revision, content_hash, lifecycle, content_v1_json,
           created_by_kind, created_by_id, updated_by_kind, updated_by_id, created_at, updated_at
         ) VALUES (?, 'project.relations', 'scene', 0, ?, 'active', '{}', 'direct_ui', 'test', 'direct_ui', 'test', ?, ?)`,
      );
      for (const id of ['parent.1', 'parent.2', 'child.1']) insertObject.run(id, HASH_A, NOW, NOW);

      const insertRelation = db.prepare(
        `INSERT INTO production_relations (
           id, project_id, source_object_id, target_object_id, relation, ordinal, created_at
         ) VALUES (?, 'project.relations', ?, ?, ?, ?, ?)`,
      );
      insertRelation.run('relation.1', 'parent.1', 'child.1', 'contains', 0, NOW);
      expect(() =>
        insertRelation.run('relation.2', 'parent.2', 'child.1', 'contains', 0, NOW),
      ).toThrow();
      expect(() =>
        insertRelation.run('relation.3', 'parent.2', 'child.1', 'appears_in', null, NOW),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('sets version 1, keeps every ordinary table STRICT, and passes integrity checks', async () => {
    const { db } = await openDatabase();
    try {
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
      const tableList = db.prepare('PRAGMA table_list').all() as unknown as TableListRow[];
      const ordinary = tableList.filter(
        ({ name, schema, type }) =>
          schema === 'main' && type === 'table' && EXPECTED_TABLES.includes(name),
      );
      expect(
        tableList.find(
          ({ name, schema, type }) =>
            schema === 'main' && type === 'virtual' && name === 'project_search_fts',
        )?.strict,
      ).toBe(0);
      expect(ordinary.every(({ strict }) => strict === 1)).toBe(true);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      db.close();
    }
  });

  it('has no legacy authority tables and binds every versioned JSON column exactly once', async () => {
    const { db, ddl } = await openDatabase();
    try {
      expect(EXPECTED_TABLES).not.toContain('project_history');
      expect(EXPECTED_TABLES).not.toContain('operations');
      expect(EXPECTED_TABLES.join('\n')).not.toMatch(
        /(?:^|_)(?:prompt|preset|template|style|guide|workflow)(?:_|$)/,
      );

      const boundColumns = SCHEMA_BINDINGS_V1.map(([column]) => column).sort();
      expect(jsonColumnsFromDdl(ddl)).toEqual(boundColumns);

      for (const table of EXPECTED_TABLES.filter((name) => name !== 'project_search_fts')) {
        const columns = db
          .prepare(`PRAGMA table_info("${table}")`)
          .all() as unknown as TableColumnRow[];
        expect(
          columns
            .filter(({ name }) => name.includes('json'))
            .every(({ name }) => /_v1_json$/.test(name)),
        ).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('stores the exact mutable Delivery authority fields used by its tools', async () => {
    const { db } = await openDatabase();
    try {
      const planColumns = (
        db.prepare('PRAGMA table_info("delivery_plans")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      const itemColumns = (
        db.prepare('PRAGMA table_info("delivery_items")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      const exportColumns = (
        db.prepare('PRAGMA table_info("delivery_exports")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      const protectionColumns = (
        db.prepare('PRAGMA table_info("delivery_protections")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);

      expect(planColumns).toEqual(
        expect.arrayContaining([
          'revision',
          'content_hash',
          'name',
          'lifecycle',
          'format_intent_v1_json',
        ]),
      );
      expect(itemColumns).toEqual(
        expect.arrayContaining([
          'revision',
          'audio_policy',
          'transition_kind',
          'transition_duration_ms',
        ]),
      );
      expect(exportColumns).toEqual(
        expect.arrayContaining([
          'destination_kind',
          'destination_grant_id',
          'destination_grant_hash',
          'destination_display_label',
          'overwrite_existing',
          'output_content_hash',
        ]),
      );
      expect(protectionColumns).toEqual([
        'id',
        'project_id',
        'delivery_plan_id',
        'delivery_item_id',
        'field_ref',
        'choice_id',
        'protected_at',
        'released_by_choice_id',
      ]);
      expect(planColumns).not.toContain('protections_v1_json');
      expect(itemColumns).not.toContain('protections_v1_json');
    } finally {
      db.close();
    }
  });

  it('stores revision and content hash on every mutable root authority', async () => {
    const { db } = await openDatabase();
    try {
      const mutableRoots = [
        'projects',
        'global_media_folders',
        'global_media_assets',
        'canvas_documents',
        'chats',
        'runs',
        'task_lists',
      ] as const;

      for (const table of mutableRoots) {
        const columns = (
          db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as TableColumnRow[]
        ).map(({ name }) => name);
        expect(columns, table).toEqual(expect.arrayContaining(['revision', 'content_hash']));
      }
    } finally {
      db.close();
    }
  });

  it('keeps Global Media Folder hierarchy and Asset membership referential', async () => {
    const { db } = await openDatabase();
    try {
      const folderColumns = (
        db.prepare('PRAGMA table_info("global_media_folders")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      expect(folderColumns).toEqual([
        'id',
        'revision',
        'content_hash',
        'parent_id',
        'name',
        'sort_order',
        'created_at',
        'updated_at',
      ]);
      const folderForeignKey = (
        db
          .prepare('PRAGMA foreign_key_list("global_media_folders")')
          .all() as unknown as ForeignKeyRow[]
      ).find(({ from }) => from === 'parent_id');
      const assetFolderForeignKey = (
        db
          .prepare('PRAGMA foreign_key_list("global_media_assets")')
          .all() as unknown as ForeignKeyRow[]
      ).find(({ from }) => from === 'folder_id');
      expect(folderForeignKey).toMatchObject({
        from: 'parent_id',
        on_delete: 'RESTRICT',
        table: 'global_media_folders',
        to: 'id',
      });
      expect(assetFolderForeignKey).toMatchObject({
        from: 'folder_id',
        on_delete: 'RESTRICT',
        table: 'global_media_folders',
        to: 'id',
      });
      expect(
        (
          db
            .prepare('PRAGMA index_info("idx_global_media_folders_parent_order_name")')
            .all() as unknown as IndexColumnRow[]
        )
          .sort((left, right) => left.seqno - right.seqno)
          .map(({ name }) => name),
      ).toEqual(['parent_id', 'sort_order', 'name', 'id']);

      const insertFolder = db.prepare(`
        INSERT INTO global_media_folders (
          id, revision, content_hash, parent_id, name, sort_order, created_at, updated_at
        ) VALUES (?, 0, ?, ?, ?, ?, ?, ?)
      `);
      insertFolder.run(
        'folder.root',
        HASH_A,
        null,
        'Root',
        0,
        '2026-08-15T12:00:00.000Z',
        '2026-08-15T12:00:00.000Z',
      );
      insertFolder.run(
        'folder.child',
        HASH_B,
        'folder.root',
        'Child',
        -1,
        '2026-08-15T12:00:00.000Z',
        '2026-08-15T12:00:00.000Z',
      );
      expect(() =>
        insertFolder.run(
          'folder.self',
          HASH_C,
          'folder.self',
          'Self',
          0,
          '2026-08-15T12:00:00.000Z',
          '2026-08-15T12:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insertFolder.run(
          'folder.missing',
          HASH_C,
          'folder.unknown',
          'Missing',
          0,
          '2026-08-15T12:00:00.000Z',
          '2026-08-15T12:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insertFolder.run(
          'folder.unsafe',
          HASH_C,
          null,
          'Unsafe',
          Number.MAX_SAFE_INTEGER + 1,
          '2026-08-15T12:00:00.000Z',
          '2026-08-15T12:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        db.prepare("DELETE FROM global_media_folders WHERE id = 'folder.root'").run(),
      ).toThrow();

      insertFolder.run(
        'folder.asset',
        HASH_C,
        null,
        'Asset folder',
        1,
        '2026-08-15T12:00:00.000Z',
        '2026-08-15T12:00:00.000Z',
      );
      db.prepare(
        `INSERT INTO media_blobs (
           hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
         ) VALUES (?, 4, 'image/png', 'image', '{}', '2026-08-15T12:00:00.000Z')`,
      ).run(HASH_D);
      const insertAsset = db.prepare(`
        INSERT INTO global_media_assets (
          id, revision, content_hash, blob_hash, media_kind, filename, display_name,
          source_v1_json, folder_id, tags_v1_json, created_at, updated_at
        ) VALUES (?, 0, ?, ?, 'image', 'reference.png', 'Reference', '{}', ?, '[]', '2026-08-15T12:00:00.000Z', '2026-08-15T12:00:00.000Z')
      `);
      expect(() => insertAsset.run('asset.missing', HASH_A, HASH_D, 'folder.unknown')).toThrow();
      insertAsset.run('asset.foldered', HASH_A, HASH_D, 'folder.asset');
      expect(() =>
        db.prepare("DELETE FROM global_media_folders WHERE id = 'folder.asset'").run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('stores authenticated private recovery envelope metadata without plaintext fields', async () => {
    const { db } = await openDatabase();
    try {
      const columns = (
        db
          .prepare('PRAGMA table_info("private_recovery_envelopes")')
          .all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      expect(columns).toEqual(
        expect.arrayContaining([
          'sequence',
          'activation_number',
          'schema_version',
          'algorithm',
          'encryption_key_id',
          'nonce',
          'ciphertext',
          'authentication_tag',
          'ciphertext_hash',
          'aad_hash',
          'previous_envelope_hash',
          'envelope_hash',
          'byte_length',
          'created_at',
        ]),
      );
      expect(columns).not.toContain('plaintext');
    } finally {
      db.close();
    }
  });

  it('binds program-origin dispatches to exactly one parent call identity', async () => {
    const { db } = await openDatabase();
    try {
      const columns = (
        db.prepare('PRAGMA table_info("dispatch_operations")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      expect(columns).toEqual(
        expect.arrayContaining([
          'parent_dispatch_operation_id',
          'program_step_id',
          'program_call_index',
        ]),
      );
      const foreignKeys = db
        .prepare('PRAGMA foreign_key_list("dispatch_operations")')
        .all() as unknown as ForeignKeyRow[];
      expect(foreignKeys).toContainEqual(
        expect.objectContaining({
          from: 'parent_dispatch_operation_id',
          table: 'dispatch_operations',
          to: 'id',
          on_delete: 'RESTRICT',
        }),
      );
      const sql = (
        db
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'dispatch_operations'",
          )
          .get() as SqlRow
      ).sql;
      expect(sql).toContain(
        'UNIQUE (parent_dispatch_operation_id, program_step_id, program_call_index)',
      );
      expect(sql).toContain('parent_dispatch_operation_id <> id');
    } finally {
      db.close();
    }
  });

  it('binds each confirmation to at most one Dispatch', async () => {
    const { db } = await openDatabase();
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      const insertDispatch = db.prepare(`
        INSERT INTO dispatch_operations (
          id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
          input_hash, input_v1_json, confirmation_id, created_at, updated_at
        ) VALUES (?, 'run.confirmation', 'delivery.mutate', '2.0.0', 'confirmation_required', ?, ?, '{}', 'confirmation.1', ?, ?)
      `);
      insertDispatch.run(
        'dispatch.confirmation.1',
        HASH_A,
        HASH_B,
        '2026-08-24T00:00:00.000Z',
        '2026-08-24T00:00:00.000Z',
      );
      expect(() =>
        insertDispatch.run(
          'dispatch.confirmation.2',
          HASH_C,
          HASH_D,
          '2026-08-24T00:00:00.000Z',
          '2026-08-24T00:00:00.000Z',
        ),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('binds Project Skills to their exact confirmation and permits Skill event subjects', async () => {
    const { db } = await openDatabase();
    try {
      const skillColumns = (
        db.prepare('PRAGMA table_info("skills")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      expect(skillColumns).toContain('created_by_confirmation_id');

      const skillForeignKeys = db
        .prepare('PRAGMA foreign_key_list("skills")')
        .all() as unknown as ForeignKeyRow[];
      expect(skillForeignKeys).toContainEqual(
        expect.objectContaining({
          from: 'created_by_confirmation_id',
          table: 'run_confirmations',
          to: 'id',
          on_delete: 'RESTRICT',
        }),
      );

      const skillSql = (
        db
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'skills'")
          .get() as SqlRow
      ).sql;
      expect(skillSql).toContain("provenance = 'project'");
      expect(skillSql).toContain('project_id IS NOT NULL');
      expect(skillSql).toContain('created_by_confirmation_id IS NOT NULL');
      expect(skillSql).toContain('project_id IS NULL');
      expect(skillSql).toContain('created_by_confirmation_id IS NULL');

      const projectEventSql = (
        db
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'project_events'")
          .get() as SqlRow
      ).sql;
      expect(projectEventSql).toContain("'skill'");
    } finally {
      db.close();
    }
  });

  it('stores complete RunEvent envelopes and treats compaction tables as replay projections', async () => {
    const { db } = await openDatabase();
    try {
      const eventColumns = (
        db.prepare('PRAGMA table_info("run_events")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      expect(eventColumns).toEqual(
        expect.arrayContaining([
          'causation_v1_json',
          'correlation_id',
          'idempotency_key',
          'payload_hash',
          'previous_event_hash',
          'event_hash',
        ]),
      );

      const eventSql = (
        db
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'run_events'")
          .get() as SqlRow
      ).sql;
      expect(eventSql).toContain('UNIQUE (run_id, idempotency_key)');

      const compactionSql = (
        db
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'compaction_transactions'",
          )
          .get() as SqlRow
      ).sql;
      expect(compactionSql).toContain("'interrupted'");
      expect(compactionSql).not.toContain("'failed'");
    } finally {
      db.close();
    }
  });

  it('stores one recoverable Operation identity, resource ledger, and five typed owners', async () => {
    const { db } = await openDatabase();
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as TableColumnRow[]).map(
          ({ name }) => name,
        );
      const tableSql = (table: string) =>
        (
          db
            .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
            .get(table) as SqlRow
        ).sql ?? '';

      const dispatchColumns = columns('dispatch_operations');
      expect(dispatchColumns).toEqual(
        expect.arrayContaining([
          'authority_watermark_hash',
          'origin_model_attempt_id',
          'origin_provider_call_id',
          'outcome_v1_json',
          'outcome_hash',
          'completed_at',
          'operation_kind',
          'owner_authority',
          'owner_id',
        ]),
      );
      expect(dispatchColumns).not.toContain('owner_revision');
      expect(dispatchColumns).not.toContain('owner_content_hash');
      expect(dispatchColumns).not.toContain('state');
      expect(tableSql('dispatch_operations')).toContain(
        "operation_kind = 'result_assessment' AND owner_authority = 'result_assessment_attempt'",
      );
      expect(tableSql('dispatch_operations')).toContain(
        'outcome_v1_json IS NULL AND outcome_hash IS NULL AND completed_at IS NULL',
      );
      const dispatchIndexes = db
        .prepare('PRAGMA index_list("dispatch_operations")')
        .all() as unknown as IndexListRow[];
      expect(dispatchIndexes).toContainEqual(
        expect.objectContaining({ name: 'uniq_dispatch_operations_confirmation', unique: 1 }),
      );
      expect(
        (
          db
            .prepare(
              "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = 'uniq_dispatch_operations_confirmation'",
            )
            .get() as SqlRow
        ).sql,
      ).toContain('WHERE confirmation_id IS NOT NULL');

      const modelAttemptColumns = columns('model_attempts');
      expect(modelAttemptColumns).toEqual(
        expect.arrayContaining([
          'request_v1_json',
          'request_hash',
          'response_v1_json',
          'response_hash',
          'usage_v1_json',
          'finished_at',
        ]),
      );
      expect(tableSql('model_attempts')).toContain("state IN ('succeeded', 'failed', 'cancelled')");

      expect(columns('run_resource_entries')).toEqual(
        expect.arrayContaining([
          'dispatch_operation_id',
          'model_attempt_id',
          'phase',
          'reservation_entry_id',
          'idempotency_key',
        ]),
      );
      expect(tableSql('run_resource_entries')).toContain(
        '(dispatch_operation_id IS NULL) != (model_attempt_id IS NULL)',
      );

      const commonColumns = [
        'revision',
        'content_hash',
        'state',
        'cancel_requested',
        'progress_percent',
        'public_error_code',
        'created_at',
        'finished_at',
      ];
      for (const table of [
        'generation_attempts',
        'media_derivation_attempts',
        'result_assessment_attempts',
      ]) {
        expect(columns(table), table).toEqual(expect.arrayContaining(commonColumns));
        expect(tableSql(table), table).toContain("'execution_failed'");
        expect(tableSql(table), table).toContain(
          "state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'provider_failed', 'execution_failed')",
        );
      }
      for (const table of ['review_cut_attempts', 'delivery_exports']) {
        expect(columns(table), table).toEqual(expect.arrayContaining(commonColumns));
        expect(tableSql(table), table).toContain(
          "state != 'failed' OR public_error_code IN ('invalid_request', 'permission_denied', 'budget_exceeded', 'execution_failed')",
        );
        expect(tableSql(table)).toContain("state NOT IN ('submitted', 'unknown')");
        expect(tableSql(table)).not.toContain('provider_failed');
      }

      for (const index of [
        'uniq_generation_attempts_provider_operation',
        'uniq_media_derivation_attempts_provider_operation',
        'uniq_result_assessment_attempts_provider_operation',
      ]) {
        expect(
          (db.prepare(`PRAGMA index_info("${index}")`).all() as unknown as IndexColumnRow[])
            .sort((left, right) => left.seqno - right.seqno)
            .map(({ name }) => name),
        ).toEqual(['provider_profile_id', 'provider_operation_id']);
      }
    } finally {
      db.close();
    }
  });

  it('rejects incomplete model responses and dispatch outcomes at the storage boundary', async () => {
    const { db } = await openDatabase();
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      const insertModelAttempt = db.prepare(`
        INSERT INTO model_attempts (
          id, run_id, activation_id, attempt_number, provider_v1_json, state,
          request_v1_json, request_hash, response_v1_json, response_hash,
          usage_v1_json, created_at, finished_at
        ) VALUES (?, 'run.i3', 'activation.i3', 1, '{}', ?, '{}', ?, ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insertModelAttempt.run(
          'model.invalid.response-pair',
          'running',
          HASH_A,
          '{}',
          null,
          '{}',
          '2026-08-15T00:00:00.000Z',
          null,
        ),
      ).toThrow();
      expect(() =>
        insertModelAttempt.run(
          'model.invalid.finished-at',
          'running',
          HASH_A,
          null,
          null,
          null,
          '2026-08-15T00:00:00.000Z',
          '2026-08-15T00:00:01.000Z',
        ),
      ).toThrow();
      expect(() =>
        insertModelAttempt.run(
          'model.valid.succeeded',
          'succeeded',
          HASH_A,
          '{}',
          HASH_B,
          '{}',
          '2026-08-15T00:00:00.000Z',
          '2026-08-15T00:00:01.000Z',
        ),
      ).not.toThrow();

      const insertDispatch = db.prepare(`
        INSERT INTO dispatch_operations (
          id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
          input_hash, input_v1_json, outcome_v1_json, outcome_hash, completed_at,
          created_at, updated_at
        ) VALUES (?, 'run.i3', 'project.get', '1.0.0', 'allowed', ?, ?, '{}', ?, ?, ?, ?, ?)
      `);
      expect(() =>
        insertDispatch.run(
          'dispatch.invalid.partial-outcome',
          HASH_A,
          HASH_B,
          '{}',
          null,
          null,
          '2026-08-15T00:00:00.000Z',
          '2026-08-15T00:00:00.000Z',
        ),
      ).toThrow();
      expect(() =>
        insertDispatch.run(
          'dispatch.valid.complete-outcome',
          HASH_C,
          HASH_D,
          '{}',
          HASH_A,
          '2026-08-15T00:00:01.000Z',
          '2026-08-15T00:00:00.000Z',
          '2026-08-15T00:00:01.000Z',
        ),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('allows one derivation Attempt to emit identical bytes at different ordinals', async () => {
    const { db } = await openDatabase();
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      const insert = db.prepare(`
        INSERT INTO media_derivation_outputs (
          id, derivation_attempt_id, blob_hash, global_asset_id, project_media_ref_id, ordinal
        ) VALUES (?, 'attempt.derive.1', ?, ?, NULL, ?)
      `);
      insert.run('output.0', 'a'.repeat(64), 'asset.0', 0);
      expect(() => insert.run('output.1', 'a'.repeat(64), 'asset.1', 1)).not.toThrow();
      expect(() => insert.run('output.duplicate', 'b'.repeat(64), 'asset.2', 1)).toThrow();
    } finally {
      db.close();
    }
  });

  it('persists frozen Generated Results and ordered assessment subject/reference roles', async () => {
    const { db } = await openDatabase();
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info("${table}")`).all() as unknown as TableColumnRow[]).map(
          ({ name }) => name,
        );
      expect(columns('generated_results')).toEqual(
        expect.arrayContaining([
          'submitted_prompt',
          'submitted_negative_prompt',
          'prompt_provenance_v1_json',
          'reference_bindings_v1_json',
          'provider_v1_json',
          'seed',
          'receipt_v1_json',
          'usage_v1_json',
          'technical_validation_v1_json',
          'created_at',
        ]),
      );
      expect(columns('generated_results')).not.toContain('state');
      expect(columns('generated_results')).not.toContain('updated_at');
      expect(columns('result_assessment_subjects')).toEqual([
        'attempt_id',
        'role',
        'ordinal',
        'authority',
        'object_id',
        'revision',
        'content_hash',
      ]);
      expect(columns('result_assessments')).toEqual([
        'attempt_id',
        'assessment_v1_json',
        'content_hash',
        'created_at',
      ]);
    } finally {
      db.close();
    }
  });

  it('stores Canvas group membership in one ordered authority', async () => {
    const { db } = await openDatabase();
    try {
      const placementColumns = (
        db.prepare('PRAGMA table_info("canvas_placements")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);
      const membershipColumns = (
        db.prepare('PRAGMA table_info("canvas_group_members")').all() as unknown as TableColumnRow[]
      ).map(({ name }) => name);

      expect(placementColumns).not.toContain('group_id');
      expect(membershipColumns).toEqual(['group_id', 'placement_id', 'ordinal']);

      const uniqueIndexes = (
        db.prepare('PRAGMA index_list("canvas_group_members")').all() as unknown as IndexListRow[]
      ).filter(({ unique }) => unique === 1);
      const uniqueShapes = uniqueIndexes.map(({ name }) =>
        (db.prepare(`PRAGMA index_info("${name}")`).all() as unknown as IndexColumnRow[])
          .sort((left, right) => left.seqno - right.seqno)
          .map(({ name: column }) => column),
      );
      expect(uniqueShapes).toContainEqual(['group_id', 'ordinal']);

      db.exec(`
        INSERT INTO projects (
          id, name, lifecycle, schema_revision, revision, content_hash,
          created_by_kind, created_by_id,
          created_at, updated_at, archived_at, deleted_at
        ) VALUES (
          'project.canvas-order', 'Canvas order', 'active', 1, 0, '${'0'.repeat(64)}',
          'direct_ui', 'test.canvas-order',
          '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z', NULL, NULL
        );
        INSERT INTO canvas_documents (
          id, project_id, revision, content_hash, viewport_v1_json, next_z_index,
          created_at, updated_at
        ) VALUES (
          'canvas.order', 'project.canvas-order', 0, '${'1'.repeat(64)}',
          '{"center":{"x":0,"y":0},"zoom":1}', 1,
          '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'
        );
        INSERT INTO canvas_groups (id, canvas_id, title, revision, created_at, updated_at)
        VALUES (
          'group.order', 'canvas.order', 'Order', 0,
          '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'
        );
      `);
      for (const suffix of ['a', 'b']) {
        db.prepare(
          `INSERT INTO canvas_placements (
             id, canvas_id, target_authority, target_id, target_revision, target_hash,
             x, y, width, height, z_index, revision, created_at, updated_at
           ) VALUES (?, 'canvas.order', 'production', ?, 0, ?, 0, 0, 1, 1, 0, 0, ?, ?)`,
        ).run(
          `placement.${suffix}`,
          `shot.${suffix}`,
          '2'.repeat(64),
          '2026-08-15T00:00:00.000Z',
          '2026-08-15T00:00:00.000Z',
        );
      }
      db.prepare(
        `INSERT INTO canvas_group_members (group_id, placement_id, ordinal)
         VALUES ('group.order', 'placement.a', 0)`,
      ).run();
      expect(() =>
        db
          .prepare(
            `INSERT INTO canvas_group_members (group_id, placement_id, ordinal)
             VALUES ('group.order', 'placement.b', 0)`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });

  it('produces byte-equivalent schema state in a second disposable database', async () => {
    const first = await openDatabase();
    const second = await openDatabase();
    try {
      expect(schemaSnapshot(second.db)).toEqual(schemaSnapshot(first.db));
    } finally {
      first.db.close();
      second.db.close();
    }
  });
});
