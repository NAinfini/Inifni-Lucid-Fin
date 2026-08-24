import {
  CausationRefSchema,
  DeliveryDestinationIntentSchema,
  DeliveryExportSchema,
  DeliveryFormatIntentSchema,
  DeliveryManifestSchema,
  DomainObjectRefSchema,
  EvaluationInputSchema,
  FinalAssessmentSchema,
  GeneratedResultSchema,
  GenerationAttemptViewSchema,
  GenerationQuoteSchema,
  GenerationReferenceBindingSchema,
  GenerationRequestSchema,
  GenerationSpecSchema,
  GenerationSubmitInputSchema,
  MediaDerivationAttemptViewSchema,
  MediaDeriveInputSchema,
  MediaDerivationOutputSchema,
  MediaDerivationSchema,
  MediaDerivationTransformSchema,
  OperationPublicViewSchema,
  OperationRefSchema,
  PromptAssemblyProvenanceSchema,
  ProviderModelSchema,
  ProviderReceiptSchema,
  ProviderUsageSchema,
  ResultAssessmentAttemptViewSchema,
  ReviewCutAttemptSchema,
  ReviewCutRequestSchema,
  TechnicalValidationSchema,
  assertAttemptCommonTransition,
  canonicalJson,
  deliveryManifestContentHashInput,
  finalAssessmentHashInput,
  generationQuoteHashInput,
  generationRequestHashInput,
  generatedResultContentHashInput,
  mediaDerivationRequestHashInput,
  parseCanonical,
  providerReceiptHashInput,
  type DomainObjectRef,
  type GeneratedResult,
  type AttemptCommon,
  type AttemptState,
  type OperationPublicErrorCode,
  type OperationPublicView,
  type OperationRef,
  type ProviderReceipt,
  type ProviderUsage,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { decodeCanonicalRecord, decodeProtectedFieldRef } from './canonical-codecs.js';
import { hashCanonical, hashContentObject } from './hashes.js';
import {
  artifactForMediaBlob,
  loadGlobalMediaAsset,
  loadProjectMediaRecord,
} from './media-records.js';

export type OperationOwnerAuthority = OperationRef['ownerRef']['authority'];
export type OperationOwnerView =
  | z.output<typeof GenerationAttemptViewSchema>
  | z.output<typeof MediaDerivationAttemptViewSchema>
  | z.output<typeof ResultAssessmentAttemptViewSchema>
  | z.output<typeof ReviewCutAttemptSchema>
  | z.output<typeof DeliveryExportSchema>;

export interface OperationOwnerRecord {
  readonly authority: OperationOwnerAuthority;
  readonly projectId: string;
  readonly runId: string;
  readonly view: OperationOwnerView;
}

interface GenerationAttemptRow {
  id: string;
  request_id: string;
  attempt_number: number;
  revision: number;
  content_hash: string;
  state: OperationOwnerView['state'];
  provider_profile_id: string;
  provider_v1_json: string;
  quote_v1_json: string | null;
  provider_operation_id: string | null;
  receipt_v1_json: string | null;
  usage_v1_json: string | null;
  prompt_provenance_v1_json: string;
  cancel_requested: number;
  progress_percent: number | null;
  public_error_code: OperationOwnerView['publicErrorCode'];
  created_at: string;
  finished_at: string | null;
  project_id: string;
  run_id: string;
  target_authority: string;
  target_id: string;
  target_revision: number;
  target_hash: string;
  spec_v1_json: string;
  request_hash: string;
  request_idempotency_key: string;
  request_created_at: string;
}

interface MediaDerivationAttemptRow {
  id: string;
  derivation_id: string;
  attempt_number: number;
  revision: number;
  content_hash: string;
  state: OperationOwnerView['state'];
  provider_profile_id: string | null;
  provider_v1_json: string | null;
  provider_operation_id: string | null;
  receipt_v1_json: string | null;
  usage_v1_json: string | null;
  cancel_requested: number;
  progress_percent: number | null;
  public_error_code: OperationOwnerView['publicErrorCode'];
  created_at: string;
  finished_at: string | null;
  project_id: string;
  run_id: string;
  source_blob_hash: string;
  transform_v1_json: string;
  request_hash: string;
  derivation_idempotency_key: string;
  derivation_created_at: string;
}

interface GeneratedResultRow {
  id: string;
  project_id: string;
  request_id: string;
  attempt_id: string;
  revision: number;
  content_hash: string;
  blob_hash: string;
  global_asset_id: string;
  project_media_ref_id: string;
  media_kind: 'image' | 'video' | 'audio';
  variant_index: number;
  submitted_prompt: string;
  submitted_negative_prompt: string | null;
  prompt_provenance_v1_json: string;
  reference_bindings_v1_json: string;
  provider_v1_json: string;
  seed: number | null;
  receipt_v1_json: string;
  usage_v1_json: string;
  technical_validation_v1_json: string;
  created_at: string;
  run_id: string;
  target_id: string;
  target_revision: number;
  target_hash: string;
  request_spec_v1_json: string;
  request_hash: string;
}

interface ResultAssessmentAttemptRow {
  id: string;
  project_id: string;
  run_id: string;
  revision: number;
  content_hash: string;
  assessment_kind: string;
  request_v1_json: string;
  state: OperationOwnerView['state'];
  provider_profile_id: string | null;
  provider_v1_json: string | null;
  provider_operation_id: string | null;
  receipt_v1_json: string | null;
  usage_v1_json: string | null;
  request_hash: string;
  idempotency_key: string;
  cancel_requested: number;
  progress_percent: number | null;
  public_error_code: OperationOwnerView['publicErrorCode'];
  created_at: string;
  finished_at: string | null;
  assessment_v1_json: string | null;
  assessment_content_hash: string | null;
}

interface LocalAttemptRow {
  id: string;
  project_id: string;
  run_id: string;
  revision: number;
  content_hash: string;
  state: OperationOwnerView['state'];
  request_hash: string;
  idempotency_key: string;
  cancel_requested: number;
  progress_percent: number | null;
  public_error_code: OperationOwnerView['publicErrorCode'];
  output_blob_hash: string | null;
  created_at: string;
  finished_at: string | null;
}

interface ReviewCutRow extends LocalAttemptRow {
  delivery_manifest_id: string;
  delivery_manifest_revision: number;
  delivery_manifest_hash: string;
  request_v1_json: string;
  manifest_project_id: string;
  stored_manifest_revision: number;
  stored_manifest_hash: string;
}

interface DeliveryExportRow extends LocalAttemptRow {
  delivery_manifest_id: string;
  delivery_manifest_revision: number;
  delivery_manifest_hash: string;
  destination_kind: 'user_selected_file' | 'user_selected_folder';
  destination_grant_id: string;
  destination_grant_hash: string;
  destination_display_label: string;
  overwrite_existing: number;
  output_content_hash: string | null;
  manifest_project_id: string;
  stored_manifest_revision: number;
  stored_manifest_hash: string;
}

interface DeliveryManifestRow {
  id: string;
  project_id: string;
  delivery_plan_id: string;
  delivery_revision: number;
  delivery_content_hash: string;
  revision: number;
  content_hash: string;
  format_intent_v1_json: string;
  created_by_v1_json: string;
  frozen_at: string;
  delivery_project_id: string;
}

interface DeliveryManifestItemRow {
  delivery_item_id: string;
  delivery_item_revision: number;
  delivery_item_content_hash: string;
  shot_id: string;
  shot_revision: number;
  shot_content_hash: string;
  generated_result_id: string;
  generated_result_revision: number;
  generated_result_content_hash: string;
  project_media_ref_id: string;
  project_media_revision: number;
  project_media_content_hash: string;
  global_asset_id: string;
  global_asset_revision: number;
  global_asset_content_hash: string;
  blob_hash: string;
  ordinal: number;
  trim_start_ms: number;
  trim_end_ms: number;
  audio_policy: string;
  transition_kind: string;
  transition_duration_ms: number;
  review_state: string;
}

interface DeliveryManifestChoiceRow {
  delivery_item_id: string | null;
  field_ref: string;
  choice_id: string;
  choice_hash: string;
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function storedBoolean(label: string, value: number): boolean {
  if (value !== 0 && value !== 1) throw corrupt(`${label} is not a stored boolean`);
  return value === 1;
}

function parseStored<Schema extends z.ZodType>(
  label: string,
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  try {
    return parseCanonical(schema, value);
  } catch (cause) {
    throw corrupt(`${label} is invalid`, cause);
  }
}

function nullableRecord<Schema extends z.ZodType>(
  label: string,
  schema: Schema,
  json: string | null,
): z.output<Schema> | null {
  return json === null ? null : decodeCanonicalRecord(label, schema, json);
}

function assertProviderBinding(
  label: string,
  providerProfileId: string | null,
  provider: z.output<typeof ProviderModelSchema> | null,
  providerOperationId: string | null,
  receipt: z.output<typeof ProviderReceiptSchema> | null,
): void {
  if ((providerProfileId === null) !== (provider === null)) {
    throw corrupt(`${label} provider columns are inconsistent`);
  }
  if (provider !== null && provider.providerId !== providerProfileId) {
    throw corrupt(`${label} provider does not match its Provider Profile`);
  }
  if ((providerOperationId === null) !== (receipt === null)) {
    throw corrupt(`${label} provider receipt columns are inconsistent`);
  }
  if (receipt !== null) {
    if (receipt.providerOperationId !== providerOperationId) {
      throw corrupt(`${label} receipt does not match its provider operation`);
    }
    if (hashCanonical(providerReceiptHashInput(receipt)) !== receipt.receiptHash) {
      throw corrupt(`${label} provider receipt hash does not match`);
    }
  }
}

function assertOwnerHash(owner: OperationOwnerView): void {
  if (hashContentObject(owner) !== owner.contentHash) {
    throw corrupt(`${owner.authority}:${owner.id} content hash does not match`);
  }
}

export function loadGenerationOwner(database: DatabaseSync, id: string): OperationOwnerRecord {
  const row = database
    .prepare(
      `SELECT attempt.*,
              request.project_id, request.run_id, request.target_authority, request.target_id,
              request.target_revision, request.target_hash, request.spec_v1_json,
              request.request_hash, request.idempotency_key AS request_idempotency_key,
              request.created_at AS request_created_at
       FROM generation_attempts AS attempt
       JOIN generation_requests AS request ON request.id = attempt.request_id
       WHERE attempt.id = ?`,
    )
    .get(id) as unknown as GenerationAttemptRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Generation Attempt was not found: ${id}`);
  }
  const spec = decodeCanonicalRecord(
    'Generation Request spec',
    GenerationSpecSchema,
    row.spec_v1_json,
  );
  if (
    row.target_authority !== 'production' ||
    spec.target.id !== row.target_id ||
    spec.target.revision !== row.target_revision ||
    spec.target.contentHash !== row.target_hash ||
    hashCanonical(generationRequestHashInput(spec)) !== row.request_hash
  ) {
    throw corrupt(`Generation Request ${row.request_id} frozen target or hash does not match`);
  }
  const request = parseStored('Generation Request', GenerationRequestSchema, {
    id: row.request_id,
    projectId: row.project_id,
    runId: row.run_id,
    spec,
    requestHash: row.request_hash,
    idempotencyKey: row.request_idempotency_key,
    createdAt: row.request_created_at,
  });
  const provider = decodeCanonicalRecord(
    'Generation Attempt provider',
    ProviderModelSchema,
    row.provider_v1_json,
  );
  const quote = nullableRecord(
    'Generation Attempt quote',
    GenerationQuoteSchema,
    row.quote_v1_json,
  );
  if (quote !== null && hashCanonical(generationQuoteHashInput(quote)) !== quote.quoteHash) {
    throw corrupt(`Generation Attempt ${row.id} quote hash does not match`);
  }
  const receipt = nullableRecord(
    'Generation Attempt receipt',
    ProviderReceiptSchema,
    row.receipt_v1_json,
  );
  assertProviderBinding(
    `Generation Attempt ${row.id}`,
    row.provider_profile_id,
    provider,
    row.provider_operation_id,
    receipt,
  );
  const owner = parseStored('Generation Attempt', GenerationAttemptViewSchema, {
    authority: 'generation_attempt',
    id: row.id,
    requestId: row.request_id,
    attemptNumber: row.attempt_number,
    revision: row.revision,
    contentHash: row.content_hash,
    state: row.state,
    provider,
    quote,
    receipt,
    usage: nullableRecord('Generation Attempt usage', ProviderUsageSchema, row.usage_v1_json),
    promptProvenance: decodeCanonicalRecord(
      'Generation Attempt prompt provenance',
      PromptAssemblyProvenanceSchema,
      row.prompt_provenance_v1_json,
    ),
    cancelRequested: storedBoolean(
      `Generation Attempt ${row.id} cancel_requested`,
      row.cancel_requested,
    ),
    progressPercent: row.progress_percent,
    publicErrorCode: row.public_error_code,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    request,
  });
  assertOwnerHash(owner);
  return {
    authority: 'generation_attempt',
    projectId: row.project_id,
    runId: row.run_id,
    view: owner,
  };
}

function loadMediaDerivationOwner(database: DatabaseSync, id: string): OperationOwnerRecord {
  const row = database
    .prepare(
      `SELECT attempt.*,
              derivation.project_id, derivation.run_id, derivation.source_blob_hash,
              derivation.transform_v1_json, derivation.request_hash,
              derivation.idempotency_key AS derivation_idempotency_key,
              derivation.created_at AS derivation_created_at
       FROM media_derivation_attempts AS attempt
       JOIN media_derivations AS derivation ON derivation.id = attempt.derivation_id
       WHERE attempt.id = ?`,
    )
    .get(id) as unknown as MediaDerivationAttemptRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Media Derivation Attempt was not found: ${id}`);
  }
  const transform = decodeCanonicalRecord(
    'Media Derivation transform',
    MediaDerivationTransformSchema,
    row.transform_v1_json,
  );
  const derivation = parseStored('Media Derivation', MediaDerivationSchema, {
    authority: 'media_derivation',
    id: row.derivation_id,
    projectId: row.project_id,
    runId: row.run_id,
    sourceBlobHash: row.source_blob_hash,
    transform,
    requestHash: row.request_hash,
    idempotencyKey: row.derivation_idempotency_key,
    createdAt: row.derivation_created_at,
  });
  if (hashCanonical(mediaDerivationRequestHashInput(derivation)) !== derivation.requestHash) {
    throw corrupt(`Media Derivation ${derivation.id} request hash does not match`);
  }
  const provider = nullableRecord(
    'Media Derivation Attempt provider',
    ProviderModelSchema,
    row.provider_v1_json,
  );
  const receipt = nullableRecord(
    'Media Derivation Attempt receipt',
    ProviderReceiptSchema,
    row.receipt_v1_json,
  );
  assertProviderBinding(
    `Media Derivation Attempt ${row.id}`,
    row.provider_profile_id,
    provider,
    row.provider_operation_id,
    receipt,
  );
  const owner = parseStored('Media Derivation Attempt', MediaDerivationAttemptViewSchema, {
    authority: 'media_derivation_attempt',
    id: row.id,
    derivation,
    attemptNumber: row.attempt_number,
    revision: row.revision,
    contentHash: row.content_hash,
    state: row.state,
    provider,
    receipt,
    usage: nullableRecord('Media Derivation Attempt usage', ProviderUsageSchema, row.usage_v1_json),
    cancelRequested: storedBoolean(
      `Media Derivation Attempt ${row.id} cancel_requested`,
      row.cancel_requested,
    ),
    progressPercent: row.progress_percent,
    publicErrorCode: row.public_error_code,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  });
  assertOwnerHash(owner);
  return {
    authority: 'media_derivation_attempt',
    projectId: row.project_id,
    runId: row.run_id,
    view: owner,
  };
}

