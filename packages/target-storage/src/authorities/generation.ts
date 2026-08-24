import {
  EntityIdSchema,
  GeneratedResultSchema,
  GenerationAttemptViewSchema,
  GenerationOperationRefSchema,
  GenerationQuoteSchema,
  GenerationQuoteInputSchema,
  GenerationQuoteSuccessSchema,
  GenerationReferenceBindingSchema,
  GenerationRequestSchema,
  GenerationSubmissionSuccessSchema,
  GenerationSubmitInputSchema,
  GlobalMediaAssetSchema,
  MediaTechnicalFactsSchema,
  ProviderReceiptSchema,
  ProviderUsageSchema,
  RevisionSchema,
  TechnicalValidationSchema,
  canonicalJson,
  generatedResultContentHashInput,
  generationPromptAssemblyHashInput,
  generationQuoteHashInput,
  generationRequestHashInput,
  parseCanonical,
  providerReceiptHashInput,
  type GeneratedResult,
  type GenerationQuote,
  type GenerationReferenceBinding,
  type GenerationSpec,
  type MediaBlob,
  type OperationPublicErrorCode,
  type ProviderModel,
  type ProviderReceipt,
  type ProviderUsage,
  type ResourceAmount,
  type Run,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getProject, getSettings } from './projects.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { TargetCommandContextSchema, type TargetCommandContext } from '../internal/command.js';
import {
  addExactDecimals,
  compareExactDecimals,
  parseExactDecimal,
} from '../internal/exact-decimal.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  insertGeneratedProjectMediaRecord,
  insertGlobalMediaAsset,
  insertOrValidateMediaBlob,
  loadGlobalMediaAsset,
  loadMediaBlob,
  loadProjectMediaRecord,
  type MediaBlobDescriptor,
} from '../internal/media-records.js';
import {
  assertOperationRefIdentity,
  findOperationByFingerprint,
  loadBoundOperation,
  recordOperationOwnerTransitions,
  registerOperationDispatch,
  resolveOperationDispatchKey,
  type BoundOperationRecord,
  type OperationDispatchKey,
} from '../internal/operation-dispatch.js';
import {
  loadGeneratedResultRecord,
  operationPublicViewForOwner,
  transitionGenerationOwner,
} from '../internal/operation-owner-records.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { loadProductionObject } from '../internal/production-records.js';
import { loadProviderProfileRecord } from '../internal/provider-profile-records.js';
import { loadRunEvents } from '../internal/run-journal.js';
import { loadRunBudgetExposure } from '../internal/run-budget.js';
import {
  appendOperationCostReservation,
  loadOperationCostReservation,
  releaseOperationCostReservation,
  settleOperationCostReservation,
} from '../internal/operation-cost-ledger.js';
import { loadRun } from '../internal/run-records.js';
import { appendRunResourceEntry, loadRunResourceEntries } from '../internal/run-resource-ledger.js';
import { loadRunSnapshots } from '../internal/run-snapshots.js';
import { upsertProjectSearchDocument } from '../internal/search-projection.js';
import { TargetStorageError } from '../kernel/errors.js';
import type {
  GenerationProviderAdapter,
  GenerationProviderOutput,
  GenerationProviderProfile,
  GenerationProviderReference,
  GenerationProviderState,
} from '../kernel/generation-provider.js';
import type { MediaCas } from '../kernel/media-cas.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

type GenerationQuoteInput = z.output<typeof GenerationQuoteInputSchema>;
type GenerationQuoteSuccess = z.output<typeof GenerationQuoteSuccessSchema>;
type GenerationSubmitInput = z.output<typeof GenerationSubmitInputSchema>;
type GenerationSubmissionSuccess = z.output<typeof GenerationSubmissionSuccessSchema>;
type GenerationOperationRef = z.output<typeof GenerationOperationRefSchema>;

export interface QuoteGenerationInput {
  readonly runId: string;
  readonly request: GenerationQuoteInput;
}

export interface SubmitGenerationInput {
  readonly runId: string;
  readonly commandId: string;
  readonly request: GenerationSubmitInput;
  /** Internal runtime binding; callers never include this in the tool contract. */
  readonly dispatchOperationId?: string;
}

export interface ReconcileGenerationInput {
  readonly operation: GenerationOperationRef;
  readonly expectedRevision: number;
  readonly commandId: string;
}

