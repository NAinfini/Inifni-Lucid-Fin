import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { WorkflowRegistry, type RegisteredWorkflowDefinition } from './workflow-registry.js';

function makeDefinition(id: string): RegisteredWorkflowDefinition {
  return {
    id,
    name: `Workflow ${id}`,
    version: 1,
    kind: id,
    description: `Definition for ${id}`,
    displayCategory: 'Storyboard',
    displayLabel: `Run ${id}`,
    stages: [
      {
        id: 'stage-1',
        name: 'Stage 1',
        order: 0,
        tasks: [
          {
            id: 'task-1',
            name: 'Task 1',
            kind: TaskKind.Validation,
            handlerId: 'validate',
            maxRetries: 1,
            displayCategory: 'Validation',
            displayLabel: 'Validate input',
          },
        ],
      },
    ],
  };
}

describe('WorkflowRegistry', () => {
  it('registers workflow definitions and exposes get/has/list semantics', () => {
    const registry = new WorkflowRegistry();
    const storyboard = makeDefinition('storyboard.generate');
    const style = makeDefinition('style.extract');

    expect(registry.has(storyboard.id)).toBe(false);
    expect(registry.get(storyboard.id)).toBeUndefined();

    registry.register(storyboard);
    registry.register(style);

    expect(registry.has(storyboard.id)).toBe(true);
    expect(registry.get(storyboard.id)).toEqual(storyboard);
    expect(registry.list()).toEqual([storyboard, style]);
  });
});
