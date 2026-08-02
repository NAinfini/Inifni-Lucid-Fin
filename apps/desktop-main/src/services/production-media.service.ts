import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { WorkflowEngine } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CanvasNode,
  GenerationRequest,
  ImageNodeData,
  ProductionMediaGenerationSpec,
  RepairDelta,
  VideoNodeData,
  WorkflowMediaAttempt,
  WorkflowMediaEvaluation,
  WorkflowMediaEvaluationVerdict,
  WorkflowMediaFrameEvidence,
  WorkflowMediaScoreSet,
  WorkflowRunId,
} from '@lucid-fin/contracts';
import {
  extractFrameAtTime as defaultExtractFrameAtTime,
  probeMedia as defaultProbeMedia,
  type MediaProbeResult,
} from '@lucid-fin/media-engine';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import log from '../logger.js';
import {
  buildGenerationContext,
  mapGenerationTypeToAssetType,
} from '../ipc/handlers/generation-context.js';
import {
  materializeAsset,
  materializeGenerationRequest,
  mergeVariants,
  normalizeErrorMessage,
} from '../ipc/handlers/generation-helpers.js';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
import { analyzeImageAssets } from '../ipc/handlers/vision.handlers.js';

export const PRODUCTION_MEDIA_RUBRIC_VERSION = 'production-media-rubric-v1';

export interface ProduceProductionMediaInput {
  workflowRunId: string;
  canvasId: string;
  nodeId: string;
  expectedRowVersion: number;
}

export interface ProduceProductionMediaResult {
  workflowRunId: string;
  canvasId: string;
  nodeId: string;
  status:
    'accepted' | 'human_review' | 'ambiguous' | 'failed' | 'budget_blocked' | 'evaluation_pending';
  attempt?: WorkflowMediaAttempt;
  evaluation?: WorkflowMediaEvaluation;
  nextAction: 'continue' | 'retry_evaluation' | 'ask_user';
  message: string;
}

export interface ProductionMediaGradeRequest {
  assetHashes: string[];
  mediaType: 'image' | 'video';
  generationSpec: ProductionMediaGenerationSpec;
  productionPlan: Record<string, unknown>;
  visualConstitution: Record<string, unknown>;
  metadata: Record<string, unknown>;
  frameEvidence: WorkflowMediaFrameEvidence[];
}

export interface ProductionMediaGradeResponse {
  text: string;
  providerId: string;
  model?: string;
}

export interface ProductionMediaServiceDeps {
  db: SqliteIndex;
  cas: CAS;
  keychain: Keychain;
  adapterRegistry: AdapterRegistry;
  canvasStore: CanvasStore;
  workflowEngine: WorkflowEngine;
  gradeAssets?: (request: ProductionMediaGradeRequest) => Promise<ProductionMediaGradeResponse>;
  probeMedia?: (filePath: string) => Promise<MediaProbeResult>;
  extractFrameAtTime?: (
    videoPath: string,
    timeSeconds: number,
    outputPath: string,
  ) => Promise<void>;
  now?: () => number;
  idFactory?: () => string;
}

type EvaluationDecision = {
  scores: WorkflowMediaScoreSet;
  total: number;
  verdict: WorkflowMediaEvaluationVerdict;
  strengths: string[];
  risks: string[];
  evidence: string[];
  repairDelta?: RepairDelta;
};

export class ProductionMediaService {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly gradeAssets: NonNullable<ProductionMediaServiceDeps['gradeAssets']>;
  private readonly probeMedia: NonNullable<ProductionMediaServiceDeps['probeMedia']>;
  private readonly extractFrameAtTime: NonNullable<
    ProductionMediaServiceDeps['extractFrameAtTime']
  >;

  constructor(private readonly deps: ProductionMediaServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? randomUUID;
    this.gradeAssets = deps.gradeAssets ?? createDefaultProductionMediaGrader(deps);
    this.probeMedia = deps.probeMedia ?? defaultProbeMedia;
    this.extractFrameAtTime = deps.extractFrameAtTime ?? defaultExtractFrameAtTime;
  }

