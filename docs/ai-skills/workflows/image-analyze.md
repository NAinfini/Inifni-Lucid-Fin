Image analyze workflow:

Purpose:
- Read a finished image node, extract production-usable facts, and decide whether those facts belong in node prompts, entity records, or continuity notes.
- This workflow is for structured interpretation of an existing image asset. It is not a license to overwrite data with guesses.

Initial checks:
1. Call canvas.getNode for the target node. Confirm it is an image node or another node with a finished image asset.
2. Verify the node actually has an asset worth analyzing. If there is no finished image, stop and report that the workflow cannot proceed yet.
3. Decide the intent before calling vision.describeImage: prompt recreation, broad description, or style analysis.

Vision pass:
- Use vision.describeImage(style="description") when the goal is to inventory visible people, objects, environment state, and scene evidence.
- Use style="prompt" when the user wants a recreatable prompt or prompt repair.
- Use style="style-analysis" when the user wants reusable look language for presets or style transfer.

Extraction model:
- Separate findings into persistent facts and transient facts.
- Persistent facts belong in character, location, or equipment records if the evidence is strong and the update improves future continuity.
- Transient facts belong in node prompts or notes: current weather, one-shot lighting, expression, pose, debris, moment-specific clutter.

Entity workflow:
1. If a clearly new recurring entity is visible and the user wants it captured, use character.create, location.create, or equipment.create with conservative structured data.
2. If the entity already exists, prefer update only for fields that are strongly evidenced and currently missing or incorrect.
3. After entity creation or update, use canvas.setNodeRefs to attach the right characterRefs, locationRefs, or equipmentRefs back to the analyzed node.

Write-back discipline:
- Use canvas.updateNodes only when you are improving the node prompt itself.
- Do not move temporary lighting, camera angle, or pose language into durable character records.
- Do not create location records for what is obviously just a one-off corner of a larger approved location unless the user wants that specificity.
- If the image conflicts with stored data, surface the conflict first through commander.askUser when the correction would materially redesign an approved entity.

Recommended report structure:
- What the image clearly shows
- What can be reused as structured project data
- What should stay scene-specific
- What remains uncertain

Decision branches:
- If the frame is too stylized or obscured to support field-level extraction, return a cautious summary instead of forced structured data.
- If multiple characters are visible but only one is clearly identifiable, only attach the confident ref and note the uncertainty on the rest.
- If the user mainly wants style reuse, hand off to the style transfer workflow instead of over-creating entities.

Common failures:
- Creating records for transient props or background extras.
- Overwriting durable records with speculative details from a single stylized image.
- Forgetting to reattach entity refs after creating the records.
- Claiming nonexistent tools such as scene.create; use location.create or location.update instead.
