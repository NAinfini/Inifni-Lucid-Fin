import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { TaskListRegistry } from '../task-list-registry.js';
import { registerDefaultTaskLists } from '../register-default-task-lists.js';
import { audioProductionTaskList } from './audio.production.v1.js';

describe('audio.production.v1 task-list blueprint', () => {
  it('registers one durable adapter-generation task', () => {
    expect(audioProductionTaskList).toMatchObject({
      id: 'audio.production.v1',
      version: 1,
      tasks: [
        expect.objectContaining({
          id: 'generate-audio',
          kind: TaskKind.AdapterGeneration,
          handlerId: 'audio.generate',
          promptTemplateId: 'audio-generation',
        }),
      ],
    });
    expect(registerDefaultTaskLists(new TaskListRegistry()).get('audio.production.v1')).toEqual(
      audioProductionTaskList,
    );
  });
});
