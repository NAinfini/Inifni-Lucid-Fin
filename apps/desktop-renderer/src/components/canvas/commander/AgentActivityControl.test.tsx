// @vitest-environment jsdom

import React from 'react';
import type { TaskListSummary, TaskSummary } from '@lucid-fin/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '../../../i18n.js';
import type { AgentActivityTreeView } from '../../../commander/state/commander-timeline-selectors.js';
import { AgentActivityControl } from './AgentActivityControl.js';

const testMessages: Record<string, string> = {
      'commander.agentActivity.title': 'Agent activity',
      'commander.agentActivity.tree': 'Execution tree',
      'commander.agentActivity.close': 'Close activity',
      'commander.agentActivity.back': 'Back to execution tree',
      'commander.agentActivity.trigger': '{count} active units · {name}',
      'commander.agentActivity.activeUnits': '{count} active units',
      'commander.agentActivity.objective': 'Objective',
      'commander.agentActivity.objectiveUnavailable': 'No objective provided',
      'commander.agentActivity.publicPlan': 'Plan',
      'commander.agentActivity.currentWork': 'Current work',
      'commander.agentActivity.toolsAndResults': 'Tools and results',
      'commander.agentActivity.artifacts': 'Artifacts',
      'commander.agentActivity.resources': 'Resources',
      'commander.agentActivity.controls': 'Controls',
      'commander.agentActivity.details': 'View details',
      'commander.agentActivity.messagePlaceholder': 'Message “{name}”…',
      'commander.agentActivity.send': 'Send',
      'commander.agentActivity.pause': 'Pause',
      'commander.agentActivity.cancel': 'Cancel',
      'commander.agentActivity.cancelStep': 'Stop current step',
      'commander.agentActivity.status.running': 'Running',
      'commander.agentActivity.status.waitingUser': 'Waiting for your input',
      'commander.agentActivity.status.completed': 'Completed',
      'commander.agentActivity.status.blocked': 'Blocked',
      'commander.agentActivity.workType.agent': 'Agent',
      'commander.agentActivity.workType.subagent': 'Sub-agent',
      'commander.agentActivity.toolStatus.completed': 'Completed',
      'commander.agentActivity.resourceElapsed': 'Elapsed',
      'commander.agentActivity.resourceActiveTime': 'Active time',
      'commander.agentActivity.resourceTokens': 'Tokens',
      'commander.agentActivity.resourceToolCalls': 'Tool calls',
      'commander.agentActivity.resourceCost': 'Cost',
      'commander.resource.unavailable': 'Unavailable',
      'commander.resource.unlimited': 'Unlimited',
      'commander.resource.estimated': '~{value}',
      'commander.resource.blocker.costUnavailable': 'Cost information is unavailable.',
      'commander.agentActivity.cancelSubtreeTitle': 'Cancel execution?',
      'commander.agentActivity.cancelSubtreeDescription':
        'Cancel “{name}” and its {count} descendants?',
  'action.cancel': 'Cancel',
};

const t = (key: string) => testMessages[key] ?? key;

const activeTree: AgentActivityTreeView = {
  rootRunId: 'root-run',
  orderedRunIds: ['root-run', 'child-run'],
  hasActiveDescendant: true,
  nodesById: {
    'root-run': {
      runId: 'root-run',
      workType: 'agent',
      displayName: 'Production planner',
      objective: 'Build the production plan',
      status: 'running',
      publicPlan: [{ id: 'collect', title: 'Collect facts', status: 'completed' }],
      currentStep: { id: 'specify', title: 'Specify shots 004–008' },
      tools: [
        {
          id: 'canvas-list',
          capability: 'canvas.node.list',
          status: 'completed',
          startedAt: 100,
          completedAt: 110,
          durationMs: 10,
          summary: 'Read five shots',
        },
      ],
      artifacts: [],
      startedAt: 100,
      childRunIds: ['child-run'],
    },
    'child-run': {
      runId: 'child-run',
      parentRunId: 'root-run',
      workType: 'subagent',
      displayName: 'Continuity review',
      objective: 'Check character and prop continuity',
      status: 'waiting_user',
      publicPlan: [],
      tools: [],
      artifacts: [],
      startedAt: 120,
      childRunIds: [],
    },
  },
};