function attemptCommon(view: OperationOwnerView): AttemptCommon {
  return {
    revision: view.revision,
    contentHash: view.contentHash,
    state: view.state,
    provider: view.provider,
    receipt: view.receipt,
    usage: view.usage,
    cancelRequested: view.cancelRequested,
    progressPercent: view.progressPercent,
    publicErrorCode: view.publicErrorCode,
    createdAt: view.createdAt,
    finishedAt: view.finishedAt,
  };
}

export interface GenerationOwnerTransitionInput {
  readonly state: AttemptState;
  readonly receipt: ProviderReceipt | null;
  readonly usage: ProviderUsage | null;
  readonly progressPercent: number | null;
  readonly publicErrorCode: OperationPublicErrorCode | null;
  readonly finishedAt: string | null;
  readonly receiptReconciled: boolean;
}

export function transitionGenerationOwner(
  database: DatabaseSync,
  before: OperationOwnerRecord,
  input: GenerationOwnerTransitionInput,
): OperationOwnerRecord {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Generation owner transition requires a transaction',
    );
  }
  if (before.authority !== 'generation_attempt' || before.view.authority !== 'generation_attempt') {
    throw new TargetStorageError('INVALID_REQUEST', 'Operation owner is not a Generation Attempt');
  }
  if (
    before.view.receipt !== null &&
    (input.receipt === null ||
      before.view.receipt.providerOperationId !== input.receipt.providerOperationId ||
      before.view.receipt.submittedAt !== input.receipt.submittedAt ||
      before.view.receipt.receiptHash !== input.receipt.receiptHash)
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'Generation provider receipt is immutable');
  }
  if (
    before.view.usage !== null &&
    canonicalJson(before.view.usage) !== canonicalJson(input.usage)
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'Generation provider usage is immutable');
  }
  const withoutHash = {
    ...before.view,
    revision: before.view.revision + 1,
    contentHash: '',
    state: input.state,
    receipt: input.receipt,
    usage: input.usage,
    progressPercent: input.progressPercent,
    publicErrorCode: input.publicErrorCode,
    finishedAt: input.finishedAt,
  };
  const afterView = parseStored('Generation Attempt transition', GenerationAttemptViewSchema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
  try {
    assertAttemptCommonTransition(
      attemptCommon(before.view),
      attemptCommon(afterView),
      input.receiptReconciled,
    );
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Generation transition is invalid', {
      cause,
    });
  }
  const update = database
    .prepare(
      `UPDATE generation_attempts
       SET revision = ?, content_hash = ?, state = ?, provider_operation_id = ?,
           receipt_v1_json = ?, usage_v1_json = ?, progress_percent = ?,
           public_error_code = ?, finished_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
         AND cancel_requested = ?`,
    )
    .run(
      afterView.revision,
      afterView.contentHash,
      afterView.state,
      afterView.receipt?.providerOperationId ?? null,
      afterView.receipt === null ? null : canonicalJson(afterView.receipt),
      afterView.usage === null ? null : canonicalJson(afterView.usage),
      afterView.progressPercent,
      afterView.publicErrorCode,
      afterView.finishedAt,
      before.view.id,
      before.view.revision,
      before.view.contentHash,
      before.view.state,
      before.view.cancelRequested ? 1 : 0,
    );
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Generation Attempt ${before.view.id} changed concurrently`,
    );
  }
  const after = loadGenerationOwner(database, before.view.id);
  if (canonicalJson(after.view) !== canonicalJson(afterView)) {
    throw corrupt(`Generation Attempt ${before.view.id} transition did not persist exactly`);
  }
  return after;
}

export interface ResultAssessmentOwnerTransitionInput {
  readonly state: AttemptState;
  readonly receipt: ProviderReceipt | null;
  readonly usage: ProviderUsage | null;
  readonly progressPercent: number | null;
  readonly publicErrorCode: OperationPublicErrorCode | null;
  readonly finishedAt: string | null;
  readonly receiptReconciled: boolean;
  readonly assessment: z.output<typeof FinalAssessmentSchema> | null;
}

export function transitionResultAssessmentOwner(
  database: DatabaseSync,
  before: OperationOwnerRecord,
  input: ResultAssessmentOwnerTransitionInput,
): OperationOwnerRecord {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Result Assessment owner transition requires a transaction',
    );
  }
  if (
    before.authority !== 'result_assessment_attempt' ||
    before.view.authority !== 'result_assessment_attempt'
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Operation owner is not a Result Assessment Attempt',
    );
  }
  if (
    before.view.receipt !== null &&
    (input.receipt === null ||
      before.view.receipt.providerOperationId !== input.receipt.providerOperationId ||
      before.view.receipt.submittedAt !== input.receipt.submittedAt ||
      before.view.receipt.receiptHash !== input.receipt.receiptHash)
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Result Assessment provider receipt is immutable',
    );
  }
  if (
    before.view.usage !== null &&
    canonicalJson(before.view.usage) !== canonicalJson(input.usage)
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Result Assessment provider usage is immutable',
    );
  }
  if (
    before.view.assessment !== null &&
    canonicalJson(before.view.assessment) !== canonicalJson(input.assessment)
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'Final Assessment is immutable');
  }
  const withoutHash = {
    ...before.view,
    revision: before.view.revision + 1,
    contentHash: '',
    state: input.state,
    receipt: input.receipt,
    usage: input.usage,
    progressPercent: input.progressPercent,
    publicErrorCode: input.publicErrorCode,
    finishedAt: input.finishedAt,
    assessment: input.assessment,
  };
  const afterView = parseStored(
    'Result Assessment Attempt transition',
    ResultAssessmentAttemptViewSchema,
    {
      ...withoutHash,
      contentHash: hashContentObject(withoutHash),
    },
  );
  try {
    assertAttemptCommonTransition(
      attemptCommon(before.view),
      attemptCommon(afterView),
      input.receiptReconciled,
    );
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Result Assessment transition is invalid', {
      cause,
    });
  }
  const update = database
    .prepare(
      `UPDATE result_assessment_attempts
       SET revision = ?, content_hash = ?, state = ?, provider_operation_id = ?,
           receipt_v1_json = ?, usage_v1_json = ?, progress_percent = ?,
           public_error_code = ?, finished_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
         AND cancel_requested = ?`,
    )
    .run(
      afterView.revision,
      afterView.contentHash,
      afterView.state,
      afterView.receipt?.providerOperationId ?? null,
      afterView.receipt === null ? null : canonicalJson(afterView.receipt),
      afterView.usage === null ? null : canonicalJson(afterView.usage),
      afterView.progressPercent,
      afterView.publicErrorCode,
      afterView.finishedAt,
      before.view.id,
      before.view.revision,
      before.view.contentHash,
      before.view.state,
      before.view.cancelRequested ? 1 : 0,
    );
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Result Assessment Attempt ${before.view.id} changed concurrently`,
    );
  }
  const after = loadAssessmentOwner(database, before.view.id);
  if (canonicalJson(after.view) !== canonicalJson(afterView)) {
    throw corrupt(`Result Assessment Attempt ${before.view.id} transition did not persist exactly`);
  }
  return after;
}

