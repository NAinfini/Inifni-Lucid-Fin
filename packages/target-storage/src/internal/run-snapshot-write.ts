import {
  assertRunContextManifest,
  type CapabilityCatalogSnapshotV1,
  type ContextManifest,
  type Run,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  encodeCapabilityCatalogSnapshot,
  encodeContextManifest,
  encodeResourceBudget,
} from './canonical-codecs.js';
import { hashCanonical, hashContentObject } from './hashes.js';

export function insertAcceptedRunSnapshot(
  database: DatabaseSync,
  run: Run,
  manifest: ContextManifest,
  catalog: CapabilityCatalogSnapshotV1,
): void {
  if (!database.isTransaction) {
    throw new TargetStorageError('INVALID_REQUEST', 'Run snapshot insert requires a transaction');
  }
  if (
    run.revision !== 0 ||
    run.status !== 'accepted' ||
    run.publicEventHead !== null ||
    run.privateRecoveryHead !== null ||
    run.terminalOutcome !== null
  ) {
    throw new TargetStorageError('CORRUPT_DATA', 'Accepted Run snapshot is not initial');
  }
  try {
    assertRunContextManifest(run, manifest, catalog);
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', 'Accepted Run snapshot is inconsistent', {
      cause,
    });
  }
  if (
    hashContentObject(run) !== run.contentHash ||
    hashCanonical(manifest) !== run.contextManifestHash ||
    catalog.catalogHash !== run.capabilityCatalogHash
  ) {
    throw new TargetStorageError('CORRUPT_DATA', 'Accepted Run snapshot hash does not match');
  }

  const child = run.parentRunId === null ? null : run;
  const messageSource = run.acceptedSource.kind === 'message' ? run.acceptedSource : null;
  const parentSource = run.acceptedSource.kind === 'parent_direction' ? run.acceptedSource : null;
  const objectiveHash =
    run.acceptedSource.kind === 'message'
      ? run.acceptedSource.contentHash
      : run.acceptedSource.directionHash;
  database
    .prepare(
      `INSERT INTO runs (
         id, revision, content_hash, root_run_id, parent_run_id, retry_of_run_id,
         retry_seed_hash, project_id, chat_id,
         objective_message_id, objective_parent_event_id, objective_hash,
         child_display_name, child_public_summary, status, provider_profile_id, model,
         reasoning_strength, permission_mode, budget_v1_json, context_manifest_id,
         context_manifest_hash, capability_catalog_snapshot_id, capability_catalog_hash,
         accepted_at, finished_at, terminal_summary
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
    .run(
      run.id,
      run.revision,
      run.contentHash,
      run.rootRunId,
      run.parentRunId,
      run.retryOfRunId,
      run.retrySeedHash,
      run.projectId,
      run.chatId,
      messageSource?.messageId ?? null,
      parentSource?.parentEventId ?? null,
      objectiveHash,
      child?.displayName ?? null,
      child?.publicSummary ?? null,
      run.status,
      run.model.providerId,
      run.model.model,
      run.model.reasoningStrength,
      run.permissionMode,
      encodeResourceBudget(run.budget),
      run.contextManifestId,
      run.contextManifestHash,
      run.capabilityCatalogSnapshotId,
      run.capabilityCatalogHash,
      run.acceptedAt,
    );

  database
    .prepare(
      `INSERT INTO context_manifests (
         id, run_id, project_id, chat_id, user_message_id, parent_event_id,
         manifest_hash, manifest_v1_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      manifest.id,
      manifest.runId,
      manifest.projectId,
      manifest.chatId,
      manifest.acceptedSource.kind === 'message' ? manifest.acceptedSource.messageId : null,
      manifest.acceptedSource.kind === 'parent_direction'
        ? manifest.acceptedSource.parentEventId
        : null,
      run.contextManifestHash,
      encodeContextManifest(manifest),
      manifest.createdAt,
    );

  database
    .prepare(
      `INSERT INTO capability_catalog_snapshots (
         id, run_id, catalog_hash, catalog_v1_json, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      run.capabilityCatalogSnapshotId,
      run.id,
      catalog.catalogHash,
      encodeCapabilityCatalogSnapshot(catalog),
      manifest.createdAt,
    );
}
