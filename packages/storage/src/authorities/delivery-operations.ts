import {
  DeliveryDestinationIntentSchema,
  DeliveryExportConfirmationTargetSchema,
  DeliveryExportDefinition,
  DeliveryExportOperationRefSchema,
  DeliveryExportSchema,
  DeliveryManifestRefSchema,
  DeliveryPreviewRequestSchema,
  EntityIdSchema,
  MediaBlobSchema,
  ReviewCutAttemptSchema,
  ReviewCutOperationRefSchema,
  ReviewCutRequestSchema,
  RevisionSchema,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
  type ArtifactRef,
  type AttemptState,
  type DeliveryManifest,
  type OperationPublicErrorCode,
  type Run,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { DeliveryAuthority } from './delivery.js';
import { CommandContextSchema, type CommandContext } from '../internal/command.js';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { insertOrValidateMediaBlob, loadMediaBlob } from '../internal/media-records.js';
import {
  assertOperationRefIdentity,
  findOperationByFingerprint,
  loadApprovedRunConfirmation,
  loadBoundOperation,
  recordOperationOwnerTransitions,
  registerOperationDispatch,
  resolveOperationDispatchKey,
  type BoundOperationRecord,
  type OperationDispatchKey,
} from '../internal/operation-dispatch.js';
import {
  claimLocalDeliveryOwner,
  loadDeliveryManifest,
  operationPublicViewForOwner,
  transitionLocalDeliveryOwner,
} from '../internal/operation-owner-records.js';
import { loadRun } from '../internal/run-records.js';
import { upsertProjectSearchDocument } from '../internal/search-projection.js';
import { StorageError } from '../kernel/errors.js';
import type {
  DeliveryDestinationGrantResolver,
  LocalDeliveryExportCancelResult,
  LocalDeliveryExporterAdapter,
} from '../kernel/local-delivery-exporter.js';
import type {
  LocalRenderedDeliveryBlob,
  LocalReviewRenderCancelResult,
  LocalReviewRendererAdapter,
} from '../kernel/local-review-renderer.js';
import type { MediaCas } from '../kernel/media-cas.js';
import type { Store } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

const ExportRequestSchema = strictObject({
  manifest: DeliveryManifestRefSchema,
  destination: DeliveryDestinationIntentSchema,
  overwriteExisting: z.boolean(),
});
type PreviewRequest = z.output<typeof DeliveryPreviewRequestSchema>;
type ExportRequest = z.output<typeof ExportRequestSchema>;
type ReviewOperationRef = z.output<typeof ReviewCutOperationRefSchema>;
type ExportOperationRef = z.output<typeof DeliveryExportOperationRefSchema>;
type LocalOperationRef = ReviewOperationRef | ExportOperationRef;
type LocalOwner = z.output<typeof ReviewCutAttemptSchema> | z.output<typeof DeliveryExportSchema>;
type ReviewOwner = z.output<typeof ReviewCutAttemptSchema>;
type ExportOwner = z.output<typeof DeliveryExportSchema>;
type ReviewBoundOperation = Omit<BoundOperationRecord, 'owner'> & {
  readonly owner: {
    readonly authority: 'review_cut_attempt';
    readonly projectId: string;
    readonly runId: string;
    readonly view: ReviewOwner;
  };
};
type ExportBoundOperation = Omit<BoundOperationRecord, 'owner'> & {
  readonly owner: {
    readonly authority: 'delivery_export';
    readonly projectId: string;
    readonly runId: string;
    readonly view: ExportOwner;
  };
};
type LocalBoundOperation = ReviewBoundOperation | ExportBoundOperation;

export interface DeliveryExportConfirmationInput {
  readonly manifest: z.output<typeof DeliveryManifestRefSchema>;
  readonly destination: {
    readonly kind: 'user_selected_file' | 'user_selected_folder';
    readonly displayLabel: string;
  };
  readonly overwriteExisting: boolean;
}

export function deliveryExportConfirmationTargetFor(
  manifest: DeliveryManifest,
  request: DeliveryExportConfirmationInput,
): z.output<typeof DeliveryExportConfirmationTargetSchema> {
  return parseCanonical(DeliveryExportConfirmationTargetSchema, {
    kind: 'delivery_export',
    manifest: request.manifest,
    formatIntent: manifest.formatIntent,
    itemCount: manifest.items.length,
    destination: {
      kind: request.destination.kind,
      displayLabel: request.destination.displayLabel,
    },
    overwriteExisting: request.overwriteExisting,
    cost: { state: 'known', value: '0', currency: 'USD' },
  });
}

export interface StartReviewCutInput {
  readonly runId: string;
  readonly commandId: string;
  readonly request: PreviewRequest;
  readonly dispatchOperationId?: string;
}

export interface StartDeliveryExportInput {
  readonly runId: string;
  readonly commandId: string;
  readonly confirmationId: string;
  readonly request: ExportRequest;
  readonly dispatchOperationId?: string;
}

export interface AcknowledgeLocalDeliveryCancellationInput {
  readonly operation: LocalOperationRef;
  readonly expectedRevision: number;
  readonly commandId: string;
}

export interface ReviewCutSuccess {
  readonly operation: ReviewOperationRef;
  readonly attemptId: string;
  readonly state: AttemptState;
  readonly artifact: ArtifactRef | null;
  readonly warnings: readonly string[];
  readonly usage: {
    readonly state: 'known';
    readonly value: '0';
    readonly currency: 'USD';
  };
}

export interface DeliveryExportSuccess {
  readonly operation: ExportOperationRef;
  readonly exportId: string;
  readonly state: AttemptState;
  readonly destinationLabel: string;
  readonly contentHash: string | null;
  readonly artifact: ArtifactRef | null;
  readonly cost: {
    readonly state: 'known';
    readonly value: '0';
    readonly currency: 'USD';
  };
}

export interface DeliveryOperationsAuthority {
  readonly preview: (
    input: StartReviewCutInput,
    context: CommandContext,
    signal?: AbortSignal,
  ) => Promise<ReviewCutSuccess>;
  readonly export: (
    input: StartDeliveryExportInput,
    context: CommandContext,
    signal?: AbortSignal,
  ) => Promise<DeliveryExportSuccess>;
  readonly acknowledgeCancellation: (
    input: AcknowledgeLocalDeliveryCancellationInput,
    context: CommandContext,
    signal?: AbortSignal,
  ) => Promise<ReviewCutSuccess | DeliveryExportSuccess>;
}

interface ParsedBlob {
  readonly descriptor: {
    readonly hash: string;
    readonly byteLength: number;
    readonly mimeType: string;
    readonly technicalFacts: LocalRenderedDeliveryBlob['technicalFacts'];
  };
  readonly bytes: AsyncIterable<Uint8Array>;
}

function invalid(message: string): StorageError {
  return new StorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

function internalCommandId(commandId: string, fingerprint: string, phase: string): string {
  return hashCanonical({
    commandId: parseCanonical(EntityIdSchema, commandId),
    fingerprint,
    phase,
  });
}

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) {
    throw invalid(`${label} has unexpected fields`);
  }
}

