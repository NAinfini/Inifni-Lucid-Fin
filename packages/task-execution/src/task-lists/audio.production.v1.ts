import { TaskKind } from '@lucid-fin/contracts';
import type { RegisteredTaskListBlueprint } from '../task-list-registry.js';

export const audioProductionTaskList: RegisteredTaskListBlueprint = {
  id: 'audio.production.v1',
  name: 'Audio production',
  version: 1,
  kind: 'audio-production',
  description:
    'Assemble a Commander-authored prompt, generate one audio asset, and persist its lineage.',
  displayCategory: 'Audio',
  displayLabel: 'Audio production',
  displayLabelKey: 'taskListLabels.audioProduction',
  summary: 'Generate a durable voice, music, or sound-effect asset.',
  cancellationPolicy: { allowCancellation: true },
  resumePolicy: { allowResume: true },
  tasks: [
    {
      id: 'generate-audio',
      name: 'Generate audio',
      phaseKey: 'generation',
      phaseName: 'Audio generation',
      phaseOrder: 0,
      kind: TaskKind.AdapterGeneration,
      handlerId: 'audio.generate',
      maxRetries: 1,
      timeoutMs: 30 * 60 * 1_000,
      displayCategory: 'Audio',
      displayLabel: 'Generate audio',
      displayLabelKey: 'taskLabels.generateAudio',
      promptTemplateId: 'audio-generation',
      promptTemplateVersion: '1.0.0',
      summary: 'Wait for Commander Prompt Assembly, submit once, and persist the audio artifact.',
    },
  ],
};
