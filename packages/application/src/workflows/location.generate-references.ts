import { TaskKind } from '@lucid-fin/contracts';
import type { RegisteredWorkflowDefinition } from '../workflow-registry.js';

export const locationGenerateReferencesWorkflow: RegisteredWorkflowDefinition = {
  id: 'location.generate-references',
  name: 'Generate location references',
  version: 1,
  kind: 'location.generate-references',
  description: 'Generate reference images for a location.',
  displayCategory: 'Location',
  displayLabel: 'Generate location references',
  summary: 'Generate reference images for a location.',
  stages: [
    {
      id: 'validate',
      name: 'Validate input',
      order: 0,
      tasks: [
        {
          id: 'validate-location-input',
          name: 'Validate location input',
          kind: TaskKind.Validation,
          handlerId: 'location.validate-input',
          maxRetries: 1,
          displayCategory: 'Location',
          displayLabel: 'Validate location input',
          summary: 'Validate the target location and generation parameters.',
        },
      ],
    },
    {
      id: 'generate',
      name: 'Generate reference image',
      order: 1,
      dependsOnStageIds: ['validate'],
      tasks: [
        {
          id: 'generate-location-ref-image',
          name: 'Generate location reference image',
          kind: TaskKind.AdapterGeneration,
          handlerId: 'location.generate-ref-image',
          maxRetries: 2,
          displayCategory: 'Location',
          displayLabel: 'Generate location reference image',
          summary: 'Generate a reference image for the location.',
        },
      ],
    },
    {
      id: 'persist',
      name: 'Persist reference image',
      order: 2,
      dependsOnStageIds: ['generate'],
      tasks: [
        {
          id: 'persist-location-ref-image',
          name: 'Persist location reference image',
          kind: TaskKind.Transform,
          handlerId: 'location.persist-ref-image',
          maxRetries: 1,
          displayCategory: 'Location',
          displayLabel: 'Persist location reference image',
          summary: 'Save the generated reference image to the location.',
        },
      ],
    },
  ],
};