export interface MediaDerivationOwnerTransitionInput {
  readonly state: AttemptState;
  readonly receipt: ProviderReceipt | null;
  readonly usage: ProviderUsage | null;
  readonly progressPercent: number | null;
  readonly publicErrorCode: OperationPublicErrorCode | null;
  readonly finishedAt: string | null;
  readonly receiptReconciled: boolean;
}

export function transitionMediaDerivationOwner(
  database: DatabaseSync,
  before: OperationOwnerRecord,
  input: MediaDerivationOwnerTransitionInput,
): OperationOwnerRecord {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Media Derivation owner transition requires a transaction',
    );
  }
  if (before.authority !== 'media_derivation_attempt') {
    throw new TargetStorageError('INVALID_REQUEST', 'Operation owner is not a Media Derivation');
  }
  if (before.view.authority !== 'media_derivation_attempt') {
    throw new TargetStorageError('INVALID_REQUEST', 'Media Derivation owner view is invalid');
  }
  const external = before.view.derivation.transform.operation === 'transcribe';
  if (
    !external &&
    (input.receipt !== null ||
      input.usage !== null ||
      input.state === 'submitted' ||
      input.state === 'unknown')
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Local Media Derivation cannot contain provider state',
    );
  }
  if (
    before.view.receipt !== null &&
    (input.receipt === null ||
      before.view.receipt.providerOperationId !== input.receipt.providerOperationId ||
      before.view.receipt.submittedAt !== input.receipt.submittedAt ||
      before.view.receipt.receiptHash !== input.receipt.receiptHash)
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Media Derivation provider receipt is immutable',
    );
  }
  if (
    before.view.usage !== null &&
    canonicalJson(before.view.usage) !== canonicalJson(input.usage)
  ) {
    throw new TargetStorageError('INVALID_REQUEST', 'Media Derivation provider usage is immutable');
  }
  const withoutHash = {
    ...before.view,
    revision: before.view.revision + 1,
    contentHash: '',
    state: input.state,
    receipt: input.receipt,
    usage: input.usage,
    progressPercent: input.progressPercent,
    publicErrorCode: input.publicErrorCode,
    finishedAt: input.finishedAt,
  };
  const afterView = parseStored(
    'Media Derivation Attempt transition',
    MediaDerivationAttemptViewSchema,
    {
      ...withoutHash,
      contentHash: hashContentObject(withoutHash),
    },
  );
  try {
    assertAttemptCommonTransition(
      attemptCommon(before.view),
      attemptCommon(afterView),
      input.receiptReconciled,
    );
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Media Derivation transition is invalid', {
      cause,
    });
  }
  const update = database
    .prepare(
      `UPDATE media_derivation_attempts
       SET revision = ?, content_hash = ?, state = ?, provider_operation_id = ?,
           receipt_v1_json = ?, usage_v1_json = ?, progress_percent = ?,
           public_error_code = ?, finished_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
         AND cancel_requested = ?`,
    )
    .run(
      afterView.revision,
      afterView.contentHash,
      afterView.state,
      afterView.receipt?.providerOperationId ?? null,
      afterView.receipt === null ? null : canonicalJson(afterView.receipt),
      afterView.usage === null ? null : canonicalJson(afterView.usage),
      afterView.progressPercent,
      afterView.publicErrorCode,
      afterView.finishedAt,
      before.view.id,
      before.view.revision,
      before.view.contentHash,
      before.view.state,
      before.view.cancelRequested ? 1 : 0,
    );
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Media Derivation Attempt ${before.view.id} changed concurrently`,
    );
  }
  const after = loadOperationOwnerRecord(database, before.authority, before.view.id);
  if (canonicalJson(after.view) !== canonicalJson(afterView)) {
    throw corrupt(`Media Derivation Attempt ${before.view.id} transition did not persist exactly`);
  }
  return after;
}

export interface LocalDeliveryOwnerTransitionInput {
  readonly state: Extract<AttemptState, 'running' | 'succeeded' | 'failed' | 'cancelled'>;
  readonly progressPercent: number | null;
  readonly publicErrorCode: OperationPublicErrorCode | null;
  readonly outputBlobHash: string | null;
  readonly outputContentHash: string | null;
  readonly finishedAt: string | null;
}

function localDeliveryViewWithHash(
  before: OperationOwnerRecord,
  input: LocalDeliveryOwnerTransitionInput,
): z.output<typeof ReviewCutAttemptSchema> | z.output<typeof DeliveryExportSchema> {
  const common = {
    ...before.view,
    revision: before.view.revision + 1,
    contentHash: '',
    state: input.state,
    progressPercent: input.progressPercent,
    publicErrorCode: input.publicErrorCode,
    outputBlobHash: input.outputBlobHash,
    finishedAt: input.finishedAt,
  };
  const withoutHash =
    before.authority === 'delivery_export'
      ? { ...common, outputContentHash: input.outputContentHash }
      : common;
  const schema =
    before.authority === 'delivery_export' ? DeliveryExportSchema : ReviewCutAttemptSchema;
  return parseStored('Local Delivery owner transition', schema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
}

export function transitionLocalDeliveryOwner(
  database: DatabaseSync,
  before: OperationOwnerRecord,
  input: LocalDeliveryOwnerTransitionInput,
): OperationOwnerRecord {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Local Delivery owner transition requires a transaction',
    );
  }
  if (before.authority !== 'review_cut_attempt' && before.authority !== 'delivery_export') {
    throw new TargetStorageError('INVALID_REQUEST', 'Operation owner is not local Delivery work');
  }
  if (before.authority === 'review_cut_attempt' && input.outputContentHash !== null) {
    throw new TargetStorageError('INVALID_REQUEST', 'Review Cut cannot store an export hash');
  }
  const afterView = localDeliveryViewWithHash(before, input);
  try {
    assertAttemptCommonTransition(attemptCommon(before.view), attemptCommon(afterView), false);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Local Delivery transition is invalid', {
      cause,
    });
  }
  const table =
    before.authority === 'review_cut_attempt' ? 'review_cut_attempts' : 'delivery_exports';
  const outputContentAssignment =
    before.authority === 'delivery_export' ? ', output_content_hash = ?' : '';
  const parameters = [
    afterView.revision,
    afterView.contentHash,
    afterView.state,
    afterView.progressPercent,
    afterView.publicErrorCode,
    afterView.outputBlobHash,
    ...(before.authority === 'delivery_export'
      ? [(afterView as z.output<typeof DeliveryExportSchema>).outputContentHash]
      : []),
    afterView.finishedAt,
    before.view.id,
    before.view.revision,
    before.view.contentHash,
    before.view.state,
    before.view.cancelRequested ? 1 : 0,
  ];
  const update = database
    .prepare(
      `UPDATE ${table}
       SET revision = ?, content_hash = ?, state = ?, progress_percent = ?,
           public_error_code = ?, output_blob_hash = ?${outputContentAssignment}, finished_at = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
         AND cancel_requested = ?`,
    )
    .run(...parameters);
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Local Delivery owner ${before.view.id} changed concurrently`,
    );
  }
  const after = loadOperationOwnerRecord(database, before.authority, before.view.id);
  if (canonicalJson(after.view) !== canonicalJson(afterView)) {
    throw corrupt(`Local Delivery owner ${before.view.id} transition did not persist exactly`);
  }
  return after;
}

