// @vitest-environment jsdom

import React, { act } from 'react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { ExecutionPanel } from './ExecutionPanel.js';
import { t } from '../../i18n.js';
import {
  setWorkflowSummaries,
  setWorkflowStages,
  setWorkflowTasks,
  workflowsSlice,
} from '../../store/slices/workflows.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ExecutionPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flushPromises();
    });
    container.remove();
  });

  it('shows active workflow rows, keeps failed workflows visible, and supports pause/resume/cancel/open details actions', async () => {
    const store = configureStore({
      reducer: {
        workflows: workflowsSlice.reducer,
      },
    });

    store.dispatch(
      setWorkflowSummaries([
        {
          id: 'wf-running',
          workflowType: 'style.extract',
          projectId: 'project-1',
          entityType: 'asset',
          entityId: 'asset-1',
          triggerSource: 'user',
          status: 'running',
          summary: 'running 1/3 stages, 1/3 tasks',
          progress: 42,
          completedStages: 1,
          totalStages: 3,
          completedTasks: 1,
          totalTasks: 3,
          displayCategory: 'Style',
          displayLabel: 'Extract style',
          relatedEntityLabel: 'Reference asset',
          provider: 'mock-llm',
          modelKey: 'vision-1',
          createdAt: 100,
          updatedAt: 300,
        },
        {
          id: 'wf-paused',
          workflowType: 'storyboard.generate',
          projectId: 'project-1',
          entityType: 'scene',
          entityId: 'scene-1',
          triggerSource: 'user',
          status: 'paused',
          summary: 'paused 1/2 stages, 2/4 tasks',
          progress: 50,
          completedStages: 1,
          totalStages: 2,
          completedTasks: 2,
          totalTasks: 4,
          displayCategory: 'Storyboard',
          displayLabel: 'Generate storyboard',
          relatedEntityLabel: 'Scene 1',
          provider: 'flux',
          createdAt: 110,
          updatedAt: 290,
        },
        {
          id: 'wf-failed',
          workflowType: 'style.extract',
          projectId: 'project-1',
          entityType: 'asset',
          entityId: 'asset-2',
          triggerSource: 'user',
          status: 'failed',
          summary: 'failed 1/3 stages, 1/3 tasks',
          progress: 33,
          completedStages: 1,
          totalStages: 3,
          completedTasks: 1,
          totalTasks: 3,
          displayCategory: 'Style',
          displayLabel: 'Extract style',
          relatedEntityLabel: 'Broken reference',
          provider: 'mock-llm',
          createdAt: 120,
          updatedAt: 280,
        },
      ]),
    );
    store.dispatch(
      setWorkflowStages({
        workflowRunId: 'wf-running',
        stages: [
          {
            id: 'stage-1',
            workflowRunId: 'wf-running',
            stageId: 'extract',
            name: 'Extract style profile',
            status: 'running',
            order: 1,
            progress: 42,
            completedTasks: 1,
            totalTasks: 2,
            metadata: {},
            updatedAt: 300,
          },
        ],
      }),
    );
    store.dispatch(
      setWorkflowTasks({
        workflowRunId: 'wf-running',
        tasks: [
          {
            id: 'task-1',
            workflowRunId: 'wf-running',
            stageRunId: 'stage-1',
            taskId: 'extract-style-profile',
            kind: 'metadata_extract',
            status: 'running',
            displayCategory: 'Style',
            displayLabel: 'Extract style profile',
            relatedEntityLabel: 'Reference asset',
            summary: 'Extract palette and exposure',
            promptTemplateId: 'style.extract.profile',
            promptTemplateVersion: '1.0.0',
            updatedAt: 300,
          },
        ],
      }),
    );

    const dispatchSpy = vi.spyOn(store, 'dispatch');

    await act(async () => {
      root.render(
        <Provider store={store}>
          <ExecutionPanel />
        </Provider>,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('Extract style');
    expect(container.textContent).toContain('Generate storyboard');
    expect(container.textContent).toContain('Broken reference');

    const pauseButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('action.pause')),
    );
    const resumeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('action.resume')),
    );
    const cancelButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('action.cancel')),
    );
    const detailsButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('execution.showDetails')),
    );

    expect(pauseButton).toBeDefined();
    expect(resumeButton).toBeDefined();
    expect(cancelButton).toBeDefined();
    expect(detailsButton).toBeDefined();

    await act(async () => {
      detailsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain('Extract style profile');
    expect(container.textContent).toContain('style.extract.profile');

    await act(async () => {
      pauseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    const actionTypes = dispatchSpy.mock.calls.map((call) => {
      const action = call[0] as { type?: string };
      return action?.type;
    });

    expect(actionTypes).toContain('workflows/pauseWorkflow');
    expect(actionTypes).toContain('workflows/resumeWorkflow');
    expect(actionTypes).toContain('workflows/cancelWorkflow');
  });
});
