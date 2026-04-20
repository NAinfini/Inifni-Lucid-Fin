Style transfer workflow:

Purpose:
- Move a proven look from one finished reference node into one or more target nodes without overwriting scene-specific subject matter.
- Use this when the reference node already demonstrates the approved texture, palette, lighting logic, lens feel, and grade behavior.
- Do not use it as a shortcut for changing story content. Style should travel; subject, action, and staging should stay attached to each target node.

Read phase:
1. Call canvas.getNode for the reference node and every intended target node in as few calls as possible. Read title, prompt, negativePrompt, node type, provider, and refs.
2. If the reference node has a finished image asset, call vision.describeImage(nodeId=<reference>, style="style-analysis"). Use the output to capture reusable style language rather than copying the full frame description.
3. Call canvas.readNodePresetTracks on the reference node and target nodes. Separate what already lives in preset tracks from what only exists in prompt text.

Extraction rules:
- Build a style packet with only reusable traits: medium or rendering approach, palette relationships, contrast behavior, lighting pattern, lens/composition tendencies, grain or texture, atmosphere, and emotional pressure.
- Do not copy unique content from the reference frame such as character identity, exact prop layout, or one-off action beats unless those are part of the approved style system.
- If the reference contains multiple strong looks, choose one dominant direction and name the conflict instead of averaging everything into vague adjectives.

Application strategy:
- If the dominant change belongs in reusable cinematic grammar, prefer preset tools over prompt rewriting.
- Use canvas.writePresetTracksBatch when multiple categories need to move together, such as look + scene + emotion + technical.
- Use canvas.writeNodePresetTracks when only one category should change, such as replacing the look track while keeping the current camera stack.
- Use canvas.addPresetEntry, canvas.updatePresetEntry, and canvas.removePresetEntry for surgical cleanup after the main transfer.
- Only use canvas.updateNodes to rewrite prompts when the target prompt still needs scene-specific style language that presets cannot hold cleanly.

Prompt rewrite discipline:
- Preserve each target node's subject, action, and environment state.
- Replace generic look words with the extracted style packet. Example pattern: keep "a medic kneels beside the crashed bike" and replace only the look clause with material, palette, and light behavior derived from the reference.
- If negative prompts need cleanup, remove contradictions that would block the transferred style, but do not erase valid structural exclusions such as extra limbs or unwanted text.

Decision branches:
- If the reference is unfinished or low quality, stop and tell the user the transfer source is not reliable yet.
- If targets already share the style in preset tracks, do not rewrite prompts again. Report that the style is already encoded.
- If the transfer would change genre or approved art direction, ask for confirmation with commander.askUser before writing.

Validation:
1. After edits, call canvas.previewPrompt on one or two representative targets to confirm the compiled output reflects the new look without losing scene substance.
2. Re-read tracks with canvas.readNodePresetTracks if you changed preset categories in batch.
3. Report exactly which nodes were updated, whether presets or prompt text carried the change, and any nodes you left untouched because they conflicted with the style packet.

Common failures:
- Copying full-frame content instead of just style.
- Stacking conflicting preset entries until the result becomes muddy.
- Rewriting prompts that were already cleanly handled by preset tracks.
- Treating vision.describeImage output as literal truth when the reference image itself is ambiguous.

Related process prompts:
- Use the "node-preset-tracks", "preset-definition-management", "shot-template-management", and "color-style-management" prompts for deeper track-writing heuristics.
- Use the "vision-analysis" prompt when the main challenge is extracting reusable style language from a finished frame.
