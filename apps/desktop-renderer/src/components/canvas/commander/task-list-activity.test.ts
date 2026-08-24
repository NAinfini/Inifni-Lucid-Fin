import type { TaskSummary } from '@lucid-fin/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '../../../i18n.js';
import { buildTaskListActivityPlan, taskStatusToActivityPlanStatus } from './task-list-activity.js';

function task(status: TaskSummary['status']): TaskSummary {
  return {
    id: status,
    taskListId: 'list-1',
    phaseKey: 'phase',
    phaseName: 'Phase',
    phaseOrder: 0,
    taskKey: status,
    kind: 'validation',
    status,
    displayCategory: 'production',
    displayLabel: status,
    updatedAt: 1,
  };
}

afterEach(() => setLocale('en-US'));

describe('Task List activity plan', () => {
  it('maps each durable TaskStatus to its public plan status', () => {
    expect(taskStatusToActivityPlanStatus('pending')).toBe('pending');
    expect(taskStatusToActivityPlanStatus('ready')).toBe('pending');
    expect(taskStatusToActivityPlanStatus('running')).toBe('running');
    expect(taskStatusToActivityPlanStatus('awaiting_provider')).toBe('running');
    expect(taskStatusToActivityPlanStatus('completed')).toBe('completed');
    expect(taskStatusToActivityPlanStatus('blocked')).toBe('blocked');
    expect(taskStatusToActivityPlanStatus('retryable_failed')).toBe('failed');
    expect(taskStatusToActivityPlanStatus('failed')).toBe('failed');
    expect(taskStatusToActivityPlanStatus('cancelled')).toBe('skipped');
    expect(taskStatusToActivityPlanStatus('skipped')).toBe('skipped');
  });

  it('keeps AI-authored labels verbatim while localizing host-authored labels and current work', () => {
    setLocale('zh-CN');
    const current = {
      ...task('running'),
      id: 'current',
      displayLabel: 'Shape the lunar ruins story',
      name: 'Shape the lunar ruins story',
      currentStep: 'Checking the emotional arc',
    };
    const plan = buildTaskListActivityPlan(
      { currentTaskId: current.id },
      [
        {
          ...task('completed'),
          displayLabel: 'Create production plan',
          displayLabelKey: 'taskLabels.productionPlan',
        },
        current,
      ],
    );

    expect(plan.items.map((item) => item.title)).toEqual([
      '创建制作计划',
      'Shape the lunar ruins story',
    ]);
    expect(plan.currentStep).toEqual({
      id: 'current',
      title: 'Shape the lunar ruins story',
      summary: 'Checking the emotional arc',
    });
  });
});
