import {
  EntityIdSchema,
  GlobalMediaAssetSchema,
  MediaDerivationAttemptViewSchema,
  MediaDerivationOutputSchema,
  MediaDerivationSchema,
  MediaDerivationTransformSchema,
  MediaDeriveInputSchema,
  MediaDeriveSuccessSchema,
  MediaTechnicalFactsSchema,
  ProjectMediaRefSchema,
  ProviderReceiptSchema,
  ProviderUsageSchema,
  Sha256Schema,
  canonicalJson,
  mediaDerivationRequestHashInput,
  parseCanonical,
  providerReceiptHashInput,
  type MediaBlob,
  type MediaDerivationOutput,
  type OperationPublicErrorCode,
  type ProjectMediaRef,
  type ProviderReceipt,
  type ProviderUsage,
  type Run,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getProject, getSettings } from './projects.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { TargetCommandContextSchema, type TargetCommandContext } from '../internal/command.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  insertGlobalMediaAsset,
  insertOrValidateMediaBlob,
  insertProjectMediaRecord,
  loadGlobalMediaAsset,
  loadMediaBlob,
  loadProjectMediaRecord,
  type MediaBlobDescriptor,
} from '../internal/media-records.js';
import { resolveRunMediaSource } from '../internal/media-source.js';
import {
  appendOperationCostReservation,
  loadOperationCostReservation,
  releaseOperationCostReservation,
} from '../internal/operation-cost-ledger.js';
import {
  findOperationByFingerprint,
  loadBoundOperation,
  recordOperationOwnerTransitions,
  registerOperationDispatch,
  resolveOperationDispatchKey,
  type BoundOperationRecord,
  type OperationDispatchKey,
} from '../internal/operation-dispatch.js';
import {
  operationPublicViewForOwner,
  transitionMediaDerivationOwner,
} from '../internal/operation-owner-records.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { loadProviderProfileRecord } from '../internal/provider-profile-records.js';
import { loadRun } from '../internal/run-records.js';
import { loadRunBudgetExposure } from '../internal/run-budget.js';
import { appendRunResourceEntry } from '../internal/run-resource-ledger.js';
import { upsertProjectSearchDocument } from '../internal/search-projection.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { MediaCas } from '../kernel/media-cas.js';
import type {
  LocalMediaDerivationAdapter,
  LocalMediaDerivationTransform,
  MediaDerivationPublication,
  TranscriptionProviderAdapter,
  TranscriptionProviderProfile,
  TranscriptionProviderState,
  TranscriptionTransform,
} from '../kernel/media-derivation-adapters.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

export type MediaDeriveInput = z.output<typeof MediaDeriveInputSchema>;
export type LocalMediaDeriveInput = Exclude<MediaDeriveInput, { operation: 'transcribe' }>;
export type MediaDeriveSuccess = z.output<typeof MediaDeriveSuccessSchema>;

export interface StartMediaDerivationInput {
  readonly runId: string;
  readonly commandId: string;
  readonly input: MediaDeriveInput;
  readonly dispatchOperationId?: string;
}

export interface ContinueMediaDerivationInput {
  readonly dispatchOperationId: string;
  readonly commandId: string;
}

export interface MediaDerivationsAuthority {
  readonly start: (
    input: StartMediaDerivationInput,
    context: TargetCommandContext,
  ) => Promise<MediaDeriveSuccess>;
  readonly continue: (
    input: ContinueMediaDerivationInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<MediaDeriveSuccess>;
}

interface ParsedOutput {
  readonly ordinal: number;
  readonly blob: MediaBlobDescriptor;
  readonly publication: MediaDerivationPublication;
}

interface PreparedMediaDerivation {
  readonly bound: BoundOperationRecord;
  readonly created: boolean;
}

class LocalCancellationRace extends Error {}

const ADAPTER_UNAVAILABLE = Symbol('adapter-unavailable');

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function parseInput(value: unknown): MediaDeriveInput {
  try {
    return parseCanonical(MediaDeriveInputSchema, value);
  } catch (cause) {
    throw invalid('Media Derivation input is invalid', cause);
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw corrupt(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join('\u0000') !== [...keys].sort().join('\u0000')) {
    throw corrupt(`${label} contains unexpected or missing fields`);
  }
}

const OutputMetadataSchema = z.strictObject({
  ordinal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).finite(),
  blob: z.strictObject({
    hash: Sha256Schema,
    byteLength: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).finite(),
    mimeType: z.string().trim().min(1).max(160),
    technicalFacts: MediaTechnicalFactsSchema,
  }),
});

function parseOutputs(value: unknown, label: string): ParsedOutput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw corrupt(`${label} must contain between 1 and 100 outputs`);
  }
  const outputs = value.map((entry, index) => {
    const output = objectValue(entry, `${label} output ${index}`);
    exactKeys(output, ['ordinal', 'blob'], `${label} output ${index}`);
    const blob = objectValue(output.blob, `${label} output ${index} Blob`);
    exactKeys(
      blob,
      ['hash', 'byteLength', 'mimeType', 'technicalFacts', 'publication'],
      `${label} output ${index} Blob`,
    );
    let metadata: z.output<typeof OutputMetadataSchema>;
    try {
      metadata = parseCanonical(OutputMetadataSchema, {
        ordinal: output.ordinal,
        blob: {
          hash: blob.hash,
          byteLength: blob.byteLength,
          mimeType: blob.mimeType,
          technicalFacts: blob.technicalFacts,
        },
      });
    } catch {
      throw corrupt(`${label} output ${index} metadata is invalid`);
    }
    if (metadata.ordinal !== index) {
      throw corrupt(`${label} output ordinals are not contiguous from zero`);
    }
    const publication = objectValue(blob.publication, `${label} output ${index} publication`);
    if (publication.state === 'published') {
      exactKeys(publication, ['state'], `${label} output ${index} publication`);
      return { ...metadata, publication: { state: 'published' as const } };
    }
    if (publication.state !== 'pending') {
      throw corrupt(`${label} output ${index} publication state is invalid`);
    }
    exactKeys(publication, ['state', 'bytes'], `${label} output ${index} publication`);
    const bytes = publication.bytes as AsyncIterable<Uint8Array> | undefined;
    if (bytes === undefined || typeof bytes[Symbol.asyncIterator] !== 'function') {
      throw corrupt(`${label} output ${index} byte stream is invalid`);
    }
    return { ...metadata, publication: { state: 'pending' as const, bytes } };
  });
  const descriptors = new Map<string, string>();
  for (const output of outputs) {
    const descriptor = canonicalJson(output.blob);
    const existing = descriptors.get(output.blob.hash);
    if (existing !== undefined && existing !== descriptor) {
      throw corrupt(`Media Blob ${output.blob.hash} has conflicting output metadata`);
    }
    descriptors.set(output.blob.hash, descriptor);
  }
  return outputs;
}

