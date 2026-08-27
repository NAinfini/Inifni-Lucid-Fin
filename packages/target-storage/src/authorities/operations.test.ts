import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapabilityCatalogSnapshotV1Schema,
  DeliveryExportSchema,
  DeliveryManifestSchema,
  EvaluationInputSchema,
  GenerationAttemptViewSchema,
  GenerationRequestSchema,
  GenerationSpecSchema,
  MediaDerivationAttemptViewSchema,
  MediaDerivationSchema,
  MediaDerivationTransformSchema,
  ResultAssessmentAttemptViewSchema,
  ReviewCutAttemptSchema,
  canonicalJson,
  generationRequestHashInput,
  mediaDerivationRequestHashInput,
  parseCanonical,
  type OperationRef,
} from '@lucid-fin/target-contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import {
  registerOperationDispatch,
  resolveOperationDispatchKey,
  type BoundOperationRecord,
} from '../internal/operation-dispatch.js';
import { operationRefForOwner } from '../internal/operation-owner-records.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import { createTargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

const NOW = '2026-08-15T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const paths: string[] = [];
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);
const userContext = {
  actor: 'user' as const,
  causation: { kind: 'direct_ui' as const, actionId: 'action.operations' },
  correlationId: 'correlation.operations.setup',
};
const budget = {
  costUsd: { state: 'known' as const, value: '20', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
};
const formatPolicy = { aspectRatio: '16:9' as const, customDimensions: null, frameRate: 24 };
const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('unused');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('unused');
  },
};
const unusedCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('unused');
  },
};

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}.${count}`;
  };
}

async function baseHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-operations-'));
  paths.push(directory);
  const store = await createTargetStore(join(directory, 'project.sqlite'));
  const createId = deterministicIds();
  const environment = { now: () => NOW, createId };
  const data = createTargetDataAccess(store, {
    ...environment,
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedCapabilities,
  });
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.operations',
      method: 'project.create',
      input: { name: 'Operation Film', permissionMode: 'reversible', budget, formatPolicy },
    },
    userContext,
  ).result.project;
  const database = getTargetStoreDatabase(store);
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.1', 'Provider', 'openai', 'video-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.operations',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.operations',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Create the sequence.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: { providerId: 'provider.1', model: 'video-model', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  return {
    store,
    database,
    data,
    project,
    run,
    environment,
    context: {
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: run.id },
      correlationId: 'correlation.operations',
    },
  };
}

type Fixture = Awaited<ReturnType<typeof baseHarness>>;

function seedOwnerRows(fixture: Fixture) {
  const { database, project, run } = fixture;
  const provider = { providerId: 'provider.1', model: 'video-model', reasoningStrength: null };
  const spec = parseCanonical(GenerationSpecSchema, {
    kind: 'video',
    task: 'create',
    target: { authority: 'production', id: 'shot.1', revision: 0, contentHash: HASH_A },
    prompt: 'Slow dolly across a moonlit harbor.',
    negativePrompt: null,
    references: [],
    provider: { providerId: provider.providerId, model: provider.model },
    outputCount: 1,
    seed: 42,
    width: 1920,
    height: 1080,
    durationMs: 5000,
    frameRate: 24,
    includeAudio: false,
  });
  const request = parseCanonical(GenerationRequestSchema, {
    id: 'generation.request.1',
    projectId: project.id,
    runId: run.id,
    spec,
    requestHash: hashCanonical(generationRequestHashInput(spec)),
    idempotencyKey: hashCanonical({ owner: 'generation.request.1' }),
    createdAt: NOW,
  });
  const generationWithoutHash = {
    authority: 'generation_attempt' as const,
    id: 'generation.attempt.1',
    requestId: request.id,
    attemptNumber: 1,
    revision: 0,
    contentHash: '',
    state: 'prepared' as const,
    provider,
    quote: null,
    receipt: null,
    usage: null,
    promptProvenance: {
      sourceObjectId: spec.target.id,
      sourceRevision: spec.target.revision,
      sourceHash: spec.target.contentHash,
      assemblyHash: hashCanonical({ prompt: spec.prompt }),
      loadedSkillDigests: [],
    },
    cancelRequested: false,
    progressPercent: null,
    publicErrorCode: null,
    createdAt: NOW,
    finishedAt: null,
    request,
  };
  const generation = parseCanonical(GenerationAttemptViewSchema, {
    ...generationWithoutHash,
    contentHash: hashContentObject(generationWithoutHash),
  });
  const transform = parseCanonical(MediaDerivationTransformSchema, {
    operation: 'resize',
    width: 1280,
    height: 720,
    fit: 'contain',
  });
  const derivationWithoutHash = {
    authority: 'media_derivation' as const,
    id: 'media.derivation.1',
    projectId: project.id,
    runId: run.id,
    sourceBlobHash: HASH_B,
    transform,
    requestHash: '',
    idempotencyKey: hashCanonical({ owner: 'media.derivation.1' }),
    createdAt: NOW,
  };
  const derivation = parseCanonical(MediaDerivationSchema, {
    ...derivationWithoutHash,
    requestHash: hashCanonical(mediaDerivationRequestHashInput(derivationWithoutHash)),
  });
  const mediaWithoutHash = {
    authority: 'media_derivation_attempt' as const,
    id: 'media.attempt.1',
    derivation,
    attemptNumber: 1,
    revision: 0,
    contentHash: '',
    state: 'running' as const,
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: 10,
    publicErrorCode: null,
    createdAt: NOW,
    finishedAt: null,
  };
  const media = parseCanonical(MediaDerivationAttemptViewSchema, {
    ...mediaWithoutHash,
    contentHash: hashContentObject(mediaWithoutHash),
  });
  const evaluationRequest = parseCanonical(EvaluationInputSchema, {
    kind: 'technical_integrity',
    subjects: [
      {
        authority: 'project',
        id: project.id,
        revision: project.revision,
        contentHash: project.contentHash,
      },
    ],
    checks: ['readable'],
    provider: null,
  });
  const assessmentWithoutHash = {
    authority: 'result_assessment_attempt' as const,
    id: 'assessment.attempt.1',
    projectId: project.id,
    runId: run.id,
    revision: 0,
    contentHash: '',
    request: evaluationRequest,
    requestHash: hashCanonical(evaluationRequest),
    idempotencyKey: hashCanonical({ owner: 'assessment.attempt.1' }),
    state: 'prepared' as const,
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: null,
    publicErrorCode: null,
    createdAt: NOW,
    finishedAt: null,
    assessment: null,
  };
  const assessment = parseCanonical(ResultAssessmentAttemptViewSchema, {
    ...assessmentWithoutHash,
    contentHash: hashContentObject(assessmentWithoutHash),
  });
  const deliveryFormat = {
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    width: 1920,
    height: 1080,
    frameRate: 24,
    quality: 'review' as const,
  };
  const deliveryHash = hashCanonical({ delivery: 'delivery.1' });
  const manifestWithoutHash = {
    authority: 'delivery_manifest' as const,
    id: 'delivery.manifest.1',
    projectId: project.id,
    revision: 0 as const,
    contentHash: '',
    sourcePlan: {
      authority: 'delivery' as const,
      id: 'delivery.1',
      revision: 0,
      contentHash: deliveryHash,
    },
    formatIntent: deliveryFormat,
    items: [],
    currentChoices: [],
    protections: [],
    createdBy: { kind: 'direct_ui' as const, actionId: 'action.operations' },
    frozenAt: NOW,
  };
  const manifest = parseCanonical(DeliveryManifestSchema, {
    ...manifestWithoutHash,
    contentHash: hashContentObject(manifestWithoutHash),
  });
  const manifestRef = {
    authority: manifest.authority,
    id: manifest.id,
    revision: manifest.revision,
    contentHash: manifest.contentHash,
  };
  const reviewRequest = { manifest: manifestRef, range: null };
  const reviewWithoutHash = {
    authority: 'review_cut_attempt' as const,
    id: 'review.attempt.1',
    projectId: project.id,
    runId: run.id,
    manifest: manifestRef,
    request: reviewRequest,
    revision: 0,
    contentHash: '',
    state: 'running' as const,
    requestHash: hashCanonical(reviewRequest),
    idempotencyKey: hashCanonical({ idempotency: 'review.attempt.1' }),
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: 5,
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
    id: 'delivery.export.1',
    projectId: project.id,
    runId: run.id,
    manifest: manifestRef,
    destination: {
      kind: 'user_selected_file' as const,
      grantId: 'grant.1',
      grantHash: HASH_B,
      displayLabel: 'review.mp4',
    },
    overwriteExisting: false,
    revision: 0,
    contentHash: '',
    state: 'prepared' as const,
    requestHash: hashCanonical({ owner: 'delivery.export.1' }),
    idempotencyKey: hashCanonical({ idempotency: 'delivery.export.1' }),
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

  withImmediateTransaction(database, () => {
    database
      .prepare(
        `INSERT INTO media_blobs (
           hash, byte_length, mime_type, media_kind, technical_facts_v1_json, created_at
         ) VALUES (?, 100, 'image/png', 'image', ?, ?)`,
      )
      .run(HASH_B, canonicalJson({ kind: 'image', width: 1920, height: 1080 }), NOW);
    database
      .prepare(
        `INSERT INTO generation_requests (
           id, project_id, run_id, target_authority, target_id, target_revision,
           target_hash, spec_v1_json, request_hash, idempotency_key, created_at
         ) VALUES (?, ?, ?, 'production', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        request.projectId,
        request.runId,
        request.spec.target.id,
        request.spec.target.revision,
        request.spec.target.contentHash,
        canonicalJson(request.spec),
        request.requestHash,
        request.idempotencyKey,
        request.createdAt,
      );
    database
      .prepare(
        `INSERT INTO generation_attempts (
           id, request_id, attempt_number, revision, content_hash, state,
           provider_profile_id, provider_v1_json, quote_v1_json, provider_operation_id,
           receipt_v1_json, usage_v1_json, prompt_provenance_v1_json, cancel_requested,
           progress_percent, public_error_code, created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, 0, NULL, NULL, ?, NULL)`,
      )
      .run(
        generation.id,
        generation.requestId,
        generation.attemptNumber,
        generation.revision,
        generation.contentHash,
        generation.state,
        generation.provider.providerId,
        canonicalJson(generation.provider),
        canonicalJson(generation.promptProvenance),
        generation.createdAt,
      );
    database
      .prepare(
        `INSERT INTO media_derivations (
           id, project_id, run_id, source_blob_hash, transform_v1_json,
           request_hash, idempotency_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        derivation.id,
        derivation.projectId,
        derivation.runId,
        derivation.sourceBlobHash,
        canonicalJson(derivation.transform),
        derivation.requestHash,
        derivation.idempotencyKey,
        derivation.createdAt,
      );
    database
      .prepare(
        `INSERT INTO media_derivation_attempts (
           id, derivation_id, attempt_number, revision, content_hash, state,
           provider_profile_id, provider_v1_json, provider_operation_id, receipt_v1_json,
           usage_v1_json, cancel_requested, progress_percent, public_error_code,
           created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, 0, ?, NULL, ?, NULL)`,
      )
      .run(
        media.id,
        derivation.id,
        media.attemptNumber,
        media.revision,
        media.contentHash,
        media.state,
        media.progressPercent,
        media.createdAt,
      );
    database
      .prepare(
        `INSERT INTO result_assessment_attempts (
           id, project_id, run_id, revision, content_hash, assessment_kind,
           request_v1_json, state, provider_profile_id, provider_v1_json,
           provider_operation_id, receipt_v1_json, usage_v1_json, request_hash,
           idempotency_key, cancel_requested, progress_percent, public_error_code,
           created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, 0, NULL, NULL, ?, NULL)`,
      )
      .run(
        assessment.id,
        assessment.projectId,
        assessment.runId,
        assessment.revision,
        assessment.contentHash,
        assessment.request.kind,
        canonicalJson(assessment.request),
        assessment.state,
        assessment.requestHash,
        assessment.idempotencyKey,
        assessment.createdAt,
      );
    database
      .prepare(
        `INSERT INTO result_assessment_subjects (
           attempt_id, role, ordinal, authority, object_id, revision, content_hash
         ) VALUES (?, 'subject', 0, ?, ?, ?, ?)`,
      )
      .run(
        assessment.id,
        evaluationRequest.subjects[0]!.authority,
        evaluationRequest.subjects[0]!.id,
        evaluationRequest.subjects[0]!.revision,
        evaluationRequest.subjects[0]!.contentHash,
      );
    const deliveryFormatJson = canonicalJson(deliveryFormat);
    database
      .prepare(
        `INSERT INTO delivery_plans (
           id, project_id, revision, content_hash, name, lifecycle,
           format_intent_v1_json, created_at, updated_at
         ) VALUES ('delivery.1', ?, 0, ?, 'Cut', 'active', ?, ?, ?)`,
      )
      .run(project.id, deliveryHash, deliveryFormatJson, NOW, NOW);
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
        `INSERT INTO review_cut_attempts (
           id, project_id, run_id, delivery_manifest_id, delivery_manifest_revision,
           delivery_manifest_hash, revision, content_hash, state, request_v1_json,
           request_hash, idempotency_key, cancel_requested, progress_percent,
           public_error_code, output_blob_hash, created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, ?, NULL)`,
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
        review.progressPercent,
        review.createdAt,
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
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL,
                   NULL, ?, NULL)`,
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
        deliveryExport.createdAt,
      );
  });
  return { generation, media, assessment, review, deliveryExport };
}

