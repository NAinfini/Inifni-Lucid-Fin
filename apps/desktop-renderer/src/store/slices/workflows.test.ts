// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ipcMiddleware } from '../middleware/ipc.js';
import { toastSlice } from './toast.js';
import {
  loadWorkflowStages,
  loadWorkflowTasks,
  loadWorkflows,
  pauseWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  retryWorkflow,
  retryWorkflowStage,
  retryWorkflowTask,
  setWorkflowSummaries,
  setWorkflowTasks,
  startWorkflow,
  workflowStarted,
  workflowsSlice,
} from './workflows.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('workflows slice', () => {
  it('normalizes workflow summaries/tasks and manages optimistic workflow start placeholders', () => {
    const workflowRun = {
      id: 'wf-1',
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-1',
      triggerSource: 'user',
      status: 'running',
      summary: 'running 1/3 stages, 1/3 tasks',
      progress: 33,
      completedStages: 1,
      totalStages: 3,
      completedTasks: 1,
      totalTasks: 3,
      createdAt: 100,
      updatedAt: 200,
      metadata: {
        displayCategory: 'Style',
        displayLabel: 'Extract style',
        relatedEntityLabel: 'Reference asset',
        provider: 'mock-llm',
      },
      output: {},
    };
    const workflowTask = {
      id: 'task-1',
      workflowRunId: 'wf-1',
      stageRunId: 'stage-1',
      taskId: 'extract-style-profile',
      name: 'Extract style profile',
      kind: 'metadata_extract',
      status: 'running',
      provider: 'mock-llm',
      dependencyIds: [],
      attempts: 1,
      maxRetries: 2,
      input: {
        displayCategory: 'Style',
        displayLabel: 'Extract style profile',
        relatedEntityType: 'asset',
        relatedEntityId: 'asset-1',
        relatedEntityLabel: 'Reference asset',
        provider: 'mock-llm',
        modelKey: 'vision-1',
        promptTemplateId: 'style.extract.profile',
        promptTemplateVersion: '1.0.0',
        summary: 'Extract palette and exposure data',
      },
      output: {},
      progress: 60,
      currentStep: 'extracting',
      updatedAt: 150,
    };

    let state = workflowsSlice.reducer(undefined, setWorkflowSummaries([workflowRun as never]));

    expect(state.allIds).toEqual(['wf-1']);
    expect(state.summariesById['wf-1']).toEqual(
      expect.objectContaining({
        id: 'wf-1',
        workflowType: 'style.extract',
        displayCategory: 'Style',
        displayLabel: 'Extract style',
        relatedEntityLabel: 'Reference asset',
        provider: 'mock-llm',
      }),
    );

    state = workflowsSlice.reducer(
      state,
      setWorkflowTasks({
        workflowRunId: 'wf-1',
        tasks: [workflowTask as never],
      }),
    );

    expect(state.tasksByWorkflowId['wf-1']).toEqual([
      expect.objectContaining({
        id: 'task-1',
        displayLabel: 'Extract style profile',
        relatedEntityLabel: 'Reference asset',
        promptTemplateId: 'style.extract.profile',
        promptTemplateVersion: '1.0.0',
      }),
    ]);

    const started = startWorkflow({
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      metadata: {
        displayCategory: 'Storyboard',
        displayLabel: 'Generate storyboard',
        relatedEntityLabel: 'Scene 1',
      },
    });

    state = workflowsSlice.reducer(state, started);
    const placeholderId = state.allIds[0];

    expect(state.summariesById[placeholderId]).toEqual(
      expect.objectContaining({
        id: placeholderId,
        placeholder: true,
        workflowType: 'storyboard.generate',
        status: 'pending',
        displayCategory: 'Storyboard',
        displayLabel: 'Generate storyboard',
        relatedEntityLabel: 'Scene 1',
      }),
    );

    state = workflowsSlice.reducer(
      state,
      workflowStarted({
        placeholderId,
        workflowRunId: 'wf-2',
      }),
    );

    expect(state.summariesById[placeholderId]).toBeUndefined();
    expect(state.summariesById['wf-2']).toEqual(
      expect.objectContaining({
        id: 'wf-2',
        placeholder: false,
        workflowType: 'storyboard.generate',
        status: 'ready',
      }),
    );
  });
});

