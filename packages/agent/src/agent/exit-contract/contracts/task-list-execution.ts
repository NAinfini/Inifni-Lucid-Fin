import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Unified execution contract for all recognized task lists.
 * Satisfied by any single successful mutation commit (the specific
 * task-list name is preserved in the RunIntent for guide selection
 * and reporting, but the contract evaluation is the same).
 *
 * Replaces the former per-task-list contracts (story-to-video,
 * style-plate, shot-list, continuity-check, image-analyze,
 * audio-production, style-transfer).
 */
export const taskListExecutionContract: CompletionContract = {
  id: 'task-list-execution',
  requiredCommits: [
    {
      toolName: '*',
      description: 'Any successful mutation commit matching the task-list domain.',
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 3,
};

contractRegistry.register(taskListExecutionContract);
