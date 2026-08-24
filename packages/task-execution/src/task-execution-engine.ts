import { createHash, randomUUID } from 'node:crypto';
import {
  getCommanderSessionId,
  isTaskListTerminalStatus,
  TaskListStatus,
  TaskStatus,
  PlanApprovalGateKey,
  type ApprovePlanGateResult,
  type AnswerTaskDecisionResult,
  type ContextRecoveryReport,
  type ContextRecoveryReportResult,
  type RevisePlanGateResult,
  type PlanGateRevisionAction,
  type DeliveryManifestContent,
  type DeliveryManifestItem,
  type PrepareDeliveryManifestInput,
  type PrepareDeliveryManifestResult,
  type ReserveTaskDecisionResult,
  type UserApprovePlanGateInput,
  type UserRejectPlanGateInput,
  type UserRequestPlanGateChangesInput,
  type SelectVisualConstitutionCandidateInput,
  type RequestVisualAuditionChangesInput,
  type RequestVisualAuditionChangesResult,
  type VisualAuditionCandidate,
  type VisualAuditionDocumentContent,
  type VisualConstitutionSelectionResult as ContractVisualConstitutionSelectionResult,
  type VisualConstitutionDocumentContent,
  type VisualDirectionCandidateProposal,
  type PlanApproval,
  type PlanApprovalContext,
  type PlanDocument,
  type TaskDecision,
  type TaskDecisionFilter,
  type TaskDecisionOption,
  type TaskEvent,
  type DeliveryManifestContext,
  type ProductionMediaTaskAttempt,
  type TaskList,
  type TaskListId,
  type TaskListSummary,
  type VisualAuditionContext,
  type TaskId,
  type Task,
  type LLMProviderRuntimeConfig,
  type CommanderProcessBehaviorSettings,
  type RunResourceBudget,
  type AssetMeta,
} from '@lucid-fin/contracts';
import type { IStorageLayer, TaskListLease, TaskListRepository } from '@lucid-fin/storage';
import type { TaskExecutionResult, TaskHandler } from './task-handler.js';
import { TaskListPlanner } from './task-list-planner.js';
import type { TaskListRegistry } from './task-list-registry.js';
import { createMovieProductionTaskListGraph } from './task-lists/movie.production.v2.js';

export interface TaskListStartRequest {
  taskListType: string;
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
  commanderContinuation: TaskListCommanderContinuationConfig;
}

export interface TaskListCommanderContinuationConfig {
  version: 1;
  sessionId: string;
  provider: LLMProviderRuntimeConfig;
  permissionMode: 'danger' | 'auto' | 'normal' | 'strict';
  locale?: string;
  resourceBudget?: RunResourceBudget;
  lastRunId?: string;
  temperature?: number;
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  defaultProviders?: Record<string, string>;
  processSettings?: CommanderProcessBehaviorSettings;
  claim?: TaskListCommanderContinuationClaim;
}

export interface TaskListCommanderContinuationClaim {
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
      taskList: TaskList;
      task: Task;
      continuation: TaskListCommanderContinuationConfig;
    }
  | {
      ok: false;
      code:
        | 'task_list_not_found'
        | 'binding_missing'
        | 'task_list_not_ready'
        | 'task_not_ready'
        | 'already_claimed'
        | 'stale_row_version';
      actualRowVersion?: number;
    };

export interface ProductionPlanCreateResult {
  taskListId: string;
  gate: 'production_plan';
  status: 'awaiting_approval';
  revision: number;
  contentHash: string;
}

export interface ProductionPlanRevisionRequest {
  canvasId: string;
  taskListId: string;
  expectedRowVersion: number;
  plan: Record<string, unknown>;
}

export interface ContextCheckpointCreateResult {
  taskListId: string;
  revision: number;
  contentHash: string;
}

export interface ProductionMediaTaskContext {
  taskList: TaskList;
  task: Task;
  productionPlan: PlanDocument;
  visualConstitution: PlanDocument;
}

export interface CreativeTaskCompletionRequest {
  canvasId: string;
  taskListId: string;
  taskId: string;
  expectedRowVersion: number;
  summary: string;
  evidence?: string[];
  data?: Record<string, unknown>;
}

export interface ProductionMediaTaskCompletionRequest {
  canvasId: string;
  taskListId: string;
  taskId: string;
  expectedRowVersion: number;
  nodeId: string;
  attemptId: string;
}

export interface ProductionMediaFeedbackReservationRequest {
  taskListId: string;
  canvasId: string;
  taskId: string;
  attemptId: string;
  expectedRowVersion: number;
  feedback: string;
  basePromptHash: string;
  attempt: ProductionMediaTaskAttempt;
}

export interface ExternalTaskCompletionResult {
  taskList: TaskList;
  task: Task;
  nextTask?: Task;
}

export interface VisualAuditionStartRequest {
  canvasId: string;
  taskListId: string;
  providerId: string;
  width: number;
  height: number;
  candidates: VisualDirectionCandidateProposal[];
}

export interface VisualAuditionStartResult {
  document: PlanDocument;
  resumed: boolean;
}

export interface VisualAuditionSnapshotRequest {
  taskListId: string;
  expectedRevision: number;
  content: VisualAuditionDocumentContent;
}

export type VisualConstitutionSelectionResult = ContractVisualConstitutionSelectionResult;

export type DeliveryManifestResult = PrepareDeliveryManifestResult;

export interface TaskDecisionReservationRequest {
  taskListId: string;
  taskId: string;
  canvasId: string;
  questionId: string;
  decisionKey: string;
  subjectRevision: number;
  expectedTaskListRowVersion: number;
  question: string;
  options: TaskDecisionOption[];
  allowFreeText: boolean;
}

export interface TaskDecisionAnswer {
  canvasId: string;
  questionId: string;
  answer: string;
  status: 'answered' | 'recovery_required';
}

export interface TaskExecutionEngineOptions {
  db: IStorageLayer;
  registry: TaskListRegistry;
  handlers: TaskHandler[];
  planner?: TaskListPlanner;
  idFactory?: () => string;
  now?: () => number;
  maxConcurrentTasks?: number;
}

type TaskExecutionStateRecord = {
  taskList: TaskList;
  task: Task;
};

const TASK_SUCCESS_STATUSES = new Set<Task['status']>([TaskStatus.Completed, TaskStatus.Skipped]);

const TASK_TERMINAL_STATUSES = new Set<Task['status']>([
  TaskStatus.Completed,
  TaskStatus.Skipped,
  TaskStatus.Failed,
  TaskStatus.RetryableFailed,
  TaskStatus.Cancelled,
]);

const TASK_LIST_LEASE_TTL_MS = 30_000;
const TASK_LIST_HEARTBEAT_MS = 10_000;

export const VISUAL_PREVIEW_RUBRIC_VERSION = 'visual-preview-rubric-v1';

export class TaskExecutionEngine {
  private readonly planner: TaskListPlanner;
  private readonly handlers = new Map<string, TaskHandler>();
  private readonly now: () => number;
  private readonly idFactory?: () => string;
  private autoPump: Promise<number> | undefined;
  private tick = 0;
  private readonly maxConcurrentTasks: number;
  private activeTasks = 0;
  private readonly ownerId = randomUUID();
  private readonly leases = new Map<string, TaskListLease>();

  constructor(private readonly options: TaskExecutionEngineOptions) {
    this.planner = options.planner ?? new TaskListPlanner();
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory;

    for (const handler of options.handlers) {
      this.handlers.set(handler.id, handler);
    }

    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 5;
  }

  private get taskLists(): TaskListRepository {
    return this.options.db.repos.taskLists;
  }

  // Engine-internal ID cast helpers. The engine only ever round-trips IDs that
  // the database itself generated, so we brand them at the access boundary
  // rather than threading brand types through every method signature.
  private taskListId(id: string | undefined): TaskListId | undefined {
    return id as TaskListId | undefined;
  }
  private taskId(id: string): TaskId {
    return id as TaskId;
  }

  private acquireLease(taskListId: string): TaskListLease | undefined {
    const existing = this.leases.get(taskListId);
    if (existing) return existing;
    const lease = this.taskLists.tryAcquireLease(
      this.taskListId(taskListId) as TaskListId,
      this.ownerId,
      this.now(),
      TASK_LIST_LEASE_TTL_MS,
    );
    if (lease) this.leases.set(taskListId, lease);
    return lease;
  }

  private renewLease(taskListId: string): boolean {
    const current = this.leases.get(taskListId);
    if (!current) return false;
    const renewed = this.taskLists.renewLease(
      this.taskListId(taskListId) as TaskListId,
      this.ownerId,
      current.token,
      this.now(),
      TASK_LIST_LEASE_TTL_MS,
    );
    if (!renewed) {
      this.leases.delete(taskListId);
      return false;
    }
    this.leases.set(taskListId, renewed);
    return true;
  }

  private releaseLease(taskListId: string): void {
    const lease = this.leases.get(taskListId);
    if (!lease) return;
    this.taskLists.releaseLease(
      this.taskListId(taskListId) as TaskListId,
      this.ownerId,
      lease.token,
    );
    this.leases.delete(taskListId);
  }

  private withLease<T>(taskListId: string, operation: () => T): T {
    const lease = this.leases.get(taskListId);
    if (!lease) throw new Error(`Task List "${taskListId}" lease is stale`);
    return this.taskLists.runWithLease(
      this.taskListId(taskListId) as TaskListId,
      this.ownerId,
      lease.token,
      this.now(),
      operation,
    );
  }

  private withAcquiredLease<T>(taskListId: string, operation: () => T): T {
    const alreadyOwned = this.leases.has(taskListId);
    if (!alreadyOwned && !this.acquireLease(taskListId)) {
      throw new Error(`Task List "${taskListId}" is busy`);
    }
    try {
      return this.withLease(taskListId, operation);
    } catch (error) {
      if (error instanceof Error && error.message.includes('lease is stale')) {
        this.leases.delete(taskListId);
      }
      throw error;
    } finally {
      if (!alreadyOwned) this.releaseLease(taskListId);
    }
  }

