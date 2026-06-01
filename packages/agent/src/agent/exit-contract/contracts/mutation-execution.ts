import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Generic execution contract for runs without a recognized workflow.
 * Satisfied by any single successful mutation commit.
 */
export const mutationExecutionContract: CompletionContract = {
  id: 'mutation-execution',
  requiredCommits: [
    {
      toolName: '*',
      description: 'Any successful mutation commit.',
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 3,
};

contractRegistry.register(mutationExecutionContract);
