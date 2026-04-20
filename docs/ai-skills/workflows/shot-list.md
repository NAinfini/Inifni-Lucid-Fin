Shot list workflow:

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
- Forgetting to capture continuity dependencies that later break generation.
