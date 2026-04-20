# Style Plate Workflow (Commander)

## Purpose
Locks the visual style of a canvas BEFORE any reference-image generation runs. A canvas-scoped style plate is a free-form style-description string that every downstream ref image re-references. Without it, two characters in the same story render in different art styles.

## When Commander must run this
- First ref-image request for a canvas, if `canvas.getSettings` returns no `stylePlate`.
- User says "switch the whole project to <style>" — rewrite the stylePlate, warn existing ref images now mismatch.
- User explicitly asks to lock or change the visual style.

## Preconditions
1. `canvas.getSettings(canvasId)` returned settings.
2. Either:
   - `stylePlate` already set (non-empty string) → skip; report that the style is locked and proceed.
   - OR unset / empty → proceed with lock.
3. A style seed is available from the user ("Japanese anime, flat cel shading, saturated palette", "1990s Studio Ghibli watercolor, soft edges, muted tones", "Pixar 3D, rim-lit, subsurface scatter on skin", etc.).

## Steps

1. **Gather style vocabulary.** Ask ONE targeted question if the user has not specified: "Which art style anchors this project — e.g. Japanese anime, Ghibli watercolor, Pixar 3D, gritty live-action?"
2. **Compose the stylePlate string.** 20–60 words. Include:
   - Medium / art style label ("flat 2D cel anime", "stop-motion clay", "photoreal cinema").
   - Line work if relevant ("clean black outline", "no outlines").
   - Palette cue ("saturated warm palette", "muted earth tones").
   - Texture / material cue ("soft watercolor paper", "subsurface-scattered skin").
   - Lighting vocabulary ("flat even studio light, no harsh rim").
   - Era/cultural cue if named ("1990s Studio Ghibli", "Cartoon Saloon Irish indie", "Makoto Shinkai").
   Do NOT include: character names, scene description, action, prop list. The plate is style only.
3. **Present for confirmation.** Show the user the proposed string. Let them tweak.
4. **Lock:** `canvas.setSettings({ canvasId, settings: { stylePlate: '<final string>' } })`.
5. **Verify:** re-call `canvas.getSettings` and confirm `stylePlate` is the composed string.
6. **Report:** "Style plate locked: '<string>'. All future ref images for this canvas will lead with this."

## Failure handling

- **User refuses to lock a style** → explain that without a plate, character/equipment/location ref images will drift. Ask if they want to proceed unstyled anyway; if yes, continue but warn once.
- **User wants to change plate mid-project** → warn that existing ref images are anchored to the old plate and will look inconsistent against new ones. Offer to regenerate ref images for affected entities after re-lock.
- **`canvas.setSettings` fails** → surface the error. Do NOT silently continue to ref-image generation.

## Verification
- After `canvas.setSettings`, re-call `canvas.getSettings` and confirm the string landed exactly.
- Next `character.generateRefImage` / `equipment.generateRefImage` / `location.generateRefImage` call automatically prepends the plate via `buildPrompt(entity, view, stylePlate)` — no extra wiring needed.

## Word budget
Keep user-facing explanation under 60 words per turn. Lock is 2–3 turns, not a lecture.

## Related
- Process prompt: `style-plate-lock` (auto-injected as a session-start process prompt when canvas ref images exist with no plate).
- Canvas settings surface: `canvas.getSettings` / `canvas.setSettings`.
- See also: `workflow-story-to-video` (full pipeline), `style-transfer` (cross-shot style template), `style-aesthetics` (prompt vocabulary guide).

## Terminal commitment

This workflow is an **execution** workflow. If the user's intent is to lock a
style plate on the canvas (not just learn about it), it is NOT complete until
the following has executed successfully:

- `canvas.setSettings` — writing `stylePlate` onto the canvas settings is the whole point of the lock step. Nothing else persists the plate.

Before ending the turn on an execution intent, confirm `canvas.setSettings`
returned `success: true` and then re-read via `canvas.getSettings` per the
standing verification step above. Do not finish with a drafted plate string in
chat text — an unpersisted plate is not a lock.

**Information-intent exception**: if the user's message was purely a question
("what is a style plate?", "explain", "how does this work?"), respond in plain
text. The guide is also a teaching resource, not a forced action.
