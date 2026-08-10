import { createHash, randomUUID } from 'node:crypto';
import {
  StageRunStatus,
  TaskRunStatus,
  WorkflowApprovalGateKey,
  WorkflowRunStatus,
  type ApproveWorkflowGateResult,
  type AnswerWorkflowDecisionResult,
  type ContextRecoveryReport,
  type ContextRecoveryReportResult,
  type ReviseWorkflowGateResult,
  type WorkflowGateRevisionAction,
  type FinalExportManifestContent,
  type FinalExportManifestSegment,
  type FinalExportOutputSettings,
  type FinalExportResolutionRisk,
  type PrepareFinalExportManifestInput,
  type PrepareFinalExportManifestResult,
  type ReserveWorkflowDecisionResult,
  type UserApproveWorkflowGateInput,
  type UserRejectWorkflowGateInput,
  type UserRequestWorkflowGateChangesInput,
  type SelectVisualConstitutionCandidateInput,
  type VisualAuditionCandidate,
  type VisualAuditionDocumentContent,
  type VisualConstitutionSelectionResult as ContractVisualConstitutionSelectionResult,
  type VisualConstitutionDocumentContent,
  type VisualDirectionCandidateProposal,
  type WorkflowApproval,
  type WorkflowApprovalContext,
  type WorkflowDocument,
  type WorkflowDecision,
  type WorkflowDecisionFilter,
  type WorkflowDecisionOption,
  type WorkflowEvent,
  type WorkflowFinalExportContext,
  type WorkflowMediaAttempt,
  type WorkflowRun,
  type WorkflowRunId,
  type WorkflowVisualAuditionContext,
  type WorkflowStageId,
  type WorkflowStageRun,
  type WorkflowTaskId,
  type WorkflowTaskRun,
  type LLMProviderRuntimeConfig,
  type CommanderProcessBehaviorSettings,
} from '@lucid-fin/contracts';
import type { IStorageLayer, WorkflowRepository } from '@lucid-fin/storage';
import type { WorkflowTaskExecutionResult, WorkflowTaskHandler } from './task-handler.js';
import { WorkflowPlanner } from './workflow-planner.js';
import type { WorkflowRegistry } from './workflow-registry.js';
import {
  MAX_PERSISTED_PRODUCTION_SHOTS,
  createMovieProductionWorkflowGraph,
} from './workflows/movie.production.v2.js';

export interface WorkflowStartRequest {
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProductionPlanCreateRequest {
  canvasId: string;
  idea: string;
  plan: Record<string, unknown>;
  /** Host-only, keyless executor binding. It is never part of the LLM tool schema. */
  commanderContinuation?: WorkflowCommanderContinuationConfig;
}

export interface WorkflowCommanderContinuationConfig {
  version: 1;
  sessionId: string;
  provider: LLMProviderRuntimeConfig;
  permissionMode: 'danger' | 'auto' | 'normal' | 'strict';
  locale?: string;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
  defaultProviders?: Record<string, string>;
  processSettings?: CommanderProcessBehaviorSettings;
  claim?: WorkflowCommanderContinuationClaim;
}

export interface WorkflowCommanderContinuationClaim {
  key: string;
  ownerId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  finishedAt?: number;
  reason?: string;
}

export type ClaimCommanderContinuationResult =
  | {
      ok: true;
      run: WorkflowRun;
      task: WorkflowTaskRun;
      continuation: WorkflowCommanderContinuationConfig;
    }
  | {
      ok: false;
      code:
        | 'run_not_found'
        | 'binding_missing'
        | 'workflow_not_ready'
        | 'task_not_ready'
        | 'already_claimed'
        | 'stale_row_version';
      actualRowVersion?: number;
    };

export interface ProductionPlanCreateResult {
  workflowRunId: string;
  gate: 'production_plan';
  status: 'awaiting_approval';
  revision: number;
  contentHash: string;
}

export interface ProductionPlanRevisionRequest {
  canvasId: string;
  workflowRunId: string;
  expectedRowVersion: number;
  plan: Record<string, unknown>;
}

export interface ContextCheckpointCreateResult {
  workflowRunId: string;
  revision: number;
  contentHash: string;
}

export interface ProductionMediaWorkflowContext {
  run: WorkflowRun;
  task: WorkflowTaskRun;
  productionPlan: WorkflowDocument;
  visualConstitution: WorkflowDocument;
}

export interface CreativeTaskCompletionRequest {
  canvasId: string;
  workflowRunId: string;
  taskRunId: string;
  expectedRowVersion: number;
  summary: string;
  evidence?: string[];
  data?: Record<string, unknown>;
}

export interface ProductionMediaTaskCompletionRequest {
  canvasId: string;
  workflowRunId: string;
  taskRunId: string;
  expectedRowVersion: number;
  nodeId: string;
  attemptId: string;
}

export interface ProductionMediaFeedbackReservationRequest {
  workflowRunId: string;
  canvasId: string;
  taskRunId: string;
  attemptId: string;
  expectedRowVersion: number;
  feedback: string;
  basePromptHash: string;
  attempt: WorkflowMediaAttempt;
}

export interface ExternalTaskCompletionResult {
  run: WorkflowRun;
  task: WorkflowTaskRun;
  nextTask?: WorkflowTaskRun;
}

export interface VisualAuditionStartRequest {
  canvasId: string;
  workflowRunId: string;
  providerId: string;
  width: number;
  height: number;
  candidates: VisualDirectionCandidateProposal[];
}

export interface VisualAuditionStartResult {
  document: WorkflowDocument;
  resumed: boolean;
}

export interface VisualAuditionSnapshotRequest {
  workflowRunId: string;
  expectedRevision: number;
  content: VisualAuditionDocumentContent;
}

export type VisualConstitutionSelectionResult = ContractVisualConstitutionSelectionResult;

export type FinalExportManifestResult = PrepareFinalExportManifestResult;

export interface WorkflowAskUserDecisionRequest {
  workflowRunId: string;
  taskRunId: string;
  canvasId: string;
  questionId: string;
  decisionKey: string;
  subjectRevision: number;
  expectedRunRowVersion: number;
  question: string;
  options: WorkflowDecisionOption[];
  allowFreeText: boolean;
}

export interface WorkflowAskUserDecisionAnswer {
  canvasId: string;
  questionId: string;
  answer: string;
  status: 'answered' | 'recovery_required';
}

export interface WorkflowEngineOptions {
  db: IStorageLayer;
  registry: WorkflowRegistry;
  handlers: WorkflowTaskHandler[];
  planner?: WorkflowPlanner;
  idFactory?: () => string;
  now?: () => number;
  maxConcurrentTasks?: number;
}

type WorkflowStateRecord = {
  workflowRun: WorkflowRun;
  stageRun: WorkflowStageRun;
  taskRun: WorkflowTaskRun;
};

const TASK_SUCCESS_STATUSES = new Set<WorkflowTaskRun['status']>([
  TaskRunStatus.Completed,
  TaskRunStatus.Skipped,
]);

const TASK_TERMINAL_STATUSES = new Set<WorkflowTaskRun['status']>([
  TaskRunStatus.Completed,
  TaskRunStatus.Skipped,
  TaskRunStatus.Failed,
  TaskRunStatus.RetryableFailed,
  TaskRunStatus.Cancelled,
]);

const WORKFLOW_TERMINAL_STATUSES = new Set<WorkflowRun['status']>([
  WorkflowRunStatus.Completed,
  WorkflowRunStatus.CompletedWithErrors,
  WorkflowRunStatus.Failed,
  WorkflowRunStatus.Cancelled,
  WorkflowRunStatus.Dead,
]);

export const VISUAL_PREVIEW_RUBRIC_VERSION = 'visual-preview-rubric-v1';

export class WorkflowEngine {
  private readonly planner: WorkflowPlanner;
  private readonly handlers = new Map<string, WorkflowTaskHandler>();
  private readonly now: () => number;
  private readonly idFactory?: () => string;
  private autoPump: Promise<number> | undefined;
  private tick = 0;
  private readonly maxConcurrentTasks: number;
  private activeTasks = 0;

  constructor(private readonly options: WorkflowEngineOptions) {
    this.planner = options.planner ?? new WorkflowPlanner();
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory;

    for (const handler of options.handlers) {
      this.handlers.set(handler.id, handler);
    }

    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 5;
  }

  private get wf(): WorkflowRepository {
    return this.options.db.repos.workflows;
  }

  // Engine-internal ID cast helpers. The engine only ever round-trips IDs that
  // the database itself generated, so we brand them at the access boundary
  // rather than threading brand types through every method signature.
  private runId(id: string | undefined): WorkflowRunId | undefined {
    return id as WorkflowRunId | undefined;
  }
  private stageId(id: string): WorkflowStageId {
    return id as WorkflowStageId;
  }
  private taskId(id: string): WorkflowTaskId {
    return id as WorkflowTaskId;
  }

  start(request: WorkflowStartRequest): string {
    const definition = this.options.registry.get(request.workflowType);
    if (!definition) {
      throw new Error(`Workflow "${request.workflowType}" is not registered`);
    }

    const planned = this.planner.plan({
      definition,
      entityType: request.entityType,
      entityId: request.entityId,
      triggerSource: request.triggerSource,
      input: request.input,
      metadata: request.metadata,
      now: this.nextTimestamp(),
      idFactory: this.idFactory,
    });

    this.wf.insertRun(planned.workflowRun);
    for (const stageRun of planned.stageRuns) {
      this.wf.insertStageRun(stageRun);
    }
    for (const taskRun of planned.taskRuns) {
      this.wf.insertTaskRun(taskRun);
    }
    for (const dependency of planned.taskDependencies) {
      this.wf.insertTaskDependency(
        this.taskId(dependency.taskRunId),
        this.taskId(dependency.dependsOnTaskRunId),
      );
    }

    // Auto-pump: begin executing the workflow immediately so callers don't need
    // to manually call pump() after start().
    this.autoPump = this.pump(planned.workflowRun.id);

    return planned.workflowRun.id;
  }

  list(filter?: { status?: string; workflowType?: string; entityType?: string }): WorkflowRun[] {
    return this.wf.listRuns(filter).rows;
  }

  get(id: string): WorkflowRun | undefined {
    return this.wf.getRun(this.runId(id) as WorkflowRunId);
  }

  getStages(workflowRunId: string): WorkflowStageRun[] {
    return this.wf.listStageRuns(this.runId(workflowRunId) as WorkflowRunId).rows;
  }

  getTasks(workflowRunId: string): WorkflowTaskRun[] {
    return this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows;
  }

  claimCommanderContinuation(input: {
    workflowRunId: string;
    taskRunId: string;
    claimKey: string;
    claimOwnerId: string;
    expectedRowVersion: number;
  }): ClaimCommanderContinuationResult {
    const runId = this.runId(input.workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run) return { ok: false, code: 'run_not_found' };
    if ((run.rowVersion ?? 0) !== input.expectedRowVersion) {
      return {
        ok: false,
        code: 'stale_row_version',
        actualRowVersion: run.rowVersion ?? 0,
      };
    }

    const continuation = readCommanderContinuation(run.metadata);
    if (!continuation) return { ok: false, code: 'binding_missing' };
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.currentGate ||
      run.status !== WorkflowRunStatus.Ready ||
      run.currentTaskId !== input.taskRunId
    ) {
      return { ok: false, code: 'workflow_not_ready' };
    }
    const recoveryState = asRecord(asRecord(run.metadata).contextRecovery).state;
    if (recoveryState === 'recovery_required') {
      return { ok: false, code: 'workflow_not_ready' };
    }
    const task = this.wf.getTaskRun(this.taskId(input.taskRunId));
    if (
      !task ||
      task.workflowRunId !== run.id ||
      task.status !== TaskRunStatus.Ready ||
      task.input.executionMode !== 'external'
    ) {
      return { ok: false, code: 'task_not_ready' };
    }
    if (
      continuation.claim?.key === input.claimKey &&
      (continuation.claim.status === 'completed' ||
        (continuation.claim.status === 'running' &&
          continuation.claim.ownerId === input.claimOwnerId))
    ) {
      return { ok: false, code: 'already_claimed' };
    }

    const claimedAt = this.nextTimestamp();
    const claimed: WorkflowCommanderContinuationConfig = {
      ...continuation,
      claim: {
        key: input.claimKey,
        ownerId: requireNonEmptyString(input.claimOwnerId, 'continuation claim owner'),
        status: 'running',
        startedAt: claimedAt,
      },
    };
    const changed = this.wf.compareAndSetRunMetadata(
      runId,
      input.expectedRowVersion,
      { ...run.metadata, commanderContinuation: claimed },
      claimedAt,
    );
    if (!changed) {
      return {
        ok: false,
        code: 'stale_row_version',
        actualRowVersion: this.wf.getRun(runId)?.rowVersion ?? input.expectedRowVersion,
      };
    }
    const updated = this.wf.getRun(runId);
    if (!updated) return { ok: false, code: 'run_not_found' };
    return { ok: true, run: updated, task, continuation: claimed };
  }

