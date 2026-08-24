import { createHash, randomUUID } from 'node:crypto';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { TaskExecutionEngine } from '@lucid-fin/application';
import type {
  Canvas,
  CanvasNode,
  GenerationRequest,
  ImageNodeData,
  PromptAssemblyAuthority,
  PromptAssemblyOutputV1,
  PromptAssemblyRecord,
  PromptAssemblySource,
  ProductionMediaGenerationSpec,
  RepairDelta,
  VideoNodeData,
  ProductionMediaTaskAttempt,
  TaskEvaluation,
  TaskListId,
} from '@lucid-fin/contracts';
import {
  probeMedia as defaultProbeMedia,
  type MediaProbeResult,
  type SceneCut,
} from '@lucid-fin/media-engine';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import log from '../logger.js';
import {
  buildGenerationContext,
  buildGenerationEstimateContext,
  prepareGenerationPromptAssembly,
  resolveAdapter,
} from '../ipc/handlers/generation-context.js';
import {
  materializeGenerationRequest,
  mergeVariants,
  normalizeErrorMessage,
} from '../ipc/handlers/generation-helpers.js';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';
import type { ProjectPresetCatalog } from '../ipc/handlers/preset.handlers.js';
import {
  hashPromptAssemblyInput,
  type PromptAssemblyService,
} from './prompt-assembly.service.js';
import type { VisualAnalyzer } from './visual-analyzer.service.js';
import { MediaGenerationService } from './media-generation.service.js';
import { buildMediaGenerationSpec } from './media-generation-spec.js';
import {
  MediaEvaluationService,
  PRODUCTION_MEDIA_RUBRIC_VERSION,
  canonicalJson,
  type MediaEvaluationGradeRequest,
  type MediaEvaluationGradeResponse,
  type MediaEvaluationGrader,
  type MediaEvaluationRunOptions,
} from './media-evaluation.service.js';

export { PRODUCTION_MEDIA_RUBRIC_VERSION };

export interface ProduceProductionMediaInput {
  taskListId: string;
  canvasId: string;
  taskId: string;
  nodeId: string;
  expectedRowVersion: number;
  promptAssemblyId?: string;
  promptAssemblyOutput?: PromptAssemblyOutputV1;
}

export interface RefineProductionMediaInput {
  taskListId: string;
  canvasId: string;
  nodeId: string;
  expectedRowVersion: number;
  targetAttemptId: string;
  basePromptHash: string;
  feedback: string;
  promptAssemblyId?: string;
  promptAssemblyOutput?: PromptAssemblyOutputV1;
}

export interface ProductionMediaProgressStep {
  id:
    | 'load_existing_prompt'
    | 'apply_feedback_delta'
    | 'persist_generation_spec'
    | 'generate'
    | 'grade';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ProduceProductionMediaResult {
  taskListId: string;
  canvasId: string;
  nodeId: string;
  status:
    | 'awaiting_prompt_assembly'
    | 'awaiting_provider'
    | 'accepted'
    | 'human_review'
    | 'ambiguous'
    | 'failed'
    | 'budget_blocked'
    | 'evaluation_pending';
  promptAssembly?: PromptAssemblyRecord;
  attempt?: ProductionMediaTaskAttempt;
  evaluation?: TaskEvaluation;
  nextAction: 'assemble_prompt' | 'continue' | 'retry_evaluation' | 'ask_user';
  message: string;
  /** Run CAS to use when host completion follows an internal task reopen. */
  taskListRowVersion?: number;
  /** Ordered, durable Task List refinement phases for Commander/Execution UI. */
  steps?: ProductionMediaProgressStep[];
}

export type ProductionMediaGradeRequest = MediaEvaluationGradeRequest;
export type ProductionMediaGradeResponse = MediaEvaluationGradeResponse;
export interface ProductionMediaRunOptions extends MediaEvaluationRunOptions {
  /** Persist provider output and return before invoking any visual LLM. */
  deferEvaluation?: boolean;
}

export interface ProductionMediaServiceDeps {
  db: SqliteIndex;
  cas: CAS;
  keychain: Keychain;
  visualAnalyzer: VisualAnalyzer;
  adapterRegistry: AdapterRegistry;
  canvasStore: CanvasStore;
  presetCatalog: Pick<ProjectPresetCatalog, 'list'>;
  taskExecutionEngine: TaskExecutionEngine;
  promptAssemblyService: PromptAssemblyService;
  /** Shared image/video provider boundary used by every durable media Task List. */
  mediaGenerationService?: MediaGenerationService;
  /** Shared visual evaluation boundary used outside active Commander tool loops. */
  mediaEvaluationService?: MediaEvaluationService;
  resolveProcessPrompt?: (processKey: string) => string | null | undefined;
  gradeAssets?: MediaEvaluationGrader;
  probeMedia?: (filePath: string) => Promise<MediaProbeResult>;
  detectScenes?: (filePath: string, threshold?: number) => Promise<SceneCut[]>;
  extractFrameAtTime?: (
    videoPath: string,
    timeSeconds: number,
    outputPath: string,
  ) => Promise<void>;
  now?: () => number;
  idFactory?: () => string;
}

export class ProductionMediaService {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly probeMedia: NonNullable<ProductionMediaServiceDeps['probeMedia']>;
  private readonly mediaGenerationService: MediaGenerationService;
  private readonly mediaEvaluationService: MediaEvaluationService;