function registerOwners(
  fixture: Fixture,
  owners: ReturnType<typeof seedOwnerRows>,
): BoundOperationRecord[] {
  const deliveryHash = hashCanonical({ delivery: 'delivery.1' });
  const registrations = [
    {
      toolId: 'generation.submit' as const,
      input: {
        spec: owners.generation.request.spec,
        quote: null,
        expectedProjectRevision: fixture.project.revision,
        promptProvenance: owners.generation.promptProvenance,
        outputIntents: [
          {
            variantIndex: 0,
            globalAsset: {
              filename: 'generated-operation.png',
              displayName: 'Generated operation',
              folderId: null,
              tags: ['generated'],
            },
            projectMediaRef: {
              label: 'Generated operation',
              collections: [],
              roles: ['generated_candidate' as const],
              notes: '',
            },
          },
        ],
      },
      operationKind: 'generation_attempt' as const,
      ownerAuthority: 'generation_attempt' as const,
      ownerId: owners.generation.id,
    },
    {
      toolId: 'media.derive' as const,
      input: {
        operation: 'resize' as const,
        source: { kind: 'global_asset' as const, id: 'asset.source' },
        expectedSourceHash: HASH_B,
        attach: { enabled: false, expectedProjectRevision: null },
        outputIntents: [
          {
            ordinal: 0,
            globalAsset: {
              filename: 'derived-operation.png',
              displayName: 'Derived operation',
              folderId: null,
              tags: ['derived'],
            },
            projectMediaRef: null,
          },
        ],
        width: 1280,
        height: 720,
        fit: 'contain' as const,
      },
      operationKind: 'media_derivation' as const,
      ownerAuthority: 'media_derivation_attempt' as const,
      ownerId: owners.media.id,
    },
    {
      toolId: 'evaluation.run' as const,
      input: owners.assessment.request,
      operationKind: 'result_assessment' as const,
      ownerAuthority: 'result_assessment_attempt' as const,
      ownerId: owners.assessment.id,
    },
    {
      toolId: 'delivery.preview' as const,
      input: {
        plan: {
          authority: 'delivery' as const,
          id: 'delivery.1',
          revision: 0,
          contentHash: deliveryHash,
        },
        range: null,
      },
      operationKind: 'review_cut_attempt' as const,
      ownerAuthority: 'review_cut_attempt' as const,
      ownerId: owners.review.id,
    },
    {
      toolId: 'delivery.export' as const,
      input: {
        manifest: owners.deliveryExport.manifest,
        destination: owners.deliveryExport.destination,
        overwriteExisting: owners.deliveryExport.overwriteExisting,
      },
      operationKind: 'delivery_export' as const,
      ownerAuthority: 'delivery_export' as const,
      ownerId: owners.deliveryExport.id,
    },
  ];
  return registrations.map((registration, index) => {
    const key = resolveOperationDispatchKey(fixture.database, {
      runId: fixture.run.id,
      toolId: registration.toolId,
      toolVersion: '1.0.0',
      input: registration.input,
    });
    return withImmediateTransaction(fixture.database, () =>
      registerOperationDispatch(
        fixture.database,
        fixture.environment,
        {
          key,
          operationKind: registration.operationKind,
          ownerAuthority: registration.ownerAuthority,
          ownerId: registration.ownerId,
          confirmationId: null,
          projectEventId: null,
          commandId: `command.operation.register.${index}`,
          occurredAt: NOW,
        },
        fixture.context,
      ),
    );
  });
}

