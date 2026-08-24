import {
  ArtifactRefSchema,
  EntityIdSchema,
  EvaluationFindingSchema,
  EvaluationInputSchema,
  EvaluationSuccessSchema,
  FinalAssessmentSchema,
  ProviderReceiptSchema,
  ProviderUsageSchema,
  ResourceAmountSchema,
  ResultAssessmentAttemptViewSchema,
  ResultAssessmentOperationRefSchema,
  RevisionSchema,
  canonicalJson,
  evaluationRequestHashInput,
  finalAssessmentHashInput,
  parseCanonical,
  providerReceiptHashInput,
  type DomainObjectRef,
  type MediaBlob,
  type OperationPublicErrorCode,
  type ProviderReceipt,
  type ProviderUsage,
  type ResourceAmount,
  type Run,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getSettings } from './projects.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { TargetCommandContextSchema, type TargetCommandContext } from '../internal/command.js';
import { requireCurrentDomainObject } from '../internal/domain-object-resolver.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import {
  addExactDecimals,
  compareExactDecimals,
  parseExactDecimal,
} from '../internal/exact-decimal.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  loadGlobalMediaAsset,
  loadMediaBlob,
  loadProjectMediaRecord,
} from '../internal/media-records.js';
import {
  appendOperationCostReservation,
  releaseOperationCostReservation,
  settleOperationCostReservation,
} from '../internal/operation-cost-ledger.js';
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
  transitionResultAssessmentOwner,
} from '../internal/operation-owner-records.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { loadProviderProfileRecord } from '../internal/provider-profile-records.js';
import { loadRunBudgetExposure } from '../internal/run-budget.js';
import { loadRun } from '../internal/run-records.js';
import { loadRunSnapshots } from '../internal/run-snapshots.js';
import { upsertProjectSearchDocument } from '../internal/search-projection.js';
import { TargetStorageError } from '../kernel/errors.js';
import type {
  ResultAssessmentProviderAdapter,
  ResultAssessmentProviderEvidence,
  ResultAssessmentProviderProfile,
  ResultAssessmentProviderState,
  ResultAssessmentProviderSubject,
} from '../kernel/result-assessment-provider.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

type EvaluationInput = z.output<typeof EvaluationInputSchema>;
type EvaluationSuccess = z.output<typeof EvaluationSuccessSchema>;
type AssessmentOperationRef = z.output<typeof ResultAssessmentOperationRefSchema>;
type FinalAssessment = z.output<typeof FinalAssessmentSchema>;

export interface StartResultAssessmentInput {
  readonly runId: string;
  readonly commandId: string;
  readonly request: EvaluationInput;
  /** Internal runtime binding; callers never include this in the tool contract. */
  readonly dispatchOperationId?: string;
}

export interface ContinueResultAssessmentInput {
  readonly operation: AssessmentOperationRef;
  readonly expectedRevision: number;
  readonly commandId: string;
}

export interface ResultAssessmentsAuthority {
  readonly start: (
    input: StartResultAssessmentInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<EvaluationSuccess>;
  readonly executeLocal: (
    input: ContinueResultAssessmentInput,
    context: TargetCommandContext,
  ) => Promise<EvaluationSuccess>;
  readonly submitProvider: (
    input: ContinueResultAssessmentInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<EvaluationSuccess>;
  readonly reconcileProvider: (
    input: ContinueResultAssessmentInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<EvaluationSuccess>;
  readonly acknowledgeCancellation: (
    input: ContinueResultAssessmentInput,
    context: TargetCommandContext,
    signal?: AbortSignal,
  ) => Promise<EvaluationSuccess>;
}

const ProviderEvidenceSchema = z.strictObject({
  findings: z.array(EvaluationFindingSchema).max(500),
  limitations: z.array(z.string().min(1).max(4_000)).max(100),
  recommendations: z.array(z.string().min(1).max(4_000)).max(100),
  artifacts: z.array(ArtifactRefSchema).max(100),
});
const ProviderStateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('not_submitted') }),
  z.strictObject({
    state: z.literal('unknown'),
    receipt: ProviderReceiptSchema.nullable(),
    usage: ProviderUsageSchema.nullable(),
  }),
  z.strictObject({
    state: z.literal('submitted'),
    receipt: ProviderReceiptSchema,
    usage: z.null(),
  }),
  z.strictObject({
    state: z.literal('succeeded'),
    receipt: ProviderReceiptSchema,
    usage: ProviderUsageSchema,
    assessment: ProviderEvidenceSchema,
  }),
  z.strictObject({
    state: z.literal('failed'),
    receipt: ProviderReceiptSchema.nullable(),
    usage: ProviderUsageSchema.nullable(),
    publicErrorCode: z.enum(['provider_failed', 'execution_failed']),
  }),
  z.strictObject({
    state: z.literal('cancelled'),
    receipt: ProviderReceiptSchema.nullable(),
    usage: ProviderUsageSchema.nullable(),
  }),
]);
const ProviderQuoteSchema = z.strictObject({ cost: ResourceAmountSchema });

function invalid(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message);
}

function isLocal(request: EvaluationInput): boolean {
  return request.kind === 'technical_integrity' || request.kind === 'delivery_readiness';
}

