import type { Middleware } from '@reduxjs/toolkit';

import { getAPI } from '../../utils/api.js';
import { t } from '../../i18n.js';
import { withRetry } from '../../utils/ipc-retry.js';
import { enqueueToast } from '../slices/toast.js';
import { addLog } from '../slices/logger.js';
import {
  loadTaskLists,
  loadTaskListTasks,
  type TaskListListFilter,
  setTaskListSummaries,
  setTaskListTasks,
} from '../slices/task-lists.js';

function logIpcError(store: Parameters<Middleware>[0], message: string, error: unknown): void {
  store.dispatch(
    addLog({
      level: 'error',
      category: 'ipc',
      message,
      detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
    }),
  );
}

const inflight = new Map<string, Promise<unknown>>();

function dedupeKey(actionType: string, payload: unknown): string {
  return typeof payload === 'string' ? `${actionType}:${payload}` : actionType;
}

async function deduped(key: string, operation: () => Promise<unknown>): Promise<unknown> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = withRetry(operation).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

function reportFailure(store: Parameters<Middleware>[0], message: string, error: unknown): void {
  logIpcError(store, message, error);
  store.dispatch(
    enqueueToast({
      variant: 'error',
      title: t('toast.error.operationFailed'),
      message: error instanceof Error ? error.message : t('toast.error.unknownError'),
      durationMs: 6000,
    }),
  );
}

export const ipcMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);
  if (typeof action !== 'object' || action === null || !('type' in action)) return result;

  const typed = action as { type: string; payload?: unknown };
  const api = getAPI();
  if (!api?.taskLists) return result;

  if (typed.type === loadTaskLists.type) {
    void deduped(dedupeKey(typed.type, typed.payload), async () => {
      const taskLists = await api.taskLists.list(
        (typed.payload as TaskListListFilter | undefined) ?? {},
      );
      store.dispatch(setTaskListSummaries(taskLists));
    }).catch((error) => reportFailure(store, 'Task list load failed', error));
  }

  if (typed.type === loadTaskListTasks.type) {
    const taskListId = typed.payload as string;
    void deduped(dedupeKey(typed.type, taskListId), async () => {
      const tasks = await api.taskLists.getTasks(taskListId);
      store.dispatch(setTaskListTasks({ taskListId, tasks }));
    }).catch((error) => reportFailure(store, 'Task load failed', error));
  }

  return result;
};
