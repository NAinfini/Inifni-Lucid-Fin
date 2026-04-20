import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the shot-list workflow. Mirrors
 * `docs/ai-skills/workflows/shot-list.md`:
 *
 *   canvas.batchCreate — creating the shot nodes and edges atomically is
 *   the workflow's primary output.
 *   shotTemplate.create — when the user wants a reusable template rather
 *   than canvas nodes.
 */
export const shotListContract: CompletionContract = {
  id: 'shot-list',
  requiredCommits: [
    {
      toolName: 'canvas.batchCreate',
      description: 'Create the shot nodes and edges atomically.',
      argPredicate: (args) => nodesArray(args).length >= 1,
    },
  ],
  acceptableSubstitutes: [
    {
      toolName: 'shotTemplate.create',
      description: 'Reusable shot template instead of per-canvas nodes.',
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 2,
};

function nodesArray(args: unknown): unknown[] {
  if (!args || typeof args !== 'object') return [];
  const nodes = (args as Record<string, unknown>).nodes;
  return Array.isArray(nodes) ? nodes : [];
}

contractRegistry.register(shotListContract);