describe('workflow ipc middleware', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches workflow IPC commands and stores returned workflow data', async () => {
    const workflowRun = {
      id: 'wf-200',
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-1',
      triggerSource: 'colorStyle:extract',
      status: 'running',
      summary: 'running 1/3 stages, 1/3 tasks',
      progress: 33,
      completedStages: 1,
      totalStages: 3,
      completedTasks: 1,
      totalTasks: 3,
      createdAt: 100,
      updatedAt: 200,
      metadata: {
        displayCategory: 'Style',
        displayLabel: 'Extract style',
        relatedEntityLabel: 'Reference asset',
      },
      output: {},
    };
    const stageRun = {
      id: 'stage-1',
      workflowRunId: 'wf-200',
      stageId: 'extract',
      name: 'Extract style profile',
      status: 'running',
      order: 1,
      progress: 50,
      completedTasks: 0,
      totalTasks: 1,
      metadata: {},
      updatedAt: 200,
    };
    const taskRun = {
      id: 'task-1',
      workflowRunId: 'wf-200',
      stageRunId: 'stage-1',
      taskId: 'extract-style-profile',
      name: 'Extract style profile',
      kind: 'metadata_extract',
      status: 'running',
      provider: 'mock-llm',
      dependencyIds: [],
      attempts: 1,
      maxRetries: 2,
      input: {
        displayCategory: 'Style',
        displayLabel: 'Extract style profile',
        relatedEntityType: 'asset',
        relatedEntityId: 'asset-1',
        relatedEntityLabel: 'Reference asset',
      },
      output: {},
      progress: 60,
      currentStep: 'extracting',
      updatedAt: 210,
    };

    const api = {
      workflow: {
        start: vi.fn(async () => ({ workflowRunId: 'wf-200' })),
        list: vi.fn(async () => [workflowRun]),
        getStages: vi.fn(async () => [stageRun]),
        getTasks: vi.fn(async () => [taskRun]),
        pause: vi.fn(async () => undefined),
        resume: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        retryTask: vi.fn(async () => undefined),
        retryStage: vi.fn(async () => undefined),
        retryWorkflow: vi.fn(async () => undefined),
      },
      job: {
        submit: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
      },
    };

    window.lucidAPI = api as unknown as Window['lucidAPI'];

    const store = configureStore({
      reducer: {
        workflows: workflowsSlice.reducer,
        toast: toastSlice.reducer,
      },
      middleware: (getDefault) => getDefault().concat(ipcMiddleware),
    });

    store.dispatch(
      startWorkflow({
        workflowType: 'style.extract',
        entityType: 'asset',
        entityId: 'asset-1',
        metadata: {
          displayCategory: 'Style',
          displayLabel: 'Extract style',
        },
      }),
    );
    store.dispatch(loadWorkflows({}));
    store.dispatch(loadWorkflowStages('wf-200'));
    store.dispatch(loadWorkflowTasks('wf-200'));
    store.dispatch(pauseWorkflow('wf-200'));
    store.dispatch(resumeWorkflow('wf-200'));
    store.dispatch(cancelWorkflow('wf-200'));
    store.dispatch(retryWorkflowTask('task-1'));
    store.dispatch(retryWorkflowStage('stage-1'));
    store.dispatch(retryWorkflow('wf-200'));

    await flushPromises();
    await flushPromises();

    expect(api.workflow.start).toHaveBeenCalledWith({
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-1',
      metadata: {
        displayCategory: 'Style',
        displayLabel: 'Extract style',
      },
    });
    expect(api.workflow.list).toHaveBeenCalledWith({});
    expect(api.workflow.getStages).toHaveBeenCalledWith('wf-200');
    expect(api.workflow.getTasks).toHaveBeenCalledWith('wf-200');
    expect(api.workflow.pause).toHaveBeenCalledWith('wf-200');
    expect(api.workflow.resume).toHaveBeenCalledWith('wf-200');
    expect(api.workflow.cancel).toHaveBeenCalledWith('wf-200');
    expect(api.workflow.retryTask).toHaveBeenCalledWith('task-1');
    expect(api.workflow.retryStage).toHaveBeenCalledWith('stage-1');
    expect(api.workflow.retryWorkflow).toHaveBeenCalledWith('wf-200');

    const state = store.getState().workflows;
    expect(state.summariesById['wf-200']).toEqual(
      expect.objectContaining({
        id: 'wf-200',
        displayLabel: 'Extract style',
      }),
    );
    expect(state.stagesByWorkflowId['wf-200']).toEqual([
      expect.objectContaining({ id: 'stage-1' }),
    ]);
    expect(state.tasksByWorkflowId['wf-200']).toEqual([
      expect.objectContaining({ id: 'task-1', displayLabel: 'Extract style profile' }),
    ]);
  });
});