export interface GenerationAuthority {
  readonly quote: (
    input: QuoteGenerationInput,
    signal?: AbortSignal,
  ) => Promise<GenerationQuoteSuccess>;
  readonly submit: (
    input: SubmitGenerationInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<GenerationSubmissionSuccess>;
  readonly reconcile: (
    input: ReconcileGenerationInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<GenerationSubmissionSuccess>;
}

interface ResolvedReference {
  readonly binding: GenerationReferenceBinding;
  readonly blob: MediaBlob;
}

function invalid(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function internalCommandId(commandId: string, fingerprint: string, phase: string): string {
  return hashCanonical({
    commandId: parseCanonical(EntityIdSchema, commandId),
    fingerprint,
    phase,
  });
}

function resourceKey(attemptId: string, kind: 'cost' | 'generation_count', phase: string): string {
  return hashCanonical({ attemptId, kind, phase });
}

function exactObject(value: unknown, label: string): Record<string, unknown> {
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

function parseProviderReceipt(value: unknown, label: string): ProviderReceipt {
  let receipt: ProviderReceipt;
  try {
    receipt = parseCanonical(ProviderReceiptSchema, value);
  } catch {
    throw corrupt(`${label} is invalid`);
  }
  if (hashCanonical(providerReceiptHashInput(receipt)) !== receipt.receiptHash) {
    throw corrupt(`${label} hash does not match`);
  }
  return receipt;
}

function parseProviderOutput(value: unknown, index: number): GenerationProviderOutput {
  const output = exactObject(value, `Generation provider output ${index}`);
  exactKeys(
    output,
    ['variantIndex', 'blob', 'technicalValidation'],
    `Generation provider output ${index}`,
  );
  const blob = exactObject(output.blob, `Generation provider output ${index} Blob`);
  exactKeys(
    blob,
    ['hash', 'byteLength', 'mimeType', 'technicalFacts', 'publication'],
    `Generation provider output ${index} Blob`,
  );
  let metadata: {
    variantIndex: number;
    blob: {
      hash: string;
      byteLength: number;
      mimeType: string;
      technicalFacts: z.output<typeof MediaTechnicalFactsSchema>;
    };
    technicalValidation: z.output<typeof TechnicalValidationSchema>;
  };
  try {
    metadata = parseCanonical(
      z.strictObject({
        variantIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        blob: z.strictObject({
          hash: z.string().regex(/^[0-9a-f]{64}$/),
          byteLength: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
          mimeType: z.string().trim().min(1).max(160),
          technicalFacts: MediaTechnicalFactsSchema,
        }),
        technicalValidation: TechnicalValidationSchema,
      }),
      {
        variantIndex: output.variantIndex,
        blob: {
          hash: blob.hash,
          byteLength: blob.byteLength,
          mimeType: blob.mimeType,
          technicalFacts: blob.technicalFacts,
        },
        technicalValidation: output.technicalValidation,
      },
    );
  } catch {
    throw corrupt(`Generation provider output ${index} metadata is invalid`);
  }
  const publication = exactObject(
    blob.publication,
    `Generation provider output ${index} publication`,
  );
  if (publication.state === 'published') {
    exactKeys(publication, ['state'], `Generation provider output ${index} publication`);
    return { ...metadata, blob: { ...metadata.blob, publication: { state: 'published' } } };
  }
  if (publication.state !== 'pending') {
    throw corrupt(`Generation provider output ${index} publication state is invalid`);
  }
  exactKeys(publication, ['state', 'bytes'], `Generation provider output ${index} publication`);
  const bytes = publication.bytes as AsyncIterable<Uint8Array> | undefined;
  if (bytes === undefined || typeof bytes[Symbol.asyncIterator] !== 'function') {
    throw corrupt(`Generation provider output ${index} byte stream is invalid`);
  }
  return {
    ...metadata,
    blob: { ...metadata.blob, publication: { state: 'pending', bytes } },
  };
}

function parseProviderState(value: unknown): GenerationProviderState {
  const state = exactObject(value, 'Generation provider state');
  if (state.state === 'not_submitted') {
    exactKeys(state, ['state'], 'Generation provider state');
    return { state: 'not_submitted' };
  }
  const keys =
    state.state === 'failed'
      ? ['state', 'receipt', 'usage', 'outputs', 'publicErrorCode']
      : ['state', 'receipt', 'usage', 'outputs'];
  exactKeys(state, keys, 'Generation provider state');
  if (!['unknown', 'submitted', 'succeeded', 'failed', 'cancelled'].includes(String(state.state))) {
    throw corrupt('Generation provider state is invalid');
  }
  const receipt =
    state.receipt === null
      ? null
      : parseProviderReceipt(state.receipt, 'Generation provider receipt');
  let usage: ProviderUsage | null;
  try {
    usage = state.usage === null ? null : parseCanonical(ProviderUsageSchema, state.usage);
  } catch {
    throw corrupt('Generation provider usage is invalid');
  }
  if (!Array.isArray(state.outputs) || state.outputs.length > 100) {
    throw corrupt('Generation provider outputs are invalid');
  }
  const outputs = state.outputs.map(parseProviderOutput);
  if ((state.state === 'submitted' || state.state === 'succeeded') && receipt === null) {
    throw corrupt(`Generation provider ${String(state.state)} state requires a receipt`);
  }
  if (state.state === 'submitted' && (usage !== null || outputs.length !== 0)) {
    throw corrupt('Generation provider submitted state cannot contain usage or outputs');
  }
  if (state.state === 'unknown' && (usage !== null || outputs.length !== 0)) {
    throw corrupt('Generation provider unknown state cannot contain usage or outputs');
  }
  if (state.state === 'succeeded' && usage === null) {
    throw corrupt('Generation provider succeeded state requires usage');
  }
  if (
    (state.state === 'failed' || state.state === 'cancelled') &&
    ((receipt === null) !== (usage === null) || (outputs.length > 0 && receipt === null))
  ) {
    throw corrupt('Generation provider terminal receipt, usage, and outputs are inconsistent');
  }
  if (state.state === 'failed') {
    if (
      state.publicErrorCode !== 'provider_failed' &&
      state.publicErrorCode !== 'execution_failed'
    ) {
      throw corrupt('Generation provider failure code is invalid');
    }
    return { state: 'failed', receipt, usage, outputs, publicErrorCode: state.publicErrorCode };
  }
  if (state.state === 'unknown') return { state: 'unknown', receipt, usage: null, outputs: [] };
  if (state.state === 'submitted') {
    return { state: 'submitted', receipt: receipt!, usage: null, outputs: [] };
  }
  if (state.state === 'succeeded') {
    return { state: 'succeeded', receipt: receipt!, usage: usage!, outputs };
  }
  return { state: 'cancelled', receipt, usage, outputs };
}

function loadProviderProfile(
  database: DatabaseSync,
  run: Run,
  spec: GenerationSpec,
  adapter: GenerationProviderAdapter,
): GenerationProviderProfile {
  const settings = getSettings(database, run.projectId);
  const requestedId = spec.provider?.providerId ?? settings.defaultProviderProfileId;
  if (requestedId === null) throw invalid('Generation has no configured Provider Profile');
  const profile = loadProviderProfileById(database, requestedId, adapter);
  if (
    spec.provider !== null &&
    (spec.provider.providerId !== profile.model.providerId ||
      spec.provider.model !== profile.model.model)
  ) {
    throw invalid('Generation Provider Profile does not match the requested provider and model');
  }
  return profile;
}

function loadProviderProfileById(
  database: DatabaseSync,
  requestedId: string,
  adapter: GenerationProviderAdapter,
  expectedModel?: ProviderModel,
): GenerationProviderProfile {
  return loadProviderProfileRecord(database, requestedId, adapter, 'Generation', expectedModel);
}

function assertTarget(database: DatabaseSync, run: Run, spec: GenerationSpec): void {
  const target = loadProductionObject(database, spec.target.id);
  if (
    target.projectId !== run.projectId ||
    target.lifecycle !== 'active' ||
    target.revision !== spec.target.revision ||
    target.contentHash !== spec.target.contentHash
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Generation target ${spec.target.id} does not match its current Project snapshot`,
    );
  }
}

function assertProjectRevision(
  database: DatabaseSync,
  projectId: string,
  expectedRevision: number,
): void {
  const project = getProject(database, projectId);
  if (project.lifecycle !== 'active' || project.revision !== expectedRevision) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Project ${project.id} does not match the Generation attachment revision`,
    );
  }
}

function resolveReferences(
  database: DatabaseSync,
  run: Run,
  spec: GenerationSpec,
  enforceExpectedHash: boolean,
): ResolvedReference[] {
  const references = spec.references.map((reference) => {
    let projectMedia: ReturnType<typeof loadProjectMediaRecord>;
    if (reference.source.kind === 'project_media_ref') {
      projectMedia = loadProjectMediaRecord(database, reference.source.id);
      if (
        projectMedia.projectId !== run.projectId ||
        projectMedia.lifecycle !== 'active' ||
        (enforceExpectedHash && projectMedia.contentHash !== reference.expectedContentHash)
      ) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Generation reference ${reference.source.id} does not match its Project snapshot`,
        );
      }
    } else {
      const result = loadGeneratedResultRecord(database, reference.source.id);
      if (
        result.projectId !== run.projectId ||
        (enforceExpectedHash && result.contentHash !== reference.expectedContentHash)
      ) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Generation reference ${reference.source.id} does not match its Result snapshot`,
        );
      }
      projectMedia = loadProjectMediaRecord(database, result.projectMediaRefId);
    }
    const asset = loadGlobalMediaAsset(database, projectMedia.globalAssetId);
    const blob = loadMediaBlob(database, asset.blobHash);
    return {
      binding: parseCanonical(GenerationReferenceBindingSchema, {
        projectMediaRefId: projectMedia.id,
        globalAssetId: asset.id,
        blobHash: blob.hash,
        role: reference.role,
        influence: reference.influence,
      }),
      blob,
    };
  });
  if (
    spec.kind === 'image' &&
    spec.sourceMaskRefId !== null &&
    !spec.references.some(
      (reference) =>
        reference.source.kind === 'project_media_ref' &&
        reference.source.id === spec.sourceMaskRefId,
    )
  ) {
    throw invalid('Generation source mask must be an exact frozen Project Media reference');
  }
  return references;
}

function assertPromptProvenance(
  database: DatabaseSync,
  run: Run,
  input: GenerationSubmitInput,
): void {
  const expectedAssemblyHash = hashCanonical(
    generationPromptAssemblyHashInput({
      target: input.spec.target,
      prompt: input.spec.prompt,
      negativePrompt: input.spec.negativePrompt,
      references: input.spec.references,
      loadedSkillDigests: input.promptProvenance.loadedSkillDigests,
    }),
  );
  if (input.promptProvenance.assemblyHash !== expectedAssemblyHash) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      'Generation Prompt assembly provenance does not match the submitted Prompt',
    );
  }
  const loaded = new Set(
    loadRunEvents(database, run.id).flatMap((event) =>
      event.visibility === 'model_surface' &&
      event.payloadState.state === 'available' &&
      event.payloadState.payload.type === 'skill_loaded'
        ? [event.payloadState.payload.contentHash]
        : [],
    ),
  );
  if (input.promptProvenance.loadedSkillDigests.some((digest) => !loaded.has(digest))) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      'Generation Prompt provenance references a Skill not loaded earlier in this Run',
    );
  }
}