function isAsyncBytes(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

function parseBlob(value: unknown, now: string): ParsedBlob {
  const raw = exactObject(value, 'Local Delivery output blob');
  exactKeys(
    raw,
    ['hash', 'byteLength', 'mimeType', 'technicalFacts', 'bytes'],
    'Local Delivery output blob',
  );
  if (!isAsyncBytes(raw.bytes)) throw invalid('Local Delivery output bytes are invalid');
  let blob: z.output<typeof MediaBlobSchema>;
  try {
    blob = parseCanonical(MediaBlobSchema, {
      authority: 'media_blob',
      hash: raw.hash,
      byteLength: raw.byteLength,
      mimeType: raw.mimeType,
      technicalFacts: raw.technicalFacts,
      createdAt: now,
    });
  } catch {
    throw invalid('Local Delivery output descriptor is invalid');
  }
  if (blob.technicalFacts.kind !== 'video') {
    throw invalid('Local Delivery output must be video');
  }
  return {
    descriptor: {
      hash: blob.hash,
      byteLength: blob.byteLength,
      mimeType: blob.mimeType,
      technicalFacts: blob.technicalFacts,
    },
    bytes: raw.bytes,
  };
}

function parseReviewOutput(value: unknown, now: string): ParsedBlob {
  const raw = exactObject(value, 'Review Cut renderer output');
  exactKeys(raw, ['blob'], 'Review Cut renderer output');
  return parseBlob(raw.blob, now);
}

function parseExportOutput(
  value: unknown,
  now: string,
): ParsedBlob & { readonly outputContentHash: string } {
  const raw = exactObject(value, 'Delivery exporter output');
  exactKeys(raw, ['blob', 'outputContentHash'], 'Delivery exporter output');
  const blob = parseBlob(raw.blob, now);
  let outputContentHash: string;
  try {
    outputContentHash = parseCanonical(Sha256Schema, raw.outputContentHash);
  } catch {
    throw invalid('Delivery export content hash is invalid');
  }
  if (outputContentHash !== blob.descriptor.hash) {
    throw invalid('Delivery export content hash does not match its output bytes');
  }
  return { ...blob, outputContentHash };
}

function localOperation(
  bound: BoundOperationRecord,
  authority: 'review_cut_attempt',
): ReviewBoundOperation;
function localOperation(
  bound: BoundOperationRecord,
  authority: 'delivery_export',
): ExportBoundOperation;
function localOperation(bound: BoundOperationRecord): LocalBoundOperation;
function localOperation(
  bound: BoundOperationRecord,
  authority?: 'review_cut_attempt' | 'delivery_export',
): LocalBoundOperation {
  const actual = bound.owner.authority;
  if (
    (actual !== 'review_cut_attempt' && actual !== 'delivery_export') ||
    (authority !== undefined && actual !== authority) ||
    bound.owner.view.authority !== actual ||
    bound.dispatch.ownerAuthority !== actual ||
    bound.dispatch.operationKind !== actual
  ) {
    throw invalid(`Operation ${bound.dispatch.id} is not the expected local Delivery work`);
  }
  return bound as LocalBoundOperation;
}

function exactManifest(
  database: DatabaseSync,
  ref: z.output<typeof DeliveryManifestRefSchema>,
  projectId: string,
): DeliveryManifest {
  const manifest = loadDeliveryManifest(database, ref.id);
  if (
    manifest.projectId !== projectId ||
    manifest.revision !== ref.revision ||
    manifest.contentHash !== ref.contentHash
  ) {
    throw invalid('Delivery Manifest does not match the exact Project snapshot');
  }
  return manifest;
}

function assertWritableRun(database: DatabaseSync, key: OperationDispatchKey): void {
  const run = loadRun(database, key.runId);
  if (run.projectId !== key.projectId) throw corrupt(`Run ${run.id} Project does not match`);
  if (run.permissionMode === 'read_only') {
    throw invalid('Local Delivery work is denied by the Run read-only permission');
  }
}

/** Read-only checks safe to run inside the atomic delivery.export model boundary. */
export function assertDeliveryExportModelBoundary(
  database: DatabaseSync,
  run: Run,
  inputValue: ExportRequest,
): void {
  const input = parseCanonical(ExportRequestSchema, inputValue);
  const key = resolveOperationDispatchKey(database, {
    runId: run.id,
    toolId: DeliveryExportDefinition.id,
    input,
  });
  if (run.projectId !== key.projectId) throw corrupt(`Run ${run.id} Project does not match`);
  assertWritableRun(database, key);
  exactManifest(database, input.manifest, key.projectId);
}

function transitionAndRecord(
  database: DatabaseSync,
  environment: StorageEnvironment,
  boundInput: BoundOperationRecord,
  input: Parameters<typeof transitionLocalDeliveryOwner>[2],
  commandId: string,
  phase: string,
  occurredAt: string,
  context: CommandContext,
): BoundOperationRecord {
  const bound = localOperation(boundInput);
  const after = transitionLocalDeliveryOwner(database, bound.owner, input);
  recordOperationOwnerTransitions(
    database,
    environment,
    [{ dispatch: bound.dispatch, before: bound.owner, after }],
    internalCommandId(commandId, bound.dispatch.key.fingerprint, phase),
    occurredAt,
    context,
  );
  return localOperation(loadBoundOperation(database, bound.dispatch.id));
}

function reviewRequest(manifest: DeliveryManifest, request: PreviewRequest) {
  if (
    manifest.sourcePlan.id !== request.plan.id ||
    manifest.sourcePlan.revision !== request.plan.revision ||
    manifest.sourcePlan.contentHash !== request.plan.contentHash
  ) {
    throw invalid('Review Cut Manifest does not bind the requested Delivery Plan');
  }
  return parseCanonical(ReviewCutRequestSchema, {
    manifest: {
      authority: 'delivery_manifest',
      id: manifest.id,
      revision: manifest.revision,
      contentHash: manifest.contentHash,
    },
    range: request.range,
  });
}

export function prepareReviewCutInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  key: OperationDispatchKey,
  request: PreviewRequest,
  manifest: DeliveryManifest,
  commandId: string,
  context: CommandContext,
  existingDispatchOperationId?: string,
): { readonly bound: BoundOperationRecord; readonly created: boolean } {
  if (!database.isTransaction) throw invalid('Review Cut preparation requires a transaction');
  const occurredAt = environment.now();
  const currentKey = resolveOperationDispatchKey(database, {
    runId: key.runId,
    toolId: 'delivery.preview',
    toolVersion: key.toolVersion,
    input: request,
  });
  if (currentKey.fingerprint !== key.fingerprint) {
    throw new StorageError('REVISION_CONFLICT', 'Review Cut input changed');
  }
  const replay = findOperationByFingerprint(database, currentKey, existingDispatchOperationId);
  if (replay !== undefined && replay.operationKind !== null) {
    return {
      bound: localOperation(loadBoundOperation(database, replay.id), 'review_cut_attempt'),
      created: false,
    };
  }
  assertWritableRun(database, currentKey);
  const currentManifest = exactManifest(
    database,
    {
      authority: 'delivery_manifest',
      id: manifest.id,
      revision: manifest.revision,
      contentHash: manifest.contentHash,
    },
    currentKey.projectId,
  );
  if (canonicalJson(currentManifest) !== canonicalJson(manifest)) {
    throw new StorageError('REVISION_CONFLICT', 'Review Cut Manifest changed');
  }
  const acceptedRequest = reviewRequest(currentManifest, request);
  const requestHash = hashCanonical(acceptedRequest);
  const withoutHash = {
    authority: 'review_cut_attempt' as const,
    id: environment.createId('review_cut_attempt'),
    projectId: currentKey.projectId,
    runId: currentKey.runId,
    manifest: acceptedRequest.manifest,
    request: acceptedRequest,
    revision: 0,
    contentHash: '',
    state: 'prepared' as const,
    requestHash,
    idempotencyKey: currentKey.fingerprint,
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: null,
    publicErrorCode: null,
    outputBlobHash: null,
    createdAt: occurredAt,
    finishedAt: null,
  };
  const attempt = parseCanonical(ReviewCutAttemptSchema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
  database
    .prepare(
      `INSERT INTO review_cut_attempts (
           id, project_id, run_id, delivery_manifest_id, delivery_manifest_revision,
           delivery_manifest_hash, revision, content_hash, state, request_v1_json,
           request_hash, idempotency_key, cancel_requested, progress_percent,
           public_error_code, output_blob_hash, created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'prepared', ?, ?, ?, 0, NULL, NULL, NULL, ?, NULL)`,
    )
    .run(
      attempt.id,
      attempt.projectId,
      attempt.runId,
      attempt.manifest.id,
      attempt.manifest.revision,
      attempt.manifest.contentHash,
      attempt.contentHash,
      canonicalJson(attempt.request),
      attempt.requestHash,
      attempt.idempotencyKey,
      attempt.createdAt,
    );
  const prepared = registerOperationDispatch(
    database,
    environment,
    {
      key: currentKey,
      existingDispatchOperationId,
      operationKind: 'review_cut_attempt',
      ownerAuthority: 'review_cut_attempt',
      ownerId: attempt.id,
      confirmationId: null,
      projectEventId: null,
      commandId: internalCommandId(commandId, currentKey.fingerprint, 'prepared'),
      occurredAt,
    },
    context,
  );
  return {
    bound: transitionAndRecord(
      database,
      environment,
      prepared,
      {
        state: 'running',
        progressPercent: null,
        publicErrorCode: null,
        outputBlobHash: null,
        outputContentHash: null,
        finishedAt: null,
      },
      commandId,
      'running',
      occurredAt,
      context,
    ),
    created: true,
  };
}

function prepareExport(
  database: DatabaseSync,
  environment: StorageEnvironment,
  key: OperationDispatchKey,
  request: ExportRequest,
  confirmationId: string,
  commandId: string,
  context: CommandContext,
  existingDispatchOperationId?: string,
): { readonly bound: BoundOperationRecord; readonly created: boolean } {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const currentKey = resolveOperationDispatchKey(database, {
      runId: key.runId,
      toolId: 'delivery.export',
      toolVersion: key.toolVersion,
      input: request,
    });
    if (currentKey.fingerprint !== key.fingerprint) {
      throw new StorageError('REVISION_CONFLICT', 'Delivery Export input changed');
    }
    const replay = findOperationByFingerprint(database, currentKey, existingDispatchOperationId);
    if (replay !== undefined && replay.operationKind !== null) {
      return {
        bound: localOperation(loadBoundOperation(database, replay.id), 'delivery_export'),
        created: false,
      };
    }
    assertWritableRun(database, currentKey);
    const manifest = exactManifest(database, request.manifest, currentKey.projectId);
    const approved = loadApprovedRunConfirmation(database, confirmationId, currentKey);
    if (
      approved.target.kind !== 'delivery_export' ||
      canonicalJson(approved.target) !==
        canonicalJson(deliveryExportConfirmationTargetFor(manifest, request))
    ) {
      throw invalid('Delivery Export confirmation does not bind the exact frozen export intent');
    }
    const requestHash = hashCanonical(request);
    const withoutHash = {
      authority: 'delivery_export' as const,
      id: environment.createId('delivery_export'),
      projectId: currentKey.projectId,
      runId: currentKey.runId,
      manifest: {
        authority: 'delivery_manifest' as const,
        id: manifest.id,
        revision: manifest.revision,
        contentHash: manifest.contentHash,
      },
      destination: request.destination,
      overwriteExisting: request.overwriteExisting,
      revision: 0,
      contentHash: '',
      state: 'prepared' as const,
      requestHash,
      idempotencyKey: currentKey.fingerprint,
      provider: null,
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      outputBlobHash: null,
      outputContentHash: null,
      createdAt: occurredAt,
      finishedAt: null,
    };
    const attempt = parseCanonical(DeliveryExportSchema, {
      ...withoutHash,
      contentHash: hashContentObject(withoutHash),
    });
    database
      .prepare(
        `INSERT INTO delivery_exports (
           id, project_id, run_id, delivery_manifest_id, delivery_manifest_revision,
           delivery_manifest_hash, revision, content_hash, destination_kind,
           destination_grant_id, destination_grant_hash, destination_display_label,
           destination_v1_json, overwrite_existing, state, request_hash, idempotency_key, cancel_requested,
           progress_percent, public_error_code, output_blob_hash, output_content_hash,
           created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, 0,
                   NULL, NULL, NULL, NULL, ?, NULL)`,
      )
      .run(
        attempt.id,
        attempt.projectId,
        attempt.runId,
        attempt.manifest.id,
        attempt.manifest.revision,
        attempt.manifest.contentHash,
        attempt.contentHash,
        attempt.destination.kind,
        attempt.destination.grantId,
        attempt.destination.grantHash,
        attempt.destination.displayLabel,
        canonicalJson(attempt.destination),
        Number(attempt.overwriteExisting),
        attempt.requestHash,
        attempt.idempotencyKey,
        attempt.createdAt,
      );
    const prepared = registerOperationDispatch(
      database,
      environment,
      {
        key: currentKey,
        existingDispatchOperationId,
        operationKind: 'delivery_export',
        ownerAuthority: 'delivery_export',
        ownerId: attempt.id,
        confirmationId,
        projectEventId: null,
        commandId: internalCommandId(commandId, currentKey.fingerprint, 'prepared'),
        occurredAt,
      },
      context,
    );
    return {
      bound: transitionAndRecord(
        database,
        environment,
        prepared,
        {
          state: 'running',
          progressPercent: null,
          publicErrorCode: null,
          outputBlobHash: null,
          outputContentHash: null,
          finishedAt: null,
        },
        commandId,
        'running',
        occurredAt,
        context,
      ),
      created: true,
    };
  });
}