const activeTaskList: TaskListSummary = {
  id: 'task-list-1',
  commanderSessionId: 'session-1',
  taskListType: 'movie.production.v2',
  entityType: 'canvas',
  entityId: 'canvas-1',
  triggerSource: 'commander',
  status: 'running',
  summary: 'Production work',
  progress: 0.5,
  completedPhases: 1,
  totalPhases: 3,
  completedTasks: 1,
  totalTasks: 3,
  currentTaskId: 'task-running',
  displayCategory: 'production',
  displayLabel: 'Production work',
  createdAt: 1,
  updatedAt: 2,
};

const activeTaskListTasks: TaskSummary[] = [
  {
    id: 'task-completed',
    taskListId: 'task-list-1',
    phaseKey: 'plan',
    phaseName: 'Plan',
    phaseOrder: 0,
    taskKey: 'production-plan',
    kind: 'validation',
    status: 'completed',
    displayCategory: 'production',
    displayLabel: 'Create production plan',
    displayLabelKey: 'taskLabels.productionPlan',
    updatedAt: 1,
  },
  {
    id: 'task-running',
    taskListId: 'task-list-1',
    phaseKey: 'script',
    phaseName: 'Script',
    phaseOrder: 1,
    taskKey: 'story-shaping',
    name: 'Shape the lunar ruins story',
    kind: 'validation',
    status: 'running',
    displayCategory: 'production',
    displayLabel: 'Shape the lunar ruins story',
    currentStep: 'Checking the emotional arc',
    updatedAt: 2,
  },
  {
    id: 'task-pending',
    taskListId: 'task-list-1',
    phaseKey: 'shots',
    phaseName: 'Shots',
    phaseOrder: 2,
    taskKey: 'shot-specification',
    kind: 'validation',
    status: 'ready',
    displayCategory: 'production',
    displayLabel: 'Shot specification 001: Arrival',
    displayLabelKey: 'taskLabels.shotSpecification',
    relatedEntityLabel: '001: Arrival',
    updatedAt: 3,
  },
];

afterEach(() => {
  cleanup();
  delete (window as { lucidAPI?: unknown }).lucidAPI;
  setLocale('en-US');
});

