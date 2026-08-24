import { TaskKind } from '@lucid-fin/contracts';
import type { RegisteredTaskListBlueprint } from '../task-list-registry.js';

export const mediaGenerationTaskList: RegisteredTaskListBlueprint = {
  id: 'media.generation.v1',
  name: 'Media generation',
  version: 1,
  kind: 'media-generation',
  description:
    'Assemble a Commander-authored prompt, generate one image or video node, and persist its lineage.',
  displayCategory: 'Media',
  displayLabel: 'Media generation',
  displayLabelKey: 'taskListLabels.mediaGeneration',
  summary: 'Generate a durable image or video asset for one canvas node.',
  cancellationPolicy: { allowCancellation: true },
  resumePolicy: { allowResume: true },
  tasks: [
    {
      id: 'generate-media',
      name: 'Generate media',
      phaseKey: 'generation',
      phaseName: 'Media generation',
      phaseOrder: 0,
      kind: TaskKind.AdapterGeneration,
      handlerId: 'media.generate',
      inputBinding: { taskRole: 'canvas_media' },
      maxRetries: 0,
      timeoutMs: 30 * 60 * 1_000,
      displayCategory: 'Media',
      displayLabel: 'Generate media',
      displayLabelKey: 'taskLabels.generateMedia',
      promptTemplateId: 'media-generation',
      promptTemplateVersion: '1.0.0',
      summary:
        'Wait for Commander Prompt Assembly, submit once, and persist the media artifacts and evaluation.',
    },
  ],
};