function operationRefs(operations: readonly BoundOperationRecord[]): OperationRef[] {
  return operations.map(({ dispatch, owner }) => operationRefForOwner(dispatch.id, owner));
}

function getRequest(operations: readonly OperationRef[], requestId = 'request.operation.get') {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'operation.get' as const,
    input: { operations },
  };
}

function cancelRequest(
  operations: readonly BoundOperationRecord[],
  requestId = 'request.operation.cancel',
) {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'operation.cancel' as const,
    input: {
      operations: operations.map(({ dispatch, owner }) => ({
        ref: operationRefForOwner(dispatch.id, owner),
        expectedRevision: owner.view.revision,
        expectedState: owner.view.state,
      })),
    },
  };
}

function registerSecondRunReview(
  fixture: Fixture,
  manifest: ReturnType<typeof seedOwnerRows>['review']['manifest'],
): BoundOperationRecord {
  const chat = fixture.data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.operations.second',
      method: 'chat.create',
      input: { projectId: fixture.project.id, title: 'Second' },
    },
    userContext,
  ).result;
  const run = fixture.data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.operations.second',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Create another review.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: { providerId: 'provider.1', model: 'video-model', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const request = { manifest, range: null };
  const withoutHash = {
    authority: 'review_cut_attempt' as const,
    id: 'review.attempt.second',
    projectId: fixture.project.id,
    runId: run.id,
    manifest,
    request,
    revision: 0,
    contentHash: '',
    state: 'running' as const,
    requestHash: hashCanonical(request),
    idempotencyKey: hashCanonical({ idempotency: 'review.attempt.second' }),
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: null,
    publicErrorCode: null,
    outputBlobHash: null,
    createdAt: NOW,
    finishedAt: null,
  };
  const review = parseCanonical(ReviewCutAttemptSchema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
  fixture.database
    .prepare(
      `INSERT INTO review_cut_attempts (
         id, project_id, run_id, delivery_manifest_id, delivery_manifest_revision,
         delivery_manifest_hash, revision, content_hash, state, request_v1_json,
         request_hash, idempotency_key, cancel_requested, progress_percent,
         public_error_code, output_blob_hash, created_at, finished_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'running', ?, ?, ?, 0, NULL, NULL, NULL, ?, NULL)`,
    )
    .run(
      review.id,
      review.projectId,
      review.runId,
      review.manifest.id,
      review.manifest.revision,
      review.manifest.contentHash,
      review.contentHash,
      canonicalJson(review.request),
      review.requestHash,
      review.idempotencyKey,
      review.createdAt,
    );
  const deliveryHash = hashCanonical({ delivery: 'delivery.1' });
  const key = resolveOperationDispatchKey(fixture.database, {
    runId: run.id,
    toolId: 'delivery.preview',
    toolVersion: '1.0.0',
    input: {
      plan: {
        authority: 'delivery',
        id: 'delivery.1',
        revision: 0,
        contentHash: deliveryHash,
      },
      range: null,
    },
  });
  return withImmediateTransaction(fixture.database, () =>
    registerOperationDispatch(
      fixture.database,
      fixture.environment,
      {
        key,
        operationKind: 'review_cut_attempt',
        ownerAuthority: 'review_cut_attempt',
        ownerId: review.id,
        confirmationId: null,
        projectEventId: null,
        commandId: 'command.operation.register.second',
        occurredAt: NOW,
      },
      {
        actor: 'commander',
        causation: { kind: 'run', runId: run.id },
        correlationId: 'correlation.operations.second',
      },
    ),
  );
}