function internalCommandId(commandId: string, fingerprint: string, phase: string): string {
  return hashCanonical({
    commandId: parseCanonical(EntityIdSchema, commandId),
    fingerprint,
    phase,
  });
}

function assessmentOperation(bound: BoundOperationRecord): BoundOperationRecord {
  if (
    bound.dispatch.operationKind !== 'result_assessment' ||
    bound.owner.authority !== 'result_assessment_attempt' ||
    bound.owner.view.authority !== 'result_assessment_attempt'
  ) {
    throw invalid(`Operation ${bound.dispatch.id} is not a Result Assessment`);
  }
  return bound;
}

function successForOperation(
  database: DatabaseSync,
  input: BoundOperationRecord,
): EvaluationSuccess {
  const bound = assessmentOperation(input);
  if (bound.owner.view.authority !== 'result_assessment_attempt') {
    throw corrupt(`Result Assessment Operation ${bound.dispatch.id} owner does not match`);
  }
  const publicView = operationPublicViewForOwner(
    database,
    bound.dispatch.id,
    bound.owner,
    bound.dispatch.key.input,
  );
  return parseCanonical(EvaluationSuccessSchema, {
    operation: publicView.ref,
    assessmentId: bound.owner.view.id,
    state: bound.owner.view.state,
    assessment: bound.owner.view.assessment,
  });
}

/** Rebuilds the canonical evaluation result for an already-bound assessment dispatch. */
export function resultAssessmentSuccessForDispatch(
  database: DatabaseSync,
  dispatchOperationId: string,
): EvaluationSuccess {
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

function assertExactRef(
  bound: BoundOperationRecord,
  ref: AssessmentOperationRef,
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
      `Result Assessment Operation ${ref.id} does not match its current revision`,
    );
  }
}

function providerProfile(
  database: DatabaseSync,
  run: Run,
  request: EvaluationInput,
  adapter: ResultAssessmentProviderAdapter,
): ResultAssessmentProviderProfile {
  if (isLocal(request) || request.provider === null) {
    throw invalid('Local Result Assessment cannot resolve a provider');
  }
  const requestedId =
    request.provider.providerId ?? getSettings(database, run.projectId).defaultProviderProfileId;
  if (requestedId === null) throw invalid('Result Assessment has no configured Provider Profile');
  const profile = loadProviderProfileRecord(database, requestedId, adapter, 'Result Assessment');
  if (
    request.provider !== null &&
    (request.provider.providerId !== profile.model.providerId ||
      request.provider.model !== profile.model.model)
  ) {
    throw invalid('Result Assessment Provider Profile does not match the requested provider');
  }
  return profile;
}

function acceptedProfile(
  database: DatabaseSync,
  bound: BoundOperationRecord,
  adapter: ResultAssessmentProviderAdapter,
): ResultAssessmentProviderProfile {
  if (
    bound.owner.view.authority !== 'result_assessment_attempt' ||
    bound.owner.view.provider === null
  ) {
    throw invalid(`Result Assessment Operation ${bound.dispatch.id} is local`);
  }
  return loadProviderProfileRecord(
    database,
    bound.owner.view.provider.providerId,
    adapter,
    'Result Assessment',
    bound.owner.view.provider,
  );
}

function mediaBlobForRef(database: DatabaseSync, ref: DomainObjectRef): MediaBlob | null {
  if (ref.authority === 'generated_result') {
    const result = loadGeneratedResultRecord(database, ref.id);
    return loadMediaBlob(database, result.mediaBlobHash);
  }
  if (ref.authority === 'project_media_ref') {
    const projectMedia = loadProjectMediaRecord(database, ref.id);
    const asset = loadGlobalMediaAsset(database, projectMedia.globalAssetId);
    return loadMediaBlob(database, asset.blobHash);
  }
  return null;
}

function resolveSubjects(
  database: DatabaseSync,
  run: Run,
  request: EvaluationInput,
): ResultAssessmentProviderSubject[] {
  const frozen = [
    ...request.subjects.map((ref) => ({ role: 'subject' as const, ref })),
    ...(request.kind === 'reference_similarity'
      ? request.references.map((ref) => ({ role: 'reference' as const, ref }))
      : []),
  ];
  return frozen.map(({ role, ref }) => {
    requireCurrentDomainObject(database, run.projectId, ref);
    return { role, ref, blob: mediaBlobForRef(database, ref) };
  });
}

/** Local checks safe to run inside the atomic model-dispatch start boundary. */
export function assertEvaluationRunModelBoundary(
  database: DatabaseSync,
  run: Run,
  request: EvaluationInput,
): void {
  loadRunSnapshots(database, run);
  resolveSubjects(database, run, request);
}

function assertProviderBudget(database: DatabaseSync, run: Run, amount: ResourceAmount): void {
  if (run.permissionMode === 'read_only') {
    throw invalid('Provider Result Assessment is denied by the Run read-only permission');
  }
  const exposure = loadRunBudgetExposure(database, run);
  if (amount.currency !== exposure.costCurrency) {
    throw invalid('Result Assessment quote currency does not match the Run budget');
  }
  if (run.budget.costUsd.state === 'unknown') return;
  if (amount.state === 'unknown' || exposure.cost === null) {
    throw invalid('Result Assessment with unknown cost is denied by the finite Run budget');
  }
  if (
    compareExactDecimals(
      addExactDecimals(exposure.cost, parseExactDecimal(amount.value)),
      parseExactDecimal(run.budget.costUsd.value),
    ) > 0
  ) {
    throw invalid('Result Assessment exceeds the Run cost budget');
  }
}

