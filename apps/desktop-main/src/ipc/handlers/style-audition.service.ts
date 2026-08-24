import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  CreateVisualAuditionsInput,
  CreateVisualAuditionsResult,
  TaskExecutionEngine,
} from '@lucid-fin/application';
import { VISUAL_PREVIEW_RUBRIC_VERSION } from '@lucid-fin/application';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type {
  PromptAssemblyRecord,
  Canvas,
  CanvasNode,
  GenerationRequest,
  ProductionMediaTaskAttempt,
  Task,
  TaskListId,
  VisualAuditionCandidate,
  VisualAuditionDocumentContent,
  VisualDirectionCandidateProposal,
  VisualPreviewAttempt,
  VisualPreviewGrade,
  PlanDocument,
  LLMAdapter,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
import type {
  VisualAnalysisResult,
  VisualAnalyzer,
} from '../../services/visual-analyzer.service.js';
import {
  hashPromptAssemblyInput,
  type PromptAssemblyService,
  validatePromptAssemblyOutput,
} from '../../services/prompt-assembly.service.js';
import type { MediaGenerationService } from '../../services/media-generation.service.js';
import { buildMediaGenerationSpec } from '../../services/media-generation-spec.js';
import { canonicalJson } from '../../services/media-evaluation.service.js';
import type { BuiltGenerationContext } from './generation-types.js';

type StylePromptBinding = {
  canvasId: string;
  nodeId: string;
  nodeUpdatedAt: number;
  mediaType: 'image';
  mode: 'text-to-image';
  purpose: PromptAssemblyRecord['purpose'];
  providerId: string;
  authority: Extract<
    PromptAssemblyRecord['input']['authority'],
    { kind: 'task-list-production-plan' }
  >;
  parentAssemblyId?: string;
  sourceAttemptId?: string;
  sourceAssetHash?: string;
};

export type StyleAuditionGradeImage = (input: {
  assetHash: string;
  candidate: VisualDirectionCandidateProposal;
  productionPlan: Record<string, unknown>;
}) => Promise<VisualPreviewGrade>;

interface StyleAuditionCoreDeps {
  taskExecutionEngine: TaskExecutionEngine;
  promptAssemblyService: PromptAssemblyService;
  adapterRegistry: AdapterRegistry;
  resolveProcessPrompt: (processKey: string) => string | null | undefined;
}

export interface StyleAuditionServiceDeps extends StyleAuditionCoreDeps {
  db: SqliteIndex;
  mediaGenerationService: Pick<MediaGenerationService, 'advance'>;
  commanderAuthor?: { providerId: string; model?: string };
  now?: () => number;
}

export interface StyleAuditionEvaluationDeps extends StyleAuditionCoreDeps {
  gradeImage: StyleAuditionGradeImage;
  now?: () => number;
}

export type StyleAuditionEvaluationOutcome = 'idle' | 'commander_required' | 'complete';

const DEFAULT_PREVIEW_WIDTH = 1024;
const DEFAULT_PREVIEW_HEIGHT = 576;

export function createStyleAuditionService(deps: StyleAuditionServiceDeps) {
  const now = deps.now ?? (() => Date.now());

  return async function createVisualAuditions(
    input: CreateVisualAuditionsInput,
  ): Promise<CreateVisualAuditionsResult> {
    if (input.action === 'prepare') {
      const current = deps.taskExecutionEngine.beginVisualAudition({
        canvasId: input.canvasId,
        taskListId: input.taskListId,
        providerId: input.providerId,
        width: input.width ?? DEFAULT_PREVIEW_WIDTH,
        height: input.height ?? DEFAULT_PREVIEW_HEIGHT,
        candidates: input.candidates,
      }).document;
      return prepareCurrentCandidate(deps, input.taskListId, input.canvasId, current);
    }
    if (input.action === 'status') {
      return resumeVisualAuditionState(deps, input.taskListId, input.canvasId, now);
    }
    return submitCurrentCandidate(deps, input, now);
  };
}

export function createStyleAuditionEvaluationContinuation(deps: StyleAuditionEvaluationDeps) {
  const now = deps.now ?? (() => Date.now());

  return async function evaluatePendingVisualAudition(
    taskListId: string,
    canvasId: string,
  ): Promise<StyleAuditionEvaluationOutcome> {
    const taskList = deps.taskExecutionEngine.get(taskListId);
    if (
      !taskList ||
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityId !== canvasId ||
      taskList.currentGate ||
      !taskList.currentTaskId
    ) {
      return 'idle';
    }
    const task = deps.taskExecutionEngine
      .getTasks(taskListId)
      .find(
        (candidate) =>
          candidate.id === taskList.currentTaskId && candidate.taskKey === 'style-audition',
      );
    if (!task) return 'idle';
    if (!deps.taskExecutionEngine.getLatestVisualAudition(taskListId)) return 'idle';

    let context = requireVisualContext(deps, taskListId, canvasId);
    let current = context.document;
    let state = clone(current.content as VisualAuditionDocumentContent);
    let candidate = state.candidates.find((entry) => entry.status === 'evaluation_pending');
    let attempt = candidate?.attempts.at(-1);
    if (!candidate || !attempt) return evaluationOutcomeForState(state);
    if (!attempt.assetHash) throw new Error('Evaluation-pending preview is missing its asset');

    if (!attempt.grade) {
      const candidateId = candidate.id;
      const attemptNumber = attempt.attempt;
      const promptAssemblyId = attempt.promptAssemblyId;
      const assetHash = attempt.assetHash;
      let grade: VisualPreviewGrade;
      try {
        grade = await deps.gradeImage({
          assetHash,
          candidate: proposal(candidate),
          productionPlan: context.productionPlan.content,
        });
      } catch (error) {
        const latest = deps.taskExecutionEngine.getLatestVisualAudition(taskListId);
        if (latest) {
          const failedState = clone(latest.content as VisualAuditionDocumentContent);
          const failedCandidate = failedState.candidates.find((entry) => entry.id === candidateId);
          const failedAttempt = failedCandidate?.attempts.find(
            (entry) => entry.attempt === attemptNumber,
          );
          if (
            failedCandidate?.status === 'evaluation_pending' &&
            failedAttempt?.status === 'evaluation_pending' &&
            failedAttempt.promptAssemblyId === promptAssemblyId &&
            failedAttempt.assetHash === assetHash &&
            !failedAttempt.grade
          ) {
            const failureMessage = `Vision evaluation pending: ${message(error)}`;
            failedAttempt.error = failureMessage;
            failedState.failure = {
              candidateId,
              message: failureMessage,
              ambiguous: false,
            };
            persistVisualState(deps, taskListId, latest, failedState);
          }
        }
        throw error;
      }

      context = requireVisualContext(deps, taskListId, canvasId);
      current = context.document;
      state = clone(current.content as VisualAuditionDocumentContent);
      candidate = state.candidates.find((entry) => entry.id === candidateId);
      attempt = candidate?.attempts.find((entry) => entry.attempt === attemptNumber);
      if (!candidate || !attempt) return evaluationOutcomeForState(state);
      if (candidate.status !== 'evaluation_pending' || attempt.status !== 'evaluation_pending') {
        return evaluationOutcomeForState(state);
      }
      if (attempt.promptAssemblyId !== promptAssemblyId || attempt.assetHash !== assetHash) {
        throw new Error('Visual evaluation target changed before its grade could be persisted');
      }
      if (!attempt.grade) attempt.grade = grade;
    }

    advanceGradedAttempt(state, candidate, attempt, now());
    current = persistVisualState(deps, taskListId, current, state);
    if (state.status === 'complete') return 'complete';
    const next = prepareCurrentCandidate(deps, taskListId, canvasId, current);
    return next.status === 'complete' ? 'complete' : 'commander_required';
  };
}

function requireVisualContext(
  deps: StyleAuditionCoreDeps,
  taskListId: string,
  canvasId: string,
): {
  document: PlanDocument;
  productionPlan: PlanDocument;
  task: Task;
  taskListId: TaskListId;
  taskListRowVersion: number;
  canvasId: string;
} {
  const taskList = deps.taskExecutionEngine.get(taskListId);
  if (
    !taskList ||
    taskList.taskListType !== 'movie.production.v2' ||
    taskList.entityId !== canvasId
  ) {
    throw new Error(`Style-audition Task List "${taskListId}" is not active for this canvas`);
  }
  if (taskList.currentGate) {
    throw new Error(`Task List is awaiting ${taskList.currentGate} approval`);
  }
  const task = deps.taskExecutionEngine
    .getTasks(taskListId)
    .find(
      (candidate) =>
        candidate.id === taskList.currentTaskId && candidate.taskKey === 'style-audition',
  );
  if (!task) throw new Error('Style auditions are not the current durable Task List task');
  if (taskList.rowVersion === undefined) {
    throw new Error('Style-audition Task List is missing its concurrency version');
  }
  const document = deps.taskExecutionEngine.getLatestVisualAudition(taskListId);
  if (!document) throw new Error('No durable visual audition has been prepared');
  return {
    document,
    productionPlan: deps.taskExecutionEngine.getApprovedProductionPlan(taskListId),
    task,
    taskListId: taskList.id as TaskListId,
    taskListRowVersion: taskList.rowVersion,
    canvasId,
  };
}

function prepareCurrentCandidate(
  deps: StyleAuditionCoreDeps,
  taskListId: string,
  canvasId: string,
  suppliedDocument?: PlanDocument,
): CreateVisualAuditionsResult {
  const context = requireVisualContext(deps, taskListId, canvasId);
  let current = suppliedDocument ?? context.document;
  const state = clone(current.content as VisualAuditionDocumentContent);
  if (state.status === 'complete') {
    throw new Error(
      `Visual auditions are already complete at revision ${current.revision}; use the host preview selector instead of generating them again`,
    );
  }
  assertReportedCostWithinApprovedBudget(state);
  if (state.status === 'ambiguous' || state.status === 'failed') {
    throw new Error(
      state.failure?.message ?? 'The prior style-audition attempt requires user review',
    );
  }
  const evaluating = state.candidates.find(
    (candidate) => candidate.status === 'evaluation_pending',
  );
  if (evaluating) {
    const attempt = evaluating.attempts.at(-1);
    if (!attempt?.assetHash) throw new Error('Evaluation-pending preview is missing its asset');
    return evaluationPendingResult(taskListId, current, evaluating, attempt);
  }
  const awaiting = state.candidates.find(
    (candidate) => candidate.status === 'awaiting_prompt_assembly',
  );
  if (awaiting?.pendingPromptAssemblyId) {
    const record = deps.promptAssemblyService.get(awaiting.pendingPromptAssemblyId);
    if (!record) throw new Error('Prepared style Prompt Assembly is missing');
    return awaitingAssemblyResult(taskListId, current, awaiting.id, record);
  }
  const candidate = state.candidates.find((entry) => entry.status === 'pending');
  if (!candidate) throw new Error('No bounded visual candidate is available to prepare');
  if (candidate.attempts.length >= state.budget.maxAttemptsPerCandidate) {
    throw new Error(`Visual candidate "${candidate.name}" exhausted its attempt bound`);
  }
  const record = prepareCandidateAssembly(
    deps,
    taskListId,
    canvasId,
    context.task.id,
    current,
    context.productionPlan,
    state,
    candidate,
  );
  candidate.pendingPromptAssemblyId = record.id;
  candidate.status = 'awaiting_prompt_assembly';
  state.status = 'awaiting_prompt_assembly';
  delete state.failure;
  current = persistVisualState(deps, taskListId, current, state);
  return awaitingAssemblyResult(taskListId, current, candidate.id, record);
}

async function submitCurrentCandidate(
  deps: StyleAuditionServiceDeps,
  input: Extract<CreateVisualAuditionsInput, { action: 'submit' }>,
  now: () => number,
): Promise<CreateVisualAuditionsResult> {
  const context = requireVisualContext(deps, input.taskListId, input.canvasId);
  let current = context.document;
  const state = clone(current.content as VisualAuditionDocumentContent);
  assertReportedCostWithinApprovedBudget(state);
  if (
    state.productionPlan.revision !== context.productionPlan.revision ||
    state.productionPlan.contentHash !== context.productionPlan.contentHash
  ) {
    throw new Error('Visual audition is not bound to the current approved Production Plan');
  }
  const candidate = state.candidates.find(
    (entry) =>
      entry.pendingPromptAssemblyId === input.promptAssemblyId ||
      entry.attempts.some((attempt) => attempt.promptAssemblyId === input.promptAssemblyId),
  );
  if (!candidate) throw new Error('Prompt Assembly is not bound to the current visual audition');
  const existingPreview = candidate.attempts.find(
    (attempt) => attempt.promptAssemblyId === input.promptAssemblyId,
  );
  if (existingPreview?.status === 'completed') {
    throw new Error('This visual Prompt Assembly already completed its durable provider attempt');
  }
  let promptAssembly = deps.promptAssemblyService.get(input.promptAssemblyId);
  if (!promptAssembly) throw new Error(`Prompt Assembly not found: ${input.promptAssemblyId}`);
  const persistedAttempt = existingPreview
    ? requirePersistedStyleAttempt(deps, context, candidate, existingPreview)
    : undefined;
  const previousPreview = persistedAttempt
    ? candidate.attempts.find((attempt) => attempt.attempt === persistedAttempt.attempt - 1)
    : candidate.attempts.at(-1);
  const promptBinding = stylePromptBinding(
    input.canvasId,
    input.taskListId,
    context.task.id,
    persistedAttempt?.generationSpec.nodeUpdatedAt ?? current.revision,
    context.productionPlan,
    candidate.id,
    previousPreview,
    state.providerId,
  );
  assertStylePromptAssemblyBinding(promptAssembly, promptBinding);
  if (promptAssembly.status === 'prepared') {
    if (!deps.commanderAuthor) {
      throw new Error('The active Commander identity is required to submit Prompt Assembly output');
    }
    promptAssembly = deps.promptAssemblyService.submitCommanderOutput(
      promptAssembly.id,
      input.promptAssemblyOutput,
      deps.commanderAuthor,
    );
  } else if (promptAssembly.status !== 'assembled' && promptAssembly.status !== 'submitted') {
    throw new Error(`Prompt Assembly ${promptAssembly.id} is already ${promptAssembly.status}`);
  }
  const promptAssemblyOutput = promptAssembly.output;
  if (!promptAssemblyOutput) throw new Error('Assembled visual prompt has no output');
  validatePromptAssemblyOutput(promptAssembly.input, promptAssemblyOutput);
  const assembledPromptAssembly = { ...promptAssembly, output: promptAssemblyOutput };
  const attemptNumber = existingPreview?.attempt ?? candidate.attempts.length + 1;
  if (!existingPreview) {
    assertStyleAttemptBudget(state, candidate, attemptNumber);
  }
  const reserved =
    persistedAttempt ??
    reserveStyleMediaAttempt(
      deps,
      context,
      state,
      candidate,
      assembledPromptAssembly,
      attemptNumber,
    );
  let preview = existingPreview;
  if (!preview) {
    const reservationMessage = 'Provider submission reserved; outcome is not yet known';
    preview = {
      attempt: attemptNumber,
      status: 'ambiguous',
      promptAssemblyId: promptAssembly.id,
      prompt: reserved.prompt,
      promptHash: reserved.promptHash,
      ...(reserved.negativePrompt !== undefined
        ? { negativePrompt: reserved.negativePrompt }
        : {}),
      providerId: reserved.providerId,
      ...(reserved.model ? { model: reserved.model } : {}),
      requestedSeed: reserved.seed ?? candidate.seed,
      width: state.width,
      height: state.height,
      estimatedCostUsd: reserved.estimatedCostUsd,
      error: reservationMessage,
      startedAt: reserved.createdAt,
      completedAt: reserved.createdAt,
    };
    candidate.attempts.push(preview);
    delete candidate.pendingPromptAssemblyId;
    candidate.status = 'ambiguous';
    state.status = 'ambiguous';
    state.failure = {
      candidateId: candidate.id,
      message: reservationMessage,
      ambiguous: true,
    };
    current = persistVisualState(deps, input.taskListId, current, state);
  } else {
    assertPreviewMatchesMediaAttempt(preview, reserved, candidate);
  }

  let advanced: ProductionMediaTaskAttempt;
  try {
    advanced = await deps.mediaGenerationService.advance(reserved.id);
  } catch (error) {
    const latest = deps.db.repos.taskLists.getProductionMediaAttempt(reserved.id) ?? reserved;
    if (latest.status === 'asset_ready') {
      return applyMediaAttemptResult(
        deps,
        input.taskListId,
        current,
        state,
        candidate,
        preview,
        latest,
        now,
      );
    }
    failVisualAttempt(
      deps,
      input.taskListId,
      current,
      state,
      candidate,
      preview,
      latest,
      message(error),
      latest.status === 'submitting' || latest.status === 'ambiguous',
      now,
    );
  }
  if (existingPreview && advanced.status === 'ambiguous') {
    throw new Error(
      'Style-audition generation has a durable provider reservation with an unknown outcome; automatic resubmission is disabled',
    );
  }
  return applyMediaAttemptResult(
    deps,
    input.taskListId,
    current,
    state,
    candidate,
    preview,
    advanced,
    now,
  );
}

function assertStyleAttemptBudget(
  state: VisualAuditionDocumentContent,
  candidate: VisualAuditionCandidate,
  attemptNumber: number,
): void {
  if (attemptNumber > state.budget.maxAttemptsPerCandidate) {
    throw new Error(`Visual candidate "${candidate.name}" exhausted its attempt bound`);
  }
  const regenerationsUsed = state.candidates.reduce(
    (total, entry) => total + Math.max(0, entry.attempts.length - 1),
    0,
  );
  if (attemptNumber > 1 && regenerationsUsed >= state.budget.maxRegenerations) {
    throw new Error('Visual audition exhausted its approved regeneration bound');
  }
}

function reserveStyleMediaAttempt(
  deps: StyleAuditionServiceDeps,
  context: ReturnType<typeof requireVisualContext>,
  state: VisualAuditionDocumentContent,
  candidate: VisualAuditionCandidate,
  promptAssembly: PromptAssemblyRecord & { output: NonNullable<PromptAssemblyRecord['output']> },
  attemptNumber: number,
): ProductionMediaTaskAttempt {
  const nodeId = `style-audition:${candidate.id}`;
  const request: GenerationRequest = {
    type: 'image',
    providerId: state.providerId,
    prompt: promptAssembly.output.finalPrompt,
    ...(promptAssembly.output.negativePrompt !== undefined
      ? { negativePrompt: promptAssembly.output.negativePrompt }
      : {}),
    width: state.width,
    height: state.height,
    seed: candidate.seed,
  };
  const adapter =
    deps.adapterRegistry.resolve?.(state.providerId, 'image') ??
    deps.adapterRegistry.get(state.providerId);
  if (!adapter || adapter.type !== 'image' || adapter.id !== state.providerId) {
    throw new Error(`Configured image provider not found: ${state.providerId}`);
  }
  const estimate = adapter.estimateCost(request).estimatedCost;
  if (!Number.isFinite(estimate) || estimate < 0) {
    throw new Error('Provider returned an invalid style-audition cost estimate');
  }
  const budgetConsumed = Math.max(
    state.budget.estimatedCommittedUsd,
    state.budget.reportedActualUsd ?? 0,
  );
  const remainingBudget = Math.max(0, state.budget.approvedStyleAuditionCostUsd - budgetConsumed);
  if (estimate > remainingBudget + 1e-9) {
    throw new Error(
      `Image generation estimate $${estimate.toFixed(4)} exceeds the remaining approved audition budget $${remainingBudget.toFixed(4)}`,
    );
  }
  const node: CanvasNode = {
    id: nodeId,
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      status: 'empty',
      prompt: request.prompt,
      ...(request.negativePrompt !== undefined
        ? { negativePrompt: request.negativePrompt }
        : {}),
      width: state.width,
      height: state.height,
      seed: candidate.seed,
      variants: [],
      selectedVariantIndex: 0,
      providerId: state.providerId,
    },
    title: `Style audition: ${candidate.name}`,
    bypassed: false,
    locked: true,
    createdAt: promptAssembly.createdAt,
    updatedAt: promptAssembly.nodeUpdatedAt,
  };
  const canvas: Canvas = {
    id: context.canvasId,
    name: 'Style audition',
    nodes: [node],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: promptAssembly.createdAt,
    updatedAt: promptAssembly.nodeUpdatedAt,
  };
  const generationContext: BuiltGenerationContext = {
    canvas,
    node,
    requestBase: request,
    adapter,
    nodeType: 'image',
    generationType: 'image',
    mode: 'text-to-image',
    variantCount: 1,
    baseSeed: candidate.seed,
    compiled: {
      prompt: request.prompt,
      ...(request.negativePrompt !== undefined
        ? { negativePrompt: request.negativePrompt }
        : {}),
      diagnostics: [],
      segments: [],
      wordCount: request.prompt.trim() ? request.prompt.trim().split(/\s+/).length : 0,
    },
    promptAssemblyId: promptAssembly.id,
    resolvedEntityRefs: {},
  };
  const previousPreview = candidate.attempts.find(
    (attempt) => attempt.attempt === attemptNumber - 1,
  );
  const parentAttempt =
    attemptNumber > 1
      ? deps.db.repos.taskLists
          .listProductionMediaAttempts(context.taskListId)
          .find(
            (attempt) =>
              attempt.nodeId === nodeId &&
              attempt.attempt === attemptNumber - 1 &&
              attempt.promptAssemblyId === previousPreview?.promptAssemblyId,
          )
      : undefined;
  if (attemptNumber > 1 && !parentAttempt) {
    throw new Error('Style-audition repair is missing its exact provider-attempt lineage');
  }
  const generationSpec = buildMediaGenerationSpec({
    scope: 'style_audition',
    authority: {
      kind: 'task-list-production-plan',
      planId: context.productionPlan.id,
      planHash: context.productionPlan.contentHash,
      candidateId: candidate.id,
    },
    taskListId: context.task.taskListId,
    task: context.task,
    canvas,
    node,
    context: generationContext,
    request,
    promptAssembly,
    limits: {
      maxAttemptsPerShot: state.budget.maxAttemptsPerCandidate,
      maxRegenerations: state.budget.maxRegenerations,
      maxTotalCostUsd: state.budget.approvedStyleAuditionCostUsd,
      styleAuditionCommittedCostUsd: 0,
    },
    lineage: {
      purpose: promptAssembly.purpose,
      ...(parentAttempt ? { parentAttemptId: parentAttempt.id } : {}),
      ...(previousPreview ? { basePromptHash: previousPreview.promptHash } : {}),
      variantIndex: 0,
      variantCount: 1,
    },
    createdAt: promptAssembly.createdAt,
  });
  const specHash = sha256(canonicalJson({ ...generationSpec, createdAt: undefined }));
  const identity = {
    taskListId: context.task.taskListId,
    taskId: context.task.id,
    nodeId,
    attempt: attemptNumber,
    specHash,
  };
  const proposed: ProductionMediaTaskAttempt = {
    kind: 'production_media',
    id: `style-audition:${sha256(canonicalJson(identity))}`,
    ...identity,
    canvasId: canvas.id,
    idempotencyKey: sha256(canonicalJson(identity)),
    generationSpec,
    scope: 'style_audition',
    mediaType: 'image',
    status: 'reserved',
    rowVersion: 0,
    providerId: state.providerId,
    promptAssemblyId: promptAssembly.id,
    ...(parentAttempt ? { parentAttemptId: parentAttempt.id } : {}),
    submissionPurpose: promptAssembly.purpose,
    model: generationSpec.modelId,
    prompt: request.prompt,
    promptHash: generationSpec.promptHash,
    ...(request.negativePrompt !== undefined
      ? { negativePrompt: request.negativePrompt }
      : {}),
    seed: candidate.seed,
    estimatedCostUsd: estimate,
    createdAt: promptAssembly.createdAt,
    updatedAt: promptAssembly.createdAt,
  };
  return deps.db.repos.taskLists.reserveProductionMediaAttempt({
    attempt: proposed,
    expectedTaskListRowVersion: context.taskListRowVersion,
  }).attempt;
}

