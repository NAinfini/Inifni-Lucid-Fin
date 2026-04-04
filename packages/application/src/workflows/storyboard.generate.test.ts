import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { storyboardGenerateWorkflow } from './storyboard.generate.js';

describe('storyboard.generate workflow definition', () => {
  it('defines storyboard-specific stages and user-facing task metadata', () => {
    expect(storyboardGenerateWorkflow).toMatchObject({
      id: 'storyboard.generate',
      kind: 'storyboard.generate',
      displayCategory: 'Storyboard',
      displayLabel: 'Generate storyboard',
      stages: [
        {
          id: 'prepare',
          name: 'Prepare storyboard job',
          order: 0,
        },
        {
          id: 'generate',
          name: 'Generate storyboard variants',
          order: 1,
        },
        {
          id: 'publish',
          name: 'Publish storyboard outputs',
          order: 2,
        },
      ],
    });

    const generateStage = storyboardGenerateWorkflow.stages.find(
      (stage) => stage.id === 'generate',
    );
    expect(generateStage?.tasks).toEqual([
      expect.objectContaining({
        id: 'generate-frames',
        kind: TaskKind.AdapterGeneration,
        handlerId: 'storyboard.generate.frames',
        displayCategory: 'Storyboard',
        displayLabel: 'Generate storyboard frames',
        providerHint: 'flux',
        modelKey: 'flux',
        promptTemplateId: 'storyboard.generate.frames',
      }),
    ]);

    const publishStage = storyboardGenerateWorkflow.stages.find((stage) => stage.id === 'publish');
    expect(publishStage?.tasks).toEqual([
      expect.objectContaining({
        id: 'publish-storyboard',
        kind: TaskKind.Transform,
        handlerId: 'storyboard.publish',
        displayCategory: 'Storyboard',
        displayLabel: 'Publish storyboard outputs',
      }),
    ]);
  });
});
