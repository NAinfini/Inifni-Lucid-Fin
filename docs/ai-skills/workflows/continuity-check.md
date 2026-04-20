Continuity check workflow:

Purpose:
- Find breaks in visual identity, geography, lighting, props, and temporal flow across a sequence of nodes before generation or final render.
- The goal is not to nitpick every variation. The goal is to surface changes that will read as mistakes on screen.

Scope setup:
1. Call canvas.listNodes and canvas.listEdges, or accept an explicit node set from the user.
2. Resolve viewing order from edges first. If edges are incomplete, fall back to left-to-right spatial order, then title order.
3. Call canvas.getNode on the full ordered set in one or two batched reads.

What to compare:
- Character continuity: face, hair, costume, injury state, carried objects.
- Location continuity: time of day, weather, signage, architectural landmarks, clutter level.
- Equipment continuity: object type, color, wear pattern, handedness, attachment state.
- Cinematic continuity: light direction, color temperature, lens compression, camera height, and motion logic where relevant.
- Narrative continuity: whether one shot's end state can plausibly feed the next shot's start state.

Evidence sources:
- Prompts and refs are the baseline.
- If a node already has a finished image asset, call vision.describeImage on the most important shots to verify what actually rendered rather than trusting prompt intent alone.
- Use style="description" when you need broad factual readback and style="style-analysis" when continuity risk lives in grade or light behavior.
- For generation-ready nodes, check the compiled prompt and attached refs together; continuity can break even when raw node prompt text looks correct.

Severity model:
- Critical: identity breaks that change the same character, prop, or location into something else.
- Major: camera, lighting, or environmental shifts that feel like an unintended scene reset.
- Minor: small palette drift, extra clutter, or wording inconsistencies that may not force regeneration.

Output format:
- Report by node pair or sequence segment, not as a vague global judgment.
- For each issue, include:
  observed mismatch
  why it matters
  recommended fix
  likely tool path
- Example fixes include canvas.updateNodes for prompt repair, canvas.setNodeRefs for ref correction, preset-track edits for look drift, or regeneration after fixing the source issue.

Decision branches:
- If two shots are intentionally contrasting, note them as intentional rather than false positives.
- If prompts are clean but the finished outputs diverge, recommend regeneration or provider/seed review instead of rewriting already-correct text.
- If the sequence lacks enough information to judge continuity, report the missing evidence rather than guessing.

Optional recording:
- Use canvas.addNote to leave a continuity report on the canvas when the user wants an in-project checklist.
- Keep notes concise and actionable so they do not become stale clutter.

Validation checklist:
- Confirm every critical issue references concrete evidence.
- Confirm each recommended fix maps to a real tool.
- Confirm that at least one pass checked actual rendered assets if they exist.
- Confirm that visible characters, locations, and equipment appear in both the compiled prompt and the attached generic ref set when they are on screen.
- Confirm that video first/last frame refs are evaluated separately from generic entity refs instead of being treated as interchangeable.

Common failures:
- Comparing non-adjacent shots without accounting for an intentional scene break.
- Trusting prompts while ignoring what the rendered frame actually shows.
- Reporting style differences that are already encoded as intentional presets.
- Calling everything critical and hiding the real blockers.

---

Batch re-prompt (continuity follow-up):

After the continuity report identifies prompt-level drift across a sequence, rewrite those prompts together in one controlled pass. Use this path for changes like "make these six shots feel like one storm sequence" or "tighten all prompts to grounded product-photography language."

Read everything first:
1. Call canvas.getNode for every target node in one batch. Read prompt, negativePrompt, title, node type, refs, and provider.
2. If the change is style-heavy, call canvas.readNodePresetTracks on representative nodes before touching prompt text. Some of the requested change may already belong in presets.
3. If the user supplied a reference image or exemplar node, analyze it with vision.describeImage(style="style-analysis") before rewriting.

Rewrite method:
- Preserve node-specific truth first: subject, action, environment, and critical continuity details.
- Replace only the language layer that the user asked to change: style, density, camera feel, texture, lighting logic, or explicit exclusions.
- Keep prompts internally coherent. If you add "rain lashes the windshield," also remove contradictory dry-environment clauses.
- Rebuild in complete sentences or clear prompt clauses. Do not mechanically prepend a tag and call it done.

Batching strategy:
- Use one pass to draft all rewritten prompts.
- Summarize the change set before writing. Mention what is preserved and what is changing.
- If the rewrite is meaningfully creative or could alter story interpretation, ask for confirmation through commander.askUser.
- On approval, write all prompt changes in one canvas.updateNodes call using the nodes array form so each node gets its own prompt.
- If negativePrompt changes are required, update them in the same batch rather than leaving contradictory prompt pairs.

Decision branches:
- If the request is really a preset-track problem, stop and use canvas.writeNodePresetTracks or canvas.writePresetTracksBatch instead of bloating prompts.
- If some nodes are images and others are videos, respect their different prompt densities. Image prompts want static visual evidence; video prompts need motion logic.
- If one or two nodes should stay exempt, exclude them explicitly rather than force-fitting the entire group.

Validation:
1. Call canvas.previewPrompt on at least one rewritten node from each major category to make sure preset merges did not distort the new language.
2. Verify the compiled prompt still includes every visible character, location, and equipment identity that must survive the rewrite.
3. Spot-check refs with canvas.getNode or canvas.setNodeRefs if the rewrite changes which entities must be visible.
4. If any video nodes are in scope, confirm first/last frame refs are still separate from generic entity refs.
5. Report which nodes were rewritten, which were skipped, and any unresolved ambiguity that may require user approval.

Useful rewrite patterns:
- Style consolidation: unify palette, lighting, texture, and atmosphere while preserving action.
- Density trim: cut filler adjectives and restate only visible evidence.
- Continuity pass: normalize clothing, prop naming, and location cues across adjacent shots.
- Provider adaptation: shorten overly dense prompts when the current provider or medium performs better with concise language.

Common batch-rewrite failures:
- Flattening every prompt into the same wording and losing scene-specific information.
- Rewriting prompts individually with repeated tool calls instead of one batch mutation.
- Leaving negative prompts unchanged when the main prompt meaning has shifted.
- Treating batch re-prompting as permission to invent a new story direction.

## Terminal commitment

This workflow is an **execution** workflow. If the user's intent is to run a
continuity pass (not just learn about it), it is NOT complete until at least
one of the following has executed successfully:

- `canvas.updateNodes` — batch update of prompt / negative-prompt / preset fields across affected nodes is the normal terminal call.
- `commander.askUser` confirming "no changes needed" — when the pass legitimately finds nothing to fix, surface that as an explicit confirmation rather than a silent summary.

Before ending the turn on an execution intent, confirm the terminal call
returned `success: true`. Do not finish with a planning summary that only
describes the drift you found.

**Information-intent exception**: if the user's message was purely a question
("what is this?", "explain", "how does X work?"), respond in plain text. The
guide is also a teaching resource, not a forced action.
