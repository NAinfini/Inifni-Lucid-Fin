import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Fallback contract for runs with no matching workflow. Applies to
 * informational and browse intents; execution intents that fail to
 * classify to a known workflow fall here too and always report
 * `unsatisfied` with an empty `expected` list (a signal to the author
 * that the classifier missed).
 */
export const infoAnswerContract: CompletionContract = {
  id: 'info-answer',
  requiredCommits: [],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 0,
};

contractRegistry.register(infoAnswerContract);
contractRegistry.setFallback(infoAnswerContract.id);