function assertPreviewMatchesMediaAttempt(
  preview: VisualPreviewAttempt,
  attempt: ProductionMediaTaskAttempt,
  candidate: VisualAuditionCandidate,
): void {
  if (
    preview.attempt !== attempt.attempt ||
    preview.promptAssemblyId !== attempt.promptAssemblyId ||
    preview.prompt !== attempt.prompt ||
    preview.promptHash !== attempt.promptHash ||
    preview.negativePrompt !== attempt.negativePrompt ||
    preview.providerId !== attempt.providerId ||
    preview.requestedSeed !== (attempt.seed ?? candidate.seed) ||
    preview.width !== attempt.generationSpec.request.width ||
    preview.height !== attempt.generationSpec.request.height
  ) {
    throw new Error('Visual preview does not match its deterministic provider attempt');
  }
}

function requirePersistedStyleAttempt(
  deps: StyleAuditionServiceDeps,
  context: ReturnType<typeof requireVisualContext>,
  candidate: VisualAuditionCandidate,
  preview: VisualPreviewAttempt,
): ProductionMediaTaskAttempt {
  const nodeId = `style-audition:${candidate.id}`;
  const matches = deps.db.repos.taskLists
    .listProductionMediaAttempts(context.taskListId)
    .filter(
      (attempt) =>
        attempt.scope === 'style_audition' &&
        attempt.taskId === context.task.id &&
        attempt.canvasId === context.canvasId &&
        attempt.nodeId === nodeId &&
        attempt.attempt === preview.attempt &&
        attempt.promptAssemblyId === preview.promptAssemblyId,
    );
  if (matches.length !== 1) {
    throw new Error('Visual preview is missing its unique durable provider attempt');
  }
  const attempt = matches[0]!;
  const expectedAuthority = {
    kind: 'task-list-production-plan' as const,
    planId: context.productionPlan.id,
    planHash: context.productionPlan.contentHash,
    candidateId: candidate.id,
  };
  if (
    attempt.mediaType !== 'image' ||
    attempt.generationSpec.scope !== 'style_audition' ||
    attempt.generationSpec.taskListId !== context.task.taskListId ||
    attempt.generationSpec.taskId !== context.task.id ||
    attempt.generationSpec.canvasId !== context.canvasId ||
    attempt.generationSpec.nodeId !== nodeId ||
    attempt.generationSpec.mediaType !== 'image' ||
    attempt.generationSpec.operation !== 'text-to-image' ||
    attempt.generationSpec.promptAssemblyId !== attempt.promptAssemblyId ||
    !isDeepStrictEqual(attempt.generationSpec.authority, expectedAuthority)
  ) {
    throw new Error('Durable style provider attempt is bound to different immutable inputs');
  }
  assertPreviewMatchesMediaAttempt(preview, attempt, candidate);
  return attempt;
}