  finishCommanderContinuationClaim(input: {
    workflowRunId: string;
    claimKey: string;
    claimOwnerId: string;
    expectedRowVersion: number;
    outcome: 'completed' | 'failed';
    reason?: string;
  }): boolean {
    const runId = this.runId(input.workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run || (run.rowVersion ?? 0) !== input.expectedRowVersion) return false;
    const continuation = readCommanderContinuation(run.metadata);
    const claim = continuation?.claim;
    if (
      !continuation ||
      !claim ||
      claim.status !== 'running' ||
      claim.key !== input.claimKey ||
      claim.ownerId !== input.claimOwnerId
    ) {
      return false;
    }

    const finishedAt = this.nextTimestamp();
    const finished: WorkflowCommanderContinuationConfig = {
      ...continuation,
      claim: {
        ...claim,
        status: input.outcome,
        finishedAt,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    };
    return this.wf.compareAndSetRunMetadata(
      runId,
      input.expectedRowVersion,
      { ...run.metadata, commanderContinuation: finished },
      finishedAt,
    );
  }

  reserveAskUserDecision(input: WorkflowAskUserDecisionRequest): ReserveWorkflowDecisionResult {
    const decisionKey = requireNonEmptyString(input.decisionKey, 'decision key');
    const question = requireNonEmptyString(input.question, 'decision question');
    const now = this.nextTimestamp();
    const decision: WorkflowDecision = {
      id: this.nextId(),
      workflowRunId: input.workflowRunId,
      taskRunId: input.taskRunId,
      canvasId: input.canvasId,
      questionId: input.questionId,
      decisionKey,
      subjectRevision: input.subjectRevision,
      question,
      options: input.options,
      allowFreeText: input.allowFreeText,
      status: 'pending',
      rowVersion: 0,
      createdAt: now,
      updatedAt: now,
    };
    const reserved = this.wf.reserveDecision({
      decision,
      expectedRunRowVersion: input.expectedRunRowVersion,
      event: {
        workflowRunId: input.workflowRunId,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: { type: 'workflow.decision.requested' },
        timestamp: now,
      },
    });
    if (
      !reserved.created &&
      reserved.decision.status === 'recovery_required' &&
      reserved.decision.answer !== undefined
    ) {
      const recoveredAt = this.nextTimestamp();
      const recovered = this.wf.answerDecision({
        canvasId: reserved.decision.canvasId,
        questionId: reserved.decision.questionId,
        answer: reserved.decision.answer,
        status: 'answered',
        answeredAt: recoveredAt,
        event: {
          workflowRunId: reserved.decision.workflowRunId,
          eventId: this.nextId(),
          actor: 'assistant',
          correlationId: this.nextId(),
          payload: { type: 'workflow.decision.recovered' },
          timestamp: recoveredAt,
        },
      });
      if (!recovered) throw new Error('Persisted workflow decision disappeared during recovery');
      if (recovered.answered) this.schedulePump(recovered.decision.workflowRunId);
      return {
        decision: recovered.decision,
        run: recovered.run,
        task: recovered.task,
        ...(recovered.event ? { event: recovered.event } : {}),
        created: false,
      };
    }
    return reserved;
  }

  listPendingDecisions(filter: WorkflowDecisionFilter = {}): WorkflowDecision[] {
    return this.wf.listPendingDecisions(filter);
  }

  answerAskUserDecisionFromUser(
    input: WorkflowAskUserDecisionAnswer,
  ): AnswerWorkflowDecisionResult | undefined {
    const decision = this.wf.getDecisionByQuestion(input.canvasId, input.questionId);
    if (!decision) return undefined;
    const answeredAt = this.nextTimestamp();
    const result = this.wf.answerDecision({
      canvasId: input.canvasId,
      questionId: input.questionId,
      answer: input.answer,
      status: input.status,
      answeredAt,
      event: {
        workflowRunId: decision.workflowRunId,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        payload: { type: 'workflow.decision.answered' },
        timestamp: answeredAt,
      },
    });
    if (result?.answered && input.status === 'answered') {
      this.schedulePump(decision.workflowRunId);
    }
    return result;
  }

  /** Complete a host-bound creative task after the AI has persisted its work. */
  async completeCreativeTask(
    input: CreativeTaskCompletionRequest,
  ): Promise<ExternalTaskCompletionResult> {
    const summary = requireNonEmptyString(input.summary, 'task completion summary');
    if (summary.length > 4_000) throw new Error('Task completion summary exceeds 4000 characters');
    const evidence = (input.evidence ?? []).map((entry) =>
      requireNonEmptyString(entry, 'task completion evidence'),
    );
    if (evidence.length > 50 || evidence.some((entry) => entry.length > 500)) {
      throw new Error('Task completion evidence exceeds its bounded size');
    }
    const task = this.requireCurrentExternalTask(
      input.workflowRunId,
      input.taskRunId,
      input.expectedRowVersion,
      input.canvasId,
    );
    const role = requireNonEmptyString(task.input.workflowTaskRole, 'workflow task role');
    if (!['script', 'entities', 'references', 'shot_spec', 'assembly'].includes(role)) {
      throw new Error(`Task role "${role}" requires a host-verified completion path`);
    }
    return this.completeExternalTask({
      workflowRunId: input.workflowRunId,
      task,
      expectedRowVersion: input.expectedRowVersion,
      output: {
        completedBy: 'assistant',
        role,
        summary,
        evidence,
        ...(input.data ? { data: cloneJson(input.data) } : {}),
      },
    });
  }

  /** Complete exactly one shot task from an accepted, graded durable attempt. */
  async completeProductionMediaTask(
    input: ProductionMediaTaskCompletionRequest,
  ): Promise<ExternalTaskCompletionResult> {
    const task = this.requireCurrentExternalTask(
      input.workflowRunId,
      input.taskRunId,
      input.expectedRowVersion,
      input.canvasId,
    );
    if (task.input.workflowTaskRole !== 'production_media') {
      throw new Error('Accepted production media can complete only a production_media task');
    }
    const attempt = this.wf.getLatestMediaAttempt(
      this.runId(input.workflowRunId) as WorkflowRunId,
      requireNonEmptyString(input.nodeId, 'production media nodeId'),
    );
    if (
      !attempt ||
      attempt.id !== input.attemptId ||
      attempt.status !== 'accepted' ||
      !attempt.assetHash ||
      attempt.generationSpec.workflowTask.taskRunId !== task.id
    ) {
      throw new Error('Production task completion requires its exact accepted durable attempt');
    }
    const evaluation = this.wf.getMediaEvaluation(attempt.id);
    if (
      !evaluation ||
      evaluation.verdict !== 'pass' ||
      evaluation.assetHash !== attempt.assetHash
    ) {
      throw new Error('Production task completion requires a passing durable evaluation');
    }
    return this.completeExternalTask({
      workflowRunId: input.workflowRunId,
      task,
      expectedRowVersion: input.expectedRowVersion,
      output: {
        completedBy: 'production-media-service',
        role: 'production_media',
        shot: cloneJson(asRecord(task.input.shot)),
        nodeId: attempt.nodeId,
        attemptId: attempt.id,
        evaluationId: evaluation.id,
        assetHash: attempt.assetHash,
      },
    });
  }

  async reserveProductionMediaFeedbackAttemptForRevision(
    input: ProductionMediaFeedbackReservationRequest,
  ): Promise<{ run: WorkflowRun; task: WorkflowTaskRun; attempt: WorkflowMediaAttempt }> {
    const feedback = requireNonEmptyString(input.feedback, 'production media feedback');
    const reopenedAt = this.nextTimestamp();
    const result = this.wf.reserveMediaFeedbackAttempt({
      workflowRunId: input.workflowRunId,
      canvasId: input.canvasId,
      taskRunId: input.taskRunId,
      attemptId: input.attemptId,
      basePromptHash: input.basePromptHash,
      expectedRunRowVersion: input.expectedRowVersion,
      feedback,
      attempt: input.attempt,
      reopenedAt,
      event: {
        workflowRunId: input.workflowRunId,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        payload: {},
        timestamp: reopenedAt,
      },
    });
    await this.refreshAvailability(input.workflowRunId);
    const run = this.wf.getRun(this.runId(input.workflowRunId) as WorkflowRunId) ?? result.run;
    const task = this.wf.getTaskRun(this.taskId(input.taskRunId)) ?? result.task;
    return { run, task, attempt: result.attempt };
  }

  /**
   * Persists the AI-expanded plan and first approval gate as one transaction.
   * Deliberately does not call start(), pump(), a provider, canvas, or media code.
   */
  createProductionPlan(request: ProductionPlanCreateRequest): ProductionPlanCreateResult {
    const canvasId = request.canvasId.trim();
    if (!canvasId) throw new TypeError('Production plan canvasId must not be empty');
    const idea = request.idea.trim();
    if (!idea) throw new TypeError('Production plan idea must not be empty');
    const existing = this.wf
      .listRuns({ workflowType: 'movie.production.v2', entityType: 'canvas' })
      .rows.find(
        (candidate) =>
          candidate.entityId === canvasId && !WORKFLOW_TERMINAL_STATUSES.has(candidate.status),
      );
    if (existing) {
      throw new Error(
        `Persistent video workflow "${existing.id}" is already active for canvas "${canvasId}"`,
      );
    }

    const createdAt = this.nextTimestamp();
    const graph = createMovieProductionWorkflowGraph(request.plan);
    const planned = this.planner.plan({
      definition: graph.definition,
      entityType: 'canvas',
      entityId: canvasId,
      triggerSource: 'commander',
      input: { idea },
      metadata: {
        displayCategory: 'Production',
        displayLabel:
          typeof request.plan.title === 'string' && request.plan.title.trim()
            ? request.plan.title.trim()
            : 'Untitled production',
        productionPhase: 'production-plan',
        productionGraph: {
          shotCount: graph.shots.length,
          sourceSceneCount: graph.sourceSceneCount,
          maxShots: MAX_PERSISTED_PRODUCTION_SHOTS,
          truncated: graph.truncated,
        },
        ...(request.commanderContinuation
          ? { commanderContinuation: cloneJson(request.commanderContinuation) }
          : {}),
      },
      now: createdAt,
      idFactory: this.idFactory,
    });
    const workflowRunId = planned.workflowRun.id;
    const planStage = planned.stageRuns.find((stage) => stage.stageId === 'production-plan');
    const planTask = planned.taskRuns.find((task) => task.taskId === 'production-plan');
    if (!planStage || !planTask) {
      throw new Error('Persistent production workflow definition is missing its plan stage');
    }
    planTask.status = TaskRunStatus.Completed;
    planTask.progress = 100;
    planTask.startedAt = createdAt;
    planTask.completedAt = createdAt;
    planStage.status = StageRunStatus.Completed;
    planStage.progress = 100;
    planStage.completedTasks = 1;
    planStage.startedAt = createdAt;
    planStage.completedAt = createdAt;

    const documentId = this.nextId();
    const approvalId = this.nextId();
    const correlationId = this.nextId();
    const resumeToken = this.nextId();
    const content = { ...request.plan, originalIdea: idea, canvasId };
    const contentHash = sha256(canonicalJson(content));
    const manifestHash = sha256(
      canonicalJson({
        gateKey: WorkflowApprovalGateKey.ProductionPlan,
        subjectHash: contentHash,
        budget: request.plan.budget ?? null,
      }),
    );

    const run: WorkflowRun = {
      ...planned.workflowRun,
      status: WorkflowRunStatus.Pending,
      summary: 'Production plan awaiting approval',
      progress: Math.round(100 / planned.stageRuns.length),
      completedStages: 1,
      totalStages: planned.stageRuns.length,
      completedTasks: 1,
      totalTasks: planned.taskRuns.length,
      currentStageId: planStage.id,
      currentTaskId: planTask.id,
      updatedAt: createdAt,
      rowVersion: 0,
      engineVersion: 'persistent-hybrid-v2',
      definitionVersion: graph.definition.version,
    };
    const document: WorkflowDocument = {
      id: documentId,
      workflowRunId,
      logicalKey: 'production-plan',
      documentType: 'production_plan',
      revision: 1,
      schemaVersion: 1,
      content,
      contentHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
    const approval: WorkflowApproval = {
      id: approvalId,
      workflowRunId,
      gateKey: WorkflowApprovalGateKey.ProductionPlan,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: contentHash,
      manifestHash,
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    const events: WorkflowEvent[] = [
      {
        workflowRunId,
        seq: 1,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId,
        payload: {
          type: 'workflow.created',
          workflowType: run.workflowType,
          source: run.triggerSource,
        },
        timestamp: createdAt,
      },
      {
        workflowRunId,
        seq: 2,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId,
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: contentHash,
        },
        timestamp: this.nextTimestamp(),
      },
    ];

    this.wf.createApprovalGateBundle({
      run,
      stageRuns: planned.stageRuns,
      taskRuns: planned.taskRuns,
      taskDependencies: planned.taskDependencies,
      document,
      approval,
      events,
    });
    return {
      workflowRunId,
      gate: WorkflowApprovalGateKey.ProductionPlan,
      status: 'awaiting_approval',
      revision: document.revision,
      contentHash,
    };
  }

  /**
   * Produces a genuinely new Production Plan revision after the user rejects
   * the previous subject. The original idea and canvas binding remain
   * host-owned; only the reviewed plan body may change.
   */
  reviseProductionPlan(request: ProductionPlanRevisionRequest): ProductionPlanCreateResult {
    const canvasId = requireNonEmptyString(request.canvasId, 'Production plan canvasId');
    const runId = this.runId(request.workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run) throw new Error(`Workflow "${request.workflowRunId}" not found`);
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.entityId !== canvasId
    ) {
      throw new Error(`Workflow "${request.workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if ((run.rowVersion ?? 0) !== request.expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${request.expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }
    if (run.currentGate || this.getProductionStageKey(run) !== 'production-plan') {
      throw new Error(
        'Production Plan revision is available only after that gate requests changes',
      );
    }
    const producer = this.wf
      .listTaskRuns(runId)
      .rows.find((task) => task.id === run.currentTaskId && task.taskId === 'production-plan');
    if (
      !producer ||
      producer.status !== TaskRunStatus.Ready ||
      !asRecord(producer.input.revisionRequest).reason
    ) {
      throw new Error('Production Plan producer is not awaiting a user-requested revision');
    }
    const previous = this.wf.getLatestDocument(runId, 'production-plan');
    const previousApproval = this.wf.getLatestApproval(
      runId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    if (!previous || !previousApproval || previousApproval.status !== 'rejected') {
      throw new Error('The previous Production Plan revision was not rejected for changes');
    }

    const createdAt = this.nextTimestamp();
    const originalIdea = requireNonEmptyString(run.input.idea, 'original workflow idea');
    const graph = createMovieProductionWorkflowGraph(request.plan);
    const replanned = this.planner.plan({
      definition: graph.definition,
      entityType: 'canvas',
      entityId: canvasId,
      triggerSource: run.triggerSource,
      input: { idea: originalIdea },
      metadata: cloneJson(run.metadata),
      now: createdAt,
      idFactory: () => this.nextId(),
    });
    const existingStages = this.wf.listStageRuns(runId).rows;
    const existingTasks = this.wf.listTaskRuns(runId).rows;
    const persistentStageIdByLogical = new Map(
      existingStages.map((stage) => [stage.stageId, stage.id]),
    );
    const plannedStageIdToPersistent = new Map<string, string>();
    for (const stage of replanned.stageRuns) {
      const persistentId = persistentStageIdByLogical.get(stage.stageId);
      if (!persistentId) {
        throw new Error(`Revised Production Plan is missing persisted stage "${stage.stageId}"`);
      }
      plannedStageIdToPersistent.set(stage.id, persistentId);
    }
    const existingTaskIdByLogical = new Map(existingTasks.map((task) => [task.taskId, task.id]));
    const plannedTaskIdToPersistent = new Map<string, string>();
    for (const task of replanned.taskRuns) {
      plannedTaskIdToPersistent.set(
        task.id,
        task.taskId === 'production-plan'
          ? producer.id
          : (existingTaskIdByLogical.get(task.taskId) ?? task.id),
      );
    }
    const replacementStageRuns = replanned.stageRuns
      .filter((stage) => stage.stageId !== 'production-plan')
      .map((stage) => ({
        ...stage,
        id: plannedStageIdToPersistent.get(stage.id)!,
        workflowRunId: run.id,
        updatedAt: createdAt,
      }));
    const replacementTaskRuns = replanned.taskRuns
      .filter((task) => task.taskId !== 'production-plan')
      .map((task) => ({
        ...task,
        id: plannedTaskIdToPersistent.get(task.id)!,
        workflowRunId: run.id,
        stageRunId: plannedStageIdToPersistent.get(task.stageRunId)!,
        dependencyIds: task.dependencyIds.map((dependencyId) => {
          const persistentId = plannedTaskIdToPersistent.get(dependencyId);
          if (!persistentId) throw new Error('Revised Production Plan has an unknown dependency');
          return persistentId;
        }),
        updatedAt: createdAt,
      }));
    const replacementTaskDependencies = replanned.taskDependencies
      .filter((dependency) => {
        const task = replanned.taskRuns.find((candidate) => candidate.id === dependency.taskRunId);
        return task?.taskId !== 'production-plan';
      })
      .map((dependency) => ({
        taskRunId: plannedTaskIdToPersistent.get(dependency.taskRunId)!,
        dependsOnTaskRunId: plannedTaskIdToPersistent.get(dependency.dependsOnTaskRunId)!,
      }));
    const content = { ...cloneJson(request.plan), originalIdea, canvasId };
    const document = this.createWorkflowDocument(
      run.id,
      'production-plan',
      'production_plan',
      previous.revision + 1,
      content,
      createdAt,
    );
    if (document.contentHash === previous.contentHash) {
      throw new Error('Revised Production Plan must differ from the rejected revision');
    }
    const approval: WorkflowApproval = {
      id: this.nextId(),
      workflowRunId: run.id,
      gateKey: WorkflowApprovalGateKey.ProductionPlan,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: sha256(
        canonicalJson({
          gateKey: WorkflowApprovalGateKey.ProductionPlan,
          subjectHash: document.contentHash,
          budget: request.plan.budget ?? null,
        }),
      ),
      resumeTokenHash: sha256(this.nextId()),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createApprovalGateRevision({
      expectedRowVersion: request.expectedRowVersion,
      document,
      approval,
      replacementGraph: {
        stageRuns: replacementStageRuns,
        taskRuns: replacementTaskRuns,
        taskDependencies: replacementTaskDependencies,
        runMetadata: {
          ...cloneJson(run.metadata),
          displayLabel:
            typeof request.plan.title === 'string' && request.plan.title.trim()
              ? request.plan.title.trim()
              : 'Untitled production',
          productionPhase: 'production-plan',
          productionGraph: {
            shotCount: graph.shots.length,
            sourceSceneCount: graph.sourceSceneCount,
            maxShots: MAX_PERSISTED_PRODUCTION_SHOTS,
            truncated: graph.truncated,
          },
        },
        invalidatedByRevision: document.revision,
        updatedAt: createdAt,
      },
      event: {
        workflowRunId: run.id,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId: approval.id,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: document.contentHash,
          revisionOf: previous.revision,
        },
        timestamp: createdAt,
      },
    });
    return {
      workflowRunId: run.id,
      gate: WorkflowApprovalGateKey.ProductionPlan,
      status: 'awaiting_approval',
      revision: document.revision,
      contentHash: document.contentHash,
    };
  }

  /**
   * Persist a verified immutable projection of the durable workflow facts
   * immediately before context handoff compaction.
   */
  createContextCheckpoint(
    workflowRunId: string,
    facts: Record<string, unknown>,
  ): ContextCheckpointCreateResult {
    const runId = this.runId(workflowRunId) as WorkflowRunId;
    if (!this.wf.getRun(runId)) {
      throw new Error(`Workflow "${workflowRunId}" not found`);
    }
    const latest = this.wf.getLatestDocument(runId, 'context-checkpoint');
    const revision = (latest?.revision ?? 0) + 1;
    const createdAt = this.nextTimestamp();
    const content = { ...facts, workflowRunId, checkpointedAt: createdAt };
    const contentHash = sha256(canonicalJson(content));
    const document: WorkflowDocument = {
      id: this.nextId(),
      workflowRunId,
      logicalKey: 'context-checkpoint',
      documentType: 'context_checkpoint',
      revision,
      schemaVersion: 1,
      content,
      contentHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createDocument(document);
    const verified = this.wf.getDocumentRevision(runId, document.logicalKey, document.revision);
    if (!verified || verified.contentHash !== contentHash) {
      throw new Error(`Context checkpoint verification failed for workflow "${workflowRunId}"`);
    }
    return { workflowRunId, revision, contentHash };
  }

  /**
   * Persist Commander context-recovery health on the workflow aggregate.
   * The counter therefore survives individual Commander runs and process
   * restarts. A recovery pause remembers the prior run status so only this
   * automatic pause is reversed after SQLite context reload succeeds.
   */
  async reportContextRecovery(report: ContextRecoveryReport): Promise<ContextRecoveryReportResult> {
    const runId = this.runId(report.workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run) throw new Error(`Workflow "${report.workflowRunId}" not found`);
    if (WORKFLOW_TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Terminal workflow "${report.workflowRunId}" cannot change recovery state`);
    }

    const current = asRecord(run.metadata.contextRecovery);
    const currentState = typeof current.state === 'string' ? current.state : undefined;
    const currentFailures =
      typeof current.consecutiveFailures === 'number' &&
      Number.isInteger(current.consecutiveFailures) &&
      current.consecutiveFailures >= 0
        ? current.consecutiveFailures
        : 0;

    if (report.outcome === 'recovered') {
      if (currentState === undefined || (currentState === 'recovered' && currentFailures === 0)) {
        return { state: 'active', consecutiveFailures: 0, changed: false };
      }

      const previousRunStatus = isWorkflowRunStatus(current.previousRunStatus)
        ? current.previousRunStatus
        : WorkflowRunStatus.Ready;
      const restoredStatus =
        currentState === 'recovery_required' && run.status === WorkflowRunStatus.Paused
          ? safeRecoveredRunStatus(previousRunStatus)
          : run.status;
      const updatedAt = this.nextTimestamp();
      this.wf.updateRun(runId, {
        status: restoredStatus,
        metadata: {
          ...run.metadata,
          contextRecovery: {
            state: 'recovered',
            consecutiveFailures: 0,
            reason: report.reason,
            previousRunStatus,
            updatedAt,
          },
        },
        updatedAt,
      });
      if (restoredStatus === WorkflowRunStatus.Ready) {
        await this.refreshAvailability(report.workflowRunId);
      }
      return { state: 'active', consecutiveFailures: 0, changed: true };
    }

    const consecutiveFailures = currentFailures + 1;
    const recoveryRequired = report.forcePause === true || consecutiveFailures >= 3;
    const previousRunStatus =
      currentState === 'recovery_required' && isWorkflowRunStatus(current.previousRunStatus)
        ? current.previousRunStatus
        : run.status;
    const updatedAt = this.nextTimestamp();
    this.wf.updateRun(runId, {
      ...(recoveryRequired ? { status: WorkflowRunStatus.Paused } : {}),
      metadata: {
        ...run.metadata,
        contextRecovery: {
          state: recoveryRequired ? 'recovery_required' : 'recovering',
          consecutiveFailures,
          reason: report.reason,
          previousRunStatus,
          updatedAt,
        },
      },
      updatedAt,
    });
    return {
      state: recoveryRequired ? 'recovery_required' : 'recovering',
      consecutiveFailures,
      changed: true,
    };
  }

  getLatestVisualAudition(workflowRunId: string): WorkflowDocument | undefined {
    return this.wf.getLatestDocument(
      this.runId(workflowRunId) as WorkflowRunId,
      'visual-auditions',
    );
  }

  getVisualAuditionContext(workflowRunId: string): WorkflowVisualAuditionContext | undefined {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) return undefined;
    const document = this.getLatestVisualAudition(workflowRunId);
    return document ? { run, document } : undefined;
  }

