import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  DeliveryExportSchema,
  DeliveryManifestSchema,
  ReviewCutAttemptSchema,
  canonicalJson,
  parseCanonical,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import { hashContentObject } from './hashes.js';
import { loadOperationOwnerRecord } from './operation-owner-records.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const ddl = readFileSync(
  new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url),
  'utf8',
);

function seedManifestOwners(database: DatabaseSync): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, name, lifecycle, schema_revision, revision, content_hash,
         created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
       ) VALUES ('project.1', 'Film', 'active', 1, 0, ?, 'direct_ui', 'action.create',
                 ?, ?, NULL, NULL)`,
    )
    .run(HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO chats (
         id, project_id, revision, content_hash, title, lifecycle, message_count,
         message_head_sequence, created_at, updated_at, archived_at, deleted_at
       ) VALUES ('chat.1', 'project.1', 0, ?, 'Main', 'active', 1, 1, ?, ?, NULL, NULL)`,
    )
    .run(HASH_A, NOW, NOW);
  database
    .prepare(
      `INSERT INTO messages (
         id, project_id, chat_id, sequence, role, status, originating_run_id,
         content_hash, supersedes_message_id, created_at
       ) VALUES ('message.1', 'project.1', 'chat.1', 1, 'user', 'accepted', NULL,
                 ?, NULL, ?)`,
    )
    .run(HASH_A, NOW);
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
      .run(HASH_A, HASH_A, HASH_A, HASH_A, NOW);
    database
      .prepare(
        `INSERT INTO context_manifests (
           id, run_id, project_id, chat_id, user_message_id, parent_event_id,
           manifest_hash, manifest_v1_json, created_at
         ) VALUES ('context.1', 'run.1', 'project.1', 'chat.1', 'message.1', NULL,
                   ?, '{}', ?)`,
      )
      .run(HASH_A, NOW);
    database
      .prepare(
        `INSERT INTO capability_catalog_snapshots (
           id, run_id, catalog_hash, catalog_v1_json, created_at
         ) VALUES ('catalog.1', 'run.1', ?, '{}', ?)`,
      )
      .run(HASH_A, NOW);
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
    .run(HASH_B, NOW);
  database
    .prepare(
      `INSERT INTO global_media_assets (
         id, revision, content_hash, blob_hash, media_kind, filename, display_name,
         source_v1_json, folder_id, tags_v1_json, created_at, updated_at
       ) VALUES ('asset.1', 0, ?, ?, 'image', 'result.png', 'Result', '{}', NULL, '[]', ?, ?)`,
    )
    .run(HASH_A, HASH_B, NOW, NOW);
  database
    .prepare(
      `INSERT INTO project_media_refs (
         id, project_id, global_asset_id, revision, content_hash, lifecycle, detached_at,
         label, collections_v1_json, roles_v1_json, notes, created_by_kind,
         created_by_id, created_at, updated_at
       ) VALUES ('media.1', 'project.1', 'asset.1', 1, ?, 'active', NULL, 'Result',
                 '[]', '["generated_candidate"]', '', 'run', 'run.1', ?, ?)`,
    )
    .run(HASH_C, NOW, NOW);
  database
    .prepare(
      `INSERT INTO generation_requests (
         id, project_id, run_id, target_authority, target_id, target_revision, target_hash,
         spec_v1_json, request_hash, idempotency_key, created_at
       ) VALUES ('request.1', 'project.1', 'run.1', 'production', 'shot.1', 2, ?, '{}', ?, ?, ?)`,
    )
    .run(HASH_A, HASH_A, HASH_A, NOW);
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
    .run(HASH_A, NOW);
  database
    .prepare(
      `INSERT INTO generated_results (
         id, project_id, request_id, attempt_id, revision, content_hash, blob_hash,
         global_asset_id, project_media_ref_id, media_kind, variant_index,
         submitted_prompt, submitted_negative_prompt, prompt_provenance_v1_json,
         reference_bindings_v1_json, provider_v1_json, seed, receipt_v1_json,
         usage_v1_json, technical_validation_v1_json, created_at
       ) VALUES ('result.1', 'project.1', 'request.1', 'attempt.1', 0, ?, ?, 'asset.1',
                 'media.1', 'image', 0, 'Moonlit harbor', NULL, '{}', '[]', '{}', NULL,
                 '{}', '{}', '{}', ?)`,
    )
    .run(HASH_B, HASH_B, NOW);
}