export function claimLocalDeliveryOwner(
  database: DatabaseSync,
  before: OperationOwnerRecord,
): OperationOwnerRecord {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Local Delivery owner claim requires a transaction',
    );
  }
  if (before.authority !== 'review_cut_attempt' && before.authority !== 'delivery_export') {
    throw new TargetStorageError('INVALID_REQUEST', 'Operation owner is not local Delivery work');
  }
  const withoutHash = {
    ...before.view,
    revision: before.view.revision + 1,
    contentHash: '',
  };
  const schema =
    before.authority === 'delivery_export' ? DeliveryExportSchema : ReviewCutAttemptSchema;
  const claimed = parseStored('Local Delivery owner claim', schema, {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  });
  const table =
    before.authority === 'review_cut_attempt' ? 'review_cut_attempts' : 'delivery_exports';
  const update = database
    .prepare(
      `UPDATE ${table} SET revision = ?, content_hash = ?
       WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
         AND cancel_requested = ?`,
    )
    .run(
      claimed.revision,
      claimed.contentHash,
      before.view.id,
      before.view.revision,
      before.view.contentHash,
      before.view.state,
      before.view.cancelRequested ? 1 : 0,
    );
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Local Delivery owner ${before.view.id} changed before adapter cancellation`,
    );
  }
  const after = loadOperationOwnerRecord(database, before.authority, before.view.id);
  if (canonicalJson(after.view) !== canonicalJson(claimed)) {
    throw corrupt(`Local Delivery owner ${before.view.id} claim did not persist exactly`);
  }
  return after;
}

function assessmentSubjects(
  database: DatabaseSync,
  attemptId: string,
): Array<{
  role: 'subject' | 'reference';
  ref: DomainObjectRef;
}> {
  const rows = database
    .prepare(
      `SELECT role, ordinal, authority, object_id, revision, content_hash
       FROM result_assessment_subjects
       WHERE attempt_id = ?
       ORDER BY CASE role WHEN 'subject' THEN 0 ELSE 1 END, ordinal`,
    )
    .all(attemptId) as unknown as Array<{
    role: 'subject' | 'reference';
    ordinal: number;
    authority: DomainObjectRef['authority'];
    object_id: string;
    revision: number;
    content_hash: string;
  }>;
  const nextOrdinal = { subject: 0, reference: 0 };
  return rows.map((row) => {
    if (row.ordinal !== nextOrdinal[row.role]) {
      throw corrupt(`Result Assessment ${attemptId} ${row.role} ordinals are not contiguous`);
    }
    nextOrdinal[row.role] += 1;
    return {
      role: row.role,
      ref: parseStored('Result Assessment subject', DomainObjectRefSchema, {
        authority: row.authority,
        id: row.object_id,
        revision: row.revision,
        contentHash: row.content_hash,
      }),
    };
  });
}

function loadAssessmentOwner(database: DatabaseSync, id: string): OperationOwnerRecord {
  const row = database
    .prepare(
      `SELECT attempt.*, assessment.assessment_v1_json,
              assessment.content_hash AS assessment_content_hash
       FROM result_assessment_attempts AS attempt
       LEFT JOIN result_assessments AS assessment ON assessment.attempt_id = attempt.id
       WHERE attempt.id = ?`,
    )
    .get(id) as unknown as ResultAssessmentAttemptRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Result Assessment Attempt was not found: ${id}`);
  }
  const request = decodeCanonicalRecord(
    'Result Assessment Request',
    EvaluationInputSchema,
    row.request_v1_json,
  );
  if (request.kind !== row.assessment_kind || hashCanonical(request) !== row.request_hash) {
    throw corrupt(`Result Assessment Attempt ${row.id} request hash or kind does not match`);
  }
  const persistedSubjects = assessmentSubjects(database, row.id);
  const expectedSubjects = [
    ...request.subjects.map((ref) => ({ role: 'subject' as const, ref })),
    ...(request.kind === 'reference_similarity'
      ? request.references.map((ref) => ({ role: 'reference' as const, ref }))
      : []),
  ];
  if (canonicalJson(persistedSubjects) !== canonicalJson(expectedSubjects)) {
    throw corrupt(`Result Assessment Attempt ${row.id} frozen subjects do not match its Request`);
  }
  if ((row.assessment_v1_json === null) !== (row.assessment_content_hash === null)) {
    throw corrupt(`Result Assessment Attempt ${row.id} final assessment columns are incomplete`);
  }
  const assessment = nullableRecord(
    'Final Assessment',
    FinalAssessmentSchema,
    row.assessment_v1_json,
  );
  if (
    assessment !== null &&
    (assessment.assessmentHash !== row.assessment_content_hash ||
      hashCanonical(finalAssessmentHashInput(assessment)) !== assessment.assessmentHash)
  ) {
    throw corrupt(`Result Assessment Attempt ${row.id} final assessment hash does not match`);
  }
  const provider = nullableRecord(
    'Result Assessment Attempt provider',
    ProviderModelSchema,
    row.provider_v1_json,
  );
  const receipt = nullableRecord(
    'Result Assessment Attempt receipt',
    ProviderReceiptSchema,
    row.receipt_v1_json,
  );
  assertProviderBinding(
    `Result Assessment Attempt ${row.id}`,
    row.provider_profile_id,
    provider,
    row.provider_operation_id,
    receipt,
  );
  const owner = parseStored('Result Assessment Attempt', ResultAssessmentAttemptViewSchema, {
    authority: 'result_assessment_attempt',
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    revision: row.revision,
    contentHash: row.content_hash,
    request,
    requestHash: row.request_hash,
    idempotencyKey: row.idempotency_key,
    state: row.state,
    provider,
    receipt,
    usage: nullableRecord(
      'Result Assessment Attempt usage',
      ProviderUsageSchema,
      row.usage_v1_json,
    ),
    cancelRequested: storedBoolean(
      `Result Assessment Attempt ${row.id} cancel_requested`,
      row.cancel_requested,
    ),
    progressPercent: row.progress_percent,
    publicErrorCode: row.public_error_code,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    assessment,
  });
  assertOwnerHash(owner);
  return {
    authority: 'result_assessment_attempt',
    projectId: row.project_id,
    runId: row.run_id,
    view: owner,
  };
}