/** Local checks safe to run inside the atomic model-dispatch start boundary. */
export function assertGenerationSubmitModelBoundary(
  database: DatabaseSync,
  run: Run,
  input: GenerationSubmitInput,
): void {
  assertTarget(database, run, input.spec);
  assertProjectRevision(database, run.projectId, input.expectedProjectRevision);
  assertPromptProvenance(database, run, input);
}

function validateQuote(
  quote: GenerationQuote,
  requestHash: string,
  profile: GenerationProviderProfile,
  now: string,
): GenerationQuote {
  const parsed = parseCanonical(GenerationQuoteSchema, quote);
  if (
    parsed.quotedRequestHash !== requestHash ||
    parsed.providerId !== profile.id ||
    parsed.model !== profile.model.model ||
    Date.parse(parsed.expiresAt) <= Date.parse(now) ||
    hashCanonical(generationQuoteHashInput(parsed)) !== parsed.quoteHash
  ) {
    throw invalid('Generation quote does not bind the current Request, Provider, or expiry');
  }
  return parsed;
}

async function quoteProvider(
  adapter: GenerationProviderAdapter,
  run: Run,
  spec: GenerationSpec,
  profile: GenerationProviderProfile,
  idempotencyKey: string,
  now: string,
  signal?: AbortSignal,
): Promise<GenerationQuoteSuccess> {
  const requestHash = hashCanonical(generationRequestHashInput(spec));
  let result: unknown;
  try {
    result = await adapter.quote({ idempotencyKey, requestHash, profile, spec }, signal);
  } catch {
    throw invalid('Generation provider quote is unavailable');
  }
  let parsed: GenerationQuoteSuccess;
  try {
    parsed = parseCanonical(GenerationQuoteSuccessSchema, result);
  } catch {
    throw corrupt('Generation provider quote response is invalid');
  }
  return {
    ...parsed,
    quote: validateQuote(parsed.quote, requestHash, profile, now),
  };
}

function costAmount(quote: GenerationQuote): ResourceAmount {
  return quote.state === 'unknown'
    ? { state: 'unknown', currency: quote.currency }
    : { state: quote.state, value: quote.amount, currency: quote.currency };
}

function assertPermissionAndBudget(
  database: DatabaseSync,
  run: Run,
  quote: GenerationQuote,
  outputCount: number,
): void {
  if (run.permissionMode === 'read_only') {
    throw invalid('Generation is denied by the Run read-only permission');
  }
  const exposure = loadRunBudgetExposure(database, run);
  if (exposure.generationCount + BigInt(outputCount) > BigInt(run.budget.maxGenerationCount)) {
    throw invalid('Generation exceeds the Run generation-count budget');
  }
  if (quote.currency !== exposure.costCurrency) {
    throw invalid('Generation quote currency does not match the Run budget');
  }
  if (run.budget.costUsd.state === 'unknown') return;
  if (quote.state === 'unknown' || exposure.cost === null) {
    throw invalid('Generation with unknown cost is denied by the finite Run budget');
  }
  if (
    compareExactDecimals(
      addExactDecimals(exposure.cost, parseExactDecimal(quote.amount)),
      parseExactDecimal(run.budget.costUsd.value),
    ) > 0
  ) {
    throw invalid('Generation exceeds the Run cost budget');
  }
}

function generationOperation(bound: BoundOperationRecord): BoundOperationRecord {
  if (
    bound.dispatch.operationKind !== 'generation_attempt' ||
    bound.owner.authority !== 'generation_attempt' ||
    bound.owner.view.authority !== 'generation_attempt'
  ) {
    throw invalid(`Operation ${bound.dispatch.id} is not a Generation Attempt`);
  }
  return bound;
}

function costReservation(database: DatabaseSync, bound: BoundOperationRecord) {
  return loadOperationCostReservation(database, bound, `Generation Operation ${bound.dispatch.id}`);
}

function generationCountReservation(database: DatabaseSync, bound: BoundOperationRecord) {
  const reservations = loadRunResourceEntries(database, bound.dispatch.key.runId).filter(
    (entry) =>
      entry.source.kind === 'dispatch_operation' &&
      entry.source.id === bound.dispatch.id &&
      entry.kind === 'generation_count' &&
      entry.phase === 'reserved',
  );
  if (reservations.length !== 1 || reservations[0]!.amount.state === 'unknown') {
    throw corrupt(`Generation Operation ${bound.dispatch.id} count reservation is incomplete`);
  }
  return reservations[0]!;
}

function successForOperation(
  database: DatabaseSync,
  boundInput: BoundOperationRecord,
): GenerationSubmissionSuccess {
  const bound = generationOperation(boundInput);
  if (bound.owner.view.authority !== 'generation_attempt') {
    throw corrupt(`Generation Operation ${bound.dispatch.id} owner does not match`);
  }
  const view = operationPublicViewForOwner(
    database,
    bound.dispatch.id,
    bound.owner,
    bound.dispatch.key.input,
  );
  const immediateResults = (
    database
      .prepare(`SELECT id FROM generated_results WHERE attempt_id = ? ORDER BY variant_index, id`)
      .all(bound.owner.view.id) as unknown as Array<{ id: string }>
  ).map(({ id }) => {
    const result = loadGeneratedResultRecord(database, id);
    const artifact = view.artifacts.find(({ id: artifactId }) => artifactId === result.id);
    if (artifact === undefined) throw corrupt(`Generated Result ${result.id} has no artifact`);
    return {
      resultId: result.id,
      artifact,
      technicalState: result.technicalValidation.state,
    };
  });
  return parseCanonical(GenerationSubmissionSuccessSchema, {
    operation: view.ref,
    generationRequestId: bound.owner.view.request.id,
    attemptId: bound.owner.view.id,
    state: bound.owner.view.state,
    requestHash: bound.owner.view.request.requestHash,
    reservation: costReservation(database, bound).amount,
    immediateResults,
  });
}

/** Rebuilds the canonical submission result for an already-bound generation dispatch. */
export function generationSubmissionSuccessForDispatch(
  database: DatabaseSync,
  dispatchOperationId: string,
): GenerationSubmissionSuccess {
  return successForOperation(database, loadBoundOperation(database, dispatchOperationId));
}

function replayForKey(
  database: DatabaseSync,
  key: OperationDispatchKey,
  dispatchOperationId?: string,
) {
  const dispatch = findOperationByFingerprint(database, key, dispatchOperationId);
  return dispatch === undefined
    ? undefined
    : dispatch.operationKind === null
      ? undefined
      : successForOperation(database, loadBoundOperation(database, dispatch.id));
}