async function quoteProvider(
  adapter: ResultAssessmentProviderAdapter,
  profile: ResultAssessmentProviderProfile,
  key: OperationDispatchKey,
  requestHash: string,
  request: EvaluationInput,
  subjects: readonly ResultAssessmentProviderSubject[],
  signal?: AbortSignal,
): Promise<ResourceAmount> {
  let raw: unknown;
  try {
    raw = await adapter.quote(
      {
        idempotencyKey: key.fingerprint,
        requestHash,
        profile,
        request,
        subjects,
      },
      signal,
    );
  } catch {
    throw invalid('Result Assessment provider quote failed');
  }
  try {
    return parseCanonical(ProviderQuoteSchema, raw).cost;
  } catch {
    throw corrupt('Result Assessment provider quote is invalid');
  }
}

function transitionAndRecord(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  input: Parameters<typeof transitionResultAssessmentOwner>[2],
  commandId: string,
  phase: string,
  occurredAt: string,
  context: TargetCommandContext,
): BoundOperationRecord {
  const after = transitionResultAssessmentOwner(database, bound.owner, input);
  recordOperationOwnerTransitions(
    database,
    environment,
    [{ dispatch: bound.dispatch, before: bound.owner, after }],
    internalCommandId(commandId, bound.dispatch.key.fingerprint, phase),
    occurredAt,
    context,
  );
  return assessmentOperation(loadBoundOperation(database, bound.dispatch.id));
}

