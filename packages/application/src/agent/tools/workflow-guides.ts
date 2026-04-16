/**
 * Built-in workflow prompt guides.
 *
 * These are instruction-only guides accessed through guide.get. They do not
 * execute tools directly; they tell Commander how to combine existing tools
 * into repeatable workflows.
 */

export interface PromptGuide {
  id: string;
  name: string;
  content: string;
}

export const WORKFLOW_GUIDES: PromptGuide[] = [
  {
    id: 'workflow-style-transfer',
    name: 'Style Transfer',
    content: `Style transfer workflow:

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
- Use the "vision-analysis" prompt when the main challenge is extracting reusable style language from a finished frame.`,
  },
  {
    id: 'workflow-shot-list',
    name: 'Shot List',
    content: `Shot list workflow:

Purpose:
- Convert scene planning text into production-usable shot nodes that can later expand into image, video, and audio generation.
- A good shot list is editorially ordered, scoped to one beat per shot, and specific enough that another agent can create media nodes without guessing.

Scene intake:
1. If the user provides sceneNodeIds, call canvas.getNode for all of them in one batch.
2. If scene nodes are not provided, call canvas.listNodes and filter for text nodes that look like scene summaries, script beats, or outline notes.
3. Read the current edge structure with canvas.listEdges when order is unclear. Existing left-to-right flow should beat title sorting if both exist.

Decomposition rules:
- Break each scene into only the shots needed to communicate geography, action, and emotional emphasis.
- Prefer 3 to 8 shots for a medium-complexity scene, not one bloated mega-shot and not an overcut spray of redundant angles.
- Each shot card should capture: shot size, subject, action/state, setting layer, duration target, camera behavior, and why the shot exists.
- Write in visible, filmable language. Replace "the scene feels tense" with staging evidence such as a held push-in, obstructed foreground, or delayed reaction.

Recommended shot card schema:
- title: short label such as "Shot 03 - CU - Driver notices the leak"
- content fields in prose:
  shotType
  storyFunction
  subject
  visibleAction
  environment
  durationTarget
  cameraPlan
  continuityNotes
  mediaSuggestion

Creation workflow:
1. Draft the shot order in memory first. Do not create nodes until the sequence is coherent.
2. Use canvas.batchCreate when the order and titles are known up front. Create one text node per shot and connect them in temporal order.
3. If a scene already has a parent planning node, connect the scene node into the first shot or keep the shots grouped nearby with canvas.setNodeLayout.
4. Use canvas.layout after creation if the canvas becomes unreadable; preserve a left-to-right timeline where possible.

Decision branches:
- If the source scene is vague, create fewer, broader shots and flag the ambiguity instead of inventing coverage.
- If the scene already contains explicit shot calls from the user, preserve them and only fill missing details.
- If one scene actually contains two beats with a location or time jump, split the shot list into separate groups before creating nodes.

Quality checks:
- Every shot must answer why it exists. If two shots deliver the same information, merge or delete one.
- Duration must match the described action. A static reveal can be 3 to 5 seconds; a complex action beat may need 6 to 10.
- Camera language should be intentional. Do not assign motion to every shot by default.
- Continuity notes should flag required character refs, prop visibility, or first-frame/last-frame dependencies for later media work.

Suggested handoff:
- After the text shot list is stable, create image nodes for keyframes or storyboard stills first.
- Then create video nodes only for shots that truly require motion.
- Use the "canvas-structure", "canvas-graph-and-layout", "canvas-node-editing", and "video-node-generation" process prompts for expansion into production nodes.

Common failures:
- Creating nodes before deciding the sequence.
- Encoding vague emotional commentary instead of visible action.
- Overcutting scenes that only need one strong establishing shot and one reaction.
- Forgetting to capture continuity dependencies that later break generation.`,
  },
  {
    id: 'workflow-batch-reprompt',
    name: 'Batch Re-Prompt',
    content: `Batch re-prompt workflow:

Purpose:
- Rewrite multiple prompts together when content must stay intact but the visual or tonal language needs to shift in a controlled way.
- Use this for changes like "make these six shots feel like one storm sequence" or "tighten all prompts to grounded product-photography language."

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

Common failures:
- Flattening every prompt into the same wording and losing scene-specific information.
- Rewriting prompts individually with repeated tool calls instead of one batch mutation.
- Leaving negative prompts unchanged when the main prompt meaning has shifted.
- Treating batch re-prompting as permission to invent a new story direction.`,
  },
  {
    id: 'workflow-continuity-check',
    name: 'Continuity Check',
    content: `Continuity check workflow:

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
- Calling everything critical and hiding the real blockers.`,
  },
  {
    id: 'workflow-storyboard-export',
    name: 'Storyboard Export',
    content: `Storyboard export workflow:

Purpose:
- Turn an ordered set of image, video, or planning nodes into a readable storyboard summary the user can review or hand off.
- This workflow produces structured markdown in-chat and can optionally tidy the canvas first. It is not the same thing as render.exportBundle, which packages editing deliverables.

Ordering workflow:
1. Call canvas.listNodes to identify candidate storyboard nodes. Images usually lead, but include videos or text cards when they carry important sequence intent.
2. Call canvas.listEdges to resolve story order from graph direction. If the graph is partial, use left-to-right, top-to-bottom placement as the fallback.
3. Call canvas.getNode for the ordered nodes and collect title, prompt or content, status, refs, and any duration fields on video nodes.

Preparation:
- If the canvas is visually chaotic, call canvas.layout before final ordering so the sequence is easier to verify.
- Exclude helper nodes that do not belong in the storyboard, such as scratch notes or abandoned variants, unless the user explicitly asks for a full export.
- Keep placeholders visible only when they affect planning; mark them as pending rather than pretending they are finished shots.

Storyboard row design:
- Sequence number
- Node title
- Node type
- Shot summary
- Duration or timing note
- Status
- Key continuity note

How to summarize each row:
- For text nodes, compress the content into one sentence that states the intended shot or beat.
- For image or video nodes, summarize the prompt in plain production language rather than dumping the full prompt.
- Mention only refs or continuity dependencies that another human or agent needs to know.
- If a node is unfinished, say what is missing: prompt refinement, generation, frame refs, audio, or approval.

When to include timing:
- Use explicit duration for video nodes when available.
- For stills or text boards, use a qualitative timing note only if the shot list established one.
- Do not invent exact seconds for images unless the project already planned them.

Optional canvas cleanup:
- Use canvas.setNodeLayout or canvas.layout to line up storyboard lanes before presenting the export.
- Use canvas.addNote if the user wants the storyboard summary attached to the canvas as a note for later review.

Decision branches:
- If edge order and spatial order disagree, call out the conflict and prefer the intentional edge sequence unless the user tells you otherwise.
- If some nodes are duplicated variants, include only the selected or approved one unless the user asks for alternatives.
- If the canvas lacks enough metadata for a clean storyboard, generate the markdown with gaps clearly marked instead of inventing certainty.

Important limitation:
- render.exportBundle only supports bundle formats such as fcpxml or edl. Do not claim it exports a markdown storyboard.
- The storyboard itself should be returned in chat or stored as a canvas note; final editorial interchange belongs to render.exportBundle after the sequence is actually ready.

Common failures:
- Mixing scratch nodes into the formal board.
- Ignoring graph order and accidentally rearranging the story.
- Dumping raw prompts instead of readable shot summaries.
- Treating unfinished nodes as approved finals.`,
  },
  {
    id: 'workflow-image-analyze',
    name: 'Image Analyze',
    content: `Image analyze workflow:

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
- Claiming nonexistent tools such as scene.create; use location.create or location.update instead.`,
  },
  {
    id: 'workflow-video-clone',
    name: 'Video Clone',
    content: `Video clone workflow:

Purpose:
- Rebuild the creative structure of an existing video inside the canvas using the tools that actually exist today.
- Current limitation: there is no video.clone or automatic video-splitting tool in the tool inventory. This workflow is therefore a guided reconstruction pipeline, not one-click cloning.

What the toolset can and cannot do:
- It can analyze still images with vision.describeImage.
- It can create and organize text, image, video, and audio nodes with canvas tools.
- It can apply presets, refs, first/last frame constraints, and render the rebuilt sequence.
- It cannot directly ingest an arbitrary video file and auto-generate a full shot graph from it.

Practical workflow:
1. Ask the user, through commander.askUser if needed, to provide a source sequence in a usable form: key frame grabs, a manual shot list, or an existing canvas/video breakdown.
2. Create planning text nodes for each source shot with canvas.batchCreate or canvas.addNode. Keep them in temporal order.
3. For representative frame grabs, call vision.describeImage(style="description" or "style-analysis") to extract shot content, environment, and look language.
4. Build a reusable style packet from the frame analyses, then apply it through preset tools or batch re-prompting as appropriate.
5. Create destination image/video nodes from the planning nodes. Use canvas.batchCreate for the initial graph.
6. Where shot transitions depend on exact entry or exit visuals, create image nodes for anchor frames and wire them into video nodes with correct edge direction, then set them with canvas.setVideoFrames.
7. Attach entity refs with canvas.setNodeRefs once recurring characters, locations, or equipment have been identified.
8. Use canvas.setVideoParams for duration, audio, quality, and lipSyncEnabled where needed, then generate shot by shot with canvas.generate.

How to stay faithful:
- Clone structure and cinematic intent first: shot order, scale, tempo, geography, and emotional arc.
- Reconstruct style through repeatable language, not by copying every incidental pixel.
- If the source contains legally sensitive branded material or recognizable copyrighted imagery, make sure the reconstruction is framed as inspiration or analysis rather than deceptive duplication.

Decision branches:
- If the user wants a very literal remake, request more source frames before proceeding. One frame per shot is usually the practical minimum.
- If only a tone match is needed, fewer source frames are acceptable; focus on style packet extraction and editorial rhythm.
- If a shot cannot be inferred from the provided source evidence, mark it as unresolved instead of inventing a precise clone.

Validation:
- Use the continuity check workflow after the first pass of recreated shots.
- Use the storyboard export workflow to show the reconstructed order before full rendering.
- Create a snapshot before major batch rewrites so the reconstruction can be rolled back cleanly.

Common failures:
- Pretending automatic cloning exists.
- Treating a single still as enough evidence for an entire complex motion beat.
- Ignoring the need for first-frame or last-frame anchors in continuity-sensitive remakes.
- Recreating the look but not the actual editorial structure.`,
  },
  {
    id: 'workflow-lip-sync',
    name: 'Lip Sync Setup',
    content: `Lip sync setup workflow:

Purpose:
- Pair a dialogue audio node with a video node so the generated clip has a clear speech source, timing intent, and provider-compatible lip sync settings.
- Lip sync only works cleanly when the shot scope is tight: one speaker, one clear line, one manageable duration.

Read and verify first:
1. Call canvas.getNode on the target video node and confirm it is the correct speaking shot.
2. Check whether a dialogue audio node already exists for that line. Reuse it if possible instead of creating duplicates.
3. Confirm the target provider can support the requested setup. Use provider.getCapabilities when audio support, duration limits, or quality tiers are uncertain.

Audio node setup:
1. If no voice node exists, create one with canvas.addNode(type="audio", title="VO: <short line label>").
2. Write the spoken line into the audio node prompt with canvas.updateNodes.
3. Set the audio behavior with canvas.setAudioParams(set={ audioType: "voice", emotionVector: { ... } }).
4. Keep the emotion vector simple and intentional. One dominant emotion plus neutral is usually better than a noisy distribution.

Video node setup:
1. Connect the audio node to the video node with canvas.connectNodes so the editorial relationship is explicit.
2. Enable video-side sync settings with canvas.setVideoParams(set={ audio: true, lipSyncEnabled: true, duration: <shot length if needed> }).
3. If the speaking shot also depends on continuity anchors, set first or last frames with canvas.setVideoFrames after the image edges are wired in the correct direction.

Generation order:
- Generate the audio node first with canvas.generate so the spoken asset exists before the video pass.
- Re-read the audio node if needed and confirm it completed successfully.
- Then generate the video node. If the provider or workflow requires retry, diagnose the failure rather than toggling lip sync blindly.

Shot design rules:
- Prefer close or medium shots with a readable mouth region when lip sync matters.
- Keep one active speaker per synced shot whenever possible.
- If overlapping dialogue or crowd speech is required, split the problem into separate shots or accept that lip sync quality may degrade.
- Avoid long rambling lines. Split dialogue across cuts when the beat naturally supports it.

Decision branches:
- If the provider does not support audio on video generation, report the limitation instead of claiming sync is enabled.
- If the shot is too wide for visible mouth movement, recommend a different shot or skip lip sync.
- If the line timing is critical to a cut, trim the text and duration together rather than letting the system stretch a long sentence into a short shot.

Common failures:
- Using canvas.updateNodes to set lip sync flags. The correct tool is canvas.setVideoParams.
- Generating the video before the audio node exists.
- Leaving multiple dialogue nodes connected to one speaking shot without a clear editorial plan.
- Trying to lip-sync a shot that visually cannot support readable mouth motion.`,
  },
  {
    id: 'workflow-emotion-voice',
    name: 'Emotion Voice',
    content: `Emotion voice workflow:

Purpose:
- Create voice nodes whose emotional delivery is controllable, reviewable, and reusable across a sequence.
- This workflow is best for spoken dialogue, narration, or directed voice-over, not music and not generic sound design.

Preparation:
1. Gather the dialogue lines and identify speaker, intent, timing, and scene pressure for each line.
2. If the voice belongs to an established character, read the character record first so age, role, and approved vocal identity stay coherent.
3. Decide whether the job is narration, direct on-screen dialogue, or an off-screen internal voice. Delivery language changes with context.

Creation flow:
1. Use canvas.batchCreate when you already know the full line set and want all audio nodes created together. Otherwise use canvas.addNode per line.
2. Title each node so the line can be identified later, for example "VO 04 - confession under breath" instead of pasting the entire sentence into the title.
3. Write the actual spoken text with canvas.updateNodes.
4. Use canvas.setAudioParams to set audioType="voice" and a deliberate emotionVector.

Emotion vector rules:
- Use the eight supported keys: happy, sad, angry, fearful, surprised, disgusted, contemptuous, neutral.
- Favor one dominant emotion between 0.6 and 0.85, then use neutral or one secondary emotion to shape nuance.
- Keep the sum intuitive rather than mathematically precious. The point is directional control, not perfect normalization theater.
- Example mappings:
  restrained grief: sad 0.65, neutral 0.25, fearful 0.10
  brittle anger: angry 0.60, contemptuous 0.25, neutral 0.15
  relieved joy: happy 0.60, surprised 0.20, neutral 0.20
  calm narration: neutral 0.75, happy 0.15, sad 0.10

Prompt-writing rules:
- The prompt should describe delivery behavior, not rephrase the line.
- Useful prompt ingredients: pace, breath pattern, strain, softness or projection, confidence, urgency, hesitation, smile in the voice, vocal fatigue.
- Match prompt and vector. Do not pair a contempt-heavy vector with a prompt asking for warm reassurance.

Sequence consistency:
- For a scene with multiple lines from the same speaker, compare all emotion vectors before generating. Emotional escalation should feel intentional from line to line.
- If the audio will later drive lip sync, keep line lengths and intensity compatible with the intended shot durations.
- Connect voice nodes to their speaking video nodes with canvas.connectNodes when editorial relationships matter.

Review loop:
1. Generate representative lines first instead of the full sequence when the emotional direction is still uncertain.
2. If the first pass misses, adjust vector shape before rewriting the whole prompt.
3. Report the final vector and delivery intent for each line so the user can approve or refine the emotional arc.

Common failures:
- Using one preset emotion value for every line in a scene.
- Writing generic prompts such as "very emotional voice" that do not describe delivery.
- Forgetting neutral support, which often keeps speech intelligible.
- Treating emotion vectors as a substitute for scene context and timing language.`,
  },
];
