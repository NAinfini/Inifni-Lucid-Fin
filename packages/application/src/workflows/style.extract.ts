import { TaskKind } from '@lucid-fin/contracts';
import type { RegisteredWorkflowDefinition } from '../workflow-registry.js';

export const styleExtractWorkflow: RegisteredWorkflowDefinition = {
  id: 'style.extract',
  name: 'Extract style',
  version: 1,
  kind: 'style.extract',
  description:
    'Extract a reusable color and lighting profile from an imported image or video asset.',
  displayCategory: 'Style',
  displayLabel: 'Extract style',
  summary: 'Extract a reusable style profile from a reference asset.',
  stages: [
    {
      id: 'resolve',
      name: 'Resolve source asset',
      order: 0,
      tasks: [
        {
          id: 'resolve-style-asset',
          name: 'Resolve style asset',
          kind: TaskKind.AssetResolve,
          handlerId: 'style.resolve-asset',
          maxRetries: 1,
          displayCategory: 'Style',
          displayLabel: 'Resolve source asset',
          summary: 'Resolve the source image or video and prepare provider-ready input data.',
        },
      ],
    },
    {
      id: 'extract',
      name: 'Extract style profile',
      order: 1,
      dependsOnStageIds: ['resolve'],
      tasks: [
        {
          id: 'extract-style-profile',
          name: 'Extract style profile',
          kind: TaskKind.MetadataExtract,
          handlerId: 'style.extract.profile',
          maxRetries: 2,
          displayCategory: 'Style',
          displayLabel: 'Extract style profile',
          promptTemplateId: 'style.extract.profile',
          promptTemplateVersion: '1.0.0',
          summary: 'Extract palette, gradients, and exposure data from the source asset.',
        },
      ],
    },
    {
      id: 'persist',
      name: 'Persist extracted style',
      order: 2,
      dependsOnStageIds: ['extract'],
      tasks: [
        {
          id: 'persist-style-profile',
          name: 'Persist style profile',
          kind: TaskKind.Transform,
          handlerId: 'style.persist',
          maxRetries: 1,
          displayCategory: 'Style',
          displayLabel: 'Persist extracted style',
          summary: 'Save the extracted style profile as a reusable color style entry.',
        },
      ],
    },
  ],
};