function prepareAssessment(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  adapter: ResultAssessmentProviderAdapter,
  key: OperationDispatchKey,
  expectedRequest: EvaluationInput,
  expectedProfile: ResultAssessmentProviderProfile | null,
  cost: ResourceAmount | null,
  commandId: string,
  context: TargetCommandContext,
  existingDispatchOperationId?: string,
): { readonly bound: BoundOperationRecord; readonly created: boolean } {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const currentKey = resolveOperationDispatchKey(database, {
      runId: key.runId,
      toolId: 'evaluation.run',
      input: expectedRequest,
    });
    if (currentKey.fingerprint !== key.fingerprint) {
      throw new TargetStorageError('REVISION_CONFLICT', 'Result Assessment input changed');
    }
    const replay = findOperationByFingerprint(database, currentKey, existingDispatchOperationId);
    if (replay !== undefined && replay.operationKind !== null) {
      return {
        bound: assessmentOperation(loadBoundOperation(database, replay.id)),
        created: false,
      };
    }
    const run = loadRun(database, currentKey.runId);
    loadRunSnapshots(database, run);
    const request = parseCanonical(EvaluationInputSchema, currentKey.input);
    if (canonicalJson(request) !== canonicalJson(expectedRequest)) {
      throw new TargetStorageError('REVISION_CONFLICT', 'Result Assessment request changed');
    }
    resolveSubjects(database, run, request);
    let profile: ResultAssessmentProviderProfile | null = null;
    if (!isLocal(request)) {
      profile = providerProfile(database, run, request, adapter);
      if (canonicalJson(profile) !== canonicalJson(expectedProfile) || cost === null) {
        throw new TargetStorageError('REVISION_CONFLICT', 'Result Assessment provider changed');
      }
      assertProviderBudget(database, run, cost);
    } else if (expectedProfile !== null || cost !== null) {
      throw corrupt('Local Result Assessment received provider state');
    }
    const requestHash = hashCanonical(evaluationRequestHashInput(request));
    const withoutHash = {
      authority: 'result_assessment_attempt' as const,
      id: environment.createId('result_assessment_attempt'),
      projectId: run.projectId,
      runId: run.id,
      revision: 0,
      contentHash: '',
      request,
      requestHash,
      idempotencyKey: currentKey.fingerprint,
      state: 'prepared' as const,
      provider: profile?.model ?? null,
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      createdAt: occurredAt,
      finishedAt: null,
      assessment: null,
    };
    const attempt = parseCanonical(ResultAssessmentAttemptViewSchema, {
      ...withoutHash,
      contentHash: hashContentObject(withoutHash),
    });
    database
      .prepare(
        `INSERT INTO result_assessment_attempts (
           id, project_id, run_id, revision, content_hash, assessment_kind,
           request_v1_json, state, provider_profile_id, provider_v1_json,
           provider_operation_id, receipt_v1_json, usage_v1_json, request_hash,
           idempotency_key, cancel_requested, progress_percent, public_error_code,
           created_at, finished_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, NULL, NULL, NULL, ?, ?, 0, NULL, NULL, ?, NULL)`,
      )
      .run(
        attempt.id,
        attempt.projectId,
        attempt.runId,
        attempt.revision,
        attempt.contentHash,
        attempt.request.kind,
        canonicalJson(attempt.request),
        profile?.id ?? null,
        attempt.provider === null ? null : canonicalJson(attempt.provider),
        attempt.requestHash,
        attempt.idempotencyKey,
        attempt.createdAt,
      );
    const frozen = resolveSubjects(database, run, request);
    const ordinals = { subject: 0, reference: 0 };
    for (const subject of frozen) {
      database
        .prepare(
          `INSERT INTO result_assessment_subjects (
             attempt_id, role, ordinal, authority, object_id, revision, content_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          attempt.id,
          subject.role,
          ordinals[subject.role]++,
          subject.ref.authority,
          subject.ref.id,
          subject.ref.revision,
          subject.ref.contentHash,
        );
    }
    const registered = registerOperationDispatch(
      database,
      environment,
      {
        key: currentKey,
        existingDispatchOperationId,
        operationKind: 'result_assessment',
        ownerAuthority: 'result_assessment_attempt',
        ownerId: attempt.id,
        confirmationId: null,
        projectEventId: null,
        commandId: internalCommandId(commandId, currentKey.fingerprint, 'registered'),
        occurredAt,
      },
      context,
    );
    if (cost !== null) {
      appendOperationCostReservation(database, environment, registered, cost, occurredAt);
    }
    const running = transitionAndRecord(
      database,
      environment,
      registered,
      {
        state: 'running',
        receipt: null,
        usage: null,
        progressPercent: 0,
        publicErrorCode: null,
        finishedAt: null,
        receiptReconciled: false,
        assessment: null,
      },
      commandId,
      'running',
      occurredAt,
      context,
    );
    return { bound: running, created: true };
  });
}

function finalAssessment(
  request: EvaluationInput,
  evidence: ResultAssessmentProviderEvidence,
  createdAt: string,
): FinalAssessment {
  const withoutHash = {
    kind: request.kind,
    subjects: [
      ...request.subjects.map((ref) => ({ role: 'subject' as const, ref })),
      ...(request.kind === 'reference_similarity'
        ? request.references.map((ref) => ({ role: 'reference' as const, ref }))
        : []),
    ],
    findings: evidence.findings,
    limitations: evidence.limitations,
    recommendations: evidence.recommendations,
    artifacts: evidence.artifacts,
    createdAt,
    assessmentHash: '',
  };
  return parseCanonical(FinalAssessmentSchema, {
    ...withoutHash,
    assessmentHash: hashCanonical(finalAssessmentHashInput(withoutHash as FinalAssessment)),
  });
}

function searchText(assessment: FinalAssessment): string {
  return [
    assessment.kind,
    ...assessment.subjects.map(({ role, ref }) => `${role} ${ref.authority} ${ref.id}`),
    ...assessment.findings.flatMap(({ severity, criterion, finding }) => [
      severity,
      criterion,
      finding,
    ]),
    ...assessment.limitations,
    ...assessment.recommendations,
  ].join('\n');
}

function publishAssessment(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  evidence: ResultAssessmentProviderEvidence,
  usage: ProviderUsage | null,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): EvaluationSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = assessmentOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'result_assessment_attempt') {
      throw corrupt(`Result Assessment Operation ${operationId} owner does not match`);
    }
    if (current.owner.view.state === 'succeeded') return successForOperation(database, current);
    if (current.owner.view.state === 'failed' || current.owner.view.state === 'cancelled') {
      return successForOperation(database, current);
    }
    const run = loadRun(database, current.dispatch.key.runId);
    resolveSubjects(database, run, current.owner.view.request);
    const assessment = finalAssessment(current.owner.view.request, evidence, occurredAt);
    database
      .prepare(
        `INSERT INTO result_assessments (
           attempt_id, assessment_v1_json, content_hash, created_at
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(current.owner.view.id, canonicalJson(assessment), assessment.assessmentHash, occurredAt);
    if (current.owner.view.provider !== null) {
      if (usage === null) throw corrupt(`Provider Result Assessment ${operationId} has no usage`);
      settleOperationCostReservation(
        database,
        environment,
        current,
        usage,
        occurredAt,
        `Result Assessment Operation ${operationId}`,
      );
    } else if (usage !== null) {
      throw corrupt(`Local Result Assessment ${operationId} contains provider usage`);
    }
    const terminal = transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'succeeded',
        receipt: current.owner.view.receipt,
        usage,
        progressPercent: 100,
        publicErrorCode: null,
        finishedAt: occurredAt,
        receiptReconciled: reconciled && current.owner.view.state === 'unknown',
        assessment,
      },
      commandId,
      'succeeded',
      occurredAt,
      context,
    );
    if (terminal.owner.view.authority !== 'result_assessment_attempt') {
      throw corrupt(`Result Assessment Operation ${operationId} terminal owner does not match`);
    }
    const ownerRef = {
      authority: 'result_assessment_attempt' as const,
      id: terminal.owner.view.id,
      revision: terminal.owner.view.revision,
      contentHash: terminal.owner.view.contentHash,
    };
    appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: terminal.owner.projectId,
      occurredAt,
      actor: context.actor,
      subject: { authority: ownerRef.authority, id: ownerRef.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: internalCommandId(commandId, terminal.dispatch.key.fingerprint, 'created'),
      payload: {
        type: 'object_created',
        revision: 0,
        contentHash: ownerRef.contentHash,
      },
    });
    upsertProjectSearchDocument(
      database,
      environment,
      terminal.owner.projectId,
      { kind: 'result_assessment', ref: ownerRef },
      'current',
      searchText(assessment),
      occurredAt,
    );
    return successForOperation(database, terminal);
  });
}