  /**
   * Reconcile only states whose crash semantics are provable without network
   * calls. Reserved work remains safe to submit later; asset-ready work remains
   * safe to re-grade. A submitted provider call is ambiguous and is never
   * replayed automatically.
   */
  recoverInterruptedAttempts(): void {
    for (const attempt of this.deps.db.repos.workflows.listRecoverableMediaAttempts()) {
      try {
        if (attempt.status === 'submitted') {
          this.deps.db.repos.workflows.transitionMediaAttempt({
            id: attempt.id,
            expectedRowVersion: attempt.rowVersion,
            expectedStatuses: ['submitted'],
            status: 'ambiguous',
            error:
              'Application restarted after provider submission; outcome is ambiguous and automatic retry is disabled.',
            completedAt: this.now(),
            updatedAt: this.now(),
          });
        } else if (attempt.status === 'evaluating') {
          this.deps.db.repos.workflows.transitionMediaAttempt({
            id: attempt.id,
            expectedRowVersion: attempt.rowVersion,
            expectedStatuses: ['evaluating'],
            status: 'asset_ready',
            error:
              'Application restarted during evaluation; the existing CAS asset is ready to grade again.',
            updatedAt: this.now(),
          });
        }
      } catch (error) {
        log.warn('Production-media recovery skipped a concurrently changed attempt', {
          category: 'production-media',
          attemptId: attempt.id,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }

  async produce(input: ProduceProductionMediaInput): Promise<ProduceProductionMediaResult> {
    requireProduceInput(input);
    const workflow = this.deps.workflowEngine.requireProductionMediaContext(
      input.workflowRunId,
      input.canvasId,
      input.expectedRowVersion,
    );
    const canvas = this.deps.canvasStore.get(input.canvasId);
    if (!canvas) throw new Error(`Canvas "${input.canvasId}" not found`);
    const node = canvas.nodes.find((entry) => entry.id === input.nodeId);
    if (!node) throw new Error(`Node "${input.nodeId}" not found`);
    if (node.type !== 'image' && node.type !== 'video') {
      throw new Error('Persistent production-media quality control supports image and video nodes');
    }

    const latest = this.deps.db.repos.workflows.getLatestMediaAttempt(
      input.workflowRunId as WorkflowRunId,
      input.nodeId,
    );

    if (latest?.status === 'accepted') {
      const evaluation = this.deps.db.repos.workflows.getMediaEvaluation(latest.id);
      if (!latest.assetHash || !evaluation) {
        throw new Error('Accepted production-media attempt is missing durable evidence');
      }
      this.attachAcceptedAsset(canvas, node, latest);
      return resultFor(latest, evaluation, 'accepted', 'The accepted media evidence was restored.');
    }

    if (latest?.status === 'submitted') {
      const ambiguous = this.deps.db.repos.workflows.transitionMediaAttempt({
        id: latest.id,
        expectedRowVersion: latest.rowVersion,
        expectedStatuses: ['submitted'],
        status: 'ambiguous',
        error:
          'The process resumed after provider submission without a verified provider result; automatic retry is disabled to prevent duplicate billing.',
        completedAt: this.now(),
        updatedAt: this.now(),
      });
      return resultFor(
        ambiguous,
        undefined,
        'ambiguous',
        ambiguous.error ?? 'Provider outcome is ambiguous and requires user review.',
      );
    }

    if (latest?.status === 'asset_ready' || latest?.status === 'evaluating') {
      return this.evaluateAttempt(workflow, canvas, node, latest);
    }

    if (latest?.status === 'reserved') {
      if (latest.generationSpec.nodeUpdatedAt !== node.updatedAt) {
        const reviewed = this.deps.db.repos.workflows.transitionMediaAttempt({
          id: latest.id,
          expectedRowVersion: latest.rowVersion,
          expectedStatuses: ['reserved'],
          status: 'human_review',
          error:
            'The canvas node changed after reservation; the reserved request was not submitted.',
          completedAt: this.now(),
          updatedAt: this.now(),
        });
        return resultFor(reviewed, undefined, 'human_review', reviewed.error!);
      }
      const context = await buildGenerationContext(
        {
          adapterRegistry: this.deps.adapterRegistry,
          cas: this.deps.cas,
          db: this.deps.db,
          canvasStore: this.deps.canvasStore,
          keychain: this.deps.keychain,
          getWindow: () => null,
        },
        { canvasId: input.canvasId, nodeId: input.nodeId, requestedVariantCount: 1 },
      );
      if (context.adapter.id !== latest.providerId) {
        throw new Error('The reserved provider is no longer the provider selected for this node');
      }
      const expectedSpecHash = sha256(
        canonicalJson({ ...latest.generationSpec, createdAt: undefined }),
      );
      if (expectedSpecHash !== latest.specHash) {
        throw new Error('The reserved Generation Spec failed its integrity check');
      }
      const resumed = await this.submitAndImport(
        latest,
        context.adapter,
        restoreRequestFromSpec(context.requestBase, latest.generationSpec),
      );
      if (resumed.status === 'asset_ready') {
        return this.evaluateAttempt(workflow, canvas, node, resumed);
      }
      return resultFor(
        resumed,
        undefined,
        resumed.status === 'ambiguous' ? 'ambiguous' : 'failed',
        resumed.error ?? 'The reserved provider request could not be completed.',
      );
    }

    if (
      latest &&
      (latest.status === 'ambiguous' ||
        latest.status === 'failed' ||
        latest.status === 'cancelled' ||
        latest.status === 'human_review')
    ) {
      return resultFor(
        latest,
        this.deps.db.repos.workflows.getMediaEvaluation(latest.id),
        latest.status === 'ambiguous'
          ? 'ambiguous'
          : latest.status === 'failed'
            ? 'failed'
            : 'human_review',
        latest.error ?? 'This attempt requires user review before more provider work.',
      );
    }

    for (;;) {
      const previousEvaluation = latest
        ? this.deps.db.repos.workflows.getMediaEvaluation(latest.id)
        : undefined;
      const repairDelta =
        latest?.status === 'repair_required' || latest?.status === 'regenerate_required'
          ? previousEvaluation?.repairDelta
          : undefined;
      const prepared = await this.prepareAttempt(
        input,
        workflow,
        canvas,
        node,
        latest,
        repairDelta,
      );
      if ('blocked' in prepared) {
        return {
          workflowRunId: input.workflowRunId,
          canvasId: input.canvasId,
          nodeId: input.nodeId,
          status: 'budget_blocked',
          attempt: latest,
          evaluation: previousEvaluation,
          nextAction: 'ask_user',
          message: prepared.blocked,
        };
      }

      let attempt = prepared.attempt;
      if (attempt.status === 'reserved') {
        attempt = await this.submitAndImport(attempt, prepared.adapter, prepared.request);
      }
      if (attempt.status !== 'asset_ready' && attempt.status !== 'evaluating') {
        const status = attempt.status === 'ambiguous' ? 'ambiguous' : 'failed';
        return resultFor(
          attempt,
          undefined,
          status,
          attempt.error ?? 'Provider generation did not produce a gradeable asset.',
        );
      }

      const evaluated = await this.evaluateAttempt(workflow, canvas, node, attempt);
      if (evaluated.status !== 'evaluation_pending') return evaluated;
      return evaluated;
    }
  }

  private async prepareAttempt(
    input: ProduceProductionMediaInput,
    workflow: ReturnType<WorkflowEngine['requireProductionMediaContext']>,
    canvas: Canvas,
    node: CanvasNode,
    latest: WorkflowMediaAttempt | undefined,
    repairDelta: RepairDelta | undefined,
  ): Promise<
    | {
        attempt: WorkflowMediaAttempt;
        adapter: AIProviderAdapter;
        request: GenerationRequest;
      }
    | { blocked: string }
  > {
    const attemptNumber = (latest?.attempt ?? 0) + 1;
    const limits = readApprovedLimits(workflow.productionPlan.content);
    const summary = this.deps.db.repos.workflows.getMediaCostSummary(
      input.workflowRunId as WorkflowRunId,
    );
    if (attemptNumber > Math.max(1, limits.maxAttemptsPerShot)) {
      return {
        blocked: `Approved per-shot attempt limit (${limits.maxAttemptsPerShot}) is exhausted.`,
      };
    }
    if (attemptNumber > 1 && summary.regenerationCount >= limits.maxRegenerations) {
      return {
        blocked: `Approved global regeneration limit (${limits.maxRegenerations}) is exhausted.`,
      };
    }
    if (latest && attemptNumber > 1 && !repairDelta) {
      return { blocked: 'The previous evaluation did not provide a valid Repair Delta.' };
    }

    const context = await buildGenerationContext(
      {
        adapterRegistry: this.deps.adapterRegistry,
        cas: this.deps.cas,
        db: this.deps.db,
        canvasStore: this.deps.canvasStore,
        keychain: this.deps.keychain,
        getWindow: () => null,
      },
      { canvasId: input.canvasId, nodeId: input.nodeId, requestedVariantCount: 1 },
    );
    if (context.generationType !== 'image' && context.generationType !== 'video') {
      throw new Error('Production-media service received a non-visual generation type');
    }

    const approvedPrompt = compileApprovedPrompt(
      context.requestBase.prompt,
      workflow.visualConstitution.content,
      repairDelta,
    );
    const approvedNegativePrompt = compileApprovedNegativePrompt(
      context.requestBase.negativePrompt,
      workflow.visualConstitution.content,
      repairDelta,
    );
    const baseSeed =
      typeof context.requestBase.seed === 'number'
        ? context.requestBase.seed
        : stableSeed(input.workflowRunId, input.nodeId);
    const seed =
      repairDelta?.seedStrategy === 'increment' ? baseSeed + attemptNumber - 1 : baseSeed;
    const request: GenerationRequest = {
      ...context.requestBase,
      prompt: approvedPrompt,
      negativePrompt: approvedNegativePrompt,
      seed,
      ...applySafeParameterChanges(repairDelta),
    };
    const estimate = context.adapter.estimateCost(request);
    if (!Number.isFinite(estimate.estimatedCost) || estimate.estimatedCost < 0) {
      throw new Error('Provider returned an invalid cost estimate; generation was not reserved');
    }
    const styleCost = readStyleAuditionCommittedCost(
      this.deps.workflowEngine.getLatestVisualAudition(input.workflowRunId)?.content,
    );
    const projectedCost = styleCost + summary.committedCostUsd + estimate.estimatedCost;
    if (projectedCost > limits.maxTotalCostUsd + 1e-9) {
      return {
        blocked: `Projected committed cost $${projectedCost.toFixed(4)} exceeds the approved $${limits.maxTotalCostUsd.toFixed(4)} total budget.`,
      };
    }

    const createdAt = this.now();
    const generationSpec = buildGenerationSpec({
      input,
      workflow,
      node,
      context,
      request,
      limits: { ...limits, styleAuditionCommittedCostUsd: styleCost },
      createdAt,
    });
    const specHash = sha256(canonicalJson({ ...generationSpec, createdAt: undefined }));
    const proposed: WorkflowMediaAttempt = {
      id: this.idFactory(),
      workflowRunId: input.workflowRunId,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      attempt: attemptNumber,
      idempotencyKey: sha256(
        canonicalJson({
          workflowRunId: input.workflowRunId,
          nodeId: input.nodeId,
          attempt: attemptNumber,
          specHash,
        }),
      ),
      specHash,
      generationSpec,
      ...(repairDelta ? { repairDelta } : {}),
      mediaType: context.generationType,
      status: 'reserved',
      rowVersion: 0,
      providerId: context.adapter.id,
      prompt: request.prompt,
      promptHash: sha256(request.prompt),
      ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      seed,
      estimatedCostUsd: estimate.estimatedCost,
      createdAt,
      updatedAt: createdAt,
    };
    let reserved: { attempt: WorkflowMediaAttempt; created: boolean };
    try {
      reserved = this.deps.db.repos.workflows.reserveMediaAttempt({
        attempt: proposed,
        expectedRunRowVersion: input.expectedRowVersion,
      });
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (/approved .* (?:budget|limit)|would be exceeded|limit is exhausted/i.test(message)) {
        return { blocked: message };
      }
      throw error;
    }
    return { attempt: reserved.attempt, adapter: context.adapter, request };
  }

  private async submitAndImport(
    attempt: WorkflowMediaAttempt,
    adapter: AIProviderAdapter,
    request: GenerationRequest,
  ): Promise<WorkflowMediaAttempt> {
    const submittedAt = this.now();
    let submitted = this.deps.db.repos.workflows.transitionMediaAttempt({
      id: attempt.id,
      expectedRowVersion: attempt.rowVersion,
      expectedStatuses: ['reserved'],
      status: 'submitted',
      submittedAt,
      updatedAt: submittedAt,
    });

    try {
      const materializedRequest = materializeGenerationRequest(request, this.deps.cas);
      const generated = adapter.subscribe
        ? await adapter.subscribe(materializedRequest, {})
        : await adapter.generate(materializedRequest);
      const materialized = await materializeAsset(generated);
      try {
        const assetType = mapGenerationTypeToAssetType(attempt.mediaType);
        const imported = await this.deps.cas.importAsset(materialized.filePath, assetType);
        this.deps.db.repos.assets.insert({
          ...imported.meta,
          prompt: attempt.prompt,
          provider: adapter.id,
          tags: [
            'canvas',
            `canvas:${attempt.canvasId}`,
            `node:${attempt.nodeId}`,
            'production-media',
            `workflow:${attempt.workflowRunId}`,
            `attempt:${attempt.attempt}`,
          ],
          generationMetadata: {
            prompt: attempt.prompt,
            provider: adapter.id,
            workflowRunId: attempt.workflowRunId,
            attemptId: attempt.id,
            specHash: attempt.specHash,
            promptHash: attempt.promptHash,
            negativePrompt: attempt.negativePrompt,
            seed: attempt.seed,
            model:
              generated.provenance?.model ??
              (typeof generated.metadata?.model === 'string'
                ? generated.metadata.model
                : undefined),
            estimatedCostUsd: attempt.estimatedCostUsd,
            reportedActualCostUsd: generated.cost,
            referenceAssetHashes: attempt.generationSpec.referenceAssetHashes,
          },
        });
        const metadata = generated.metadata ?? {};
        const providerJobId = firstString(metadata.jobId, metadata.taskId, metadata.id);
        submitted = this.deps.db.repos.workflows.transitionMediaAttempt({
          id: attempt.id,
          expectedRowVersion: submitted.rowVersion,
          expectedStatuses: ['submitted'],
          status: 'asset_ready',
          assetHash: imported.ref.hash,
          ...(typeof generated.cost === 'number' ? { reportedActualCostUsd: generated.cost } : {}),
          ...(providerJobId ? { providerJobId } : {}),
          ...(generated.provenance?.model || typeof metadata.model === 'string'
            ? { model: generated.provenance?.model ?? String(metadata.model) }
            : {}),
          assetReadyAt: this.now(),
          updatedAt: this.now(),
        });
        return submitted;
      } finally {
        if (materialized.cleanupPath) {
          fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
        }
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      log.error('Persistent production-media provider outcome is ambiguous', {
        category: 'production-media',
        workflowRunId: attempt.workflowRunId,
        nodeId: attempt.nodeId,
        attempt: attempt.attempt,
        error: message,
      });
      return this.deps.db.repos.workflows.transitionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: submitted.rowVersion,
        expectedStatuses: ['submitted'],
        status: 'ambiguous',
        error: message,
        completedAt: this.now(),
        updatedAt: this.now(),
      });
    }
  }

  private async evaluateAttempt(
    workflow: ReturnType<WorkflowEngine['requireProductionMediaContext']>,
    canvas: Canvas,
    node: CanvasNode,
    attempt: WorkflowMediaAttempt,
  ): Promise<ProduceProductionMediaResult> {
    if (!attempt.assetHash) throw new Error('Gradeable attempt is missing its CAS asset hash');
    const assetHash = attempt.assetHash;
    if (attempt.generationSpec.nodeUpdatedAt !== node.updatedAt) {
      const reviewed = this.deps.db.repos.workflows.transitionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: [attempt.status],
        status: 'human_review',
        error:
          'The canvas node changed after reservation; the generated artifact cannot be selected automatically.',
        completedAt: this.now(),
        updatedAt: this.now(),
      });
      return resultFor(reviewed, undefined, 'human_review', reviewed.error!);
    }

    let evaluating = attempt;
    if (attempt.status === 'asset_ready') {
      evaluating = this.deps.db.repos.workflows.transitionMediaAttempt({
        id: attempt.id,
        expectedRowVersion: attempt.rowVersion,
        expectedStatuses: ['asset_ready'],
        status: 'evaluating',
        updatedAt: this.now(),
      });
    }

    let evidence: {
      assetHashes: string[];
      metadata: Record<string, unknown>;
      frameEvidence: WorkflowMediaFrameEvidence[];
    };
    let response: ProductionMediaGradeResponse;
    let parsed: EvaluationDecision;
    try {
      evidence = await this.collectEvidence(evaluating);
      response = await this.gradeAssets({
        assetHashes: evidence.assetHashes,
        mediaType: evaluating.mediaType,
        generationSpec: evaluating.generationSpec,
        productionPlan: workflow.productionPlan.content,
        visualConstitution: workflow.visualConstitution.content,
        metadata: evidence.metadata,
        frameEvidence: evidence.frameEvidence,
      });
      parsed = parseEvaluation(response.text, evaluating.mediaType);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const pending = this.deps.db.repos.workflows.transitionMediaAttempt({
        id: evaluating.id,
        expectedRowVersion: evaluating.rowVersion,
        expectedStatuses: ['evaluating'],
        status: 'asset_ready',
        error: `Evaluation pending: ${message}`,
        updatedAt: this.now(),
      });
      log.warn('Production-media evaluation deferred without repeating provider work', {
        category: 'production-media',
        workflowRunId: pending.workflowRunId,
        nodeId: pending.nodeId,
        attempt: pending.attempt,
        error: message,
      });
      return resultFor(
        pending,
        undefined,
        'evaluation_pending',
        pending.error ?? 'Evaluation is pending.',
      );
    }

    const bounds = this.remainingBounds(evaluating, workflow.productionPlan.content);
    const verdict = boundVerdict(parsed, bounds);
    const boundedRisks = bounds.budgetExceeded
      ? [...parsed.risks, 'Reported provider cost exceeded the approved total budget.']
      : parsed.risks;
    const boundedEvidence = bounds.budgetExceeded
      ? [...parsed.evidence, 'The durable cost ledger is above the approved maxTotalCostUsd.']
      : parsed.evidence;
    const repairDelta =
      verdict === 'repair' || verdict === 'regenerate'
        ? normalizeRepairDelta(parsed.repairDelta, boundedRisks, verdict)
        : undefined;
    const finalVerdict =
      (verdict === 'repair' || verdict === 'regenerate') && !repairDelta ? 'human_review' : verdict;
    const createdAt = this.now();
    const evaluation: WorkflowMediaEvaluation = {
      id: this.idFactory(),
      attemptId: evaluating.id,
      workflowRunId: evaluating.workflowRunId,
      canvasId: evaluating.canvasId,
      nodeId: evaluating.nodeId,
      assetHash,
      mediaType: evaluating.mediaType,
      rubricVersion: PRODUCTION_MEDIA_RUBRIC_VERSION,
      evaluatorProviderId: response.providerId,
      ...(response.model ? { evaluatorModel: response.model } : {}),
      scores: parsed.scores,
      total: parsed.total,
      verdict: finalVerdict,
      strengths: parsed.strengths,
      risks: boundedRisks,
      evidence: boundedEvidence,
      ...(repairDelta ? { repairDelta } : {}),
      metadata: evidence.metadata,
      frameEvidence: evidence.frameEvidence,
      createdAt,
    };
    const resultingAttemptStatus =
      finalVerdict === 'pass'
        ? 'accepted'
        : finalVerdict === 'repair'
          ? 'repair_required'
          : finalVerdict === 'regenerate'
            ? 'regenerate_required'
            : 'human_review';
    const recorded = this.deps.db.repos.workflows.recordMediaEvaluation({
      evaluation,
      expectedAttemptRowVersion: evaluating.rowVersion,
      expectedAttemptStatuses: ['evaluating'],
      resultingAttemptStatus,
      evaluatedAt: createdAt,
    });

    if (recorded.attempt.status === 'accepted') {
      this.attachAcceptedAsset(canvas, node, recorded.attempt);
      return resultFor(
        recorded.attempt,
        recorded.evaluation,
        'accepted',
        'Media passed the production rubric and was selected on the canvas.',
      );
    }
    if (recorded.attempt.status === 'human_review') {
      return resultFor(
        recorded.attempt,
        recorded.evaluation,
        'human_review',
        'The artifact and evidence were preserved for user review.',
      );
    }

    return this.produce({
      workflowRunId: recorded.attempt.workflowRunId,
      canvasId: recorded.attempt.canvasId,
      nodeId: recorded.attempt.nodeId,
      expectedRowVersion: workflow.run.rowVersion ?? 0,
    });
  }

  private remainingBounds(
    attempt: WorkflowMediaAttempt,
    productionPlan: Record<string, unknown>,
  ): { canRetry: boolean; budgetExceeded: boolean } {
    const limits = readApprovedLimits(productionPlan);
    const summary = this.deps.db.repos.workflows.getMediaCostSummary(
      attempt.workflowRunId as WorkflowRunId,
    );
    const totalCommittedUsd =
      attempt.generationSpec.limits.styleAuditionCommittedCostUsd + summary.committedCostUsd;
    return {
      canRetry:
        attempt.attempt < Math.max(1, limits.maxAttemptsPerShot) &&
        summary.regenerationCount < limits.maxRegenerations &&
        totalCommittedUsd < limits.maxTotalCostUsd,
      budgetExceeded: totalCommittedUsd > limits.maxTotalCostUsd + 1e-9,
    };
  }

  private async collectEvidence(attempt: WorkflowMediaAttempt): Promise<{
    assetHashes: string[];
    metadata: Record<string, unknown>;
    frameEvidence: WorkflowMediaFrameEvidence[];
  }> {
    if (!attempt.assetHash) throw new Error('Attempt has no asset to evaluate');
    if (attempt.mediaType === 'image') {
      return { assetHashes: [attempt.assetHash], metadata: {}, frameEvidence: [] };
    }

    const asset = this.deps.db.repos.assets.findByHash(attempt.assetHash);
    if (!asset || asset.type !== 'video') {
      throw new Error(`Video asset "${attempt.assetHash}" is missing from the index`);
    }
    const videoPath = this.deps.cas.getAssetPath(attempt.assetHash, 'video', asset.format);
    if (!fs.existsSync(videoPath))
      throw new Error(`Video CAS file is missing: ${attempt.assetHash}`);
    const probe = await this.probeMedia(videoPath);
    if (probe.durationSeconds <= 0) throw new Error('Video duration is unavailable for grading');

    const timestamps = sampleVideoTimestamps(probe.durationSeconds);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-media-grade-'));
    const frameEvidence: WorkflowMediaFrameEvidence[] = [];
    try {
      for (const [index, timestampSeconds] of timestamps.entries()) {
        const outputPath = path.join(tempRoot, `frame-${index + 1}.png`);
        await this.extractFrameAtTime(videoPath, timestampSeconds, outputPath);
        const imported = await this.deps.cas.importAsset(outputPath, 'image');
        this.deps.db.repos.assets.insert({
          ...imported.meta,
          provider: 'ffmpeg-8.1.2',
          tags: [
            'production-media-evidence',
            `workflow:${attempt.workflowRunId}`,
            `attempt:${attempt.id}`,
            `timestamp:${timestampSeconds}`,
          ],
          generationMetadata: {
            prompt: 'Timestamped production-media evaluation frame',
            provider: 'ffmpeg-8.1.2',
            sourceVideoHash: attempt.assetHash,
            timestampSeconds,
            rubricVersion: PRODUCTION_MEDIA_RUBRIC_VERSION,
          },
        });
        frameEvidence.push({ timestampSeconds, assetHash: imported.ref.hash });
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    return {
      assetHashes: frameEvidence.map((frame) => frame.assetHash),
      metadata: { ffprobe: probe, sampledTimestampsSeconds: timestamps },
      frameEvidence,
    };
  }

  private attachAcceptedAsset(
    canvas: Canvas,
    node: CanvasNode,
    attempt: WorkflowMediaAttempt,
  ): void {
    if (!attempt.assetHash) throw new Error('Accepted attempt has no asset hash');
    const current = this.deps.canvasStore.get(canvas.id);
    const currentNode = current?.nodes.find((entry) => entry.id === node.id);
    if (!current || !currentNode) throw new Error('Canvas changed before accepted media selection');
    const data = currentNode.data as ImageNodeData | VideoNodeData;
    if (
      data.assetHash === attempt.assetHash &&
      data.variants?.includes(attempt.assetHash) &&
      data.status === 'done'
    ) {
      return;
    }
    if (currentNode.updatedAt !== attempt.generationSpec.nodeUpdatedAt) {
      throw new Error('Canvas node changed before accepted media selection');
    }
    const merged = mergeVariants(data.variants ?? [], [attempt.assetHash]);
    data.variants = merged.variants;
    data.selectedVariantIndex = merged.variants.indexOf(attempt.assetHash);
    data.assetHash = attempt.assetHash;
    data.status = 'done';
    data.progress = 100;
    data.error = undefined;
    data.providerId = attempt.providerId;
    data.seed = attempt.seed;
    data.cost = attempt.reportedActualCostUsd ?? attempt.estimatedCostUsd;
    data.estimatedCost = attempt.estimatedCostUsd;
    current.updatedAt = this.now();
    this.deps.canvasStore.save(current);
  }
}

export function createProductionMediaService(
  deps: ProductionMediaServiceDeps,
): ProductionMediaService {
  return new ProductionMediaService(deps);
}

function createDefaultProductionMediaGrader(
  deps: Pick<ProductionMediaServiceDeps, 'cas' | 'keychain'>,
): NonNullable<ProductionMediaServiceDeps['gradeAssets']> {
  return async (request) => {
    const response = await analyzeImageAssets(deps.cas, deps.keychain, request.assetHashes, {
      systemPrompt: `You are the strict visual quality controller for an AI film production pipeline.
Return exactly one JSON object and no markdown. Score every field from 0 to 100.
Required schema:
{"scores":{"identity":0,"style":0,"scriptAlignment":0,"continuity":0,"composition":0,"lighting":0,"motion":0,"technical":0,"safety":0},"strengths":["..."],"risks":["..."],"evidence":["observable fact tied to a supplied image"],"repairDelta":{"version":1,"reason":"...","promptAdditions":["..."],"negativeAdditions":["..."],"preserve":["..."],"seedStrategy":"keep|increment","parameterChanges":{}}}
Do not infer success from the prompt. Judge only visible evidence. For still images score motion as 100. Identity, approved style, script alignment, continuity, and safety are critical. A Repair Delta may refine the current attempt but must not change the approved story or Visual Constitution.`,
      userPrompt: canonicalJson({
        mediaType: request.mediaType,
        generationSpec: request.generationSpec,
        productionPlan: request.productionPlan,
        visualConstitution: request.visualConstitution,
        technicalMetadata: request.metadata,
        orderedFrames: request.frameEvidence,
      }),
    });
    return { text: response.text, providerId: response.providerId, model: response.model };
  };
}

function buildGenerationSpec(input: {
  input: ProduceProductionMediaInput;
  workflow: ReturnType<WorkflowEngine['requireProductionMediaContext']>;
  node: CanvasNode;
  context: Awaited<ReturnType<typeof buildGenerationContext>>;
  request: GenerationRequest;
  limits: ProductionMediaGenerationSpec['limits'];
  createdAt: number;
}): ProductionMediaGenerationSpec {
  const request = input.request;
  const fps = typeof request.params?.fps === 'number' ? request.params.fps : undefined;
  const hashes = [
    ...(input.context.requestBase.referenceImages ?? []),
    ...(request.sourceImageHash ? [request.sourceImageHash] : []),
    ...(request.frameReferenceImages?.first ? [request.frameReferenceImages.first] : []),
    ...(request.frameReferenceImages?.last ? [request.frameReferenceImages.last] : []),
  ];
  return {
    specVersion: 1,
    workflowRunId: input.input.workflowRunId,
    canvasId: input.input.canvasId,
    nodeId: input.input.nodeId,
    nodeUpdatedAt: input.node.updatedAt,
    mediaType: input.context.generationType as 'image' | 'video',
    generationType: input.context.generationType as 'image' | 'video',
    mode: input.context.mode as ProductionMediaGenerationSpec['mode'],
    productionPlan: {
      revision: input.workflow.productionPlan.revision,
      contentHash: input.workflow.productionPlan.contentHash,
    },
    visualConstitution: {
      revision: input.workflow.visualConstitution.revision,
      contentHash: input.workflow.visualConstitution.contentHash,
    },
    providerId: input.context.adapter.id,
    prompt: request.prompt,
    ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
    referenceAssetHashes: [...new Set(hashes)].sort(),
    ...(request.frameReferenceImages
      ? { frameReferenceHashes: { ...request.frameReferenceImages } }
      : {}),
    request: {
      width: request.width,
      height: request.height,
      duration: request.duration,
      fps,
      seed: request.seed,
      sourceImageHash: request.sourceImageHash,
      audio: request.audio,
      quality: request.quality,
      steps: request.steps,
      cfgScale: request.cfgScale,
      scheduler: request.scheduler,
      img2imgStrength: request.img2imgStrength,
      params: request.params,
    },
    limits: input.limits,
    createdAt: input.createdAt,
  };
}

function restoreRequestFromSpec(
  base: GenerationRequest,
  spec: ProductionMediaGenerationSpec,
): GenerationRequest {
  return {
    ...base,
    prompt: spec.prompt,
    negativePrompt: spec.negativePrompt,
    width: spec.request.width,
    height: spec.request.height,
    duration: spec.request.duration,
    seed: spec.request.seed,
    sourceImageHash: spec.request.sourceImageHash,
    frameReferenceImages: spec.frameReferenceHashes,
    audio: spec.request.audio,
    quality: spec.request.quality,
    steps: spec.request.steps,
    cfgScale: spec.request.cfgScale,
    scheduler: spec.request.scheduler,
    img2imgStrength: spec.request.img2imgStrength,
    params: spec.request.params,
  };
}

function readApprovedLimits(content: Record<string, unknown>): {
  maxAttemptsPerShot: number;
  maxRegenerations: number;
  maxTotalCostUsd: number;
} {
  const budget = asRecord(content.budget);
  return {
    maxAttemptsPerShot: requireNonNegativeInteger(
      budget.maxAttemptsPerShot,
      'Production Plan budget.maxAttemptsPerShot',
    ),
    maxRegenerations: requireNonNegativeInteger(
      budget.maxRegenerations,
      'Production Plan budget.maxRegenerations',
    ),
    maxTotalCostUsd: requireNonNegativeNumber(
      budget.maxTotalCostUsd,
      'Production Plan budget.maxTotalCostUsd',
    ),
  };
}

function readStyleAuditionCommittedCost(content: Record<string, unknown> | undefined): number {
  if (!content) return 0;
  const budget = asRecord(content.budget);
  const actual = optionalNonNegativeNumber(budget.reportedActualUsd);
  if (actual !== undefined) return actual;
  return optionalNonNegativeNumber(budget.estimatedCommittedUsd) ?? 0;
}

function compileApprovedPrompt(
  basePrompt: string,
  visualConstitution: Record<string, unknown>,
  repairDelta: RepairDelta | undefined,
): string {
  const locked = asRecord(visualConstitution.locked);
  const fields = [
    'medium',
    'era',
    'rendering',
    'linework',
    'palette',
    'lighting',
    'texture',
    'mood',
    'cameraGrammar',
    'lensGrammar',
    'compositionGrammar',
    'motionGrammar',
  ]
    .map((key) => (typeof locked[key] === 'string' ? `${key}: ${locked[key]}` : ''))
    .filter(Boolean);
  const anchors = [
    ...readStringArray(locked.characterAnchors),
    ...readStringArray(locked.locationAnchors),
  ];
  const repair = repairDelta?.promptAdditions ?? [];
  return [
    basePrompt.trim(),
    fields.length > 0 ? `APPROVED VISUAL CONSTITUTION (locked): ${fields.join('; ')}` : '',
    anchors.length > 0 ? `CONTINUITY ANCHORS (preserve exactly): ${anchors.join('; ')}` : '',
    repair.length > 0 ? `REPAIR DELTA (additive only): ${repair.join('; ')}` : '',
    repairDelta?.preserve.length
      ? `DO NOT CHANGE FROM PRIOR ATTEMPT: ${repairDelta.preserve.join('; ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function compileApprovedNegativePrompt(
  baseNegativePrompt: string | undefined,
  visualConstitution: Record<string, unknown>,
  repairDelta: RepairDelta | undefined,
): string | undefined {
  const locked = asRecord(visualConstitution.locked);
  const values = [
    ...(baseNegativePrompt ? [baseNegativePrompt] : []),
    ...readStringArray(locked.negativeConstraints),
    ...(repairDelta?.negativeAdditions ?? []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)].join(', ') : undefined;
}

function applySafeParameterChanges(delta: RepairDelta | undefined): Partial<GenerationRequest> {
  const changes = delta?.parameterChanges;
  if (!changes) return {};
  const output: Partial<GenerationRequest> = {};
  if (isFiniteBetween(changes.steps, 1, 200)) output.steps = Math.round(changes.steps);
  if (isFiniteBetween(changes.cfgScale, 0, 50)) output.cfgScale = changes.cfgScale;
  if (isFiniteBetween(changes.img2imgStrength, 0, 1)) {
    output.img2imgStrength = changes.img2imgStrength;
  }
  return output;
}

function parseEvaluation(text: string, mediaType: 'image' | 'video'): EvaluationDecision {
  const parsed = parseJsonObject(text);
  const rawScores = asRecord(parsed.scores);
  const score = (key: keyof WorkflowMediaScoreSet): number => {
    const value = rawScores[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Vision evaluation score ${key} must be between 0 and 100`);
    }
    return Math.round(value * 100) / 100;
  };
  const scores: WorkflowMediaScoreSet = {
    identity: score('identity'),
    style: score('style'),
    scriptAlignment: score('scriptAlignment'),
    continuity: score('continuity'),
    composition: score('composition'),
    lighting: score('lighting'),
    motion: mediaType === 'image' ? 100 : score('motion'),
    technical: score('technical'),
    safety: score('safety'),
  };
  const weighted =
    scores.identity * 0.15 +
    scores.style * 0.15 +
    scores.scriptAlignment * 0.15 +
    scores.continuity * 0.15 +
    scores.composition * 0.1 +
    scores.lighting * 0.1 +
    scores.motion * (mediaType === 'video' ? 0.1 : 0) +
    scores.technical * (mediaType === 'video' ? 0.05 : 0.15) +
    scores.safety * 0.05;
  const total = Math.round(weighted * 100) / 100;
  let verdict: WorkflowMediaEvaluationVerdict;
  if (scores.safety < 80) verdict = 'human_review';
  else if (
    total >= 78 &&
    Math.min(
      scores.identity,
      scores.style,
      scores.scriptAlignment,
      scores.continuity,
      scores.technical,
    ) >= 65
  ) {
    verdict = 'pass';
  } else if (total >= 55) verdict = 'repair';
  else verdict = 'regenerate';
  return {
    scores,
    total,
    verdict,
    strengths: readBoundedStringArray(parsed.strengths),
    risks: readBoundedStringArray(parsed.risks),
    evidence: readBoundedStringArray(parsed.evidence),
    repairDelta: parseRepairDelta(parsed.repairDelta),
  };
}

function boundVerdict(
  decision: EvaluationDecision,
  bounds: { canRetry: boolean; budgetExceeded: boolean },
): WorkflowMediaEvaluationVerdict {
  if (bounds.budgetExceeded) return 'human_review';
  if ((decision.verdict === 'repair' || decision.verdict === 'regenerate') && !bounds.canRetry) {
    return 'human_review';
  }
  return decision.verdict;
}

function parseRepairDelta(value: unknown): RepairDelta | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  const seedStrategy = record.seedStrategy;
  if (!reason || (seedStrategy !== 'keep' && seedStrategy !== 'increment')) return undefined;
  const rawChanges = asRecord(record.parameterChanges);
  const parameterChanges: Record<string, string | number | boolean> = {};
  for (const key of ['steps', 'cfgScale', 'img2imgStrength']) {
    const change = rawChanges[key];
    if (typeof change === 'number' && Number.isFinite(change)) parameterChanges[key] = change;
  }
  return {
    version: 1,
    reason,
    promptAdditions: readBoundedStringArray(record.promptAdditions),
    negativeAdditions: readBoundedStringArray(record.negativeAdditions),
    preserve: readBoundedStringArray(record.preserve),
    seedStrategy,
    ...(Object.keys(parameterChanges).length > 0 ? { parameterChanges } : {}),
  };
}