function parseProviderReceipt(value: unknown): ProviderReceipt {
  let receipt: ProviderReceipt;
  try {
    receipt = parseCanonical(ProviderReceiptSchema, value);
  } catch {
    throw corrupt('Transcription provider receipt is invalid');
  }
  if (hashCanonical(providerReceiptHashInput(receipt)) !== receipt.receiptHash) {
    throw corrupt('Transcription provider receipt hash does not match');
  }
  return receipt;
}

function parseProviderState(value: unknown): TranscriptionProviderState {
  const state = objectValue(value, 'Transcription provider state');
  if (state.state === 'not_submitted') {
    exactKeys(state, ['state'], 'Transcription provider state');
    return { state: 'not_submitted' };
  }
  exactKeys(
    state,
    state.state === 'failed'
      ? ['state', 'receipt', 'usage', 'outputs', 'publicErrorCode']
      : ['state', 'receipt', 'usage', 'outputs'],
    'Transcription provider state',
  );
  if (!['unknown', 'submitted', 'succeeded', 'failed', 'cancelled'].includes(String(state.state))) {
    throw corrupt('Transcription provider state is invalid');
  }
  const receipt = state.receipt === null ? null : parseProviderReceipt(state.receipt);
  let usage: ProviderUsage | null;
  try {
    usage = state.usage === null ? null : parseCanonical(ProviderUsageSchema, state.usage);
  } catch {
    throw corrupt('Transcription provider usage is invalid');
  }
  const outputs =
    Array.isArray(state.outputs) && state.outputs.length === 0
      ? []
      : parseOutputs(state.outputs, 'Transcription provider');
  if (state.state === 'unknown' && (usage !== null || outputs.length !== 0)) {
    throw corrupt('Transcription provider unknown state cannot contain usage or outputs');
  }
  if (state.state === 'submitted' && (receipt === null || usage !== null || outputs.length !== 0)) {
    throw corrupt('Transcription provider submitted state is incomplete');
  }
  if (
    state.state === 'succeeded' &&
    (receipt === null || usage === null || outputs.length !== 1 || outputs[0]?.ordinal !== 0)
  ) {
    throw corrupt('Transcription provider succeeded state requires one ordinal-zero output');
  }
  if (
    (state.state === 'failed' || state.state === 'cancelled') &&
    (outputs.length !== 0 || (receipt === null) !== (usage === null))
  ) {
    throw corrupt('Transcription provider terminal receipt and usage are inconsistent');
  }
  if (state.state === 'failed') {
    if (
      state.publicErrorCode !== 'provider_failed' &&
      state.publicErrorCode !== 'execution_failed'
    ) {
      throw corrupt('Transcription provider failure code is invalid');
    }
    return {
      state: 'failed',
      receipt,
      usage,
      outputs: [],
      publicErrorCode: state.publicErrorCode,
    };
  }
  if (state.state === 'unknown') return { state: 'unknown', receipt, usage: null, outputs: [] };
  if (state.state === 'submitted') {
    return { state: 'submitted', receipt: receipt!, usage: null, outputs: [] };
  }
  if (state.state === 'succeeded') {
    const output = outputs[0]!;
    return {
      state: 'succeeded',
      receipt: receipt!,
      usage: usage!,
      outputs: [
        {
          ordinal: output.ordinal,
          blob: { ...output.blob, publication: output.publication },
        },
      ],
    };
  }
  return { state: 'cancelled', receipt, usage, outputs: [] };
}

function parseLocalCancelResult(value: unknown): void {
  const result = objectValue(value, 'Local Media Derivation cancellation result');
  exactKeys(result, ['state'], 'Local Media Derivation cancellation result');
  if (result.state !== 'cancelled') {
    throw corrupt('Local Media Derivation cancellation was not acknowledged');
  }
}

function internalCommandId(commandId: string, fingerprint: string, phase: string): string {
  return hashCanonical({
    commandId: parseCanonical(EntityIdSchema, commandId),
    fingerprint,
    phase,
  });
}

function transformForInput(input: MediaDeriveInput) {
  const {
    source: _source,
    expectedSourceHash: _expectedSourceHash,
    attach: _attach,
    outputIntents: _outputIntents,
    ...transform
  } = input;
  return parseCanonical(MediaDerivationTransformSchema, transform);
}

function assertProjectRevision(
  database: DatabaseSync,
  projectId: string,
  input: MediaDeriveInput,
): void {
  if (!input.attach.enabled) return;
  const project = getProject(database, projectId);
  if (project.revision !== input.attach.expectedProjectRevision) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Project ${project.id} revision does not match the derivative attachment request`,
    );
  }
}

function resolveSource(database: DatabaseSync, runId: string, input: MediaDeriveInput) {
  const { blob } = resolveRunMediaSource(database, runId, input.source);
  if (blob.hash !== input.expectedSourceHash) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Media source ${input.source.id} does not match expectedSourceHash`,
    );
  }
  return blob;
}

/** Checks only durable local state and is safe inside the atomic model boundary. */
export function assertMediaDeriveModelBoundary(
  database: DatabaseSync,
  run: Run,
  inputValue: MediaDeriveInput,
): void {
  const input = parseInput(inputValue);
  if (run.permissionMode === 'read_only') {
    throw invalid('Media Derivation is denied by the Run read-only permission');
  }
  resolveSource(database, run.id, input);
  assertProjectRevision(database, run.projectId, input);
  if (input.operation === 'transcribe') {
    loadRunBudgetExposure(database, run);
    if (run.budget.costUsd.state !== 'unknown') {
      throw invalid('Transcription with unknown cost is denied by the finite Run budget');
    }
  }
}

