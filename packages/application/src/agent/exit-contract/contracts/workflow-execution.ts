import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Unified execution contract for all recognized workflows.
 * Satisfied by any single successful mutation commit (the specific
 * workflow name is preserved in the RunIntent for guide selection
 * and reporting, but the contract evaluation is the same).
 *
 * Replaces the former per-workflow contracts (story-to-video,
 * style-plate, shot-list, continuity-check, image-analyze,
 * audio-production, style-transfer).
 */
export const workflowExecutionContract: CompletionContract = {
  id: 'workflow-execution',
  requiredCommits: [
    {
      toolName: '*',
      description: 'Any successful mutation commit matching the workflow domain.',
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 3,
};

contractRegistry.register(workflowExecutionContract);