function loadReviewCutOwner(database: DatabaseSync, id: string): OperationOwnerRecord {
  const row = database
    .prepare(
      `SELECT attempt.*, manifest.project_id AS manifest_project_id,
              manifest.revision AS stored_manifest_revision,
              manifest.content_hash AS stored_manifest_hash
       FROM review_cut_attempts AS attempt
       JOIN delivery_manifests AS manifest ON manifest.id = attempt.delivery_manifest_id
       WHERE attempt.id = ?`,
    )
    .get(id) as unknown as ReviewCutRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Review Cut Attempt was not found: ${id}`);
  }
  if (
    row.manifest_project_id !== row.project_id ||
    row.stored_manifest_revision !== row.delivery_manifest_revision ||
    row.stored_manifest_hash !== row.delivery_manifest_hash
  ) {
    throw corrupt(`Review Cut Attempt ${row.id} Manifest does not match its Project or ref`);
  }
  const manifest = loadDeliveryManifest(database, row.delivery_manifest_id);
  if (
    manifest.projectId !== row.project_id ||
    manifest.revision !== row.delivery_manifest_revision ||
    manifest.contentHash !== row.delivery_manifest_hash
  ) {
    throw corrupt(`Review Cut Attempt ${row.id} frozen Manifest snapshot does not match`);
  }
  const owner = parseStored('Review Cut Attempt', ReviewCutAttemptSchema, {
    authority: 'review_cut_attempt',
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    manifest: {
      authority: 'delivery_manifest',
      id: row.delivery_manifest_id,
      revision: row.delivery_manifest_revision,
      contentHash: row.delivery_manifest_hash,
    },
    request: decodeCanonicalRecord(
      'Review Cut request',
      ReviewCutRequestSchema,
      row.request_v1_json,
    ),
    revision: row.revision,
    contentHash: row.content_hash,
    state: row.state,
    requestHash: row.request_hash,
    idempotencyKey: row.idempotency_key,
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: storedBoolean(
      `Review Cut Attempt ${row.id} cancel_requested`,
      row.cancel_requested,
    ),
    progressPercent: row.progress_percent,
    publicErrorCode: row.public_error_code,
    outputBlobHash: row.output_blob_hash,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  });
  assertOwnerHash(owner);
  return {
    authority: 'review_cut_attempt',
    projectId: row.project_id,
    runId: row.run_id,
    view: owner,
  };
}

function loadDeliveryExportOwner(database: DatabaseSync, id: string): OperationOwnerRecord {
  const row = database
    .prepare(
      `SELECT export.*, manifest.project_id AS manifest_project_id,
              manifest.revision AS stored_manifest_revision,
              manifest.content_hash AS stored_manifest_hash
       FROM delivery_exports AS export
       JOIN delivery_manifests AS manifest ON manifest.id = export.delivery_manifest_id
       WHERE export.id = ?`,
    )
    .get(id) as unknown as DeliveryExportRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Delivery Export was not found: ${id}`);
  }
  if (
    row.manifest_project_id !== row.project_id ||
    row.stored_manifest_revision !== row.delivery_manifest_revision ||
    row.stored_manifest_hash !== row.delivery_manifest_hash
  ) {
    throw corrupt(`Delivery Export ${row.id} Manifest does not match its Project or ref`);
  }
  const manifest = loadDeliveryManifest(database, row.delivery_manifest_id);
  if (
    manifest.projectId !== row.project_id ||
    manifest.revision !== row.delivery_manifest_revision ||
    manifest.contentHash !== row.delivery_manifest_hash
  ) {
    throw corrupt(`Delivery Export ${row.id} frozen Manifest snapshot does not match`);
  }
  const owner = parseStored('Delivery Export', DeliveryExportSchema, {
    authority: 'delivery_export',
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    manifest: {
      authority: 'delivery_manifest',
      id: row.delivery_manifest_id,
      revision: row.delivery_manifest_revision,
      contentHash: row.delivery_manifest_hash,
    },
    destination: parseStored('Delivery destination', DeliveryDestinationIntentSchema, {
      kind: row.destination_kind,
      grantId: row.destination_grant_id,
      grantHash: row.destination_grant_hash,
      displayLabel: row.destination_display_label,
    }),
    overwriteExisting: storedBoolean(
      `Delivery Export ${row.id} overwrite_existing`,
      row.overwrite_existing,
    ),
    revision: row.revision,
    contentHash: row.content_hash,
    state: row.state,
    requestHash: row.request_hash,
    idempotencyKey: row.idempotency_key,
    provider: null,
    receipt: null,
    usage: null,
    cancelRequested: storedBoolean(
      `Delivery Export ${row.id} cancel_requested`,
      row.cancel_requested,
    ),
    progressPercent: row.progress_percent,
    publicErrorCode: row.public_error_code,
    outputBlobHash: row.output_blob_hash,
    outputContentHash: row.output_content_hash,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  });
  assertOwnerHash(owner);
  return {
    authority: 'delivery_export',
    projectId: row.project_id,
    runId: row.run_id,
    view: owner,
  };
}