function normalizeRepairDelta(
  parsed: RepairDelta | undefined,
  risks: string[],
  verdict: 'repair' | 'regenerate',
): RepairDelta | undefined {
  if (parsed && (parsed.promptAdditions.length > 0 || parsed.negativeAdditions.length > 0)) {
    return parsed;
  }
  if (risks.length === 0) return undefined;
  return {
    version: 1,
    reason: `${verdict === 'repair' ? 'Repair' : 'Regenerate'} visible rubric failures`,
    promptAdditions: risks.map((risk) => `Correct: ${risk}`),
    negativeAdditions: risks,
    preserve: [],
    seedStrategy: verdict === 'regenerate' ? 'increment' : 'keep',
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const first = withoutFence.indexOf('{');
  const last = withoutFence.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('Vision evaluation did not return JSON');
  const parsed = JSON.parse(withoutFence.slice(first, last + 1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vision evaluation must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function sampleVideoTimestamps(durationSeconds: number): number[] {
  const end = Math.max(0, durationSeconds - 0.1);
  return [
    ...new Set([Math.min(0.1, end), durationSeconds / 2, end].map((v) => Number(v.toFixed(3)))),
  ];
}

function stableSeed(workflowRunId: string, nodeId: string): number {
  return Number.parseInt(sha256(`${workflowRunId}:${nodeId}`).slice(0, 8), 16) & 0x7fffffff;
}

function requireProduceInput(input: ProduceProductionMediaInput): void {
  for (const [key, value] of Object.entries({
    workflowRunId: input.workflowRunId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${key} is required`);
    }
  }
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) {
    throw new Error('expectedRowVersion must be a non-negative integer');
  }
}

function resultFor(
  attempt: WorkflowMediaAttempt,
  evaluation: WorkflowMediaEvaluation | undefined,
  status: ProduceProductionMediaResult['status'],
  message: string,
): ProduceProductionMediaResult {
  return {
    workflowRunId: attempt.workflowRunId,
    canvasId: attempt.canvasId,
    nodeId: attempt.nodeId,
    status,
    attempt,
    ...(evaluation ? { evaluation } : {}),
    nextAction:
      status === 'accepted'
        ? 'continue'
        : status === 'evaluation_pending' && !requiresConfiguration(message)
          ? 'retry_evaluation'
          : 'ask_user',
    message,
  };
}

function requiresConfiguration(message: string): boolean {
  return /not configured|configured .* not found|missing api key|settings/i.test(message);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
}

function readBoundedStringArray(value: unknown): string[] {
  return readStringArray(value)
    .slice(0, 20)
    .map((entry) => entry.slice(0, 500));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return value;
}

function optionalNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isFiniteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