function assertExactGenerationRef(
  bound: BoundOperationRecord,
  ref: GenerationOperationRef,
  expectedRevision: number,
): void {
  assertOperationRefIdentity(bound, ref);
  if (
    ref.revision !== expectedRevision ||
    ref.ownerRef.revision !== expectedRevision ||
    bound.owner.view.revision !== expectedRevision ||
    bound.owner.view.contentHash !== ref.ownerRef.contentHash
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Generation Operation ${ref.id} does not match its current revision`,
    );
  }
}

function providerReferences(
  references: readonly ResolvedReference[],
  mediaCas: MediaCas,
): GenerationProviderReference[] {
  return references.map(({ binding, blob }) => ({
    binding,
    blob,
    bytes: mediaCas.openVerified({ hash: blob.hash, byteLength: blob.byteLength }),
  }));
}

function mediaSearchText(
  label: string,
  collections: readonly string[],
  roles: readonly string[],
  notes: string,
) {
  return [label, ...collections, ...roles, notes].join('\n');
}

function resultSearchText(result: GeneratedResult, displayName: string, label: string): string {
  return [displayName, label, result.submittedPrompt, result.submittedNegativePrompt ?? ''].join(
    '\n',
  );
}

function acceptedInput(bound: BoundOperationRecord): GenerationSubmitInput {
  try {
    return parseCanonical(GenerationSubmitInputSchema, bound.dispatch.key.input);
  } catch {
    throw corrupt(`Generation Operation ${bound.dispatch.id} accepted input is invalid`);
  }
}

function acceptedProfile(
  database: DatabaseSync,
  bound: BoundOperationRecord,
  adapter: GenerationProviderAdapter,
): GenerationProviderProfile {
  if (bound.owner.view.authority !== 'generation_attempt') {
    throw corrupt(`Generation Operation ${bound.dispatch.id} owner does not match`);
  }
  return loadProviderProfileById(
    database,
    bound.owner.view.provider.providerId,
    adapter,
    bound.owner.view.provider,
  );
}

function appendGenerationReservations(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  quote: GenerationQuote,
  outputCount: number,
  recordedAt: string,
): void {
  const source = { kind: 'dispatch_operation' as const, id: bound.dispatch.id };
  appendOperationCostReservation(database, environment, bound, costAmount(quote), recordedAt);
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source,
    phase: 'reserved',
    reservationEntryId: null,
    kind: 'generation_count',
    amount: { state: 'known', value: outputCount },
    idempotencyKey: resourceKey(bound.owner.view.id, 'generation_count', 'reserved'),
    recordedAt,
  });
}

function appendGenerationCountConsumed(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  recordedAt: string,
): void {
  const reservation = generationCountReservation(database, bound);
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source: { kind: 'dispatch_operation', id: bound.dispatch.id },
    phase: 'consumed',
    reservationEntryId: reservation.id,
    kind: 'generation_count',
    amount: reservation.amount,
    idempotencyKey: resourceKey(bound.owner.view.id, 'generation_count', 'consumed'),
    recordedAt,
  });
}

function releaseGenerationReservations(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  recordedAt: string,
): void {
  const source = { kind: 'dispatch_operation' as const, id: bound.dispatch.id };
  const count = generationCountReservation(database, bound);
  releaseOperationCostReservation(
    database,
    environment,
    bound,
    recordedAt,
    `Generation Operation ${bound.dispatch.id}`,
  );
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source,
    phase: 'released',
    reservationEntryId: count.id,
    kind: 'generation_count',
    amount: count.amount,
    idempotencyKey: resourceKey(bound.owner.view.id, 'generation_count', 'released'),
    recordedAt,
  });
}

function settleGenerationCost(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  usage: ProviderUsage,
  recordedAt: string,
): void {
  settleOperationCostReservation(
    database,
    environment,
    bound,
    usage,
    recordedAt,
    `Generation Operation ${bound.dispatch.id}`,
  );
}

function transitionAndRecord(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  input: Parameters<typeof transitionGenerationOwner>[2],
  commandId: string,
  phase: string,
  occurredAt: string,
  context: TargetCommandContext,
): BoundOperationRecord {
  const after = transitionGenerationOwner(database, bound.owner, input);
  recordOperationOwnerTransitions(
    database,
    environment,
    [{ dispatch: bound.dispatch, before: bound.owner, after }],
    internalCommandId(commandId, bound.dispatch.key.fingerprint, phase),
    occurredAt,
    context,
  );
  return generationOperation(loadBoundOperation(database, bound.dispatch.id));
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
  commandId: string,
  context: TargetCommandContext,
): BoundOperationRecord {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    let current = generationOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'generation_attempt') {
      throw corrupt(`Generation Operation ${operationId} owner does not match`);
    }
    if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) return current;
    const normalized = reconciled
      ? reconciledReceipt(receipt, occurredAt)
      : parseCanonical(ProviderReceiptSchema, { ...receipt, reconciledAt: null });
    const existing = current.owner.view.receipt;
    if (existing !== null && existing.receiptHash !== normalized.receiptHash) {
      throw corrupt(`Generation Operation ${operationId} provider receipt changed`);
    }
    appendGenerationCountConsumed(database, environment, current, occurredAt);
    if (
      existing !== null &&
      (current.owner.view.state !== 'unknown' || existing.reconciledAt !== null || !reconciled)
    ) {
      return current;
    }
    const transition = {
      state: current.owner.view.state === 'unknown' ? ('unknown' as const) : ('submitted' as const),
      receipt: normalized,
      usage: null,
      progressPercent: current.owner.view.progressPercent,
      publicErrorCode:
        current.owner.view.state === 'unknown' ? ('provider_state_unknown' as const) : null,
      finishedAt: null,
      receiptReconciled: reconciled,
    };
    if (current.owner.view.state === 'unknown') {
      transitionGenerationOwner(database, current.owner, transition);
      current = generationOperation(loadBoundOperation(database, current.dispatch.id));
    } else {
      current = transitionAndRecord(
        database,
        environment,
        current,
        transition,
        commandId,
        'submitted',
        occurredAt,
        context,
      );
    }
    return current;
  });
}

function markUnknown(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
): GenerationSubmissionSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = generationOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'generation_attempt') {
      throw corrupt(`Generation Operation ${operationId} owner does not match`);
    }
    if (
      current.owner.view.state === 'unknown' ||
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return successForOperation(database, current);
    }
    if (current.owner.view.state !== 'running' && current.owner.view.state !== 'submitted') {
      throw corrupt(`Generation Operation ${operationId} cannot enter unknown state`);
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

function finishWithoutReceipt(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  state: 'failed' | 'cancelled',
  publicErrorCode: OperationPublicErrorCode,
  commandId: string,
  context: TargetCommandContext,
): GenerationSubmissionSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = generationOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'generation_attempt') {
      throw corrupt(`Generation Operation ${operationId} owner does not match`);
    }
    if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
      return successForOperation(database, current);
    }
    if (current.owner.view.receipt !== null) {
      throw corrupt(`Generation Operation ${operationId} cannot finish without its receipt`);
    }
    releaseGenerationReservations(database, environment, current, occurredAt);
    const terminal = transitionAndRecord(
      database,
      environment,
      current,
      {
        state,
        receipt: null,
        usage: null,
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode,
        finishedAt: occurredAt,
        receiptReconciled: current.owner.view.state === 'unknown',
      },
      commandId,
      state,
      occurredAt,
      context,
    );
    return successForOperation(database, terminal);
  });
}

interface PublishedProviderOutput {
  readonly output: GenerationProviderOutput;
  readonly blob: MediaBlobDescriptor;
}

function eligibleProviderOutputs(
  input: GenerationSubmitInput,
  outputs: readonly GenerationProviderOutput[],
): GenerationProviderOutput[] {
  const variantCounts = new Map<number, number>();
  for (const output of outputs) {
    variantCounts.set(output.variantIndex, (variantCounts.get(output.variantIndex) ?? 0) + 1);
  }
  const descriptorByHash = new Map<string, string>();
  const conflictingHashes = new Set<string>();
  for (const output of outputs) {
    const descriptor = canonicalJson({
      hash: output.blob.hash,
      byteLength: output.blob.byteLength,
      mimeType: output.blob.mimeType,
      technicalFacts: output.blob.technicalFacts,
    });
    const existing = descriptorByHash.get(output.blob.hash);
    if (existing !== undefined && existing !== descriptor) conflictingHashes.add(output.blob.hash);
    descriptorByHash.set(output.blob.hash, descriptor);
  }
  return outputs.filter(
    (output) =>
      input.outputIntents[output.variantIndex]?.variantIndex === output.variantIndex &&
      variantCounts.get(output.variantIndex) === 1 &&
      output.blob.technicalFacts.kind === input.spec.kind &&
      !conflictingHashes.has(output.blob.hash),
  );
}

async function publishProviderOutputsToCas(
  mediaCas: MediaCas,
  input: GenerationSubmitInput,
  outputs: readonly GenerationProviderOutput[],
): Promise<PublishedProviderOutput[]> {
  const published: PublishedProviderOutput[] = [];
  for (const output of eligibleProviderOutputs(input, outputs)) {
    const blob = {
      hash: output.blob.hash,
      byteLength: output.blob.byteLength,
      mimeType: output.blob.mimeType,
      technicalFacts: output.blob.technicalFacts,
    };
    try {
      if (output.blob.publication.state === 'pending') {
        const result = await mediaCas.putVerified(
          { hash: blob.hash, byteLength: blob.byteLength },
          output.blob.publication.bytes,
        );
        if (result.hash !== blob.hash || result.byteLength !== blob.byteLength) continue;
      }
      await mediaCas.verify({ hash: blob.hash, byteLength: blob.byteLength });
      published.push({ output, blob });
    } catch {
      // A failed output remains unpublished; other normalized outputs still commit atomically.
    }
  }
  return published;
}

function appendGeneratedResultProjectEvents(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  result: GeneratedResult,
  asset: z.output<typeof GlobalMediaAssetSchema>,
  projectMediaRef: ReturnType<typeof insertGeneratedProjectMediaRecord>,
  commandId: string,
  context: TargetCommandContext,
  occurredAt: string,
): void {
  appendProjectEvent(database, {
    eventId: environment.createId('project_event'),
    projectId: bound.dispatch.key.projectId,
    occurredAt,
    actor: context.actor,
    subject: { authority: 'global_media_asset', id: asset.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: internalCommandId(
      commandId,
      bound.dispatch.key.fingerprint,
      `asset:${result.variantIndex}`,
    ),
    payload: { type: 'object_created', revision: 0, contentHash: asset.contentHash },
  });
  appendProjectEvent(database, {
    eventId: environment.createId('project_event'),
    projectId: bound.dispatch.key.projectId,
    occurredAt,
    actor: context.actor,
    subject: { authority: 'project_media_ref', id: projectMediaRef.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: internalCommandId(
      commandId,
      bound.dispatch.key.fingerprint,
      `attachment:${result.variantIndex}`,
    ),
    payload: {
      type: 'media_attached',
      projectMediaRefId: projectMediaRef.id,
      globalAssetId: asset.id,
      blobHash: result.mediaBlobHash,
    },
  });
  appendProjectEvent(database, {
    eventId: environment.createId('project_event'),
    projectId: bound.dispatch.key.projectId,
    occurredAt,
    actor: context.actor,
    subject: { authority: 'generated_result', id: result.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: internalCommandId(
      commandId,
      bound.dispatch.key.fingerprint,
      `result:${result.variantIndex}`,
    ),
    payload: {
      type: 'generated_result_recorded',
      resultId: result.id,
      revision: result.revision,
      contentHash: result.contentHash,
    },
  });
}

function insertGeneratedResult(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  input: GenerationSubmitInput,
  referenceBindings: readonly GenerationReferenceBinding[],
  publication: PublishedProviderOutput,
  usage: ProviderUsage,
  commandId: string,
  context: TargetCommandContext,
  occurredAt: string,
): GeneratedResult {
  if (bound.owner.view.authority !== 'generation_attempt' || bound.owner.view.receipt === null) {
    throw corrupt(`Generation Operation ${bound.dispatch.id} has no persisted receipt`);
  }
  const intent = input.outputIntents[publication.output.variantIndex];
  if (intent === undefined) {
    throw corrupt(`Generation output ${publication.output.variantIndex} has no accepted intent`);
  }
  const resultId = environment.createId('generated_result');
  const blob = insertOrValidateMediaBlob(database, publication.blob, occurredAt);
  const assetWithoutHash = {
    authority: 'global_media_asset' as const,
    id: environment.createId('global_media_asset'),
    revision: 0,
    contentHash: '',
    blobHash: blob.hash,
    kind: input.spec.kind,
    filename: intent.globalAsset.filename,
    displayName: intent.globalAsset.displayName,
    source: {
      kind: 'generated' as const,
      attemptId: bound.owner.view.id,
      resultId,
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
  const projectMediaRef = insertGeneratedProjectMediaRecord(database, {
    ref: {
      authority: 'project_media_ref',
      id: environment.createId('project_media_ref'),
      projectId: bound.dispatch.key.projectId,
      globalAssetId: asset.id,
      revision: 0,
      lifecycle: 'active',
      detachedAt: null,
      label: intent.projectMediaRef.label,
      collections: intent.projectMediaRef.collections,
      roles: intent.projectMediaRef.roles,
      notes: intent.projectMediaRef.notes,
      createdBy: context.causation,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    productionObjectId: input.spec.target.id,
    linkId: hashCanonical({
      attemptId: bound.owner.view.id,
      variantIndex: publication.output.variantIndex,
      relation: 'generated_for',
    }),
  });
  const withoutHash = {
    authority: 'generated_result' as const,
    id: resultId,
    projectId: bound.dispatch.key.projectId,
    runId: bound.dispatch.key.runId,
    revision: 0,
    contentHash: '',
    generationRequestId: bound.owner.view.request.id,
    generationAttemptId: bound.owner.view.id,
    targetProductionObjectId: input.spec.target.id,
    globalMediaAssetId: asset.id,
    mediaBlobHash: blob.hash,
    projectMediaRefId: projectMediaRef.id,
    mediaKind: input.spec.kind,
    variantIndex: publication.output.variantIndex,
    submittedPrompt: input.spec.prompt,
    submittedNegativePrompt: input.spec.negativePrompt,
    promptProvenance: input.promptProvenance,
    referenceBindings,
    provider: bound.owner.view.provider,
    seed: input.spec.seed,
    receipt: bound.owner.view.receipt,
    usage,
    technicalValidation: publication.output.technicalValidation,
    createdAt: occurredAt,
  };
  const result = parseCanonical(GeneratedResultSchema, {
    ...withoutHash,
    contentHash: hashCanonical(generatedResultContentHashInput(withoutHash as GeneratedResult)),
  });
  database
    .prepare(
      `INSERT INTO generated_results (
         id, project_id, request_id, attempt_id, revision, content_hash, blob_hash,
         global_asset_id, project_media_ref_id, media_kind, variant_index,
         submitted_prompt, submitted_negative_prompt, prompt_provenance_v1_json,
         reference_bindings_v1_json, provider_v1_json, seed, receipt_v1_json,
         usage_v1_json, technical_validation_v1_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      result.id,
      result.projectId,
      result.generationRequestId,
      result.generationAttemptId,
      result.revision,
      result.contentHash,
      result.mediaBlobHash,
      result.globalMediaAssetId,
      result.projectMediaRefId,
      result.mediaKind,
      result.variantIndex,
      result.submittedPrompt,
      result.submittedNegativePrompt,
      canonicalJson(result.promptProvenance),
      canonicalJson(result.referenceBindings),
      canonicalJson(result.provider),
      result.seed,
      canonicalJson(result.receipt),
      canonicalJson(result.usage),
      canonicalJson(result.technicalValidation),
      result.createdAt,
    );
  const persisted = loadGeneratedResultRecord(database, result.id);
  appendGeneratedResultProjectEvents(
    database,
    environment,
    bound,
    persisted,
    asset,
    projectMediaRef,
    commandId,
    context,
    occurredAt,
  );
  upsertProjectSearchDocument(
    database,
    environment,
    persisted.projectId,
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
    mediaSearchText(
      projectMediaRef.label,
      projectMediaRef.collections,
      projectMediaRef.roles,
      projectMediaRef.notes,
    ),
    occurredAt,
  );
  upsertProjectSearchDocument(
    database,
    environment,
    persisted.projectId,
    {
      kind: 'generated_result',
      ref: {
        authority: 'generated_result',
        id: persisted.id,
        revision: persisted.revision,
        contentHash: persisted.contentHash,
      },
    },
    'current',
    resultSearchText(persisted, asset.displayName, projectMediaRef.label),
    occurredAt,
  );
  return persisted;
}

async function finishWithReceipt(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  operationId: string,
  providerState: Extract<GenerationProviderState, { state: 'succeeded' | 'failed' | 'cancelled' }>,
  commandId: string,
  context: TargetCommandContext,
): Promise<GenerationSubmissionSuccess> {
  if (providerState.receipt === null || providerState.usage === null) {
    throw corrupt(`Generation Operation ${operationId} terminal provider state is incomplete`);
  }
  const initial = generationOperation(loadBoundOperation(database, operationId));
  if (['succeeded', 'failed', 'cancelled'].includes(initial.owner.view.state)) {
    return successForOperation(database, initial);
  }
  const input = acceptedInput(initial);
  const published = await publishProviderOutputsToCas(mediaCas, input, providerState.outputs);
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = generationOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'generation_attempt') {
      throw corrupt(`Generation Operation ${operationId} owner does not match`);
    }
    if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
      return successForOperation(database, current);
    }
    if (
      current.owner.view.receipt === null ||
      current.owner.view.receipt.receiptHash !== providerState.receipt!.receiptHash
    ) {
      throw corrupt(`Generation Operation ${operationId} terminal receipt does not match`);
    }
    const currentInput = acceptedInput(current);
    assertProjectRevision(
      database,
      current.dispatch.key.projectId,
      currentInput.expectedProjectRevision,
    );
    assertTarget(database, loadRun(database, current.dispatch.key.runId), currentInput.spec);
    assertPromptProvenance(database, loadRun(database, current.dispatch.key.runId), currentInput);
    const references = resolveReferences(
      database,
      loadRun(database, current.dispatch.key.runId),
      currentInput.spec,
      true,
    );
    for (const publication of published) {
      insertGeneratedResult(
        database,
        environment,
        current,
        currentInput,
        references.map(({ binding }) => binding),
        publication,
        providerState.usage!,
        commandId,
        context,
        occurredAt,
      );
    }
    settleGenerationCost(database, environment, current, providerState.usage!, occurredAt);
    const complete =
      published.length === currentInput.outputIntents.length &&
      new Set(published.map(({ output }) => output.variantIndex)).size ===
        currentInput.outputIntents.length;
    const state =
      providerState.state === 'succeeded' && complete
        ? 'succeeded'
        : providerState.state === 'cancelled'
          ? 'cancelled'
          : 'failed';
    const publicErrorCode =
      state === 'succeeded'
        ? null
        : state === 'cancelled'
          ? 'cancelled'
          : providerState.state === 'failed'
            ? providerState.publicErrorCode
            : 'execution_failed';
    const terminal = transitionAndRecord(
      database,
      environment,
      current,
      {
        state,
        receipt: current.owner.view.receipt,
        usage: providerState.usage,
        progressPercent: state === 'succeeded' ? 100 : current.owner.view.progressPercent,
        publicErrorCode,
        finishedAt: occurredAt,
        receiptReconciled: current.owner.view.state === 'unknown',
      },
      commandId,
      state,
      occurredAt,
      context,
    );
    return successForOperation(database, terminal);
  });
}