function providerProfile(
  database: DatabaseSync,
  run: Run,
  input: Extract<MediaDeriveInput, { operation: 'transcribe' }>,
  adapter: TranscriptionProviderAdapter,
): TranscriptionProviderProfile {
  const requestedId =
    input.provider?.providerId ?? getSettings(database, run.projectId).defaultProviderProfileId;
  if (requestedId === null) throw invalid('Transcription has no configured Provider Profile');
  const profile = loadProviderProfileRecord(database, requestedId, adapter, 'Transcription');
  if (
    input.provider !== null &&
    (profile.model.providerId !== input.provider.providerId ||
      profile.model.model !== input.provider.model)
  ) {
    throw invalid('Transcription Provider Profile does not match the request');
  }
  return profile;
}

function mediaOperation(bound: BoundOperationRecord): BoundOperationRecord {
  if (
    bound.dispatch.operationKind !== 'media_derivation' ||
    bound.owner.authority !== 'media_derivation_attempt' ||
    bound.owner.view.authority !== 'media_derivation_attempt'
  ) {
    throw invalid(`Operation ${bound.dispatch.id} is not a Media Derivation`);
  }
  return bound;
}

function acceptedInput(bound: BoundOperationRecord): MediaDeriveInput {
  try {
    return parseCanonical(MediaDeriveInputSchema, bound.dispatch.key.input);
  } catch {
    throw corrupt(`Media Derivation ${bound.dispatch.id} accepted input is invalid`);
  }
}

function acceptedProfile(
  database: DatabaseSync,
  bound: BoundOperationRecord,
  adapter: TranscriptionProviderAdapter,
): TranscriptionProviderProfile {
  if (
    bound.owner.view.authority !== 'media_derivation_attempt' ||
    bound.owner.view.provider === null ||
    bound.owner.view.derivation.transform.operation !== 'transcribe'
  ) {
    throw corrupt(`Media Derivation ${bound.dispatch.id} has no transcription provider`);
  }
  return loadProviderProfileRecord(
    database,
    bound.owner.view.provider.providerId,
    adapter,
    'Transcription',
    bound.owner.view.provider,
  );
}

function outputRows(database: DatabaseSync, attemptId: string): MediaDerivationOutput[] {
  const rows = database
    .prepare(
      `SELECT id, derivation_attempt_id, blob_hash, global_asset_id,
              project_media_ref_id, ordinal
       FROM media_derivation_outputs
       WHERE derivation_attempt_id = ?
       ORDER BY ordinal, id`,
    )
    .all(attemptId) as unknown as Array<{
    id: string;
    derivation_attempt_id: string;
    blob_hash: string;
    global_asset_id: string;
    project_media_ref_id: string | null;
    ordinal: number;
  }>;
  return rows.map((row, index) => {
    const output = parseCanonical(MediaDerivationOutputSchema, {
      id: row.id,
      derivationAttemptId: row.derivation_attempt_id,
      blobHash: row.blob_hash,
      globalAssetId: row.global_asset_id,
      projectMediaRefId: row.project_media_ref_id,
      ordinal: row.ordinal,
    });
    if (output.ordinal !== index) {
      throw corrupt(`Media Derivation Attempt ${attemptId} output ordinals are not contiguous`);
    }
    return output;
  });
}

function mediaSearchText(object: ProjectMediaRef): string {
  return [object.label, ...object.collections, ...object.roles, object.notes].join('\n');
}

function successForOperation(
  database: DatabaseSync,
  boundInput: BoundOperationRecord,
): MediaDeriveSuccess {
  const bound = mediaOperation(boundInput);
  if (bound.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`Media Derivation ${bound.dispatch.id} owner authority does not match`);
  }
  const outputs = outputRows(database, bound.owner.view.id);
  const publicView = operationPublicViewForOwner(
    database,
    bound.dispatch.id,
    bound.owner,
    bound.dispatch.key.input,
  );
  return parseCanonical(MediaDeriveSuccessSchema, {
    operation: publicView.ref,
    derivationId: bound.owner.view.derivation.id,
    attemptId: bound.owner.view.id,
    requestHash: bound.owner.view.derivation.requestHash,
    artifacts: publicView.artifacts,
    globalAssets: outputs.map(({ globalAssetId }) => loadGlobalMediaAsset(database, globalAssetId)),
    projectMediaRefs: outputs.flatMap(({ projectMediaRefId }) =>
      projectMediaRefId === null ? [] : [loadProjectMediaRecord(database, projectMediaRefId)],
    ),
  });
}

export function mediaDeriveSuccessForDispatch(
  database: DatabaseSync,
  dispatchOperationId: string,
): MediaDeriveSuccess {
  return successForOperation(database, loadBoundOperation(database, dispatchOperationId));
}

function replayForKey(
  database: DatabaseSync,
  key: OperationDispatchKey,
  dispatchOperationId?: string,
): MediaDeriveSuccess | undefined {
  const dispatch = findOperationByFingerprint(database, key, dispatchOperationId);
  return dispatch === undefined || dispatch.operationKind === null
    ? undefined
    : successForOperation(database, loadBoundOperation(database, dispatch.id));
}

function assertOutputIntents(input: MediaDeriveInput, outputs: readonly ParsedOutput[]): void {
  if (
    input.outputIntents.length !== outputs.length ||
    input.outputIntents.some((intent, index) => intent.ordinal !== outputs[index]?.ordinal)
  ) {
    throw corrupt('Media Derivation outputs do not match the accepted output intents');
  }
}

function transitionAndRecord(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  input: Parameters<typeof transitionMediaDerivationOwner>[2],
  commandId: string,
  phase: string,
  occurredAt: string,
  context: TargetCommandContext,
): BoundOperationRecord {
  const after = transitionMediaDerivationOwner(database, bound.owner, input);
  recordOperationOwnerTransitions(
    database,
    environment,
    [{ dispatch: bound.dispatch, before: bound.owner, after }],
    internalCommandId(commandId, bound.dispatch.key.fingerprint, phase),
    occurredAt,
    context,
  );
  return mediaOperation(loadBoundOperation(database, bound.dispatch.id));
}

