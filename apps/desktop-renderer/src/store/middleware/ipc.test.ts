import { configureStore } from '@reduxjs/toolkit';
import type { TaskListSummary, TaskSummary } from '@lucid-fin/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAPI } from '../../utils/api.js';
import { loggerSlice } from '../slices/logger.js';
import { taskListsSlice, loadTaskLists, loadTaskListTasks } from '../slices/task-lists.js';
import { toastSlice } from '../slices/toast.js';
import { ipcMiddleware } from './ipc.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn() }));

function taskList(): TaskListSummary {
  return {
    id: 'list-1',
    taskListType: 'movie.production.v2',
    entityType: 'canvas',
    entityId: 'canvas-1',
    triggerSource: 'commander',
    status: 'running',
    summary: 'Producing movie',
    progress: 40,
    completedPhases: 1,
    totalPhases: 3,
    completedTasks: 1,
    totalTasks: 2,
    displayCategory: 'production',
    displayLabel: 'Movie production',
    createdAt: 1,
    updatedAt: 2,
  };
}

function task(): TaskSummary {
  return {
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
}

function createStore() {
  return configureStore({
    reducer: {
      taskLists: taskListsSlice.reducer,
      logger: loggerSlice.reducer,
      toast: toastSlice.reducer,
    },
    middleware: (defaults) => defaults().concat(ipcMiddleware),
  });
}

describe('ipcMiddleware task list projection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads task lists and their tasks without exposing execution controls', async () => {
    const list = vi.fn().mockResolvedValue([taskList()]);
    const getTasks = vi.fn().mockResolvedValue([task()]);
    vi.mocked(getAPI).mockReturnValue({
      taskLists: { list, getTasks },
    } as unknown as ReturnType<typeof getAPI>);
    const store = createStore();

    store.dispatch(loadTaskLists({ entityType: 'canvas' }));
    store.dispatch(loadTaskListTasks('list-1'));

    await vi.waitFor(() => {
      expect(store.getState().taskLists.allIds).toEqual(['list-1']);
      expect(store.getState().taskLists.tasksByTaskListId['list-1']).toHaveLength(1);
    });
    expect(list).toHaveBeenCalledWith({ entityType: 'canvas' });
    expect(getTasks).toHaveBeenCalledWith('list-1');
  });
});