function applyMediaAttemptResult(
  deps: StyleAuditionServiceDeps,
  taskListId: string,
  current: PlanDocument,
  state: VisualAuditionDocumentContent,
  candidate: VisualAuditionCandidate,
  preview: VisualPreviewAttempt,
  attempt: ProductionMediaTaskAttempt,
  now: () => number,
): CreateVisualAuditionsResult {
  preview.providerId = attempt.providerId;
  preview.model = attempt.model;
  preview.requestedSeed = attempt.seed ?? candidate.seed;
  preview.estimatedCostUsd = attempt.estimatedCostUsd;
  if (attempt.reportedActualCostUsd !== undefined) {
    preview.reportedActualCostUsd = attempt.reportedActualCostUsd;
  }
  preview.completedAt = attempt.completedAt ?? attempt.assetReadyAt ?? now();
  if (attempt.status !== 'asset_ready' || !attempt.assetHash) {
    const reason =
      attempt.status === 'awaiting_provider'
        ? 'Style auditions cannot represent an asynchronous provider wait; the durable provider attempt remains awaiting_provider'
        : attempt.error ??
          (attempt.status === 'cancelled'
            ? 'Style-audition provider attempt was cancelled'
            : `Style-audition provider attempt ended in unsupported state ${attempt.status}`);
    failVisualAttempt(
      deps,
      taskListId,
      current,
      state,
      candidate,
      preview,
      attempt,
      reason,
      attempt.status === 'ambiguous' || attempt.status === 'submitting',
      now,
    );
  }
  const alreadyPending =
    preview.status === 'evaluation_pending' && preview.assetHash === attempt.assetHash;
  preview.assetHash = attempt.assetHash;
  const reportedTotal = reportedActualTotal(state);
  if (reportedTotal > state.budget.approvedStyleAuditionCostUsd + 1e-9) {
    const budgetError = `Provider-reported style audition cost $${reportedTotal.toFixed(4)} exceeds the approved budget $${state.budget.approvedStyleAuditionCostUsd.toFixed(4)}`;
    failVisualAttempt(
      deps,
      taskListId,
      current,
      state,
      candidate,
      preview,
      attempt,
      budgetError,
      false,
      now,
    );
  }
  if (alreadyPending) return evaluationPendingResult(taskListId, current, candidate, preview);
  const gradingPendingMessage =
    'Vision evaluation is durably pending outside the active Commander tool call';
  preview.status = 'evaluation_pending';
  preview.error = gradingPendingMessage;
  candidate.status = 'evaluation_pending';
  state.status = 'evaluation_pending';
  state.failure = {
    candidateId: candidate.id,
    message: gradingPendingMessage,
    ambiguous: false,
  };
  const persisted = persistVisualState(deps, taskListId, current, state);
  return evaluationPendingResult(taskListId, persisted, candidate, preview);
}