  constructor(private readonly deps: ProductionMediaServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.idFactory = deps.idFactory ?? randomUUID;
    this.probeMedia = deps.probeMedia ?? defaultProbeMedia;
    this.mediaEvaluationService =
      deps.mediaEvaluationService ??
      new MediaEvaluationService({
        db: deps.db,
        cas: deps.cas,
        visualAnalyzer: deps.visualAnalyzer,
        gradeAssets: deps.gradeAssets,
        probeMedia: this.probeMedia,
        detectScenes: deps.detectScenes,
        extractFrameAtTime: deps.extractFrameAtTime,
        now: this.now,
        idFactory: this.idFactory,
      });
    this.mediaGenerationService =
      deps.mediaGenerationService ??
      new MediaGenerationService({
        db: deps.db,
        cas: deps.cas,
        promptAssemblyService: deps.promptAssemblyService,
        resolveAdapter: (attempt) =>
          resolveAdapter(
            deps.adapterRegistry,
            attempt.providerId,
            attempt.mediaType,
            attempt.generationSpec.operation,
            undefined,
            deps.keychain,
            deps.cas,
          ),
        probe: async (filePath, mediaType) => {
          const probe = await this.probeMedia(filePath);
          return {
            width: probe.width,
            height: probe.height,
            ...(mediaType === 'video' && probe.durationSeconds > 0
              ? { duration: probe.durationSeconds, hasAudio: probe.hasAudio }
              : {}),
          };
        },
        now: this.now,
        idFactory: this.idFactory,
      });
  }