function markSubmitted(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
): GenerationSubmissionSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = generationOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'generation_attempt') {
      throw corrupt(`Generation Operation ${operationId} owner does not match`);
    }
    if (
      current.owner.view.state === 'submitted' ||
      current.owner.view.state === 'succeeded' ||
      current.owner.view.state === 'failed' ||
      current.owner.view.state === 'cancelled'
    ) {
      return successForOperation(database, current);
    }
    if (current.owner.view.state !== 'unknown' || current.owner.view.receipt === null) {
      throw corrupt(`Generation Operation ${operationId} cannot enter submitted state`);
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
      'submitted-reconciled',
      occurredAt,
      context,
    );
    return successForOperation(database, submitted);
  });
}

function claimProviderAction(
  database: DatabaseSync,
  snapshot: BoundOperationRecord,
  action: 'submit' | 'cancel',
): BoundOperationRecord {
  return withImmediateTransaction(database, () => {
    const current = generationOperation(loadBoundOperation(database, snapshot.dispatch.id));
    if (
      current.owner.view.revision !== snapshot.owner.view.revision ||
      current.owner.view.contentHash !== snapshot.owner.view.contentHash ||
      current.owner.view.state !== snapshot.owner.view.state
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Generation Operation ${current.dispatch.id} changed before provider ${action}`,
      );
    }
    if (current.owner.view.authority !== 'generation_attempt') {
      throw corrupt(`Generation Operation ${current.dispatch.id} owner does not match`);
    }
    const withoutHash = {
      ...current.owner.view,
      revision: current.owner.view.revision + 1,
      contentHash: '',
    };
    const claimedView = parseCanonical(GenerationAttemptViewSchema, {
      ...withoutHash,
      contentHash: hashContentObject(withoutHash),
    });
    const update = database
      .prepare(
        `UPDATE generation_attempts
         SET revision = ?, content_hash = ?
         WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
           AND cancel_requested = ?`,
      )
      .run(
        claimedView.revision,
        claimedView.contentHash,
        current.owner.view.id,
        current.owner.view.revision,
        current.owner.view.contentHash,
        current.owner.view.state,
        current.owner.view.cancelRequested ? 1 : 0,
      );
    if (Number(update.changes) !== 1) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Generation Operation ${current.dispatch.id} changed before provider ${action}`,
      );
    }
    const claimed = generationOperation(loadBoundOperation(database, current.dispatch.id));
    if (
      claimed.owner.view.authority !== 'generation_attempt' ||
      canonicalJson(claimed.owner.view) !== canonicalJson(claimedView)
    ) {
      throw corrupt(
        `Generation Operation ${current.dispatch.id} provider claim did not persist exactly`,
      );
    }
    return claimed;
  });
}

