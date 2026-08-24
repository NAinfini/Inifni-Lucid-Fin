/** Canonical repository for durable Task Lists, Tasks, Plans, and Attempts. */
import type BetterSqlite3 from 'better-sqlite3';
import type {
  AnswerTaskDecisionInput,
  AnswerTaskDecisionResult,
  ApprovePlanGateInput,
  ApprovePlanGateResult,
  DeliveryPackageTaskAttempt,
  PlanApproval,
  PlanDocument,
  ProductionMediaTaskAttempt,
  RevisePlanGateInput,
  RevisePlanGateResult,
  ReserveTaskDecisionInput,
  ReserveTaskDecisionResult,
  Task,
  TaskArtifact,
  TaskCostSummary,
  TaskDecision,
  TaskDecisionFilter,
  TaskEvaluation,
  TaskExecutionAttempt,
  TaskEvent,
  TaskId,
  TaskList,
  TaskListId,
  TaskListSummary,
  TaskSummary,
} from '@lucid-fin/contracts';
import { parseOrDegrade, TaskListRecordSchema, TaskRecordSchema } from '@lucid-fin/contracts-parse';
import {
  answerTaskDecision,
  approvePlanGate,
  beginMediaSubmission,
  compareAndSetTaskListMetadata,
  completeExternalTask,
  completeDeliveryPackageTaskAttempt,
  getDeliveryPackageTaskAttempt,
  getLatestDeliveryPackageTaskAttempt,
  getLatestPlanApproval,
  getLatestPlanDocument,
  getLatestProductionMediaTaskAttempt,
  getPendingPlanApproval,
  getPlanDocumentRevision,
  getProductionMediaTaskAttempt,
  getTask,
  getTaskCostSummary,
  getTaskDecisionByQuestion,
  getTaskEvaluation,
  getTaskArtifactByAttempt,
  getTaskExecutionAttempt,
  getTaskList,
  getTaskListSummary,
  insertPendingPlanApproval,
  insertPlanApprovalGateBundle,
  insertPlanApprovalGateRevision,
  insertPlanDocument,
  insertTask,
  insertTaskArtifact,
  insertTaskList,
  listAwaitingProviderTasks,
  listEntityArtifacts,
  listPendingTaskDecisions,
  listProductionMediaTaskAttempts,
  listReadyTasks,
  listRecoverableTasks,
  listRecoverableDeliveryPackageTaskAttempts,
  listRecoverableProductionMediaTaskAttempts,
  listTaskArtifacts,
  listTaskArtifactsByTask,
  listTaskArtifactsByTaskBatch,
  listTaskDependencies,
  listTaskDependenciesBatch,
  listTaskDependents,
  listTaskEvaluations,
  listTaskEvents,
  listTaskExecutionAttempts,
  listTaskLists,
  listTaskListSummaries,
  listTaskSummaries,
  listTasks,
  listTasksByPhase,
  recomputePhaseAggregate,
  recomputeTaskListAggregate,
  recordMediaOutput,
  recordTaskEvaluation,
  replaceTaskDependencies,
  reserveDeliveryPackageTaskAttempt,
  reserveProductionMediaFeedbackAttempt,
  reserveProductionMediaTaskAttempt,
  reserveTaskDecision,
  reserveTaskExecutionAttempt,
  retryDeliveryPackageTaskAttempt,
  revisePlanGate,
  transitionDeliveryPackageTaskAttempt,
  transitionProductionMediaTaskAttempt,
  transitionTaskExecutionAttempt,
  updateTask,
  updateTaskList,
  type CompleteExternalTaskInput,
  type CompleteExternalTaskResult,
  type CompleteDeliveryPackageTaskAttemptInput,
  type PlanApprovalGateBundle,
  type PlanApprovalGateRevisionBundle,
  type PlanApprovalGateRevisionResult,
  type RecordTaskEvaluationInput,
  type RecordTaskEvaluationResult,
  type RecordMediaOutputInput,
  type RecordMediaOutputResult,
  type ReserveDeliveryPackageTaskAttemptInput,
  type ReserveDeliveryPackageTaskAttemptResult,
  type ReserveProductionMediaFeedbackAttemptInput,
  type ReserveProductionMediaFeedbackAttemptResult,
  type ReserveProductionMediaTaskAttemptInput,
  type ReserveProductionMediaTaskAttemptResult,
  type BeginMediaSubmissionInput,
  type BeginMediaSubmissionResult,
  type ReserveTaskExecutionAttemptInput,
  type TransitionTaskExecutionAttemptInput,
  type TransitionDeliveryPackageTaskAttemptInput,
  type TransitionProductionMediaTaskAttemptInput,
} from '../sqlite-task-execution.js';

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

