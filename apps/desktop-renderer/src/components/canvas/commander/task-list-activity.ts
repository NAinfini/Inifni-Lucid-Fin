import type { TaskListSummary, TaskStatus, TaskSummary } from '@lucid-fin/contracts';

import { localizeTaskLabel } from '../../../i18n.js';
import type {
  AgentActivityPlanItem,
  AgentActivityPlanStatus,
  AgentActivityNodeView,
} from '../../../commander/state/commander-timeline-selectors.js';

export interface TaskListActivityPlan {
  items: AgentActivityPlanItem[];
  currentStep?: NonNullable<AgentActivityNodeView['currentStep']>;
}

export function taskStatusToActivityPlanStatus(status: TaskStatus): AgentActivityPlanStatus {
  switch (status) {
    case 'pending':
    case 'ready':
      return 'pending';
    case 'running':
    case 'awaiting_provider':
      return 'running';
    case 'completed':
      return 'completed';
    case 'blocked':
      return 'blocked';
    case 'retryable_failed':
    case 'failed':
      return 'failed';
    case 'cancelled':
    case 'skipped':
      return 'skipped';
  }
}

export function localizeTaskListItemLabel(task: TaskSummary): string {
  return localizeTaskLabel(
    task.displayLabelKey,
    task.displayLabel || task.name || task.taskKey,
    task.relatedEntityLabel,
  );
}

function currentTaskForList(
  taskList: Pick<TaskListSummary, 'currentTaskId'>,
  tasks: readonly TaskSummary[],
): TaskSummary | undefined {
  if (taskList.currentTaskId) {
    const current = tasks.find((task) => task.id === taskList.currentTaskId);
    if (current) return current;
  }
  return tasks.find((task) => task.status === 'running' || task.status === 'awaiting_provider');
}

export function buildTaskListActivityPlan(
  taskList: Pick<TaskListSummary, 'currentTaskId'>,
  tasks: readonly TaskSummary[],
): TaskListActivityPlan {
  const currentTask = currentTaskForList(taskList, tasks);
  const currentSummary = currentTask?.currentStep?.trim() || currentTask?.summary?.trim();

  return {
    items: tasks.map((task) => ({
      id: task.id,
      title: localizeTaskListItemLabel(task),
      status: taskStatusToActivityPlanStatus(task.status),
    })),
    ...(currentTask
      ? {
          currentStep: {
            id: currentTask.id,
            title: localizeTaskListItemLabel(currentTask),
            ...(currentSummary ? { summary: currentSummary } : {}),
          },
        }
      : {}),
  };
}