describe('G0 local Delivery owner projections', () => {
  it('loads the exact immutable Manifest, Review Cut, and Export columns', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(ddl);
      seedManifestOwners(database);
      const formatIntent = {
        container: 'mp4' as const,
        videoCodec: 'h264' as const,
        audioCodec: 'aac' as const,
        width: 1920,
        height: 1080,
        frameRate: 24,
        quality: 'review' as const,
      };
      const planRef = {
        authority: 'delivery' as const,
        id: 'delivery.1',
        revision: 0,
        contentHash: HASH_A,
      };
      const item = {
        deliveryItemId: 'delivery.item.1',
        deliveryItemRevision: 0,
        deliveryItemContentHash: HASH_B,
        shotId: 'shot.1',
        shotRevision: 2,
        shotContentHash: HASH_A,
        generatedResultId: 'result.1',
        generatedResultRevision: 0 as const,
        generatedResultContentHash: HASH_B,
        projectMediaRefId: 'media.1',
        projectMediaRevision: 1,
        projectMediaContentHash: HASH_C,
        globalAssetId: 'asset.1',
        globalAssetRevision: 0,
        globalAssetContentHash: HASH_A,
        blobHash: HASH_B,
        order: 0,
        trimStartMs: 0,
        trimEndMs: 1000,
        audioPolicy: 'use' as const,
        transition: { kind: 'cut' as const, durationMs: 0 },
        reviewState: 'approved' as const,
      };
      const planField = {
        owner: 'delivery' as const,
        deliveryId: planRef.id,
        itemId: null,
        field: 'name' as const,
      };
      const itemField = {
        owner: 'delivery' as const,
        deliveryId: planRef.id,
        itemId: item.deliveryItemId,
        field: 'trim' as const,
      };
      const manifestWithoutHash = {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        projectId: 'project.1',
        revision: 0 as const,
        contentHash: '',
        sourcePlan: planRef,
        formatIntent,
        items: [item],
        currentChoices: [
          {
            field: planField,
            choice: { authority: 'user_choice' as const, id: 'choice.1', choiceHash: HASH_A },
          },
        ],
        protections: [
          {
            field: itemField,
            choice: { authority: 'user_choice' as const, id: 'choice.2', choiceHash: HASH_B },
          },
        ],
        createdBy: { kind: 'direct_ui' as const, actionId: 'action.freeze' },
        frozenAt: NOW,
      };
      const manifest = parseCanonical(DeliveryManifestSchema, {
        ...manifestWithoutHash,
        contentHash: hashContentObject(manifestWithoutHash),
      });
      const reviewWithoutHash = {
        authority: 'review_cut_attempt' as const,
        id: 'review.1',
        projectId: manifest.projectId,
        runId: 'run.1',
        manifest: {
          authority: manifest.authority,
          id: manifest.id,
          revision: manifest.revision,
          contentHash: manifest.contentHash,
        },
        request: {
          manifest: {
            authority: manifest.authority,
            id: manifest.id,
            revision: manifest.revision,
            contentHash: manifest.contentHash,
          },
          range: null,
        },
        revision: 0,
        contentHash: '',
        state: 'running' as const,
        requestHash: HASH_A,
        idempotencyKey: HASH_B,
        provider: null,
        receipt: null,
        usage: null,
        cancelRequested: false,
        progressPercent: 10,
        publicErrorCode: null,
        outputBlobHash: null,
        createdAt: NOW,
        finishedAt: null,
      };
      const review = parseCanonical(ReviewCutAttemptSchema, {
        ...reviewWithoutHash,
        contentHash: hashContentObject(reviewWithoutHash),
      });
      const exportWithoutHash = {
        authority: 'delivery_export' as const,
        id: 'export.1',
        projectId: manifest.projectId,
        runId: 'run.1',
        manifest: review.manifest,
        destination: {
          kind: 'user_selected_file' as const,
          grantId: 'grant.1',
          grantHash: HASH_C,
          displayLabel: 'review.mp4',
        },
        overwriteExisting: false,
        revision: 0,
        contentHash: '',
        state: 'prepared' as const,
        requestHash: HASH_B,
        idempotencyKey: HASH_C,
        provider: null,
        receipt: null,
        usage: null,
        cancelRequested: false,
        progressPercent: null,
        publicErrorCode: null,
        outputBlobHash: null,
        outputContentHash: null,
        createdAt: NOW,
        finishedAt: null,
      };
      const deliveryExport = parseCanonical(DeliveryExportSchema, {
        ...exportWithoutHash,
        contentHash: hashContentObject(exportWithoutHash),
      });

      database
        .prepare(
          `INSERT INTO delivery_plans (
           id, project_id, revision, content_hash, name, lifecycle,
             format_intent_v1_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'Review', 'active', ?, ?, ?)`,
        )
        .run(
          planRef.id,
          manifest.projectId,
          planRef.revision,
          planRef.contentHash,
          canonicalJson(formatIntent),
          NOW,
          NOW,
        );
      const insertChoice = database.prepare(
        `INSERT INTO user_choices (
           id, project_id, actor, authorization_kind, authorization_source_id,
           authorization_input_hash, dispatch_operation_id, confirmation_id, subject_v1_json,
           choice_v1_json, before_effect_v1_json, after_effect_v1_json, owner_kind,
           production_owner_id, delivery_owner_id, owner_before_revision, owner_before_hash,
           owner_after_revision, owner_after_hash, causation_v1_json, choice_hash, created_at
         ) VALUES (?, ?, 'user', 'direct_user', ?, ?, NULL, NULL, '{}', '{}', '{}', '{}',
                   'delivery', NULL, ?, NULL, NULL, 0, ?, '{}', ?, ?)`,
      );
      insertChoice.run(
        'choice.1',
        manifest.projectId,
        'request.choice.1',
        HASH_A,
        planRef.id,
        planRef.contentHash,
        HASH_A,
        NOW,
      );
      insertChoice.run(
        'choice.2',
        manifest.projectId,
        'request.choice.2',
        HASH_B,
        planRef.id,
        planRef.contentHash,
        HASH_B,
        NOW,
      );
      database
        .prepare(
          `INSERT INTO delivery_manifests (
             id, project_id, delivery_plan_id, delivery_revision, delivery_content_hash,
             revision, content_hash, format_intent_v1_json, created_by_v1_json, frozen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          manifest.id,
          manifest.projectId,
          manifest.sourcePlan.id,
          manifest.sourcePlan.revision,
          manifest.sourcePlan.contentHash,
          manifest.revision,
          manifest.contentHash,
          canonicalJson(manifest.formatIntent),
          canonicalJson(manifest.createdBy),
          manifest.frozenAt,
        );
      database
        .prepare(
          `INSERT INTO delivery_manifest_items (
             id, delivery_manifest_id, delivery_item_id, delivery_item_revision,
             delivery_item_content_hash, shot_id, shot_revision, shot_content_hash,
             generated_result_id, generated_result_revision, generated_result_content_hash,
             project_media_ref_id, project_media_revision, project_media_content_hash,
             global_asset_id, global_asset_revision, global_asset_content_hash, blob_hash,
             ordinal, trim_start_ms, trim_end_ms, audio_policy, transition_kind,
             transition_duration_ms, review_state
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'manifest.item.1',
          manifest.id,
          item.deliveryItemId,
          item.deliveryItemRevision,
          item.deliveryItemContentHash,
          item.shotId,
          item.shotRevision,
          item.shotContentHash,
          item.generatedResultId,
          item.generatedResultRevision,
          item.generatedResultContentHash,
          item.projectMediaRefId,
          item.projectMediaRevision,
          item.projectMediaContentHash,
          item.globalAssetId,
          item.globalAssetRevision,
          item.globalAssetContentHash,
          item.blobHash,
          item.order,
          item.trimStartMs,
          item.trimEndMs,
          item.audioPolicy,
          item.transition.kind,
          item.transition.durationMs,
          item.reviewState,
        );
      database
        .prepare(
          `INSERT INTO delivery_manifest_choices (
             delivery_manifest_id, delivery_item_id, field_ref, choice_id, choice_hash
           ) VALUES (?, NULL, ?, ?, ?)`,
        )
        .run(manifest.id, canonicalJson(planField), 'choice.1', HASH_A);
      database
        .prepare(
          `INSERT INTO delivery_manifest_protections (
             delivery_manifest_id, delivery_item_id, field_ref, choice_id, choice_hash
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(manifest.id, item.deliveryItemId, canonicalJson(itemField), 'choice.2', HASH_B);
      database
        .prepare(
          `INSERT INTO review_cut_attempts (
             id, project_id, run_id, delivery_manifest_id, delivery_manifest_revision,
             delivery_manifest_hash, revision, content_hash, state, request_v1_json,
             request_hash, idempotency_key, cancel_requested, progress_percent,
             public_error_code, output_blob_hash, created_at, finished_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          review.id,
          review.projectId,
          review.runId,
          review.manifest.id,
          review.manifest.revision,
          review.manifest.contentHash,
          review.revision,
          review.contentHash,
          review.state,
          canonicalJson(review.request),
          review.requestHash,
          review.idempotencyKey,
          Number(review.cancelRequested),
          review.progressPercent,
          review.publicErrorCode,
          review.outputBlobHash,
          review.createdAt,
          review.finishedAt,
        );
      database
        .prepare(
          `INSERT INTO delivery_exports (
             id, project_id, run_id, delivery_manifest_id, delivery_manifest_revision,
             delivery_manifest_hash, revision, content_hash, destination_kind,
             destination_grant_id, destination_grant_hash, destination_display_label,
             destination_v1_json, overwrite_existing, state, request_hash, idempotency_key, cancel_requested,
             progress_percent, public_error_code, output_blob_hash, output_content_hash,
             created_at, finished_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          deliveryExport.id,
          deliveryExport.projectId,
          deliveryExport.runId,
          deliveryExport.manifest.id,
          deliveryExport.manifest.revision,
          deliveryExport.manifest.contentHash,
          deliveryExport.revision,
          deliveryExport.contentHash,
          deliveryExport.destination.kind,
          deliveryExport.destination.grantId,
          deliveryExport.destination.grantHash,
          deliveryExport.destination.displayLabel,
          canonicalJson(deliveryExport.destination),
          Number(deliveryExport.overwriteExisting),
          deliveryExport.state,
          deliveryExport.requestHash,
          deliveryExport.idempotencyKey,
          Number(deliveryExport.cancelRequested),
          deliveryExport.progressPercent,
          deliveryExport.publicErrorCode,
          deliveryExport.outputBlobHash,
          deliveryExport.outputContentHash,
          deliveryExport.createdAt,
          deliveryExport.finishedAt,
        );

      expect(loadOperationOwnerRecord(database, 'review_cut_attempt', review.id).view).toEqual(
        review,
      );
      expect(loadOperationOwnerRecord(database, 'delivery_export', deliveryExport.id).view).toEqual(
        deliveryExport,
      );
      database
        .prepare('UPDATE delivery_exports SET destination_v1_json = ? WHERE id = ?')
        .run(
          canonicalJson({ ...deliveryExport.destination, displayLabel: 'tampered.mp4' }),
          deliveryExport.id,
        );
      expect(() =>
        loadOperationOwnerRecord(database, 'delivery_export', deliveryExport.id),
      ).toThrow(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      database.close();
    }
  });
});