  /**
   * Reconcile only states whose crash semantics are provable without network
   * calls. Reserved work remains safe to submit later; asset-ready work remains
   * safe to re-grade. A submitted provider call is ambiguous and is never
   * replayed automatically.
   */
  recoverInterruptedAttempts(): void {
    for (const attempt of this.deps.db.repos.taskLists.listRecoverableProductionMediaAttempts()) {
      try {
        if (attempt.status === 'submitting') {
          this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
            id: attempt.id,
            expectedRowVersion: attempt.rowVersion,
            expectedStatuses: ['submitting'],
            status: 'ambiguous',
            error:
              'Application restarted after provider submission; outcome is ambiguous and automatic retry is disabled.',
            completedAt: this.now(),
            updatedAt: this.now(),
          });
        } else if (attempt.status === 'evaluating') {
          this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
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

  /**
   * Grade one durable provider output after the Commander run has yielded.
   * This method never submits provider work; it only consumes asset-ready evidence.
   */
  async evaluatePending(
    taskListId: string,
    canvasId: string,
  ): Promise<ProduceProductionMediaResult | undefined> {
    const taskList = this.deps.taskExecutionEngine.get(taskListId);
    if (
      !taskList ||
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.entityId !== canvasId
    ) {
      return undefined;
    }
    const attempt = this.deps.db.repos.taskLists
      .listProductionMediaAttempts(taskListId as TaskListId)
      .filter((candidate) => candidate.status === 'asset_ready' || candidate.status === 'evaluating')
      .sort((left, right) => right.attempt - left.attempt)[0];
    if (!attempt) return undefined;
    const taskId = attempt.generationSpec.task.id;
    const productionContext = this.deps.taskExecutionEngine.requireProductionMediaContext(
      taskListId,
      canvasId,
      taskId,
      taskList.rowVersion ?? 0,
    );
    const canvas = this.deps.canvasStore.get(canvasId);
    const node = canvas?.nodes.find((candidate) => candidate.id === attempt.nodeId);
    if (!canvas || !node || (node.type !== 'image' && node.type !== 'video')) {
      throw new Error('Pending production-media evaluation lost its Canvas node binding');
    }
    return this.evaluateAttempt(productionContext, canvas, node, attempt, {});
  }

  async produce(
    input: ProduceProductionMediaInput,
    runOptions: ProductionMediaRunOptions = {},
  ): Promise<ProduceProductionMediaResult> {
    requireProduceInput(input);
    const productionContext = this.deps.taskExecutionEngine.requireProductionMediaContext(
      input.taskListId,
      input.canvasId,
      input.taskId,
      input.expectedRowVersion,
    );
    const canvas = this.deps.canvasStore.get(input.canvasId);
    if (!canvas) throw new Error(`Canvas "${input.canvasId}" not found`);
    const node = canvas.nodes.find((entry) => entry.id === input.nodeId);
    if (!node) throw new Error(`Node "${input.nodeId}" not found`);
    if (node.type !== 'image' && node.type !== 'video') {
      throw new Error('Persistent production-media quality control supports image and video nodes');
    }

    const latest = this.deps.db.repos.taskLists.getLatestProductionMediaAttempt(
      input.taskListId as TaskListId,
      input.nodeId,
    );

    if (latest?.status === 'accepted') {
      const evaluation = this.deps.db.repos.taskLists.getTaskEvaluation(latest.id);
      if (!latest.assetHash || !evaluation) {
        throw new Error('Accepted production-media attempt is missing durable evidence');
      }
      this.attachAcceptedAsset(canvas, node, latest);
      return resultFor(latest, evaluation, 'accepted', 'The accepted media evidence was restored.');
    }

    if (latest?.status === 'submitting' || latest?.status === 'awaiting_provider') {
      const advanced = await this.mediaGenerationService.advance(latest.id);
      if (advanced.status === 'asset_ready') {
        return this.evaluateOrDefer(productionContext, canvas, node, advanced, runOptions);
      }
      return resultFor(
        advanced,
        undefined,
        advanced.status === 'awaiting_provider' ? 'awaiting_provider' : 'ambiguous',
        advanced.error ??
          (advanced.status === 'awaiting_provider'
            ? 'The provider accepted the request and generation is still running.'
            : 'Provider outcome is ambiguous and requires user review.'),
      );
    }

    if (latest?.status === 'asset_ready' || latest?.status === 'evaluating') {
      return this.evaluateOrDefer(productionContext, canvas, node, latest, runOptions);
    }

    if (latest?.status === 'reserved') {
      if (latest.generationSpec.nodeUpdatedAt !== node.updatedAt) {
        const reviewed = this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
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
      const promptAssemblyId = latest.promptAssemblyId ?? latest.generationSpec.promptAssemblyId;
      const promptAssembly = promptAssemblyId
        ? this.deps.promptAssemblyService.get(promptAssemblyId)
        : undefined;
      if (!promptAssembly?.output) {
        const reviewed = this.deps.db.repos.taskLists.transitionProductionMediaAttempt({
          id: latest.id,
          expectedRowVersion: latest.rowVersion,
          expectedStatuses: ['reserved'],
          status: 'human_review',
          error:
            'The reserved request has no durable Prompt Assembly lineage; automatic replay is disabled.',
          completedAt: this.now(),
          updatedAt: this.now(),
        });
        return resultFor(reviewed, undefined, 'human_review', reviewed.error!);
      }
      const context = await buildGenerationEstimateContext(
        {
          adapterRegistry: this.deps.adapterRegistry,
          cas: this.deps.cas,
          db: this.deps.db,
          canvasStore: this.deps.canvasStore,
          keychain: this.deps.keychain,
          getWindow: () => null,
          resolvePresetCatalog: this.deps.presetCatalog.list,
          promptAssemblyService: this.deps.promptAssemblyService,
          ...(this.deps.resolveProcessPrompt
            ? {
                resolveProcessPrompt: (processKey: string) =>
                  this.deps.resolveProcessPrompt?.(processKey) ?? '',
              }
            : {}),
        },
        {
          canvasId: input.canvasId,
          nodeId: input.nodeId,
          requestedVariantCount: 1,
          styleAuthority: 'visual-constitution',
        },
      );
      const previousAttempt = this.deps.db.repos.taskLists
        .listProductionMediaAttempts(input.taskListId as TaskListId)
        .filter(
          (attempt) =>
            attempt.nodeId === latest.nodeId &&
            attempt.attempt < latest.attempt &&
            attempt.id !== latest.id,
        )
        .sort((a, b) => b.attempt - a.attempt)[0];
      assertReservedPromptAssembly(
        promptAssembly,
        input,
        productionContext,
        node,
        latest,
        previousAttempt,
        context,
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
      const resumed = await this.submitAndImport(latest);
      if (resumed.status === 'asset_ready') {
        return this.evaluateOrDefer(productionContext, canvas, node, resumed, runOptions);
      }
      return resultFor(
        resumed,
        undefined,
        resumed.status === 'awaiting_provider'
          ? 'awaiting_provider'
          : resumed.status === 'ambiguous'
            ? 'ambiguous'
            : 'failed',
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
        this.deps.db.repos.taskLists.getTaskEvaluation(latest.id),
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
        ? this.deps.db.repos.taskLists.getTaskEvaluation(latest.id)
        : undefined;
      const evaluationDelta =
        latest?.status === 'repair_required' || latest?.status === 'regenerate_required'
          ? previousEvaluation?.repairDelta
          : undefined;
      const repairDelta =
        latest && evaluationDelta
          ? {
              ...evaluationDelta,
              source: 'vision_evaluation' as const,
              parentAttemptId: latest.id,
              basePromptHash: latest.promptHash,
            }
          : undefined;
      const prepared = await this.prepareAttempt(
        input,
        productionContext,
        canvas,
        node,
        latest,
        repairDelta,
        runOptions,
      );
      if ('awaitingPromptAssembly' in prepared) {
        return awaitingPromptAssemblyResult(
          input,
          prepared.awaitingPromptAssembly,
          latest,
          previousEvaluation,
        );
      }
      if ('blocked' in prepared) {
        return {
          taskListId: input.taskListId,
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
        attempt = await this.submitAndImport(attempt);
      }
      if (attempt.status !== 'asset_ready' && attempt.status !== 'evaluating') {
        const status =
          attempt.status === 'awaiting_provider'
            ? 'awaiting_provider'
            : attempt.status === 'ambiguous'
              ? 'ambiguous'
              : 'failed';
        return resultFor(
          attempt,
          undefined,
          status,
          attempt.error ?? 'Provider generation did not produce a gradeable asset.',
        );
      }

      const evaluated = await this.evaluateOrDefer(
        productionContext,
        canvas,
        node,
        attempt,
        runOptions,
      );
      if (evaluated.status !== 'evaluation_pending') return evaluated;
      return evaluated;
    }
  }

  /**
   * Persist a small human quality comment beside the exact prior provider
   * prompt, then wait for the outer Commander to author the next complete
   * prompt. The host validates lineage and never appends creative text itself.
   */
  async refine(
    input: RefineProductionMediaInput,
    runOptions: ProductionMediaRunOptions = {},
  ): Promise<ProduceProductionMediaResult> {
    const feedback = requireRefineInput(input);
    const target = this.deps.db.repos.taskLists.getProductionMediaAttempt(input.targetAttemptId);
    if (
      !target ||
      target.taskListId !== input.taskListId ||
      target.canvasId !== input.canvasId ||
      target.nodeId !== input.nodeId
    ) {
      throw new Error('The requested production-media attempt was not found for this node');
    }
    const latest = this.deps.db.repos.taskLists.getLatestProductionMediaAttempt(
      input.taskListId as TaskListId,
      input.nodeId,
    );
    if (!latest || latest.id !== target.id) {
      throw new Error('A newer production-media attempt exists; reload before applying feedback');
    }
    if (target.promptHash !== input.basePromptHash) {
      throw new Error('The existing provider prompt hash changed; reload before applying feedback');
    }
    if (
      target.status !== 'accepted' &&
      target.status !== 'human_review' &&
      target.status !== 'repair_required' &&
      target.status !== 'regenerate_required'
    ) {
      throw new Error(`Attempt status "${target.status}" cannot accept a quality refinement`);
    }

    const targetTaskId = target.generationSpec.task.id;
    const targetTask = this.deps.taskExecutionEngine
      .getTasks(input.taskListId)
      .find((candidate) => candidate.id === targetTaskId);
    const completedTaskFeedback = targetTask?.status === 'completed';
    const productionContext = completedTaskFeedback
      ? this.deps.taskExecutionEngine.requireProductionMediaFeedbackContext(
          input.taskListId,
          input.canvasId,
          targetTaskId,
          input.expectedRowVersion,
        )
      : this.deps.taskExecutionEngine.requireProductionMediaContext(
          input.taskListId,
          input.canvasId,
          targetTaskId,
          input.expectedRowVersion,
        );
    const canvas = this.deps.canvasStore.get(input.canvasId);
    if (!canvas) throw new Error(`Canvas "${input.canvasId}" not found`);
    const node = canvas.nodes.find((entry) => entry.id === input.nodeId);
    if (!node || (node.type !== 'image' && node.type !== 'video')) {
      throw new Error('The refined production-media node must be an image or video node');
    }
    const repairDelta: RepairDelta = {
      version: 1,
      reason: "Apply the user's quality feedback without changing approved creative scope",
      reasonCodes: ['user.feedback'],
      promptAdditions: [feedback],
      negativeAdditions: [],
      preserve: [
        'approved story, Visual Constitution, references, framing, and unaffected details',
      ],
      seedStrategy: 'keep',
      source: 'user_feedback',
      parentAttemptId: target.id,
      basePromptHash: target.promptHash,
      userFeedback: feedback,
    };
    const prepared = await this.prepareAttempt(
      {
        taskListId: input.taskListId,
        canvasId: input.canvasId,
        taskId: targetTaskId,
        nodeId: input.nodeId,
        expectedRowVersion: input.expectedRowVersion,
        ...(input.promptAssemblyId ? { promptAssemblyId: input.promptAssemblyId } : {}),
        ...(input.promptAssemblyOutput ? { promptAssemblyOutput: input.promptAssemblyOutput } : {}),
      },
      productionContext,
      canvas,
      node,
      target,
      repairDelta,
      runOptions,
      completedTaskFeedback
        ? {
            targetAttemptId: target.id,
            basePromptHash: target.promptHash,
            feedback,
          }
        : undefined,
    );
    if ('awaitingPromptAssembly' in prepared) {
      return {
        ...awaitingPromptAssemblyResult(
          {
            taskListId: input.taskListId,
            canvasId: input.canvasId,
            nodeId: input.nodeId,
          },
          prepared.awaitingPromptAssembly,
          target,
          this.deps.db.repos.taskLists.getTaskEvaluation(target.id),
        ),
        steps: [
          { id: 'load_existing_prompt', status: 'completed' },
          { id: 'apply_feedback_delta', status: 'completed' },
          { id: 'persist_generation_spec', status: 'pending' },
          { id: 'generate', status: 'pending' },
          { id: 'grade', status: 'pending' },
        ],
      };
    }
    const taskListRowVersion =
      'blocked' in prepared
        ? input.expectedRowVersion
        : (prepared.taskListRowVersion ?? input.expectedRowVersion);
    const initialSteps: ProductionMediaProgressStep[] = [
      { id: 'load_existing_prompt', status: 'completed' },
      {
        id: 'apply_feedback_delta',
        status: 'blocked' in prepared ? 'failed' : 'completed',
      },
      {
        id: 'persist_generation_spec',
        status: 'blocked' in prepared ? 'failed' : 'completed',
      },
      { id: 'generate', status: 'blocked' in prepared ? 'pending' : 'in_progress' },
      { id: 'grade', status: 'pending' },
    ];
    if ('blocked' in prepared) {
      return {
        taskListId: input.taskListId,
        canvasId: input.canvasId,
        nodeId: input.nodeId,
        status: 'budget_blocked',
        attempt: target,
        evaluation: this.deps.db.repos.taskLists.getTaskEvaluation(target.id),
        nextAction: 'ask_user',
        message: `Feedback was not applied: ${prepared.blocked}`,
        taskListRowVersion,
        steps: initialSteps,
      };
    }

    let attempt = prepared.attempt;
    if (attempt.status === 'reserved') {
      attempt = await this.submitAndImport(attempt);
    }
    if (attempt.status !== 'asset_ready' && attempt.status !== 'evaluating') {
      return {
        ...resultFor(
          attempt,
          undefined,
          attempt.status === 'awaiting_provider'
            ? 'awaiting_provider'
            : attempt.status === 'ambiguous'
              ? 'ambiguous'
              : 'failed',
          attempt.error ?? 'Provider generation did not produce a gradeable asset.',
        ),
        taskListRowVersion,
        steps: initialSteps.map((step) =>
          step.id === 'generate'
            ? { ...step, status: 'failed' }
            : step.id === 'grade'
              ? { ...step, status: 'pending' }
              : step,
        ),
      };
    }

    const evaluated = await this.evaluateOrDefer(
      productionContext,
      canvas,
      node,
      attempt,
      runOptions,
    );
    return {
      ...evaluated,
      taskListRowVersion,
      steps: initialSteps.map((step) =>
        step.id === 'generate'
          ? { ...step, status: 'completed' }
          : step.id === 'grade'
            ? {
                ...step,
                status: evaluated.status === 'evaluation_pending' ? 'in_progress' : 'completed',
              }
            : step,
      ),
    };
  }

  private async resolvePromptAssemblyContext(
    input: ProduceProductionMediaInput,
    productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
    node: CanvasNode,
    latest: ProductionMediaTaskAttempt | undefined,
    repairDelta: RepairDelta | undefined,
    runOptions: ProductionMediaRunOptions,
  ): Promise<
    | {
        context: Awaited<ReturnType<typeof buildGenerationContext>>;
        promptAssembly: PromptAssemblyRecord & { output: PromptAssemblyOutputV1 };
      }
    | { awaitingPromptAssembly: PromptAssemblyRecord }
  > {
    if (input.promptAssemblyOutput && !input.promptAssemblyId) {
      throw new Error('promptAssemblyId is required with Prompt Assembly output');
    }

    const authority = productionPromptAssemblyAuthority(input, productionContext);
    const parentAssemblyId = latest?.promptAssemblyId ?? latest?.generationSpec.promptAssemblyId;
    const parent = latest
      ? {
          ...(parentAssemblyId ? { assemblyId: parentAssemblyId } : {}),
          finalPrompt: latest.prompt,
          promptHash: latest.promptHash,
          ...(latest.assetHash ? { assetHash: latest.assetHash } : {}),
          ...(repairDelta?.source === 'user_feedback' && repairDelta.userFeedback
            ? { userFeedback: repairDelta.userFeedback }
            : {}),
        }
      : undefined;
    const additionalSources: Array<Omit<PromptAssemblySource, 'sourceHash'>> =
      repairDelta?.source === 'vision_evaluation'
        ? [
            {
              sourceId: 'repair-delta',
              kind: 'repair-delta',
              label: 'Visual evaluation repair delta',
              content: canonicalJson(repairDelta),
              required: true,
              metadata: {
                parentAttemptId: repairDelta.parentAttemptId,
                basePromptHash: repairDelta.basePromptHash,
              },
            },
          ]
        : [];
    const purpose =
      repairDelta?.source === 'user_feedback'
        ? ('user_refine' as const)
        : latest?.status === 'regenerate_required'
          ? ('regenerate' as const)
          : repairDelta
            ? ('evaluation_repair' as const)
            : ('initial' as const);
    const generationDeps = {
      adapterRegistry: this.deps.adapterRegistry,
      cas: this.deps.cas,
      db: this.deps.db,
      canvasStore: this.deps.canvasStore,
      keychain: this.deps.keychain,
      getWindow: () => null,
      resolvePresetCatalog: this.deps.presetCatalog.list,
      promptAssemblyService: this.deps.promptAssemblyService,
      ...(runOptions.preferredLLMAdapter
        ? { preferredPromptAssembler: runOptions.preferredLLMAdapter }
        : {}),
      ...(this.deps.resolveProcessPrompt
        ? {
            resolveProcessPrompt: (processKey: string) =>
              this.deps.resolveProcessPrompt?.(processKey) ?? '',
          }
        : {}),
    };
    const generationInput = {
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      requestedVariantCount: 1,
      styleAuthority: 'visual-constitution' as const,
      promptAssemblyAuthority: authority,
      promptAssemblyPurpose: purpose,
      ...(parent ? { promptAssemblyParent: parent } : {}),
      ...(additionalSources.length > 0
        ? { promptAssemblyAdditionalSources: additionalSources }
        : {}),
    };

    if (!input.promptAssemblyId) {
      const context = await prepareGenerationPromptAssembly(generationDeps, generationInput);
      const prepared = context.promptAssemblyId
        ? this.deps.promptAssemblyService.get(context.promptAssemblyId)
        : undefined;
      if (!prepared) throw new Error('Production Prompt Assembly was not persisted');
      return { awaitingPromptAssembly: prepared };
    }

    const existing = this.deps.promptAssemblyService.get(input.promptAssemblyId);
    if (!existing) throw new Error(`Prompt Assembly not found: ${input.promptAssemblyId}`);
    assertProductionPromptAssembly(
      existing,
      input,
      productionContext,
      node,
      purpose,
      latest,
      repairDelta,
    );
    if (existing.status === 'prepared' && !input.promptAssemblyOutput) {
      return { awaitingPromptAssembly: existing };
    }
    if (existing.status === 'assembled') {
      if (
        input.promptAssemblyOutput &&
        canonicalJson(existing.output) !== canonicalJson(input.promptAssemblyOutput)
      ) {
        throw new Error('Prompt Assembly output differs from the already persisted revision');
      }
    } else if (existing.status !== 'prepared') {
      throw new Error(`Prompt Assembly ${existing.id} cannot generate from ${existing.status}`);
    }

    const context = await buildGenerationContext(generationDeps, {
      ...generationInput,
      promptAssemblyId: existing.id,
      ...(existing.status === 'prepared' && input.promptAssemblyOutput
        ? { promptAssemblyOutput: input.promptAssemblyOutput }
        : {}),
    });
    const assembled = this.deps.promptAssemblyService.get(existing.id);
    if (assembled?.status !== 'assembled' || !assembled.output) {
      throw new Error(`Prompt Assembly ${existing.id} is not ready for provider submission`);
    }
    if (
      assembled.input.providerProfile.providerId !== context.adapter.id ||
      assembled.input.mediaType !== context.generationType ||
      assembled.input.mode !== context.mode ||
      context.requestBase.prompt !== assembled.output.finalPrompt ||
      context.requestBase.negativePrompt !== assembled.output.negativePrompt
    ) {
      throw new Error(
        'Provider request context does not exactly match the persisted Prompt Assembly',
      );
    }
    return {
      context,
      promptAssembly: assembled as PromptAssemblyRecord & { output: PromptAssemblyOutputV1 },
    };
  }

  private async prepareAttempt(
    input: ProduceProductionMediaInput,
    productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
    canvas: Canvas,
    node: CanvasNode,
    latest: ProductionMediaTaskAttempt | undefined,
    repairDelta: RepairDelta | undefined,
    runOptions: ProductionMediaRunOptions,
    feedbackReservation?: {
      targetAttemptId: string;
      basePromptHash: string;
      feedback: string;
    },
  ): Promise<
    | {
        attempt: ProductionMediaTaskAttempt;
        taskListRowVersion?: number;
      }
    | { awaitingPromptAssembly: PromptAssemblyRecord }
    | { blocked: string }
  > {
    const attemptNumber = (latest?.attempt ?? 0) + 1;
    const limits = readApprovedLimits(productionContext.productionPlan.content);
    const summary = this.deps.db.repos.taskLists.getTaskCostSummary(input.taskListId as TaskListId);
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

    const contextResult = await this.resolvePromptAssemblyContext(
      input,
      productionContext,
      node,
      latest,
      repairDelta,
      runOptions,
    );
    if ('awaitingPromptAssembly' in contextResult) return contextResult;
    const { context, promptAssembly } = contextResult;
    if (context.generationType !== 'image' && context.generationType !== 'video') {
      throw new Error('Production-media service received a non-visual generation type');
    }

    if (latest && context.adapter.id !== latest.providerId) {
      throw new Error(
        'The provider changed after the previous attempt; use an explicit Task List revision instead of an incremental repair',
      );
    }
    const priorRequest = latest
      ? restoreRequestFromSpec(latest.generationSpec)
      : context.requestBase;
    const baseSeed =
      typeof latest?.seed === 'number'
        ? latest.seed
        : typeof priorRequest.seed === 'number'
          ? priorRequest.seed
          : stableSeed(input.taskListId, input.nodeId);
    const seed = repairDelta?.seedStrategy === 'increment' ? baseSeed + 1 : baseSeed;
    const request: GenerationRequest = {
      ...priorRequest,
      prompt: promptAssembly.output.finalPrompt,
      negativePrompt: promptAssembly.output.negativePrompt,
      seed,
      ...applySafeParameterChanges(repairDelta),
    };
    // Preflight every durable reference before estimating cost or reserving an
    // attempt. This prevents a missing CAS object from consuming budget and
    // later degrading into an unconditioned provider request.
    materializeGenerationRequest(request, this.deps.cas);
    const estimate = context.adapter.estimateCost(request);
    if (!Number.isFinite(estimate.estimatedCost) || estimate.estimatedCost < 0) {
      throw new Error('Provider returned an invalid cost estimate; generation was not reserved');
    }
    const styleCost = readStyleAuditionCommittedCost(
      this.deps.taskExecutionEngine.getLatestVisualAudition(input.taskListId)?.content,
    );
    const projectedCost = styleCost + summary.committedCostUsd + estimate.estimatedCost;
    if (projectedCost > limits.maxTotalCostUsd + 1e-9) {
      return {
        blocked: `Projected committed cost $${projectedCost.toFixed(4)} exceeds the approved $${limits.maxTotalCostUsd.toFixed(4)} total budget.`,
      };
    }

    const createdAt = this.now();
    const generationSpec = buildMediaGenerationSpec({
      scope: 'production',
      authority: {
        kind: 'task-list-approved',
        planId: productionContext.productionPlan.id,
        planHash: productionContext.productionPlan.contentHash,
        constitutionId: productionContext.visualConstitution.id,
        constitutionHash: productionContext.visualConstitution.contentHash,
      },
      taskListId: input.taskListId,
      task: productionContext.task,
      canvas,
      node,
      context,
      request,
      promptAssembly,
      limits: { ...limits, styleAuditionCommittedCostUsd: styleCost },
      lineage: {
        purpose: promptAssembly.purpose,
        ...(latest ? { parentAttemptId: latest.id } : {}),
        ...(repairDelta?.sourceEvaluationId
          ? { sourceEvaluationId: repairDelta.sourceEvaluationId }
          : {}),
        ...(repairDelta?.sourceArtifactId
          ? { sourceArtifactId: repairDelta.sourceArtifactId }
          : {}),
        ...(repairDelta?.basePromptHash
          ? { basePromptHash: repairDelta.basePromptHash }
          : {}),
        variantIndex: 0,
        variantCount: 1,
      },
      createdAt,
    });
    const specHash = sha256(canonicalJson({ ...generationSpec, createdAt: undefined }));
    const proposed: ProductionMediaTaskAttempt = {
      kind: 'production_media',
      id: this.idFactory(),
      taskListId: input.taskListId,
      taskId: input.taskId,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      attempt: attemptNumber,
      idempotencyKey: sha256(
        canonicalJson({
          taskListId: input.taskListId,
          taskId: input.taskId,
          nodeId: input.nodeId,
          attempt: attemptNumber,
          specHash,
        }),
      ),
      specHash,
      generationSpec,
      ...(repairDelta ? { repairDelta } : {}),
      scope: 'production',
      mediaType: context.generationType,
      status: 'reserved',
      rowVersion: 0,
      providerId: context.adapter.id,
      promptAssemblyId: promptAssembly.id,
      ...(latest ? { parentAttemptId: latest.id } : {}),
      submissionPurpose: promptAssembly.purpose,
      model: generationSpec.modelId,
      prompt: request.prompt,
      promptHash: sha256(request.prompt),
      ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      seed,
      estimatedCostUsd: estimate.estimatedCost,
      createdAt,
      updatedAt: createdAt,
    };
    let reserved: {
      attempt: ProductionMediaTaskAttempt;
      created: boolean;
      taskListRowVersion?: number;
    };
    try {
      if (feedbackReservation) {
        const result = await this.deps.taskExecutionEngine.reserveMediaFeedbackAttemptForRevision({
          taskListId: input.taskListId,
          canvasId: input.canvasId,
          taskId: input.taskId,
          attemptId: feedbackReservation.targetAttemptId,
          basePromptHash: feedbackReservation.basePromptHash,
          expectedRowVersion: input.expectedRowVersion,
          feedback: feedbackReservation.feedback,
          attempt: proposed,
        });
        reserved = {
          attempt: result.attempt,
          created: true,
          ...(result.taskList.rowVersion !== undefined
            ? { taskListRowVersion: result.taskList.rowVersion }
            : {}),
        };
      } else {
        reserved = this.deps.db.repos.taskLists.reserveProductionMediaAttempt({
          attempt: proposed,
          expectedTaskListRowVersion: input.expectedRowVersion,
        });
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (/approved .* (?:budget|limit)|would be exceeded|limit is exhausted/i.test(message)) {
        return { blocked: message };
      }
      throw error;
    }
    return {
      attempt: withPromptAssemblyId(reserved.attempt),
      ...(reserved.taskListRowVersion !== undefined
        ? { taskListRowVersion: reserved.taskListRowVersion }
        : {}),
    };
  }

  private async submitAndImport(
    attempt: ProductionMediaTaskAttempt,
  ): Promise<ProductionMediaTaskAttempt> {
    return this.mediaGenerationService.advance(attempt.id);
  }

  private async evaluateOrDefer(
    productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
    canvas: Canvas,
    node: CanvasNode,
    attempt: ProductionMediaTaskAttempt,
    runOptions: ProductionMediaRunOptions,
  ): Promise<ProduceProductionMediaResult> {
    if (runOptions.deferEvaluation) {
      return resultFor(
        attempt,
        undefined,
        'evaluation_pending',
        'The generated asset is durable and queued for background visual evaluation.',
      );
    }
    return this.evaluateAttempt(productionContext, canvas, node, attempt, runOptions);
  }

  private async evaluateAttempt(
    productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
    canvas: Canvas,
    node: CanvasNode,
    attempt: ProductionMediaTaskAttempt,
    runOptions: ProductionMediaRunOptions,
  ): Promise<ProduceProductionMediaResult> {
    const outcome = await this.mediaEvaluationService.evaluate({
      attempt,
      productionPlan: productionContext.productionPlan.content,
      visualConstitution: productionContext.visualConstitution.content,
      rubricVersion: PRODUCTION_MEDIA_RUBRIC_VERSION,
      runOptions,
      validateAuthority: (candidate) => {
        const authority = candidate.generationSpec.authority;
        if (
          authority.kind !== 'task-list-approved' ||
          authority.planId !== productionContext.productionPlan.id ||
          authority.planHash !== productionContext.productionPlan.contentHash ||
          authority.constitutionId !== productionContext.visualConstitution.id ||
          authority.constitutionHash !== productionContext.visualConstitution.contentHash
        ) {
          throw new Error(
            'The media attempt is bound to a different Visual Constitution revision; automatic grading is fail-closed.',
          );
        }
        const recordedStyle = this.deps.db.repos.assets.findByHash(candidate.assetHash as never)
          ?.generationMetadata?.visualStyle;
        if (
          recordedStyle &&
          (recordedStyle.source !== 'visual-constitution' ||
            recordedStyle.policyHash !== authority.constitutionHash ||
            recordedStyle.taskListId !== productionContext.taskList.id ||
            recordedStyle.contentHash !== authority.constitutionHash)
        ) {
          throw new Error(
            'Generated asset style provenance does not match the approved Visual Constitution; automatic grading is fail-closed.',
          );
        }
      },
      validateNodeRevision: (candidate) => {
        if (candidate.generationSpec.nodeUpdatedAt !== node.updatedAt) {
          throw new Error(
            'The canvas node changed after reservation; the generated artifact cannot be selected automatically.',
          );
        }
      },
      getVerdictBounds: (evaluating) =>
        this.remainingBounds(evaluating, productionContext.productionPlan.content),
    });

    if (outcome.status === 'evaluation_pending') {
      return resultFor(outcome.attempt, undefined, 'evaluation_pending', outcome.message);
    }
    if (outcome.status === 'human_review') {
      return resultFor(outcome.attempt, undefined, 'human_review', outcome.message);
    }
    const recorded = outcome;

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

    return this.produce(
      {
        taskListId: recorded.attempt.taskListId,
        canvasId: recorded.attempt.canvasId,
        taskId: recorded.attempt.generationSpec.task.id,
        nodeId: recorded.attempt.nodeId,
        expectedRowVersion: productionContext.taskList.rowVersion ?? 0,
      },
      runOptions,
    );
  }

  private remainingBounds(
    attempt: ProductionMediaTaskAttempt,
    productionPlan: Record<string, unknown>,
  ): { canRetry: boolean; budgetExceeded: boolean } {
    const limits = readApprovedLimits(productionPlan);
    const summary = this.deps.db.repos.taskLists.getTaskCostSummary(
      attempt.taskListId as TaskListId,
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

  private attachAcceptedAsset(
    canvas: Canvas,
    node: CanvasNode,
    attempt: ProductionMediaTaskAttempt,
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

function restoreRequestFromSpec(spec: ProductionMediaGenerationSpec): GenerationRequest {
  return structuredClone(spec.request);
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

function stableSeed(taskListId: string, nodeId: string): number {
  return Number.parseInt(sha256(`${taskListId}:${nodeId}`).slice(0, 8), 16) & 0x7fffffff;
}

function requireProduceInput(input: ProduceProductionMediaInput): void {
  for (const [key, value] of Object.entries({
    taskListId: input.taskListId,
    canvasId: input.canvasId,
    taskId: input.taskId,
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

function requireRefineInput(input: RefineProductionMediaInput): string {
  for (const [key, value] of Object.entries({
    taskListId: input.taskListId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    targetAttemptId: input.targetAttemptId,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${key} is required`);
    }
  }
  if (!Number.isInteger(input.expectedRowVersion) || input.expectedRowVersion < 0) {
    throw new Error('expectedRowVersion must be a non-negative integer');
  }
  if (!/^[a-f0-9]{64}$/i.test(input.basePromptHash)) {
    throw new Error('basePromptHash must be a SHA-256 hex digest');
  }
  const feedback = typeof input.feedback === 'string' ? input.feedback.trim() : '';
  if (!feedback) throw new Error('feedback is required');
  if (feedback.length > 2_000) throw new Error('feedback must be 2000 characters or fewer');
  return feedback;
}

function assertProductionPromptAssembly(
  record: PromptAssemblyRecord,
  input: ProduceProductionMediaInput,
  productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
  node: CanvasNode,
  purpose: PromptAssemblyRecord['purpose'],
  latest: ProductionMediaTaskAttempt | undefined,
  repairDelta: RepairDelta | undefined,
): void {
  const authority = record.input.authority;
  if (
    record.canvasId !== input.canvasId ||
    record.nodeId !== input.nodeId ||
    record.nodeUpdatedAt !== node.updatedAt ||
    record.purpose !== purpose ||
    authority.kind !== 'task-list-approved' ||
    authority.taskListId !== input.taskListId ||
    authority.taskId !== input.taskId ||
    authority.productionPlan.revision !== productionContext.productionPlan.revision ||
    authority.productionPlan.contentHash !== productionContext.productionPlan.contentHash ||
    authority.visualConstitution.revision !== productionContext.visualConstitution.revision ||
    authority.visualConstitution.contentHash !== productionContext.visualConstitution.contentHash
  ) {
    throw new Error('Prompt Assembly is stale or belongs to another approved Task List task');
  }
  const parentAssemblyId = latest?.promptAssemblyId ?? latest?.generationSpec.promptAssemblyId;
  if (parentAssemblyId && record.parentAssemblyId !== parentAssemblyId) {
    throw new Error('Prompt Assembly does not continue the latest provider-prompt lineage');
  }
  if (latest) {
    const parentSource = record.input.sources.find((source) => source.kind === 'parent-prompt');
    if (
      parentSource?.content !== latest.prompt ||
      parentSource.metadata?.promptHash !== latest.promptHash
    ) {
      throw new Error('Prompt Assembly parent prompt no longer matches the latest attempt');
    }
  }
  if (repairDelta?.source === 'user_feedback') {
    const feedbackSource = record.input.sources.find((source) => source.kind === 'user-feedback');
    if (feedbackSource?.content !== repairDelta.userFeedback) {
      throw new Error('Prompt Assembly was prepared for different user feedback');
    }
  } else if (repairDelta?.source === 'vision_evaluation') {
    const repairSource = record.input.sources.find((source) => source.kind === 'repair-delta');
    if (repairSource?.content !== canonicalJson(repairDelta)) {
      throw new Error('Prompt Assembly repair delta no longer matches the persisted evaluation');
    }
  }
}

function assertReservedPromptAssembly(
  record: PromptAssemblyRecord,
  input: ProduceProductionMediaInput,
  productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
  node: CanvasNode,
  reservedAttempt: ProductionMediaTaskAttempt,
  previousAttempt: ProductionMediaTaskAttempt | undefined,
  context: Awaited<ReturnType<typeof buildGenerationEstimateContext>>,
): asserts record is PromptAssemblyRecord & { output: PromptAssemblyOutputV1 } {
  if ((record.status !== 'assembled' && record.status !== 'submitted') || !record.output) {
    throw new Error(`Reserved Prompt Assembly ${record.id} is not replayable from ${record.status}`);
  }
  assertProductionPromptAssembly(
    record,
    input,
    productionContext,
    node,
    record.purpose,
    previousAttempt,
    reservedAttempt.repairDelta,
  );

  const expectedParentAssemblyId = previousAttempt
    ? (previousAttempt.promptAssemblyId ?? previousAttempt.generationSpec.promptAssemblyId)
    : undefined;
  if (record.parentAssemblyId !== expectedParentAssemblyId) {
    throw new Error('Reserved Prompt Assembly parent lineage is stale');
  }

  const { inputHash: _inputHash, ...hashableInput } = record.input;
  if (
    record.input.inputHash !== record.inputHash ||
    record.output.inputHash !== record.inputHash ||
    record.output.assemblyId !== record.id ||
    hashPromptAssemblyInput(hashableInput) !== record.inputHash
  ) {
    throw new Error('Reserved Prompt Assembly input/output integrity check failed');
  }

  const assemblyId = reservedAttempt.promptAssemblyId ?? reservedAttempt.generationSpec.promptAssemblyId;
  if (
    assemblyId !== record.id ||
    record.input.providerProfile.providerId !== reservedAttempt.providerId ||
    record.input.providerProfile.providerId !== context.adapter.id ||
    record.input.mediaType !== context.generationType ||
    record.input.mode !== context.mode ||
    record.output.finalPrompt !== reservedAttempt.prompt ||
    record.output.finalPrompt !== reservedAttempt.generationSpec.prompt ||
    record.output.negativePrompt !== reservedAttempt.negativePrompt ||
    record.output.negativePrompt !== reservedAttempt.generationSpec.negativePrompt
  ) {
    throw new Error('Reserved provider request does not match its persisted Prompt Assembly');
  }
}

function productionPromptAssemblyAuthority(
  input: Pick<ProduceProductionMediaInput, 'taskListId' | 'taskId'>,
  productionContext: ReturnType<TaskExecutionEngine['requireProductionMediaContext']>,
): Extract<PromptAssemblyAuthority, { kind: 'task-list-approved' }> {
  const shot = asRecord(productionContext.task.input.shot);
  return {
    kind: 'task-list-approved',
    taskListId: input.taskListId,
    taskId: input.taskId,
    productionPlan: {
      revision: productionContext.productionPlan.revision,
      contentHash: productionContext.productionPlan.contentHash,
      content: productionContext.productionPlan.content,
    },
    visualConstitution: {
      revision: productionContext.visualConstitution.revision,
      contentHash: productionContext.visualConstitution.contentHash,
      content: productionContext.visualConstitution.content,
    },
    ...(typeof shot.id === 'string' && shot.id.trim() ? { shotId: shot.id.trim() } : {}),
  };
}

function awaitingPromptAssemblyResult(
  input: Pick<ProduceProductionMediaInput, 'taskListId' | 'canvasId' | 'nodeId'>,
  promptAssembly: PromptAssemblyRecord,
  attempt?: ProductionMediaTaskAttempt,
  evaluation?: TaskEvaluation,
): ProduceProductionMediaResult {
  return {
    taskListId: input.taskListId,
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    status: 'awaiting_prompt_assembly',
    promptAssembly,
    ...(attempt ? { attempt: withPromptAssemblyId(attempt) } : {}),
    ...(evaluation ? { evaluation } : {}),
    nextAction: 'assemble_prompt',
    message:
      'Prompt sources are persisted. Assemble every source into one final provider prompt, then call the same Task List tool with this assembly ID and output.',
  };
}

function withPromptAssemblyId(attempt: ProductionMediaTaskAttempt): ProductionMediaTaskAttempt {
  const promptAssemblyId = attempt.promptAssemblyId ?? attempt.generationSpec.promptAssemblyId;
  return promptAssemblyId && attempt.promptAssemblyId !== promptAssemblyId
    ? { ...attempt, promptAssemblyId }
    : attempt;
}

function resultFor(
  attempt: ProductionMediaTaskAttempt,
  evaluation: TaskEvaluation | undefined,
  status: ProduceProductionMediaResult['status'],
  message: string,
): ProduceProductionMediaResult {
  return {
    taskListId: attempt.taskListId,
    canvasId: attempt.canvasId,
    nodeId: attempt.nodeId,
    status,
    attempt: withPromptAssemblyId(attempt),
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
