import type { CompletionContract } from '../types.js';
import { contractRegistry } from '../contract-registry.js';

/**
 * Execution contract for the style-plate workflow (locking a canvas-wide
 * style plate). Mirrors the "Terminal commitment" section of
 * `docs/ai-skills/workflows/style-plate.md`:
 *
 *   canvas.setSettings — writing `stylePlate` onto the canvas settings is
 *   the whole point of the lock step. Nothing else persists the plate.
 *
 * The `argPredicate` requires the `stylePlate` key to be present in the
 * settings update. Other `canvas.setSettings` calls (audio provider, etc.)
 * do not satisfy this contract.
 */
export const stylePlateContract: CompletionContract = {
  id: 'style-plate',
  requiredCommits: [
    {
      toolName: 'canvas.setSettings',
      description: 'Persist `stylePlate` onto canvas settings.',
      argPredicate: (args) => stylePlateKeyTouched(args),
    },
  ],
  infoIntentExemption: true,
  blockingQuestionsAllowed: 1,
};

function stylePlateKeyTouched(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const settings = (args as Record<string, unknown>).settings;
  if (!settings || typeof settings !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(settings, 'stylePlate');
}

contractRegistry.register(stylePlateContract);
