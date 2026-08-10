# Visual Style Draft Workflow (Commander)

## Purpose

Create a coherent Canvas-level style draft for manual generation and preview work. The canonical value is `canvas.settings.visualStylePolicy`; `stylePlate` and `negativePrompt` remain compatibility mirrors for older clients.

This draft is not an approval and is never a fallback for a bound persistent workflow. After the user approves a Visual Constitution, that exact immutable revision and content hash are the workflow's only style authority.

## When to use it

- The user is manually generating images, videos, or entity reference images outside a persistent workflow.
- The persistent workflow has not reached Visual Constitution approval and the user wants exploratory previews.
- The user explicitly asks to change the Canvas draft.

Do not use this workflow to restyle an approved persistent run. Revise and re-approve the Visual Constitution through the existing gate instead; do not create another approval gate.

## Steps

1. Read `canvas.getInfo({ canvasId, scope: 'settings' })`.
2. If the user already supplied a concrete direction, structure it directly. Otherwise ask one short question or offer visible project-specific style auditions; do not require the user to know filmmaking vocabulary.
3. Compose `visualStylePolicy` version 1:
   - `summary`: concise medium, era, rendering, linework, palette, lighting, texture, and mood direction.
   - `locked`: only fields that truly must remain stable.
   - `allowedVariations`: intentional shot-to-shot freedom such as shot scale or weather intensity.
   - `negativeConstraints`: recurring failure modes such as watermark, identity drift, or unwanted photorealism.
4. Persist with `canvas.setSettings({ canvasId, visualStylePolicy })`.
5. Re-read Canvas settings and verify the structured policy.
6. Generate the requested preview or media. The host compiler injects the policy into manual image/video and reference-image prompts; Commander must not duplicate it in the scene prompt.

## Change and refinement behavior

- Changing the Canvas draft makes older manual assets stale. Regenerate once under the new policy before applying incremental quality feedback.
- A small quality comment loads the exact selected asset Prompt, appends the delta, preserves the recorded policy hash, then generates and grades the next attempt. It must not rebuild from an empty Prompt.
- Image-to-video preserves the source image's appearance and injects only camera, lens, composition, motion, allowed-variation, and negative constraints. It must not restyle the source frame.
- Approved persistent workflow assets use `workflow.mediaFeedback`, never `canvas.generation refine`.

## Failure handling

- If settings persistence fails, surface the error and do not claim the draft is active.
- If an asset's recorded policy hash differs from the current Canvas draft, refuse incremental refinement and request one regeneration under the current draft.
- If workflow approval state or the approved Visual Constitution cannot be verified, fail closed; never fall back to Canvas style text.

## Verification

- `canvas.getInfo` returns the structured policy written in step 4.
- Generated asset metadata records `visualStyle.source` and `visualStyle.policyHash`.
- Persistent Generation Specs remain bound to the approved Visual Constitution revision/hash.

## Related

- `workflow-story-to-video` — three-gate persistent production.
- `workflow.visual` — visible project-specific previews and Visual Constitution selection.
- `style-aesthetics` — vocabulary suggestions, not an authority source.