function failVisualAttempt(
  deps: StyleAuditionServiceDeps,
  taskListId: string,
  current: PlanDocument,
  state: VisualAuditionDocumentContent,
  candidate: VisualAuditionCandidate,
  preview: VisualPreviewAttempt,
  attempt: ProductionMediaTaskAttempt,
  reason: string,
  ambiguous: boolean,
  now: () => number,
): never {
  const status = ambiguous ? 'ambiguous' : 'failed';
  const unchanged =
    preview.status === status &&
    preview.error === reason &&
    candidate.status === status &&
    state.status === status;
  if (!unchanged) {
    preview.status = status;
    preview.error = reason;
    preview.completedAt = attempt.completedAt ?? now();
    candidate.status = status;
    state.status = status;
    state.failure = { candidateId: candidate.id, message: reason, ambiguous };
    persistVisualState(deps, taskListId, current, state);
  }
  throw new Error(reason);
}

function resumeVisualAuditionState(
  deps: StyleAuditionCoreDeps,
  taskListId: string,
  canvasId: string,
  now: () => number,
): CreateVisualAuditionsResult {
  const context = requireVisualContext(deps, taskListId, canvasId);
  let current = context.document;
  const state = clone(current.content as VisualAuditionDocumentContent);
  if (state.status === 'complete') return toToolResult(taskListId, current);
  const candidate = state.candidates.find((entry) => entry.status === 'evaluation_pending');
  const attempt = candidate?.attempts.at(-1);
  if (candidate && attempt?.assetHash && !attempt.grade) {
    return evaluationPendingResult(taskListId, current, candidate, attempt);
  }
  if (candidate && attempt?.grade) {
    advanceGradedAttempt(state, candidate, attempt, now());
    current = persistVisualState(deps, taskListId, current, state);
  }
  if (state.candidates.every((entry) => entry.status === 'completed')) {
    return toToolResult(taskListId, current);
  }
  return prepareCurrentCandidate(deps, taskListId, canvasId, current);
}