function loadDeliveryManifestChoices(
  database: DatabaseSync,
  table: 'delivery_manifest_choices' | 'delivery_manifest_protections',
  manifestId: string,
  deliveryId: string,
) {
  const rows = database
    .prepare(
      `SELECT delivery_item_id, field_ref, choice_id, choice_hash
       FROM ${table}
       WHERE delivery_manifest_id = ?
       ORDER BY delivery_item_id, field_ref, choice_id`,
    )
    .all(manifestId) as unknown as DeliveryManifestChoiceRow[];
  return rows.map((row) => {
    const field = decodeProtectedFieldRef(row.field_ref);
    if (
      field.owner !== 'delivery' ||
      field.deliveryId !== deliveryId ||
      field.itemId !== row.delivery_item_id
    ) {
      throw corrupt(`Delivery Manifest ${manifestId} field snapshot does not match its owner`);
    }
    return {
      field,
      choice: {
        authority: 'user_choice' as const,
        id: row.choice_id,
        choiceHash: row.choice_hash,
      },
    };
  });
}

export function loadDeliveryManifest(
  database: DatabaseSync,
  manifestId: string,
): z.output<typeof DeliveryManifestSchema> {
  const row = database
    .prepare(
      `SELECT manifest.*, delivery.project_id AS delivery_project_id
       FROM delivery_manifests AS manifest
       JOIN delivery_plans AS delivery ON delivery.id = manifest.delivery_plan_id
       WHERE manifest.id = ?`,
    )
    .get(manifestId) as unknown as DeliveryManifestRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Delivery Manifest was not found: ${manifestId}`);
  }
  if (row.delivery_project_id !== row.project_id) {
    throw corrupt(`Delivery Manifest ${row.id} Delivery belongs to another Project`);
  }
  const items = (
    database
      .prepare(
        `SELECT delivery_item_id, delivery_item_revision, delivery_item_content_hash,
                shot_id, shot_revision, shot_content_hash,
                generated_result_id, generated_result_revision, generated_result_content_hash,
                project_media_ref_id, project_media_revision, project_media_content_hash,
                global_asset_id, global_asset_revision, global_asset_content_hash, blob_hash,
                ordinal, trim_start_ms, trim_end_ms, audio_policy,
                transition_kind, transition_duration_ms, review_state
         FROM delivery_manifest_items
         WHERE delivery_manifest_id = ?
         ORDER BY ordinal, id`,
      )
      .all(row.id) as unknown as DeliveryManifestItemRow[]
  ).map((item) => ({
    deliveryItemId: item.delivery_item_id,
    deliveryItemRevision: item.delivery_item_revision,
    deliveryItemContentHash: item.delivery_item_content_hash,
    shotId: item.shot_id,
    shotRevision: item.shot_revision,
    shotContentHash: item.shot_content_hash,
    generatedResultId: item.generated_result_id,
    generatedResultRevision: item.generated_result_revision,
    generatedResultContentHash: item.generated_result_content_hash,
    projectMediaRefId: item.project_media_ref_id,
    projectMediaRevision: item.project_media_revision,
    projectMediaContentHash: item.project_media_content_hash,
    globalAssetId: item.global_asset_id,
    globalAssetRevision: item.global_asset_revision,
    globalAssetContentHash: item.global_asset_content_hash,
    blobHash: item.blob_hash,
    order: item.ordinal,
    trimStartMs: item.trim_start_ms,
    trimEndMs: item.trim_end_ms,
    audioPolicy: item.audio_policy,
    transition: {
      kind: item.transition_kind,
      durationMs: item.transition_duration_ms,
    },
    reviewState: item.review_state,
  }));
  const manifest = parseStored('Delivery Manifest', DeliveryManifestSchema, {
    authority: 'delivery_manifest',
    id: row.id,
    projectId: row.project_id,
    revision: row.revision,
    contentHash: row.content_hash,
    sourcePlan: {
      authority: 'delivery',
      id: row.delivery_plan_id,
      revision: row.delivery_revision,
      contentHash: row.delivery_content_hash,
    },
    formatIntent: decodeCanonicalRecord(
      'Delivery Manifest format intent',
      DeliveryFormatIntentSchema,
      row.format_intent_v1_json,
    ),
    items,
    currentChoices: loadDeliveryManifestChoices(
      database,
      'delivery_manifest_choices',
      row.id,
      row.delivery_plan_id,
    ),
    protections: loadDeliveryManifestChoices(
      database,
      'delivery_manifest_protections',
      row.id,
      row.delivery_plan_id,
    ),
    createdBy: decodeCanonicalRecord(
      'Delivery Manifest causation',
      CausationRefSchema,
      row.created_by_v1_json,
    ),
    frozenAt: row.frozen_at,
  });
  if (hashCanonical(deliveryManifestContentHashInput(manifest)) !== manifest.contentHash) {
    throw corrupt(`Delivery Manifest ${manifest.id} hash does not match its frozen snapshot`);
  }
  return manifest;
}

export function loadOperationOwnerRecord(
  database: DatabaseSync,
  authority: OperationOwnerAuthority,
  id: string,
): OperationOwnerRecord {
  switch (authority) {
    case 'generation_attempt':
      return loadGenerationOwner(database, id);
    case 'media_derivation_attempt':
      return loadMediaDerivationOwner(database, id);
    case 'result_assessment_attempt':
      return loadAssessmentOwner(database, id);
    case 'review_cut_attempt':
      return loadReviewCutOwner(database, id);
    case 'delivery_export':
      return loadDeliveryExportOwner(database, id);
  }
}

export function operationRefForOwner(
  operationId: string,
  owner: OperationOwnerRecord,
): OperationRef {
  return parseStored('Operation ref', OperationRefSchema, {
    id: operationId,
    revision: owner.view.revision,
    kind:
      owner.authority === 'media_derivation_attempt'
        ? 'media_derivation'
        : owner.authority === 'result_assessment_attempt'
          ? 'result_assessment'
          : owner.authority,
    ownerRef: {
      authority: owner.authority,
      id: owner.view.id,
      revision: owner.view.revision,
      contentHash: owner.view.contentHash,
    },
  });
}

export function loadGeneratedResultRecord(
  database: DatabaseSync,
  resultId: string,
): GeneratedResult {
  const row = database
    .prepare(
      `SELECT result.*, request.run_id, request.target_id, request.target_revision,
              request.target_hash, request.spec_v1_json AS request_spec_v1_json,
              request.request_hash
       FROM generated_results AS result
       JOIN generation_requests AS request ON request.id = result.request_id
       WHERE result.id = ?`,
    )
    .get(resultId) as unknown as GeneratedResultRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Generated Result was not found: ${resultId}`);
  }
  const requestSpec = decodeCanonicalRecord(
    'Generated Result Request spec',
    GenerationSpecSchema,
    row.request_spec_v1_json,
  );
  if (
    requestSpec.target.id !== row.target_id ||
    requestSpec.target.revision !== row.target_revision ||
    requestSpec.target.contentHash !== row.target_hash ||
    hashCanonical(generationRequestHashInput(requestSpec)) !== row.request_hash
  ) {
    throw corrupt(`Generated Result ${row.id} frozen Request target or hash does not match`);
  }
  const provider = decodeCanonicalRecord(
    'Generated Result provider',
    ProviderModelSchema,
    row.provider_v1_json,
  );
  const receipt = decodeCanonicalRecord(
    'Generated Result receipt',
    ProviderReceiptSchema,
    row.receipt_v1_json,
  );
  assertProviderBinding(
    `Generated Result ${row.id}`,
    provider.providerId,
    provider,
    receipt.providerOperationId,
    receipt,
  );
  const result = parseStored('Generated Result', GeneratedResultSchema, {
    authority: 'generated_result',
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    revision: row.revision,
    contentHash: row.content_hash,
    generationRequestId: row.request_id,
    generationAttemptId: row.attempt_id,
    targetProductionObjectId: row.target_id,
    globalMediaAssetId: row.global_asset_id,
    mediaBlobHash: row.blob_hash,
    projectMediaRefId: row.project_media_ref_id,
    mediaKind: row.media_kind,
    variantIndex: row.variant_index,
    submittedPrompt: row.submitted_prompt,
    submittedNegativePrompt: row.submitted_negative_prompt,
    promptProvenance: decodeCanonicalRecord(
      'Generated Result prompt provenance',
      PromptAssemblyProvenanceSchema,
      row.prompt_provenance_v1_json,
    ),
    referenceBindings: decodeCanonicalRecord(
      'Generated Result reference bindings',
      z.array(GenerationReferenceBindingSchema).max(100),
      row.reference_bindings_v1_json,
    ),
    provider,
    seed: row.seed,
    receipt,
    usage: decodeCanonicalRecord('Generated Result usage', ProviderUsageSchema, row.usage_v1_json),
    technicalValidation: decodeCanonicalRecord(
      'Generated Result technical validation',
      TechnicalValidationSchema,
      row.technical_validation_v1_json,
    ),
    createdAt: row.created_at,
  });
  if (hashCanonical(generatedResultContentHashInput(result)) !== result.contentHash) {
    throw corrupt(`Generated Result ${result.id} content hash does not match`);
  }
  const asset = loadGlobalMediaAsset(database, result.globalMediaAssetId);
  const projectMedia = loadProjectMediaRecord(database, result.projectMediaRefId);
  if (
    asset.blobHash !== result.mediaBlobHash ||
    asset.source.kind !== 'generated' ||
    asset.source.attemptId !== result.generationAttemptId ||
    asset.source.resultId !== result.id ||
    projectMedia.projectId !== result.projectId ||
    projectMedia.globalAssetId !== asset.id ||
    canonicalJson(projectMedia.productionLinks) !==
      canonicalJson([
        {
          productionObjectId: result.targetProductionObjectId,
          relation: 'generated_for',
        },
      ])
  ) {
    throw corrupt(`Generated Result ${result.id} Media mapping does not match`);
  }
  return result;
}

