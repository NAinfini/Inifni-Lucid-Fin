import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the style-transfer workflow. Mirrors
 * `docs/ai-skills/workflows/style-transfer.md`:
 *
 *   canvas.batchCreate — when style is being applied through new preset or
 *   reference nodes.
 *   canvas.updateNodes — applying the style by updating preset tracks,
 *   prompts, or refs on existing shot nodes.
 *   preset.create / preset.update — when the output is a reusable preset.
 */
export const styleTransferContract: CompletionContract = {
  id: 'style-transfer',
  requiredCommits: [
    {
      toolName: 'canvas.updateNodes',
      description: 'Update preset / prompt / ref on existing shot nodes.',
      argPredicate: (args) => updatesArray(args).length >= 1,
    },
  ],
  acceptableSubstitutes: [
    {
      toolName: 'canvas.batchCreate',
      description: 'Create new preset / reference nodes.',
      argPredicate: (args) => nodesArray(args).length >= 1,
    },
    { toolName: 'preset.create', description: 'Persist as a new preset.' },
    { toolName: 'preset.update', description: 'Update an existing preset.' },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 2,
};

function updatesArray(args: unknown): unknown[] {
  if (!args || typeof args !== 'object') return [];
  const updates = (args as Record<string, unknown>).updates;
  return Array.isArray(updates) ? updates : [];
}

function nodesArray(args: unknown): unknown[] {
  if (!args || typeof args !== 'object') return [];
  const nodes = (args as Record<string, unknown>).nodes;
  return Array.isArray(nodes) ? nodes : [];
}

contractRegistry.register(styleTransferContract);