describe('AgentActivityControl', () => {
  it('is the narrow single-column activity surface and only reflects supplied public data', () => {
    render(<AgentActivityControl sessionId="session-1" tree={activeTree} t={t} />);

    const control = screen.getByTestId('agent-activity-control');
    const trigger = screen.getByTestId('agent-activity-trigger');
    expect(control.className).toContain('max-w-[420px]');
    expect(control.className).toContain('w-[380px]');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
    expect(screen.getByRole('tree', { name: 'Execution tree' })).toBeTruthy();
    expect(screen.getByText('Production planner')).toBeTruthy();
    expect(screen.getByText('Continuity review')).toBeTruthy();
    expect(screen.queryByText(/provider body|authorization|secret/i)).toBeNull();

    fireEvent.click(screen.getByRole('treeitem', { name: /Continuity review/i }));
    expect(screen.getByText('Check character and prop continuity')).toBeTruthy();
    expect(screen.getByText('Waiting for your input')).toBeTruthy();
  });

  it('sends a targeted public message through the unified run control dispatcher', async () => {
    const runControl = vi.fn().mockResolvedValue({
      accepted: true,
      action: 'message',
      runId: 'child-run',
      affectedRunIds: ['child-run'],
    });
    (window as unknown as { lucidAPI: unknown }).lucidAPI = {
      commander: { runControl },
    };

    render(<AgentActivityControl sessionId="session-1" tree={activeTree} t={t} />);
    fireEvent.click(screen.getByTestId('agent-activity-trigger'));
    fireEvent.click(screen.getByRole('treeitem', { name: /Continuity review/i }));
    const composer = screen.getByTestId('agent-activity-message') as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: 'Use the latest wardrobe reference.' } });
    fireEvent.keyDown(composer, { key: 'Enter' });

    await waitFor(() =>
      expect(runControl).toHaveBeenCalledWith({
        runId: 'child-run',
        action: 'message',
        message: 'Use the latest wardrobe reference.',
      }),
    );
    expect(composer.value).toBe('');
  });

  it('uses the active durable Task List for the root plan and keeps host and AI labels distinct', () => {
    setLocale('zh-CN');
    render(
      <AgentActivityControl
        sessionId="session-1"
        tree={activeTree}
        taskList={activeTaskList}
        taskListTasks={activeTaskListTasks}
        t={t}
      />,
    );

    fireEvent.click(screen.getByTestId('agent-activity-trigger'));
    fireEvent.click(screen.getByRole('treeitem', { name: /Production planner/i }));

    expect(screen.getByText('创建制作计划')).toBeTruthy();
    expect(screen.getByText('镜头规格 001: Arrival')).toBeTruthy();
    expect(screen.getAllByText('Shape the lunar ruins story')).toHaveLength(2);
    expect(screen.getByText('Checking the emotional arc')).toBeTruthy();
    expect(screen.queryByText('Collect facts')).toBeNull();
  });

  it('does not expose stale Task List rows after the run tree has stopped', () => {
    const terminalTree: AgentActivityTreeView = {
      ...activeTree,
      hasActiveDescendant: false,
      nodesById: {
        ...activeTree.nodesById,
        'root-run': { ...activeTree.nodesById['root-run'], status: 'completed' },
        'child-run': { ...activeTree.nodesById['child-run'], status: 'completed' },
      },
    };

    const { container } = render(
      <AgentActivityControl
        sessionId="session-1"
        tree={terminalTree}
        focusRunId="root-run"
        taskList={activeTaskList}
        taskListTasks={activeTaskListTasks}
        t={t}
      />,
    );

    expect(container.textContent).not.toContain('Shape the lunar ruins story');
    expect(container.textContent).not.toContain('Create production plan');
  });

  it('removes the live entry when the complete tree is terminal', () => {
    const terminalTree: AgentActivityTreeView = {
      ...activeTree,
      hasActiveDescendant: false,
      nodesById: {
        ...activeTree.nodesById,
        'root-run': { ...activeTree.nodesById['root-run'], status: 'completed' },
        'child-run': { ...activeTree.nodesById['child-run'], status: 'completed' },
      },
    };

    const { container } = render(
      <AgentActivityControl sessionId="session-1" tree={terminalTree} t={t} />,
    );

    expect(container.childElementCount).toBe(0);
  });

  it('reuses the same activity component for a focused terminal history tree', async () => {
    const terminalTree: AgentActivityTreeView = {
      ...activeTree,
      hasActiveDescendant: false,
      nodesById: {
        ...activeTree.nodesById,
        'root-run': {
          ...activeTree.nodesById['root-run'],
          status: 'completed',
          completedAt: 180,
        },
        'child-run': {
          ...activeTree.nodesById['child-run'],
          status: 'blocked',
          completedAt: 170,
          blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
        },
      },
    };

    render(
      <AgentActivityControl
        sessionId="session-1"
        tree={terminalTree}
        focusRunId="child-run"
        inline
        t={t}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Check character and prop continuity')).toBeTruthy();
    });
    expect(screen.getByTestId('agent-activity-control').className).toContain('w-full');
    expect(screen.queryByTestId('agent-activity-trigger')).toBeNull();
    expect(document.querySelector('[data-radix-popper-content-wrapper]')).toBeNull();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Cost information is unavailable.')).toBeTruthy();
    expect(screen.queryByText('resource_budget')).toBeNull();
    expect(screen.queryByText('commander.agentActivity.retry')).toBeNull();
  });
});