function formatSummary(manifest: DeliveryManifest): string {
  const format = manifest.formatIntent;
  return `${format.container} · ${format.width}×${format.height} · ${format.frameRate} fps`;
}

function searchProjection(owner: LocalOwner, manifest: DeliveryManifest) {
  const ref = {
    authority: owner.authority,
    id: owner.id,
    revision: owner.revision,
    contentHash: owner.contentHash,
  };
  return owner.authority === 'review_cut_attempt'
    ? {
        source: { kind: 'review_cut' as const, ref },
        text: `Review Cut\n${formatSummary(manifest)}`,
      }
    : {
        source: { kind: 'delivery_export' as const, ref },
        text: `Delivery Export\n${owner.destination.displayLabel}\n${formatSummary(manifest)}`,
      };
}

function assertSearchProjection(
  database: DatabaseSync,
  owner: LocalOwner,
  manifest: DeliveryManifest,
): void {
  const expected = searchProjection(owner, manifest);
  const row = database
    .prepare(
      `SELECT project_id, source_kind, source_id, source_revision, source_hash,
              source_state, source_v1_json, search_text
       FROM project_search_documents WHERE project_id = ? AND source_kind = ? AND source_id = ?`,
    )
    .get(owner.projectId, expected.source.kind, owner.id) as unknown as
    | {
        project_id: string;
        source_kind: string;
        source_id: string;
        source_revision: number;
        source_hash: string;
        source_state: string;
        source_v1_json: string;
        search_text: string;
      }
    | undefined;
  if (
    row === undefined ||
    row.project_id !== owner.projectId ||
    row.source_kind !== expected.source.kind ||
    row.source_id !== owner.id ||
    row.source_revision !== owner.revision ||
    row.source_hash !== owner.contentHash ||
    row.source_state !== 'current' ||
    row.source_v1_json !== canonicalJson(expected.source) ||
    row.search_text !== expected.text
  ) {
    throw corrupt(`Local Delivery Operation ${owner.id} search projection does not match`);
  }
}

