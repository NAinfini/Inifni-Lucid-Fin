import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the continuity-check workflow. Mirrors
 * `docs/ai-skills/workflows/continuity-check.md`:
 *
 *   canvas.updateNodes — batch update of prompt / negative-prompt / preset
 *   fields across affected nodes is the normal terminal call.
 *   commander.askUser confirming "no changes needed" — when the pass
 *   legitimately finds nothing to fix, surface that as an explicit
 *   confirmation rather than a silent summary.
 *
 * Note: the "no changes needed" branch is covered by
 * `blockingQuestionsAllowed: 1` + the engine's `ask_user_asked` handling.
 * The engine counts outstanding asks against the allowance rather than
 * resolving askUser as a commit; that's intentional — an askUser is
 * blocked-waiting-user, not satisfied.
 */
export const continuityCheckContract: CompletionContract = {
  id: 'continuity-check',
  requiredCommits: [
    {
      toolName: 'canvas.updateNodes',
      description: 'Batch update prompt / preset / ref fields across affected nodes.',
      argPredicate: (args) => updatesArray(args).length >= 1,
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 1,
};

function updatesArray(args: unknown): unknown[] {
  if (!args || typeof args !== 'object') return [];
  const updates = (args as Record<string, unknown>).updates;
  return Array.isArray(updates) ? updates : [];
}

contractRegistry.register(continuityCheckContract);
