import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the story-to-video workflow. Mirrors the
 * "Terminal commitment" section of
 * `docs/ai-skills/workflows/story-to-video.md`:
 *
 *   canvas.batchCreate — scene seeding is the workflow's whole output;
 *   without at least one atomic create-nodes-and-edges call, nothing
 *   persists to the canvas.
 *
 * `argPredicate` enforces "at least one node created" so a no-op call
 * (empty `nodes` array) does not count as the terminal commit.
 */
export const storyToVideoContract: CompletionContract = {
  id: 'story-to-video',
  requiredCommits: [
    {
      toolName: 'canvas.batchCreate',
      description:
        'Atomic create of scene nodes and edges — the workflow output.',
      argPredicate: (args) => nodesArray(args).length >= 1,
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

contractRegistry.register(storyToVideoContract);
