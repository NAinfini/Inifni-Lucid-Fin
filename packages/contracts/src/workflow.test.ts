import { describe, expect, it } from 'vitest';
import {
  WorkflowRunStatus,
  StageRunStatus,
  TaskRunStatus,
  type WorkflowRun,
  type WorkflowStageRun,
  type WorkflowTaskRun,
} from './index.js';

describe('workflow contracts', () => {
  it('exports workflow statuses', () => {
    expect(WorkflowRunStatus.Running).toBe('running');
    expect(StageRunStatus.Pending).toBe('pending');
    expect(TaskRunStatus.Completed).toBe('completed');
  });

  it('supports workflow run shapes', () => {
    const run: WorkflowRun = {
      id: 'wf-1',
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      triggerSource: 'user',
      status: WorkflowRunStatus.Queued,
      summary: '',
      progress: 0,
      completedStages: 0,
      totalStages: 1,
      completedTasks: 0,
      totalTasks: 1,
      input: {},
      output: {},
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    };

    expect(run.workflowType).toBe('storyboard.generate');
  });

  it('supports stage and task run shapes', () => {
    const stage: WorkflowStageRun = {
      id: 'stage-1',
      workflowRunId: 'wf-1',
      stageId: 'validate',
      name: 'Validate',
      status: StageRunStatus.Ready,
      order: 0,
      progress: 0,
      completedTasks: 0,
      totalTasks: 1,
      metadata: {},
      updatedAt: 1,
    };

    const task: WorkflowTaskRun = {
      id: 'task-1',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-1',
      taskId: 'validate-input',
      name: 'Validate input',
      kind: 'validation',
      status: TaskRunStatus.Pending,
      dependencyIds: [],
      attempts: 0,
      maxRetries: 0,
      input: {},
      output: {},
      progress: 0,
      updatedAt: 1,
    };

    expect(stage.stageId).toBe('validate');
    expect(task.taskId).toBe('validate-input');
  });
});