function advanceGradedAttempt(
  state: VisualAuditionDocumentContent,
  candidate: VisualAuditionCandidate,
  attempt: VisualPreviewAttempt,
  completedAt: number,
): void {
  if (!attempt.grade) throw new Error('Visual grade was not persisted');
  attempt.status = 'completed';
  attempt.completedAt = completedAt;
  delete attempt.error;
  const regenerationsUsed = state.candidates.reduce(
    (total, entry) => total + Math.max(0, entry.attempts.length - 1),
    0,
  );
  const canRepair =
    attempt.grade.verdict === 'repair' &&
    Boolean(attempt.grade.repairPrompt) &&
    candidate.attempts.length < state.budget.maxAttemptsPerCandidate &&
    regenerationsUsed < state.budget.maxRegenerations;
  if (canRepair) {
    candidate.status = 'pending';
  } else {
    candidate.status = 'completed';
    candidate.selectedAttempt = attempt.attempt;
  }
  delete state.failure;
  if (state.candidates.every((entry) => entry.status === 'completed')) {
    state.status = 'complete';
    state.recommendedCandidateId = recommend(state.candidates).id;
  } else {
    state.status = 'in_progress';
  }
}

function evaluationOutcomeForState(
  state: VisualAuditionDocumentContent,
): StyleAuditionEvaluationOutcome {
  if (state.status === 'complete') return 'complete';
  if (
    state.status === 'awaiting_prompt_assembly' ||
    state.candidates.some(
      (candidate) =>
        candidate.status === 'awaiting_prompt_assembly' || candidate.status === 'pending',
    )
  ) {
    return 'commander_required';
  }
  return 'idle';
}

