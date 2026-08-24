import { describe, expect, it } from 'vitest';
import {
  TASK_LIST_TERMINAL_STATUSES,
  TaskListStatus,
  TaskStatus,
  isTaskListTerminalStatus,
  type TaskList,
  type Task,
} from './index.js';

describe('task execution contracts', () => {
  it('exports task execution statuses', () => {
    expect(TaskListStatus.Running).toBe('running');
    expect(TaskStatus.Completed).toBe('completed');
  });

  it('keeps one canonical Task List terminal-status definition', () => {
    expect(TASK_LIST_TERMINAL_STATUSES).toEqual([
      'completed',
      'completed_with_errors',
      'failed',
      'cancelled',
      'dead',
    ]);
    expect(isTaskListTerminalStatus(TaskListStatus.Completed)).toBe(true);
    expect(isTaskListTerminalStatus(TaskListStatus.AwaitingApproval)).toBe(false);
  });

  it('supports task-list shapes', () => {
    const run: TaskList = {
      id: 'wf-1',
      taskListType: 'storyboard.generate',
      entityType: 'scene',
      triggerSource: 'user',
      status: TaskListStatus.Queued,
      summary: '',
      progress: 0,
      completedPhases: 0,
      totalPhases: 1,
      completedTasks: 0,
      totalTasks: 1,
      input: {},
      output: {},
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    };

    expect(run.taskListType).toBe('storyboard.generate');
  });

  it('supports task shapes', () => {
    const task: Task = {
      id: 'task-1',
      taskListId: 'wf-1',
      phaseKey: 'validate',
      phaseName: 'Validate',
      phaseOrder: 0,
      taskKey: 'validate-input',
      name: 'Validate input',
      kind: 'validation',
      status: TaskStatus.Pending,
      dependencyIds: [],
      attempts: 0,
      maxRetries: 0,
      input: {},
      output: {},
      progress: 0,
      updatedAt: 1,
    };

    expect(task.phaseKey).toBe('validate');
    expect(task.taskKey).toBe('validate-input');
  });
});