function generatedResults(
  database: DatabaseSync,
  owner: OperationOwnerRecord,
  dispatchInput: unknown,
): { resultRefs: DomainObjectRef[]; artifacts: OperationPublicView['artifacts'] } {
  if (owner.view.authority !== 'generation_attempt') {
    throw corrupt(`Operation owner ${owner.view.id} projection authority does not match`);
  }
  const view = owner.view;
  const input = parseStored(
    'Generation dispatch input',
    GenerationSubmitInputSchema,
    dispatchInput,
  );
  const rows = database
    .prepare(
      `SELECT id FROM generated_results
       WHERE attempt_id = ?
       ORDER BY variant_index, id`,
    )
    .all(view.id) as unknown as Array<{ id: string }>;
  if (view.state === 'succeeded' && rows.length !== input.outputIntents.length) {
    throw corrupt(`Succeeded Generation Attempt ${view.id} output count does not match`);
  }
  if (
    (view.state === 'prepared' ||
      view.state === 'running' ||
      view.state === 'submitted' ||
      view.state === 'unknown') &&
    rows.length !== 0
  ) {
    throw corrupt(`Non-terminal Generation Attempt ${view.id} has Generated Results`);
  }
  const variants = new Set<number>();
  return rows.reduce(
    (projection, row) => {
      const result = loadGeneratedResultRecord(database, row.id);
      if (result.projectId !== owner.projectId || result.runId !== owner.runId) {
        throw corrupt(`Generated Result ${result.id} belongs to another Project or Run`);
      }
      const intent = input.outputIntents[result.variantIndex];
      const asset = loadGlobalMediaAsset(database, result.globalMediaAssetId);
      const projectMedia = loadProjectMediaRecord(database, result.projectMediaRefId);
      if (
        intent === undefined ||
        variants.has(result.variantIndex) ||
        result.generationRequestId !== view.request.id ||
        result.generationAttemptId !== view.id ||
        result.targetProductionObjectId !== input.spec.target.id ||
        result.submittedPrompt !== input.spec.prompt ||
        result.submittedNegativePrompt !== input.spec.negativePrompt ||
        canonicalJson(result.promptProvenance) !== canonicalJson(input.promptProvenance) ||
        result.seed !== input.spec.seed ||
        asset.filename !== intent.globalAsset.filename ||
        asset.displayName !== intent.globalAsset.displayName ||
        asset.folderId !== intent.globalAsset.folderId ||
        canonicalJson(asset.tags) !== canonicalJson(intent.globalAsset.tags) ||
        projectMedia.label !== intent.projectMediaRef.label ||
        canonicalJson(projectMedia.collections) !==
          canonicalJson(intent.projectMediaRef.collections) ||
        canonicalJson(projectMedia.roles) !== canonicalJson(intent.projectMediaRef.roles) ||
        projectMedia.notes !== intent.projectMediaRef.notes
      ) {
        throw corrupt(`Generated Result ${result.id} does not match its accepted output intent`);
      }
      variants.add(result.variantIndex);
      projection.resultRefs.push({
        authority: 'generated_result',
        id: result.id,
        revision: result.revision,
        contentHash: result.contentHash,
      });
      projection.artifacts.push(
        artifactForMediaBlob(database, result.id, result.mediaBlobHash, result.mediaKind),
      );
      return projection;
    },
    { resultRefs: [] as DomainObjectRef[], artifacts: [] as OperationPublicView['artifacts'] },
  );
}

