// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PlanApprovalContext,
  PlanApprovalGateKey,
  TaskListSummary,
  VisualAuditionContext,
} from '@lucid-fin/contracts';

import { taskListsSlice, setTaskListSummaries } from '../../../store/slices/task-lists.js';
import { getAPI } from '../../../utils/api.js';
import { CommanderPlanApproval } from './CommanderPlanApproval.js';

vi.mock('../../../utils/api.js', () => ({ getAPI: vi.fn() }));
vi.mock('../../execution/ProductionPlanApprovalCard.js', () => ({
  ProductionPlanApprovalCard: () => <div>production-approval-card</div>,
}));
vi.mock('../../execution/VisualConstitutionApprovalCard.js', () => ({
  VisualConstitutionApprovalCard: ({
    approvalContext,
  }: {
    approvalContext?: PlanApprovalContext | null;
  }) => (
    <div>
      <span>visual-approval-card</span>
      <span>{approvalContext ? 'visual-gate-context' : 'visual-audition-only-context'}</span>
    </div>
  ),
}));
vi.mock('../../execution/DeliveryApprovalCard.js', () => ({
  DeliveryApprovalCard: () => <div>delivery-approval-card</div>,
}));

const summary: TaskListSummary = {
  id: 'task-list-1',
  taskListType: 'movie.production.v2',
  entityType: 'canvas',
  entityId: 'canvas-1',
  commanderSessionId: 'session-1',
  triggerSource: 'commander',
  status: 'awaiting_approval',
  summary: 'Awaiting approval',
  progress: 20,
  completedPhases: 1,
  totalPhases: 6,
  completedTasks: 2,
  totalTasks: 8,
  displayCategory: 'production',
  displayLabel: 'Movie production',
  createdAt: 1,
  updatedAt: 4,
};

function approvalContext(gateKey: PlanApprovalGateKey): PlanApprovalContext {
  return {
    taskList: {
      ...summary,
      input: {},
      output: {},
      metadata: {},
      rowVersion: 7,
      currentGate: gateKey,
    },
    approval: {
      id: `approval-${gateKey}`,
      taskListId: summary.id,
      gateKey,
      subjectLogicalKey: gateKey,
      subjectRevision: 3,
      subjectHash: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      status: 'pending',
      createdAt: 3,
      updatedAt: 3,
    },
    document: {
      id: `document-${gateKey}`,
      taskListId: summary.id,
      logicalKey: gateKey,
      documentType: gateKey,
      revision: 3,
      schemaVersion: 1,
      content: {},
      contentHash: 'a'.repeat(64),
      status: 'active',
      createdAt: 3,
      updatedAt: 3,
    },
  };
}

function visualAuditionContext(
  taskList: VisualAuditionContext['taskList'],
  status: 'complete' | 'in_progress' = 'complete',
): VisualAuditionContext {
  return {
    taskList,
    document: {
      id: 'visual-audition-1',
      taskListId: taskList.id,
      logicalKey: 'visual-auditions',
      documentType: 'visual_auditions',
      revision: 4,
      schemaVersion: 1,
      content: { status },
      contentHash: 'c'.repeat(64),
      status: 'active',
      createdAt: 3,
      updatedAt: 3,
    },
  };
}