async function processProviderState(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  operationId: string,
  state: GenerationProviderState,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): Promise<GenerationSubmissionSuccess> {
  if (state.state === 'not_submitted') {
    return finishWithoutReceipt(
      database,
      environment,
      operationId,
      'failed',
      'provider_failed',
      commandId,
      context,
    );
  }
  if (state.receipt !== null) {
    persistReceipt(
      database,
      environment,
      operationId,
      state.receipt,
      reconciled,
      commandId,
      context,
    );
  }
  if (state.state === 'unknown') {
    return markUnknown(database, environment, operationId, commandId, context);
  }
  if (state.state === 'submitted') {
    return markSubmitted(database, environment, operationId, commandId, context);
  }
  if (state.receipt === null) {
    if (state.state === 'succeeded') {
      throw corrupt(`Generation Operation ${operationId} succeeded without a receipt`);
    }
    return finishWithoutReceipt(
      database,
      environment,
      operationId,
      state.state === 'cancelled' ? 'cancelled' : 'failed',
      state.state === 'cancelled' ? 'cancelled' : state.publicErrorCode,
      commandId,
      context,
    );
  }
  return finishWithReceipt(database, environment, mediaCas, operationId, state, commandId, context);
}

async function callProviderState(
  call: () => Promise<GenerationProviderState>,
): Promise<GenerationProviderState | undefined> {
  let value: unknown;
  try {
    value = await call();
    return parseProviderState(value);
  } catch {
    return undefined;
  }
}

async function verifyResolvedReferences(
  mediaCas: MediaCas,
  references: readonly ResolvedReference[],
): Promise<void> {
  await Promise.all(
    references.map(({ blob }) => mediaCas.verify({ hash: blob.hash, byteLength: blob.byteLength })),
  );
}

function assertAcceptedQuote(
  input: GenerationSubmitInput,
  freshQuote: GenerationQuote,
  requestHash: string,
  profile: GenerationProviderProfile,
  now: string,
): void {
  validateQuote(freshQuote, requestHash, profile, now);
  if (input.quote === null) return;
  const accepted = validateQuote(input.quote, requestHash, profile, now);
  if (canonicalJson(accepted) !== canonicalJson(freshQuote)) {
    throw invalid('Generation requote does not match the submitted quote');
  }
}

interface PreparedGeneration {
  readonly bound: BoundOperationRecord;
  readonly created: boolean;
}

