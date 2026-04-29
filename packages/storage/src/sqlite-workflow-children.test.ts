import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkflowArtifact, WorkflowStageRun, WorkflowTaskRun } from '@lucid-fin/contracts';
import { StageRunStatus, TaskKind, TaskRunStatus, WorkflowRunStatus } from '@lucid-fin/contracts';
import { SqliteIndex } from './sqlite-index.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-children-'));
}

describe('workflow child storage helpers', () => {
  let db: SqliteIndex;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));

    db.repos.workflows.insertRun({
      id: 'wf-1',
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
      currentStageId: 'stage-1',
      currentTaskId: 'task-ready',
      input: {},
      output: {},
      metadata: {
        displayCategory: 'Storyboard',
        displayLabel: 'Generate storyboard',
        relatedEntityLabel: 'Opening Scene',
      },
      createdAt: 1,
      updatedAt: 1,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('gets single stage rows, keeps dependency reads aligned, and lists artifacts by task run', () => {
    const insertStageRun = (stageRun: WorkflowStageRun) =>
      db.repos.workflows.insertStageRun(stageRun);
    const insertTaskRun = (taskRun: WorkflowTaskRun) => db.repos.workflows.insertTaskRun(taskRun);
    const insertArtifact = (artifact: WorkflowArtifact) =>
      db.repos.workflows.insertArtifact(artifact);

    insertStageRun({
      id: 'stage-1',
      workflowRunId: 'wf-1',
      stageId: 'plan',
      name: 'Plan',
      status: StageRunStatus.Ready,
      order: 0,
      progress: 50,
      completedTasks: 0,
      totalTasks: 2,
      metadata: {},
      updatedAt: 10,
    });
    insertStageRun({
      id: 'stage-2',
      workflowRunId: 'wf-1',
      stageId: 'render',
      name: 'Render',
      status: StageRunStatus.Pending,
      order: 1,
      progress: 0,
      completedTasks: 0,
      totalTasks: 1,
      metadata: {},
      updatedAt: 11,
    });

    insertTaskRun({
      id: 'task-ready',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-1',
      taskId: 'draft-frames',
      name: 'Draft frames',
      kind: TaskKind.AdapterGeneration,
      status: TaskRunStatus.Ready,
      dependencyIds: [],
      attempts: 0,
      maxRetries: 2,
      input: {},
      output: {},
      progress: 0,
      updatedAt: 20,
    });
    insertTaskRun({
      id: 'task-awaiting',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-2',
      taskId: 'provider-poll',
      name: 'Provider poll',
      kind: TaskKind.ProviderPoll,
      status: TaskRunStatus.AwaitingProvider,
      dependencyIds: ['task-ready'],
      attempts: 1,
      maxRetries: 2,
      input: {},
      output: {},
      providerTaskId: 'provider-1',
      progress: 25,
      updatedAt: 30,
    });

    db.repos.workflows.updateTaskRun('task-awaiting', {
      dependencyIds: ['task-ready'],
      updatedAt: 31,
    });

    insertArtifact({
      id: 'artifact-2',
      workflowRunId: 'wf-1',
      taskRunId: 'task-awaiting',
      artifactType: 'manifest',
      entityType: 'scene',
      entityId: 'scene-1',
      path: 'artifacts/task-awaiting.json',
      metadata: { role: 'manifest' },
      createdAt: 41,
    });
    insertArtifact({
      id: 'artifact-1',
      workflowRunId: 'wf-1',
      taskRunId: 'task-awaiting',
      artifactType: 'preview',
      entityType: 'scene',
      entityId: 'scene-1',
      assetHash: 'asset-1',
      path: 'artifacts/task-awaiting.png',
      metadata: { role: 'preview' },
      createdAt: 40,
    });

    expect(db.repos.workflows.getStageRun('stage-1')).toEqual({
      id: 'stage-1',
      workflowRunId: 'wf-1',
      stageId: 'plan',
      name: 'Plan',
      status: StageRunStatus.Ready,
      order: 0,
      progress: 50,
      completedTasks: 0,
      totalTasks: 2,
      metadata: {},
      updatedAt: 10,
    });
    expect(db.repos.workflows.listTaskDependencies('task-awaiting')).toEqual(['task-ready']);
    expect(db.repos.workflows.listTaskDependents('task-ready')).toEqual(['task-awaiting']);
    expect(db.repos.workflows.listReadyTasks().rows.map((task) => task.id)).toEqual(['task-ready']);
    expect(db.repos.workflows.listAwaitingProviderTasks().rows.map((task) => task.id)).toEqual([
      'task-awaiting',
    ]);
    expect(db.repos.workflows.listArtifactsByTaskRun('task-awaiting')).toEqual([
      {
        id: 'artifact-2',
        workflowRunId: 'wf-1',
        taskRunId: 'task-awaiting',
        artifactType: 'manifest',
        entityType: 'scene',
        entityId: 'scene-1',
        path: 'artifacts/task-awaiting.json',
        metadata: { role: 'manifest' },
        createdAt: 41,
      },
      {
        id: 'artifact-1',
        workflowRunId: 'wf-1',
        taskRunId: 'task-awaiting',
        artifactType: 'preview',
        entityType: 'scene',
        entityId: 'scene-1',
        assetHash: 'asset-1',
        path: 'artifacts/task-awaiting.png',
        metadata: { role: 'preview' },
        createdAt: 40,
      },
    ]);
  });
});
