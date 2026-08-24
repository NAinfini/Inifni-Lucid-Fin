import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const ddlUrl = new URL('../ddl/project-v1.sql', import.meta.url);

async function openDatabase(): Promise<DatabaseSync> {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(ddlUrl, 'utf8'));
  database.exec('PRAGMA foreign_keys = OFF');
  return database;
}

function tableSql(database: DatabaseSync, table: string): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  if (row === undefined) throw new Error(`Missing table ${table}`);
  return row.sql;
}

function indexes(database: DatabaseSync, table: string): string {
  return (
    database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL",
      )
      .all(table) as { sql: string }[]
  )
    .map((row) => row.sql)
    .join('\n');
}

describe('I2-G0 immutable result and decision DDL', () => {
  it('rebuilds GeneratedResult as immutable revision zero evidence', async () => {
    const database = await openDatabase();
    try {
      const sql = tableSql(database, 'generated_results');
      expect(sql).toContain('CHECK (revision = 0)');
      expect(sql).not.toMatch(/\bstate\b/i);
      expect(sql).not.toContain('updated_at');
      expect(sql).toContain('UNIQUE (id, revision, content_hash)');
    } finally {
      database.close();
    }
  });

  it('enforces one selected result per Shot', async () => {
    const database = await openDatabase();
    try {
      const insert = database.prepare(`
        INSERT INTO production_result_decisions (
          project_id, shot_id, generated_result_id, generated_result_revision,
          generated_result_hash, state, feedback, instruction, current_choice_id
        ) VALUES ('project.1', 'shot.1', ?, 0, ?, 'selected', '', NULL, ?)
      `);
      expect(() => insert.run('result.1', HASH_A, 'choice.1')).not.toThrow();
      expect(() => insert.run('result.2', HASH_B, 'choice.2')).toThrow();
    } finally {
      database.close();
    }
  });
});

describe('I2-G0 active protection DDL', () => {
  it('enforces active Production and NULL-item Delivery uniqueness and permits replacement after release', async () => {
    const database = await openDatabase();
    try {
      const production = database.prepare(`
        INSERT INTO production_protections (
          id, project_id, production_object_id, field_ref, choice_id, protected_at, released_by_choice_id
        ) VALUES (?, 'project.1', 'shot.1', 'content', ?, ?, NULL)
      `);
      production.run('protection.production.1', 'choice.1', NOW);
      expect(() => production.run('protection.production.2', 'choice.2', NOW)).toThrow();
      database
        .prepare(
          "UPDATE production_protections SET released_by_choice_id = 'choice.3' WHERE id = 'protection.production.1'",
        )
        .run();
      expect(() => production.run('protection.production.2', 'choice.2', NOW)).not.toThrow();

      const delivery = database.prepare(`
        INSERT INTO delivery_protections (
          id, project_id, delivery_plan_id, delivery_item_id, field_ref,
          choice_id, protected_at, released_by_choice_id
        ) VALUES (?, 'project.1', 'delivery.1', NULL, 'order', ?, ?, NULL)
      `);
      delivery.run('protection.delivery.1', 'choice.4', NOW);
      expect(() => delivery.run('protection.delivery.2', 'choice.5', NOW)).toThrow();
      database
        .prepare(
          "UPDATE delivery_protections SET released_by_choice_id = 'choice.6' WHERE id = 'protection.delivery.1'",
        )
        .run();
      expect(() => delivery.run('protection.delivery.2', 'choice.5', NOW)).not.toThrow();
    } finally {
      database.close();
    }
  });
});

describe('I2-G0 exact Choice, Delivery, manifest, and local-operation DDL', () => {
  it('stores immutable Choice evidence and bounded supersessions without a mutable subject copy', async () => {
    const database = await openDatabase();
    try {
      const choiceSql = tableSql(database, 'user_choices');
      expect(choiceSql).toContain('authorization_kind');
      expect(choiceSql).toContain('owner_before_revision');
      expect(choiceSql).toContain('owner_after_revision');
      expect(choiceSql).toContain('before_effect_v1_json');
      expect(choiceSql).toContain('after_effect_v1_json');
      expect(choiceSql).toContain('choice_hash');
      expect(tableSql(database, 'user_choice_supersessions')).toContain(
        'CHECK (ordinal BETWEEN 0 AND 31)',
      );
    } finally {
      database.close();
    }
  });

  it('uses partial uniqueness for mutable Delivery owner rows and freezes immutable manifests', async () => {
    const database = await openDatabase();
    try {
      const itemSql = tableSql(database, 'delivery_items');
      expect(itemSql).toContain('content_hash');
      expect(itemSql).toContain('lifecycle');
      expect(indexes(database, 'delivery_items')).toMatch(/WHERE lifecycle = 'active'/);
      expect(tableSql(database, 'delivery_field_choices')).toContain('choice_id');
      const manifestSql = tableSql(database, 'delivery_manifests');
      expect(manifestSql).toContain('CHECK (revision = 0)');
      expect(manifestSql).toContain('content_hash');
      expect(tableSql(database, 'delivery_manifest_items')).toContain('global_asset_content_hash');
      expect(tableSql(database, 'delivery_manifest_choices')).toContain('choice_hash');
      expect(tableSql(database, 'delivery_manifest_protections')).toContain('choice_hash');
    } finally {
      database.close();
    }
  });

  it('keeps Review Cut and Export local, path-free, provider-free, and success-output exact', async () => {
    const database = await openDatabase();
    try {
      const review = tableSql(database, 'review_cut_attempts');
      const exported = tableSql(database, 'delivery_exports');
      for (const sql of [review, exported]) {
        expect(sql).toContain("state NOT IN ('submitted', 'unknown')");
        expect(sql).not.toMatch(/provider/i);
        expect(sql).toContain("(state = 'succeeded') = (output_blob_hash IS NOT NULL)");
      }
      expect(review).toContain('delivery_manifest_id');
      expect(review).toContain('request_v1_json');
      expect(exported).toContain('destination_grant_id');
      expect(exported).toContain('destination_grant_hash');
      expect(exported).toContain('destination_display_label');
      expect(exported).not.toContain('capability_token');
      expect(exported).not.toMatch(/absolute_path|file_path|folder_path/i);
    } finally {
      database.close();
    }
  });
});

describe('I2-G0 search, bindings, and TaskList isolation DDL', () => {
  it('adds exact Review Cut and Export search kinds without TaskList coupling', async () => {
    const database = await openDatabase();
    try {
      const search = tableSql(database, 'project_search_documents');
      expect(search).toContain("'review_cut'");
      expect(search).toContain("'delivery_export'");
      const scopedSql = [
        tableSql(database, 'production_result_decisions'),
        tableSql(database, 'user_choices'),
        tableSql(database, 'production_protections'),
        tableSql(database, 'delivery_plans'),
        tableSql(database, 'delivery_items'),
        tableSql(database, 'delivery_protections'),
        tableSql(database, 'delivery_manifests'),
        tableSql(database, 'review_cut_attempts'),
        tableSql(database, 'delivery_exports'),
      ]
        .join('\n')
        .toLowerCase();
      expect(scopedSql).not.toContain('task_list');
      expect(scopedSql).not.toContain('tasklist');
    } finally {
      database.close();
    }
  });
});