function prepareGeneration(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  adapter: GenerationProviderAdapter,
  key: OperationDispatchKey,
  input: GenerationSubmitInput,
  profile: GenerationProviderProfile,
  freshQuote: GenerationQuote,
  expectedReferences: readonly ResolvedReference[],
  commandId: string,
  context: TargetCommandContext,
  existingDispatchOperationId?: string,
): PreparedGeneration {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const currentKey = resolveOperationDispatchKey(database, {
      runId: key.runId,
      toolId: 'generation.submit',
      toolVersion: key.toolVersion,
      input,
    });
    if (currentKey.fingerprint !== key.fingerprint) {
      throw corrupt('Generation Operation fingerprint changed before persistence');
    }
    const replay = findOperationByFingerprint(database, currentKey, existingDispatchOperationId);
    if (replay !== undefined && replay.operationKind !== null) {
      return {
        bound: generationOperation(loadBoundOperation(database, replay.id)),
        created: false,
      };
    }
    const run = loadRun(database, currentKey.runId);
    loadRunSnapshots(database, run);
    assertTarget(database, run, input.spec);
    assertProjectRevision(database, run.projectId, input.expectedProjectRevision);
    assertPromptProvenance(database, run, input);
    const currentProfile = loadProviderProfile(database, run, input.spec, adapter);
    if (canonicalJson(currentProfile) !== canonicalJson(profile)) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Generation Provider Profile changed before persistence',
      );
    }
    const currentReferences = resolveReferences(database, run, input.spec, true);
    if (
      canonicalJson(currentReferences.map(({ binding, blob }) => ({ binding, blob }))) !==
      canonicalJson(expectedReferences.map(({ binding, blob }) => ({ binding, blob })))
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Generation references changed before persistence',
      );
    }
    const requestHash = hashCanonical(generationRequestHashInput(input.spec));
    assertAcceptedQuote(input, freshQuote, requestHash, currentProfile, occurredAt);
    assertPermissionAndBudget(database, run, freshQuote, input.spec.outputCount);
    const request = parseCanonical(GenerationRequestSchema, {
      id: environment.createId('generation_request'),
      projectId: run.projectId,
      runId: run.id,
      spec: input.spec,
      requestHash,
      idempotencyKey: currentKey.fingerprint,
      createdAt: occurredAt,
    });
    database
      .prepare(
        `INSERT INTO generation_requests (
           id, project_id, run_id, target_authority, target_id, target_revision, target_hash,
           spec_v1_json, request_hash, idempotency_key, created_at
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
    const attemptWithoutHash = {
      authority: 'generation_attempt' as const,
      id: environment.createId('generation_attempt'),
      requestId: request.id,
      attemptNumber: 1,
      revision: 0,
      contentHash: '',
      state: 'prepared' as const,
      provider: profile.model,
      quote: freshQuote,
      receipt: null,
      usage: null,
      promptProvenance: input.promptProvenance,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      createdAt: occurredAt,
      finishedAt: null,
      request,
    };
    const attempt = parseCanonical(GenerationAttemptViewSchema, {
      ...attemptWithoutHash,
      contentHash: hashContentObject(attemptWithoutHash),
    });
    database
      .prepare(
        `INSERT INTO generation_attempts (
           id, request_id, attempt_number, revision, content_hash, state, provider_profile_id,
           provider_v1_json, quote_v1_json, provider_operation_id, receipt_v1_json,
           usage_v1_json, prompt_provenance_v1_json, cancel_requested, progress_percent,
           public_error_code, created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, 0, NULL, NULL, ?, NULL)`,
      )
      .run(
        attempt.id,
        attempt.requestId,
        attempt.attemptNumber,
        attempt.revision,
        attempt.contentHash,
        attempt.state,
        profile.id,
        canonicalJson(attempt.provider),
        canonicalJson(attempt.quote),
        canonicalJson(attempt.promptProvenance),
        attempt.createdAt,
      );
    const prepared = registerOperationDispatch(
      database,
      environment,
      {
        key: currentKey,
        existingDispatchOperationId,
        operationKind: 'generation_attempt',
        ownerAuthority: 'generation_attempt',
        ownerId: attempt.id,
        confirmationId: null,
        projectEventId: null,
        commandId: internalCommandId(commandId, currentKey.fingerprint, 'prepared'),
        occurredAt,
      },
      context,
    );
    appendGenerationReservations(
      database,
      environment,
      prepared,
      freshQuote,
      input.spec.outputCount,
      occurredAt,
    );
    const running = transitionAndRecord(
      database,
      environment,
      prepared,
      {
        state: 'running',
        receipt: null,
        usage: null,
        progressPercent: null,
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

function providerSubmitRequest(
  bound: BoundOperationRecord,
  profile: GenerationProviderProfile,
  references: readonly ResolvedReference[],
  mediaCas: MediaCas,
) {
  if (bound.owner.view.authority !== 'generation_attempt' || bound.owner.view.quote === null) {
    throw corrupt(
      `Generation Operation ${bound.dispatch.id} accepted provider state is incomplete`,
    );
  }
  const input = acceptedInput(bound);
  return {
    idempotencyKey: bound.dispatch.key.fingerprint,
    requestHash: bound.owner.view.request.requestHash,
    profile,
    spec: input.spec,
    quote: bound.owner.view.quote,
    promptProvenance: input.promptProvenance,
    outputIntents: input.outputIntents,
    references: providerReferences(references, mediaCas),
  };
}

function assertOnlyReceiptReconciliation(
  initial: BoundOperationRecord,
  current: BoundOperationRecord,
): void {
  if (
    current.owner.view.revision > initial.owner.view.revision + 1 ||
    current.owner.view.cancelRequested !== initial.owner.view.cancelRequested
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Generation Operation ${current.dispatch.id} changed during reconciliation`,
    );
  }
}

