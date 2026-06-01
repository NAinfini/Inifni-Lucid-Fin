import { TaskKind } from '@lucid-fin/contracts';
import type { RegisteredWorkflowDefinition } from '../workflow-registry.js';

export const characterGenerateReferencesWorkflow: RegisteredWorkflowDefinition = {
  id: 'character.generate-references',
  name: 'Generate character references',
  version: 1,
  kind: 'character.generate-references',
  description: 'Generate reference images for a character.',
  displayCategory: 'Character',
  displayLabel: 'Generate character references',
  summary: 'Generate reference images for a character.',
  stages: [
    {
      id: 'validate',
      name: 'Validate input',
      order: 0,
      tasks: [
        {
          id: 'validate-character-input',
          name: 'Validate character input',
          kind: TaskKind.Validation,
          handlerId: 'character.validate-input',
          maxRetries: 1,
          displayCategory: 'Character',
          displayLabel: 'Validate character input',
          summary: 'Validate the target character and generation parameters.',
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
          id: 'generate-character-ref-image',
          name: 'Generate character reference image',
          kind: TaskKind.AdapterGeneration,
          handlerId: 'character.generate-ref-image',
          maxRetries: 2,
          displayCategory: 'Character',
          displayLabel: 'Generate character reference image',
          summary: 'Generate a reference image for the character.',
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
          id: 'persist-character-ref-image',
          name: 'Persist character reference image',
          kind: TaskKind.Transform,
          handlerId: 'character.persist-ref-image',
          maxRetries: 1,
          displayCategory: 'Character',
          displayLabel: 'Persist character reference image',
          summary: 'Save the generated reference image to the character.',
        },
      ],
    },
  ],
};
