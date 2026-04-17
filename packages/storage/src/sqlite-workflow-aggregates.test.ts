import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StageRunStatus, TaskKind, TaskRunStatus, WorkflowRunStatus } from '@lucid-fin/contracts';
import { SqliteIndex } from './sqlite-index.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-aggregates-'));
}

describe('workflow aggregate recomputation', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('recomputes stage and workflow aggregates through ready, running, and mixed terminal states', () => {
    db.repos.workflows.insertRun({
      id: 'wf-agg',
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      triggerSource: 'user',
      status: WorkflowRunStatus.Queued,
      summary: 'queued',
      progress: 0,
      completedStages: 0,
      totalStages: 2,
      completedTasks: 0,
      totalTasks: 3,
      input: {},
      output: {},
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    });

    db.repos.workflows.insertStageRun({
      id: 'stage-ready',
      workflowRunId: 'wf-agg',
      stageId: 'prepare',
      name: 'Prepare',
      status: StageRunStatus.Pending,
      order: 0,
      progress: 0,
      completedTasks: 0,
      totalTasks: 2,
      metadata: {},
      updatedAt: 2,
    });
    db.repos.workflows.insertStageRun({
      id: 'stage-final',
      workflowRunId: 'wf-agg',
      stageId: 'render',
      name: 'Render',
      status: StageRunStatus.Pending,
      order: 1,
      progress: 0,
      completedTasks: 0,
      totalTasks: 1,
      metadata: {},
      updatedAt: 3,
    });

    db.repos.workflows.insertTaskRun({
      id: 'task-ready',
      workflowRunId: 'wf-agg',
      stageRunId: 'stage-ready',
      taskId: 'prepare-inputs',
      name: 'Prepare inputs',
      kind: TaskKind.Validation,
      status: TaskRunStatus.Ready,
      dependencyIds: [],
      attempts: 0,
      maxRetries: 1,
      input: {},
      output: {},
      progress: 0,
      updatedAt: 10,
    });
    db.repos.workflows.insertTaskRun({
      id: 'task-running',
      workflowRunId: 'wf-agg',
      stageRunId: 'stage-ready',
      taskId: 'draft-frames',
      name: 'Draft frames',
      kind: TaskKind.AdapterGeneration,
      status: TaskRunStatus.Running,
      dependencyIds: [],
      attempts: 1,
      maxRetries: 2,
      input: {},
      output: {},
      progress: 50,
      updatedAt: 20,
    });
    db.repos.workflows.insertTaskRun({
      id: 'task-failed',
      workflowRunId: 'wf-agg',
      stageRunId: 'stage-final',
      taskId: 'render-final',
      name: 'Render final',
      kind: TaskKind.Export,
      status: TaskRunStatus.RetryableFailed,
      dependencyIds: ['task-running'],
      attempts: 1,
      maxRetries: 2,
      input: {},
      output: {},
      error: 'provider timeout',
      progress: 100,
      updatedAt: 30,
    });

    db.repos.workflows.recomputeStageAggregate('stage-ready');
    db.repos.workflows.recomputeStageAggregate('stage-final');
    db.repos.workflows.recomputeWorkflowAggregate('wf-agg');

    expect(db.repos.workflows.listStageRuns('wf-agg').rows).toEqual([
      expect.objectContaining({
        id: 'stage-ready',
        status: StageRunStatus.Running,
        totalTasks: 2,
        completedTasks: 0,
        progress: 25,
      }),
      expect.objectContaining({
        id: 'stage-final',
        status: StageRunStatus.Failed,
        totalTasks: 1,
        completedTasks: 0,
        progress: 100,
      }),
    ]);
    expect(db.repos.workflows.getRun('wf-agg')).toMatchObject({
      id: 'wf-agg',
      status: WorkflowRunStatus.Running,
      currentStageId: 'stage-ready',
      currentTaskId: 'task-running',
      completedStages: 0,
      totalStages: 2,
      completedTasks: 0,
      totalTasks: 3,
      summary: 'running 0/2 stages, 0/3 tasks',
      updatedAt: 30,
    });

    db.repos.workflows.updateTaskRun('task-running', {
      status: TaskRunStatus.Completed,
      progress: 100,
      completedAt: 31,
      updatedAt: 31,
    });
    db.repos.workflows.updateTaskRun('task-ready', {
      status: TaskRunStatus.Completed,
      progress: 100,
      completedAt: 32,
      updatedAt: 32,
    });
    db.repos.workflows.updateTaskRun('task-failed', {
      status: TaskRunStatus.Completed,
      progress: 100,
      completedAt: 33,
      updatedAt: 33,
    });

    db.repos.workflows.recomputeStageAggregate('stage-ready');
    db.repos.workflows.recomputeStageAggregate('stage-final');
    db.repos.workflows.recomputeWorkflowAggregate('wf-agg');

    expect(db.repos.workflows.listStageRuns('wf-agg').rows).toEqual([
      expect.objectContaining({
        id: 'stage-ready',
        status: StageRunStatus.Completed,
        completedTasks: 2,
        totalTasks: 2,
        progress: 100,
      }),
      expect.objectContaining({
        id: 'stage-final',
        status: StageRunStatus.Completed,
        completedTasks: 1,
        totalTasks: 1,
        progress: 100,
      }),
    ]);
    expect(db.repos.workflows.getRun('wf-agg')).toMatchObject({
      id: 'wf-agg',
      status: WorkflowRunStatus.Completed,
      currentStageId: undefined,
      currentTaskId: undefined,
      completedStages: 2,
      totalStages: 2,
      completedTasks: 3,
      totalTasks: 3,
      progress: 100,
      summary: 'completed 2/2 stages, 3/3 tasks',
      updatedAt: 33,
    });
  });
});