async function submitAfterAuthoritativeNotSubmitted(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  adapter: GenerationProviderAdapter,
  initial: BoundOperationRecord,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<GenerationSubmissionSuccess> {
  const current = generationOperation(loadBoundOperation(database, initial.dispatch.id));
  if (current.owner.view.authority !== 'generation_attempt') {
    throw corrupt(`Generation Operation ${current.dispatch.id} owner does not match`);
  }
  if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
    return successForOperation(database, current);
  }
  if (
    current.owner.view.revision !== initial.owner.view.revision ||
    current.owner.view.contentHash !== initial.owner.view.contentHash
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Generation Operation ${current.dispatch.id} changed during reconciliation`,
    );
  }
  if (current.owner.view.receipt !== null) {
    return markUnknown(database, environment, current.dispatch.id, commandId, context);
  }
  if (current.owner.view.cancelRequested) {
    return finishWithoutReceipt(
      database,
      environment,
      current.dispatch.id,
      'cancelled',
      'cancelled',
      commandId,
      context,
    );
  }
  let profile: GenerationProviderProfile;
  let references: ResolvedReference[];
  try {
    const run = loadRun(database, current.dispatch.key.runId);
    loadRunSnapshots(database, run);
    const input = acceptedInput(current);
    assertTarget(database, run, input.spec);
    assertProjectRevision(database, run.projectId, input.expectedProjectRevision);
    assertPromptProvenance(database, run, input);
    profile = acceptedProfile(database, current, adapter);
    references = resolveReferences(database, run, input.spec, true);
    if (current.owner.view.quote === null) {
      throw corrupt(`Generation Operation ${current.dispatch.id} has no accepted quote`);
    }
    validateQuote(
      current.owner.view.quote,
      current.owner.view.request.requestHash,
      profile,
      environment.now(),
    );
    await verifyResolvedReferences(mediaCas, references);
  } catch (cause) {
    if (cause instanceof TargetStorageError && cause.code === 'CORRUPT_DATA') throw cause;
    return finishWithoutReceipt(
      database,
      environment,
      current.dispatch.id,
      'failed',
      cause instanceof TargetStorageError ? 'invalid_request' : 'execution_failed',
      commandId,
      context,
    );
  }
  const claimed = claimProviderAction(database, current, 'submit');
  const state = await callProviderState(() =>
    adapter.submit(providerSubmitRequest(claimed, profile, references, mediaCas), signal),
  );
  return state === undefined
    ? markUnknown(database, environment, claimed.dispatch.id, commandId, context)
    : processProviderState(
        database,
        environment,
        mediaCas,
        claimed.dispatch.id,
        state,
        true,
        commandId,
        context,
      );
}

export function createGenerationAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
  mediaCas: MediaCas,
  adapter: GenerationProviderAdapter,
): GenerationAuthority {
  const database = () => getTargetStoreDatabase(store);
  return Object.freeze({
    async quote(inputValue: QuoteGenerationInput, signal?: AbortSignal) {
      let runId: string;
      let request: GenerationQuoteInput;
      try {
        runId = parseCanonical(EntityIdSchema, inputValue.runId);
        request = parseCanonical(GenerationQuoteInputSchema, inputValue.request);
      } catch {
        throw invalid('Generation quote input is invalid');
      }
      const run = loadRun(database(), runId);
      loadRunSnapshots(database(), run);
      assertTarget(database(), run, request.spec);
      const profile = loadProviderProfile(database(), run, request.spec, adapter);
      const references = resolveReferences(database(), run, request.spec, true);
      await verifyResolvedReferences(mediaCas, references);
      const requestHash = hashCanonical(generationRequestHashInput(request.spec));
      return quoteProvider(
        adapter,
        run,
        request.spec,
        profile,
        hashCanonical({ runId, requestHash, providerId: profile.id, phase: 'quote' }),
        environment.now(),
        signal,
      );
    },

    async submit(
      inputValue: SubmitGenerationInput,
      contextValue: TargetCommandContext,
      signal?: AbortSignal,
    ) {
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
        throw invalid('Generation submission command context is invalid');
      }
      const key = resolveOperationDispatchKey(database(), {
        runId: inputValue.runId,
        toolId: 'generation.submit',
        input: inputValue.request,
      });
      const replay = replayForKey(database(), key, dispatchOperationId);
      if (replay !== undefined) return replay;
      const input = parseCanonical(GenerationSubmitInputSchema, key.input);
      const run = loadRun(database(), key.runId);
      loadRunSnapshots(database(), run);
      assertTarget(database(), run, input.spec);
      assertProjectRevision(database(), run.projectId, input.expectedProjectRevision);
      assertPromptProvenance(database(), run, input);
      const profile = loadProviderProfile(database(), run, input.spec, adapter);
      const references = resolveReferences(database(), run, input.spec, true);
      await verifyResolvedReferences(mediaCas, references);
      const requestHash = hashCanonical(generationRequestHashInput(input.spec));
      if (input.quote !== null) {
        validateQuote(input.quote, requestHash, profile, environment.now());
      }
      const quoteResult = await quoteProvider(
        adapter,
        run,
        input.spec,
        profile,
        key.fingerprint,
        environment.now(),
        signal,
      );
      assertAcceptedQuote(input, quoteResult.quote, requestHash, profile, environment.now());
      assertPermissionAndBudget(database(), run, quoteResult.quote, input.spec.outputCount);
      const prepared = prepareGeneration(
        database(),
        environment,
        adapter,
        key,
        input,
        profile,
        quoteResult.quote,
        references,
        commandId,
        context,
        dispatchOperationId,
      );
      if (!prepared.created) return successForOperation(database(), prepared.bound);
      const state = await callProviderState(() =>
        adapter.submit(
          providerSubmitRequest(prepared.bound, profile, references, mediaCas),
          signal,
        ),
      );
      return state === undefined
        ? markUnknown(database(), environment, prepared.bound.dispatch.id, commandId, context)
        : processProviderState(
            database(),
            environment,
            mediaCas,
            prepared.bound.dispatch.id,
            state,
            false,
            commandId,
            context,
          );
    },

    async reconcile(
      inputValue: ReconcileGenerationInput,
      contextValue: TargetCommandContext,
      signal?: AbortSignal,
    ) {
      let operation: GenerationOperationRef;
      let expectedRevision: number;
      let commandId: string;
      let context: TargetCommandContext;
      try {
        operation = parseCanonical(GenerationOperationRefSchema, inputValue.operation);
        expectedRevision = parseCanonical(RevisionSchema, inputValue.expectedRevision);
        commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
        context = parseCanonical(TargetCommandContextSchema, contextValue);
      } catch {
        throw invalid('Generation reconciliation input is invalid');
      }
      const initial = generationOperation(loadBoundOperation(database(), operation.id));
      assertOperationRefIdentity(initial, operation);
      if (['succeeded', 'failed', 'cancelled'].includes(initial.owner.view.state)) {
        return successForOperation(database(), initial);
      }
      assertExactGenerationRef(initial, operation, expectedRevision);
      if (initial.owner.view.authority !== 'generation_attempt') {
        throw corrupt(`Generation Operation ${operation.id} owner does not match`);
      }
      const initialView = initial.owner.view;
      const profile = acceptedProfile(database(), initial, adapter);
      if (initialView.receipt !== null && initialView.cancelRequested) {
        const claimed = claimProviderAction(database(), initial, 'cancel');
        if (
          claimed.owner.view.authority !== 'generation_attempt' ||
          claimed.owner.view.receipt === null
        ) {
          throw corrupt(
            `Generation Operation ${operation.id} lost its receipt before cancellation`,
          );
        }
        const claimedView = claimed.owner.view;
        const cancelled = await callProviderState(() =>
          adapter.cancel(
            {
              idempotencyKey: claimed.dispatch.key.fingerprint,
              requestHash: claimedView.request.requestHash,
              profile,
              receipt: claimedView.receipt!,
            },
            signal,
          ),
        );
        return cancelled === undefined || cancelled.state === 'not_submitted'
          ? markUnknown(database(), environment, operation.id, commandId, context)
          : processProviderState(
              database(),
              environment,
              mediaCas,
              operation.id,
              cancelled,
              true,
              commandId,
              context,
            );
      }
      const reconciled = await callProviderState(() =>
        adapter.reconcileByIdempotencyKey(
          {
            idempotencyKey: initial.dispatch.key.fingerprint,
            requestHash: initialView.request.requestHash,
            profile,
            receipt: initialView.receipt,
          },
          signal,
        ),
      );
      if (reconciled === undefined) {
        return markUnknown(database(), environment, operation.id, commandId, context);
      }
      if (reconciled.state === 'not_submitted') {
        return submitAfterAuthoritativeNotSubmitted(
          database(),
          environment,
          mediaCas,
          adapter,
          initial,
          commandId,
          context,
          signal,
        );
      }
      if (reconciled.receipt !== null) {
        persistReceipt(
          database(),
          environment,
          operation.id,
          reconciled.receipt,
          true,
          commandId,
          context,
        );
      }
      const current = generationOperation(loadBoundOperation(database(), operation.id));
      assertOnlyReceiptReconciliation(initial, current);
      if (
        current.owner.view.authority === 'generation_attempt' &&
        current.owner.view.cancelRequested &&
        current.owner.view.receipt !== null &&
        (reconciled.state === 'unknown' || reconciled.state === 'submitted')
      ) {
        const claimed = claimProviderAction(database(), current, 'cancel');
        if (
          claimed.owner.view.authority !== 'generation_attempt' ||
          claimed.owner.view.receipt === null
        ) {
          throw corrupt(
            `Generation Operation ${operation.id} lost its receipt before cancellation`,
          );
        }
        const claimedView = claimed.owner.view;
        const cancelled = await callProviderState(() =>
          adapter.cancel(
            {
              idempotencyKey: claimed.dispatch.key.fingerprint,
              requestHash: claimedView.request.requestHash,
              profile,
              receipt: claimedView.receipt!,
            },
            signal,
          ),
        );
        return cancelled === undefined || cancelled.state === 'not_submitted'
          ? markUnknown(database(), environment, operation.id, commandId, context)
          : processProviderState(
              database(),
              environment,
              mediaCas,
              operation.id,
              cancelled,
              true,
              commandId,
              context,
            );
      }
      return processProviderState(
        database(),
        environment,
        mediaCas,
        operation.id,
        reconciled,
        true,
        commandId,
        context,
      );
    },
  });
}