describe('Operations authority', () => {
  it('binds one precreated allowed dispatch to its exact typed owner without creating a second row', async () => {
    const fixture = await baseHarness();
    try {
      const owners = seedOwnerRows(fixture);
      const key = resolveOperationDispatchKey(fixture.database, {
        runId: fixture.run.id,
        toolId: 'generation.submit',
        toolVersion: '1.0.0',
        input: {
          spec: owners.generation.request.spec,
          quote: null,
          expectedProjectRevision: fixture.project.revision,
          promptProvenance: owners.generation.promptProvenance,
          outputIntents: [
            {
              variantIndex: 0,
              globalAsset: {
                filename: 'generated-operation.png',
                displayName: 'Generated operation',
                folderId: null,
                tags: ['generated'],
              },
              projectMediaRef: {
                label: 'Generated operation',
                collections: [],
                roles: ['generated_candidate'],
                notes: '',
              },
            },
          ],
        },
      });
      fixture.database
        .prepare(
          `INSERT INTO dispatch_operations (
             id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
             input_hash, input_v1_json, confirmation_id, operation_kind,
             owner_authority, owner_id, project_event_id, created_at, updated_at
           ) VALUES ('dispatch.prepared.1', ?, ?, ?, 'allowed', ?, ?, ?,
             NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          key.runId,
          key.toolId,
          key.toolVersion,
          key.fingerprint,
          key.inputHash,
          key.inputJson,
          NOW,
          NOW,
        );

      const bound = withImmediateTransaction(fixture.database, () =>
        registerOperationDispatch(
          fixture.database,
          fixture.environment,
          {
            key,
            operationKind: 'generation_attempt',
            ownerAuthority: 'generation_attempt',
            ownerId: owners.generation.id,
            confirmationId: null,
            projectEventId: null,
            commandId: 'command.operation.bind-prepared',
            occurredAt: NOW,
          },
          fixture.context,
        ),
      );
      expect(bound.dispatch).toMatchObject({
        id: 'dispatch.prepared.1',
        operationKind: 'generation_attempt',
        ownerAuthority: 'generation_attempt',
        ownerId: owners.generation.id,
      });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM dispatch_operations').get(),
      ).toEqual({ count: 1 });
      expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get()).toEqual({
        count: 1,
      });

      const replay = withImmediateTransaction(fixture.database, () =>
        registerOperationDispatch(
          fixture.database,
          fixture.environment,
          {
            key,
            operationKind: 'generation_attempt',
            ownerAuthority: 'generation_attempt',
            ownerId: owners.generation.id,
            confirmationId: null,
            projectEventId: null,
            commandId: 'command.operation.bind-prepared.replay',
            occurredAt: NOW,
          },
          fixture.context,
        ),
      );
      expect(replay).toEqual(bound);
      expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get()).toEqual({
        count: 1,
      });
    } finally {
      fixture.store.close();
    }
  });

  it('loads all five owner types and lets an old ref poll the current owner revision', async () => {
    const fixture = await baseHarness();
    try {
      const operations = registerOwners(fixture, seedOwnerRows(fixture));
      const refs = operationRefs(operations);
      const initialEvents = fixture.data.runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.operation.initial-events',
        method: 'run.events.list',
        input: { runId: fixture.run.id, afterSequence: null, page: { cursor: null, limit: 20 } },
      }).result.items;
      expect(initialEvents).toHaveLength(5);
      expect(
        initialEvents.every(
          ({ payloadState }) =>
            payloadState.state === 'available' &&
            payloadState.payload.type === 'operation_state_changed' &&
            payloadState.payload.previousRevision === null,
        ),
      ).toBe(true);
      const beforeReplayCount = (
        fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get() as {
          count: number;
        }
      ).count;
      const replay = withImmediateTransaction(fixture.database, () =>
        registerOperationDispatch(
          fixture.database,
          fixture.environment,
          {
            key: operations[0]!.dispatch.key,
            operationKind: operations[0]!.dispatch.operationKind,
            ownerAuthority: operations[0]!.dispatch.ownerAuthority,
            ownerId: operations[0]!.dispatch.ownerId,
            confirmationId: null,
            projectEventId: null,
            commandId: 'command.operation.replay',
            occurredAt: NOW,
          },
          fixture.context,
        ),
      );
      expect(replay).toEqual(operations[0]);
      expect(
        (
          fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get() as {
            count: number;
          }
        ).count,
      ).toBe(beforeReplayCount);
      expect(fixture.data.operations.get(getRequest(refs)).result.operations).toMatchObject(
        refs.map((ref) => ({ ref, cancelRequested: false, resultRefs: [], artifacts: [] })),
      );
      expect(
        fixture.data.operations.query(fixture.project.id, fixture.run.id, { operations: refs }),
      ).toMatchObject({
        operations: refs.map((ref) => ({
          ref,
          cancelRequested: false,
          resultRefs: [],
          artifacts: [],
        })),
      });
      expect(() =>
        fixture.data.operations.query('project.other', fixture.run.id, { operations: refs }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.operations.query(fixture.project.id, 'run.other', { operations: refs }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const cancelled = fixture.data.operations.cancel(
        cancelRequest([operations[0]!], 'request.operation.cancel.one'),
        fixture.context,
      );
      expect(cancelled.result.operations[0]).toMatchObject({
        ref: { id: refs[0]!.id, revision: 1, ownerRef: { revision: 1 } },
        state: operations[0]!.owner.view.state,
        cancelRequested: true,
      });
      expect(
        fixture.data.operations.get(getRequest([refs[0]!], 'request.operation.poll.old')).result
          .operations[0],
      ).toEqual(cancelled.result.operations[0]);
      expect(() =>
        fixture.data.operations.cancel(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.operation.cancel.already-requested',
            method: 'operation.cancel',
            input: {
              operations: [
                {
                  ref: cancelled.result.operations[0]!.ref,
                  expectedRevision: cancelled.result.operations[0]!.ref.revision,
                  expectedState: cancelled.result.operations[0]!.state,
                },
              ],
            },
          },
          fixture.context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.operations.cancel(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.operation.cancel.terminal',
            method: 'operation.cancel',
            input: {
              operations: [
                {
                  ref: cancelled.result.operations[0]!.ref,
                  expectedRevision: cancelled.result.operations[0]!.ref.revision,
                  expectedState: 'succeeded',
                },
              ],
            },
          },
          fixture.context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  }, 30_000);

  it('cancels a batch atomically, advances the Run once, and replays without new writes', async () => {
    const fixture = await baseHarness();
    try {
      const operations = registerOwners(fixture, seedOwnerRows(fixture));
      const beforeRun = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.run.before-cancel',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      const request = cancelRequest(operations);
      const first = fixture.data.operations.cancel(request, fixture.context);
      expect(first.result.operations).toHaveLength(5);
      expect(
        first.result.operations.every(
          ({ cancelRequested, ref }) => cancelRequested && ref.revision === 1,
        ),
      ).toBe(true);
      const afterRun = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.run.after-cancel',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      expect(afterRun.revision).toBe(beforeRun.revision + 1);
      const counts = () => ({
        events: (
          fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get() as {
            count: number;
          }
        ).count,
        receipts: (
          fixture.database.prepare('SELECT COUNT(*) AS count FROM wire_command_receipts').get() as {
            count: number;
          }
        ).count,
      });
      const committed = counts();
      expect(fixture.data.operations.cancel(request, fixture.context)).toEqual(first);
      expect(counts()).toEqual(committed);
      expect(() =>
        fixture.data.operations.cancel(
          { ...request, input: { operations: request.input.operations.slice(0, 1) } },
          fixture.context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    } finally {
      fixture.store.close();
    }
  }, 30_000);

  it('pages only nonterminal cancellation intents across owner tables within an exact Run scope', async () => {
    const fixture = await baseHarness();
    try {
      const owners = seedOwnerRows(fixture);
      const operations = registerOwners(fixture, owners);
      const second = registerSecondRunReview(fixture, owners.review.manifest);
      fixture.data.operations.cancel(
        cancelRequest(operations, 'request.operation.cancellation-queue.first'),
        fixture.context,
      );
      fixture.data.operations.cancel(
        cancelRequest([second], 'request.operation.cancellation-queue.second'),
        {
          actor: 'commander',
          causation: { kind: 'run', runId: second.dispatch.key.runId },
          correlationId: 'correlation.operations.cancellation-queue.second',
        },
      );

      const all = fixture.data.operations.listCancellationRequested({
        afterOperationId: null,
        limit: 10,
        runIds: null,
      });
      expect(all.operations).toHaveLength(6);
      expect(new Set(all.operations.map(({ operation }) => operation.kind))).toEqual(
        new Set([
          'generation_attempt',
          'media_derivation',
          'result_assessment',
          'review_cut_attempt',
          'delivery_export',
        ]),
      );
      expect(all.operations.map(({ operation }) => operation.id)).toContain(second.dispatch.id);

      fixture.database
        .prepare(
          `UPDATE generation_attempts
           SET state = 'cancelled', public_error_code = 'cancelled', finished_at = ?
           WHERE id = ?`,
        )
        .run(NOW, owners.generation.id);

      const ids: string[] = [];
      let afterOperationId: string | null = null;
      do {
        const page = fixture.data.operations.listCancellationRequested({
          afterOperationId,
          limit: 2,
          runIds: [fixture.run.id],
        });
        ids.push(...page.operations.map(({ operation }) => operation.id));
        afterOperationId = page.nextAfterOperationId;
      } while (afterOperationId !== null);

      expect(ids).toEqual(
        operations
          .slice(1)
          .map(({ dispatch }) => dispatch.id)
          .sort(),
      );
      expect(ids).not.toContain(operations[0]!.dispatch.id);
      expect(ids).not.toContain(second.dispatch.id);
    } finally {
      fixture.store.close();
    }
  }, 30_000);

  it('rolls back every owner, event, Run head, and receipt when journaling fails', async () => {
    const fixture = await baseHarness();
    try {
      const operations = registerOwners(fixture, seedOwnerRows(fixture));
      const refs = operationRefs(operations);
      const before = fixture.data.operations.get(
        getRequest(refs, 'request.operation.before-rollback'),
      ).result;
      const runBefore = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.run.rollback.before',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      fixture.database.exec(
        `CREATE TRIGGER fail_operation_event
         BEFORE INSERT ON run_event_payloads
         BEGIN SELECT RAISE(ABORT, 'injected operation journal failure'); END`,
      );
      expect(() =>
        fixture.data.operations.cancel(
          cancelRequest(operations, 'request.operation.cancel.rollback'),
          fixture.context,
        ),
      ).toThrow('injected operation journal failure');
      fixture.database.exec('DROP TRIGGER fail_operation_event');
      expect(
        fixture.data.operations.get(getRequest(refs, 'request.operation.after-rollback')).result,
      ).toEqual(before);
      expect(
        fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.run.rollback.after',
          method: 'run.get',
          input: { runId: fixture.run.id },
        }).result,
      ).toEqual(runBefore);
      expect(
        fixture.database
          .prepare('SELECT 1 FROM wire_command_receipts WHERE request_id = ?')
          .get('request.operation.cancel.rollback'),
      ).toBeUndefined();
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('rejects stale cancellation and fails closed on owner corruption', async () => {
    const fixture = await baseHarness();
    try {
      const operations = registerOwners(fixture, seedOwnerRows(fixture));
      const ref = operationRefs(operations)[0]!;
      const staleRef = {
        ...ref,
        revision: 1,
        ownerRef: { ...ref.ownerRef, revision: 1 },
      } as OperationRef;
      expect(() =>
        fixture.data.operations.cancel(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.operation.cancel.stale',
            method: 'operation.cancel',
            input: {
              operations: [
                {
                  ref: staleRef,
                  expectedRevision: 1,
                  expectedState: operations[0]!.owner.view.state,
                },
              ],
            },
          },
          fixture.context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      fixture.database
        .prepare('UPDATE delivery_manifests SET format_intent_v1_json = ? WHERE id = ?')
        .run(
          canonicalJson({
            container: 'mp4',
            videoCodec: 'h264',
            audioCodec: 'aac',
            width: 1280,
            height: 720,
            frameRate: 24,
          }),
          'delivery.manifest.1',
        );
      expect(() =>
        fixture.data.operations.get(
          getRequest([operationRefs(operations)[4]!], 'request.operation.corrupt-manifest'),
        ),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      fixture.database
        .prepare('UPDATE generation_attempts SET content_hash = ? WHERE id = ?')
        .run('f'.repeat(64), operations[0]!.owner.view.id);
      expect(() =>
        fixture.data.operations.get(getRequest([ref], 'request.operation.corrupt-owner')),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('preserves unknown provider state and provider_state_unknown when recording cancel intent', async () => {
    const fixture = await baseHarness();
    try {
      const operations = registerOwners(fixture, seedOwnerRows(fixture));
      const generation = operations[0]!;
      if (generation.owner.view.authority !== 'generation_attempt') throw new Error('fixture');
      const receipt = {
        providerOperationId: 'provider-operation.unknown',
        submittedAt: NOW,
        reconciledAt: null,
        receiptHash: hashCanonical({
          providerOperationId: 'provider-operation.unknown',
          submittedAt: NOW,
        }),
      };
      const unknownWithoutHash = {
        ...generation.owner.view,
        contentHash: '',
        state: 'unknown' as const,
        receipt,
        publicErrorCode: 'provider_state_unknown' as const,
      };
      const unknown = parseCanonical(GenerationAttemptViewSchema, {
        ...unknownWithoutHash,
        contentHash: hashContentObject(unknownWithoutHash),
      });
      fixture.database
        .prepare(
          `UPDATE generation_attempts
           SET state = 'unknown', content_hash = ?, provider_operation_id = ?,
               receipt_v1_json = ?, public_error_code = 'provider_state_unknown'
           WHERE id = ?`,
        )
        .run(unknown.contentHash, receipt.providerOperationId, canonicalJson(receipt), unknown.id);
      const current = fixture.data.operations.get(
        getRequest(
          [operationRefForOwner(generation.dispatch.id, generation.owner)],
          'request.unknown.get',
        ),
      ).result.operations[0]!;
      expect(current).toMatchObject({
        state: 'unknown',
        publicErrorCode: 'provider_state_unknown',
      });
      const cancelled = fixture.data.operations.cancel(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.unknown.cancel',
          method: 'operation.cancel',
          input: {
            operations: [
              {
                ref: current.ref,
                expectedRevision: current.ref.revision,
                expectedState: 'unknown',
              },
            ],
          },
        },
        fixture.context,
      ).result.operations[0]!;
      expect(cancelled).toMatchObject({
        state: 'unknown',
        cancelRequested: true,
        publicErrorCode: 'provider_state_unknown',
      });
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('fails closed on dispatch fingerprint, owner mapping, and confirmation corruption', async () => {
    const fixture = await baseHarness();
    try {
      const operations = registerOwners(fixture, seedOwnerRows(fixture));
      const operation = operations[0]!;
      const ref = operationRefForOwner(operation.dispatch.id, operation.owner);
      fixture.database
        .prepare('UPDATE dispatch_operations SET input_hash = ? WHERE id = ?')
        .run('f'.repeat(64), operation.dispatch.id);
      expect(() =>
        fixture.data.operations.get(getRequest([ref], 'request.corrupt-fingerprint')),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      fixture.database
        .prepare('UPDATE dispatch_operations SET input_hash = ?, owner_id = ? WHERE id = ?')
        .run(operation.dispatch.key.inputHash, 'generation.attempt.missing', operation.dispatch.id);
      expect(() =>
        fixture.data.operations.get(getRequest([ref], 'request.corrupt-owner-map')),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
      fixture.database
        .prepare('UPDATE dispatch_operations SET owner_id = ? WHERE id = ?')
        .run(operation.dispatch.ownerId, operation.dispatch.id);
      const objective = fixture.run.acceptedSource;
      if (objective.kind !== 'message') throw new Error('fixture');
      fixture.database
        .prepare(
          `INSERT INTO run_interactions (
             id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
             allow_free_text, state, answer_message_id, created_at, resolved_at
           ) VALUES ('interaction.confirm.1', ?, 'confirmation', 'Proceed?', '[]', '[]',
             0, 'answered', ?, ?, ?)`,
        )
        .run(fixture.run.id, objective.messageId, NOW, NOW);
      fixture.database
        .prepare(
          `INSERT INTO run_confirmations (
             id, run_id, interaction_id, target_v1_json, immutable_input_hash,
             decision, decided_by_message_id, requested_at, decided_at
           ) VALUES ('confirmation.1', ?, 'interaction.confirm.1', ?, ?,
             'approved', ?, ?, ?)`,
        )
        .run(
          fixture.run.id,
          canonicalJson({
            authority: 'project',
            id: fixture.project.id,
            revision: fixture.project.revision,
            contentHash: fixture.project.contentHash,
          }),
          'e'.repeat(64),
          objective.messageId,
          NOW,
          NOW,
        );
      fixture.database
        .prepare('UPDATE dispatch_operations SET confirmation_id = ? WHERE id = ?')
        .run('confirmation.1', operation.dispatch.id);
      expect(() =>
        fixture.data.operations.get(getRequest([ref], 'request.corrupt-confirmation')),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('fails closed when persisted Capability Catalog content is tampered without changing its hash', async () => {
    const fixture = await baseHarness();
    try {
      const operation = registerOwners(fixture, seedOwnerRows(fixture))[0]!;
      const ref = operationRefForOwner(operation.dispatch.id, operation.owner);
      const row = fixture.database
        .prepare('SELECT catalog_v1_json FROM capability_catalog_snapshots WHERE run_id = ?')
        .get(fixture.run.id) as { catalog_v1_json: string };
      const catalog = JSON.parse(row.catalog_v1_json) as {
        tools: Array<{ inputSchema: { canonicalJson: string } }>;
      };
      catalog.tools[0]!.inputSchema.canonicalJson = canonicalJson({ tampered: true });
      fixture.database
        .prepare('UPDATE capability_catalog_snapshots SET catalog_v1_json = ? WHERE run_id = ?')
        .run(canonicalJson(catalog), fixture.run.id);

      expect(() =>
        fixture.data.operations.get(getRequest([ref], 'request.corrupt-capability-catalog')),
      ).toThrowError(expect.objectContaining({ code: 'CORRUPT_DATA' }));
    } finally {
      fixture.store.close();
    }
  }, 15_000);

  it('rejects mixed-Run get and cancel batches before changing either owner', async () => {
    const fixture = await baseHarness();
    try {
      const owners = seedOwnerRows(fixture);
      const operations = registerOwners(fixture, owners);
      const second = registerSecondRunReview(fixture, owners.review.manifest);
      const mixed = [operations[0]!, second];
      expect(() =>
        fixture.data.operations.get(
          getRequest(operationRefs(mixed), 'request.operation.mixed-run.get'),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.operations.cancel(
          cancelRequest(mixed, 'request.operation.mixed-run.cancel'),
          fixture.context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const rows = fixture.database
        .prepare(
          `SELECT id, revision, cancel_requested
           FROM generation_attempts WHERE id = ?
           UNION ALL
           SELECT id, revision, cancel_requested
           FROM review_cut_attempts WHERE id = ?`,
        )
        .all(operations[0]!.owner.view.id, second.owner.view.id);
      expect(rows).toEqual([
        { id: operations[0]!.owner.view.id, revision: 0, cancel_requested: 0 },
        { id: second.owner.view.id, revision: 0, cancel_requested: 0 },
      ]);
    } finally {
      fixture.store.close();
    }
  }, 15_000);
});
