// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n.js';
import { ipcMiddleware } from './ipc.js';
import { jobsSlice, submitJob } from '../slices/jobs.js';
import { loggerSlice } from '../slices/logger.js';
import { toastSlice } from '../slices/toast.js';
import { startWorkflow, workflowsSlice } from '../slices/workflows.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ipcMiddleware', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches job IPC actions through the mapped handlers', async () => {
    const api = {
      job: {
        submit: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
      },
      workflow: {
        start: vi.fn(),
        list: vi.fn(),
        getStages: vi.fn(),
        getTasks: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
        retryTask: vi.fn(),
        retryStage: vi.fn(),
        retryWorkflow: vi.fn(),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        jobs: jobsSlice.reducer,
        toast: toastSlice.reducer,
        logger: loggerSlice.reducer,
        workflows: workflowsSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(ipcMiddleware),
    });

    store.dispatch(submitJob({ projectId: 'project-1', providerId: 'openai-image' }));
    store.dispatch({ type: 'jobs/cancelJob', payload: 'job-1' });
    store.dispatch({ type: 'jobs/pauseJob', payload: 'job-1' });
    store.dispatch({ type: 'jobs/resumeJob', payload: 'job-1' });

    await flushPromises();

    expect(api.job.submit).toHaveBeenCalledWith({
      projectId: 'project-1',
      providerId: 'openai-image',
    });
    expect(api.job.cancel).toHaveBeenCalledWith('job-1');
    expect(api.job.pause).toHaveBeenCalledWith('job-1');
    expect(api.job.resume).toHaveBeenCalledWith('job-1');
  });

  it('logs and toasts job IPC failures', async () => {
    const api = {
      job: {
        submit: vi.fn(async () => {
          throw new Error('submit failed');
        }),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
      workflow: {
        start: vi.fn(),
        list: vi.fn(),
        getStages: vi.fn(),
        getTasks: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
        retryTask: vi.fn(),
        retryStage: vi.fn(),
        retryWorkflow: vi.fn(),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        jobs: jobsSlice.reducer,
        toast: toastSlice.reducer,
        logger: loggerSlice.reducer,
        workflows: workflowsSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(ipcMiddleware),
    });

    store.dispatch(submitJob({ projectId: 'project-1' }));
    await flushPromises();
    await flushPromises();

    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          category: 'ipc',
          message: 'IPC action failed',
        }),
      ]),
    );
    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: t('toast.error.operationFailed'),
        message: 'submit failed',
      }),
    ]);
  });

  it('removes workflow placeholders and shows an error toast when workflow start fails', async () => {
    const api = {
      job: {
        submit: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
      workflow: {
        start: vi.fn(async () => {
          throw new Error('workflow failed');
        }),
        list: vi.fn(),
        getStages: vi.fn(),
        getTasks: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
        retryTask: vi.fn(),
        retryStage: vi.fn(),
        retryWorkflow: vi.fn(),
      },
    };

    window.lucidAPI = api as never;

    const store = configureStore({
      reducer: {
        workflows: workflowsSlice.reducer,
        toast: toastSlice.reducer,
        logger: loggerSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(ipcMiddleware),
    });

    store.dispatch(
      startWorkflow({
        workflowType: 'storyboard.generate',
        projectId: 'project-1',
        entityType: 'scene',
      }),
    );

    expect(store.getState().workflows.allIds).toHaveLength(1);

    await flushPromises();
    await flushPromises();

    expect(store.getState().workflows.allIds).toEqual([]);
    expect(store.getState().logger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'error',
          category: 'ipc',
          message: 'Workflow start failed',
        }),
      ]),
    );
    expect(store.getState().toast.items).toEqual([
      expect.objectContaining({
        variant: 'error',
        title: t('toast.error.workflowStartFailed'),
        message: 'workflow failed',
      }),
    ]);
  });
});
