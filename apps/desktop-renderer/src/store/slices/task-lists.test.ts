import { describe, expect, it } from 'vitest';
import type { TaskListSummary, TaskSummary } from '@lucid-fin/contracts';

import {
  loadTaskLists,
  loadTaskListTasks,
  setTaskListSummaries,
  setTaskListTasks,
  taskListsSlice,
  upsertTaskListSummary,
} from './task-lists.js';

function taskList(id: string, updatedAt: number): TaskListSummary {
  return {
    id,
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'running',
    summary: 'Producing movie',
    progress: 50,
    completedPhases: 1,
    totalPhases: 3,
    completedTasks: 1,
    totalTasks: 2,
    displayCategory: 'production',
    displayLabel: 'Movie production',
    createdAt: 1,
    updatedAt,
  };
}

describe('taskListsSlice', () => {
  it('keeps the host task list projection sorted by recency', () => {
    let state = taskListsSlice.reducer(
      undefined,
      setTaskListSummaries([taskList('older', 2), taskList('newer', 3)]),
    );
    expect(state.allIds).toEqual(['newer', 'older']);

    state = taskListsSlice.reducer(state, upsertTaskListSummary(taskList('older', 4)));
    expect(state.allIds).toEqual(['older', 'newer']);
  });

  it('stores durable task projections without optimistic execution controls', () => {
    const task: TaskSummary = {
      id: 'task-1',
      taskListId: 'list-1',
      phaseKey: 'planning',
      phaseName: 'Planning',
      phaseOrder: 0,
      taskKey: 'production-plan',
      kind: 'validation',
      status: 'running',
      displayCategory: 'planning',
      displayLabel: 'Create production plan',
      updatedAt: 2,
    };

    const state = taskListsSlice.reducer(
      undefined,
      setTaskListTasks({ taskListId: 'list-1', tasks: [task] }),
    );
    expect(state.tasksByTaskListId['list-1']).toEqual([task]);
    expect(loadTaskLists({}).type).toBe('taskLists/loadTaskLists');
    expect(loadTaskListTasks('list-1').type).toBe('taskLists/loadTaskListTasks');
  });
});
