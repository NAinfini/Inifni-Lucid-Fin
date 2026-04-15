import { describe, expect, it } from 'vitest';
import { TaskKind } from '@lucid-fin/contracts';
import { WorkflowRegistry } from '../workflow-registry.js';
import { registerDefaultWorkflows } from '../register-default-workflows.js';
import { styleExtractWorkflow } from './style.extract.js';

describe('style.extract workflow definition', () => {
  it('defines style extraction stages around asset resolution, extraction, and persistence', () => {
    expect(styleExtractWorkflow).toMatchObject({
      id: 'style.extract',
      kind: 'style.extract',
      displayCategory: 'Style',
      displayLabel: 'Extract style',
      stages: [
        {
          id: 'resolve',
          name: 'Resolve source asset',
          order: 0,
        },
        {
          id: 'extract',
          name: 'Extract style profile',
          order: 1,
        },
        {
          id: 'persist',
          name: 'Persist extracted style',
          order: 2,
        },
      ],
    });

    const extractStage = styleExtractWorkflow.stages.find((stage) => stage.id === 'extract');
    expect(extractStage?.tasks).toEqual([
      expect.objectContaining({
        id: 'extract-style-profile',
        kind: TaskKind.MetadataExtract,
        handlerId: 'style.extract.profile',
        displayCategory: 'Style',
        displayLabel: 'Extract style profile',
        promptTemplateId: 'style.extract.profile',
      }),
    ]);
  });

  it('registers default workflows into the registry', () => {
    const registry = registerDefaultWorkflows(new WorkflowRegistry());

    expect(registry.has('style.extract')).toBe(true);
    expect(registry.has('character.generate-references')).toBe(true);
    expect(registry.has('location.generate-references')).toBe(true);
    expect(registry.get('style.extract')).toEqual(styleExtractWorkflow);
  });
});