function deliveryExportSuccess(
  database: DatabaseSync,
  boundInput: BoundOperationRecord,
): DeliveryExportSuccess {
  const bound = localOperation(boundInput, 'delivery_export');
  const owner = bound.owner.view;
  const manifest = exactManifest(database, owner.manifest, owner.projectId);
  if (owner.state === 'succeeded') {
    if (owner.outputBlobHash === null) throw corrupt(`Delivery Export ${owner.id} lost its output`);
    loadMediaBlob(database, owner.outputBlobHash);
    assertSearchProjection(database, owner, manifest);
  }
  const publicView = operationPublicViewForOwner(
    database,
    bound.dispatch.id,
    bound.owner,
    bound.dispatch.key.input,
  );
  const success = DeliveryExportDefinition.parseSuccess({
    operation: publicView.ref,
    exportId: owner.id,
    state: owner.state,
    destinationLabel: owner.destination.displayLabel,
    contentHash: owner.outputContentHash,
    artifact: publicView.artifacts[0] ?? null,
    cost: { state: 'known', value: '0', currency: 'USD' },
  });
  return {
    ...success,
    operation: parseCanonical(DeliveryExportOperationRefSchema, success.operation),
    cost: { state: 'known', value: '0', currency: 'USD' },
  };
}

/** Rebuilds the canonical delivery.export result from its bound owner and projections. */
export function deliveryExportSuccessForDispatch(
  database: DatabaseSync,
  dispatchOperationId: string,
): DeliveryExportSuccess {
  return deliveryExportSuccess(database, loadBoundOperation(database, dispatchOperationId));
}

