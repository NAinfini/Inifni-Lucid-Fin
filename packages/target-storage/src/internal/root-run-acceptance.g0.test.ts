import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { assertSelectedContext } from './root-run-acceptance.js';

const HASH = 'a'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const ddl = readFileSync(
  new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url),
  'utf8',
);

function seedGeneratedResultOwner(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash,
         created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES ('project.1', 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.create',
                 ?, ?, NULL, NULL)`,
    )
    .run(HASH, NOW, NOW);
  database
    .prepare(
      `INSERT INTO chats (
         id, project_id, revision, content_hash, title, lifecycle, message_count,
         message_head_sequence, created_at, updated_at, archived_at, deleted_at
       ) VALUES ('chat.1', 'project.1', 0, ?, 'Main', 'active', 1, 1, ?, ?, NULL, NULL)`,
    )
    .run(HASH, NOW, NOW);
  database
    .prepare(
      `INSERT INTO messages (
         id, project_id, chat_id, sequence, role, status, originating_run_id,
         content_hash, supersedes_message_id, created_at
       ) VALUES ('message.1', 'project.1', 'chat.1', 1, 'user', 'accepted', NULL,
                 ?, NULL, ?)`,
    )
    .run(HASH, NOW);
  database.exec('BEGIN');
  try {
    database
      .prepare(
        `INSERT INTO runs (
           id, revision, content_hash, root_run_id, parent_run_id, project_id, chat_id,
           objective_message_id, objective_parent_event_id, objective_hash,
           child_display_name, child_public_summary, status, provider_profile_id, model,
           reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
           context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
           accepted_at, finished_at, terminal_summary
         ) VALUES ('run.1', 0, ?, 'run.1', NULL, 'project.1', 'chat.1', 'message.1', NULL,
                   ?, NULL, NULL, 'running', NULL, 'commander', NULL, 'reversible', '{}',
                   'context.1', ?, 'catalog.1', ?, ?, NULL, NULL)`,
      )
      .run(HASH, HASH, HASH, HASH, NOW);
    database
      .prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, parent_event_id,
           manifest_hash, manifest_v1_json, created_at
         ) VALUES ('context.1', 'run.1', 'project.1', 'chat.1', 'message.1', NULL,
                   ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database
      .prepare(
        `INSERT INTO capability_catalog_snapshots (
           id, run_id, catalog_hash, catalog_v1_json, created_at
         ) VALUES ('catalog.1', 'run.1', ?, '{}', ?)`,
      )
      .run(HASH, NOW);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.1', 'Provider', 'test', 'image-model', NULL, NULL, NULL,
                 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO media_blobs (
         hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
       ) VALUES (?, 1, 'image/png', 'image', '{"kind":"image","width":1,"height":1}', ?)`,
    )
    .run(HASH, NOW);
  database
    .prepare(
      `INSERT INTO global_media_assets (
         id, revision, content_hash, blob_hash, media_kind, filename, display_name,
         source_v1_json, folder_id, tags_v1_json, created_at, updated_at
       ) VALUES ('asset.1', 0, ?, ?, 'image', 'result.png', 'Result', '{}', NULL, '[]', ?, ?)`,
    )
    .run(HASH, HASH, NOW, NOW);
  database
    .prepare(
      `INSERT INTO project_media_refs (
         id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
         label, collections_v1_json, roles_v1_json, notes, created_by_kind,
         created_by_id, created_at, updated_at
       ) VALUES ('media.1', 'project.1', 'asset.1', 0, ?, 'active', NULL, 'Result',
                 '[]', '["generated_candidate"]', '', 'run', 'run.1', ?, ?)`,
    )
    .run(HASH, NOW, NOW);
  database
    .prepare(
      `INSERT INTO generation_requests (
         id, project_id, run_id, target_authority, target_id, target_revision, target_hash,
         spec_v1_json, request_hash, idempotency_key, created_at
       ) VALUES ('request.1', 'project.1', 'run.1', 'production', 'shot.1', 0, ?, '{}', ?, ?, ?)`,
    )
    .run(HASH, HASH, HASH, NOW);
  database
    .prepare(
      `INSERT INTO generation_attempts (
         id, request_id, attempt_number, revision, content_hash, state, provider_profile_id,
         provider_v1_json, quote_v1_json, provider_operation_id, receipt_v1_json,
         usage_v1_json, prompt_provenance_v1_json, cancel_requested, progress_percent,
         public_error_code, created_at, finished_at
       ) VALUES ('attempt.1', 'request.1', 1, 0, ?, 'running', 'provider.1', '{}', NULL,
                 NULL, NULL, NULL, '{}', 0, NULL, NULL, ?, NULL)`,
    )
    .run(HASH, NOW);
}

describe('G0 immutable Generated Result selection', () => {
  it('accepts an exact immutable result ref without a mutable state gate', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(ddl);
      seedGeneratedResultOwner(database);
      database
        .prepare(
          `INSERT INTO generated_results (
             id, project_id, request_id, attempt_id, revision, content_hash, blob_hash,
             global_asset_id, project_media_ref_id, media_kind, variant_index,
             submitted_prompt, submitted_negative_prompt, prompt_provenance_v1_json,
             reference_bindings_v1_json, provider_v1_json, seed, receipt_v1_json,
             usage_v1_json, technical_validation_v1_json, created_at
           ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'image', 0, ?, NULL, '{}', '[]', '{}',
                     NULL, '{}', '{}', '{}', ?)`,
        )
        .run(
          'result.1',
          'project.1',
          'request.1',
          'attempt.1',
          HASH,
          HASH,
          'asset.1',
          'media.1',
          'Moonlit harbor',
          NOW,
        );

      expect(() =>
        assertSelectedContext(database, 'project.1', [
          {
            ref: {
              authority: 'generated_result',
              id: 'result.1',
              revision: 0,
              contentHash: HASH,
            },
            role: 'reference',
          },
        ]),
      ).not.toThrow();
    } finally {
      database.close();
    }
  });
});