  getApprovedProductionPlan(workflowRunId: string): WorkflowDocument {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    return this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
  }

  getApprovedVisualConstitution(workflowRunId: string): WorkflowDocument {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    return this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.VisualConstitution,
    );
  }

  requireProductionMediaContext(
    workflowRunId: string,
    canvasId: string,
    taskRunId: string,
    expectedRowVersion?: number,
  ): ProductionMediaWorkflowContext {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.entityId !== canvasId
    ) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (expectedRowVersion !== undefined && (run.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    const currentStage = this.getProductionStageKey(run);
    const task = this.wf.getTaskRun(this.taskId(taskRunId));
    const taskRole =
      typeof task?.input.workflowTaskRole === 'string' ? task.input.workflowTaskRole : undefined;
    const stageAllowsMedia =
      (currentStage === 'media-generation' && taskRole === 'production_media') ||
      (currentStage === 'preproduction' && taskRole === 'references');
    if (
      !task ||
      task.workflowRunId !== run.id ||
      task.id !== run.currentTaskId ||
      (task.status !== TaskRunStatus.Ready && task.status !== TaskRunStatus.Running) ||
      !stageAllowsMedia ||
      (run.status !== WorkflowRunStatus.Ready && run.status !== WorkflowRunStatus.Running)
    ) {
      throw new Error(
        `Workflow "${workflowRunId}" is not ready for task-bound media generation (status=${run.status}, stage=${currentStage ?? 'none'}, task=${task?.taskId ?? 'none'})`,
      );
    }
    return {
      run,
      task,
      productionPlan: this.requireExactApprovedDocument(
        run.id as WorkflowRunId,
        WorkflowApprovalGateKey.ProductionPlan,
      ),
      visualConstitution: this.requireExactApprovedDocument(
        run.id as WorkflowRunId,
        WorkflowApprovalGateKey.VisualConstitution,
      ),
    };
  }

  requireProductionMediaFeedbackContext(
    workflowRunId: string,
    canvasId: string,
    taskRunId: string,
    expectedRowVersion: number,
  ): ProductionMediaWorkflowContext {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.entityId !== canvasId
    ) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if ((run.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    if (run.status !== WorkflowRunStatus.Ready && run.status !== WorkflowRunStatus.Running) {
      throw new Error(`Workflow "${workflowRunId}" cannot accept media feedback now`);
    }
    const task = this.wf.getTaskRun(this.taskId(taskRunId));
    if (
      !task ||
      task.workflowRunId !== run.id ||
      task.input.workflowTaskRole !== 'production_media' ||
      task.status !== TaskRunStatus.Completed
    ) {
      throw new Error('Only an exact completed production-media task can accept this feedback');
    }
    const assemblyStarted = this.wf.listTaskRuns(run.id as WorkflowRunId).rows.some((candidate) => {
      const stage = this.wf.getStageRun(this.stageId(candidate.stageRunId));
      return (
        stage?.stageId === 'assembly' &&
        (candidate.status === TaskRunStatus.Running ||
          candidate.status === TaskRunStatus.AwaitingProvider ||
          candidate.status === TaskRunStatus.Completed)
      );
    });
    if (assemblyStarted) {
      throw new Error('Assembly has already started; revise that stage before changing media');
    }
    return {
      run,
      task,
      productionPlan: this.requireExactApprovedDocument(
        run.id as WorkflowRunId,
        WorkflowApprovalGateKey.ProductionPlan,
      ),
      visualConstitution: this.requireExactApprovedDocument(
        run.id as WorkflowRunId,
        WorkflowApprovalGateKey.VisualConstitution,
      ),
    };
  }

  /**
   * Creates or resumes the durable candidate set before any provider call.
   * A repeated call is resumable only when every creative/provider input is
   * byte-for-byte equivalent to the existing request hash.
   */
  beginVisualAudition(request: VisualAuditionStartRequest): VisualAuditionStartResult {
    const run = this.requireStyleExplorationRun(request.workflowRunId, request.canvasId);
    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const providerId = requireNonEmptyString(request.providerId, 'providerId');
    const width = requirePositiveInteger(request.width, 'width');
    const height = requirePositiveInteger(request.height, 'height');
    validateVisualCandidateProposals(request.candidates);

    const planBudget = asRecord(productionPlan.content.budget);
    const approvedStyleAuditionCostUsd = requireNonNegativeNumber(
      planBudget.styleAuditionCostUsd,
      'Production Plan budget.styleAuditionCostUsd',
    );
    const maxRegenerations = requireNonNegativeInteger(
      planBudget.maxRegenerations,
      'Production Plan budget.maxRegenerations',
    );
    const planAttempts = requireNonNegativeInteger(
      planBudget.maxAttemptsPerShot,
      'Production Plan budget.maxAttemptsPerShot',
    );
    const maxAttemptsPerCandidate = Math.max(1, Math.min(2, planAttempts || 1));
    const requestIdentity = {
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
      },
      providerId,
      width,
      height,
      rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
      candidates: request.candidates,
    };
    const requestHash = sha256(canonicalJson(requestIdentity));
    const existing = this.getLatestVisualAudition(run.id);
    if (existing) {
      const existingContent = existing.content as VisualAuditionDocumentContent;
      const producer = this.wf
        .listTaskRuns(run.id as WorkflowRunId)
        .rows.find((task) => task.id === run.currentTaskId && task.taskId === 'style-audition');
      const revisionRequest = asRecord(producer?.input.revisionRequest);
      const isRequestedRevision =
        producer?.status === TaskRunStatus.Ready &&
        typeof revisionRequest.reason === 'string' &&
        Boolean(revisionRequest.reason.trim());
      if (existingContent.requestHash === requestHash) {
        if (isRequestedRevision) {
          throw new Error('Revised visual audition must differ from the rejected candidate set');
        }
        return {
          document: existing,
          resumed: existingContent.status !== 'complete',
        };
      }
      if (!isRequestedRevision) {
        throw new Error(
          'A different visual audition already exists for this workflow; inspect or resolve it before submitting another candidate set',
        );
      }
    }

    const createdAt = this.nextTimestamp();
    const candidates: VisualAuditionCandidate[] = request.candidates.map((candidate) => ({
      ...cloneJson(candidate),
      status: 'pending',
      attempts: [],
    }));
    const content: VisualAuditionDocumentContent = {
      status: 'in_progress',
      requestHash,
      rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
      productionPlan: requestIdentity.productionPlan,
      providerId,
      width,
      height,
      candidates,
      budget: {
        approvedStyleAuditionCostUsd,
        maxRegenerations,
        maxAttemptsPerCandidate,
        estimatedCommittedUsd: 0,
        hasUnreportedActualCosts: false,
        unpricedOperations: ['vision-grade'],
      },
    };
    const document = this.createWorkflowDocument(
      run.id,
      'visual-auditions',
      'visual_auditions',
      (existing?.revision ?? 0) + 1,
      content,
      createdAt,
    );
    this.wf.createDocument(document);
    return { document, resumed: false };
  }

  /** Append a verified immutable snapshot after each provider/vision attempt. */
  saveVisualAuditionSnapshot(request: VisualAuditionSnapshotRequest): WorkflowDocument {
    const run = this.requireStyleExplorationRun(request.workflowRunId);
    const latest = this.getLatestVisualAudition(run.id);
    if (!latest) throw new Error(`Workflow "${run.id}" has no visual audition to update`);
    if (latest.revision !== request.expectedRevision) {
      throw new Error(
        `Visual audition revision changed: expected ${request.expectedRevision}, got ${latest.revision}`,
      );
    }
    validateVisualAuditionSnapshot(
      request.content,
      latest.content as VisualAuditionDocumentContent,
      (assetHash) => Boolean(this.options.db.repos.assets.findByHash(assetHash)),
    );

    const createdAt = this.nextTimestamp();
    const document = this.createWorkflowDocument(
      run.id,
      'visual-auditions',
      'visual_auditions',
      latest.revision + 1,
      cloneJson(request.content),
      createdAt,
    );
    this.wf.createDocument(document);
    const verified = this.wf.getDocumentRevision(
      run.id as WorkflowRunId,
      document.logicalKey,
      document.revision,
    );
    if (!verified || verified.contentHash !== document.contentHash) {
      throw new Error(`Visual audition verification failed for workflow "${run.id}"`);
    }
    return verified;
  }

  /**
   * A real host-UI choice creates the exact immutable Visual Constitution and
   * opens the second approval gate. Selection and approval remain separate.
   */
  selectVisualConstitutionCandidateFromUser(
    input: SelectVisualConstitutionCandidateInput,
  ): VisualConstitutionSelectionResult {
    const run = this.wf.getRun(this.runId(input.workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${input.workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${input.workflowRunId}" is not a persistent video workflow`);
    }
    if (this.getProductionStageKey(run) !== 'style-exploration') {
      throw new Error('Visual candidates can be selected only during style exploration');
    }
    if (run.currentGate && run.currentGate !== WorkflowApprovalGateKey.VisualConstitution) {
      throw new Error(`Workflow is blocked at ${run.currentGate}`);
    }
    if ((run.rowVersion ?? 0) !== input.expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${input.expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }

    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const audition = this.getLatestVisualAudition(run.id);
    if (!audition) throw new Error('No visual auditions are available for selection');
    if (audition.revision !== input.expectedAuditionRevision) {
      throw new Error(
        `Visual audition revision changed: expected ${input.expectedAuditionRevision}, got ${audition.revision}`,
      );
    }
    if (audition.contentHash !== input.expectedAuditionHash) {
      throw new Error('Visual audition content hash changed');
    }
    const auditionContent = audition.content as VisualAuditionDocumentContent;
    if (auditionContent.status !== 'complete') {
      throw new Error('Visual auditions are not complete');
    }
    const candidate = auditionContent.candidates.find(
      (entry) => entry.id === input.candidateId && entry.status === 'completed',
    );
    if (!candidate || candidate.selectedAttempt === undefined) {
      throw new Error(`Completed visual candidate "${input.candidateId}" not found`);
    }
    const attempt = candidate.attempts.find(
      (entry) => entry.attempt === candidate.selectedAttempt && entry.status === 'completed',
    );
    if (!attempt?.assetHash || !attempt.grade) {
      throw new Error(`Visual candidate "${input.candidateId}" has no graded preview`);
    }
    if (!this.options.db.repos.assets.findByHash(attempt.assetHash)) {
      throw new Error(`Visual preview asset "${attempt.assetHash}" is missing`);
    }

    const currentPending =
      run.currentGate === WorkflowApprovalGateKey.VisualConstitution
        ? this.getPendingApprovalContext(run.id)
        : undefined;
    const currentContent = currentPending?.document.content as
      VisualConstitutionDocumentContent | undefined;
    if (
      currentPending &&
      currentContent?.selectedCandidateId === candidate.id &&
      currentContent.visualAuditions.revision === audition.revision &&
      currentContent.visualAuditions.contentHash === audition.contentHash
    ) {
      return { context: currentPending, created: false };
    }

    const latestConstitution = this.wf.getLatestDocument(
      run.id as WorkflowRunId,
      'visual-constitution',
    );
    const revision = (latestConstitution?.revision ?? 0) + 1;
    const createdAt = this.nextTimestamp();
    const content: VisualConstitutionDocumentContent = {
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
      },
      visualAuditions: { revision: audition.revision, contentHash: audition.contentHash },
      selectedCandidateId: candidate.id,
      selectedBy: 'user',
      selectedPreview: {
        assetHash: attempt.assetHash,
        providerId: attempt.providerId,
        ...(attempt.model ? { model: attempt.model } : {}),
        seed: attempt.reportedSeed ?? attempt.requestedSeed,
        prompt: attempt.prompt,
        promptHash: attempt.promptHash,
      },
      locked: cloneJson(candidate.constitution),
      candidates: cloneJson(auditionContent.candidates),
      budget: cloneJson(auditionContent.budget),
    };
    const document = this.createWorkflowDocument(
      run.id,
      'visual-constitution',
      'visual_constitution',
      revision,
      content,
      createdAt,
    );
    const resumeToken = this.nextId();
    const approval: WorkflowApproval = {
      id: this.nextId(),
      workflowRunId: run.id,
      gateKey: WorkflowApprovalGateKey.VisualConstitution,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: sha256(
        canonicalJson({
          productionPlan: content.productionPlan,
          visualAuditions: content.visualAuditions,
          selectedCandidateId: content.selectedCandidateId,
          selectedPreview: content.selectedPreview,
          budget: content.budget,
        }),
      ),
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createApprovalGateRevision({
      expectedRowVersion: input.expectedRowVersion,
      document,
      approval,
      event: {
        workflowRunId: run.id,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId: approval.id,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: document.contentHash,
          selectedCandidateId: candidate.id,
          auditionRevision: audition.revision,
          auditionHash: audition.contentHash,
        },
        timestamp: createdAt,
      },
    });
    const context = this.getPendingApprovalContext(run.id);
    if (!context) throw new Error('Visual Constitution approval gate was not persisted');
    return { context, created: true };
  }

  /**
   * Derives the exact final movie inputs from the persisted canvas and CAS
   * index. The caller can choose output settings, but can never supply media
   * paths, ordering, or asset hashes.
   */
  prepareFinalExportManifest(
    input: PrepareFinalExportManifestInput,
  ): PrepareFinalExportManifestResult {
    const run = this.requireFinalExportPreparationRun(input.workflowRunId, input.canvasId);
    if ((run.rowVersion ?? 0) !== input.expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${input.expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }

    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const visualConstitution = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.VisualConstitution,
    );
    const derivedAssembly = this.deriveFinalExportSegments(input.canvasId);
    this.requireAcceptedProductionMedia(
      run.id as WorkflowRunId,
      input.canvasId,
      productionPlan,
      visualConstitution,
    );
    const output = validateFinalExportOutput(
      input.output,
      buildFinalExportFileName(derivedAssembly.canvasName, input.output.codec),
    );
    const { segments, estimatedDurationSeconds } = derivedAssembly;
    const planBudget = asRecord(productionPlan.content.budget);
    const approvedAttempts = requireNonNegativeInteger(
      planBudget.maxAttemptsPerShot,
      'Production Plan budget.maxAttemptsPerShot',
    );
    const content: FinalExportManifestContent = {
      manifestVersion: 2,
      workflowRunId: run.id,
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
      },
      visualConstitution: {
        revision: visualConstitution.revision,
        contentHash: visualConstitution.contentHash,
      },
      canvasId: input.canvasId,
      assemblySnapshotHash: sha256(
        canonicalJson({ segments, audioTracks: [], subtitleTracks: [] }),
      ),
      segments,
      audioTracks: [],
      subtitleTracks: [],
      output,
      expectedDurationMs: Math.round(estimatedDurationSeconds * 1000),
      estimatedDurationSeconds,
      maxRenderAttempts: Math.max(1, Math.min(2, approvedAttempts || 1)),
      resolutionRisks: analyzeFinalExportResolutionRisks(segments, output),
      capabilities: {
        embeddedClipAudio: true,
        separateAudioMix: false,
        subtitles: false,
      },
    };
    const contentHash = sha256(canonicalJson(content));
    const latest = this.wf.getLatestDocument(run.id as WorkflowRunId, 'final-export');
    const latestApproval = this.wf.getLatestApproval(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.FinalExport,
    );
    if (
      latest?.contentHash === contentHash &&
      latestApproval &&
      (latestApproval.status === 'pending' || latestApproval.status === 'approved') &&
      latestApproval.subjectLogicalKey === latest.logicalKey &&
      latestApproval.subjectRevision === latest.revision &&
      latestApproval.subjectHash === latest.contentHash
    ) {
      const context = this.getFinalExportContext(run.id);
      if (!context) throw new Error('Final Export context could not be restored');
      return { context, created: false };
    }
    if (
      latest?.contentHash === contentHash &&
      latestApproval?.status === 'rejected' &&
      latestApproval.subjectLogicalKey === latest.logicalKey &&
      latestApproval.subjectRevision === latest.revision &&
      latestApproval.subjectHash === latest.contentHash
    ) {
      throw new Error('Revised Final Export manifest must differ from the rejected revision');
    }

    const createdAt = this.nextTimestamp();
    const document = this.createWorkflowDocument(
      run.id,
      'final-export',
      'final_export_manifest',
      (latest?.revision ?? 0) + 1,
      content,
      createdAt,
    );
    const resumeToken = this.nextId();
    const approval: WorkflowApproval = {
      id: this.nextId(),
      workflowRunId: run.id,
      gateKey: WorkflowApprovalGateKey.FinalExport,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: document.contentHash,
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createApprovalGateRevision({
      expectedRowVersion: input.expectedRowVersion,
      document,
      approval,
      event: {
        workflowRunId: run.id,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId: approval.id,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: document.contentHash,
          canvasId: input.canvasId,
          segmentCount: segments.length,
          output,
        },
        timestamp: createdAt,
      },
    });
    const context = this.getFinalExportContext(run.id);
    if (!context) throw new Error('Final Export approval gate was not persisted');
    return { context, created: true };
  }

  getFinalExportContext(workflowRunId: string): WorkflowFinalExportContext | undefined {
    const runId = this.runId(workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run) return undefined;
    const manifest = this.wf.getLatestDocument(runId, 'final-export');
    if (!manifest) return undefined;
    const approval = this.wf.getLatestApproval(runId, WorkflowApprovalGateKey.FinalExport);
    if (
      !approval ||
      approval.subjectLogicalKey !== manifest.logicalKey ||
      approval.subjectRevision !== manifest.revision ||
      approval.subjectHash !== manifest.contentHash
    ) {
      throw new Error(`Workflow "${workflowRunId}" Final Export approval is inconsistent`);
    }
    const execution = this.wf.getLatestExportExecution(runId);
    const matchingExecution =
      execution?.manifestRevision === manifest.revision &&
      execution.manifestHash === manifest.contentHash
        ? execution
        : undefined;
    const { resumeTokenHash: _hostOnlyResumeTokenHash, ...approvalView } = approval;
    return {
      run,
      manifest,
      approval: approvalView,
      ...(matchingExecution ? { execution: matchingExecution } : {}),
    };
  }

  /**
   * Host-side render authorization. Besides the exact approved revision/hash,
   * this re-derives the canvas segment projection so an approved stale canvas
   * can never be rendered accidentally.
   */
  requireApprovedFinalExportManifest(workflowRunId: string, canvasId: string): WorkflowDocument {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.entityId !== canvasId
    ) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    const manifest = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.FinalExport,
    );
    const content = manifest.content as FinalExportManifestContent;
    if (content.canvasId !== canvasId || !Array.isArray(content.segments)) {
      throw new Error('Approved Final Export manifest has an invalid canvas projection');
    }
    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const visualConstitution = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.VisualConstitution,
    );
    if (
      content.productionPlan?.revision !== productionPlan.revision ||
      content.productionPlan.contentHash !== productionPlan.contentHash ||
      content.visualConstitution?.revision !== visualConstitution.revision ||
      content.visualConstitution.contentHash !== visualConstitution.contentHash
    ) {
      throw new Error(
        'Approved Final Export manifest is not bound to the current approved documents',
      );
    }
    validateFinalExportOutput(content.output);
    const current = this.deriveFinalExportSegments(canvasId, content.manifestVersion === 2);
    if (canonicalJson(current.segments) !== canonicalJson(content.segments)) {
      throw new Error('Canvas media no longer matches the approved Final Export manifest');
    }
    this.requireAcceptedProductionMedia(
      run.id as WorkflowRunId,
      canvasId,
      productionPlan,
      visualConstitution,
    );
    return manifest;
  }

  getPendingApprovalContext(workflowRunId: string): WorkflowApprovalContext | undefined {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run?.currentGate) return undefined;
    const approval = this.wf.getPendingApproval(
      this.runId(workflowRunId) as WorkflowRunId,
      run.currentGate,
    );
    if (!approval) {
      throw new Error(`Workflow "${workflowRunId}" has a gate but no pending approval`);
    }
    const document = this.wf.getDocumentRevision(
      this.runId(workflowRunId) as WorkflowRunId,
      approval.subjectLogicalKey,
      approval.subjectRevision,
    );
    if (
      !document ||
      document.revision !== approval.subjectRevision ||
      document.contentHash !== approval.subjectHash
    ) {
      throw new Error(`Workflow "${workflowRunId}" approval subject is inconsistent`);
    }
    const { resumeTokenHash: _hostOnlyResumeTokenHash, ...approvalView } = approval;
    return { run, approval: approvalView, document };
  }

  approvePendingGateFromUser(input: UserApproveWorkflowGateInput): ApproveWorkflowGateResult {
    const pending = this.wf.getPendingApproval(
      this.runId(input.workflowRunId) as WorkflowRunId,
      input.gateKey,
    );
    const latest = pending
      ? undefined
      : this.wf.getLatestApproval(this.runId(input.workflowRunId) as WorkflowRunId, input.gateKey);
    const approval = pending ?? latest;
    if (!approval) {
      const run = this.wf.getRun(this.runId(input.workflowRunId) as WorkflowRunId);
      return run ? { ok: false, code: 'no_approval' } : { ok: false, code: 'run_not_found' };
    }

    const transition = this.resolveGateTransition(input.workflowRunId, input.gateKey);
    const completedProducerTaskRunId =
      input.gateKey === WorkflowApprovalGateKey.FinalExport
        ? undefined
        : this.wf
            .listTaskRuns(this.runId(input.workflowRunId) as WorkflowRunId)
            .rows.find((task) => task.taskId === producerTaskForGate(input.gateKey))?.id;
    if (input.gateKey !== WorkflowApprovalGateKey.FinalExport && !completedProducerTaskRunId) {
      throw new Error(`Workflow "${input.workflowRunId}" is missing its gate producer task`);
    }
    const result = this.wf.approveGate({
      workflowRunId: this.runId(input.workflowRunId) as WorkflowRunId,
      gateKey: input.gateKey,
      expectedRowVersion: input.expectedRowVersion,
      expectedSubjectRevision: input.expectedSubjectRevision,
      expectedSubjectHash: input.expectedSubjectHash,
      resumeTokenHash: approval.resumeTokenHash,
      eventId: this.nextId(),
      actor: 'user',
      correlationId: this.nextId(),
      approvedAt: this.nextTimestamp(),
      nextStageId: transition.stageRunId,
      nextTaskId: transition.taskRunId,
      ...(completedProducerTaskRunId ? { completedProducerTaskRunId } : {}),
    });
    if (result.ok) this.schedulePump(input.workflowRunId);
    return result;
  }

  requestChangesPendingGateFromUser(
    input: UserRequestWorkflowGateChangesInput,
  ): ReviseWorkflowGateResult {
    return this.revisePendingGateFromUser(input, 'request_changes');
  }

  rejectPendingGateFromUser(input: UserRejectWorkflowGateInput): ReviseWorkflowGateResult {
    return this.revisePendingGateFromUser(input, 'reject');
  }

  private revisePendingGateFromUser(
    input: UserRequestWorkflowGateChangesInput | UserRejectWorkflowGateInput,
    action: WorkflowGateRevisionAction,
  ): ReviseWorkflowGateResult {
    const reason = requireNonEmptyString(input.reason, 'revision reason');
    const runId = this.runId(input.workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run) return { ok: false, code: 'run_not_found' };

    const pending = this.wf.getPendingApproval(runId, input.gateKey);
    if (!pending) {
      const latest = this.wf.getLatestApproval(runId, input.gateKey);
      if (!latest) return { ok: false, code: 'no_approval' };
      if (latest.status !== 'pending') {
        return { ok: false, code: 'approval_not_pending', status: latest.status };
      }
      throw new Error('Pending workflow approval lookup is inconsistent');
    }
    const previousDocument = this.wf.getDocumentRevision(
      runId,
      pending.subjectLogicalKey,
      pending.subjectRevision,
    );
    if (!previousDocument || previousDocument.contentHash !== pending.subjectHash) {
      throw new Error('Pending workflow approval subject is inconsistent');
    }

    const producerLogicalTaskId = producerTaskForGate(input.gateKey);
    const producerTask = this.wf
      .listTaskRuns(runId)
      .rows.find((candidate) => candidate.taskId === producerLogicalTaskId);
    if (!producerTask) {
      throw new Error(
        `Workflow "${input.workflowRunId}" is missing revision producer task "${producerLogicalTaskId}"`,
      );
    }
    const revisedAt = this.nextTimestamp();

    return this.wf.reviseGate({
      workflowRunId: runId,
      gateKey: input.gateKey,
      action,
      reason,
      expectedRowVersion: input.expectedRowVersion,
      expectedSubjectRevision: input.expectedSubjectRevision,
      expectedSubjectHash: input.expectedSubjectHash,
      producerTaskRunId: producerTask.id,
      eventId: this.nextId(),
      actor: 'user',
      correlationId: this.nextId(),
      revisedAt,
    });
  }

  private resolveGateTransition(
    workflowRunId: string,
    gateKey: WorkflowApprovalGateKey,
  ): { stageRunId: string; taskRunId?: string } {
    const logicalStageId = nextStageForGate(gateKey);
    const stage = this.wf
      .listStageRuns(this.runId(workflowRunId) as WorkflowRunId)
      .rows.find((candidate) => candidate.stageId === logicalStageId);
    if (!stage) {
      throw new Error(
        `Workflow "${workflowRunId}" is missing the ${logicalStageId} stage run required by ${gateKey}`,
      );
    }
    const tasks = this.wf.listTaskRunsByStage(this.stageId(stage.id)).rows;
    const preferredTaskId = firstTaskForStage(logicalStageId);
    const task =
      tasks.find((candidate) => candidate.taskId === preferredTaskId) ??
      tasks.sort((left, right) => left.taskId.localeCompare(right.taskId))[0];
    return { stageRunId: stage.id, ...(task ? { taskRunId: task.id } : {}) };
  }

  private schedulePump(workflowRunId: string): void {
    const previous = this.autoPump;
    const scheduled = previous
      ? previous.catch(() => 0).then(() => this.pump(workflowRunId))
      : this.pump(workflowRunId);
    // The host may close the project before a fire-and-forget pump settles.
    // Keep the rejection observable through waitForAutoPump without emitting an
    // unhandled process rejection when no caller is waiting.
    void scheduled.catch(() => undefined);
    this.autoPump = scheduled;
  }

  async pause(workflowRunId: string): Promise<void> {
    this.wf.updateRun(this.runId(workflowRunId) as WorkflowRunId, {
      status: 'paused',
      updatedAt: this.nextTimestamp(),
    });
  }

  async resume(workflowRunId: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(workflowRunId);
    this.wf.updateRun(this.runId(workflowRunId) as WorkflowRunId, {
      status: 'ready',
      updatedAt: this.nextTimestamp(),
    });
    await this.refreshAvailability(workflowRunId);
  }

  async cancel(workflowRunId: string): Promise<void> {
    // Discard any in-flight autoPump before mutating state, so the pump loop
    // cannot race ahead and start new tasks after we mark everything cancelled.
    if (this.autoPump) {
      const pending = this.autoPump;
      this.autoPump = undefined;
      await pending.catch(() => {
        /* ignore — we are cancelling */
      });
    }

    const tasks = this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows;
    const stages = this.wf.listStageRuns(this.runId(workflowRunId) as WorkflowRunId).rows;

    for (const task of tasks) {
      if (TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.wf.updateTaskRun(this.taskId(task.id), {
        status: TaskRunStatus.Cancelled,
        completedAt: this.nextTimestamp(),
        updatedAt: this.nextTimestamp(),
      });
    }

    for (const stage of stages) {
      this.wf.recomputeStageAggregate(this.stageId(stage.id));
    }
    this.wf.recomputeWorkflowAggregate(this.runId(workflowRunId) as WorkflowRunId);
  }

  async retryTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    this.assertNotAwaitingHumanApproval(record.workflowRun.id);
    if (!TASK_TERMINAL_STATUSES.has(record.taskRun.status)) {
      return;
    }

    this.wf.updateTaskRun(this.taskId(taskRunId), {
      status: TaskRunStatus.Blocked,
      updatedAt: this.nextTimestamp(),
    });
    await this.refreshAvailability(record.workflowRun.id);
  }

  async retryStage(stageRunId: string): Promise<void> {
    const stageRun = this.wf.getStageRun(this.stageId(stageRunId));
    if (!stageRun) {
      throw new Error(`Workflow stage "${stageRunId}" not found`);
    }
    this.assertNotAwaitingHumanApproval(stageRun.workflowRunId);

    for (const task of this.wf.listTaskRunsByStage(this.stageId(stageRunId)).rows) {
      if (!TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.wf.updateTaskRun(this.taskId(task.id), {
        status: TaskRunStatus.Blocked,
        updatedAt: this.nextTimestamp(),
      });
    }

    await this.refreshAvailability(stageRun.workflowRunId);
  }

  async retryWorkflow(workflowRunId: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(workflowRunId);
    for (const task of this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows) {
      if (!TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.wf.updateTaskRun(this.taskId(task.id), {
        status: TaskRunStatus.Blocked,
        updatedAt: this.nextTimestamp(),
      });
    }

    await this.refreshAvailability(workflowRunId);
  }

  async pump(workflowRunId?: string): Promise<number> {
    let executed = 0;
    await this.refreshAvailability(workflowRunId);

    const MAX_PUMP_ITERATIONS = 1000;
    let iterations = 0;
    for (;;) {
      if (++iterations > MAX_PUMP_ITERATIONS) {
        throw new Error('pump: max iterations exceeded — possible runaway workflow');
      }
      if (workflowRunId) {
        const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
        if (run && (run.status === 'paused' || run.status === 'cancelled' || run.currentGate)) {
          return executed;
        }
      }
      const slots = this.maxConcurrentTasks - this.activeTasks;
      if (slots <= 0) return executed;
      const readyTasks = this.wf
        .listReadyTasks(this.runId(workflowRunId))
        .rows.filter((task) => task.input.executionMode !== 'external');
      if (readyTasks.length === 0) return executed;

      const batch = readyTasks.slice(0, slots);
      this.activeTasks += batch.length;
      const results = await Promise.allSettled(batch.map((task) => this.executeTask(task.id)));
      this.activeTasks -= batch.length;
      executed += results.length;
    }
  }

  /** Await the auto-pump started by the most recent `start()` call. */
  async waitForAutoPump(): Promise<void> {
    if (this.autoPump) {
      const pending = this.autoPump;
      this.autoPump = undefined;
      await pending;
    }
  }

  async recover(workflowRunId?: string): Promise<number> {
    const candidates = this.getRecoverableTasks(workflowRunId);
    let recovered = 0;

    for (const task of candidates) {
      await this.recoverTask(task.id);
      recovered += 1;
    }

    return recovered;
  }

  private async executeTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    const handler = this.resolveHandler(record.taskRun);
    const attempts = record.taskRun.attempts + 1;

    this.wf.updateTaskRun(this.taskId(taskRunId), {
      status: TaskRunStatus.Running,
      attempts,
      startedAt: record.taskRun.startedAt ?? this.nextTimestamp(),
      updatedAt: this.nextTimestamp(),
    });

    try {
      const runningRecord = this.getRecord(taskRunId);
      const result = await handler.execute({
        workflowRun: runningRecord.workflowRun,
        stageRun: runningRecord.stageRun,
        taskRun: runningRecord.taskRun,
        db: this.options.db,
      });

      this.applyTaskResult(runningRecord.taskRun, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.applyTaskResult(this.getRecord(taskRunId).taskRun, {
        status:
          attempts < record.taskRun.maxRetries
            ? TaskRunStatus.RetryableFailed
            : TaskRunStatus.Failed,
        error: message,
        progress: record.taskRun.progress,
      });
    }

    await this.refreshAvailability(record.workflowRun.id);
  }

  private async recoverTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    const handler = this.resolveHandler(record.taskRun);

    if (!handler.recover) {
      if (record.taskRun.status === TaskRunStatus.Running) {
        this.wf.updateTaskRun(this.taskId(taskRunId), {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        this.wf.recomputeStageAggregate(this.stageId(record.stageRun.id));
        this.wf.recomputeWorkflowAggregate(this.runId(record.workflowRun.id) as WorkflowRunId);
        await this.refreshAvailability(record.workflowRun.id);
      }
      return;
    }

    const result = await handler.recover({
      workflowRun: record.workflowRun,
      stageRun: record.stageRun,
      taskRun: record.taskRun,
      db: this.options.db,
    });

    if (!result) {
      if (record.taskRun.status === TaskRunStatus.Running) {
        this.wf.updateTaskRun(this.taskId(taskRunId), {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        this.wf.recomputeStageAggregate(this.stageId(record.stageRun.id));
        this.wf.recomputeWorkflowAggregate(this.runId(record.workflowRun.id) as WorkflowRunId);
        await this.refreshAvailability(record.workflowRun.id);
      }
      return;
    }

    this.applyTaskResult(record.taskRun, result);
    await this.refreshAvailability(record.workflowRun.id);
  }

  private applyTaskResult(taskRun: WorkflowTaskRun, result: WorkflowTaskExecutionResult): void {
    const status = result.status;
    const isTerminal = TASK_TERMINAL_STATUSES.has(status);

    this.wf.updateTaskRun(this.taskId(taskRun.id), {
      status,
      output: result.output ?? taskRun.output,
      error: result.error,
      progress: result.progress ?? (status === TaskRunStatus.Completed ? 100 : taskRun.progress),
      currentStep: result.currentStep,
      providerTaskId: result.providerTaskId ?? taskRun.providerTaskId,
      assetId: result.assetId ?? taskRun.assetId,
      completedAt: isTerminal ? this.nextTimestamp() : taskRun.completedAt,
      updatedAt: this.nextTimestamp(),
    });

    this.wf.recomputeStageAggregate(this.stageId(taskRun.stageRunId));
    this.wf.recomputeWorkflowAggregate(this.runId(taskRun.workflowRunId) as WorkflowRunId);
  }

  private async refreshAvailability(workflowRunId?: string): Promise<void> {
    const workflowIds = workflowRunId
      ? [workflowRunId]
      : this.wf.listRuns().rows.map((workflow) => workflow.id);

    for (const id of workflowIds) {
      const workflow = this.wf.getRun(this.runId(id) as WorkflowRunId);
      if (workflow?.currentGate) continue;
      const stages = this.wf.listStageRuns(this.runId(id) as WorkflowRunId).rows;
      const tasks = this.wf.listTaskRuns(this.runId(id) as WorkflowRunId).rows;
      const stageByRunId = new Map(stages.map((stage) => [stage.id, stage]));
      const stageByStageId = new Map(stages.map((stage) => [stage.stageId, stage]));
      const taskByRunId = new Map(tasks.map((task) => [task.id, task]));
      let changed = false;

      for (const task of [...tasks].sort(
        (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
      )) {
        if (task.status !== TaskRunStatus.Blocked && task.status !== TaskRunStatus.Pending) {
          continue;
        }

        const stage = stageByRunId.get(task.stageRunId);
        if (!stage) {
          continue;
        }

        if (!this.areStageDependenciesSatisfied(stage, stageByStageId)) {
          continue;
        }

        if (!this.areTaskDependenciesSatisfied(task, taskByRunId)) {
          continue;
        }

        this.wf.updateTaskRun(this.taskId(task.id), {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        task.status = TaskRunStatus.Ready;
        changed = true;
      }

      if (changed) {
        for (const stage of stages) {
          this.wf.recomputeStageAggregate(this.stageId(stage.id));
        }
        this.wf.recomputeWorkflowAggregate(this.runId(id) as WorkflowRunId);
      }
    }
  }

  private areStageDependenciesSatisfied(
    stageRun: WorkflowStageRun,
    stageByStageId: Map<string, WorkflowStageRun>,
  ): boolean {
    const dependsOnStageIds = this.readStringArray(stageRun.metadata?.dependsOnStageIds);
    return dependsOnStageIds.every((dependsOnStageId) => {
      const dependency = stageByStageId.get(dependsOnStageId);
      return (
        dependency !== undefined &&
        (dependency.status === 'completed' ||
          dependency.status === 'completed_with_errors' ||
          dependency.status === 'skipped')
      );
    });
  }

  private areTaskDependenciesSatisfied(
    taskRun: WorkflowTaskRun,
    taskByRunId: Map<string, WorkflowTaskRun>,
  ): boolean {
    return taskRun.dependencyIds.every((dependencyId) => {
      const dependency = taskByRunId.get(dependencyId);
      return dependency !== undefined && TASK_SUCCESS_STATUSES.has(dependency.status);
    });
  }

  private requireCurrentExternalTask(
    workflowRunId: string,
    taskRunId: string,
    expectedRowVersion: number,
    canvasId?: string,
  ): WorkflowTaskRun {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${workflowRunId}" is not a persistent video workflow`);
    }
    if (canvasId !== undefined && (run.entityType !== 'canvas' || run.entityId !== canvasId)) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if ((run.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }
    if (run.currentGate) throw new Error(`Workflow is awaiting ${run.currentGate} approval`);
    if (run.currentTaskId !== taskRunId) {
      throw new Error('Task completion must use the host-derived current task');
    }
    const task = this.wf.getTaskRun(this.taskId(taskRunId));
    if (!task || task.workflowRunId !== workflowRunId) {
      throw new Error(`Workflow task "${taskRunId}" not found`);
    }
    if (task.input.executionMode !== 'external') {
      throw new Error(`Workflow task "${taskRunId}" is not externally completed`);
    }
    if (task.status !== TaskRunStatus.Ready && task.status !== TaskRunStatus.Running) {
      throw new Error(`Workflow task cannot complete from status "${task.status}"`);
    }
    return task;
  }

  private async completeExternalTask(input: {
    workflowRunId: string;
    task: WorkflowTaskRun;
    expectedRowVersion: number;
    output: Record<string, unknown>;
  }): Promise<ExternalTaskCompletionResult> {
    const completedAt = this.nextTimestamp();
    const persisted = this.wf.completeExternalTask({
      workflowRunId: input.workflowRunId,
      taskRunId: input.task.id,
      expectedRunRowVersion: input.expectedRowVersion,
      output: cloneJson(input.output),
      completedAt,
      event: {
        workflowRunId: input.workflowRunId,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: { role: input.task.input.workflowTaskRole ?? null },
        timestamp: completedAt,
      },
    });
    await this.refreshAvailability(input.workflowRunId);
    const run = this.wf.getRun(this.runId(input.workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${input.workflowRunId}" disappeared after completion`);
    const nextTask = run.currentTaskId
      ? this.wf.getTaskRun(this.taskId(run.currentTaskId))
      : undefined;
    return {
      run,
      task: persisted.task,
      ...(nextTask ? { nextTask } : {}),
    };
  }

  private getRecord(taskRunId: string): WorkflowStateRecord {
    const taskRun = this.wf.getTaskRun(this.taskId(taskRunId));
    if (!taskRun) {
      throw new Error(`Workflow task "${taskRunId}" not found`);
    }

    const stageRun = this.wf.getStageRun(this.stageId(taskRun.stageRunId));
    if (!stageRun) {
      throw new Error(`Workflow stage "${taskRun.stageRunId}" not found`);
    }

    const workflowRun = this.wf.getRun(this.runId(taskRun.workflowRunId) as WorkflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run "${taskRun.workflowRunId}" not found`);
    }

    return { workflowRun, stageRun, taskRun };
  }

  private resolveHandler(taskRun: WorkflowTaskRun): WorkflowTaskHandler {
    const handlerId =
      typeof taskRun.input.handlerId === 'string' ? taskRun.input.handlerId : undefined;
    if (!handlerId) {
      throw new Error(`Workflow task "${taskRun.id}" is missing a handlerId`);
    }

    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Workflow handler "${handlerId}" is not registered`);
    }

    return handler;
  }

  private getRecoverableTasks(workflowRunId?: string): WorkflowTaskRun[] {
    const tasks = workflowRunId
      ? this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows
      : this.wf
          .listRuns()
          .rows.flatMap(
            (workflow) => this.wf.listTaskRuns(this.runId(workflow.id) as WorkflowRunId).rows,
          );

    return tasks
      .filter(
        (task) =>
          !this.wf.getRun(this.runId(task.workflowRunId) as WorkflowRunId)?.currentGate &&
          (task.status === TaskRunStatus.Running || task.status === TaskRunStatus.AwaitingProvider),
      )
      .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id));
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private getProductionStageKey(run: WorkflowRun): string | undefined {
    if (!run.currentStageId) return undefined;
    const stageRun = this.wf.getStageRun(this.stageId(run.currentStageId));
    if (!stageRun || stageRun.workflowRunId !== run.id) {
      throw new Error(
        `Workflow "${run.id}" currentStageId does not reference one of its persisted stage runs`,
      );
    }
    return stageRun.stageId;
  }

  private requireFinalExportPreparationRun(workflowRunId: string, canvasId: string): WorkflowRun {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${workflowRunId}" is not a persistent video workflow`);
    }
    if (run.entityType !== 'canvas' || run.entityId !== canvasId) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (run.currentGate && run.currentGate !== WorkflowApprovalGateKey.FinalExport) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    const currentStage = this.getProductionStageKey(run);
    const currentTask = run.currentTaskId
      ? this.wf.getTaskRun(this.taskId(run.currentTaskId))
      : undefined;
    if (
      currentStage !== 'final-export' ||
      currentTask?.input.workflowTaskRole !== 'final_export' ||
      (currentTask.status !== TaskRunStatus.Ready && currentTask.status !== TaskRunStatus.Running)
    ) {
      throw new Error(
        `Workflow "${workflowRunId}" cannot prepare Final Export from stage ${currentStage ?? 'none'}`,
      );
    }
    return run;
  }

  private deriveFinalExportSegments(
    canvasId: string,
    includeSourceDimensions = true,
  ): {
    segments: FinalExportManifestSegment[];
    estimatedDurationSeconds: number;
    canvasName: string;
  } {
    const canvas = this.options.db.repos.canvases.get(canvasId as never);
    if (!canvas) throw new Error(`Canvas "${canvasId}" not found`);

    const unsupportedAudioNodes = canvas.nodes.filter(
      (node) => node.type === 'audio' && !node.bypassed,
    );
    if (unsupportedAudioNodes.length > 0) {
      throw new Error(
        'Final movie rendering does not yet support separate audio nodes; mix or embed audio before requesting Final Export approval',
      );
    }

    const videoNodes = canvas.nodes
      .filter((node) => node.type === 'video' && !node.bypassed)
      .sort(
        (left, right) =>
          left.position.x - right.position.x ||
          left.position.y - right.position.y ||
          left.id.localeCompare(right.id),
      );
    if (videoNodes.length === 0) {
      throw new Error('Final Export requires at least one non-bypassed video node');
    }

    const segments = videoNodes.map((node, order): FinalExportManifestSegment => {
      const data = asRecord(node.data);
      const variants = Array.isArray(data.variants)
        ? data.variants.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const selectedVariantIndex =
        typeof data.selectedVariantIndex === 'number' &&
        Number.isInteger(data.selectedVariantIndex) &&
        data.selectedVariantIndex >= 0
          ? data.selectedVariantIndex
          : 0;
      const assetHash =
        variants[selectedVariantIndex] ??
        (typeof data.assetHash === 'string' && data.assetHash.trim() ? data.assetHash : undefined);
      if (!assetHash) {
        throw new Error(`Video node "${node.id}" has no selected rendered variant`);
      }
      const asset = this.options.db.repos.assets.findByHash(assetHash);
      if (!asset || asset.type !== 'video') {
        throw new Error(`Selected video asset "${assetHash}" is missing from the CAS index`);
      }
      if (
        typeof data.durationOverride === 'number' &&
        typeof asset.duration === 'number' &&
        Math.abs(data.durationOverride - asset.duration) > 1e-6
      ) {
        throw new Error(
          `Video node "${node.id}" requests a duration trim, but Final Export currently supports full selected clips only`,
        );
      }
      const durationCandidate =
        typeof asset.duration === 'number'
          ? asset.duration
          : typeof data.duration === 'number'
            ? data.duration
            : undefined;
      const durationSeconds = requirePositiveFiniteNumber(
        durationCandidate,
        `Video node "${node.id}" duration`,
      );
      const sourceWidth = includeSourceDimensions
        ? requirePositiveInteger(asset.width, `Video asset "${assetHash}" width`)
        : undefined;
      const sourceHeight = includeSourceDimensions
        ? requirePositiveInteger(asset.height, `Video asset "${assetHash}" height`)
        : undefined;
      return {
        order,
        nodeId: node.id,
        nodeUpdatedAt: node.updatedAt,
        title: node.title,
        assetHash,
        assetFormat: asset.format,
        selectedVariantIndex,
        trimInMs: 0,
        trimOutMs: Math.round(durationSeconds * 1000),
        sourceDurationMs: Math.round(durationSeconds * 1000),
        sourceStartSeconds: 0,
        durationSeconds,
        speed: 1,
        ...(sourceWidth !== undefined && sourceHeight !== undefined
          ? { sourceWidth, sourceHeight }
          : {}),
      };
    });

    return {
      segments,
      canvasName: canvas.name,
      estimatedDurationSeconds: Number(
        segments
          .reduce((sum, segment) => sum + segment.durationSeconds / segment.speed, 0)
          .toFixed(6),
      ),
    };
  }

  private requireAcceptedProductionMedia(
    workflowRunId: WorkflowRunId,
    canvasId: string,
    productionPlan: WorkflowDocument,
    visualConstitution: WorkflowDocument,
  ): void {
    const canvas = this.options.db.repos.canvases.get(canvasId as never);
    if (!canvas) throw new Error(`Canvas "${canvasId}" not found`);
    const attempts = this.wf.listMediaAttempts(workflowRunId);
    const evaluations = new Map(
      this.wf
        .listMediaEvaluations(workflowRunId)
        .map((evaluation) => [evaluation.attemptId, evaluation]),
    );
    const productionNodes = canvas.nodes.filter(
      (node) => !node.bypassed && (node.type === 'image' || node.type === 'video'),
    );
    for (const node of productionNodes) {
      const data = asRecord(node.data);
      const variants = Array.isArray(data.variants)
        ? data.variants.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const selectedVariantIndex =
        typeof data.selectedVariantIndex === 'number' &&
        Number.isInteger(data.selectedVariantIndex) &&
        data.selectedVariantIndex >= 0
          ? data.selectedVariantIndex
          : 0;
      const selectedAssetHash =
        variants[selectedVariantIndex] ??
        (typeof data.assetHash === 'string' && data.assetHash.trim() ? data.assetHash : undefined);
      if (!selectedAssetHash) {
        throw new Error(`Production node "${node.id}" has no selected graded asset`);
      }
      const accepted = attempts.find(
        (attempt) =>
          attempt.nodeId === node.id &&
          attempt.status === 'accepted' &&
          attempt.assetHash === selectedAssetHash &&
          attempt.generationSpec.nodeUpdatedAt === node.updatedAt &&
          attempt.generationSpec.productionPlan.revision === productionPlan.revision &&
          attempt.generationSpec.productionPlan.contentHash === productionPlan.contentHash &&
          attempt.generationSpec.visualConstitution.revision === visualConstitution.revision &&
          attempt.generationSpec.visualConstitution.contentHash === visualConstitution.contentHash,
      );
      const evaluation = accepted ? evaluations.get(accepted.id) : undefined;
      if (
        !accepted ||
        !evaluation ||
        evaluation.verdict !== 'pass' ||
        evaluation.assetHash !== selectedAssetHash
      ) {
        throw new Error(
          `Production node "${node.id}" must pass persistent media evaluation before Final Export`,
        );
      }
    }
  }

  private requireStyleExplorationRun(workflowRunId: string, canvasId?: string): WorkflowRun {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${workflowRunId}" is not a persistent video workflow`);
    }
    if (canvasId !== undefined && (run.entityType !== 'canvas' || run.entityId !== canvasId)) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    const currentStage = this.getProductionStageKey(run);
    if (run.status !== WorkflowRunStatus.Ready || currentStage !== 'style-exploration') {
      throw new Error(
        `Workflow "${workflowRunId}" is not ready for style exploration (status=${run.status}, stage=${currentStage ?? 'none'})`,
      );
    }
    return run;
  }

  private requireExactApprovedDocument(
    workflowRunId: WorkflowRunId,
    gateKey: WorkflowApprovalGateKey,
  ): WorkflowDocument {
    const approval = this.wf.getLatestApproval(workflowRunId, gateKey);
    if (!approval || approval.status !== 'approved') {
      throw new Error(`Exact ${gateKey} approval is required`);
    }
    const document = this.wf.getDocumentRevision(
      workflowRunId,
      approval.subjectLogicalKey,
      approval.subjectRevision,
    );
    if (!document || document.contentHash !== approval.subjectHash) {
      throw new Error(`Approved ${gateKey} subject revision/hash is inconsistent`);
    }
    return document;
  }

  private createWorkflowDocument(
    workflowRunId: string,
    logicalKey: string,
    documentType: string,
    revision: number,
    content: Record<string, unknown>,
    createdAt: number,
  ): WorkflowDocument {
    return {
      id: this.nextId(),
      workflowRunId,
      logicalKey,
      documentType,
      revision,
      schemaVersion: 1,
      content,
      contentHash: sha256(canonicalJson(content)),
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
  }

  private nextTimestamp(): number {
    return this.now() + this.tick++;
  }

  private nextId(): string {
    return this.idFactory ? this.idFactory() : randomUUID();
  }

  private assertNotAwaitingHumanApproval(workflowRunId: string): void {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (run?.currentGate) {
      throw new Error(
        `Workflow "${workflowRunId}" requires human approval at ${run.currentGate}; resume and retry cannot bypass approval gates`,
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readCommanderContinuation(
  metadata: Record<string, unknown>,
): WorkflowCommanderContinuationConfig | undefined {
  const value = asRecord(metadata.commanderContinuation);
  const provider = asRecord(value.provider);
  const permissionMode = value.permissionMode;
  if (
    value.version !== 1 ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId.trim() ||
    !['danger', 'auto', 'normal', 'strict'].includes(String(permissionMode)) ||
    ['id', 'name', 'baseUrl', 'model', 'protocol', 'authStyle'].some(
      (key) => typeof provider[key] !== 'string' || !(provider[key] as string).trim(),
    )
  ) {
    return undefined;
  }
  return cloneJson(value) as unknown as WorkflowCommanderContinuationConfig;
}

function isWorkflowRunStatus(value: unknown): value is WorkflowRun['status'] {
  return (
    typeof value === 'string' && (Object.values(WorkflowRunStatus) as string[]).includes(value)
  );
}

function safeRecoveredRunStatus(status: WorkflowRun['status']): WorkflowRun['status'] {
  switch (status) {
    case WorkflowRunStatus.Queued:
    case WorkflowRunStatus.Preparing:
    case WorkflowRunStatus.Running:
      return WorkflowRunStatus.Ready;
    default:
      return status;
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function requirePositiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function validateFinalExportOutput(
  value: PrepareFinalExportManifestInput['output'] | FinalExportOutputSettings,
  derivedLogicalFileName?: string,
): FinalExportOutputSettings {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Final Export output settings are required');
  }
  const codec = value.codec;
  if (codec !== 'h264' && codec !== 'h265' && codec !== 'prores') {
    throw new TypeError('Final Export codec must be h264, h265, or prores');
  }
  const quality = value.quality;
  if (quality !== 'draft' && quality !== 'standard' && quality !== 'high') {
    throw new TypeError('Final Export quality must be draft, standard, or high');
  }
  const width = requirePositiveInteger(value.width, 'Final Export width');
  const height = requirePositiveInteger(value.height, 'Final Export height');
  if (width > 7680 || height > 7680 || width % 2 !== 0 || height % 2 !== 0) {
    throw new TypeError('Final Export dimensions must be even integers no larger than 7680');
  }
  const fps = requirePositiveInteger(value.fps, 'Final Export fps');
  if (fps < 12 || fps > 120) {
    throw new TypeError('Final Export fps must be between 12 and 120');
  }
  const container = codec === 'prores' ? 'mov' : 'mp4';
  if ('container' in value && value.container !== container) {
    throw new TypeError(`Final Export codec ${codec} requires the ${container} container`);
  }
  const logicalFileName =
    'logicalFileName' in value ? value.logicalFileName : derivedLogicalFileName;
  if (
    typeof logicalFileName !== 'string' ||
    logicalFileName.length === 0 ||
    logicalFileName.length > 180 ||
    /[\\/]/.test(logicalFileName) ||
    hasAsciiControlCharacter(logicalFileName) ||
    !logicalFileName.toLowerCase().endsWith(`.${container}`)
  ) {
    throw new TypeError(`Final Export logicalFileName must be a safe .${container} basename`);
  }
  const audioCodec = codec === 'prores' ? 'pcm_s24le' : 'aac';
  const pixelFormat = codec === 'prores' ? 'yuva444p10le' : 'yuv420p';
  if ('audioCodec' in value && value.audioCodec !== audioCodec) {
    throw new TypeError(`Final Export codec ${codec} requires audio codec ${audioCodec}`);
  }
  if ('pixelFormat' in value && value.pixelFormat !== pixelFormat) {
    throw new TypeError(`Final Export codec ${codec} requires pixel format ${pixelFormat}`);
  }
  if ('overwritePolicy' in value && value.overwritePolicy !== 'fail') {
    throw new TypeError('Final Export overwrite policy must be fail');
  }
  const fitMode = value.fitMode ?? 'contain';
  if (fitMode !== 'contain' && fitMode !== 'cover' && fitMode !== 'stretch') {
    throw new TypeError('Final Export fitMode must be contain, cover, or stretch');
  }
  const backgroundColor = value.backgroundColor ?? '#000000';
  if (!/^#[0-9a-f]{6}$/i.test(backgroundColor)) {
    throw new TypeError('Final Export backgroundColor must be a six-digit hex color');
  }
  return {
    container,
    codec,
    quality,
    width,
    height,
    fps,
    logicalFileName,
    audioCodec,
    pixelFormat,
    overwritePolicy: 'fail',
    fitMode,
    backgroundColor: backgroundColor.toUpperCase(),
  };
}

function analyzeFinalExportResolutionRisks(
  segments: FinalExportManifestSegment[],
  output: FinalExportOutputSettings,
): FinalExportResolutionRisk[] {
  const risks: FinalExportResolutionRisk[] = [];
  const fitMode = output.fitMode ?? 'contain';
  const outputAspect = output.width / output.height;
  for (const segment of segments) {
    if (!segment.sourceWidth || !segment.sourceHeight) continue;
    const source = { width: segment.sourceWidth, height: segment.sourceHeight };
    const target = { width: output.width, height: output.height };
    const sourceAspect = source.width / source.height;
    const aspectMismatch = Math.abs(sourceAspect - outputAspect) / outputAspect > 0.01;
    if (aspectMismatch) {
      const code =
        fitMode === 'contain'
          ? 'aspect_padding'
          : fitMode === 'cover'
            ? 'aspect_crop'
            : 'aspect_distortion';
      risks.push({
        code,
        severity: fitMode === 'stretch' ? 'warning' : 'info',
        nodeId: segment.nodeId,
        message:
          fitMode === 'contain'
            ? 'Source aspect ratio will be padded to preserve composition'
            : fitMode === 'cover'
              ? 'Source aspect ratio will be cropped to fill the output frame'
              : 'Source aspect ratio will be stretched to the output frame',
        source,
        output: target,
      });
    }
    const scale =
      fitMode === 'cover'
        ? Math.max(output.width / source.width, output.height / source.height)
        : fitMode === 'contain'
          ? Math.min(output.width / source.width, output.height / source.height)
          : Math.max(output.width / source.width, output.height / source.height);
    if (scale > 1.001) {
      risks.push({
        code: 'upscale',
        severity: 'warning',
        nodeId: segment.nodeId,
        message: `Source will be upscaled ${scale.toFixed(2)}×`,
        source,
        output: target,
      });
    }
  }
  return risks;
}

function buildFinalExportFileName(
  canvasName: string,
  codec: FinalExportOutputSettings['codec'],
): string {
  const container = codec === 'prores' ? 'mov' : 'mp4';
  const base = canvasName
    .normalize('NFKC')
    .split('')
    .map((character) =>
      hasAsciiControlCharacter(character) || /[\\/:*?"<>|]/.test(character) ? '-' : character,
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  return `${base || 'lucid-final'}.${container}`;
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f);
}

function requireScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new TypeError(`${label} must be a finite score from 0 to 100`);
  }
  return value;
}

function requireStringList(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function validateVisualCandidateProposals(candidates: VisualDirectionCandidateProposal[]): void {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 4) {
    throw new TypeError('Visual audition requires between 2 and 4 candidates');
  }
  const ids = new Set<string>();
  const grammarStringKeys: Array<keyof VisualDirectionCandidateProposal['constitution']> = [
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
  ];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object') {
      throw new TypeError(`candidates[${index}] must be an object`);
    }
    const id = requireNonEmptyString(candidate.id, `candidates[${index}].id`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new TypeError(`candidates[${index}].id must use 1-64 letters, digits, _ or -`);
    }
    if (ids.has(id)) throw new TypeError(`Duplicate visual candidate id: ${id}`);
    ids.add(id);
    requireNonEmptyString(candidate.name, `candidates[${index}].name`);
    requireNonEmptyString(candidate.summary, `candidates[${index}].summary`);
    requireNonEmptyString(candidate.prompt, `candidates[${index}].prompt`);
    if (candidate.negativePrompt !== undefined) {
      requireNonEmptyString(candidate.negativePrompt, `candidates[${index}].negativePrompt`);
    }
    if (!Number.isInteger(candidate.seed) || candidate.seed < 0 || candidate.seed > 0xffff_ffff) {
      throw new TypeError(`candidates[${index}].seed must be a uint32 integer`);
    }
    if (!candidate.constitution || typeof candidate.constitution !== 'object') {
      throw new TypeError(`candidates[${index}].constitution is required`);
    }
    for (const key of grammarStringKeys) {
      requireNonEmptyString(
        candidate.constitution[key],
        `candidates[${index}].constitution.${key}`,
      );
    }
    requireStringList(
      candidate.constitution.characterAnchors,
      `candidates[${index}].constitution.characterAnchors`,
    );
    requireStringList(
      candidate.constitution.locationAnchors,
      `candidates[${index}].constitution.locationAnchors`,
    );
    requireStringList(
      candidate.constitution.negativeConstraints,
      `candidates[${index}].constitution.negativeConstraints`,
    );
  }
}

function proposalProjection(candidate: VisualAuditionCandidate): VisualDirectionCandidateProposal {
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

function validateVisualAuditionSnapshot(
  content: VisualAuditionDocumentContent,
  previous: VisualAuditionDocumentContent,
  assetExists: (assetHash: string) => boolean,
): void {
  if (!content || typeof content !== 'object') {
    throw new TypeError('Visual audition snapshot must be an object');
  }
  for (const key of ['requestHash', 'rubricVersion', 'providerId'] as const) {
    if (content[key] !== previous[key]) {
      throw new Error(`Visual audition immutable field changed: ${key}`);
    }
  }
  if (
    content.width !== previous.width ||
    content.height !== previous.height ||
    canonicalJson(content.productionPlan) !== canonicalJson(previous.productionPlan)
  ) {
    throw new Error('Visual audition immutable plan or dimensions changed');
  }
  validateVisualCandidateProposals(content.candidates.map(proposalProjection));
  if (
    canonicalJson(content.candidates.map(proposalProjection)) !==
    canonicalJson(previous.candidates.map(proposalProjection))
  ) {
    throw new Error('Visual audition candidate proposals are immutable');
  }
  if (
    content.budget.approvedStyleAuditionCostUsd !== previous.budget.approvedStyleAuditionCostUsd ||
    content.budget.maxRegenerations !== previous.budget.maxRegenerations ||
    content.budget.maxAttemptsPerCandidate !== previous.budget.maxAttemptsPerCandidate
  ) {
    throw new Error('Visual audition approved budget bounds are immutable');
  }

  const approved = requireNonNegativeNumber(
    content.budget.approvedStyleAuditionCostUsd,
    'visual audition approved budget',
  );
  const estimated = requireNonNegativeNumber(
    content.budget.estimatedCommittedUsd,
    'visual audition estimated committed cost',
  );
  if (estimated > approved + 1e-9) {
    throw new Error(
      `Visual audition estimated cost ${estimated} exceeds approved budget ${approved}`,
    );
  }
  if (content.budget.reportedActualUsd !== undefined) {
    requireNonNegativeNumber(content.budget.reportedActualUsd, 'visual audition reported cost');
  }
  requireStringList(content.budget.unpricedOperations, 'visual audition unpricedOperations');

  let computedEstimated = 0;
  let computedReported = 0;
  let hasUnreported = false;
  let regenerationCount = 0;
  for (const candidate of content.candidates) {
    if (candidate.attempts.length > content.budget.maxAttemptsPerCandidate) {
      throw new Error(`Visual candidate "${candidate.id}" exceeded its approved attempt bound`);
    }
    const attemptNumbers = candidate.attempts.map((attempt) => attempt.attempt);
    regenerationCount += Math.max(0, candidate.attempts.length - 1);
    if (attemptNumbers.some((attempt, index) => attempt !== index + 1)) {
      throw new Error(`Visual candidate "${candidate.id}" attempts must be contiguous from 1`);
    }
    for (const attempt of candidate.attempts) {
      requireNonEmptyString(attempt.prompt, `${candidate.id} attempt prompt`);
      if (attempt.promptHash !== sha256(attempt.prompt)) {
        throw new Error(`Visual candidate "${candidate.id}" attempt prompt hash is invalid`);
      }
      if (attempt.providerId !== content.providerId) {
        throw new Error(`Visual candidate "${candidate.id}" changed provider`);
      }
      requirePositiveInteger(attempt.width, `${candidate.id} attempt width`);
      requirePositiveInteger(attempt.height, `${candidate.id} attempt height`);
      computedEstimated += requireNonNegativeNumber(
        attempt.estimatedCostUsd,
        `${candidate.id} estimated cost`,
      );
      if (attempt.reportedActualCostUsd === undefined) {
        hasUnreported = true;
      } else {
        computedReported += requireNonNegativeNumber(
          attempt.reportedActualCostUsd,
          `${candidate.id} reported cost`,
        );
      }
      if (attempt.status === 'completed') {
        if (!attempt.assetHash || !assetExists(attempt.assetHash)) {
          throw new Error(`Visual candidate "${candidate.id}" completed asset is missing`);
        }
        if (!attempt.grade) {
          throw new Error(`Visual candidate "${candidate.id}" completed attempt has no grade`);
        }
        for (const key of [
          'promptAdherence',
          'styleClarity',
          'storyFit',
          'lighting',
          'composition',
          'continuityPotential',
          'total',
        ] as const) {
          requireScore(attempt.grade[key], `${candidate.id} grade.${key}`);
        }
        if (attempt.grade.rubricVersion !== content.rubricVersion) {
          throw new Error(`Visual candidate "${candidate.id}" grade rubric is stale`);
        }
        requireStringList(attempt.grade.strengths, `${candidate.id} grade strengths`);
        requireStringList(attempt.grade.risks, `${candidate.id} grade risks`);
        requireNonEmptyString(attempt.grade.evidence, `${candidate.id} grade evidence`);
        requireNonEmptyString(
          attempt.grade.visionProviderId,
          `${candidate.id} grade vision provider`,
        );
      } else if (!attempt.error) {
        throw new Error(`Visual candidate "${candidate.id}" failed attempt has no error evidence`);
      }
    }
    if (candidate.status === 'completed') {
      const selected = candidate.attempts.find(
        (attempt) =>
          attempt.attempt === candidate.selectedAttempt && attempt.status === 'completed',
      );
      if (!selected) {
        throw new Error(`Visual candidate "${candidate.id}" has no selected completed attempt`);
      }
    }
  }
  if (regenerationCount > content.budget.maxRegenerations) {
    throw new Error('Visual audition exceeded the approved total regeneration bound');
  }
  if (Math.abs(computedEstimated - estimated) > 1e-6) {
    throw new Error('Visual audition estimated cost total does not match its attempts');
  }
  if (
    content.budget.reportedActualUsd !== undefined &&
    Math.abs(computedReported - content.budget.reportedActualUsd) > 1e-6
  ) {
    throw new Error('Visual audition reported cost total does not match its attempts');
  }
  if (content.budget.hasUnreportedActualCosts !== hasUnreported) {
    throw new Error('Visual audition unreported-cost marker does not match its attempts');
  }
  if (content.status === 'complete') {
    if (!content.candidates.every((candidate) => candidate.status === 'completed')) {
      throw new Error('A complete visual audition must have only completed candidates');
    }
    if (
      !content.recommendedCandidateId ||
      !content.candidates.some((candidate) => candidate.id === content.recommendedCandidateId)
    ) {
      throw new Error('A complete visual audition requires a valid recommendation');
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Workflow documents must be JSON-serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nextStageForGate(gateKey: WorkflowApprovalGateKey): string {
  switch (gateKey) {
    case WorkflowApprovalGateKey.ProductionPlan:
      return 'style-exploration';
    case WorkflowApprovalGateKey.VisualConstitution:
      return 'preproduction';
    case WorkflowApprovalGateKey.FinalExport:
      return 'final-export';
  }
}

function producerTaskForGate(gateKey: WorkflowApprovalGateKey): string {
  switch (gateKey) {
    case WorkflowApprovalGateKey.ProductionPlan:
      return 'production-plan';
    case WorkflowApprovalGateKey.VisualConstitution:
      return 'style-audition';
    case WorkflowApprovalGateKey.FinalExport:
      return 'final-export';
  }
}

function firstTaskForStage(stageId: string): string {
  switch (stageId) {
    case 'style-exploration':
      return 'style-audition';
    case 'preproduction':
      return 'script';
    case 'final-export':
      return 'final-export';
    default:
      return stageId;
  }
}