function localEvidence(
  database: DatabaseSync,
  request: EvaluationInput,
): ResultAssessmentProviderEvidence {
  const findings: z.output<typeof EvaluationFindingSchema>[] = [];
  const limitations: string[] = [];
  for (const subject of request.subjects) {
    const blob = mediaBlobForRef(database, subject);
    if (request.kind === 'technical_integrity') {
      if (blob === null) {
        findings.push({
          severity: 'warning',
          subjectRef: subject,
          criterion: 'media_backing',
          finding: 'The frozen subject is not backed by a stored media blob.',
          evidenceRefs: [subject],
        });
      } else if (subject.authority === 'generated_result') {
        const result = loadGeneratedResultRecord(database, subject.id);
        if (result.technicalValidation.state === 'invalid') {
          findings.push({
            severity: 'error',
            subjectRef: subject,
            criterion: 'technical_validation',
            finding: `Stored technical validation failed: ${result.technicalValidation.failureCode ?? 'unknown'}.`,
            evidenceRefs: [subject],
          });
        }
      }
    } else if (request.kind === 'delivery_readiness' && subject.authority !== 'delivery') {
      findings.push({
        severity: 'warning',
        subjectRef: subject,
        criterion: 'delivery_subject',
        finding: 'The frozen subject is not a Delivery plan.',
        evidenceRefs: [subject],
      });
    }
  }
  if (request.kind === 'technical_integrity' && request.checks.includes('audio_presence')) {
    limitations.push('Audio presence is limited to facts represented by the frozen media blob.');
  }
  return { findings, limitations, recommendations: [], artifacts: [] };
}

function finishTerminal(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  state: 'failed' | 'cancelled',
  publicErrorCode: OperationPublicErrorCode,
  usage: ProviderUsage | null,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): EvaluationSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = assessmentOperation(loadBoundOperation(database, operationId));
    if (['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)) {
      return successForOperation(database, current);
    }
    if (current.owner.view.provider !== null) {
      if (usage === null) {
        releaseOperationCostReservation(
          database,
          environment,
          current,
          occurredAt,
          `Result Assessment Operation ${operationId}`,
        );
      } else {
        settleOperationCostReservation(
          database,
          environment,
          current,
          usage,
          occurredAt,
          `Result Assessment Operation ${operationId}`,
        );
      }
    }
    const terminal = transitionAndRecord(
      database,
      environment,
      current,
      {
        state,
        receipt: current.owner.view.receipt,
        usage,
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode,
        finishedAt: occurredAt,
        receiptReconciled: reconciled && current.owner.view.state === 'unknown',
        assessment: null,
      },
      commandId,
      state,
      occurredAt,
      context,
    );
    return successForOperation(database, terminal);
  });
}

function markUnknown(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  commandId: string,
  context: TargetCommandContext,
): EvaluationSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = assessmentOperation(loadBoundOperation(database, operationId));
    if (
      current.owner.view.state === 'unknown' ||
      ['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)
    ) {
      return successForOperation(database, current);
    }
    const unknown = transitionAndRecord(
      database,
      environment,
      current,
      {
        state: 'unknown',
        receipt: current.owner.view.receipt,
        usage: current.owner.view.usage,
        progressPercent: current.owner.view.progressPercent,
        publicErrorCode: 'provider_state_unknown',
        finishedAt: null,
        receiptReconciled: false,
        assessment: null,
      },
      commandId,
      'unknown',
      occurredAt,
      context,
    );
    return successForOperation(database, unknown);
  });
}

function reconciledReceipt(receipt: ProviderReceipt, at: string): ProviderReceipt {
  return { ...receipt, reconciledAt: at };
}

function assertReceipt(receipt: ProviderReceipt): void {
  if (hashCanonical(providerReceiptHashInput(receipt)) !== receipt.receiptHash) {
    throw corrupt('Result Assessment provider receipt hash does not match');
  }
}

function persistReceipt(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  receiptInput: ProviderReceipt,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): BoundOperationRecord {
  const occurredAt = environment.now();
  const receipt = parseCanonical(ProviderReceiptSchema, receiptInput);
  assertReceipt(receipt);
  return withImmediateTransaction(database, () => {
    const current = assessmentOperation(loadBoundOperation(database, operationId));
    if (current.owner.view.authority !== 'result_assessment_attempt') {
      throw corrupt(`Result Assessment Operation ${operationId} owner does not match`);
    }
    const normalized = reconciled ? reconciledReceipt(receipt, occurredAt) : receipt;
    const existing = current.owner.view.receipt;
    if (
      existing !== null &&
      (existing.providerOperationId !== normalized.providerOperationId ||
        existing.submittedAt !== normalized.submittedAt ||
        existing.receiptHash !== normalized.receiptHash)
    ) {
      throw corrupt(`Result Assessment Operation ${operationId} provider receipt changed`);
    }
    const accepted = existing?.reconciledAt !== null && existing !== null ? existing : normalized;
    if (canonicalJson(existing) === canonicalJson(accepted)) return current;
    const transition = {
      state: current.owner.view.state === 'unknown' ? ('unknown' as const) : ('submitted' as const),
      receipt: accepted,
      usage: current.owner.view.usage,
      progressPercent: current.owner.view.progressPercent,
      publicErrorCode:
        current.owner.view.state === 'unknown' ? ('provider_state_unknown' as const) : null,
      finishedAt: null,
      receiptReconciled: reconciled && current.owner.view.state === 'unknown',
      assessment: null,
    };
    if (current.owner.view.state === 'unknown') {
      transitionResultAssessmentOwner(database, current.owner, transition);
      return assessmentOperation(loadBoundOperation(database, operationId));
    }
    return transitionAndRecord(
      database,
      environment,
      current,
      transition,
      commandId,
      'receipt',
      occurredAt,
      context,
    );
  });
}

