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
  referenceImagesOnly?: boolean;
}

export function createStylePlateLockSpec(deps: StylePlateLockSpecDeps): ProcessPromptSpec {
  return {
    key: 'style-plate-lock',
    displayName: 'Style Plate Lock',
    lifecycle: 'sticky',
    activationPredicate: (ctx) =>
      stylePlateLockPredicate(ctx, { referenceImagesOnly: deps.referenceImagesOnly ?? false }),
    content: () => deps.resolvePromptText('style-plate-lock')?.trim() ?? '',
  };
}

export function stylePlateLockPredicate(
  ctx: ActivationContext,
  _options: { referenceImagesOnly?: boolean } = {},
): boolean {
  if (!ctx.canvasId) return false;

  // v2: Evaluate purely on workspace state — no pendingToolCalls dependency.
  // If the plate is empty, the guide should be active so the LLM knows to
  // set it before generating visuals. The old tool-call filter was an
  // over-optimization that required the defer mechanism.
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
export function isGenerationTool(name: string, args?: Record<string, unknown>): boolean {
  if (
    name === 'canvas.generation' ||
    name === 'entity.generateRefImage'
  ) {
    return true;
  }

  if (name === 'canvas.createNodes') {
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