function prepareCandidateAssembly(
  deps: StyleAuditionCoreDeps,
  taskListId: string,
  canvasId: string,
  taskId: string,
  document: PlanDocument,
  productionPlan: PlanDocument,
  state: VisualAuditionDocumentContent,
  candidate: VisualAuditionCandidate,
): PromptAssemblyRecord {
  const guide = deps.resolveProcessPrompt('task-list-orchestration')?.trim();
  if (!guide) throw new Error('Effective task-list-orchestration guide is unavailable');
  const adapter =
    deps.adapterRegistry.resolve?.(state.providerId, 'image') ??
    deps.adapterRegistry.get(state.providerId);
  if (!adapter || adapter.type !== 'image') {
    throw new Error(`Configured image provider not found: ${state.providerId}`);
  }
  const previous = candidate.attempts.at(-1);
  const parent = previous ? deps.promptAssemblyService.get(previous.promptAssemblyId) : undefined;
  if (previous && (!previous.grade || !previous.assetHash || !parent?.output)) {
    throw new Error('Repair preparation requires exact parent prompt, asset, and grade evidence');
  }
  const sources = [
    {
      sourceId: 'approved-production-plan',
      kind: 'production-plan' as const,
      label: `Approved Production Plan revision ${productionPlan.revision}`,
      content: JSON.stringify(productionPlan.content, null, 2),
      required: true,
      metadata: { revision: productionPlan.revision, contentHash: productionPlan.contentHash },
    },
    {
      sourceId: 'candidate-summary',
      kind: 'user-intent' as const,
      label: `Candidate direction: ${candidate.name}`,
      content: candidate.summary,
      required: true,
    },
    {
      sourceId: 'candidate-preview-prompt',
      kind: 'node-prompt' as const,
      label: 'Candidate preview scene prompt',
      content: candidate.prompt,
      required: true,
    },
    {
      sourceId: 'candidate-visual-constitution',
      kind: 'canvas-style' as const,
      label: 'Candidate Visual Constitution',
      content: JSON.stringify(candidate.constitution, null, 2),
      required: true,
    },
    {
      sourceId: 'candidate-negative-constraints',
      kind: 'negative-constraint' as const,
      label: 'Candidate negative constraints',
      content: JSON.stringify({
        prompt: candidate.negativePrompt ?? '',
        constitution: candidate.constitution.negativeConstraints,
      }),
      required: true,
    },
    {
      sourceId: 'task-list-guide',
      kind: 'task-list-guide' as const,
      label: 'Effective persistent Task List guidance',
      content: guide,
      required: true,
      metadata: {
        instruction:
          'Use creative guidance only; never copy host task-execution mechanics into provider prose.',
      },
    },
    ...(previous?.grade && parent?.output
      ? [
          {
            sourceId: 'parent-final-prompt',
            kind: 'parent-prompt' as const,
            label: 'Exact provider prompt from the prior preview attempt',
            content: parent.output.finalPrompt,
            required: true,
            metadata: {
              assemblyId: parent.id,
              promptHash: previous.promptHash,
              assetHash: previous.assetHash,
              attempt: previous.attempt,
            },
          },
          {
            sourceId: 'vision-repair-delta',
            kind: 'repair-delta' as const,
            label: 'Persisted visual grade, evidence, and repair delta',
            content: JSON.stringify(
              {
                grade: previous.grade,
                repairDelta: previous.grade.repairPrompt,
              },
              null,
              2,
            ),
            required: true,
          },
        ]
      : []),
  ];
  const request = {
    type: 'image' as const,
    providerId: state.providerId,
    prompt: '',
    width: state.width,
    height: state.height,
    seed: candidate.seed,
  };
  const promptLimits = adapter.getPromptLimits?.(request);
  return deps.promptAssemblyService.prepare({
    canvasId,
    nodeId: `style-audition:${candidate.id}`,
    nodeUpdatedAt: document.revision + 1,
    mediaType: 'image',
    mode: 'text-to-image',
    purpose: previous ? 'evaluation_repair' : 'initial',
    authority: {
      kind: 'task-list-production-plan',
      taskListId,
      taskId,
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
        content: productionPlan.content,
      },
    },
    sources,
    conditioningManifest: previous?.assetHash
      ? [{ assetHash: previous.assetHash, roles: [{ role: 'generic_reference' }] }]
      : [],
    providerProfile: {
      providerId: adapter.id,
      model: adapter.name,
      capabilities: adapter.capabilities.map(String),
      ...(promptLimits ? { promptLimits: { ...promptLimits } } : {}),
    },
    hostConstraints: {
      resolution: { width: state.width, height: state.height },
      seed: candidate.seed,
      budget: {
        approvedStyleAuditionCostUsd: state.budget.approvedStyleAuditionCostUsd,
        committedUsd: Math.max(
          state.budget.estimatedCommittedUsd,
          state.budget.reportedActualUsd ?? 0,
        ),
      },
      retry: {
        maxAttemptsPerCandidate: state.budget.maxAttemptsPerCandidate,
        maxRegenerations: state.budget.maxRegenerations,
        attemptsUsed: candidate.attempts.length,
      },
      immutable: [
        'providerId',
        'candidate seed',
        'preview resolution',
        'approved Production Plan revision and hash',
        'budget and retry bounds',
      ],
    },
    ...(parent ? { parentAssemblyId: parent.id } : {}),
    ...(previous ? { sourceAttemptId: `${candidate.id}:${previous.attempt}` } : {}),
    ...(previous?.assetHash ? { sourceAssetHash: previous.assetHash } : {}),
  });
}

