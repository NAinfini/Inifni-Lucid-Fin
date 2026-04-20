import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the image-analyze workflow. Mirrors
 * `docs/ai-skills/workflows/image-analyze.md`:
 *
 *   character.create / location.create / equipment.create — when the image
 *   introduces a new entity worth persisting.
 *   character.update / location.update / equipment.update — updating an
 *   existing entity record with newly extracted details.
 *   preset.create — when the image's value is primarily stylistic.
 *   canvas.updateNodes — when re-attaching entity refs to shot nodes is
 *   the actual ask.
 *
 * The contract uses `requiredCommits` for the most common terminal (entity
 * create) and `acceptableSubstitutes` for the alternates. The engine accepts
 * any substitute whose toolName matches, so any single successful call from
 * this list satisfies the contract.
 */
export const imageAnalyzeContract: CompletionContract = {
  id: 'image-analyze',
  requiredCommits: [
    {
      toolName: 'character.create',
      description: 'Persist a new character record extracted from the image.',
    },
  ],
  acceptableSubstitutes: [
    { toolName: 'location.create', description: 'Persist new location.' },
    { toolName: 'equipment.create', description: 'Persist new equipment.' },
    { toolName: 'character.update', description: 'Update existing character record.' },
    { toolName: 'location.update', description: 'Update existing location record.' },
    { toolName: 'equipment.update', description: 'Update existing equipment record.' },
    { toolName: 'preset.create', description: 'Persist the image as a style preset.' },
    {
      toolName: 'canvas.updateNodes',
      description: 'Re-attach entity refs to shot nodes.',
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 2,
};

contractRegistry.register(imageAnalyzeContract);