async function successForOperation(
  database: DatabaseSync,
  mediaCas: MediaCas,
  boundInput: BoundOperationRecord,
): Promise<ReviewCutSuccess | DeliveryExportSuccess> {
  const bound = localOperation(boundInput);
  const owner = bound.owner.view;
  const manifest = exactManifest(database, owner.manifest, owner.projectId);
  if (owner.state === 'succeeded') {
    if (owner.outputBlobHash === null) throw corrupt(`Local Delivery ${owner.id} lost its output`);
    const blob = loadMediaBlob(database, owner.outputBlobHash);
    await mediaCas.verify({ hash: blob.hash, byteLength: blob.byteLength });
    assertSearchProjection(database, owner, manifest);
  }
  const publicView = operationPublicViewForOwner(
    database,
    bound.dispatch.id,
    bound.owner,
    bound.dispatch.key.input,
  );
  const artifact = publicView.artifacts[0] ?? null;
  if (owner.authority === 'review_cut_attempt') {
    return {
      operation: parseCanonical(ReviewCutOperationRefSchema, publicView.ref),
      attemptId: owner.id,
      state: owner.state,
      artifact,
      warnings: [],
      usage: { state: 'known', value: '0', currency: 'USD' },
    };
  }
  return deliveryExportSuccess(database, bound);
}

async function finishWithoutOutput(
  database: DatabaseSync,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  operationId: string,
  code: Extract<OperationPublicErrorCode, 'invalid_request' | 'execution_failed'>,
  commandId: string,
  context: CommandContext,
): Promise<ReviewCutSuccess | DeliveryExportSuccess> {
  const terminal = withImmediateTransaction(database, () => {
    const current = localOperation(loadBoundOperation(database, operationId));
    if (
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return current;
    }
    const cancelled = current.owner.view.cancelRequested;
    return transitionAndRecord(
      database,
      environment,
      current,
      {
        state: cancelled ? 'cancelled' : 'failed',
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode: cancelled ? 'cancelled' : code,
        outputBlobHash: null,
        outputContentHash: null,
        finishedAt: environment.now(),
      },
      commandId,
      cancelled ? 'cancelled' : 'failed',
      environment.now(),
      context,
    );
  });
  return successForOperation(database, mediaCas, terminal);
}