function appendUnknownCostReservation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  run: Run,
  occurredAt: string,
): void {
  appendOperationCostReservation(
    database,
    environment,
    bound,
    { state: 'unknown', currency: run.budget.costUsd.currency },
    occurredAt,
  );
}

function settleUnknownCost(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  usage: ProviderUsage,
  occurredAt: string,
): void {
  const reservation = loadOperationCostReservation(
    database,
    bound,
    `Media Derivation ${bound.dispatch.id}`,
  );
  if (
    reservation.amount.state !== 'unknown' ||
    !('currency' in reservation.amount) ||
    reservation.amount.currency !== usage.cost.currency
  ) {
    throw corrupt(`Media Derivation ${bound.dispatch.id} cost reservation is invalid`);
  }
  releaseOperationCostReservation(
    database,
    environment,
    bound,
    occurredAt,
    `Media Derivation ${bound.dispatch.id}`,
  );
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source: { kind: 'dispatch_operation', id: bound.dispatch.id },
    phase: 'consumed',
    reservationEntryId: null,
    kind: 'cost',
    amount: usage.cost,
    idempotencyKey: hashCanonical({
      ownerId: bound.owner.view.id,
      kind: 'cost',
      phase: 'consumed',
    }),
    recordedAt: occurredAt,
  });
}

function prepareOperation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  adapter: TranscriptionProviderAdapter,
  key: OperationDispatchKey,
  expectedInput: MediaDeriveInput,
  expectedSource: MediaBlob,
  expectedProfile: TranscriptionProviderProfile | null,
  commandId: string,
  context: TargetCommandContext,
  existingDispatchOperationId?: string,
): PreparedMediaDerivation {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const currentKey = resolveOperationDispatchKey(database, {
      runId: key.runId,
      toolId: 'media.derive',
      toolVersion: key.toolVersion,
      input: expectedInput,
    });
    if (currentKey.fingerprint !== key.fingerprint) {
      throw corrupt('Media Derivation fingerprint changed before persistence');
    }
    const replay = findOperationByFingerprint(database, currentKey, existingDispatchOperationId);
    if (replay !== undefined && replay.operationKind !== null) {
      return {
        bound: mediaOperation(loadBoundOperation(database, replay.id)),
        created: false,
      };
    }
    const input = parseInput(currentKey.input);
    const run = loadRun(database, currentKey.runId);
    assertMediaDeriveModelBoundary(database, run, input);
    const source = resolveSource(database, run.id, input);
    if (
      source.hash !== expectedSource.hash ||
      source.byteLength !== expectedSource.byteLength ||
      canonicalJson(source.technicalFacts) !== canonicalJson(expectedSource.technicalFacts)
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Media source changed before Derivation persistence',
      );
    }
    const profile =
      input.operation === 'transcribe' ? providerProfile(database, run, input, adapter) : null;
    if (canonicalJson(profile) !== canonicalJson(expectedProfile)) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Transcription Provider Profile changed before persistence',
      );
    }
    const transform = transformForInput(input);
    const derivationWithoutHash = {
      authority: 'media_derivation' as const,
      id: environment.createId('media_derivation'),
      projectId: run.projectId,
      runId: run.id,
      sourceBlobHash: source.hash,
      transform,
      requestHash: '',
      idempotencyKey: currentKey.fingerprint,
      createdAt: occurredAt,
    };
    const derivation = parseCanonical(MediaDerivationSchema, {
      ...derivationWithoutHash,
      requestHash: hashCanonical(mediaDerivationRequestHashInput(derivationWithoutHash)),
    });
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
    const attemptWithoutHash = {
      authority: 'media_derivation_attempt' as const,
      id: environment.createId('media_derivation_attempt'),
      derivation,
      attemptNumber: 1,
      revision: 0,
      contentHash: '',
      state: 'prepared' as const,
      provider: profile?.model ?? null,
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      createdAt: occurredAt,
      finishedAt: null,
    };
    const attempt = parseCanonical(MediaDerivationAttemptViewSchema, {
      ...attemptWithoutHash,
      contentHash: hashContentObject(attemptWithoutHash),
    });
    database
      .prepare(
        `INSERT INTO media_derivation_attempts (
           id, derivation_id, attempt_number, revision, content_hash, state,
           provider_profile_id, provider_v1_json, provider_operation_id, receipt_v1_json,
           usage_v1_json, cancel_requested, progress_percent, public_error_code,
           created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, 'prepared', ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?, NULL)`,
      )
      .run(
        attempt.id,
        derivation.id,
        attempt.attemptNumber,
        attempt.revision,
        attempt.contentHash,
        profile?.id ?? null,
        attempt.provider === null ? null : canonicalJson(attempt.provider),
        attempt.createdAt,
      );
    const prepared = registerOperationDispatch(
      database,
      environment,
      {
        key: currentKey,
        existingDispatchOperationId,
        operationKind: 'media_derivation',
        ownerAuthority: 'media_derivation_attempt',
        ownerId: attempt.id,
        confirmationId: null,
        projectEventId: null,
        commandId: internalCommandId(commandId, currentKey.fingerprint, 'prepared'),
        occurredAt,
      },
      context,
    );
    if (profile !== null)
      appendUnknownCostReservation(database, environment, prepared, run, occurredAt);
    const running = transitionAndRecord(
      database,
      environment,
      prepared,
      {
        state: 'running',
        receipt: null,
        usage: null,
        progressPercent: 0,
        publicErrorCode: null,
        finishedAt: null,
        receiptReconciled: false,
      },
      commandId,
      'running',
      occurredAt,
      context,
    );
    return { bound: running, created: true };
  });
}

function reconciledReceipt(receipt: ProviderReceipt, reconciledAt: string): ProviderReceipt {
  return parseCanonical(ProviderReceiptSchema, { ...receipt, reconciledAt });
}

