// @vitest-environment jsdom

import React, { act } from 'react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { WorkflowDetailDrawer } from './WorkflowDetailDrawer.js';
import { t } from '../../i18n.js';
import {
  setWorkflowStages,
  setWorkflowSummaries,
  setWorkflowTasks,
  workflowsSlice,
} from '../../store/slices/workflows.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkflowDetailDrawer', () => {
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

  it('shows stage, task, prompt template, and model data for a workflow run', async () => {
    const store = configureStore({
      reducer: {
        workflows: workflowsSlice.reducer,
      },
    });

    store.dispatch(
      setWorkflowSummaries([
        {
          id: 'wf-1',
          workflowType: 'storyboard.generate',
          entityType: 'scene',
          entityId: 'scene-1',
          triggerSource: 'user',
          status: 'running',
          summary: 'running 1/3 stages, 1/3 tasks',
          progress: 33,
          completedStages: 1,
          totalStages: 3,
          completedTasks: 1,
          totalTasks: 3,
          displayCategory: 'Storyboard',
          displayLabel: 'Generate storyboard',
          relatedEntityLabel: 'Opening Scene · KF 1',
          provider: 'flux',
          modelKey: 'flux',
          createdAt: 100,
          updatedAt: 200,
        },
      ]),
    );

    store.dispatch(
      setWorkflowStages({
        workflowRunId: 'wf-1',
        stages: [
          {
            id: 'stage-1',
            workflowRunId: 'wf-1',
            stageId: 'generate',
            name: 'Generate storyboard variants',
            status: 'running',
            order: 1,
            progress: 50,
            completedTasks: 0,
            totalTasks: 1,
            metadata: {},
            updatedAt: 200,
          },
        ],
      }),
    );

    store.dispatch(
      setWorkflowTasks({
        workflowRunId: 'wf-1',
        tasks: [
          {
            id: 'task-1',
            workflowRunId: 'wf-1',
            stageRunId: 'stage-1',
            taskId: 'generate-frames',
            kind: 'adapter_generation',
            status: 'running',
            displayCategory: 'Storyboard',
            displayLabel: 'Generate storyboard frames',
            relatedEntityLabel: 'Opening Scene · KF 1',
            provider: 'flux',
            modelKey: 'flux-pro-1',
            promptTemplateId: 'storyboard.generate.frames',
            promptTemplateVersion: '1.0.0',
            summary: 'Generate storyboard frame variants from the selected scene prompt.',
            updatedAt: 210,
          },
        ],
      }),
    );

    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <Provider store={store}>
          <WorkflowDetailDrawer workflowRunId="wf-1" open onClose={onClose} />
        </Provider>,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('Generate storyboard');
    expect(container.textContent).toContain('Generate storyboard variants');
    expect(container.textContent).toContain('Generate storyboard frames');
    expect(container.textContent).toContain('flux-pro-1');
    expect(container.textContent).toContain('storyboard.generate.frames');

    const closeButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('workflowDrawer.close')),
    );

    await act(async () => {
      closeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