async function publishOutput(
  database: DatabaseSync,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  operationId: string,
  output: ParsedBlob & { readonly outputContentHash?: string },
  commandId: string,
  context: CommandContext,
): Promise<ReviewCutSuccess | DeliveryExportSuccess> {
  const put = await mediaCas.putVerified(
    { hash: output.descriptor.hash, byteLength: output.descriptor.byteLength },
    output.bytes,
  );
  if (put.hash !== output.descriptor.hash || put.byteLength !== output.descriptor.byteLength) {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      operationId,
      'execution_failed',
      commandId,
      context,
    );
  }
  await mediaCas.verify({
    hash: output.descriptor.hash,
    byteLength: output.descriptor.byteLength,
  });
  const terminal = withImmediateTransaction(database, () => {
    const current = localOperation(loadBoundOperation(database, operationId));
    if (
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return current;
    }
    insertOrValidateMediaBlob(database, output.descriptor, environment.now());
    const occurredAt = environment.now();
    const succeeded = transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'succeeded',
        progressPercent: 100,
        publicErrorCode: null,
        outputBlobHash: output.descriptor.hash,
        outputContentHash:
          current.owner.authority === 'delivery_export'
            ? (output.outputContentHash ?? output.descriptor.hash)
            : null,
        finishedAt: occurredAt,
      },
      commandId,
      'succeeded',
      occurredAt,
      context,
    );
    const owner = localOperation(succeeded).owner.view;
    const manifest = exactManifest(database, owner.manifest, owner.projectId);
    const search = searchProjection(owner, manifest);
    upsertProjectSearchDocument(
      database,
      environment,
      owner.projectId,
      search.source,
      'current',
      search.text,
      occurredAt,
    );
    return succeeded;
  });
  return successForOperation(database, mediaCas, terminal);
}

async function renderReview(
  database: DatabaseSync,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  renderer: LocalReviewRendererAdapter,
  boundInput: BoundOperationRecord,
  commandId: string,
  context: CommandContext,
  signal?: AbortSignal,
): Promise<ReviewCutSuccess> {
  const bound = localOperation(boundInput, 'review_cut_attempt');
  if (bound.owner.view.state !== 'running') {
    return successForOperation(database, mediaCas, bound) as Promise<ReviewCutSuccess>;
  }
  if (bound.owner.view.cancelRequested) {
    return acknowledgeCancellation(
      database,
      environment,
      mediaCas,
      renderer,
      undefined,
      {
        operation: operationPublicViewForOwner(
          database,
          bound.dispatch.id,
          bound.owner,
          bound.dispatch.key.input,
        ).ref as ReviewOperationRef,
        expectedRevision: bound.owner.view.revision,
        commandId,
      },
      context,
      signal,
    ) as Promise<ReviewCutSuccess>;
  }
  const manifest = exactManifest(database, bound.owner.view.manifest, bound.owner.projectId);
  let raw: unknown;
  try {
    raw = await renderer.render(
      {
        idempotencyKey: bound.dispatch.key.fingerprint,
        requestHash: bound.owner.view.requestHash,
        manifest,
        range: bound.owner.view.request.range,
      },
      signal,
    );
  } catch {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      bound.dispatch.id,
      'execution_failed',
      commandId,
      context,
    ) as Promise<ReviewCutSuccess>;
  }
  let output: ParsedBlob;
  try {
    output = parseReviewOutput(raw, environment.now());
  } catch {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      bound.dispatch.id,
      'execution_failed',
      commandId,
      context,
    ) as Promise<ReviewCutSuccess>;
  }
  return publishOutput(
    database,
    environment,
    mediaCas,
    bound.dispatch.id,
    output,
    commandId,
    context,
  ) as Promise<ReviewCutSuccess>;
}

async function resolveGrant(
  resolver: DeliveryDestinationGrantResolver,
  request: Parameters<DeliveryDestinationGrantResolver['resolve']>[0],
) {
  const value = exactObject(await resolver.resolve(request), 'Resolved Delivery destination');
  exactKeys(value, ['descriptor', 'writableGrant'], 'Resolved Delivery destination');
  let resolvedDescriptor: ExportRequest['destination'];
  try {
    resolvedDescriptor = parseCanonical(DeliveryDestinationIntentSchema, value.descriptor);
  } catch {
    throw invalid('Resolved Delivery destination descriptor is invalid');
  }
  if (
    canonicalJson(resolvedDescriptor) !== canonicalJson(request.descriptor) ||
    value.writableGrant === null ||
    value.writableGrant === undefined
  ) {
    throw invalid('Resolved Delivery destination does not match its exact grant descriptor');
  }
  return { descriptor: resolvedDescriptor, writableGrant: value.writableGrant };
}

async function exportDelivery(
  database: DatabaseSync,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  resolver: DeliveryDestinationGrantResolver,
  exporter: LocalDeliveryExporterAdapter,
  boundInput: BoundOperationRecord,
  commandId: string,
  context: CommandContext,
  signal?: AbortSignal,
): Promise<DeliveryExportSuccess> {
  const bound = localOperation(boundInput, 'delivery_export');
  if (bound.owner.view.state !== 'running') {
    return successForOperation(database, mediaCas, bound) as Promise<DeliveryExportSuccess>;
  }
  if (bound.owner.view.cancelRequested) {
    return acknowledgeCancellation(
      database,
      environment,
      mediaCas,
      undefined,
      exporter,
      {
        operation: operationPublicViewForOwner(
          database,
          bound.dispatch.id,
          bound.owner,
          bound.dispatch.key.input,
        ).ref as ExportOperationRef,
        expectedRevision: bound.owner.view.revision,
        commandId,
      },
      context,
      signal,
    ) as Promise<DeliveryExportSuccess>;
  }
  const manifest = exactManifest(database, bound.owner.view.manifest, bound.owner.projectId);
  const run = loadRun(database, bound.owner.runId);
  let grant: Awaited<ReturnType<typeof resolveGrant>>;
  try {
    grant = await resolveGrant(resolver, {
      descriptor: bound.owner.view.destination,
      projectId: bound.owner.projectId,
      chatId: run.chatId,
      runId: run.id,
      deliveryPlan: manifest.sourcePlan,
      requiredExtension: manifest.formatIntent.container,
      operationFingerprint: bound.dispatch.key.fingerprint,
    });
  } catch {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      bound.dispatch.id,
      'invalid_request',
      commandId,
      context,
    ) as Promise<DeliveryExportSuccess>;
  }
  let raw: unknown;
  try {
    raw = await exporter.export(
      {
        idempotencyKey: bound.dispatch.key.fingerprint,
        requestHash: bound.owner.view.requestHash,
        manifest,
        destination: grant.descriptor,
        writableGrant: grant.writableGrant,
        overwriteExisting: bound.owner.view.overwriteExisting,
      },
      signal,
    );
  } catch {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      bound.dispatch.id,
      'execution_failed',
      commandId,
      context,
    ) as Promise<DeliveryExportSuccess>;
  }
  let output: ParsedBlob & { readonly outputContentHash: string };
  try {
    output = parseExportOutput(raw, environment.now());
  } catch {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      bound.dispatch.id,
      'execution_failed',
      commandId,
      context,
    ) as Promise<DeliveryExportSuccess>;
  }
  return publishOutput(
    database,
    environment,
    mediaCas,
    bound.dispatch.id,
    output,
    commandId,
    context,
  ) as Promise<DeliveryExportSuccess>;
}

