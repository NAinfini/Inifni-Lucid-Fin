import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { TaskListRegistry } from '../task-list-registry.js';
import { registerDefaultTaskLists } from '../register-default-task-lists.js';
import { styleExtractTaskList } from './style.extract.js';

describe('style.extract task-list blueprint', () => {
  it('defines ordered extraction phases on its tasks', () => {
    expect(styleExtractTaskList).toMatchObject({
      id: 'style.extract',
      kind: 'style.extract',
      displayCategory: 'Style',
      displayLabel: 'Extract style',
      tasks: [
        expect.objectContaining({ phaseKey: 'resolve', phaseOrder: 0 }),
        expect.objectContaining({ phaseKey: 'extract', phaseOrder: 1 }),
        expect.objectContaining({ phaseKey: 'persist', phaseOrder: 2 }),
      ],
    });

    expect(styleExtractTaskList.tasks.find((task) => task.phaseKey === 'extract')).toEqual(
      expect.objectContaining({
        id: 'extract-style-profile',
        kind: TaskKind.MetadataExtract,
        handlerId: 'style.extract.profile',
        displayCategory: 'Style',
        displayLabel: 'Extract style profile',
        promptTemplateId: 'style.extract.profile',
      }),
    );
  });

  it('registers default task lists into the registry', () => {
    const registry = registerDefaultTaskLists(new TaskListRegistry());

    expect(registry.has('style.extract')).toBe(true);
    expect(registry.has('character.generate-references')).toBe(false);
    expect(registry.has('location.generate-references')).toBe(false);
    expect(registry.get('style.extract')).toEqual(styleExtractTaskList);
  });
});