  private async withLeaseHeartbeat<T>(
    taskListId: string,
    operation: () => Promise<T>,
    failIfBusy: true,
  ): Promise<T>;
  private async withLeaseHeartbeat<T>(
    taskListId: string,
    operation: () => Promise<T>,
  ): Promise<T | undefined>;
  private async withLeaseHeartbeat<T>(
    taskListId: string,
    operation: () => Promise<T>,
    failIfBusy = false,
  ): Promise<T | undefined> {
    if (!this.acquireLease(taskListId)) {
      if (failIfBusy) throw new Error(`Task List "${taskListId}" is busy`);
      return undefined;
    }
    const heartbeat = setInterval(() => this.renewLease(taskListId), TASK_LIST_HEARTBEAT_MS);
    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
      this.releaseLease(taskListId);
    }
  }

  start(request: TaskListStartRequest): string {
    const definition = this.options.registry.get(request.taskListType);
    if (!definition) {
      throw new Error(`Task list "${request.taskListType}" is not registered`);
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

    this.taskLists.insertTaskList(planned.taskList);
    for (const task of planned.tasks) this.taskLists.insertTask(task);

    // Auto-pump: begin executing the task list immediately so callers don't need
    // to manually call pump() after start().
    this.autoPump = this.pump(planned.taskList.id);

    return planned.taskList.id;
  }

  list(filter?: { status?: string; taskListType?: string; entityType?: string }): TaskList[] {
    return this.taskLists.listTaskLists(filter).rows;
  }

  listSummaries(filter?: {
    status?: string;
    taskListType?: string;
    entityType?: string;
  }): TaskListSummary[] {
    return this.taskLists.listTaskListSummaries(filter);
  }

  get(id: string): TaskList | undefined {
    return this.taskLists.getTaskList(this.taskListId(id) as TaskListId);
  }

  getSummary(id: string): TaskListSummary | undefined {
    return this.taskLists.getTaskListSummary(this.taskListId(id) as TaskListId);
  }

  getTasks(taskListId: string): Task[] {
    return this.taskLists.listTasks(this.taskListId(taskListId) as TaskListId).rows;
  }

  claimCommanderContinuation(input: {
    taskListId: string;
    taskId: string;
    claimKey: string;
    claimOwnerId: string;
    expectedRowVersion: number;
  }): ClaimCommanderContinuationResult {
    const brandedTaskListId = this.taskListId(input.taskListId) as TaskListId;
    const taskList = this.taskLists.getTaskList(brandedTaskListId);
    if (!taskList) return { ok: false, code: 'task_list_not_found' };
    if ((taskList.rowVersion ?? 0) !== input.expectedRowVersion) {
      return {
        ok: false,
        code: 'stale_row_version',
        actualRowVersion: taskList.rowVersion ?? 0,
      };
    }

    const continuation = readCommanderContinuation(taskList.metadata.commanderContinuation);
    if (
      !continuation ||
      getCommanderSessionId(taskList.metadata) !== continuation.sessionId
    ) {
      return { ok: false, code: 'binding_missing' };
    }
    if (
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.currentGate ||
      taskList.status !== TaskListStatus.Ready ||
      taskList.currentTaskId !== input.taskId
    ) {
      return { ok: false, code: 'task_list_not_ready' };
    }
    const recoveryState = asRecord(asRecord(taskList.metadata).contextRecovery).state;
    if (recoveryState === 'recovery_required') {
      return { ok: false, code: 'task_list_not_ready' };
    }
    const task = this.taskLists.getTask(this.taskId(input.taskId));
    if (
      !task ||
      task.taskListId !== taskList.id ||
      task.status !== TaskStatus.Ready ||
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
    const claimed: TaskListCommanderContinuationConfig = {
      ...continuation,
      claim: {
        key: input.claimKey,
        ownerId: requireNonEmptyString(input.claimOwnerId, 'continuation claim owner'),
        status: 'running',
        startedAt: claimedAt,
      },
    };
    const changed = this.taskLists.compareAndSetTaskListMetadata(
      brandedTaskListId,
      input.expectedRowVersion,
      { ...taskList.metadata, commanderContinuation: claimed },
      claimedAt,
    );
    if (!changed) {
      return {
        ok: false,
        code: 'stale_row_version',
        actualRowVersion:
          this.taskLists.getTaskList(brandedTaskListId)?.rowVersion ?? input.expectedRowVersion,
      };
    }
    const updated = this.taskLists.getTaskList(brandedTaskListId);
    if (!updated) return { ok: false, code: 'task_list_not_found' };
    return { ok: true, taskList: updated, task, continuation: claimed };
  }

  finishCommanderContinuationClaim(input: {
    taskListId: string;
    claimKey: string;
    claimOwnerId: string;
    expectedRowVersion: number;
    outcome: 'completed' | 'failed';
    runId?: string;
    reason?: string;
  }): boolean {
    const brandedTaskListId = this.taskListId(input.taskListId) as TaskListId;
    const taskList = this.taskLists.getTaskList(brandedTaskListId);
    if (!taskList || (taskList.rowVersion ?? 0) !== input.expectedRowVersion) return false;
    const continuation = readCommanderContinuation(taskList.metadata.commanderContinuation);
    const claim = continuation?.claim;
    if (
      !continuation ||
      getCommanderSessionId(taskList.metadata) !== continuation.sessionId ||
      !claim ||
      claim.status !== 'running' ||
      claim.key !== input.claimKey ||
      claim.ownerId !== input.claimOwnerId
    ) {
      return false;
    }

    const finishedAt = this.nextTimestamp();
    const finished: TaskListCommanderContinuationConfig = {
      ...continuation,
      ...(input.runId
        ? { lastRunId: requireNonEmptyString(input.runId, 'continuation run') }
        : {}),
      claim: {
        ...claim,
        status: input.outcome,
        finishedAt,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    };
    return this.taskLists.compareAndSetTaskListMetadata(
      brandedTaskListId,
      input.expectedRowVersion,
      { ...taskList.metadata, commanderContinuation: finished },
      finishedAt,
    );
  }

  reserveAskUserDecision(input: TaskDecisionReservationRequest): ReserveTaskDecisionResult {
    const decisionKey = requireNonEmptyString(input.decisionKey, 'decision key');
    const question = requireNonEmptyString(input.question, 'decision question');
    const now = this.nextTimestamp();
    const decision: TaskDecision = {
      id: this.nextId(),
      taskListId: input.taskListId,
      taskId: input.taskId,
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
    const outcome = this.withAcquiredLease(input.taskListId, () => {
      const reserved = this.taskLists.reserveDecision({
        decision,
        expectedTaskListRowVersion: input.expectedTaskListRowVersion,
        event: {
          taskListId: input.taskListId,
          eventId: this.nextId(),
          actor: 'assistant',
          correlationId: this.nextId(),
          payload: { type: 'task_list.decision.requested' },
          timestamp: now,
        },
      });
      if (
        reserved.created ||
        reserved.decision.status !== 'recovery_required' ||
        reserved.decision.answer === undefined
      ) {
        return { result: reserved, shouldPump: false };
      }
      const recoveredAt = this.nextTimestamp();
      const recovered = this.taskLists.answerDecision({
        canvasId: reserved.decision.canvasId,
        questionId: reserved.decision.questionId,
        answer: reserved.decision.answer,
        status: 'answered',
        answeredAt: recoveredAt,
        event: {
          taskListId: reserved.decision.taskListId,
          eventId: this.nextId(),
          actor: 'assistant',
          correlationId: this.nextId(),
          payload: { type: 'task_list.decision.recovered' },
          timestamp: recoveredAt,
        },
      });
      if (!recovered) throw new Error('Persisted task list decision disappeared during recovery');
      return {
        result: {
          decision: recovered.decision,
          taskList: recovered.taskList,
          task: recovered.task,
          ...(recovered.event ? { event: recovered.event } : {}),
          created: false,
        },
        shouldPump: recovered.answered,
      };
    });
    if (outcome.shouldPump) this.schedulePump(outcome.result.decision.taskListId);
    return outcome.result;
  }

  listPendingDecisions(filter: TaskDecisionFilter = {}): TaskDecision[] {
    return this.taskLists.listPendingDecisions(filter);
  }

  answerAskUserDecisionFromUser(input: TaskDecisionAnswer): AnswerTaskDecisionResult | undefined {
    const decision = this.taskLists.getDecisionByQuestion(input.canvasId, input.questionId);
    if (!decision) return undefined;
    const answeredAt = this.nextTimestamp();
    const result = this.withAcquiredLease(decision.taskListId, () =>
      this.taskLists.answerDecision({
        canvasId: input.canvasId,
        questionId: input.questionId,
        answer: input.answer,
        status: input.status,
        answeredAt,
        event: {
          taskListId: decision.taskListId,
          eventId: this.nextId(),
          actor: 'user',
          correlationId: this.nextId(),
          payload: { type: 'task_list.decision.answered' },
          timestamp: answeredAt,
        },
      }),
    );
    if (result?.answered && input.status === 'answered') {
      this.schedulePump(decision.taskListId);
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
      input.taskListId,
      input.taskId,
      input.expectedRowVersion,
      input.canvasId,
    );
    const role = requireNonEmptyString(task.input.taskRole, 'task list task role');
    if (!['script', 'entities', 'references', 'shot_spec', 'assembly'].includes(role)) {
      throw new Error(`Task role "${role}" requires a host-verified completion path`);
    }
    return this.completeExternalTask({
      taskListId: input.taskListId,
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
      input.taskListId,
      input.taskId,
      input.expectedRowVersion,
      input.canvasId,
    );
    if (task.input.taskRole !== 'production_media') {
      throw new Error('Accepted production media can complete only a production_media task');
    }
    const attempt = this.taskLists.getLatestProductionMediaAttempt(
      this.taskListId(input.taskListId) as TaskListId,
      requireNonEmptyString(input.nodeId, 'production media nodeId'),
    );
    if (
      !attempt ||
      attempt.id !== input.attemptId ||
      attempt.status !== 'accepted' ||
      !attempt.assetHash ||
      attempt.generationSpec.task.id !== task.id
    ) {
      throw new Error('Production task completion requires its exact accepted durable attempt');
    }
    const evaluation = this.taskLists.getTaskEvaluation(attempt.id);
    if (
      !evaluation ||
      evaluation.verdict !== 'pass' ||
      evaluation.assetHash !== attempt.assetHash
    ) {
      throw new Error('Production task completion requires a passing durable evaluation');
    }
    return this.completeExternalTask({
      taskListId: input.taskListId,
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

  async reserveMediaFeedbackAttemptForRevision(
    input: ProductionMediaFeedbackReservationRequest,
  ): Promise<{ taskList: TaskList; task: Task; attempt: ProductionMediaTaskAttempt }> {
    const feedback = requireNonEmptyString(input.feedback, 'production media feedback');
    const reopenedAt = this.nextTimestamp();
    const result = this.taskLists.reserveMediaFeedbackAttempt({
      taskListId: input.taskListId,
      canvasId: input.canvasId,
      taskId: input.taskId,
      attemptId: input.attemptId,
      basePromptHash: input.basePromptHash,
      expectedTaskListRowVersion: input.expectedRowVersion,
      feedback,
      attempt: input.attempt,
      reopenedAt,
      event: {
        taskListId: input.taskListId,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        payload: {},
        timestamp: reopenedAt,
      },
    });
    await this.refreshAvailability(input.taskListId);
    const taskList =
      this.taskLists.getTaskList(this.taskListId(input.taskListId) as TaskListId) ??
      result.taskList;
    const task = this.taskLists.getTask(this.taskId(input.taskId)) ?? result.task;
    return { taskList, task, attempt: result.attempt };
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
    const commanderContinuation = readCommanderContinuation(request.commanderContinuation);
    if (!commanderContinuation) {
      throw new TypeError(
        'Production plan requires a valid Commander continuation with a persistent session',
      );
    }
    const existing = this.taskLists
      .listTaskLists({ taskListType: 'movie.production.v2', entityType: 'canvas' })
      .rows.find(
        (candidate) =>
          getCommanderSessionId(candidate.metadata) === commanderContinuation.sessionId &&
          !isTaskListTerminalStatus(candidate.status),
      );
    if (existing) {
      throw new Error(
        `Persistent video task list "${existing.id}" is already active for Commander session "${commanderContinuation.sessionId}"`,
      );
    }

    const createdAt = this.nextTimestamp();
    const graph = createMovieProductionTaskListGraph(request.plan);
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
        },
        commanderSessionId: commanderContinuation.sessionId,
        commanderContinuation: cloneJson(commanderContinuation),
      },
      now: createdAt,
      idFactory: this.idFactory,
    });
    const taskListId = planned.taskList.id;
    const planTask = planned.tasks.find((task) => task.taskKey === 'production-plan');
    if (!planTask) {
      throw new Error('Persistent production task-list blueprint is missing its plan task');
    }
    planTask.status = TaskStatus.Running;
    planTask.startedAt = createdAt;

    const documentId = this.nextId();
    const approvalId = this.nextId();
    const correlationId = this.nextId();
    const resumeToken = this.nextId();
    const content = { ...request.plan, originalIdea: idea, canvasId };
    const contentHash = sha256(canonicalJson(content));
    const manifestHash = sha256(
      canonicalJson({
        gateKey: PlanApprovalGateKey.ProductionPlan,
        subjectHash: contentHash,
        budget: request.plan.budget ?? null,
      }),
    );

    const taskList: TaskList = {
      ...planned.taskList,
      status: TaskListStatus.AwaitingApproval,
      summary: 'Production plan awaiting approval',
      progress: 0,
      completedPhases: 0,
      completedTasks: 0,
      totalTasks: planned.tasks.length,
      currentPhaseKey: planTask.phaseKey,
      currentTaskId: planTask.id,
      currentGate: PlanApprovalGateKey.ProductionPlan,
      updatedAt: createdAt,
      rowVersion: 0,
      engineVersion: 'persistent-hybrid-v2',
      definitionVersion: graph.definition.version,
    };
    const document: PlanDocument = {
      id: documentId,
      taskListId,
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
    const approval: PlanApproval = {
      id: approvalId,
      taskListId,
      gateKey: PlanApprovalGateKey.ProductionPlan,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: contentHash,
      manifestHash,
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    const events: TaskEvent[] = [
      {
        taskListId,
        seq: 1,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId,
        payload: {
          type: 'task_list.created',
          taskListType: taskList.taskListType,
          source: taskList.triggerSource,
        },
        timestamp: createdAt,
      },
      {
        taskListId,
        seq: 2,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId,
        payload: {
          type: 'task_list.gate.requested',
          gateKey: approval.gateKey,
          approvalId,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: contentHash,
        },
        timestamp: this.nextTimestamp(),
      },
    ];

    this.taskLists.createApprovalGateBundle({
      taskList,
      tasks: planned.tasks,
      document,
      approval,
      events,
    });
    return {
      taskListId,
      gate: PlanApprovalGateKey.ProductionPlan,
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
    const brandedTaskListId = this.taskListId(request.taskListId) as TaskListId;
    const taskList = this.taskLists.getTaskList(brandedTaskListId);
    if (!taskList) throw new Error(`Task list "${request.taskListId}" not found`);
    if (
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.entityId !== canvasId
    ) {
      throw new Error(`Task list "${request.taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if ((taskList.rowVersion ?? 0) !== request.expectedRowVersion) {
      throw new Error(
        `Task-list row version changed: expected ${request.expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }
    if (taskList.currentGate || taskList.currentPhaseKey !== 'production-plan') {
      throw new Error(
        'Production Plan revision is available only after that gate requests changes',
      );
    }
    const producer = this.taskLists
      .listTasks(brandedTaskListId)
      .rows.find(
        (task) => task.id === taskList.currentTaskId && task.taskKey === 'production-plan',
      );
    if (
      !producer ||
      producer.status !== TaskStatus.Ready ||
      !asRecord(producer.input.revisionRequest).reason
    ) {
      throw new Error('Production Plan producer is not awaiting a user-requested revision');
    }
    const previous = this.taskLists.getLatestDocument(brandedTaskListId, 'production-plan');
    const previousApproval = this.taskLists.getLatestApproval(
      brandedTaskListId,
      PlanApprovalGateKey.ProductionPlan,
    );
    if (!previous || !previousApproval || previousApproval.status !== 'rejected') {
      throw new Error('The previous Production Plan revision was not rejected for changes');
    }

    const createdAt = this.nextTimestamp();
    const originalIdea = requireNonEmptyString(taskList.input.idea, 'original task-list idea');
    const graph = createMovieProductionTaskListGraph(request.plan);
    const replanned = this.planner.plan({
      definition: graph.definition,
      entityType: 'canvas',
      entityId: canvasId,
      triggerSource: taskList.triggerSource,
      input: { idea: originalIdea },
      metadata: cloneJson(taskList.metadata),
      now: createdAt,
      idFactory: () => this.nextId(),
    });
    const existingTasks = this.taskLists.listTasks(brandedTaskListId).rows;
    const existingTaskIdByLogical = new Map(existingTasks.map((task) => [task.taskKey, task.id]));
    const plannedTaskIdToPersistent = new Map<string, string>();
    for (const task of replanned.tasks) {
      plannedTaskIdToPersistent.set(
        task.id,
        task.taskKey === 'production-plan'
          ? producer.id
          : (existingTaskIdByLogical.get(task.taskKey) ?? task.id),
      );
    }
    const replacementTasks = replanned.tasks
      .filter((task) => task.taskKey !== 'production-plan')
      .map((task) => ({
        ...task,
        id: plannedTaskIdToPersistent.get(task.id)!,
        taskListId: taskList.id,
        dependencyIds: task.dependencyIds.map((dependencyId) => {
          const persistentId = plannedTaskIdToPersistent.get(dependencyId);
          if (!persistentId) throw new Error('Revised Production Plan has an unknown dependency');
          return persistentId;
        }),
        updatedAt: createdAt,
      }));
    const content = { ...cloneJson(request.plan), originalIdea, canvasId };
    const document = this.createPlanDocument(
      taskList.id,
      'production-plan',
      'production_plan',
      previous.revision + 1,
      content,
      createdAt,
    );
    if (document.contentHash === previous.contentHash) {
      throw new Error('Revised Production Plan must differ from the rejected revision');
    }
    const approval: PlanApproval = {
      id: this.nextId(),
      taskListId: taskList.id,
      gateKey: PlanApprovalGateKey.ProductionPlan,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: sha256(
        canonicalJson({
          gateKey: PlanApprovalGateKey.ProductionPlan,
          subjectHash: document.contentHash,
          budget: request.plan.budget ?? null,
        }),
      ),
      resumeTokenHash: sha256(this.nextId()),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.taskLists.createApprovalGateRevision({
      expectedRowVersion: request.expectedRowVersion,
      document,
      approval,
      replacementGraph: {
        tasks: replacementTasks,
        taskListMetadata: {
          ...cloneJson(taskList.metadata),
          displayLabel:
            typeof request.plan.title === 'string' && request.plan.title.trim()
              ? request.plan.title.trim()
              : 'Untitled production',
          productionPhase: 'production-plan',
          productionGraph: {
            shotCount: graph.shots.length,
            sourceSceneCount: graph.sourceSceneCount,
          },
        },
        invalidatedByRevision: document.revision,
        updatedAt: createdAt,
      },
      event: {
        taskListId: taskList.id,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: {
          type: 'task_list.gate.requested',
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
      taskListId: taskList.id,
      gate: PlanApprovalGateKey.ProductionPlan,
      status: 'awaiting_approval',
      revision: document.revision,
      contentHash: document.contentHash,
    };
  }

  /**
   * Persist a verified immutable projection of the durable task list facts
   * immediately before context handoff compaction.
   */
  createContextCheckpoint(
    taskListId: string,
    facts: Record<string, unknown>,
  ): ContextCheckpointCreateResult {
    const brandedTaskListId = this.taskListId(taskListId) as TaskListId;
    if (!this.taskLists.getTaskList(brandedTaskListId)) {
      throw new Error(`Task list "${taskListId}" not found`);
    }
    const latest = this.taskLists.getLatestDocument(brandedTaskListId, 'context-checkpoint');
    const revision = (latest?.revision ?? 0) + 1;
    const createdAt = this.nextTimestamp();
    const content = { ...facts, taskListId, checkpointedAt: createdAt };
    const contentHash = sha256(canonicalJson(content));
    const document: PlanDocument = {
      id: this.nextId(),
      taskListId,
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
    this.taskLists.createDocument(document);
    const verified = this.taskLists.getDocumentRevision(
      brandedTaskListId,
      document.logicalKey,
      document.revision,
    );
    if (!verified || verified.contentHash !== contentHash) {
      throw new Error(`Context checkpoint verification failed for task list "${taskListId}"`);
    }
    return { taskListId, revision, contentHash };
  }

  /**
   * Persist Commander context-recovery health on the task list aggregate.
   * The counter therefore survives individual Commander runs and process
   * restarts. A recovery pause remembers the prior task-list status so only this
   * automatic pause is reversed after SQLite context reload succeeds.
   */
  async reportContextRecovery(report: ContextRecoveryReport): Promise<ContextRecoveryReportResult> {
    const brandedTaskListId = this.taskListId(report.taskListId) as TaskListId;
    const taskList = this.taskLists.getTaskList(brandedTaskListId);
    if (!taskList) throw new Error(`Task list "${report.taskListId}" not found`);
    if (isTaskListTerminalStatus(taskList.status)) {
      throw new Error(`Terminal task list "${report.taskListId}" cannot change recovery state`);
    }

    const current = asRecord(taskList.metadata.contextRecovery);
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

      const previousTaskListStatus = isTaskListStatus(current.previousTaskListStatus)
        ? current.previousTaskListStatus
        : TaskListStatus.Ready;
      const restoredStatus =
        currentState === 'recovery_required' && taskList.status === TaskListStatus.Paused
          ? safeRecoveredTaskListStatus(previousTaskListStatus)
          : taskList.status;
      const updatedAt = this.nextTimestamp();
      this.taskLists.updateTaskList(brandedTaskListId, {
        status: restoredStatus,
        metadata: {
          ...taskList.metadata,
          contextRecovery: {
            state: 'recovered',
            consecutiveFailures: 0,
            reason: report.reason,
            previousTaskListStatus,
            updatedAt,
          },
        },
        updatedAt,
      });
      if (restoredStatus === TaskListStatus.Ready) {
        await this.refreshAvailability(report.taskListId);
      }
      return { state: 'active', consecutiveFailures: 0, changed: true };
    }

    const consecutiveFailures = currentFailures + 1;
    const recoveryRequired = report.forcePause === true || consecutiveFailures >= 3;
    const previousTaskListStatus =
      currentState === 'recovery_required' && isTaskListStatus(current.previousTaskListStatus)
        ? current.previousTaskListStatus
        : taskList.status;
    const updatedAt = this.nextTimestamp();
    this.taskLists.updateTaskList(brandedTaskListId, {
      ...(recoveryRequired ? { status: TaskListStatus.Paused } : {}),
      metadata: {
        ...taskList.metadata,
        contextRecovery: {
          state: recoveryRequired ? 'recovery_required' : 'recovering',
          consecutiveFailures,
          reason: report.reason,
          previousTaskListStatus,
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

  getLatestVisualAudition(taskListId: string): PlanDocument | undefined {
    return this.taskLists.getLatestDocument(
      this.taskListId(taskListId) as TaskListId,
      'visual-auditions',
    );
  }

  getVisualAuditionContext(taskListId: string): VisualAuditionContext | undefined {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) return undefined;
    const document = this.getLatestVisualAudition(taskListId);
    return document ? { taskList: taskList, document } : undefined;
  }

  getApprovedProductionPlan(taskListId: string): PlanDocument {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    return this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.ProductionPlan,
    );
  }

  getApprovedVisualConstitution(taskListId: string): PlanDocument {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    return this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.VisualConstitution,
    );
  }

  requireProductionMediaContext(
    taskListId: string,
    canvasId: string,
    taskId: string,
    expectedRowVersion?: number,
  ): ProductionMediaTaskContext {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    if (
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.entityId !== canvasId
    ) {
      throw new Error(`Task list "${taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if (expectedRowVersion !== undefined && (taskList.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Task list row version changed: expected ${expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }
    if (taskList.currentGate) {
      throw new Error(`Task list "${taskListId}" is awaiting ${taskList.currentGate} approval`);
    }
    const currentPhase = taskList.currentPhaseKey;
    const task = this.taskLists.getTask(this.taskId(taskId));
    const taskRole = typeof task?.input.taskRole === 'string' ? task.input.taskRole : undefined;
    const phaseAllowsMedia =
      (currentPhase === 'media-generation' && taskRole === 'production_media') ||
      (currentPhase === 'preproduction' && taskRole === 'references');
    if (
      !task ||
      task.taskListId !== taskList.id ||
      task.id !== taskList.currentTaskId ||
      (task.status !== TaskStatus.Ready && task.status !== TaskStatus.Running) ||
      !phaseAllowsMedia ||
      (taskList.status !== TaskListStatus.Ready && taskList.status !== TaskListStatus.Running)
    ) {
      throw new Error(
        `Task list "${taskListId}" is not ready for task-bound media generation (status=${taskList.status}, phase=${currentPhase ?? 'none'}, task=${task?.taskKey ?? 'none'})`,
      );
    }
    return {
      taskList: taskList,
      task,
      productionPlan: this.requireExactApprovedDocument(
        taskList.id as TaskListId,
        PlanApprovalGateKey.ProductionPlan,
      ),
      visualConstitution: this.requireExactApprovedDocument(
        taskList.id as TaskListId,
        PlanApprovalGateKey.VisualConstitution,
      ),
    };
  }

  requireProductionMediaFeedbackContext(
    taskListId: string,
    canvasId: string,
    taskId: string,
    expectedRowVersion: number,
  ): ProductionMediaTaskContext {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    if (
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.entityId !== canvasId
    ) {
      throw new Error(`Task list "${taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if ((taskList.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Task list row version changed: expected ${expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }
    if (taskList.currentGate) {
      throw new Error(`Task list "${taskListId}" is awaiting ${taskList.currentGate} approval`);
    }
    if (taskList.status !== TaskListStatus.Ready && taskList.status !== TaskListStatus.Running) {
      throw new Error(`Task list "${taskListId}" cannot accept media feedback now`);
    }
    const task = this.taskLists.getTask(this.taskId(taskId));
    if (
      !task ||
      task.taskListId !== taskList.id ||
      task.input.taskRole !== 'production_media' ||
      task.status !== TaskStatus.Completed
    ) {
      throw new Error('Only an exact completed production-media task can accept this feedback');
    }
    const assemblyStarted = this.taskLists
      .listTasks(taskList.id as TaskListId)
      .rows.some(
        (candidate) =>
          candidate.phaseKey === 'assembly' &&
          (candidate.status === TaskStatus.Running ||
            candidate.status === TaskStatus.AwaitingProvider ||
            candidate.status === TaskStatus.Completed),
      );
    if (assemblyStarted) {
      throw new Error('Assembly has already started; revise that phase before changing media');
    }
    return {
      taskList: taskList,
      task,
      productionPlan: this.requireExactApprovedDocument(
        taskList.id as TaskListId,
        PlanApprovalGateKey.ProductionPlan,
      ),
      visualConstitution: this.requireExactApprovedDocument(
        taskList.id as TaskListId,
        PlanApprovalGateKey.VisualConstitution,
      ),
    };
  }

  /**
   * Creates or resumes the durable candidate set before any provider call.
   * A repeated call is resumable only when every creative/provider input is
   * byte-for-byte equivalent to the existing request hash.
   */
  beginVisualAudition(request: VisualAuditionStartRequest): VisualAuditionStartResult {
    const taskList = this.requireStyleExplorationTaskList(request.taskListId, request.canvasId);
    const productionPlan = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.ProductionPlan,
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
    const existing = this.getLatestVisualAudition(taskList.id);
    if (existing) {
      const existingContent = existing.content as VisualAuditionDocumentContent;
      const producer = this.taskLists
        .listTasks(taskList.id as TaskListId)
        .rows.find(
          (task) => task.id === taskList.currentTaskId && task.taskKey === 'style-audition',
        );
      const revisionRequest = asRecord(producer?.input.revisionRequest);
      const isRequestedRevision =
        producer?.status === TaskStatus.Ready &&
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
          'A different visual audition already exists for this task list; inspect or resolve it before submitting another candidate set',
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
    const document = this.createPlanDocument(
      taskList.id,
      'visual-auditions',
      'visual_auditions',
      (existing?.revision ?? 0) + 1,
      content,
      createdAt,
    );
    this.taskLists.createDocument(document);
    return { document, resumed: false };
  }

  /** Append a verified immutable snapshot after each provider/vision attempt. */
  saveVisualAuditionSnapshot(request: VisualAuditionSnapshotRequest): PlanDocument {
    const taskList = this.requireStyleExplorationTaskList(request.taskListId);
    const latest = this.getLatestVisualAudition(taskList.id);
    if (!latest) throw new Error(`Task list "${taskList.id}" has no visual audition to update`);
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
    const document = this.createPlanDocument(
      taskList.id,
      'visual-auditions',
      'visual_auditions',
      latest.revision + 1,
      cloneJson(request.content),
      createdAt,
    );
    this.taskLists.createDocument(document);
    const verified = this.taskLists.getDocumentRevision(
      taskList.id as TaskListId,
      document.logicalKey,
      document.revision,
    );
    if (!verified || verified.contentHash !== document.contentHash) {
      throw new Error(`Visual audition verification failed for task list "${taskList.id}"`);
    }
    return verified;
  }

  /**
   * Records a user's request for a replacement candidate set before a Visual
   * Constitution exists. The Task List aggregate is the CAS boundary, while
   * the ready style-audition producer carries the request to Commander.
   */
  requestVisualAuditionChangesFromUser(
    input: RequestVisualAuditionChangesInput,
  ): RequestVisualAuditionChangesResult {
    const taskListId = requireNonEmptyString(input.taskListId, 'task list id');
    const expectedRowVersion = requireNonNegativeInteger(
      input.expectedRowVersion,
      'expected row version',
    );
    const expectedAuditionRevision = requirePositiveInteger(
      input.expectedAuditionRevision,
      'expected audition revision',
    );
    const expectedAuditionHash = requireNonEmptyString(
      input.expectedAuditionHash,
      'expected audition hash',
    );
    if (!/^[a-f0-9]{64}$/i.test(expectedAuditionHash)) {
      throw new TypeError('expected audition hash must be a SHA-256 digest');
    }
    const reason = requireNonEmptyString(input.reason, 'visual audition revision reason').trim();

    return this.withAcquiredLease(taskListId, () => {
      const taskList = this.requireStyleExplorationTaskList(taskListId);
      if ((taskList.rowVersion ?? 0) !== expectedRowVersion) {
        throw new Error(
          `Task list row version changed: expected ${expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
        );
      }

      const producer = this.taskLists
        .listTasks(taskList.id as TaskListId)
        .rows.find(
          (task) => task.id === taskList.currentTaskId && task.taskKey === 'style-audition',
        );
      if (!producer || producer.status !== TaskStatus.Ready) {
        throw new Error(
          'Only the ready current style-audition task can request replacement candidates',
        );
      }

      const audition = this.getLatestVisualAudition(taskList.id);
      if (!audition) throw new Error('No visual audition is available to replace');
      if (audition.revision !== expectedAuditionRevision) {
        throw new Error(
          `Visual audition revision changed: expected ${expectedAuditionRevision}, got ${audition.revision}`,
        );
      }
      if (audition.contentHash !== expectedAuditionHash) {
        throw new Error('Visual audition content hash changed');
      }
      if ((audition.content as VisualAuditionDocumentContent).status !== 'complete') {
        throw new Error('Only a complete visual audition can be replaced');
      }

      const requestedAt = this.nextTimestamp();
      const revisionRequest = {
        action: 'request_changes',
        reason,
        previousRevision: audition.revision,
        previousHash: audition.contentHash,
        requestedAt,
      };
      const changed = this.taskLists.compareAndSetTaskListMetadata(
        taskList.id as TaskListId,
        expectedRowVersion,
        {
          ...taskList.metadata,
          visualAuditionRevisionRequest: revisionRequest,
        },
        requestedAt,
      );
      if (!changed) {
        const current = this.taskLists.getTaskList(taskList.id as TaskListId);
        throw new Error(
          `Task list row version changed: expected ${expectedRowVersion}, got ${current?.rowVersion ?? expectedRowVersion}`,
        );
      }
      this.taskLists.updateTask(this.taskId(producer.id), {
        input: { ...producer.input, revisionRequest },
        currentStep: 'revision_requested',
        updatedAt: requestedAt,
      });

      const updated = this.taskLists.getTaskList(taskList.id as TaskListId);
      if (!updated)
        throw new Error(`Task list "${taskListId}" disappeared during revision request`);
      return { taskList: updated };
    });
  }

  /**
   * A real host-UI choice creates the exact immutable Visual Constitution and
   * opens the second approval gate. Selection and approval remain separate.
   */
  selectVisualConstitutionCandidateFromUser(
    input: SelectVisualConstitutionCandidateInput,
  ): VisualConstitutionSelectionResult {
    const taskList = this.taskLists.getTaskList(this.taskListId(input.taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${input.taskListId}" not found`);
    if (taskList.taskListType !== 'movie.production.v2') {
      throw new Error(`Task list "${input.taskListId}" is not a persistent video task list`);
    }
    if (taskList.currentPhaseKey !== 'style-exploration') {
      throw new Error('Visual candidates can be selected only during style exploration');
    }
    if (taskList.currentGate && taskList.currentGate !== PlanApprovalGateKey.VisualConstitution) {
      throw new Error(`Task list is blocked at ${taskList.currentGate}`);
    }
    if ((taskList.rowVersion ?? 0) !== input.expectedRowVersion) {
      throw new Error(
        `Task list row version changed: expected ${input.expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }

    const productionPlan = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.ProductionPlan,
    );
    const audition = this.getLatestVisualAudition(taskList.id);
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
      taskList.currentGate === PlanApprovalGateKey.VisualConstitution
        ? this.getPendingApprovalContext(taskList.id)
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

    const latestConstitution = this.taskLists.getLatestDocument(
      taskList.id as TaskListId,
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
        promptAssemblyId: attempt.promptAssemblyId,
        providerId: attempt.providerId,
        ...(attempt.model ? { model: attempt.model } : {}),
        seed: attempt.reportedSeed ?? attempt.requestedSeed,
        prompt: attempt.prompt,
        promptHash: attempt.promptHash,
        ...(attempt.negativePrompt !== undefined ? { negativePrompt: attempt.negativePrompt } : {}),
      },
      locked: cloneJson(candidate.constitution),
      candidates: cloneJson(auditionContent.candidates),
      budget: cloneJson(auditionContent.budget),
    };
    const document = this.createPlanDocument(
      taskList.id,
      'visual-constitution',
      'visual_constitution',
      revision,
      content,
      createdAt,
    );
    const resumeToken = this.nextId();
    const approval: PlanApproval = {
      id: this.nextId(),
      taskListId: taskList.id,
      gateKey: PlanApprovalGateKey.VisualConstitution,
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
    this.taskLists.createApprovalGateRevision({
      expectedRowVersion: input.expectedRowVersion,
      document,
      approval,
      event: {
        taskListId: taskList.id,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        payload: {
          type: 'task_list.gate.requested',
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
    const context = this.getPendingApprovalContext(taskList.id);
    if (!context) throw new Error('Visual Constitution approval gate was not persisted');
    return { context, created: true };
  }

  /** Derives the exact ordered-source handoff from persisted host-owned state. */
  prepareDeliveryManifest(input: PrepareDeliveryManifestInput): PrepareDeliveryManifestResult {
    const taskList = this.requireDeliveryPreparationTaskList(input.taskListId, input.canvasId);
    if ((taskList.rowVersion ?? 0) !== input.expectedRowVersion) {
      throw new Error(
        `Task list row version changed: expected ${input.expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }

    const productionPlan = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.ProductionPlan,
    );
    const visualConstitution = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.VisualConstitution,
    );
    const content = this.deriveDeliveryManifest(
      taskList,
      input.canvasId,
      productionPlan,
      visualConstitution,
      input.packageBaseName,
    );
    const contentHash = sha256(canonicalJson(content));
    const latest = this.taskLists.getLatestDocument(taskList.id as TaskListId, 'delivery-manifest');
    const latestApproval = this.taskLists.getLatestApproval(
      taskList.id as TaskListId,
      PlanApprovalGateKey.Delivery,
    );
    if (
      latest?.contentHash === contentHash &&
      latestApproval &&
      (latestApproval.status === 'pending' || latestApproval.status === 'approved') &&
      latestApproval.subjectLogicalKey === latest.logicalKey &&
      latestApproval.subjectRevision === latest.revision &&
      latestApproval.subjectHash === latest.contentHash
    ) {
      const context = this.getDeliveryContext(taskList.id);
      if (!context) throw new Error('Delivery context could not be restored');
      return { context, created: false };
    }
    if (
      latest?.contentHash === contentHash &&
      latestApproval?.status === 'rejected' &&
      latestApproval.subjectLogicalKey === latest.logicalKey &&
      latestApproval.subjectRevision === latest.revision &&
      latestApproval.subjectHash === latest.contentHash
    ) {
      throw new Error('Revised Delivery manifest must differ from the rejected revision');
    }

    const createdAt = this.nextTimestamp();
    const document = this.createPlanDocument(
      taskList.id,
      'delivery-manifest',
      'delivery_manifest',
      (latest?.revision ?? 0) + 1,
      content,
      createdAt,
    );
    const resumeToken = this.nextId();
    const approval: PlanApproval = {
      id: this.nextId(),
      taskListId: taskList.id,
      gateKey: PlanApprovalGateKey.Delivery,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: document.contentHash,
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.taskLists.createApprovalGateRevision({
      expectedRowVersion: input.expectedRowVersion,
      document,
      approval,
      event: {
        taskListId: taskList.id,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: {
          type: 'task_list.gate.requested',
          gateKey: approval.gateKey,
          approvalId: approval.id,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: document.contentHash,
          canvasId: input.canvasId,
          itemCount: content.items.length,
          deliverySequenceRevision: content.deliverySequence.revision,
          packageBaseName: content.namingPolicy.packageBaseName,
        },
        timestamp: createdAt,
      },
    });
    const context = this.getDeliveryContext(taskList.id);
    if (!context) throw new Error('Delivery approval gate was not persisted');
    return { context, created: true };
  }

  getDeliveryContext(taskListId: string): DeliveryManifestContext | undefined {
    const brandedTaskListId = this.taskListId(taskListId) as TaskListId;
    const taskList = this.taskLists.getTaskList(brandedTaskListId);
    if (!taskList) return undefined;
    const manifest = this.taskLists.getLatestDocument(brandedTaskListId, 'delivery-manifest');
    if (!manifest) return undefined;
    const approval = this.taskLists.getLatestApproval(
      brandedTaskListId,
      PlanApprovalGateKey.Delivery,
    );
    if (
      !approval ||
      approval.subjectLogicalKey !== manifest.logicalKey ||
      approval.subjectRevision !== manifest.revision ||
      approval.subjectHash !== manifest.contentHash
    ) {
      throw new Error(`Task list "${taskListId}" Delivery approval is inconsistent`);
    }
    const packageAttempt = this.taskLists.getLatestDeliveryPackageAttempt(brandedTaskListId);
    const matchingPackageAttempt =
      packageAttempt?.manifestRevision === manifest.revision &&
      packageAttempt.manifestHash === manifest.contentHash
        ? packageAttempt
        : undefined;
    const { resumeTokenHash: _hostOnlyResumeTokenHash, ...approvalView } = approval;
    return {
      taskList: taskList,
      manifest,
      approval: approvalView,
      ...(matchingPackageAttempt ? { packageAttempt: matchingPackageAttempt } : {}),
    };
  }

  /** Re-derives the canonical handoff before any host UI package action. */
  requireApprovedDeliveryManifest(taskListId: string, canvasId: string): PlanDocument {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    if (
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.entityId !== canvasId
    ) {
      throw new Error(`Task list "${taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if (taskList.currentGate) {
      throw new Error(`Task list "${taskListId}" is awaiting ${taskList.currentGate} approval`);
    }
    const manifest = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.Delivery,
    );
    const content = manifest.content as DeliveryManifestContent;
    if (
      content.canvasId !== canvasId ||
      content.taskListId !== taskListId ||
      !Array.isArray(content.items) ||
      content.items.length === 0
    ) {
      throw new Error('Approved Delivery manifest has an invalid canvas projection');
    }
    const productionPlan = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.ProductionPlan,
    );
    const visualConstitution = this.requireExactApprovedDocument(
      taskList.id as TaskListId,
      PlanApprovalGateKey.VisualConstitution,
    );
    if (
      content.productionPlan?.revision !== productionPlan.revision ||
      content.productionPlan.contentHash !== productionPlan.contentHash ||
      content.visualConstitution?.revision !== visualConstitution.revision ||
      content.visualConstitution.contentHash !== visualConstitution.contentHash
    ) {
      throw new Error(
        'Approved Delivery manifest is not bound to the current approved documents',
      );
    }
    const current = this.deriveDeliveryManifest(
      taskList,
      canvasId,
      productionPlan,
      visualConstitution,
      content.namingPolicy?.packageBaseName,
    );
    if (canonicalJson(current) !== canonicalJson(content)) {
      throw new Error('Current Delivery state no longer matches the approved manifest');
    }
    return manifest;
  }

  getPendingApprovalContext(taskListId: string): PlanApprovalContext | undefined {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList?.currentGate) return undefined;
    const approval = this.taskLists.getPendingApproval(
      this.taskListId(taskListId) as TaskListId,
      taskList.currentGate,
    );
    if (!approval) {
      throw new Error(`Task list "${taskListId}" has a gate but no pending approval`);
    }
    const document = this.taskLists.getDocumentRevision(
      this.taskListId(taskListId) as TaskListId,
      approval.subjectLogicalKey,
      approval.subjectRevision,
    );
    if (
      !document ||
      document.revision !== approval.subjectRevision ||
      document.contentHash !== approval.subjectHash
    ) {
      throw new Error(`Task list "${taskListId}" approval subject is inconsistent`);
    }
    const { resumeTokenHash: _hostOnlyResumeTokenHash, ...approvalView } = approval;
    return { taskList: taskList, approval: approvalView, document };
  }

  approvePendingGateFromUser(input: UserApprovePlanGateInput): ApprovePlanGateResult {
    const pending = this.taskLists.getPendingApproval(
      this.taskListId(input.taskListId) as TaskListId,
      input.gateKey,
    );
    const latest = pending
      ? undefined
      : this.taskLists.getLatestApproval(
          this.taskListId(input.taskListId) as TaskListId,
          input.gateKey,
        );
    const approval = pending ?? latest;
    if (!approval) {
      const taskList = this.taskLists.getTaskList(this.taskListId(input.taskListId) as TaskListId);
      return taskList
        ? { ok: false, code: 'no_approval' }
        : { ok: false, code: 'task_list_not_found' };
    }
    if (input.gateKey === PlanApprovalGateKey.Delivery) {
      const document = this.taskLists.getDocumentRevision(
        this.taskListId(input.taskListId) as TaskListId,
        approval.subjectLogicalKey,
        approval.subjectRevision,
      );
      if (
        !document ||
        document.contentHash !== approval.subjectHash ||
        document.logicalKey !== 'delivery-manifest' ||
        document.documentType !== 'delivery_manifest' ||
        !Array.isArray(asRecord(document.content).items)
      ) {
        throw new Error('Delivery approval requires an ordered-source manifest');
      }
    }

    const transition = this.resolveGateTransition(input.taskListId, input.gateKey);
    const completedProducerTaskId =
      input.gateKey === PlanApprovalGateKey.Delivery
        ? undefined
        : this.taskLists
            .listTasks(this.taskListId(input.taskListId) as TaskListId)
            .rows.find((task) => task.taskKey === producerTaskForGate(input.gateKey))?.id;
    if (input.gateKey !== PlanApprovalGateKey.Delivery && !completedProducerTaskId) {
      throw new Error(`Task list "${input.taskListId}" is missing its gate producer task`);
    }
    const result = this.withAcquiredLease(input.taskListId, () =>
      this.taskLists.approveGate({
        taskListId: this.taskListId(input.taskListId) as TaskListId,
        gateKey: input.gateKey,
        expectedRowVersion: input.expectedRowVersion,
        expectedSubjectRevision: input.expectedSubjectRevision,
        expectedSubjectHash: input.expectedSubjectHash,
        resumeTokenHash: approval.resumeTokenHash,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        approvedAt: this.nextTimestamp(),
        nextPhaseKey: transition.phaseKey,
        nextTaskId: transition.taskId,
        ...(completedProducerTaskId ? { completedProducerTaskId } : {}),
      }),
    );
    if (result.ok && input.gateKey !== PlanApprovalGateKey.Delivery) {
      this.schedulePump(input.taskListId);
    }
    return result;
  }

  requestChangesPendingGateFromUser(input: UserRequestPlanGateChangesInput): RevisePlanGateResult {
    return this.revisePendingGateFromUser(input, 'request_changes');
  }

  rejectPendingGateFromUser(input: UserRejectPlanGateInput): RevisePlanGateResult {
    return this.revisePendingGateFromUser(input, 'reject');
  }

  private revisePendingGateFromUser(
    input: UserRequestPlanGateChangesInput | UserRejectPlanGateInput,
    action: PlanGateRevisionAction,
  ): RevisePlanGateResult {
    const reason = requireNonEmptyString(input.reason, 'revision reason');
    const brandedTaskListId = this.taskListId(input.taskListId) as TaskListId;
    const taskList = this.taskLists.getTaskList(brandedTaskListId);
    if (!taskList) return { ok: false, code: 'task_list_not_found' };

    const pending = this.taskLists.getPendingApproval(brandedTaskListId, input.gateKey);
    if (!pending) {
      const latest = this.taskLists.getLatestApproval(brandedTaskListId, input.gateKey);
      if (!latest) return { ok: false, code: 'no_approval' };
      if (latest.status !== 'pending') {
        return { ok: false, code: 'approval_not_pending', status: latest.status };
      }
      throw new Error('Pending task-list approval lookup is inconsistent');
    }
    const previousDocument = this.taskLists.getDocumentRevision(
      brandedTaskListId,
      pending.subjectLogicalKey,
      pending.subjectRevision,
    );
    if (!previousDocument || previousDocument.contentHash !== pending.subjectHash) {
      throw new Error('Pending task-list approval subject is inconsistent');
    }

    const producerLogicalTaskId = producerTaskForGate(input.gateKey);
    const producerTask = this.taskLists
      .listTasks(brandedTaskListId)
      .rows.find((candidate) => candidate.taskKey === producerLogicalTaskId);
    if (!producerTask) {
      throw new Error(
        `Task list "${input.taskListId}" is missing revision producer task "${producerLogicalTaskId}"`,
      );
    }
    const revisedAt = this.nextTimestamp();

    return this.withAcquiredLease(input.taskListId, () =>
      this.taskLists.reviseGate({
        taskListId: brandedTaskListId,
        gateKey: input.gateKey,
        action,
        reason,
        expectedRowVersion: input.expectedRowVersion,
        expectedSubjectRevision: input.expectedSubjectRevision,
        expectedSubjectHash: input.expectedSubjectHash,
        producerTaskId: producerTask.id,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        revisedAt,
      }),
    );
  }

  private resolveGateTransition(
    taskListId: string,
    gateKey: PlanApprovalGateKey,
  ): { phaseKey: string; taskId?: string } {
    const phaseKey = nextPhaseForGate(gateKey);
    const tasks = this.taskLists.listTasksByPhase(
      this.taskListId(taskListId) as TaskListId,
      phaseKey,
    ).rows;
    if (tasks.length === 0) {
      throw new Error(
        `Task list "${taskListId}" is missing phase ${phaseKey} required by ${gateKey}`,
      );
    }
    const preferredTaskId = firstTaskForPhase(phaseKey);
    const task =
      tasks.find((candidate) => candidate.taskKey === preferredTaskId) ??
      tasks.sort((left, right) => left.taskKey.localeCompare(right.taskKey))[0];
    return { phaseKey, ...(task ? { taskId: task.id } : {}) };
  }

  private schedulePump(taskListId: string): void {
    const previous = this.autoPump;
    const scheduled = previous
      ? previous.catch(() => 0).then(() => this.pump(taskListId))
      : this.pump(taskListId);
    // The host may close the project before a fire-and-forget pump settles.
    // Keep the rejection observable through waitForAutoPump without emitting an
    // unhandled process rejection when no caller is waiting.
    void scheduled.catch(() => undefined);
    this.autoPump = scheduled;
  }

  async pause(taskListId: string): Promise<void> {
    if (!this.acquireLease(taskListId)) throw new Error(`Task List "${taskListId}" is busy`);
    try {
      this.withLease(taskListId, () =>
        this.taskLists.updateTaskList(this.taskListId(taskListId) as TaskListId, {
          status: 'paused',
          updatedAt: this.nextTimestamp(),
        }),
      );
    } finally {
      this.releaseLease(taskListId);
    }
  }

  async resume(taskListId: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(taskListId);
    if (!this.acquireLease(taskListId)) throw new Error(`Task List "${taskListId}" is busy`);
    try {
      this.withLease(taskListId, () =>
        this.taskLists.updateTaskList(this.taskListId(taskListId) as TaskListId, {
          status: 'ready',
          updatedAt: this.nextTimestamp(),
        }),
      );
      await this.refreshAvailability(taskListId);
    } finally {
      this.releaseLease(taskListId);
    }
  }

  async cancel(taskListId: string): Promise<void> {
    // Discard any in-flight autoPump before mutating state, so the pump loop
    // cannot race ahead and start new tasks after we mark everything cancelled.
    if (this.autoPump) {
      const pending = this.autoPump;
      this.autoPump = undefined;
      await pending.catch(() => {
        /* ignore — we are cancelling */
      });
    }

    const tasks = this.taskLists.listTasks(this.taskListId(taskListId) as TaskListId).rows;
    if (!this.acquireLease(taskListId)) throw new Error(`Task List "${taskListId}" is busy`);
    try {
      this.withLease(taskListId, () => {
        for (const task of tasks) {
          if (TASK_TERMINAL_STATUSES.has(task.status)) continue;
          this.taskLists.updateTask(this.taskId(task.id), {
            status: TaskStatus.Cancelled,
            completedAt: this.nextTimestamp(),
            updatedAt: this.nextTimestamp(),
          });
        }
        this.taskLists.recomputeTaskListAggregate(this.taskListId(taskListId) as TaskListId);
      });
    } finally {
      this.releaseLease(taskListId);
    }
  }

  async retryTask(taskId: string): Promise<void> {
    const record = this.getRecord(taskId);
    this.assertNotAwaitingHumanApproval(record.taskList.id);
    if (!TASK_TERMINAL_STATUSES.has(record.task.status)) {
      return;
    }

    if (!this.acquireLease(record.taskList.id)) {
      throw new Error(`Task List "${record.taskList.id}" is busy`);
    }
    try {
      this.withLease(record.taskList.id, () =>
        this.taskLists.updateTask(this.taskId(taskId), {
          status: TaskStatus.Blocked,
          updatedAt: this.nextTimestamp(),
        }),
      );
      await this.refreshAvailability(record.taskList.id);
    } finally {
      this.releaseLease(record.taskList.id);
    }
  }

  async retryPhase(taskListId: string, phaseKey: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(taskListId);
    const tasks = this.taskLists.listTasksByPhase(
      this.taskListId(taskListId) as TaskListId,
      phaseKey,
    ).rows;
    if (tasks.length === 0) throw new Error(`Task phase "${phaseKey}" not found`);
    if (!this.acquireLease(taskListId)) throw new Error(`Task List "${taskListId}" is busy`);
    try {
      this.withLease(taskListId, () => {
        for (const task of tasks) {
          if (!TASK_TERMINAL_STATUSES.has(task.status)) continue;
          this.taskLists.updateTask(this.taskId(task.id), {
            status: TaskStatus.Blocked,
            updatedAt: this.nextTimestamp(),
          });
        }
      });
      await this.refreshAvailability(taskListId);
    } finally {
      this.releaseLease(taskListId);
    }
  }

  async retryTaskList(taskListId: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(taskListId);
    if (!this.acquireLease(taskListId)) throw new Error(`Task List "${taskListId}" is busy`);
    try {
      this.withLease(taskListId, () => {
        for (const task of this.taskLists.listTasks(this.taskListId(taskListId) as TaskListId)
          .rows) {
          if (!TASK_TERMINAL_STATUSES.has(task.status)) continue;
          this.taskLists.updateTask(this.taskId(task.id), {
            status: TaskStatus.Blocked,
            updatedAt: this.nextTimestamp(),
          });
        }
      });
      await this.refreshAvailability(taskListId);
    } finally {
      this.releaseLease(taskListId);
    }
  }

  async pump(taskListId?: string): Promise<number> {
    const taskListIds = taskListId
      ? [taskListId]
      : this.taskLists.listTaskLists().rows.map((candidate) => candidate.id);
    let executed = 0;
    for (const id of taskListIds) {
      executed +=
        (await this.withLeaseHeartbeat(id, async () => this.pumpClaimedTaskList(id))) ?? 0;
    }
    return executed;
  }

  private async pumpClaimedTaskList(taskListId: string): Promise<number> {
    let executed = 0;
    await this.refreshAvailability(taskListId);

    const MAX_PUMP_ITERATIONS = 1000;
    let iterations = 0;
    for (;;) {
      if (++iterations > MAX_PUMP_ITERATIONS) {
        throw new Error('pump: max iterations exceeded — possible runaway task list');
      }
      const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
      if (
        !taskList ||
        taskList.status === 'paused' ||
        taskList.status === 'cancelled' ||
        taskList.currentGate
      ) {
        return executed;
      }
      const slots = this.maxConcurrentTasks - this.activeTasks;
      if (slots <= 0) return executed;
      const readyTasks = this.taskLists
        .listReadyTasks(this.taskListId(taskListId) as TaskListId)
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

  async recover(taskListId?: string): Promise<number> {
    const candidates = this.taskLists.listRecoverableTasks(
      taskListId ? (this.taskListId(taskListId) as TaskListId) : undefined,
    ).rows;
    let recovered = 0;

    for (const task of candidates) {
      const result = await this.withLeaseHeartbeat(task.taskListId, async () => {
        await this.recoverTask(task.id);
        return true;
      });
      if (result) recovered += 1;
    }

    return recovered;
  }

  private async executeTask(taskId: string): Promise<void> {
    const record = this.getRecord(taskId);
    const handler = this.resolveHandler(record.task);
    const attempts = record.task.attempts + 1;

    this.withLease(record.taskList.id, () =>
      this.taskLists.updateTask(this.taskId(taskId), {
        status: TaskStatus.Running,
        attempts,
        startedAt: record.task.startedAt ?? this.nextTimestamp(),
        updatedAt: this.nextTimestamp(),
      }),
    );

    try {
      const runningRecord = this.getRecord(taskId);
      const result = await handler.execute({
        taskList: runningRecord.taskList,
        task: runningRecord.task,
        db: this.options.db,
      });

      this.applyTaskResult(runningRecord.task, result);
    } catch (error) {
      if (error instanceof Error && error.message.includes('lease is stale')) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.applyTaskResult(this.getRecord(taskId).task, {
        status: attempts < record.task.maxRetries ? TaskStatus.RetryableFailed : TaskStatus.Failed,
        error: message,
        progress: record.task.progress,
      });
    }

    await this.refreshAvailability(record.taskList.id);
  }

  private async recoverTask(taskId: string): Promise<void> {
    const record = this.getRecord(taskId);
    const handler = this.resolveHandler(record.task);

    if (!handler.recover) {
      if (
        record.task.status === TaskStatus.Running ||
        record.task.status === TaskStatus.AwaitingProvider
      ) {
        this.applyTaskResult(record.task, {
          status: TaskStatus.Failed,
          error: 'Recovery is unsupported; provider submission was not retried',
          progress: record.task.progress,
        });
      }
      return;
    }

    const result = await handler.recover({
      taskList: record.taskList,
      task: record.task,
      db: this.options.db,
    });

    if (!result) {
      if (
        record.task.status === TaskStatus.Running ||
        record.task.status === TaskStatus.AwaitingProvider
      ) {
        this.applyTaskResult(record.task, {
          status: TaskStatus.Failed,
          error: 'Provider recovery returned no durable result; submission was not retried',
          progress: record.task.progress,
        });
      }
      return;
    }

    this.applyTaskResult(record.task, result);
    await this.refreshAvailability(record.taskList.id);
  }

  private applyTaskResult(task: Task, result: TaskExecutionResult): void {
    const status = result.status;
    const isTerminal = TASK_TERMINAL_STATUSES.has(status);

    this.withLease(task.taskListId, () => {
      this.taskLists.updateTask(this.taskId(task.id), {
        status,
        output: result.output ?? task.output,
        error: result.error,
        progress: result.progress ?? (status === TaskStatus.Completed ? 100 : task.progress),
        currentStep: result.currentStep,
        providerTaskId: result.providerTaskId ?? task.providerTaskId,
        assetId: result.assetId ?? task.assetId,
        completedAt: isTerminal ? this.nextTimestamp() : task.completedAt,
        updatedAt: this.nextTimestamp(),
      });
      this.taskLists.recomputePhaseAggregate(
        this.taskListId(task.taskListId) as TaskListId,
        task.phaseKey,
      );
      this.taskLists.recomputeTaskListAggregate(this.taskListId(task.taskListId) as TaskListId);
    });
  }

  private async refreshAvailability(taskListId?: string): Promise<void> {
    const taskListIds = taskListId
      ? [taskListId]
      : this.taskLists.listTaskLists().rows.map((taskList) => taskList.id);

    for (const id of taskListIds) {
      const owned = this.leases.has(id);
      if (!owned && !this.acquireLease(id)) continue;
      try {
        const taskList = this.taskLists.getTaskList(this.taskListId(id) as TaskListId);
        if (taskList?.currentGate) continue;
        const tasks = this.taskLists.listTasks(this.taskListId(id) as TaskListId).rows;
        const taskById = new Map(tasks.map((task) => [task.id, task]));
        let changed = false;

        for (const task of [...tasks].sort(
          (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
        )) {
          if (task.status !== TaskStatus.Blocked && task.status !== TaskStatus.Pending) {
            continue;
          }

          if (!this.areTaskDependenciesSatisfied(task, taskById)) {
            continue;
          }

          this.withLease(id, () =>
            this.taskLists.updateTask(this.taskId(task.id), {
              status: TaskStatus.Ready,
              updatedAt: this.nextTimestamp(),
            }),
          );
          task.status = TaskStatus.Ready;
          changed = true;
        }

        if (changed) {
          this.withLease(id, () =>
            this.taskLists.recomputeTaskListAggregate(this.taskListId(id) as TaskListId),
          );
        }
      } finally {
        if (!owned) this.releaseLease(id);
      }
    }
  }

  private areTaskDependenciesSatisfied(task: Task, taskByTaskId: Map<string, Task>): boolean {
    return task.dependencyIds.every((dependencyId) => {
      const dependency = taskByTaskId.get(dependencyId);
      return dependency !== undefined && TASK_SUCCESS_STATUSES.has(dependency.status);
    });
  }

  private requireCurrentExternalTask(
    taskListId: string,
    taskId: string,
    expectedRowVersion: number,
    canvasId?: string,
  ): Task {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    if (taskList.taskListType !== 'movie.production.v2') {
      throw new Error(`Task list "${taskListId}" is not a persistent video task list`);
    }
    if (
      canvasId !== undefined &&
      (taskList.entityType !== 'canvas' || taskList.entityId !== canvasId)
    ) {
      throw new Error(`Task list "${taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if ((taskList.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Task list row version changed: expected ${expectedRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }
    if (taskList.currentGate)
      throw new Error(`Task list is awaiting ${taskList.currentGate} approval`);
    if (taskList.currentTaskId !== taskId) {
      throw new Error('Task completion must use the host-derived current task');
    }
    const task = this.taskLists.getTask(this.taskId(taskId));
    if (!task || task.taskListId !== taskListId) {
      throw new Error(`Task list task "${taskId}" not found`);
    }
    if (task.input.executionMode !== 'external') {
      throw new Error(`Task list task "${taskId}" is not externally completed`);
    }
    if (task.status !== TaskStatus.Ready && task.status !== TaskStatus.Running) {
      throw new Error(`Task list task cannot complete from status "${task.status}"`);
    }
    return task;
  }

  private async completeExternalTask(input: {
    taskListId: string;
    task: Task;
    expectedRowVersion: number;
    output: Record<string, unknown>;
  }): Promise<ExternalTaskCompletionResult> {
    return this.withLeaseHeartbeat(
      input.taskListId,
      async () => {
        const completedAt = this.nextTimestamp();
        const persisted = this.withLease(input.taskListId, () =>
          this.taskLists.completeExternalTask({
            taskListId: input.taskListId,
            taskId: input.task.id,
            expectedTaskListRowVersion: input.expectedRowVersion,
            output: cloneJson(input.output),
            completedAt,
            event: {
              taskListId: input.taskListId,
              eventId: this.nextId(),
              actor: 'assistant',
              correlationId: this.nextId(),
              payload: { role: input.task.input.taskRole ?? null },
              timestamp: completedAt,
            },
          }),
        );
        await this.refreshAvailability(input.taskListId);
        const taskList = this.taskLists.getTaskList(
          this.taskListId(input.taskListId) as TaskListId,
        );
        if (!taskList) {
          throw new Error(`Task list "${input.taskListId}" disappeared after completion`);
        }
        const nextTask = taskList.currentTaskId
          ? this.taskLists.getTask(this.taskId(taskList.currentTaskId))
          : undefined;
        return {
          taskList,
          task: persisted.task,
          ...(nextTask ? { nextTask } : {}),
        };
      },
      true,
    );
  }

  private getRecord(taskId: string): TaskExecutionStateRecord {
    const task = this.taskLists.getTask(this.taskId(taskId));
    if (!task) {
      throw new Error(`Task list task "${taskId}" not found`);
    }

    const taskList = this.taskLists.getTaskList(this.taskListId(task.taskListId) as TaskListId);
    if (!taskList) {
      throw new Error(`Task list "${task.taskListId}" not found`);
    }

    return { taskList, task };
  }

  private resolveHandler(task: Task): TaskHandler {
    const handlerId = typeof task.input.handlerId === 'string' ? task.input.handlerId : undefined;
    if (!handlerId) {
      throw new Error(`Task list task "${task.id}" is missing a handlerId`);
    }

    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Task list handler "${handlerId}" is not registered`);
    }

    return handler;
  }

  private getProductionPhaseKey(taskList: TaskList): string | undefined {
    if (!taskList.currentPhaseKey) return undefined;
    if (taskList.currentTaskId) {
      const task = this.taskLists.getTask(this.taskId(taskList.currentTaskId));
      if (!task || task.taskListId !== taskList.id || task.phaseKey !== taskList.currentPhaseKey) {
        throw new Error(
          `Task list "${taskList.id}" current task does not belong to phase ${taskList.currentPhaseKey}`,
        );
      }
    }
    return taskList.currentPhaseKey;
  }

  private requireDeliveryPreparationTaskList(taskListId: string, canvasId: string): TaskList {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    if (taskList.taskListType !== 'movie.production.v2') {
      throw new Error(`Task list "${taskListId}" is not a persistent video task list`);
    }
    if (taskList.entityType !== 'canvas' || taskList.entityId !== canvasId) {
      throw new Error(`Task list "${taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if (taskList.currentGate && taskList.currentGate !== PlanApprovalGateKey.Delivery) {
      throw new Error(`Task list "${taskListId}" is awaiting ${taskList.currentGate} approval`);
    }
    const currentPhase = this.getProductionPhaseKey(taskList);
    const currentTask = taskList.currentTaskId
      ? this.taskLists.getTask(this.taskId(taskList.currentTaskId))
      : undefined;
    if (
      currentPhase !== 'delivery' ||
      currentTask?.input.taskRole !== 'delivery' ||
      (currentTask.status !== TaskStatus.Ready && currentTask.status !== TaskStatus.Running)
    ) {
      throw new Error(
        `Task list "${taskListId}" cannot prepare Delivery from phase ${currentPhase ?? 'none'}`,
      );
    }
    return taskList;
  }

  private deriveDeliveryManifest(
    taskList: TaskList,
    canvasId: string,
    productionPlan: PlanDocument,
    visualConstitution: PlanDocument,
    packageBaseName: unknown,
  ): DeliveryManifestContent {
    const canvas = this.options.db.repos.canvases.get(canvasId as never);
    if (!canvas) throw new Error(`Canvas "${canvasId}" not found`);
    const sequence = canvas.deliverySequence;
    if (!sequence || !Number.isInteger(sequence.revision) || sequence.revision <= 0) {
      throw new Error('Delivery requires a current persisted Canvas delivery sequence');
    }
    if (sequence.items.length === 0) {
      throw new Error('Delivery requires at least one selected source video');
    }
    const taskListId = taskList.id as TaskListId;
    const attempts = this.taskLists.listProductionMediaAttempts(taskListId);
    const evaluations = new Map(
      this.taskLists
        .listTaskEvaluations(taskListId)
        .map((evaluation) => [evaluation.attemptId, evaluation]),
    );
    const assets = this.options.db.repos.assets.findByHashes(
      sequence.items.map((item) => item.selectedVideoHash),
    );
    const prefixWidth = Math.max(3, String(sequence.items.length).length);
    const normalizedPackageBaseName = sanitizeFileComponent(packageBaseName, 'packageBaseName', 120);
    const fileNames = new Set<string>();
    const items = sequence.items.map((selection, index): DeliveryManifestItem => {
      const asset = requireDeliveryVideoAsset(assets.get(selection.selectedVideoHash), selection);
      const matchingAttempts = attempts.filter((attempt) => {
        const authority = attempt.generationSpec.authority;
        return (
          attempt.status === 'accepted' &&
          attempt.mediaType === 'video' &&
          attempt.canvasId === canvasId &&
          attempt.assetHash === selection.selectedVideoHash &&
          attempt.generationSpec.task.shotId === selection.shotId &&
          authority.kind === 'task-list-approved' &&
          authority.planId === productionPlan.id &&
          authority.planHash === productionPlan.contentHash &&
          authority.constitutionId === visualConstitution.id &&
          authority.constitutionHash === visualConstitution.contentHash
        );
      });
      if (matchingAttempts.length !== 1) {
        throw new Error(
          `Delivery shot "${selection.shotId}" requires exactly one accepted production attempt for ${selection.selectedVideoHash}`,
        );
      }
      const attempt = matchingAttempts[0];
      const evaluation = evaluations.get(attempt.id);
      if (
        !evaluation ||
        evaluation.verdict !== 'pass' ||
        evaluation.assetHash !== selection.selectedVideoHash ||
        evaluation.canvasId !== canvasId ||
        evaluation.nodeId !== attempt.nodeId ||
        evaluation.mediaType !== 'video' ||
        evaluation.sourcePromptHash !== attempt.promptHash
      ) {
        throw new Error(`Delivery shot "${selection.shotId}" lacks exact passing evaluation lineage`);
      }
      const node = canvas.nodes.find((candidate) => candidate.id === attempt.nodeId);
      if (
        !node ||
        node.type !== 'video' ||
        node.bypassed ||
        node.updatedAt !== attempt.generationSpec.nodeUpdatedAt ||
        selectedNodeAssetHash(node.data) !== selection.selectedVideoHash
      ) {
        throw new Error(`Delivery shot "${selection.shotId}" no longer matches its accepted Canvas node`);
      }
      const promptAssembly = this.options.db.repos.promptAssemblies.get(attempt.promptAssemblyId);
      if (
        !promptAssembly ||
        promptAssembly.canvasId !== canvasId ||
        promptAssembly.nodeId !== attempt.nodeId ||
        promptAssembly.taskListId !== taskList.id ||
        promptAssembly.taskId !== attempt.taskId ||
        promptAssembly.output?.finalPrompt !== attempt.prompt ||
        promptAssembly.input.providerProfile.providerId !== attempt.providerId
      ) {
        throw new Error(`Delivery shot "${selection.shotId}" has inconsistent Prompt Assembly lineage`);
      }
      const metadata = asset.generationMetadata;
      if (
        !metadata ||
        metadata.taskListId !== taskList.id ||
        metadata.taskId !== attempt.taskId ||
        metadata.attemptId !== attempt.id ||
        metadata.promptAssemblyId !== promptAssembly.id ||
        metadata.promptHash !== attempt.promptHash ||
        metadata.provider !== attempt.providerId ||
        metadata.model !== attempt.model
      ) {
        throw new Error(`Delivery asset "${asset.hash}" has inconsistent production provenance`);
      }
      const outputArtifact = this.taskLists.getArtifactByAttempt(attempt.id, 'media_output');
      const assetEntryId = outputArtifact?.metadata.assetEntryId;
      if (
        !outputArtifact ||
        outputArtifact.taskListId !== taskList.id ||
        outputArtifact.taskId !== attempt.taskId ||
        outputArtifact.attemptId !== attempt.id ||
        outputArtifact.artifactType !== 'media_output' ||
        outputArtifact.entityType !== 'canvas-node' ||
        outputArtifact.entityId !== attempt.nodeId ||
        outputArtifact.assetHash !== selection.selectedVideoHash ||
        outputArtifact.metadata.taskListId !== taskList.id ||
        outputArtifact.metadata.taskId !== attempt.taskId ||
        outputArtifact.metadata.attemptId !== attempt.id ||
        outputArtifact.metadata.promptAssemblyId !== promptAssembly.id ||
        outputArtifact.metadata.promptHash !== attempt.promptHash ||
        outputArtifact.metadata.providerId !== attempt.providerId ||
        outputArtifact.metadata.modelId !== attempt.model ||
        outputArtifact.metadata.contentHash !== selection.selectedVideoHash ||
        typeof assetEntryId !== 'string' ||
        assetEntryId.length === 0
      ) {
        throw new Error(`Delivery shot "${selection.shotId}" has inconsistent media output lineage`);
      }
      const assetEntry = this.options.db.repos.assets.findEntryById(assetEntryId as never);
      if (!assetEntry || assetEntry.hash !== selection.selectedVideoHash) {
        throw new Error(`Delivery shot "${selection.shotId}" has inconsistent asset entry lineage`);
      }
      const sourceFileName = requireSafeSourceFileName(assetEntry.displayName, asset.hash);
      const sourceStem = sanitizeFileComponent(stripFileExtension(sourceFileName), 'source filename', 80);
      const stableShotId = sanitizeFileComponent(selection.shotId, 'shotId', 80);
      const extension = requireSafeExtension(asset.format, asset.hash);
      const packageFileName = `${String(index + 1).padStart(prefixWidth, '0')}_${sourceStem}_${stableShotId}.${extension}`;
      const collisionKey = packageFileName.toLocaleLowerCase('en-US');
      if (fileNames.has(collisionKey)) {
        throw new Error(`Delivery package filename collision: ${packageFileName}`);
      }
      fileNames.add(collisionKey);
      return {
        shotId: selection.shotId,
        selectedVideoHash: selection.selectedVideoHash,
        packageFileName,
        sourceFileName,
        sourceFormat: asset.format,
        sourceBytes: asset.fileSize,
        sourceDurationMs: Math.round(asset.duration * 1_000),
        sourceWidth: asset.width,
        sourceHeight: asset.height,
        hasEmbeddedAudio: asset.hasAudio,
        trimInMs: selection.trimInMs,
        trimOutMs: selection.trimOutMs,
        embeddedAudioEnabled: selection.embeddedAudioEnabled,
        provenance: {
          assetCreatedAt: asset.createdAt,
          nodeId: node.id,
          taskId: attempt.taskId,
          attemptId: attempt.id,
          evaluationId: evaluation.id,
          promptAssemblyId: promptAssembly.id,
          providerId: attempt.providerId,
          model: attempt.model,
        },
      };
    });
    return {
      taskListId: taskList.id,
      canvasId,
      productionPlan: { revision: productionPlan.revision, contentHash: productionPlan.contentHash },
      visualConstitution: {
        revision: visualConstitution.revision,
        contentHash: visualConstitution.contentHash,
      },
      deliverySequence: {
        revision: sequence.revision,
        contentHash: sha256(canonicalJson(sequence)),
      },
      namingPolicy: {
        packageBaseName: normalizedPackageBaseName,
        orderPrefixWidth: prefixWidth,
        separator: '_',
        overwritePolicy: 'fail',
      },
      items,
    };
  }

  private requireStyleExplorationTaskList(taskListId: string, canvasId?: string): TaskList {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (!taskList) throw new Error(`Task list "${taskListId}" not found`);
    if (taskList.taskListType !== 'movie.production.v2') {
      throw new Error(`Task list "${taskListId}" is not a persistent video task list`);
    }
    if (
      canvasId !== undefined &&
      (taskList.entityType !== 'canvas' || taskList.entityId !== canvasId)
    ) {
      throw new Error(`Task list "${taskListId}" is not bound to canvas "${canvasId}"`);
    }
    if (taskList.currentGate) {
      throw new Error(`Task list "${taskListId}" is awaiting ${taskList.currentGate} approval`);
    }
    const currentPhase = this.getProductionPhaseKey(taskList);
    if (taskList.status !== TaskListStatus.Ready || currentPhase !== 'style-exploration') {
      throw new Error(
        `Task list "${taskListId}" is not ready for style exploration (status=${taskList.status}, phase=${currentPhase ?? 'none'})`,
      );
    }
    return taskList;
  }

  private requireExactApprovedDocument(
    taskListId: TaskListId,
    gateKey: PlanApprovalGateKey,
  ): PlanDocument {
    const approval = this.taskLists.getLatestApproval(taskListId, gateKey);
    if (!approval || approval.status !== 'approved') {
      throw new Error(`Exact ${gateKey} approval is required`);
    }
    const document = this.taskLists.getDocumentRevision(
      taskListId,
      approval.subjectLogicalKey,
      approval.subjectRevision,
    );
    if (!document || document.contentHash !== approval.subjectHash) {
      throw new Error(`Approved ${gateKey} subject revision/hash is inconsistent`);
    }
    return document;
  }

  private createPlanDocument(
    taskListId: string,
    logicalKey: string,
    documentType: string,
    revision: number,
    content: Record<string, unknown>,
    createdAt: number,
  ): PlanDocument {
    return {
      id: this.nextId(),
      taskListId,
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

  private assertNotAwaitingHumanApproval(taskListId: string): void {
    const taskList = this.taskLists.getTaskList(this.taskListId(taskListId) as TaskListId);
    if (taskList?.currentGate) {
      throw new Error(
        `Task list "${taskListId}" requires human approval at ${taskList.currentGate}; resume and retry cannot bypass approval gates`,
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readCommanderContinuation(value: unknown): TaskListCommanderContinuationConfig | undefined {
  const continuation = asRecord(value);
  const provider = asRecord(continuation.provider);
  const permissionMode = continuation.permissionMode;
  if (
    continuation.version !== 1 ||
    typeof continuation.sessionId !== 'string' ||
    !continuation.sessionId.trim() ||
    !['danger', 'auto', 'normal', 'strict'].includes(String(permissionMode)) ||
    ['id', 'name', 'baseUrl', 'model', 'protocol', 'authStyle'].some(
      (key) => typeof provider[key] !== 'string' || !(provider[key] as string).trim(),
    )
  ) {
    return undefined;
  }
  return {
    ...(cloneJson(continuation) as unknown as TaskListCommanderContinuationConfig),
    sessionId: continuation.sessionId.trim(),
  };
}

function isTaskListStatus(value: unknown): value is TaskList['status'] {
  return typeof value === 'string' && (Object.values(TaskListStatus) as string[]).includes(value);
}

function safeRecoveredTaskListStatus(status: TaskList['status']): TaskList['status'] {
  switch (status) {
    case TaskListStatus.Queued:
    case TaskListStatus.Preparing:
    case TaskListStatus.Running:
      return TaskListStatus.Ready;
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

function requireDeliveryVideoAsset(
  asset: AssetMeta | undefined,
  selection: {
    selectedVideoHash: string;
    trimInMs: number;
    trimOutMs: number;
    embeddedAudioEnabled: boolean;
  },
): AssetMeta & {
  type: 'video';
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
} {
  if (!asset || asset.hash !== selection.selectedVideoHash || asset.type !== 'video') {
    throw new Error(`Delivery video "${selection.selectedVideoHash}" is missing from the CAS index`);
  }
  if (
    !asset.format.trim() ||
    !Number.isInteger(asset.fileSize) ||
    asset.fileSize <= 0 ||
    typeof asset.duration !== 'number' ||
    !Number.isFinite(asset.duration) ||
    asset.duration <= 0 ||
    typeof asset.width !== 'number' ||
    !Number.isInteger(asset.width) ||
    asset.width <= 0 ||
    typeof asset.height !== 'number' ||
    !Number.isInteger(asset.height) ||
    asset.height <= 0 ||
    typeof asset.hasAudio !== 'boolean'
  ) {
    throw new Error(`Delivery video "${asset.hash}" requires exact format, bytes, duration, dimensions, and audio metadata`);
  }
  const durationMs = Math.round(asset.duration * 1_000);
  if (
    !Number.isInteger(selection.trimInMs) ||
    !Number.isInteger(selection.trimOutMs) ||
    selection.trimInMs < 0 ||
    selection.trimOutMs <= selection.trimInMs ||
    selection.trimOutMs > durationMs
  ) {
    throw new Error(`Delivery video "${asset.hash}" has invalid trim bounds`);
  }
  if (selection.embeddedAudioEnabled && !asset.hasAudio) {
    throw new Error(`Delivery video "${asset.hash}" cannot enable missing embedded audio`);
  }
  return asset as AssetMeta & {
    type: 'video';
    duration: number;
    width: number;
    height: number;
    hasAudio: boolean;
  };
}

function selectedNodeAssetHash(value: unknown): string | undefined {
  const data = asRecord(value);
  const variants = Array.isArray(data.variants)
    ? data.variants.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const index =
    typeof data.selectedVariantIndex === 'number' &&
    Number.isInteger(data.selectedVariantIndex) &&
    data.selectedVariantIndex >= 0
      ? data.selectedVariantIndex
      : 0;
  return variants[index] ??
    (typeof data.assetHash === 'string' && data.assetHash.trim() ? data.assetHash : undefined);
}

function sanitizeFileComponent(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const sanitized = value
    .normalize('NFKC')
    .split('')
    .map((character) =>
      hasAsciiControlCharacter(character) || /[\\/:*?"<>|]/.test(character) ? '-' : character,
    )
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, maxLength)
    .replace(/[. -]+$/g, '');
  if (!sanitized) throw new TypeError(`${label} does not contain a safe file-name component`);
  return sanitized;
}

function requireSafeSourceFileName(value: unknown, assetHash: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    /[\\/:*?"<>|]/.test(value) ||
    hasAsciiControlCharacter(value) ||
    /[. ]$/.test(value)
  ) {
    throw new Error(`Delivery video "${assetHash}" has an unsafe source filename`);
  }
  return value;
}

function stripFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function requireSafeExtension(format: string, assetHash: string): string {
  const extension = format.replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,16}$/.test(extension)) {
    throw new Error(`Delivery video "${assetHash}" has an unsafe source format`);
  }
  return extension;
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
  if (!Array.isArray(candidates) || candidates.length < 1) {
    throw new TypeError('Visual audition requires at least one candidate');
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
      requireNonEmptyString(attempt.promptAssemblyId, `${candidate.id} attempt prompt assembly ID`);
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
      } else if (attempt.status === 'evaluation_pending') {
        if (!attempt.assetHash || !assetExists(attempt.assetHash)) {
          throw new Error(`Visual candidate "${candidate.id}" pending evaluation asset is missing`);
        }
        if (!attempt.error) {
          throw new Error(
            `Visual candidate "${candidate.id}" pending evaluation has no recovery evidence`,
          );
        }
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
    if (encoded === undefined) throw new TypeError('Task list documents must be JSON-serializable');
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

function nextPhaseForGate(gateKey: PlanApprovalGateKey): string {
  switch (gateKey) {
    case PlanApprovalGateKey.ProductionPlan:
      return 'style-exploration';
    case PlanApprovalGateKey.VisualConstitution:
      return 'preproduction';
    case PlanApprovalGateKey.Delivery:
      return 'delivery';
  }
}

function producerTaskForGate(gateKey: PlanApprovalGateKey): string {
  switch (gateKey) {
    case PlanApprovalGateKey.ProductionPlan:
      return 'production-plan';
    case PlanApprovalGateKey.VisualConstitution:
      return 'style-audition';
    case PlanApprovalGateKey.Delivery:
      return 'delivery';
  }
}

function firstTaskForPhase(phaseKey: string): string {
  switch (phaseKey) {
    case 'style-exploration':
      return 'style-audition';
    case 'preproduction':
      return 'script';
    case 'delivery':
      return 'delivery';
    default:
      return phaseKey;
  }
}
