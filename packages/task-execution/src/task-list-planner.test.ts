import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { TaskListPlanner } from './task-list-planner.js';
import type { RegisteredTaskListBlueprint } from './task-list-registry.js';

function definition(count: number): RegisteredTaskListBlueprint {
  return {
    id: 'large.plan.v1',
    name: 'Large plan',
    version: 1,
    kind: 'test',
    displayCategory: 'Test',
    displayLabel: 'Large plan',
    cancellationPolicy: { allowCancellation: true },
    resumePolicy: { allowResume: true },
    tasks: Array.from({ length: count }, (_, index) => ({
      id: `task-${index}`,
      name: `Task ${index}`,
      phaseKey: 'work',
      phaseName: 'Work',
      phaseOrder: 0,
      kind: TaskKind.CommanderAction,
      handlerId: 'test.execute',
      maxRetries: 0,
      timeoutMs: 1_000,
      displayCategory: 'Test',
      displayLabel: `Task ${index}`,
      displayLabelKey: `taskLabels.test${index}`,
      dependsOnTaskIds: index === 0 ? [] : [`task-${index - 1}`],
    })),
  };
}

describe('TaskListPlanner dependency graph', () => {
  it('plans a large dependency chain with Task.dependencyIds as the sole graph representation', () => {
    let id = 0;
    const planned = new TaskListPlanner().plan({
      definition: definition(5_000),
      entityType: 'test',
      now: 1,
      idFactory: () => `id-${id++}`,
    });

    expect(planned).not.toHaveProperty('taskDependencies');
    expect(planned.tasks).toHaveLength(5_000);
    expect(planned.tasks[0]?.dependencyIds).toEqual([]);
    expect(planned.tasks[4_999]?.dependencyIds).toEqual([planned.tasks[4_998]?.id]);
    expect(planned.tasks[0]?.input.displayLabelKey).toBe('taskLabels.test0');
  });

  it('rejects a cycle without persisting a second dependency representation', () => {
    const cyclic = definition(3);
    cyclic.tasks[0]!.dependsOnTaskIds = ['task-2'];

    expect(() => new TaskListPlanner().plan({ definition: cyclic, entityType: 'test' })).toThrow(
      'Circular task dependency',
    );
  });
});
