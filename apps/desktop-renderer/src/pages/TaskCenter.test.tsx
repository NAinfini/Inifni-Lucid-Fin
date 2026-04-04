// @vitest-environment jsdom

import React, { act } from 'react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { workflowsSlice, setWorkflowSummaries } from '../store/slices/workflows.js';
import { TaskCenter } from './TaskCenter.js';
import { t } from '../i18n.js';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TaskCenter', () => {
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

  it('shows workflow tasks with filters for active and failed execution states', async () => {
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
          progress: 40,
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
          id: 'wf-failed',
          workflowType: 'storyboard.generate',
          projectId: 'project-1',
          entityType: 'scene',
          entityId: 'scene-1',
          triggerSource: 'user',
          status: 'failed',
          summary: 'failed 1/2 stages, 2/4 tasks',
          progress: 50,
          completedStages: 1,
          totalStages: 2,
          completedTasks: 2,
          totalTasks: 4,
          displayCategory: 'Storyboard',
          displayLabel: 'Generate storyboard',
          relatedEntityLabel: 'Scene 1',
          provider: 'flux',
          modelKey: 'image-gen-1',
          createdAt: 110,
          updatedAt: 290,
        },
      ]),
    );

    await act(async () => {
      root.render(
        <Provider store={store}>
          <MemoryRouter>
            <TaskCenter />
          </MemoryRouter>
        </Provider>,
      );
      await flushPromises();
    });

    expect(container.textContent).toContain('Extract style');
    expect(container.textContent).toContain('Generate storyboard');

    const activeFilter = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('taskCenter.filters.active')),
    );

    await act(async () => {
      activeFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).toContain('Extract style');
    expect(container.textContent).not.toContain('Generate storyboard');

    const failedFilter = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(t('taskCenter.filters.failed')),
    );

    await act(async () => {
      failedFilter?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushPromises();
    });

    expect(container.textContent).not.toContain('Extract style');
    expect(container.textContent).toContain('Generate storyboard');
    expect(container.textContent).toContain('Scene 1');
  });
});