function stylePromptBinding(
  canvasId: string,
  taskListId: string,
  taskId: string,
  nodeUpdatedAt: number,
  productionPlan: PlanDocument,
  candidateId: string,
  previous: VisualPreviewAttempt | undefined,
  providerId: string,
): StylePromptBinding {
  return {
    canvasId,
    nodeId: `style-audition:${candidateId}`,
    nodeUpdatedAt,
    mediaType: 'image',
    mode: 'text-to-image',
    purpose: previous ? 'evaluation_repair' : 'initial',
    providerId,
    authority: {
      kind: 'task-list-production-plan',
      taskListId,
      taskId,
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
        content: productionPlan.content,
      },
    },
    ...(previous ? { parentAssemblyId: previous.promptAssemblyId } : {}),
    ...(previous ? { sourceAttemptId: `${candidateId}:${previous.attempt}` } : {}),
    ...(previous?.assetHash ? { sourceAssetHash: previous.assetHash } : {}),
  };
}

function assertStylePromptAssemblyBinding(
  record: PromptAssemblyRecord,
  expected: StylePromptBinding,
): void {
  const { inputHash, ...hashableInput } = record.input;
  if (
    record.inputHash !== inputHash ||
    hashPromptAssemblyInput(hashableInput) !== inputHash ||
    record.canvasId !== expected.canvasId ||
    record.input.canvasId !== expected.canvasId ||
    record.nodeId !== expected.nodeId ||
    record.input.nodeId !== expected.nodeId ||
    record.nodeUpdatedAt !== expected.nodeUpdatedAt ||
    record.input.nodeUpdatedAt !== expected.nodeUpdatedAt ||
    record.mediaType !== expected.mediaType ||
    record.input.mediaType !== expected.mediaType ||
    record.mode !== expected.mode ||
    record.input.mode !== expected.mode ||
    record.purpose !== expected.purpose ||
    record.input.purpose !== expected.purpose ||
    record.input.providerProfile.providerId !== expected.providerId ||
    !isDeepStrictEqual(record.input.authority, expected.authority) ||
    record.taskListId !== expected.authority.taskListId ||
    record.taskId !== expected.authority.taskId ||
    record.parentAssemblyId !== expected.parentAssemblyId ||
    record.sourceAttemptId !== expected.sourceAttemptId ||
    record.sourceAssetHash !== expected.sourceAssetHash
  ) {
    throw new Error('Style Prompt Assembly binding is stale or belongs to another task');
  }
}

function persistVisualState(
  deps: StyleAuditionCoreDeps,
  taskListId: string,
  current: PlanDocument,
  state: VisualAuditionDocumentContent,
): PlanDocument {
  recomputeBudget(state);
  return deps.taskExecutionEngine.saveVisualAuditionSnapshot({
    taskListId,
    expectedRevision: current.revision,
    content: state,
  });
}

function awaitingAssemblyResult(
  taskListId: string,
  document: PlanDocument,
  candidateId: string,
  promptAssembly: PromptAssemblyRecord,
): CreateVisualAuditionsResult {
  return {
    taskListId,
    status: 'awaiting_prompt_assembly',
    revision: document.revision,
    contentHash: document.contentHash,
    candidateId,
    promptAssembly,
    nextAction: 'assemble_prompt',
  };
}

function evaluationPendingResult(
  taskListId: string,
  document: PlanDocument,
  candidate: VisualAuditionCandidate,
  attempt: VisualPreviewAttempt,
): CreateVisualAuditionsResult {
  if (!attempt.assetHash) throw new Error('Evaluation-pending attempt has no durable asset');
  return {
    taskListId,
    status: 'evaluation_pending',
    revision: document.revision,
    contentHash: document.contentHash,
    candidateId: candidate.id,
    promptAssemblyId: attempt.promptAssemblyId,
    assetHash: attempt.assetHash,
    message: attempt.error ?? 'Vision evaluation is pending.',
    nextAction: 'retry_evaluation',
  };
}