function createStore() {
  const store = configureStore({ reducer: { taskLists: taskListsSlice.reducer } });
  store.dispatch(setTaskListSummaries([summary]));
  return store;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CommanderPlanApproval', () => {
  it.each([
    ['production_plan', 'production-approval-card'],
    ['visual_constitution', 'visual-approval-card'],
    ['delivery', 'delivery-approval-card'],
  ] as const)('renders the %s gate inside Commander chat', async (gateKey, expectedCard) => {
    const context = approvalContext(gateKey);
    const approveGate = vi.fn().mockResolvedValue({ ok: true, code: 'approved' });
    vi.mocked(getAPI).mockReturnValue({
      taskLists: {
        list: vi.fn().mockResolvedValue([summary]),
        getPendingApproval: vi.fn().mockResolvedValue(context),
        getVisualAuditions: vi.fn().mockResolvedValue(visualAuditionContext(context.taskList)),
        approveGate,
      },
    } as unknown as ReturnType<typeof getAPI>);

    const onContentChange = vi.fn();
    render(
      <Provider store={createStore()}>
        <CommanderPlanApproval
          canvasId="canvas-1"
          sessionId="session-1"
          t={(key) => key}
          onContentChange={onContentChange}
        />
      </Provider>,
    );

    expect(await screen.findByText(expectedCard)).toBeTruthy();
    expect(screen.queryByText('commander.planGateNotice')).toBeNull();
    expect(onContentChange).toHaveBeenCalled();

    if (gateKey === 'production_plan') {
      expect(approveGate).not.toHaveBeenCalled();
    }
  });

  it('keeps a visible retry state when the pending approval context is unavailable', async () => {
    const getPendingApproval = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(approvalContext('production_plan'));
    vi.mocked(getAPI).mockReturnValue({
      taskLists: {
        list: vi.fn().mockResolvedValue([summary]),
        getPendingApproval,
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CommanderPlanApproval canvasId="canvas-1" sessionId="session-1" t={(key) => key} />
      </Provider>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain('planApproval.unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'action.retry' }));
    expect(await screen.findByText('production-approval-card')).toBeTruthy();
    expect(getPendingApproval).toHaveBeenCalledTimes(2);
  });

  it('shows a complete pre-lock audition without a separate request-changes action', async () => {
    const activeSummary: TaskListSummary = {
      ...summary,
      status: 'ready',
      currentPhaseKey: 'style-exploration',
      currentTaskId: 'style-audition-1',
      updatedAt: 8,
    };
    const audition = visualAuditionContext({
      ...approvalContext('production_plan').taskList,
      status: 'ready',
      currentPhaseKey: 'style-exploration',
      currentTaskId: 'style-audition-1',
      currentGate: undefined,
      rowVersion: 9,
      updatedAt: 8,
    });
    vi.mocked(getAPI).mockReturnValue({
      taskLists: {
        list: vi.fn().mockResolvedValue([activeSummary]),
        getPendingApproval: vi.fn().mockResolvedValue(null),
        getVisualAuditions: vi.fn().mockResolvedValue(audition),
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CommanderPlanApproval canvasId="canvas-1" sessionId="session-1" t={(key) => key} />
      </Provider>,
    );

    expect(await screen.findByText('visual-audition-only-context')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'request-new-candidates' })).toBeNull();
  });

  it('does not render an in-progress audition without a Visual Constitution gate', async () => {
    const activeSummary: TaskListSummary = {
      ...summary,
      status: 'ready',
      currentPhaseKey: 'style-exploration',
      currentTaskId: 'style-audition-1',
      updatedAt: 8,
    };
    const audition = visualAuditionContext(
      {
        ...approvalContext('production_plan').taskList,
        status: 'ready',
        currentPhaseKey: 'style-exploration',
        currentTaskId: 'style-audition-1',
        currentGate: undefined,
        rowVersion: 9,
        updatedAt: 8,
      },
      'in_progress',
    );
    const getVisualAuditions = vi.fn().mockResolvedValue(audition);
    vi.mocked(getAPI).mockReturnValue({
      taskLists: {
        list: vi.fn().mockResolvedValue([activeSummary]),
        getPendingApproval: vi.fn().mockResolvedValue(null),
        getVisualAuditions,
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CommanderPlanApproval canvasId="canvas-1" sessionId="session-1" t={(key) => key} />
      </Provider>,
    );

    await waitFor(() => expect(getVisualAuditions).toHaveBeenCalledWith(activeSummary.id));
    expect(screen.queryByText('visual-approval-card')).toBeNull();
  });

  it('keeps the approved Delivery manifest visible after its approval gate has cleared', async () => {
    const approvedSummary: TaskListSummary = {
      ...summary,
      status: 'ready',
      currentPhaseKey: 'delivery',
      currentTaskId: 'delivery-1',
      updatedAt: 9,
    };
    const delivery = approvalContext('delivery');
    delivery.taskList = {
      ...delivery.taskList,
      status: 'ready',
      currentPhaseKey: 'delivery',
      currentTaskId: 'delivery-1',
      currentGate: undefined,
    };
    delivery.approval.status = 'approved';
    const getDelivery = vi.fn().mockResolvedValue({
      taskList: delivery.taskList,
      approval: delivery.approval,
      manifest: delivery.document,
    });
    vi.mocked(getAPI).mockReturnValue({
      taskLists: {
        list: vi.fn().mockResolvedValue([approvedSummary]),
        getPendingApproval: vi.fn().mockResolvedValue(null),
        getDelivery,
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CommanderPlanApproval canvasId="canvas-1" sessionId="session-1" t={(key) => key} />
      </Provider>,
    );

    expect(await screen.findByText('delivery-approval-card')).toBeTruthy();
    expect(getDelivery).toHaveBeenCalledWith(approvedSummary.id);
  });

  it('does not expose another Commander session approval on the same canvas', async () => {
    const getPendingApproval = vi.fn().mockResolvedValue(approvalContext('production_plan'));
    const list = vi.fn().mockResolvedValue([summary]);
    vi.mocked(getAPI).mockReturnValue({
      taskLists: { list, getPendingApproval },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <CommanderPlanApproval canvasId="canvas-1" sessionId="session-2" t={(key) => key} />
      </Provider>,
    );

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(getPendingApproval).not.toHaveBeenCalled();
    expect(screen.queryByText('production-approval-card')).toBeNull();
  });
});
