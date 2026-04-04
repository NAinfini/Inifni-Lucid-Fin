import { TaskKind } from '@lucid-fin/contracts';
import type { RegisteredWorkflowDefinition } from '../workflow-registry.js';

export const storyboardGenerateWorkflow: RegisteredWorkflowDefinition = {
  id: 'storyboard.generate',
  name: 'Generate storyboard',
  version: 1,
  kind: 'storyboard.generate',
  description:
    'Generate storyboard variants and publish storyboard-ready outputs for a scene or keyframe.',
  displayCategory: 'Storyboard',
  displayLabel: 'Generate storyboard',
  summary: 'Generate storyboard variants for a scene.',
  stages: [
    {
      id: 'prepare',
      name: 'Prepare storyboard job',
      order: 0,
      tasks: [
        {
          id: 'validate-storyboard-input',
          name: 'Validate storyboard input',
          kind: TaskKind.Validation,
          handlerId: 'storyboard.validate-input',
          maxRetries: 1,
          displayCategory: 'Storyboard',
          displayLabel: 'Validate storyboard request',
          summary: 'Validate the target scene, keyframe prompt, and generation parameters.',
        },
      ],
    },
    {
      id: 'generate',
      name: 'Generate storyboard variants',
      order: 1,
      dependsOnStageIds: ['prepare'],
      tasks: [
        {
          id: 'generate-frames',
          name: 'Generate storyboard frames',
          kind: TaskKind.AdapterGeneration,
          handlerId: 'storyboard.generate.frames',
          maxRetries: 2,
          providerHint: 'flux',
          displayCategory: 'Storyboard',
          displayLabel: 'Generate storyboard frames',
          modelKey: 'flux',
          promptTemplateId: 'storyboard.generate.frames',
          promptTemplateVersion: '1.0.0',
          summary: 'Generate storyboard frame variants from the selected scene prompt.',
        },
      ],
    },
    {
      id: 'publish',
      name: 'Publish storyboard outputs',
      order: 2,
      dependsOnStageIds: ['generate'],
      tasks: [
        {
          id: 'publish-storyboard',
          name: 'Publish storyboard outputs',
          kind: TaskKind.Transform,
          handlerId: 'storyboard.publish',
          maxRetries: 1,
          displayCategory: 'Storyboard',
          displayLabel: 'Publish storyboard outputs',
          summary: 'Persist storyboard outputs and attach produced assets to the target scene.',
        },
      ],
    },
  ],
};
