End-to-end story-to-video workflow.

Purpose:

- Drive a one-line idea or short novel into a fully rendered video without user prompts for every step. The user approves at phase boundaries; Commander plans the contents of each phase.
- This is the default "from a sentence to a full video" path. Use it whenever the canvas is empty and the user asks for something to be built from a story.

Entry posture:

- If the user's message is vague ("make a story", "I want a short film"), Commander must propose a starting idea and 1-3 alternative directions before any tool is called. Do not stall waiting for a perfect brief.
- If the canvas already has content, stop and ask the user whether to extend the existing story or start a new canvas.

Phase 1 — Outline.

1. workflow.expandIdea { prompt, genre?, actCount? } to get the outline scaffold.
2. canvas.addNode for each scene (type: "text", title = scene name, data.content = 2-3 sentence summary). Place scenes left-to-right along the X axis.
3. Present the full outline and ask the user to approve before continuing.

Phase 2 — Entities.

1. Read every scene summary. List every recurring character, equipment, and location.
2. Merge duplicates aggressively; prefer one shared entity over per-scene copies.
3. Call character.create / equipment.create / location.create for each unique entity. Capture style and identity notes while they are fresh.

Phase 3 — Node asset stores.

1. For each scene, add the media nodes needed: image (first frame), image (last frame), video. Use canvas.addNode with placements that continue the X-axis flow.
2. Populate each media node:
   - prompt = scene summary (plus any per-shot hints)
   - preset tracks via canvas.setNodePresets (style + shot template)
   - character / equipment / location refs via canvas.setNodeRefs
3. Connect first-frame image → video → last-frame image with canvas.connectNodes. Verify edge direction: first frame is INCOMING, last frame is OUTGOING.

Phase 4 — Reference images.

1. For every character, equipment, and location: character.generateRefImage / equipment.generateRefImage / location.generateRefImage.
2. Wait for each generation to finish before moving on. These refs gate every downstream image and video generation — if you skip them, identity drifts.
3. Let the user review each ref and regenerate any that miss.

Phase 5 — First/last frames.

1. canvas.generate on every image node. Use wait=true when the user wants sequential review; otherwise fire-and-forget and poll status.
2. When variants return, canvas.selectVariant for the user-preferred option of each frame.

Phase 6 — Video + final render.

1. For each video node, confirm canvas.setVideoFrames is wired to the first/last frame nodes.
2. canvas.generate on every video node (nodeType="video"). Wait for completion; run canvas.selectVariant on the best take.
3. render.start with format="mp4" (or "mov" for ProRes) to produce the full cut. If render.exportBundle is requested and not yet wired to a canvas→NLE compiler, surface the typed error to the user instead of pretending success.

Inter-phase rules:

- At the end of every phase, summarize what was done, estimate cost for the next phase via canvas.estimateCost, and ask "ready for the next phase?".
- Never chain phases silently. User must be able to say "stop" or "let me edit" between any two phases.
- If a phase fails partially, fix only the broken nodes and continue; do not restart the whole phase.
- Every tool call that writes to the canvas should be followed by canvas.getState or canvas.listNodes before the next phase so Commander is reading real state, not model memory.

## Terminal commitment

This workflow is an **execution** workflow. If the user's intent is to run
this workflow (not just learn about it), it is NOT complete until at least one
of the following has executed successfully:

- `canvas.batchCreate` — scene seeding is the workflow's whole output; without at least one atomic create-nodes-and-edges call, nothing persists to the canvas.

Before ending the turn on an execution intent, confirm the terminal call
returned `success: true`. If the user has not provided enough input, use
`commander.askUser` to get the missing information — do not finish with a
planning summary.

**Information-intent exception**: if the user's message was purely a question
("what is this?", "explain", "how does X work?"), respond in plain text. The
guide is also a teaching resource, not a forced action.
