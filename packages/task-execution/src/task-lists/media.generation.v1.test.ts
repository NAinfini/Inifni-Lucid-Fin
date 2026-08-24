import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { TaskListRegistry } from '../task-list-registry.js';
import { registerDefaultTaskLists } from '../register-default-task-lists.js';
import { mediaGenerationTaskList } from './media.generation.v1.js';

describe('media.generation.v1 task-list blueprint', () => {
  it('registers one durable, non-retrying adapter-generation task', () => {
    expect(mediaGenerationTaskList).toMatchObject({
      id: 'media.generation.v1',
      version: 1,
      tasks: [
        expect.objectContaining({
          id: 'generate-media',
      kind: TaskKind.AdapterGeneration,
      handlerId: 'media.generate',
      inputBinding: { taskRole: 'canvas_media' },
          promptTemplateId: 'media-generation',
          maxRetries: 0,
        }),
      ],
    });
    expect(registerDefaultTaskLists(new TaskListRegistry()).get('media.generation.v1')).toEqual(
      mediaGenerationTaskList,
    );
  });
});