function persistReceipt(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  receipt: ProviderReceipt,
  reconciled: boolean,
): BoundOperationRecord {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = mediaOperation(loadBoundOperation(database, operationId));
    if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) return current;
    if (current.owner.view.authority !== 'media_derivation_attempt') {
      throw corrupt(`Media Derivation ${operationId} owner does not match`);
    }
    const normalized = reconciled
      ? reconciledReceipt(receipt, occurredAt)
      : parseCanonical(ProviderReceiptSchema, { ...receipt, reconciledAt: null });
    const existing = current.owner.view.receipt;
    if (
      existing !== null &&
      (existing.providerOperationId !== normalized.providerOperationId ||
        existing.submittedAt !== normalized.submittedAt ||
        existing.receiptHash !== normalized.receiptHash)
    ) {
      throw corrupt(`Media Derivation ${operationId} provider receipt changed`);
    }
    if (existing !== null && canonicalJson(existing) === canonicalJson(normalized)) return current;
    transitionMediaDerivationOwner(database, current.owner, {
      state: current.owner.view.state,
      receipt: normalized,
      usage: current.owner.view.usage,
      progressPercent: current.owner.view.progressPercent,
      publicErrorCode: current.owner.view.publicErrorCode,
      finishedAt: current.owner.view.finishedAt,
      receiptReconciled: reconciled,
    });
    return mediaOperation(loadBoundOperation(database, current.dispatch.id));
  });
}

function markUnknown(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
): MediaDeriveSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = mediaOperation(loadBoundOperation(database, operationId));
    if (
      current.owner.view.state === 'unknown' ||
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return successForOperation(database, current);
    }
    if (
      current.owner.view.authority !== 'media_derivation_attempt' ||
      (current.owner.view.state !== 'running' && current.owner.view.state !== 'submitted')
    ) {
      throw corrupt(`Media Derivation ${operationId} cannot enter unknown state`);
    }
    const unknown = transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'unknown',
        receipt: current.owner.view.receipt,
        usage: null,
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode: 'provider_state_unknown',
        finishedAt: null,
        receiptReconciled: false,
      },
      commandId,
      'unknown',
      occurredAt,
      context,
    );
    return successForOperation(database, unknown);
  });
}

function markSubmitted(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
): MediaDeriveSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = mediaOperation(loadBoundOperation(database, operationId));
    if (
      current.owner.view.state === 'submitted' ||
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return successForOperation(database, current);
    }
    if (
      current.owner.view.authority !== 'media_derivation_attempt' ||
      current.owner.view.state !== 'unknown' ||
      current.owner.view.receipt === null
    ) {
      throw corrupt(`Media Derivation ${operationId} cannot enter submitted state`);
    }
    const submitted = transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'submitted',
        receipt: current.owner.view.receipt,
        usage: null,
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode: null,
        finishedAt: null,
        receiptReconciled: true,
      },
      commandId,
      'submitted',
      occurredAt,
      context,
    );
    return successForOperation(database, submitted);
  });
}

function finishTerminal(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  state: 'failed' | 'cancelled',
  publicErrorCode: OperationPublicErrorCode,
  receipt: ProviderReceipt | null,
  usage: ProviderUsage | null,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): MediaDeriveSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = mediaOperation(loadBoundOperation(database, operationId));
    if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
      return successForOperation(database, current);
    }
    if (current.owner.view.authority !== 'media_derivation_attempt') {
      throw corrupt(`Media Derivation ${operationId} owner does not match`);
    }
    if (outputRows(database, current.owner.view.id).length !== 0) {
      throw corrupt(`Nonterminal Media Derivation ${operationId} already has outputs`);
    }
    const external = current.owner.view.derivation.transform.operation === 'transcribe';
    const terminalReceipt =
      receipt === null ? current.owner.view.receipt : reconciledReceipt(receipt, occurredAt);
    if (!external && (terminalReceipt !== null || usage !== null)) {
      throw corrupt(`Local Media Derivation ${operationId} contains provider state`);
    }
    if (external) {
      if (terminalReceipt !== null && usage === null) {
        throw corrupt(`Transcription ${operationId} terminal receipt has no usage`);
      }
      if (usage === null) {
        releaseOperationCostReservation(
          database,
          environment,
          current,
          occurredAt,
          `Media Derivation ${operationId}`,
        );
      } else {
        settleUnknownCost(database, environment, current, usage, occurredAt);
      }
    }
    const terminal = transitionAndRecord(
      database,
      environment,
      current,
      {
        state,
        receipt: terminalReceipt,
        usage,
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode,
        finishedAt: occurredAt,
        receiptReconciled: reconciled && current.owner.view.state === 'unknown',
      },
      commandId,
      state,
      occurredAt,
      context,
    );
    return successForOperation(database, terminal);
  });
}

async function persistOutputBlobs(
  mediaCas: MediaCas,
  outputs: readonly ParsedOutput[],
): Promise<void> {
  for (const output of outputs) {
    const expected = { hash: output.blob.hash, byteLength: output.blob.byteLength };
    if (output.publication.state === 'pending') {
      const persisted = await mediaCas.putVerified(expected, output.publication.bytes);
      if (persisted.hash !== expected.hash || persisted.byteLength !== expected.byteLength) {
        throw corrupt(`Media CAS returned the wrong identity for output ${output.ordinal}`);
      }
    }
    await mediaCas.verify(expected);
  }
}