export interface TaskListLease {
  ownerId: string;
  token: number;
  expiresAt: number;
  heartbeatAt: number;
}

const TASK_LIST_SENTINEL = Symbol('task-list-degraded');
const TASK_SENTINEL = Symbol('task-degraded');

function filterDegraded<T>(
  items: T[],
  schema: Parameters<typeof parseOrDegrade>[0],
  sentinel: symbol,
  context: string,
): ListResult<T> {
  const rows: T[] = [];
  let degradedCount = 0;
  for (const item of items) {
    const parsed = parseOrDegrade(schema, item, sentinel as unknown as T, {
      ctx: { name: context },
    });
    if ((parsed as unknown) === sentinel) degradedCount += 1;
    else rows.push(parsed as T);
  }
  return { rows, degradedCount };
}

export class TaskListRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insertTaskList(taskList: TaskList): void {
    insertTaskList(this.db, taskList);
  }

  getTaskList(id: TaskListId): TaskList | undefined {
    const value = getTaskList(this.db, id);
    if (!value) return undefined;
    const parsed = parseOrDegrade(
      TaskListRecordSchema,
      value,
      TASK_LIST_SENTINEL as unknown as TaskList,
      { ctx: { name: 'TaskList' } },
    );
    return (parsed as unknown) === TASK_LIST_SENTINEL ? undefined : (parsed as TaskList);
  }

  getTaskListSummary(id: TaskListId): TaskListSummary | undefined {
    return getTaskListSummary(this.db, id);
  }

  listTaskLists(filter?: Parameters<typeof listTaskLists>[1]): ListResult<TaskList> {
    return filterDegraded(
      listTaskLists(this.db, filter),
      TaskListRecordSchema,
      TASK_LIST_SENTINEL,
      'TaskList',
    );
  }

  listTaskListSummaries(
    filter?: Parameters<typeof listTaskListSummaries>[1],
  ): TaskListSummary[] {
    return listTaskListSummaries(this.db, filter);
  }

  tryAcquireLease(
    id: TaskListId,
    ownerId: string,
    now: number,
    ttlMs: number,
  ): TaskListLease | undefined {
    if (!ownerId.trim()) throw new Error('Task List lease owner is required');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0)
      throw new Error('Task List lease TTL must be positive');

    return this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT lease_owner, lease_token, lease_expires_at, heartbeat_at
             FROM task_lists WHERE id = ?`,
        )
        .get(id) as
        | {
            lease_owner: string | null;
            lease_token: number;
            lease_expires_at: number | null;
            heartbeat_at: number | null;
          }
        | undefined;
      if (!current) return undefined;
      const expiresAt = now + ttlMs;
      if (current.lease_owner === ownerId && (current.lease_expires_at ?? 0) > now) {
        this.db
          .prepare(
            `UPDATE task_lists
                SET heartbeat_at = ?, lease_expires_at = ?
              WHERE id = ? AND lease_owner = ? AND lease_token = ? AND lease_expires_at > ?`,
          )
          .run(now, expiresAt, id, ownerId, current.lease_token, now);
        return {
          ownerId,
          token: current.lease_token,
          expiresAt,
          heartbeatAt: now,
        };
      }

      const claimed = this.db
        .prepare(
          `UPDATE task_lists
              SET lease_owner = ?, lease_token = lease_token + 1,
                  lease_expires_at = ?, heartbeat_at = ?
            WHERE id = ? AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)`,
        )
        .run(ownerId, expiresAt, now, id, now);
      if (claimed.changes !== 1) return undefined;
      const token = Number(
        (
          this.db.prepare('SELECT lease_token FROM task_lists WHERE id = ?').get(id) as {
            lease_token: number;
          }
        ).lease_token,
      );
      return { ownerId, token, expiresAt, heartbeatAt: now };
    })();
  }

  renewLease(
    id: TaskListId,
    ownerId: string,
    token: number,
    now: number,
    ttlMs: number,
  ): TaskListLease | undefined {
    const expiresAt = now + ttlMs;
    const result = this.db
      .prepare(
        `UPDATE task_lists
            SET heartbeat_at = ?, lease_expires_at = ?
          WHERE id = ? AND lease_owner = ? AND lease_token = ? AND lease_expires_at > ?`,
      )
      .run(now, expiresAt, id, ownerId, token, now);
    return result.changes === 1 ? { ownerId, token, expiresAt, heartbeatAt: now } : undefined;
  }

  releaseLease(id: TaskListId, ownerId: string, token: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE task_lists
              SET lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
            WHERE id = ? AND lease_owner = ? AND lease_token = ?`,
        )
        .run(id, ownerId, token).changes === 1
    );
  }

  runWithLease<T>(
    id: TaskListId,
    ownerId: string,
    token: number,
    now: number,
    operation: () => T,
  ): T {
    return this.db.transaction(() => {
      const valid = this.db
        .prepare(
          `SELECT 1 FROM task_lists
            WHERE id = ? AND lease_owner = ? AND lease_token = ? AND lease_expires_at > ?`,
        )
        .get(id, ownerId, token, now);
      if (!valid) throw new Error(`Task List "${id}" lease is stale`);
      return operation();
    })();
  }

  updateTaskList(id: TaskListId, updates: Parameters<typeof updateTaskList>[2]): void {
    updateTaskList(this.db, id, updates);
  }

  compareAndSetTaskListMetadata(
    id: TaskListId,
    expectedRowVersion: number,
    metadata: Record<string, unknown>,
    updatedAt: number,
  ): boolean {
    return compareAndSetTaskListMetadata(this.db, id, expectedRowVersion, metadata, updatedAt);
  }

  createApprovalGateBundle(bundle: PlanApprovalGateBundle): void {
    insertPlanApprovalGateBundle(this.db, bundle);
  }

  createApprovalGateRevision(
    bundle: PlanApprovalGateRevisionBundle,
  ): PlanApprovalGateRevisionResult {
    return insertPlanApprovalGateRevision(this.db, bundle);
  }

  createDocument(document: PlanDocument): void {
    insertPlanDocument(this.db, document);
  }

  getLatestDocument(taskListId: TaskListId, logicalKey: string): PlanDocument | undefined {
    return getLatestPlanDocument(this.db, taskListId, logicalKey);
  }

  getDocumentRevision(
    taskListId: TaskListId,
    logicalKey: string,
    revision: number,
  ): PlanDocument | undefined {
    return getPlanDocumentRevision(this.db, taskListId, logicalKey, revision);
  }

  createPendingApproval(approval: PlanApproval): void {
    insertPendingPlanApproval(this.db, approval);
  }

  getPendingApproval(
    taskListId: TaskListId,
    gateKey: PlanApproval['gateKey'],
  ): PlanApproval | undefined {
    return getPendingPlanApproval(this.db, taskListId, gateKey);
  }

  getLatestApproval(
    taskListId: TaskListId,
    gateKey: PlanApproval['gateKey'],
  ): PlanApproval | undefined {
    return getLatestPlanApproval(this.db, taskListId, gateKey);
  }

  approveGate(input: ApprovePlanGateInput): ApprovePlanGateResult {
    return approvePlanGate(this.db, input);
  }

  reviseGate(input: RevisePlanGateInput): RevisePlanGateResult {
    return revisePlanGate(this.db, input);
  }

  listEvents(taskListId: TaskListId): TaskEvent[] {
    return listTaskEvents(this.db, taskListId);
  }

  reserveDecision(input: ReserveTaskDecisionInput): ReserveTaskDecisionResult {
    return reserveTaskDecision(this.db, input);
  }

  getDecisionByQuestion(canvasId: string, questionId: string): TaskDecision | undefined {
    return getTaskDecisionByQuestion(this.db, canvasId, questionId);
  }

  listPendingDecisions(filter: TaskDecisionFilter = {}): TaskDecision[] {
    return listPendingTaskDecisions(this.db, filter);
  }

  answerDecision(input: AnswerTaskDecisionInput): AnswerTaskDecisionResult | undefined {
    return answerTaskDecision(this.db, input);
  }

  completeExternalTask(input: CompleteExternalTaskInput): CompleteExternalTaskResult {
    return completeExternalTask(this.db, input);
  }

  reserveMediaFeedbackAttempt(
    input: ReserveProductionMediaFeedbackAttemptInput,
  ): ReserveProductionMediaFeedbackAttemptResult {
    return reserveProductionMediaFeedbackAttempt(this.db, input);
  }

  reserveDeliveryPackageAttempt(
    input: ReserveDeliveryPackageTaskAttemptInput,
  ): ReserveDeliveryPackageTaskAttemptResult {
    return reserveDeliveryPackageTaskAttempt(this.db, input);
  }

  getDeliveryPackageAttempt(id: string): DeliveryPackageTaskAttempt | undefined {
    return getDeliveryPackageTaskAttempt(this.db, id);
  }

  getLatestDeliveryPackageAttempt(taskListId: TaskListId): DeliveryPackageTaskAttempt | undefined {
    return getLatestDeliveryPackageTaskAttempt(this.db, taskListId);
  }

  listRecoverableDeliveryPackageAttempts(): DeliveryPackageTaskAttempt[] {
    return listRecoverableDeliveryPackageTaskAttempts(this.db);
  }

  transitionDeliveryPackageAttempt(
    input: TransitionDeliveryPackageTaskAttemptInput,
  ): DeliveryPackageTaskAttempt {
    return transitionDeliveryPackageTaskAttempt(this.db, input);
  }

  retryDeliveryPackageAttempt(input: {
    id: string;
    expectedRowVersion: number;
    updatedAt: number;
  }): DeliveryPackageTaskAttempt {
    return retryDeliveryPackageTaskAttempt(this.db, input);
  }

  completeDeliveryPackageAttempt(input: CompleteDeliveryPackageTaskAttemptInput): {
    attempt: DeliveryPackageTaskAttempt;
    taskList: TaskList;
    event: TaskEvent;
  } {
    return completeDeliveryPackageTaskAttempt(this.db, input);
  }

  reserveProductionMediaAttempt(
    input: ReserveProductionMediaTaskAttemptInput,
  ): ReserveProductionMediaTaskAttemptResult {
    return reserveProductionMediaTaskAttempt(this.db, input);
  }

  beginMediaSubmission(input: BeginMediaSubmissionInput): BeginMediaSubmissionResult {
    return beginMediaSubmission(this.db, input);
  }

  recordMediaOutput(input: RecordMediaOutputInput): RecordMediaOutputResult {
    return recordMediaOutput(this.db, input);
  }

  getProductionMediaAttempt(id: string): ProductionMediaTaskAttempt | undefined {
    return getProductionMediaTaskAttempt(this.db, id);
  }

  getLatestProductionMediaAttempt(
    taskListId: TaskListId,
    nodeId: string,
  ): ProductionMediaTaskAttempt | undefined {
    return getLatestProductionMediaTaskAttempt(this.db, taskListId, nodeId);
  }

  listProductionMediaAttempts(taskListId: TaskListId): ProductionMediaTaskAttempt[] {
    return listProductionMediaTaskAttempts(this.db, taskListId);
  }

  listRecoverableProductionMediaAttempts(): ProductionMediaTaskAttempt[] {
    return listRecoverableProductionMediaTaskAttempts(this.db);
  }

  transitionProductionMediaAttempt(
    input: TransitionProductionMediaTaskAttemptInput,
  ): ProductionMediaTaskAttempt {
    return transitionProductionMediaTaskAttempt(this.db, input);
  }

  reserveTaskAttempt(input: ReserveTaskExecutionAttemptInput): {
    attempt: TaskExecutionAttempt;
    created: boolean;
  } {
    return reserveTaskExecutionAttempt(this.db, input);
  }

  getTaskAttempt(id: string): TaskExecutionAttempt | undefined {
    return getTaskExecutionAttempt(this.db, id);
  }

  listTaskAttempts(taskId: TaskId): TaskExecutionAttempt[] {
    return listTaskExecutionAttempts(this.db, taskId);
  }

  transitionTaskAttempt(input: TransitionTaskExecutionAttemptInput): TaskExecutionAttempt {
    return transitionTaskExecutionAttempt(this.db, input);
  }

  recordTaskEvaluation(input: RecordTaskEvaluationInput): RecordTaskEvaluationResult {
    return recordTaskEvaluation(this.db, input);
  }

  getTaskEvaluation(attemptId: string): TaskEvaluation | undefined {
    return getTaskEvaluation(this.db, attemptId);
  }

  listTaskEvaluations(taskListId: TaskListId): TaskEvaluation[] {
    return listTaskEvaluations(this.db, taskListId);
  }

  getTaskCostSummary(taskListId: TaskListId): TaskCostSummary {
    return getTaskCostSummary(this.db, taskListId);
  }

  insertTask(task: Task): void {
    insertTask(this.db, task);
  }

  listTasks(taskListId: TaskListId): ListResult<Task> {
    return filterDegraded(listTasks(this.db, taskListId), TaskRecordSchema, TASK_SENTINEL, 'Task');
  }

  listTasksByPhase(taskListId: TaskListId, phaseKey: string): ListResult<Task> {
    return filterDegraded(
      listTasksByPhase(this.db, taskListId, phaseKey),
      TaskRecordSchema,
      TASK_SENTINEL,
      'Task',
    );
  }

  listReadyTasks(taskListId?: TaskListId): ListResult<Task> {
    return filterDegraded(
      listReadyTasks(this.db, taskListId),
      TaskRecordSchema,
      TASK_SENTINEL,
      'Task',
    );
  }

  listAwaitingProviderTasks(taskListId?: TaskListId): ListResult<Task> {
    return filterDegraded(
      listAwaitingProviderTasks(this.db, taskListId),
      TaskRecordSchema,
      TASK_SENTINEL,
      'Task',
    );
  }

  listRecoverableTasks(taskListId?: TaskListId): ListResult<Task> {
    return filterDegraded(
      listRecoverableTasks(this.db, taskListId),
      TaskRecordSchema,
      TASK_SENTINEL,
      'Task',
    );
  }

  getTask(id: TaskId): Task | undefined {
    const value = getTask(this.db, id);
    if (!value) return undefined;
    const parsed = parseOrDegrade(TaskRecordSchema, value, TASK_SENTINEL as unknown as Task, {
      ctx: { name: 'Task' },
    });
    return (parsed as unknown) === TASK_SENTINEL ? undefined : (parsed as Task);
  }

  updateTask(id: TaskId, updates: Parameters<typeof updateTask>[2]): void {
    updateTask(this.db, id, updates);
  }

  replaceTaskDependencies(taskId: TaskId, dependencyIds: TaskId[]): void {
    replaceTaskDependencies(this.db, taskId, dependencyIds);
  }

  listTaskDependencies(taskId: TaskId): string[] {
    return listTaskDependencies(this.db, taskId);
  }

  listTaskDependenciesBatch(taskIds: TaskId[]): Map<string, string[]> {
    return listTaskDependenciesBatch(this.db, taskIds);
  }

  listTaskDependents(taskId: TaskId): string[] {
    return listTaskDependents(this.db, taskId);
  }

  insertArtifact(artifact: TaskArtifact): void {
    insertTaskArtifact(this.db, artifact);
  }

  getArtifactByAttempt(attemptId: string, artifactType: string): TaskArtifact | undefined {
    return getTaskArtifactByAttempt(this.db, attemptId, artifactType);
  }

  listArtifacts(taskListId: TaskListId): TaskArtifact[] {
    return listTaskArtifacts(this.db, taskListId);
  }

  listEntityArtifacts(entityType: string, entityId: string): TaskArtifact[] {
    return listEntityArtifacts(this.db, entityType, entityId);
  }

  listArtifactsByTask(taskId: TaskId): TaskArtifact[] {
    return listTaskArtifactsByTask(this.db, taskId);
  }

  listArtifactsByTaskBatch(taskIds: TaskId[]): Map<string, TaskArtifact[]> {
    return listTaskArtifactsByTaskBatch(this.db, taskIds);
  }

  listTaskSummaries(filter?: Parameters<typeof listTaskSummaries>[1]): TaskSummary[] {
    return listTaskSummaries(this.db, filter);
  }

  recomputePhaseAggregate(taskListId: TaskListId, phaseKey: string): void {
    recomputePhaseAggregate(this.db, taskListId, phaseKey);
  }

  recomputeTaskListAggregate(taskListId: TaskListId): void {
    recomputeTaskListAggregate(this.db, taskListId);
  }
}