function parseCancelResult(
  value: unknown,
  authority: 'review_cut_attempt' | 'delivery_export',
  now: string,
):
  | { readonly state: 'cancelled' }
  | {
      readonly state: 'succeeded';
      readonly output: ParsedBlob & { readonly outputContentHash?: string };
    } {
  const raw = exactObject(value, 'Local Delivery cancellation result');
  if (raw.state === 'cancelled') {
    exactKeys(raw, ['state'], 'Local Delivery cancellation result');
    return { state: 'cancelled' };
  }
  if (raw.state !== 'succeeded') throw invalid('Local Delivery cancellation result is invalid');
  exactKeys(raw, ['state', 'output'], 'Local Delivery cancellation result');
  return {
    state: 'succeeded',
    output:
      authority === 'review_cut_attempt'
        ? parseReviewOutput(raw.output, now)
        : parseExportOutput(raw.output, now),
  };
}

async function acknowledgeCancellation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  renderer: LocalReviewRendererAdapter | undefined,
  exporter: LocalDeliveryExporterAdapter | undefined,
  inputValue: AcknowledgeLocalDeliveryCancellationInput,
  contextValue: CommandContext,
  signal?: AbortSignal,
): Promise<ReviewCutSuccess | DeliveryExportSuccess> {
  let operation: LocalOperationRef;
  let expectedRevision: number;
  let commandId: string;
  let context: CommandContext;
  try {
    operation = parseCanonical(
      z.union([ReviewCutOperationRefSchema, DeliveryExportOperationRefSchema]),
      inputValue.operation,
    );
    expectedRevision = parseCanonical(RevisionSchema, inputValue.expectedRevision);
    commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
    context = parseCanonical(CommandContextSchema, contextValue);
  } catch {
    throw invalid('Local Delivery cancellation acknowledgement is invalid');
  }
  const initial = localOperation(loadBoundOperation(database, operation.id));
  assertOperationRefIdentity(initial, operation);
  if (
    initial.owner.view.state === 'succeeded' ||
    initial.owner.view.state === 'failed' ||
    initial.owner.view.state === 'cancelled'
  ) {
    return successForOperation(database, mediaCas, initial);
  }
  if (
    initial.owner.view.revision !== expectedRevision ||
    operation.revision !== expectedRevision ||
    initial.owner.view.contentHash !== operation.ownerRef.contentHash
  ) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Local Delivery Operation ${operation.id} changed before cancellation`,
    );
  }
  if (!initial.owner.view.cancelRequested) {
    throw invalid(`Local Delivery Operation ${operation.id} has no cancellation intent`);
  }
  const claimed = withImmediateTransaction(database, () => {
    const current = localOperation(loadBoundOperation(database, operation.id));
    if (
      current.owner.view.revision !== initial.owner.view.revision ||
      current.owner.view.contentHash !== initial.owner.view.contentHash ||
      current.owner.view.state !== initial.owner.view.state ||
      !current.owner.view.cancelRequested
    ) {
      throw new StorageError(
        'REVISION_CONFLICT',
        `Local Delivery Operation ${operation.id} changed before adapter cancellation`,
      );
    }
    claimLocalDeliveryOwner(database, current.owner);
    return localOperation(loadBoundOperation(database, operation.id));
  });
  const adapter = claimed.owner.authority === 'review_cut_attempt' ? renderer : exporter;
  if (adapter === undefined) throw corrupt('Local Delivery cancellation adapter is unavailable');
  let result: LocalReviewRenderCancelResult | LocalDeliveryExportCancelResult | undefined;
  try {
    result = await adapter.cancel(
      {
        idempotencyKey: claimed.dispatch.key.fingerprint,
        requestHash: claimed.owner.view.requestHash,
      },
      signal,
    );
  } catch {
    result = undefined;
  }
  if (result === undefined) {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      claimed.dispatch.id,
      'execution_failed',
      commandId,
      context,
    );
  }
  let parsed: ReturnType<typeof parseCancelResult>;
  try {
    parsed = parseCancelResult(result, claimed.owner.authority, environment.now());
  } catch {
    return finishWithoutOutput(
      database,
      environment,
      mediaCas,
      claimed.dispatch.id,
      'execution_failed',
      commandId,
      context,
    );
  }
  if (parsed.state === 'succeeded') {
    return publishOutput(
      database,
      environment,
      mediaCas,
      claimed.dispatch.id,
      parsed.output,
      commandId,
      context,
    );
  }
  const cancelled = withImmediateTransaction(database, () => {
    const current = localOperation(loadBoundOperation(database, claimed.dispatch.id));
    if (
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return current;
    }
    const occurredAt = environment.now();
    return transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'cancelled',
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode: 'cancelled',
        outputBlobHash: null,
        outputContentHash: null,
        finishedAt: occurredAt,
      },
      commandId,
      'cancelled',
      occurredAt,
      context,
    );
  });
  return successForOperation(database, mediaCas, cancelled);
}

export function createDeliveryOperationsAuthority(
  store: Store,
  environment: StorageEnvironment,
  mediaCas: MediaCas,
  delivery: DeliveryAuthority,
  renderer: LocalReviewRendererAdapter,
  destinationGrants: DeliveryDestinationGrantResolver,
  exporter: LocalDeliveryExporterAdapter,
): DeliveryOperationsAuthority {
  const database = () => getStoreDatabase(store);
  return Object.freeze({
    async preview(
      inputValue: StartReviewCutInput,
      contextValue: CommandContext,
      signal?: AbortSignal,
    ) {
      let commandId: string;
      let dispatchOperationId: string | undefined;
      let context: CommandContext;
      try {
        commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
        dispatchOperationId =
          inputValue.dispatchOperationId === undefined
            ? undefined
            : parseCanonical(EntityIdSchema, inputValue.dispatchOperationId);
        context = parseCanonical(CommandContextSchema, contextValue);
      } catch {
        throw invalid('Review Cut command context is invalid');
      }
      const key = resolveOperationDispatchKey(database(), {
        runId: inputValue.runId,
        toolId: 'delivery.preview',
        input: inputValue.request,
      });
      const replay = findOperationByFingerprint(database(), key, dispatchOperationId);
      if (replay !== undefined) {
        const bound = localOperation(
          loadBoundOperation(database(), replay.id),
          'review_cut_attempt',
        );
        return bound.owner.view.state === 'running'
          ? renderReview(
              database(),
              environment,
              mediaCas,
              renderer,
              bound,
              commandId,
              context,
              signal,
            )
          : (successForOperation(database(), mediaCas, bound) as Promise<ReviewCutSuccess>);
      }
      const request = parseCanonical(DeliveryPreviewRequestSchema, key.input);
      assertWritableRun(database(), key);
      const plan = request.plan;
      const planRow = database()
        .prepare('SELECT project_id FROM delivery_plans WHERE id = ?')
        .get(plan.id) as { project_id: string } | undefined;
      if (planRow === undefined)
        throw new StorageError('NOT_FOUND', `Delivery was not found: ${plan.id}`);
      if (planRow.project_id !== key.projectId)
        throw invalid('Delivery belongs to another Project');
      const manifest = delivery.freeze({ plan }, context);
      const prepared = withImmediateTransaction(database(), () =>
        prepareReviewCutInTransaction(
          database(),
          environment,
          key,
          request,
          manifest,
          commandId,
          context,
          dispatchOperationId,
        ),
      );
      return renderReview(
        database(),
        environment,
        mediaCas,
        renderer,
        prepared.bound,
        commandId,
        context,
        signal,
      );
    },

    async export(
      inputValue: StartDeliveryExportInput,
      contextValue: CommandContext,
      signal?: AbortSignal,
    ) {
      let commandId: string;
      let confirmationId: string;
      let dispatchOperationId: string | undefined;
      let context: CommandContext;
      try {
        commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
        confirmationId = parseCanonical(EntityIdSchema, inputValue.confirmationId);
        dispatchOperationId =
          inputValue.dispatchOperationId === undefined
            ? undefined
            : parseCanonical(EntityIdSchema, inputValue.dispatchOperationId);
        context = parseCanonical(CommandContextSchema, contextValue);
      } catch {
        throw invalid('Delivery Export command context is invalid');
      }
      const key = resolveOperationDispatchKey(database(), {
        runId: inputValue.runId,
        toolId: 'delivery.export',
        input: inputValue.request,
      });
      const replay = findOperationByFingerprint(database(), key, dispatchOperationId);
      if (replay !== undefined && replay.operationKind !== null) {
        const bound = localOperation(loadBoundOperation(database(), replay.id), 'delivery_export');
        return bound.owner.view.state === 'running'
          ? exportDelivery(
              database(),
              environment,
              mediaCas,
              destinationGrants,
              exporter,
              bound,
              commandId,
              context,
              signal,
            )
          : (successForOperation(database(), mediaCas, bound) as Promise<DeliveryExportSuccess>);
      }
      const request = parseCanonical(ExportRequestSchema, key.input);
      const prepared = prepareExport(
        database(),
        environment,
        key,
        request,
        confirmationId,
        commandId,
        context,
        dispatchOperationId,
      );
      return exportDelivery(
        database(),
        environment,
        mediaCas,
        destinationGrants,
        exporter,
        prepared.bound,
        commandId,
        context,
        signal,
      );
    },

    acknowledgeCancellation(
      input: AcknowledgeLocalDeliveryCancellationInput,
      context: CommandContext,
      signal?: AbortSignal,
    ) {
      return acknowledgeCancellation(
        database(),
        environment,
        mediaCas,
        renderer,
        exporter,
        input,
        context,
        signal,
      );
    },
  });
}
