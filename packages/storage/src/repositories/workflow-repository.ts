/**
 * WorkflowRepository — Phase G1-2.11.
 *
 * Consolidates the full workflow-domain surface (runs → stages → tasks →
 * dependencies → artifacts + aggregate recomputation) behind branded IDs
 * and fault-soft getters.
 *
 * The workflow SQL is large (~1100 lines including aggregate recomputation
 * and DAG walk helpers). To keep this PR focused and low-risk, the repo is
 * a **thin wrapper** that delegates to `sqlite-workflows.js` for mutations
 * and scalar fetch helpers, and layers `parseOrDegrade` over the `get*` /
 * `list*` read paths so corrupt rows surface as degraded telemetry + skip
 * instead of crashing the Workflow tab.
 *
 * G1-4 consumer migration will decide whether to inline the SQL into this
 * repo or keep it in the legacy module; either way, this repo becomes the
 * single API surface that SqliteIndex and feature code talk to.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  ApproveWorkflowGateInput,
  ApproveWorkflowGateResult,
  WorkflowApproval,
  WorkflowArtifact,
  WorkflowDocument,
  WorkflowEvent,
  WorkflowExportExecution,
  WorkflowMediaAttempt,
  WorkflowMediaCostSummary,
  WorkflowMediaEvaluation,
  WorkflowRun,
  WorkflowRunId,
  WorkflowStageId,
  WorkflowStageRun,
  WorkflowTaskId,
  WorkflowTaskRun,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import {
  parseOrDegrade,
  WorkflowRunRecordSchema,
  WorkflowStageRunRecordSchema,
  WorkflowTaskRunRecordSchema,
} from '@lucid-fin/contracts-parse';
import {
  approveWorkflowGate as _approveWorkflowGate,
  completeWorkflowExportExecution as _completeWorkflowExportExecution,
  getLatestWorkflowExportExecution as _getLatestWorkflowExportExecution,
  getLatestWorkflowMediaAttempt as _getLatestWorkflowMediaAttempt,
  getWorkflowExportExecution as _getWorkflowExportExecution,
  getWorkflowMediaAttempt as _getWorkflowMediaAttempt,
  getWorkflowMediaCostSummary as _getWorkflowMediaCostSummary,
  getWorkflowMediaEvaluation as _getWorkflowMediaEvaluation,
  getLatestWorkflowDocument as _getLatestWorkflowDocument,
  getWorkflowDocumentRevision as _getWorkflowDocumentRevision,
  getLatestWorkflowApproval as _getLatestWorkflowApproval,
  getPendingWorkflowApproval as _getPendingWorkflowApproval,
  getWorkflowRun as _getWorkflowRun,
  getWorkflowStageRun as _getWorkflowStageRun,
  getWorkflowTaskRun as _getWorkflowTaskRun,
  insertPendingWorkflowApproval as _insertPendingWorkflowApproval,
  insertWorkflowApprovalGateBundle as _insertWorkflowApprovalGateBundle,
  insertWorkflowApprovalGateRevision as _insertWorkflowApprovalGateRevision,
  insertWorkflowArtifact as _insertWorkflowArtifact,
  insertWorkflowDocument as _insertWorkflowDocument,
  insertWorkflowRun as _insertWorkflowRun,
  insertWorkflowStageRun as _insertWorkflowStageRun,
  insertWorkflowTaskDependency as _insertWorkflowTaskDependency,
  insertWorkflowTaskRun as _insertWorkflowTaskRun,
  listAwaitingProviderTasks as _listAwaitingProviderTasks,
  listEntityArtifacts as _listEntityArtifacts,
  listReadyWorkflowTasks as _listReadyWorkflowTasks,
  listTaskDependencies as _listTaskDependencies,
  listTaskDependenciesBatch as _listTaskDependenciesBatch,
  listTaskDependents as _listTaskDependents,
  listWorkflowArtifacts as _listWorkflowArtifacts,
  listWorkflowArtifactsByTaskRun as _listWorkflowArtifactsByTaskRun,
  listWorkflowArtifactsByTaskRunBatch as _listWorkflowArtifactsByTaskRunBatch,
  listWorkflowEvents as _listWorkflowEvents,
  listRecoverableWorkflowExportExecutions as _listRecoverableWorkflowExportExecutions,
  listRecoverableWorkflowMediaAttempts as _listRecoverableWorkflowMediaAttempts,
  listWorkflowMediaAttempts as _listWorkflowMediaAttempts,
  listWorkflowMediaEvaluations as _listWorkflowMediaEvaluations,
  listWorkflowRuns as _listWorkflowRuns,
  listWorkflowStageRuns as _listWorkflowStageRuns,
  listWorkflowTaskRuns as _listWorkflowTaskRuns,
  listWorkflowTaskRunsByStage as _listWorkflowTaskRunsByStage,
  listWorkflowTaskSummaries as _listWorkflowTaskSummaries,
  recomputeStageAggregate as _recomputeStageAggregate,
  recomputeWorkflowAggregate as _recomputeWorkflowAggregate,
  recordWorkflowMediaEvaluation as _recordWorkflowMediaEvaluation,
  reserveWorkflowExportExecution as _reserveWorkflowExportExecution,
  reserveWorkflowMediaAttempt as _reserveWorkflowMediaAttempt,
  retryWorkflowExportExecution as _retryWorkflowExportExecution,
  transitionWorkflowExportExecution as _transitionWorkflowExportExecution,
  transitionWorkflowMediaAttempt as _transitionWorkflowMediaAttempt,
  updateWorkflowRun as _updateWorkflowRun,
  updateWorkflowStageRun as _updateWorkflowStageRun,
  updateWorkflowTaskRun as _updateWorkflowTaskRun,
  type WorkflowApprovalGateBundle,
  type WorkflowApprovalGateRevisionBundle,
  type WorkflowApprovalGateRevisionResult,
  type CompleteWorkflowExportExecutionInput,
  type RecordWorkflowMediaEvaluationInput,
  type RecordWorkflowMediaEvaluationResult,
  type ReserveWorkflowExportExecutionInput,
  type ReserveWorkflowExportExecutionResult,
  type ReserveWorkflowMediaAttemptInput,
  type ReserveWorkflowMediaAttemptResult,
  type TransitionWorkflowExportExecutionInput,
  type TransitionWorkflowMediaAttemptInput,
} from '../sqlite-workflows.js';

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

const RUN_SENTINEL = Symbol('workflow-run-degraded');
const STAGE_SENTINEL = Symbol('workflow-stage-degraded');
const TASK_SENTINEL = Symbol('workflow-task-degraded');

function filterDegraded<T>(
  items: T[],
  schema: Parameters<typeof parseOrDegrade>[0],
  sentinel: symbol,
  ctxName: string,
): ListResult<T> {
  const out: T[] = [];
  let degradedCount = 0;
  for (const item of items) {
    const parsed = parseOrDegrade(schema, item, sentinel as unknown as T, {
      ctx: { name: ctxName },
    });
    if ((parsed as unknown) === sentinel) {
      degradedCount += 1;
      continue;
    }
    out.push(parsed as T);
  }
  return { rows: out, degradedCount };
}

export class WorkflowRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  // ── Runs ───────────────────────────────────────────────────────

  insertRun(run: WorkflowRun): void {
    _insertWorkflowRun(this.db, run);
  }

  getRun(id: WorkflowRunId): WorkflowRun | undefined {
    const raw = _getWorkflowRun(this.db, id);
    if (!raw) return undefined;
    const parsed = parseOrDegrade(
      WorkflowRunRecordSchema,
      raw,
      RUN_SENTINEL as unknown as WorkflowRun,
      { ctx: { name: 'WorkflowRun' } },
    );
    return (parsed as unknown) === RUN_SENTINEL ? undefined : (parsed as WorkflowRun);
  }

  listRuns(filter?: Parameters<typeof _listWorkflowRuns>[1]): ListResult<WorkflowRun> {
    return filterDegraded<WorkflowRun>(
      _listWorkflowRuns(this.db, filter),
      WorkflowRunRecordSchema,
      RUN_SENTINEL,
      'WorkflowRun',
    );
  }

  updateRun(id: WorkflowRunId, updates: Parameters<typeof _updateWorkflowRun>[2]): void {
    _updateWorkflowRun(this.db, id, updates);
  }

  // ── Persistent documents, approvals, and events ───────────────

  createApprovalGateBundle(bundle: WorkflowApprovalGateBundle): void {
    _insertWorkflowApprovalGateBundle(this.db, bundle);
  }

  createApprovalGateRevision(
    bundle: WorkflowApprovalGateRevisionBundle,
  ): WorkflowApprovalGateRevisionResult {
    return _insertWorkflowApprovalGateRevision(this.db, bundle);
  }

  createDocument(document: WorkflowDocument): void {
    _insertWorkflowDocument(this.db, document);
  }

  getLatestDocument(
    workflowRunId: WorkflowRunId,
    logicalKey: string,
  ): WorkflowDocument | undefined {
    return _getLatestWorkflowDocument(this.db, workflowRunId, logicalKey);
  }

  getDocumentRevision(
    workflowRunId: WorkflowRunId,
    logicalKey: string,
    revision: number,
  ): WorkflowDocument | undefined {
    return _getWorkflowDocumentRevision(this.db, workflowRunId, logicalKey, revision);
  }

  createPendingApproval(approval: WorkflowApproval): void {
    _insertPendingWorkflowApproval(this.db, approval);
  }

  getPendingApproval(
    workflowRunId: WorkflowRunId,
    gateKey: WorkflowApproval['gateKey'],
  ): WorkflowApproval | undefined {
    return _getPendingWorkflowApproval(this.db, workflowRunId, gateKey);
  }

  getLatestApproval(
    workflowRunId: WorkflowRunId,
    gateKey: WorkflowApproval['gateKey'],
  ): WorkflowApproval | undefined {
    return _getLatestWorkflowApproval(this.db, workflowRunId, gateKey);
  }

  approveGate(input: ApproveWorkflowGateInput): ApproveWorkflowGateResult {
    return _approveWorkflowGate(this.db, input);
  }

  listEvents(workflowRunId: WorkflowRunId): WorkflowEvent[] {
    return _listWorkflowEvents(this.db, workflowRunId);
  }

  reserveExportExecution(
    input: ReserveWorkflowExportExecutionInput,
  ): ReserveWorkflowExportExecutionResult {
    return _reserveWorkflowExportExecution(this.db, input);
  }

  getExportExecution(id: string): WorkflowExportExecution | undefined {
    return _getWorkflowExportExecution(this.db, id);
  }

  getLatestExportExecution(workflowRunId: WorkflowRunId): WorkflowExportExecution | undefined {
    return _getLatestWorkflowExportExecution(this.db, workflowRunId);
  }

  listRecoverableExportExecutions(): WorkflowExportExecution[] {
    return _listRecoverableWorkflowExportExecutions(this.db);
  }

  transitionExportExecution(
    input: TransitionWorkflowExportExecutionInput,
  ): WorkflowExportExecution {
    return _transitionWorkflowExportExecution(this.db, input);
  }

  retryExportExecution(input: {
    id: string;
    expectedRowVersion: number;
    updatedAt: number;
  }): WorkflowExportExecution {
    return _retryWorkflowExportExecution(this.db, input);
  }

  completeExportExecution(input: CompleteWorkflowExportExecutionInput): {
    execution: WorkflowExportExecution;
    run: WorkflowRun;
    event: WorkflowEvent;
  } {
    return _completeWorkflowExportExecution(this.db, input);
  }

  reserveMediaAttempt(input: ReserveWorkflowMediaAttemptInput): ReserveWorkflowMediaAttemptResult {
    return _reserveWorkflowMediaAttempt(this.db, input);
  }

  getMediaAttempt(id: string): WorkflowMediaAttempt | undefined {
    return _getWorkflowMediaAttempt(this.db, id);
  }

  getLatestMediaAttempt(
    workflowRunId: WorkflowRunId,
    nodeId: string,
  ): WorkflowMediaAttempt | undefined {
    return _getLatestWorkflowMediaAttempt(this.db, workflowRunId, nodeId);
  }

  listMediaAttempts(workflowRunId: WorkflowRunId): WorkflowMediaAttempt[] {
    return _listWorkflowMediaAttempts(this.db, workflowRunId);
  }

  listRecoverableMediaAttempts(): WorkflowMediaAttempt[] {
    return _listRecoverableWorkflowMediaAttempts(this.db);
  }

  transitionMediaAttempt(input: TransitionWorkflowMediaAttemptInput): WorkflowMediaAttempt {
    return _transitionWorkflowMediaAttempt(this.db, input);
  }

  recordMediaEvaluation(
    input: RecordWorkflowMediaEvaluationInput,
  ): RecordWorkflowMediaEvaluationResult {
    return _recordWorkflowMediaEvaluation(this.db, input);
  }

  getMediaEvaluation(attemptId: string): WorkflowMediaEvaluation | undefined {
    return _getWorkflowMediaEvaluation(this.db, attemptId);
  }

  listMediaEvaluations(workflowRunId: WorkflowRunId): WorkflowMediaEvaluation[] {
    return _listWorkflowMediaEvaluations(this.db, workflowRunId);
  }

  getMediaCostSummary(workflowRunId: WorkflowRunId): WorkflowMediaCostSummary {
    return _getWorkflowMediaCostSummary(this.db, workflowRunId);
  }

  // ── Stage runs ─────────────────────────────────────────────────

  insertStageRun(stageRun: WorkflowStageRun): void {
    _insertWorkflowStageRun(this.db, stageRun);
  }

  listStageRuns(workflowRunId: WorkflowRunId): ListResult<WorkflowStageRun> {
    return filterDegraded<WorkflowStageRun>(
      _listWorkflowStageRuns(this.db, workflowRunId),
      WorkflowStageRunRecordSchema,
      STAGE_SENTINEL,
      'WorkflowStageRun',
    );
  }

  getStageRun(id: WorkflowStageId): WorkflowStageRun | undefined {
    const raw = _getWorkflowStageRun(this.db, id);
    if (!raw) return undefined;
    const parsed = parseOrDegrade(
      WorkflowStageRunRecordSchema,
      raw,
      STAGE_SENTINEL as unknown as WorkflowStageRun,
      { ctx: { name: 'WorkflowStageRun' } },
    );
    return (parsed as unknown) === STAGE_SENTINEL ? undefined : (parsed as WorkflowStageRun);
  }

  updateStageRun(
    id: WorkflowStageId,
    updates: Parameters<typeof _updateWorkflowStageRun>[2],
  ): void {
    _updateWorkflowStageRun(this.db, id, updates);
  }

  // ── Task runs ──────────────────────────────────────────────────

  insertTaskRun(taskRun: WorkflowTaskRun): void {
    _insertWorkflowTaskRun(this.db, taskRun);
  }

  listTaskRuns(workflowRunId: WorkflowRunId): ListResult<WorkflowTaskRun> {
    return filterDegraded<WorkflowTaskRun>(
      _listWorkflowTaskRuns(this.db, workflowRunId),
      WorkflowTaskRunRecordSchema,
      TASK_SENTINEL,
      'WorkflowTaskRun',
    );
  }

  listTaskRunsByStage(stageRunId: WorkflowStageId): ListResult<WorkflowTaskRun> {
    return filterDegraded<WorkflowTaskRun>(
      _listWorkflowTaskRunsByStage(this.db, stageRunId),
      WorkflowTaskRunRecordSchema,
      TASK_SENTINEL,
      'WorkflowTaskRun',
    );
  }

  listReadyTasks(workflowRunId?: WorkflowRunId): ListResult<WorkflowTaskRun> {
    return filterDegraded<WorkflowTaskRun>(
      _listReadyWorkflowTasks(this.db, workflowRunId),
      WorkflowTaskRunRecordSchema,
      TASK_SENTINEL,
      'WorkflowTaskRun',
    );
  }

  listAwaitingProviderTasks(workflowRunId?: WorkflowRunId): ListResult<WorkflowTaskRun> {
    return filterDegraded<WorkflowTaskRun>(
      _listAwaitingProviderTasks(this.db, workflowRunId),
      WorkflowTaskRunRecordSchema,
      TASK_SENTINEL,
      'WorkflowTaskRun',
    );
  }

  getTaskRun(id: WorkflowTaskId): WorkflowTaskRun | undefined {
    const raw = _getWorkflowTaskRun(this.db, id);
    if (!raw) return undefined;
    const parsed = parseOrDegrade(
      WorkflowTaskRunRecordSchema,
      raw,
      TASK_SENTINEL as unknown as WorkflowTaskRun,
      { ctx: { name: 'WorkflowTaskRun' } },
    );
    return (parsed as unknown) === TASK_SENTINEL ? undefined : (parsed as WorkflowTaskRun);
  }

  updateTaskRun(id: WorkflowTaskId, updates: Parameters<typeof _updateWorkflowTaskRun>[2]): void {
    _updateWorkflowTaskRun(this.db, id, updates);
  }

  // ── Task dependencies ──────────────────────────────────────────

  insertTaskDependency(taskRunId: WorkflowTaskId, dependsOnTaskRunId: WorkflowTaskId): void {
    _insertWorkflowTaskDependency(this.db, taskRunId, dependsOnTaskRunId);
  }

  listTaskDependencies(taskRunId: WorkflowTaskId): string[] {
    return _listTaskDependencies(this.db, taskRunId);
  }

  listTaskDependenciesBatch(taskRunIds: WorkflowTaskId[]): Map<string, string[]> {
    return _listTaskDependenciesBatch(this.db, taskRunIds as string[]);
  }

  listTaskDependents(taskRunId: WorkflowTaskId): string[] {
    return _listTaskDependents(this.db, taskRunId);
  }

  // ── Artifacts ──────────────────────────────────────────────────

  insertArtifact(artifact: WorkflowArtifact): void {
    _insertWorkflowArtifact(this.db, artifact);
  }

  listArtifacts(workflowRunId: WorkflowRunId): WorkflowArtifact[] {
    return _listWorkflowArtifacts(this.db, workflowRunId);
  }

  listEntityArtifacts(entityType: string, entityId: string): WorkflowArtifact[] {
    return _listEntityArtifacts(this.db, entityType, entityId);
  }

  listArtifactsByTaskRun(taskRunId: WorkflowTaskId): WorkflowArtifact[] {
    return _listWorkflowArtifactsByTaskRun(this.db, taskRunId);
  }

  listArtifactsByTaskRunBatch(taskRunIds: WorkflowTaskId[]): Map<string, WorkflowArtifact[]> {
    return _listWorkflowArtifactsByTaskRunBatch(this.db, taskRunIds as string[]);
  }

  // ── Summaries + aggregates ─────────────────────────────────────

  listTaskSummaries(
    filter?: Parameters<typeof _listWorkflowTaskSummaries>[1],
  ): WorkflowTaskSummary[] {
    return _listWorkflowTaskSummaries(this.db, filter);
  }

  recomputeStageAggregate(stageRunId: WorkflowStageId): void {
    _recomputeStageAggregate(this.db, stageRunId);
  }

  recomputeWorkflowAggregate(workflowRunId: WorkflowRunId): void {
    _recomputeWorkflowAggregate(this.db, workflowRunId);
  }
}
