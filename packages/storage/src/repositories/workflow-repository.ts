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
  WorkflowArtifact,
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
  getWorkflowRun as _getWorkflowRun,
  getWorkflowStageRun as _getWorkflowStageRun,
  getWorkflowTaskRun as _getWorkflowTaskRun,
  insertWorkflowArtifact as _insertWorkflowArtifact,
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
  listWorkflowRuns as _listWorkflowRuns,
  listWorkflowStageRuns as _listWorkflowStageRuns,
  listWorkflowTaskRuns as _listWorkflowTaskRuns,
  listWorkflowTaskRunsByStage as _listWorkflowTaskRunsByStage,
  listWorkflowTaskSummaries as _listWorkflowTaskSummaries,
  recomputeStageAggregate as _recomputeStageAggregate,
  recomputeWorkflowAggregate as _recomputeWorkflowAggregate,
  updateWorkflowRun as _updateWorkflowRun,
  updateWorkflowStageRun as _updateWorkflowStageRun,
  updateWorkflowTaskRun as _updateWorkflowTaskRun,
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
