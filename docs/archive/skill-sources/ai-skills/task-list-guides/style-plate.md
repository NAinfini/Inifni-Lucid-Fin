# Visual Style Draft Task List (Commander)

## Purpose

Create a coherent Canvas-level style draft for manual generation and preview work. The canonical value is `canvas.settings.visualStylePolicy`; `stylePlate` and `negativePrompt` remain compatibility mirrors for older clients.

This draft is not an approval and is never a fallback for a bound persistent task list. After the user approves a Visual Constitution, that exact immutable revision and content hash are the task list's only style authority.

## When to use it

- The user is manually generating images, videos, or entity reference images outside a persistent task list.
- The persistent task list has not reached Visual Constitution approval and the user wants exploratory previews.
- The user explicitly asks to change the Canvas draft.

Do not use this task list to restyle an approved persistent run. Revise and re-approve the Visual Constitution through the existing gate instead; do not create another approval gate.

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
6. Prepare Prompt Assembly for the requested preview or media. The host includes the policy as a required, hash-addressed source; Commander reconciles it once with scene text, presets, references, and user intent, then submits the single final provider prompt.

## Change and refinement behavior

- Changing the Canvas draft makes older manual assets stale. Regenerate once under the new policy before applying incremental quality feedback.
- A small quality comment creates a parent-linked assembly from the exact selected asset prompt plus the verbatim feedback and recorded policy hash. Commander authors the revised complete prompt; the host never appends the delta or rebuilds from an empty prompt.
- Image-to-video preserves the source image's appearance and injects only camera, lens, composition, motion, allowed-variation, and negative constraints. It must not restyle the source frame.
- Approved persistent task list assets use `task.mediaFeedback`, never `canvas.generation refine`.

## Failure handling

- If settings persistence fails, surface the error and do not claim the draft is active.
- If an asset's recorded policy hash differs from the current Canvas draft, refuse incremental refinement and request one regeneration under the current draft.
- If task list approval state or the approved Visual Constitution cannot be verified, fail closed; never fall back to Canvas style text.

## Verification

- `canvas.getInfo` returns the structured policy written in step 4.
- `canvas.generation { action: 'prepare' }` returns the policy as a required source with a stable hash.
- Generated asset metadata records `visualStyle.source` and `visualStyle.policyHash`.
- Persistent Generation Specs remain bound to the approved Visual Constitution revision/hash.

## Related

- `task-guide-story-to-video` — three-gate persistent production.
- `task.visual` — visible project-specific previews and Visual Constitution selection.
- `style-aesthetics` — vocabulary suggestions, not an authority source.