function markSubmitted(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): EvaluationSuccess {
  const occurredAt = environment.now();
  return withImmediateTransaction(database, () => {
    const current = assessmentOperation(loadBoundOperation(database, operationId));
    if (
      current.owner.view.state === 'submitted' ||
      ['succeeded', 'failed', 'cancelled'].includes(current.owner.view.state)
    ) {
      return successForOperation(database, current);
    }
    if (current.owner.view.receipt === null) {
      throw corrupt(
        `Result Assessment Operation ${operationId} cannot be submitted without a receipt`,
      );
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
        receiptReconciled: reconciled && current.owner.view.state === 'unknown',
        assessment: null,
      },
      commandId,
      'submitted',
      occurredAt,
      context,
    );
    return successForOperation(database, submitted);
  });
}

function parseProviderState(value: unknown): ResultAssessmentProviderState {
  let state: ResultAssessmentProviderState;
  try {
    state = parseCanonical(ProviderStateSchema, value) as ResultAssessmentProviderState;
  } catch {
    throw corrupt('Result Assessment provider state is invalid');
  }
  if (state.state !== 'not_submitted' && state.receipt !== null) assertReceipt(state.receipt);
  return state;
}

async function callProviderState(
  action: () => Promise<ResultAssessmentProviderState>,
): Promise<ResultAssessmentProviderState | undefined> {
  try {
    return parseProviderState(await action());
  } catch {
    return undefined;
  }
}

function claimProviderAction(
  database: DatabaseSync,
  snapshot: BoundOperationRecord,
  action: 'submit' | 'cancel',
): BoundOperationRecord {
  return withImmediateTransaction(database, () => {
    const current = assessmentOperation(loadBoundOperation(database, snapshot.dispatch.id));
    if (
      current.owner.view.revision !== snapshot.owner.view.revision ||
      current.owner.view.contentHash !== snapshot.owner.view.contentHash ||
      current.owner.view.state !== snapshot.owner.view.state
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Result Assessment Operation ${current.dispatch.id} changed before provider ${action}`,
      );
    }
    if (current.owner.view.authority !== 'result_assessment_attempt') {
      throw corrupt(`Result Assessment Operation ${current.dispatch.id} owner does not match`);
    }
    const withoutHash = {
      ...current.owner.view,
      revision: current.owner.view.revision + 1,
      contentHash: '',
    };
    const claimed = parseCanonical(ResultAssessmentAttemptViewSchema, {
      ...withoutHash,
      contentHash: hashContentObject(withoutHash),
    });
    const updated = database
      .prepare(
        `UPDATE result_assessment_attempts SET revision = ?, content_hash = ?
         WHERE id = ? AND revision = ? AND content_hash = ? AND state = ?
           AND cancel_requested = ?`,
      )
      .run(
        claimed.revision,
        claimed.contentHash,
        current.owner.view.id,
        current.owner.view.revision,
        current.owner.view.contentHash,
        current.owner.view.state,
        current.owner.view.cancelRequested ? 1 : 0,
      );
    if (Number(updated.changes) !== 1) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Result Assessment Operation ${current.dispatch.id} changed before provider ${action}`,
      );
    }
    const bound = assessmentOperation(loadBoundOperation(database, current.dispatch.id));
    if (canonicalJson(bound.owner.view) !== canonicalJson(claimed)) {
      throw corrupt(`Result Assessment Operation ${current.dispatch.id} provider claim failed`);
    }
    return bound;
  });
}