export function createVisualPreviewGrader(deps: {
  visualAnalyzer: VisualAnalyzer;
  preferredLLMAdapter?: LLMAdapter;
}): StyleAuditionGradeImage {
  return async ({ assetHash, candidate, productionPlan }) => {
    const systemPrompt = `You are the evidence-producing visual evaluator in an AI filmmaking process.
Evaluate the attached style preview against the approved story and the candidate's stated Visual Constitution.
Return exactly one JSON object and no markdown. Scores are integers from 0 to 100.
Schema: {"promptAdherence":number,"styleClarity":number,"storyFit":number,"lighting":number,"composition":number,"continuityPotential":number,"strengths":string[],"risks":string[],"repairPrompt":string,"evidence":string}.
Evidence must cite visible details. Never claim a detail that is not visible.`;
    const userPrompt = JSON.stringify({
      approvedStory: {
        title: productionPlan.title,
        logline: productionPlan.logline,
        synopsis: productionPlan.synopsis,
        genre: productionPlan.genre,
        tone: productionPlan.tone,
      },
      candidate,
    });
    const analyzed = await deps.visualAnalyzer.analyzeImageAsset(assetHash, {
      systemPrompt,
      userPrompt,
      preferredLLMAdapter: deps.preferredLLMAdapter,
    });
    return parseGrade(analyzed);
  };
}

function parseGrade(result: VisualAnalysisResult): VisualPreviewGrade {
  const start = result.text.indexOf('{');
  const end = result.text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Vision grader did not return a JSON object');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(result.text.slice(start, end + 1)) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Vision grader returned invalid JSON: ${message(error)}`, { cause: error });
  }
  const keys = [
    'promptAdherence',
    'styleClarity',
    'storyFit',
    'lighting',
    'composition',
    'continuityPotential',
  ] as const;
  const scores = Object.fromEntries(
    keys.map((key) => {
      const value = raw[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`Vision grader score ${key} must be between 0 and 100`);
      }
      return [key, Math.round(value)];
    }),
  ) as Record<(typeof keys)[number], number>;
  const strengths = stringArray(raw.strengths, 'strengths');
  const risks = stringArray(raw.risks, 'risks');
  const evidence = nonEmpty(raw.evidence, 'evidence');
  const repairPrompt = typeof raw.repairPrompt === 'string' ? raw.repairPrompt.trim() : '';
  const total = Math.round(keys.reduce((sum, key) => sum + scores[key], 0) / keys.length);
  const verdict = total >= 75 ? 'pass' : total >= 50 && repairPrompt ? 'repair' : 'human_review';
  return {
    rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
    ...scores,
    total,
    verdict,
    strengths,
    risks,
    ...(repairPrompt ? { repairPrompt } : {}),
    evidence,
    visionProviderId: result.providerId,
    ...(result.model ? { visionModel: result.model } : {}),
  };
}

function recomputeBudget(state: VisualAuditionDocumentContent): void {
  const attempts = state.candidates.flatMap((candidate) => candidate.attempts);
  state.budget.estimatedCommittedUsd = sum(attempts.map((attempt) => attempt.estimatedCostUsd));
  const reported = attempts.flatMap((attempt) =>
    attempt.reportedActualCostUsd === undefined ? [] : [attempt.reportedActualCostUsd],
  );
  state.budget.reportedActualUsd = sum(reported);
  state.budget.hasUnreportedActualCosts = reported.length !== attempts.length;
}

function reportedActualTotal(state: VisualAuditionDocumentContent): number {
  return sum(
    state.candidates.flatMap((candidate) =>
      candidate.attempts.flatMap((attempt) =>
        attempt.reportedActualCostUsd === undefined ? [] : [attempt.reportedActualCostUsd],
      ),
    ),
  );
}

function assertReportedCostWithinApprovedBudget(state: VisualAuditionDocumentContent): void {
  const reported = state.budget.reportedActualUsd ?? reportedActualTotal(state);
  if (reported > state.budget.approvedStyleAuditionCostUsd + 1e-9) {
    throw new Error(
      `Provider-reported style audition cost $${reported.toFixed(4)} exceeds the approved budget $${state.budget.approvedStyleAuditionCostUsd.toFixed(4)}; no further provider work is allowed`,
    );
  }
}

function recommend(candidates: VisualAuditionCandidate[]): VisualAuditionCandidate {
  const ranked = [...candidates].sort((left, right) => score(right) - score(left));
  const winner = ranked[0];
  if (!winner) throw new Error('No completed visual candidate is available to recommend');
  return winner;
}

function score(candidate: VisualAuditionCandidate): number {
  return (
    candidate.attempts.find((attempt) => attempt.attempt === candidate.selectedAttempt)?.grade
      ?.total ?? -1
  );
}

function toToolResult(taskListId: string, document: PlanDocument): CreateVisualAuditionsResult {
  const content = document.content as VisualAuditionDocumentContent;
  if (content.status !== 'complete' || !content.recommendedCandidateId) {
    throw new Error('Visual auditions were not completed');
  }
  return {
    taskListId,
    status: 'complete',
    revision: document.revision,
    contentHash: document.contentHash,
    recommendedCandidateId: content.recommendedCandidateId,
    candidates: content.candidates.map((candidate) => {
      const attempt = candidate.attempts.find(
        (entry) => entry.attempt === candidate.selectedAttempt && entry.status === 'completed',
      );
      if (!attempt?.assetHash || !attempt.grade) {
        throw new Error(`Visual candidate "${candidate.id}" is incomplete`);
      }
      return {
        id: candidate.id,
        name: candidate.name,
        assetHash: attempt.assetHash,
        score: attempt.grade.total,
        providerId: attempt.providerId,
        ...(attempt.model ? { model: attempt.model } : {}),
        seed: attempt.reportedSeed ?? attempt.requestedSeed,
        estimatedCostUsd: attempt.estimatedCostUsd,
        ...(attempt.reportedActualCostUsd !== undefined
          ? { reportedActualCostUsd: attempt.reportedActualCostUsd }
          : {}),
      };
    }),
  };
}

function proposal(candidate: VisualAuditionCandidate): VisualDirectionCandidateProposal {
  return {
    id: candidate.id,
    name: candidate.name,
    summary: candidate.summary,
    prompt: candidate.prompt,
    ...(candidate.negativePrompt ? { negativePrompt: candidate.negativePrompt } : {}),
    seed: candidate.seed,
    constitution: candidate.constitution,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sum(values: number[]): number {
  return Number(values.reduce((total, value) => total + value, 0).toFixed(8));
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`Vision grader ${label} must be a string array`);
  }
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Vision grader ${label} must be a non-empty string`);
  }
  return value.trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
