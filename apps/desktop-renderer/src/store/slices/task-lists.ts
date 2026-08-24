import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TaskListSummary, TaskSummary } from '@lucid-fin/contracts';

export interface TaskListsState {
  summariesById: Record<string, TaskListSummary>;
  allIds: string[];
  tasksByTaskListId: Record<string, TaskSummary[]>;
}

export type TaskListListFilter = {
  status?: string;
  taskListType?: string;
  entityType?: string;
};

function sortIdsByUpdatedAt(state: TaskListsState): void {
  state.allIds = Object.values(state.summariesById)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .map((taskList) => taskList.id);
}

export const taskListsSlice = createSlice({
  name: 'taskLists',
  initialState: {
    summariesById: {},
    allIds: [],
    tasksByTaskListId: {},
  } as TaskListsState,
  reducers: {
    setTaskListSummaries(state, action: PayloadAction<TaskListSummary[]>) {
      state.summariesById = Object.fromEntries(
        action.payload.map((taskList) => [taskList.id, taskList]),
      );
      sortIdsByUpdatedAt(state);
    },
    upsertTaskListSummary(state, action: PayloadAction<TaskListSummary>) {
      state.summariesById[action.payload.id] = action.payload;
      sortIdsByUpdatedAt(state);
    },
    setTaskListTasks(state, action: PayloadAction<{ taskListId: string; tasks: TaskSummary[] }>) {
      state.tasksByTaskListId[action.payload.taskListId] = action.payload.tasks;
    },
    loadTaskLists(_state, _action: PayloadAction<TaskListListFilter | undefined>) {},
    loadTaskListTasks(_state, _action: PayloadAction<string>) {},
  },
});

export const {
  setTaskListSummaries,
  upsertTaskListSummary,
  setTaskListTasks,
  loadTaskLists,
  loadTaskListTasks,
} = taskListsSlice.actions;