async function processProviderState(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  operationId: string,
  state: ResultAssessmentProviderState,
  reconciled: boolean,
  commandId: string,
  context: TargetCommandContext,
): Promise<EvaluationSuccess> {
  if (state.state === 'not_submitted') {
    return finishTerminal(
      database,
      environment,
      operationId,
      'failed',
      'provider_failed',
      null,
      reconciled,
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
    return markSubmitted(database, environment, operationId, reconciled, commandId, context);
  }
  if (state.state === 'succeeded') {
    return publishAssessment(
      database,
      environment,
      operationId,
      state.assessment,
      state.usage,
      reconciled,
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
    state.usage,
    reconciled,
    commandId,
    context,
  );
}

function parseContinueInput(input: ContinueResultAssessmentInput) {
  try {
    return {
      operation: parseCanonical(ResultAssessmentOperationRefSchema, input.operation),
      expectedRevision: parseCanonical(RevisionSchema, input.expectedRevision),
      commandId: parseCanonical(EntityIdSchema, input.commandId),
    };
  } catch {
    throw invalid('Result Assessment continuation input is invalid');
  }
}

async function submitAfterNotSubmitted(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  adapter: ResultAssessmentProviderAdapter,
  snapshot: BoundOperationRecord,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<EvaluationSuccess> {
  const snapshotView = snapshot.owner.view;
  if (snapshotView.authority !== 'result_assessment_attempt') {
    throw corrupt(`Result Assessment Operation ${snapshot.dispatch.id} owner does not match`);
  }
  if (snapshotView.cancelRequested) {
    return finishTerminal(
      database,
      environment,
      snapshot.dispatch.id,
      'cancelled',
      'cancelled',
      null,
      snapshotView.state === 'unknown',
      commandId,
      context,
    );
  }
  const run = loadRun(database, snapshot.dispatch.key.runId);
  const profile = acceptedProfile(database, snapshot, adapter);
  const subjects = resolveSubjects(database, run, snapshotView.request);
  const claimed = claimProviderAction(database, snapshot, 'submit');
  const claimedView = claimed.owner.view;
  if (claimedView.authority !== 'result_assessment_attempt') {
    throw corrupt(`Result Assessment Operation ${snapshot.dispatch.id} owner does not match`);
  }
  const state = await callProviderState(() =>
    adapter.submit(
      {
        idempotencyKey: claimed.dispatch.key.fingerprint,
        requestHash: claimedView.requestHash,
        profile,
        request: claimedView.request,
        subjects,
      },
      signal,
    ),
  );
  return state === undefined
    ? markUnknown(database, environment, claimed.dispatch.id, commandId, context)
    : processProviderState(
        database,
        environment,
        claimed.dispatch.id,
        state,
        true,
        commandId,
        context,
      );
}

async function reconcileOrCancel(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  adapter: ResultAssessmentProviderAdapter,
  snapshot: BoundOperationRecord,
  commandId: string,
  context: TargetCommandContext,
  signal?: AbortSignal,
): Promise<EvaluationSuccess> {
  const snapshotView = snapshot.owner.view;
  if (snapshotView.authority !== 'result_assessment_attempt') {
    throw corrupt(`Result Assessment Operation ${snapshot.dispatch.id} owner does not match`);
  }
  const profile = acceptedProfile(database, snapshot, adapter);
  const reconciled = await callProviderState(() =>
    adapter.reconcileByIdempotencyKey(
      {
        idempotencyKey: snapshot.dispatch.key.fingerprint,
        requestHash: snapshotView.requestHash,
        profile,
        receipt: snapshotView.receipt,
      },
      signal,
    ),
  );
  if (reconciled === undefined) {
    return markUnknown(database, environment, snapshot.dispatch.id, commandId, context);
  }
  if (reconciled.state === 'not_submitted') {
    return submitAfterNotSubmitted(
      database,
      environment,
      adapter,
      snapshot,
      commandId,
      context,
      signal,
    );
  }
  const observed = await processProviderState(
    database,
    environment,
    snapshot.dispatch.id,
    reconciled,
    true,
    commandId,
    context,
  );
  if (
    !snapshotView.cancelRequested ||
    (observed.state !== 'submitted' && observed.state !== 'unknown')
  ) {
    return observed;
  }
  const current = assessmentOperation(loadBoundOperation(database, snapshot.dispatch.id));
  if (
    current.owner.view.authority !== 'result_assessment_attempt' ||
    current.owner.view.receipt === null
  ) {
    return observed;
  }
  const claimed = claimProviderAction(database, current, 'cancel');
  const claimedView = claimed.owner.view;
  if (claimedView.authority !== 'result_assessment_attempt' || claimedView.receipt === null) {
    throw corrupt(`Result Assessment Operation ${snapshot.dispatch.id} lost its receipt`);
  }
  const claimedReceipt = claimedView.receipt;
  const cancelled = await callProviderState(() =>
    adapter.cancel(
      {
        idempotencyKey: claimed.dispatch.key.fingerprint,
        requestHash: claimedView.requestHash,
        profile,
        receipt: claimedReceipt,
      },
      signal,
    ),
  );
  return cancelled === undefined || cancelled.state === 'not_submitted'
    ? markUnknown(database, environment, claimed.dispatch.id, commandId, context)
    : processProviderState(
        database,
        environment,
        claimed.dispatch.id,
        cancelled,
        true,
        commandId,
        context,
      );
}

export function createResultAssessmentsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
  adapter: ResultAssessmentProviderAdapter,
): ResultAssessmentsAuthority {
  const database = () => getTargetStoreDatabase(store);
  return Object.freeze({
    async start(
      inputValue: StartResultAssessmentInput,
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
        throw invalid('Result Assessment start context is invalid');
      }
      const key = resolveOperationDispatchKey(database(), {
        runId: inputValue.runId,
        toolId: 'evaluation.run',
        input: inputValue.request,
      });
      const replay = replayForKey(database(), key, dispatchOperationId);
      if (replay !== undefined) return replay;
      const request = parseCanonical(EvaluationInputSchema, key.input);
      const run = loadRun(database(), key.runId);
      loadRunSnapshots(database(), run);
      const subjects = resolveSubjects(database(), run, request);
      let profile: ResultAssessmentProviderProfile | null = null;
      let cost: ResourceAmount | null = null;
      if (!isLocal(request)) {
        profile = providerProfile(database(), run, request, adapter);
        const requestHash = hashCanonical(evaluationRequestHashInput(request));
        cost = await quoteProvider(adapter, profile, key, requestHash, request, subjects, signal);
        assertProviderBudget(database(), run, cost);
      }
      const prepared = prepareAssessment(
        database(),
        environment,
        adapter,
        key,
        request,
        profile,
        cost,
        commandId,
        context,
        dispatchOperationId,
      );
      return successForOperation(database(), prepared.bound);
    },

    async executeLocal(
      inputValue: ContinueResultAssessmentInput,
      contextValue: TargetCommandContext,
    ) {
      const { operation, expectedRevision, commandId } = parseContinueInput(inputValue);
      const context = parseCanonical(TargetCommandContextSchema, contextValue);
      const initial = assessmentOperation(loadBoundOperation(database(), operation.id));
      assertExactRef(initial, operation, expectedRevision);
      if (
        initial.owner.view.authority !== 'result_assessment_attempt' ||
        !isLocal(initial.owner.view.request)
      ) {
        throw invalid(`Result Assessment Operation ${operation.id} is not local`);
      }
      if (initial.owner.view.cancelRequested) {
        return finishTerminal(
          database(),
          environment,
          operation.id,
          'cancelled',
          'cancelled',
          null,
          false,
          commandId,
          context,
        );
      }
      try {
        const run = loadRun(database(), initial.dispatch.key.runId);
        resolveSubjects(database(), run, initial.owner.view.request);
        const evidence = localEvidence(database(), initial.owner.view.request);
        return publishAssessment(
          database(),
          environment,
          operation.id,
          evidence,
          null,
          false,
          commandId,
          context,
        );
      } catch {
        return finishTerminal(
          database(),
          environment,
          operation.id,
          'failed',
          'execution_failed',
          null,
          false,
          commandId,
          context,
        );
      }
    },

    async submitProvider(
      inputValue: ContinueResultAssessmentInput,
      contextValue: TargetCommandContext,
      signal?: AbortSignal,
    ) {
      const { operation, expectedRevision, commandId } = parseContinueInput(inputValue);
      const context = parseCanonical(TargetCommandContextSchema, contextValue);
      const initial = assessmentOperation(loadBoundOperation(database(), operation.id));
      if (['succeeded', 'failed', 'cancelled'].includes(initial.owner.view.state)) {
        return successForOperation(database(), initial);
      }
      assertExactRef(initial, operation, expectedRevision);
      if (
        initial.owner.view.authority !== 'result_assessment_attempt' ||
        isLocal(initial.owner.view.request)
      ) {
        throw invalid(`Result Assessment Operation ${operation.id} is not provider-backed`);
      }
      if (initial.owner.view.state === 'unknown') {
        throw invalid('Unknown Result Assessment may only be reconciled');
      }
      return reconcileOrCancel(
        database(),
        environment,
        adapter,
        initial,
        commandId,
        context,
        signal,
      );
    },

    async reconcileProvider(
      inputValue: ContinueResultAssessmentInput,
      contextValue: TargetCommandContext,
      signal?: AbortSignal,
    ) {
      const { operation, expectedRevision, commandId } = parseContinueInput(inputValue);
      const context = parseCanonical(TargetCommandContextSchema, contextValue);
      const initial = assessmentOperation(loadBoundOperation(database(), operation.id));
      if (['succeeded', 'failed', 'cancelled'].includes(initial.owner.view.state)) {
        return successForOperation(database(), initial);
      }
      assertExactRef(initial, operation, expectedRevision);
      if (
        initial.owner.view.authority !== 'result_assessment_attempt' ||
        isLocal(initial.owner.view.request)
      ) {
        throw invalid(`Result Assessment Operation ${operation.id} is not provider-backed`);
      }
      return reconcileOrCancel(
        database(),
        environment,
        adapter,
        initial,
        commandId,
        context,
        signal,
      );
    },

    async acknowledgeCancellation(
      inputValue: ContinueResultAssessmentInput,
      contextValue: TargetCommandContext,
      signal?: AbortSignal,
    ) {
      const { operation, expectedRevision, commandId } = parseContinueInput(inputValue);
      const context = parseCanonical(TargetCommandContextSchema, contextValue);
      const initial = assessmentOperation(loadBoundOperation(database(), operation.id));
      if (['succeeded', 'failed', 'cancelled'].includes(initial.owner.view.state)) {
        return successForOperation(database(), initial);
      }
      assertExactRef(initial, operation, expectedRevision);
      if (!initial.owner.view.cancelRequested) {
        throw invalid(`Result Assessment Operation ${operation.id} has no cancellation request`);
      }
      if (initial.owner.view.authority !== 'result_assessment_attempt') {
        throw corrupt(`Result Assessment Operation ${operation.id} owner does not match`);
      }
      return isLocal(initial.owner.view.request)
        ? finishTerminal(
            database(),
            environment,
            operation.id,
            'cancelled',
            'cancelled',
            null,
            false,
            commandId,
            context,
          )
        : reconcileOrCancel(database(), environment, adapter, initial, commandId, context, signal);
    },
  });
}
