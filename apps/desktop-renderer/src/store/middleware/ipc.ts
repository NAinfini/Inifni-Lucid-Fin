import type { Middleware } from '@reduxjs/toolkit';
import { getAPI } from '../../utils/api.js';
import { t } from '../../i18n.js';
import { enqueueToast } from '../slices/toast.js';
import { addLog } from '../slices/logger.js';
import type { GenerationRequest } from '@lucid-fin/contracts';
import {
  cancelWorkflow,
  loadWorkflowStages,
  loadWorkflowTasks,
  loadWorkflows,
  pauseWorkflow,
  removeWorkflowPlaceholder,
  resumeWorkflow,
  retryWorkflow,
  retryWorkflowStage,
  retryWorkflowTask,
  setWorkflowStages,
  setWorkflowSummaries,
  setWorkflowTasks,
  startWorkflow,
  workflowStarted,
} from '../slices/workflows.js';

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

/** Tracks in-flight IPC requests to prevent duplicates */
const inflight = new Map<string, Promise<unknown>>();

const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

function dedupeKey(actionType: string, payload: unknown): string {
  if (typeof payload === 'string') return `${actionType}:${payload}`;
  return actionType;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused');
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      await new Promise((r) => setTimeout(r, BASE_DELAY_MS * 2 ** attempt));
    }
  }
}

async function deduped(key: string, fn: () => Promise<unknown>): Promise<unknown> {
  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = withRetry(fn).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

const IPC_ACTION_MAP: Record<string, (payload: unknown) => Promise<unknown> | undefined> = {
  'jobs/submitJob': (p) => getAPI()?.job.submit(p as GenerationRequest),
  'jobs/cancelJob': (p) => getAPI()?.job.cancel(p as string),
  'jobs/pauseJob': (p) => getAPI()?.job.pause(p as string),
  'jobs/resumeJob': (p) => getAPI()?.job.resume(p as string),
};

export const ipcMiddleware: Middleware = (store) => (next) => (action) => {
  const result = next(action);

  if (typeof action === 'object' && action !== null && 'type' in action) {
    const typed = action as { type: string; payload?: unknown };
    const api = getAPI();
    const handler = IPC_ACTION_MAP[typed.type];
    if (handler) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => handler(typed.payload) ?? Promise.resolve()).catch((error: unknown) => {
        logIpcError(store, 'IPC action failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.operationFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (!api) return result;

    if (typed.type === startWorkflow.type) {
      const payload = typed.payload as ReturnType<typeof startWorkflow>['payload'];
      const key = dedupeKey(typed.type, payload.placeholderId);
      deduped(key, async () => {
        const { workflowRunId } = await api.workflow.start(payload.request);
        store.dispatch(workflowStarted({ placeholderId: payload.placeholderId, workflowRunId }));
        const workflows = await api.workflow.list();
        store.dispatch(setWorkflowSummaries(workflows));
      }).catch((error: unknown) => {
        logIpcError(store, 'Workflow start failed', error);
        store.dispatch(removeWorkflowPlaceholder(payload.placeholderId));
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowStartFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === loadWorkflows.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, async () => {
        const workflows = await api.workflow.list(
          (typed.payload as Record<string, unknown> | undefined) ?? {},
        );
        store.dispatch(setWorkflowSummaries(workflows));
      }).catch((error: unknown) => {
        logIpcError(store, 'Workflow list failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowLoadFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === loadWorkflowStages.type) {
      const workflowRunId = typed.payload as string;
      const key = dedupeKey(typed.type, workflowRunId);
      deduped(key, async () => {
        const stages = await api.workflow.getStages(workflowRunId);
        store.dispatch(setWorkflowStages({ workflowRunId, stages }));
      }).catch((error: unknown) => {
        logIpcError(store, 'Workflow stages load failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowStagesLoadFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === loadWorkflowTasks.type) {
      const workflowRunId = typed.payload as string;
      const key = dedupeKey(typed.type, workflowRunId);
      deduped(key, async () => {
        const tasks = await api.workflow.getTasks(workflowRunId);
        store.dispatch(setWorkflowTasks({ workflowRunId, tasks }));
      }).catch((error: unknown) => {
        logIpcError(store, 'Workflow tasks load failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowTasksLoadFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === pauseWorkflow.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => api.workflow.pause(typed.payload as string)).catch((error: unknown) => {
        logIpcError(store, 'Workflow pause failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowPauseFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === resumeWorkflow.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => api.workflow.resume(typed.payload as string)).catch((error: unknown) => {
        logIpcError(store, 'Workflow resume failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowResumeFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === cancelWorkflow.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => api.workflow.cancel(typed.payload as string)).catch((error: unknown) => {
        logIpcError(store, 'Workflow cancel failed', error);
        store.dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowCancelFailed'),
            message: error instanceof Error ? error.message : t('toast.error.unknownError'),
            durationMs: 6000,
          }),
        );
      });
    }

    if (typed.type === retryWorkflowTask.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => api.workflow.retryTask(typed.payload as string)).catch(
        (error: unknown) => {
          logIpcError(store, 'Workflow task retry failed', error);
          store.dispatch(
            enqueueToast({
              variant: 'error',
              title: t('toast.error.workflowTaskRetryFailed'),
              message: error instanceof Error ? error.message : t('toast.error.unknownError'),
              durationMs: 6000,
            }),
          );
        },
      );
    }

    if (typed.type === retryWorkflowStage.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => api.workflow.retryStage(typed.payload as string)).catch(
        (error: unknown) => {
          logIpcError(store, 'Workflow stage retry failed', error);
          store.dispatch(
            enqueueToast({
              variant: 'error',
              title: t('toast.error.workflowStageRetryFailed'),
              message: error instanceof Error ? error.message : t('toast.error.unknownError'),
              durationMs: 6000,
            }),
          );
        },
      );
    }

    if (typed.type === retryWorkflow.type) {
      const key = dedupeKey(typed.type, typed.payload);
      deduped(key, () => api.workflow.retryWorkflow(typed.payload as string)).catch(
        (error: unknown) => {
          logIpcError(store, 'Workflow retry failed', error);
          store.dispatch(
            enqueueToast({
              variant: 'error',
              title: t('toast.error.workflowRetryFailed'),
              message: error instanceof Error ? error.message : t('toast.error.unknownError'),
              durationMs: 6000,
            }),
          );
        },
      );
    }
  }

  return result;
};