function publishOutputs(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  outputs: readonly ParsedOutput[],
  receipt: ProviderReceipt | null,
  usage: ProviderUsage | null,
  providerResultWinsCancellation: boolean,
  commandId: string,
  context: TargetCommandContext,
): MediaDeriveSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = mediaOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.state === 'succeeded') return successForOperation(database, current);
    if (current.owner.view.state === 'failed' || current.owner.view.state === 'cancelled') {
      return successForOperation(database, current);
    }
    if (current.owner.view.authority !== 'media_derivation_attempt') {
      throw corrupt(`Media Derivation ${operationId} owner does not match`);
    }
    const derivation = current.owner.view.derivation;
    if (current.owner.view.cancelRequested && !providerResultWinsCancellation) {
      throw new LocalCancellationRace();
    }
    const input = acceptedInput(current);
    assertOutputIntents(input, outputs);
    resolveSource(database, current.dispatch.key.runId, input);
    assertProjectRevision(database, current.dispatch.key.projectId, input);
    if (outputRows(database, current.owner.view.id).length !== 0) {
      throw corrupt(`Nonterminal Media Derivation ${operationId} already has outputs`);
    }
    const external = input.operation === 'transcribe';
    if (external !== (receipt !== null && usage !== null)) {
      throw corrupt(`Media Derivation ${operationId} terminal provider state is incomplete`);
    }
    const terminalReceipt = receipt === null ? null : reconciledReceipt(receipt, occurredAt);
    if (
      current.owner.view.receipt !== null &&
      terminalReceipt !== null &&
      current.owner.view.receipt.receiptHash !== terminalReceipt.receiptHash
    ) {
      throw corrupt(`Media Derivation ${operationId} terminal receipt changed`);
    }
    outputs.forEach((output, index) => {
      const intent = input.outputIntents[index]!;
      const blob = insertOrValidateMediaBlob(database, output.blob, occurredAt);
      const assetWithoutHash = {
        authority: 'global_media_asset' as const,
        id: environment.createId('global_media_asset'),
        revision: 0,
        contentHash: '',
        blobHash: blob.hash,
        kind: blob.technicalFacts.kind,
        filename: intent.globalAsset.filename,
        displayName: intent.globalAsset.displayName,
        source: {
          kind: 'derived' as const,
          derivationId: derivation.id,
          sourceBlobHash: derivation.sourceBlobHash,
        },
        folderId: intent.globalAsset.folderId,
        tags: intent.globalAsset.tags,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      };
      const asset = parseCanonical(GlobalMediaAssetSchema, {
        ...assetWithoutHash,
        contentHash: hashContentObject(assetWithoutHash),
      });
      insertGlobalMediaAsset(database, asset);
      appendProjectEvent(database, {
        eventId: environment.createId('project_event'),
        projectId: current.dispatch.key.projectId,
        occurredAt,
        actor: context.actor,
        subject: { authority: 'global_media_asset', id: asset.id },
        causation: context.causation,
        correlationId: context.correlationId,
        idempotencyKey: internalCommandId(
          commandId,
          current.dispatch.key.fingerprint,
          `asset:${output.ordinal}`,
        ),
        payload: { type: 'object_created', revision: 0, contentHash: asset.contentHash },
      });

      let projectMediaRef: ProjectMediaRef | null = null;
      if (intent.projectMediaRef !== null) {
        const refWithoutHash = {
          authority: 'project_media_ref' as const,
          id: environment.createId('project_media_ref'),
          projectId: current.dispatch.key.projectId,
          globalAssetId: asset.id,
          revision: 0,
          contentHash: '',
          lifecycle: 'active' as const,
          detachedAt: null,
          label: intent.projectMediaRef.label,
          collections: intent.projectMediaRef.collections,
          roles: intent.projectMediaRef.roles,
          notes: intent.projectMediaRef.notes,
          productionLinks: [],
          createdBy: context.causation,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        };
        projectMediaRef = parseCanonical(ProjectMediaRefSchema, {
          ...refWithoutHash,
          contentHash: hashContentObject(refWithoutHash),
        });
        insertProjectMediaRecord(database, projectMediaRef);
        appendProjectEvent(database, {
          eventId: environment.createId('project_event'),
          projectId: projectMediaRef.projectId,
          occurredAt,
          actor: context.actor,
          subject: { authority: 'project_media_ref', id: projectMediaRef.id },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: internalCommandId(
            commandId,
            current.dispatch.key.fingerprint,
            `attachment:${output.ordinal}`,
          ),
          payload: {
            type: 'media_attached',
            projectMediaRefId: projectMediaRef.id,
            globalAssetId: asset.id,
            blobHash: blob.hash,
          },
        });
        upsertProjectSearchDocument(
          database,
          environment,
          projectMediaRef.projectId,
          {
            kind: 'project_media_ref',
            ref: {
              authority: 'project_media_ref',
              id: projectMediaRef.id,
              revision: projectMediaRef.revision,
              contentHash: projectMediaRef.contentHash,
            },
          },
          'current',
          mediaSearchText(projectMediaRef),
          projectMediaRef.updatedAt,
        );
      }
      const persistedOutput = parseCanonical(MediaDerivationOutputSchema, {
        id: environment.createId('media_derivation_output'),
        derivationAttemptId: current.owner.view.id,
        blobHash: blob.hash,
        globalAssetId: asset.id,
        projectMediaRefId: projectMediaRef?.id ?? null,
        ordinal: output.ordinal,
      });
      database
        .prepare(
          `INSERT INTO media_derivation_outputs (
             id, derivation_attempt_id, blob_hash, global_asset_id,
             project_media_ref_id, ordinal
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          persistedOutput.id,
          persistedOutput.derivationAttemptId,
          persistedOutput.blobHash,
          persistedOutput.globalAssetId,
          persistedOutput.projectMediaRefId,
          persistedOutput.ordinal,
        );
    });
    if (usage !== null) settleUnknownCost(database, environment, current, usage, occurredAt);
    const succeeded = transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'succeeded',
        receipt: terminalReceipt,
        usage,
        progressPercent: 100,
        publicErrorCode: null,
        finishedAt: occurredAt,
        receiptReconciled: external && current.owner.view.state === 'unknown',
      },
      commandId,
      'succeeded',
      occurredAt,
      context,
    );
    return successForOperation(database, succeeded);
  });
}

async function callAdapter(
  call: () => Promise<unknown>,
): Promise<unknown | typeof ADAPTER_UNAVAILABLE> {
  try {
    return await call();
  } catch {
    return ADAPTER_UNAVAILABLE;
  }
}

async function cancelLocal(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  adapter: LocalMediaDerivationAdapter,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<MediaDeriveSuccess> {
  const current = mediaOperation(loadBoundOperation(database, operationId));
  if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
    return successForOperation(database, current);
  }
  const result = await callAdapter(() =>
    adapter.cancel(
      {
        idempotencyKey: current.dispatch.key.fingerprint,
        requestHash:
          current.owner.view.authority === 'media_derivation_attempt'
            ? current.owner.view.derivation.requestHash
            : '',
      },
      signal,
    ),
  );
  if (result === ADAPTER_UNAVAILABLE) {
    throw invalid(`Local Media Derivation ${operationId} cancellation is unavailable`);
  }
  parseLocalCancelResult(result);
  return finishTerminal(
    database,
    environment,
    operationId,
    'cancelled',
    'cancelled',
    null,
    null,
    false,
    commandId,
    context,
  );
}

async function continueLocal(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  adapter: LocalMediaDerivationAdapter,
  initial: BoundOperationRecord,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<MediaDeriveSuccess> {
  if (initial.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`Media Derivation ${initial.dispatch.id} owner does not match`);
  }
  const derivation = initial.owner.view.derivation;
  if (initial.owner.view.cancelRequested) {
    return cancelLocal(
      database,
      environment,
      adapter,
      initial.dispatch.id,
      commandId,
      context,
      signal,
    );
  }
  if (initial.owner.view.state !== 'running') {
    throw corrupt(`Local Media Derivation ${initial.dispatch.id} is not running`);
  }
  const input = acceptedInput(initial);
  if (input.operation === 'transcribe') {
    throw corrupt(`Media Derivation ${initial.dispatch.id} is not local`);
  }
  const source = resolveSource(database, initial.dispatch.key.runId, input);
  assertProjectRevision(database, initial.dispatch.key.projectId, input);
  await mediaCas.verify({ hash: source.hash, byteLength: source.byteLength });
  const raw = await callAdapter(() =>
    adapter.derive(
      {
        idempotencyKey: initial.dispatch.key.fingerprint,
        requestHash: derivation.requestHash,
        source: {
          blob: source,
          bytes: mediaCas.openVerified({ hash: source.hash, byteLength: source.byteLength }),
        },
        transform: derivation.transform as LocalMediaDerivationTransform,
        outputCount: input.outputIntents.length,
        cancellationRequested: () => {
          const current = mediaOperation(loadBoundOperation(database, initial.dispatch.id));
          return current.owner.view.cancelRequested;
        },
      },
      signal,
    ),
  );
  if (raw === ADAPTER_UNAVAILABLE) {
    const current = mediaOperation(loadBoundOperation(database, initial.dispatch.id));
    if (current.owner.view.cancelRequested) {
      return cancelLocal(
        database,
        environment,
        adapter,
        initial.dispatch.id,
        commandId,
        context,
        signal,
      );
    }
    return finishTerminal(
      database,
      environment,
      initial.dispatch.id,
      'failed',
      'execution_failed',
      null,
      null,
      false,
      commandId,
      context,
    );
  }
  const outputs = parseOutputs(raw, 'Local Media Derivation adapter');
  assertOutputIntents(input, outputs);
  await persistOutputBlobs(mediaCas, outputs);
  const beforeCommit = mediaOperation(loadBoundOperation(database, initial.dispatch.id));
  if (beforeCommit.owner.view.cancelRequested) {
    return cancelLocal(
      database,
      environment,
      adapter,
      initial.dispatch.id,
      commandId,
      context,
      signal,
    );
  }
  try {
    return publishOutputs(
      database,
      environment,
      initial.dispatch.id,
      outputs,
      null,
      null,
      false,
      commandId,
      context,
    );
  } catch (cause) {
    if (!(cause instanceof LocalCancellationRace)) throw cause;
    return cancelLocal(
      database,
      environment,
      adapter,
      initial.dispatch.id,
      commandId,
      context,
      signal,
    );
  }
}

async function processProviderState(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  operationId: string,
  state: TranscriptionProviderState,
  commandId: string,
  context: TargetCommandContext,
): Promise<MediaDeriveSuccess> {
  let current = mediaOperation(loadBoundOperation(database, operationId));
  if (state.state === 'not_submitted') {
    return finishTerminal(
      database,
      environment,
      operationId,
      current.owner.view.cancelRequested ? 'cancelled' : 'failed',
      current.owner.view.cancelRequested ? 'cancelled' : 'provider_failed',
      null,
      null,
      true,
      commandId,
      context,
    );
  }
  if (state.receipt !== null) {
    current = persistReceipt(database, environment, operationId, state.receipt, true);
  }
  if (state.state === 'unknown') {
    return markUnknown(database, environment, operationId, commandId, context);
  }
  if (state.state === 'submitted') {
    return markSubmitted(database, environment, operationId, commandId, context);
  }
  if (state.state === 'succeeded') {
    const outputs = parseOutputs(state.outputs, 'Transcription provider');
    await persistOutputBlobs(mediaCas, outputs);
    return publishOutputs(
      database,
      environment,
      operationId,
      outputs,
      state.receipt,
      state.usage,
      true,
      commandId,
      context,
    );
  }
  return finishTerminal(
    database,
    environment,
    operationId,
    state.state,
    state.state === 'cancelled' ? 'cancelled' : state.publicErrorCode,
    state.receipt,
    state.usage,
    true,
    commandId,
    context,
  );
}

async function reconcileOrCancel(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  adapter: TranscriptionProviderAdapter,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<MediaDeriveSuccess> {
  const current = mediaOperation(loadBoundOperation(database, operationId));
  if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
    return successForOperation(database, current);
  }
  if (current.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`Media Derivation ${operationId} owner does not match`);
  }
  const profile = acceptedProfile(database, current, adapter);
  const request = {
    idempotencyKey: current.dispatch.key.fingerprint,
    requestHash: current.owner.view.derivation.requestHash,
    profile,
  };
  const raw =
    current.owner.view.cancelRequested && current.owner.view.receipt !== null
      ? await callAdapter(() =>
          adapter.cancel({ ...request, receipt: current.owner.view.receipt! }, signal),
        )
      : await callAdapter(() =>
          adapter.reconcileByIdempotencyKey(
            { ...request, receipt: current.owner.view.receipt },
            signal,
          ),
        );
  if (raw === ADAPTER_UNAVAILABLE) {
    return markUnknown(database, environment, operationId, commandId, context);
  }
  return processProviderState(
    database,
    environment,
    mediaCas,
    operationId,
    parseProviderState(raw),
    commandId,
    context,
  );
}

async function continueTranscription(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  adapter: TranscriptionProviderAdapter,
  initial: BoundOperationRecord,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<MediaDeriveSuccess> {
  if (initial.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`Media Derivation ${initial.dispatch.id} owner does not match`);
  }
  if (initial.owner.view.state === 'unknown' || initial.owner.view.state === 'submitted') {
    return reconcileOrCancel(
      database,
      environment,
      mediaCas,
      adapter,
      initial.dispatch.id,
      commandId,
      context,
      signal,
    );
  }
  if (initial.owner.view.state !== 'running') {
    throw corrupt(`Transcription ${initial.dispatch.id} is not continuable`);
  }
  if (initial.owner.view.cancelRequested) {
    return finishTerminal(
      database,
      environment,
      initial.dispatch.id,
      'cancelled',
      'cancelled',
      null,
      null,
      false,
      commandId,
      context,
    );
  }
  const input = acceptedInput(initial);
  if (input.operation !== 'transcribe') {
    throw corrupt(`Media Derivation ${initial.dispatch.id} is not a transcription`);
  }
  const profile = acceptedProfile(database, initial, adapter);
  const source = resolveSource(database, initial.dispatch.key.runId, input);
  assertProjectRevision(database, initial.dispatch.key.projectId, input);
  await mediaCas.verify({ hash: source.hash, byteLength: source.byteLength });
  markUnknown(database, environment, initial.dispatch.id, commandId, context);
  const claimed = mediaOperation(loadBoundOperation(database, initial.dispatch.id));
  if (claimed.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`Media Derivation ${claimed.dispatch.id} owner does not match`);
  }
  const claimedDerivation = claimed.owner.view.derivation;
  if (claimed.owner.view.cancelRequested) {
    return reconcileOrCancel(
      database,
      environment,
      mediaCas,
      adapter,
      claimed.dispatch.id,
      commandId,
      context,
      signal,
    );
  }
  const raw = await callAdapter(() =>
    adapter.submit(
      {
        idempotencyKey: claimed.dispatch.key.fingerprint,
        requestHash: claimedDerivation.requestHash,
        profile,
        source: {
          blob: source,
          bytes: mediaCas.openVerified({ hash: source.hash, byteLength: source.byteLength }),
        },
        transform: claimedDerivation.transform as TranscriptionTransform,
      },
      signal,
    ),
  );
  if (raw === ADAPTER_UNAVAILABLE) {
    return successForOperation(
      database,
      mediaOperation(loadBoundOperation(database, claimed.dispatch.id)),
    );
  }
  const submitted = parseProviderState(raw);
  if (submitted.state !== 'not_submitted' && submitted.receipt !== null) {
    persistReceipt(database, environment, claimed.dispatch.id, submitted.receipt, false);
  }
  return reconcileOrCancel(
    database,
    environment,
    mediaCas,
    adapter,
    claimed.dispatch.id,
    commandId,
    context,
    signal,
  );
}

export function createMediaDerivationsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  localAdapter: LocalMediaDerivationAdapter,
  transcriptionAdapter: TranscriptionProviderAdapter,
): MediaDerivationsAuthority {
  const database = () => getTargetStoreDatabase(store);
  return Object.freeze({
    async start(inputValue: StartMediaDerivationInput, contextValue: TargetCommandContext) {
      let commandId: string;
      let dispatchOperationId: string | undefined;
      let context: TargetCommandContext;
      try {
        commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
        dispatchOperationId =
          inputValue.dispatchOperationId === undefined
            ? undefined
            : parseCanonical(EntityIdSchema, inputValue.dispatchOperationId);
        context = parseCanonical(TargetCommandContextSchema, contextValue);
      } catch {
        throw invalid('Media Derivation start context is invalid');
      }
      const key = resolveOperationDispatchKey(database(), {
        runId: inputValue.runId,
        toolId: 'media.derive',
        input: inputValue.input,
      });
      const replay = replayForKey(database(), key, dispatchOperationId);
      if (replay !== undefined) return replay;
      const input = parseInput(key.input);
      const run = loadRun(database(), key.runId);
      assertMediaDeriveModelBoundary(database(), run, input);
      const source = resolveSource(database(), run.id, input);
      const profile =
        input.operation === 'transcribe'
          ? providerProfile(database(), run, input, transcriptionAdapter)
          : null;
      await mediaCas.verify({ hash: source.hash, byteLength: source.byteLength });
      const prepared = prepareOperation(
        database(),
        environment,
        transcriptionAdapter,
        key,
        input,
        source,
        profile,
        commandId,
        context,
        dispatchOperationId,
      );
      return successForOperation(database(), prepared.bound);
    },

    async continue(
      inputValue: ContinueMediaDerivationInput,
      contextValue: TargetCommandContext,
      signal?: AbortSignal,
    ) {
      let operationId: string;
      let commandId: string;
      let context: TargetCommandContext;
      try {
        operationId = parseCanonical(EntityIdSchema, inputValue.dispatchOperationId);
        commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
        context = parseCanonical(TargetCommandContextSchema, contextValue);
      } catch {
        throw invalid('Media Derivation continuation context is invalid');
      }
      const initial = mediaOperation(loadBoundOperation(database(), operationId));
      if (['succeeded', 'failed', 'cancelled'].includes(initial.owner.view.state)) {
        return successForOperation(database(), initial);
      }
      return initial.owner.view.authority === 'media_derivation_attempt' &&
        initial.owner.view.derivation.transform.operation === 'transcribe'
        ? continueTranscription(
            database(),
            environment,
            mediaCas,
            transcriptionAdapter,
            initial,
            commandId,
            context,
            signal,
          )
        : continueLocal(
            database(),
            environment,
            mediaCas,
            localAdapter,
            initial,
            commandId,
            context,
            signal,
          );
    },
  });
}