function mediaDerivationResults(
  database: DatabaseSync,
  owner: OperationOwnerRecord,
  dispatchInput: unknown,
): { resultRefs: DomainObjectRef[]; artifacts: OperationPublicView['artifacts'] } {
  if (owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`Operation owner ${owner.view.id} projection authority does not match`);
  }
  const view = owner.view;
  const input = parseStored(
    'Media Derivation dispatch input',
    MediaDeriveInputSchema,
    dispatchInput,
  );
  const rows = database
    .prepare(
      `SELECT id, derivation_attempt_id, blob_hash, global_asset_id,
              project_media_ref_id, ordinal
       FROM media_derivation_outputs
       WHERE derivation_attempt_id = ?
       ORDER BY ordinal, id`,
    )
    .all(view.id) as unknown as Array<{
    id: string;
    derivation_attempt_id: string;
    blob_hash: string;
    global_asset_id: string;
    project_media_ref_id: string | null;
    ordinal: number;
  }>;
  if (view.state !== 'succeeded') {
    if (rows.length !== 0) {
      throw corrupt(`Non-succeeded Media Derivation ${view.id} has outputs`);
    }
    return { resultRefs: [], artifacts: [] };
  }
  if (rows.length !== input.outputIntents.length) {
    throw corrupt(`Succeeded Media Derivation ${view.id} output count does not match`);
  }
  return rows.reduce(
    (projection, row, index) => {
      const intent = input.outputIntents[index]!;
      const output = parseStored('Media Derivation output', MediaDerivationOutputSchema, {
        id: row.id,
        derivationAttemptId: row.derivation_attempt_id,
        blobHash: row.blob_hash,
        globalAssetId: row.global_asset_id,
        projectMediaRefId: row.project_media_ref_id,
        ordinal: row.ordinal,
      });
      const asset = loadGlobalMediaAsset(database, output.globalAssetId);
      if (
        output.ordinal !== intent.ordinal ||
        asset.blobHash !== output.blobHash ||
        asset.filename !== intent.globalAsset.filename ||
        asset.displayName !== intent.globalAsset.displayName ||
        asset.folderId !== intent.globalAsset.folderId ||
        canonicalJson(asset.tags) !== canonicalJson(intent.globalAsset.tags) ||
        asset.source.kind !== 'derived' ||
        asset.source.derivationId !== view.derivation.id ||
        asset.source.sourceBlobHash !== view.derivation.sourceBlobHash
      ) {
        throw corrupt(`Media Derivation output ${output.id} Global Asset does not match`);
      }
      if ((output.projectMediaRefId === null) !== (intent.projectMediaRef === null)) {
        throw corrupt(`Media Derivation output ${output.id} Project Media intent does not match`);
      }
      if (output.projectMediaRefId !== null && intent.projectMediaRef !== null) {
        const projectMedia = loadProjectMediaRecord(database, output.projectMediaRefId);
        if (
          projectMedia.projectId !== owner.projectId ||
          projectMedia.globalAssetId !== asset.id ||
          projectMedia.label !== intent.projectMediaRef.label ||
          canonicalJson(projectMedia.collections) !==
            canonicalJson(intent.projectMediaRef.collections) ||
          canonicalJson(projectMedia.roles) !== canonicalJson(intent.projectMediaRef.roles) ||
          projectMedia.notes !== intent.projectMediaRef.notes ||
          canonicalJson(projectMedia.productionLinks) !== canonicalJson([])
        ) {
          throw corrupt(
            `Media Derivation output ${output.id} Project Media mapping does not match`,
          );
        }
        projection.resultRefs.push({
          authority: 'project_media_ref',
          id: projectMedia.id,
          revision: projectMedia.revision,
          contentHash: projectMedia.contentHash,
        });
      }
      projection.artifacts.push(artifactForMediaBlob(database, output.id, output.blobHash));
      return projection;
    },
    { resultRefs: [] as DomainObjectRef[], artifacts: [] as OperationPublicView['artifacts'] },
  );
}

export function operationPublicViewForOwner(
  database: DatabaseSync,
  operationId: string,
  owner: OperationOwnerRecord,
  dispatchInput: unknown,
): OperationPublicView {
  let projection: { resultRefs: DomainObjectRef[]; artifacts: OperationPublicView['artifacts'] };
  if (owner.authority === 'generation_attempt') {
    projection = generatedResults(database, owner, dispatchInput);
  } else if (owner.authority === 'media_derivation_attempt') {
    projection = mediaDerivationResults(database, owner, dispatchInput);
  } else if (owner.view.authority === 'result_assessment_attempt') {
    const assessment = owner.view.assessment;
    projection = {
      resultRefs:
        assessment === null
          ? []
          : [
              {
                authority: owner.authority,
                id: owner.view.id,
                revision: owner.view.revision,
                contentHash: owner.view.contentHash,
              },
            ],
      artifacts: assessment?.artifacts ?? [],
    };
  } else if (
    owner.view.authority === 'review_cut_attempt' ||
    owner.view.authority === 'delivery_export'
  ) {
    const blobHash = owner.view.outputBlobHash;
    projection =
      blobHash === null
        ? { resultRefs: [], artifacts: [] }
        : {
            resultRefs: [
              {
                authority: owner.authority,
                id: owner.view.id,
                revision: owner.view.revision,
                contentHash: owner.view.contentHash,
              },
            ],
            artifacts: [
              artifactForMediaBlob(
                database,
                owner.view.id,
                blobHash,
                owner.view.authority === 'review_cut_attempt' ? 'review_cut' : 'delivery_export',
              ),
            ],
          };
  } else {
    throw corrupt(`Operation owner ${owner.view.id} projection authority does not match`);
  }
  return parseStored('Operation public view', OperationPublicViewSchema, {
    ref: operationRefForOwner(operationId, owner),
    state: owner.view.state,
    cancelRequested: owner.view.cancelRequested,
    progressPercent: owner.view.progressPercent,
    usage: owner.view.usage,
    publicErrorCode: owner.view.publicErrorCode,
    ...projection,
  });
}

export function requestOperationOwnerCancellation(
  database: DatabaseSync,
  before: OperationOwnerRecord,
): OperationOwnerRecord {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Operation owner update requires a transaction',
    );
  }
  if (before.view.cancelRequested) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Operation ${before.view.id} is already cancelled`,
    );
  }
  const withoutHash = {
    ...before.view,
    revision: before.view.revision + 1,
    contentHash: '',
    cancelRequested: true,
  };
  const afterHash = hashContentObject(withoutHash);
  let update;
  switch (before.authority) {
    case 'generation_attempt':
      update = database
        .prepare(
          `UPDATE generation_attempts SET revision = ?, content_hash = ?, cancel_requested = 1
           WHERE id = ? AND revision = ? AND content_hash = ? AND cancel_requested = 0`,
        )
        .run(
          before.view.revision + 1,
          afterHash,
          before.view.id,
          before.view.revision,
          before.view.contentHash,
        );
      break;
    case 'media_derivation_attempt':
      update = database
        .prepare(
          `UPDATE media_derivation_attempts SET revision = ?, content_hash = ?, cancel_requested = 1
           WHERE id = ? AND revision = ? AND content_hash = ? AND cancel_requested = 0`,
        )
        .run(
          before.view.revision + 1,
          afterHash,
          before.view.id,
          before.view.revision,
          before.view.contentHash,
        );
      break;
    case 'result_assessment_attempt':
      update = database
        .prepare(
          `UPDATE result_assessment_attempts SET revision = ?, content_hash = ?, cancel_requested = 1
           WHERE id = ? AND revision = ? AND content_hash = ? AND cancel_requested = 0`,
        )
        .run(
          before.view.revision + 1,
          afterHash,
          before.view.id,
          before.view.revision,
          before.view.contentHash,
        );
      break;
    case 'review_cut_attempt':
      update = database
        .prepare(
          `UPDATE review_cut_attempts SET revision = ?, content_hash = ?, cancel_requested = 1
           WHERE id = ? AND revision = ? AND content_hash = ? AND cancel_requested = 0`,
        )
        .run(
          before.view.revision + 1,
          afterHash,
          before.view.id,
          before.view.revision,
          before.view.contentHash,
        );
      break;
    case 'delivery_export':
      update = database
        .prepare(
          `UPDATE delivery_exports SET revision = ?, content_hash = ?, cancel_requested = 1
           WHERE id = ? AND revision = ? AND content_hash = ? AND cancel_requested = 0`,
        )
        .run(
          before.view.revision + 1,
          afterHash,
          before.view.id,
          before.view.revision,
          before.view.contentHash,
        );
      break;
  }
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `${before.authority}:${before.view.id} changed concurrently`,
    );
  }
  const after = loadOperationOwnerRecord(database, before.authority, before.view.id);
  if (
    after.projectId !== before.projectId ||
    after.runId !== before.runId ||
    after.view.revision !== before.view.revision + 1 ||
    after.view.contentHash !== afterHash ||
    after.view.state !== before.view.state ||
    after.view.cancelRequested !== true ||
    canonicalJson(after.view.usage) !== canonicalJson(before.view.usage) ||
    canonicalJson(after.view.receipt) !== canonicalJson(before.view.receipt) ||
    after.view.publicErrorCode !== before.view.publicErrorCode
  ) {
    throw corrupt(
      `${before.authority}:${before.view.id} cancellation update changed immutable state`,
    );
  }
  return after;
}
