import type { ActivationContext, ProcessPromptSpec } from '../process-prompt-spec.js';

/**
 * Canvas-state-driven process prompt: when the LLM is about to fire a
 * visual-generation tool on a canvas whose `stylePlate` is empty, inject
 * the Style-Plate Lock guide first.
 *
 * Before Phase C this lived as `primeStylePlateLockIfNeeded` on the
 * orchestrator. Moving the predicate here makes it a data entry — future
 * specs (e.g. "canvas has no characters before character-aware
 * generation") follow the same pattern, no orchestrator edit required.
 *
 * The spec does not produce its own content body — the orchestrator
 * owns the prompt-text lookup (via `resolveProcessPrompt`) and injects
 * the resolved string as `content`. Keeping the spec pure means tests
 * can exercise the predicate independently of IPC wiring.
 */
export interface StylePlateLockSpecDeps {
  /**
   * Returns the resolved prompt body for the given key, or null/empty if
   * the store has no entry. The orchestrator wires this from
   * `resolveProcessPrompt('style-plate-lock')`.
   */
  resolvePromptText: (key: 'style-plate-lock') => string | null | undefined;
}

export function createStylePlateLockSpec(
  deps: StylePlateLockSpecDeps,
): ProcessPromptSpec {
  return {
    key: 'style-plate-lock',
    displayName: 'Style Plate Lock',
    lifecycle: 'sticky',
    activationPredicate: (ctx) => stylePlateLockPredicate(ctx),
    content: () => deps.resolvePromptText('style-plate-lock')?.trim() ?? '',
  };
}

export function stylePlateLockPredicate(ctx: ActivationContext): boolean {
  if (!ctx.canvasId) return false;
  if (ctx.pendingToolCalls.length === 0) return false;
  if (!ctx.pendingToolCalls.some((tc) => isGenerationTool(tc.name, tc.arguments))) {
    return false;
  }

  // `canvasSettings === undefined` means the host didn't wire a settings
  // resolver. Without settings we can't decide whether the plate is
  // locked; erring toward "don't prime" matches the pre-Phase-C behaviour
  // where a missing resolver was a no-op.
  if (ctx.canvasSettings === undefined) return false;

  const stylePlate = ctx.canvasSettings?.stylePlate;
  const plateUnset = typeof stylePlate !== 'string' || stylePlate.trim() === '';
  return plateUnset;
}

/**
 * Tools that *generate* a visual asset or create a visual node on the
 * canvas. Mirrors the set in the orchestrator before Phase C — kept here
 * because the predicate needs it and we want the orchestrator side to be
 * trivial.
 */
export function isGenerationTool(
  name: string,
  args?: Record<string, unknown>,
): boolean {
  if (
    name === 'canvas.generate'
    || name === 'character.generateRefImage'
    || name === 'location.generateRefImage'
    || name === 'equipment.generateRefImage'
  ) {
    return true;
  }

  if (name === 'canvas.addNode') {
    const type = typeof args?.type === 'string' ? args.type.trim().toLowerCase() : '';
    return type === 'image' || type === 'video' || type === 'backdrop';
  }

  if (name === 'canvas.batchCreate') {
    const nodes = Array.isArray(args?.nodes) ? (args!.nodes as unknown[]) : [];
    return nodes.some((node) => {
      if (!node || typeof node !== 'object') return false;
      const rawType = (node as Record<string, unknown>).type;
      const type = typeof rawType === 'string' ? rawType.trim().toLowerCase() : '';
      return type === 'image' || type === 'video' || type === 'backdrop';
    });
  }

  return false;
}
