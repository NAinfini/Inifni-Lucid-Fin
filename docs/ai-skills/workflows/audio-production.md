Audio production workflow (voice + lip sync):

Purpose:
- End-to-end audio pipeline for spoken dialogue on canvas. Covers two stages: (1) creating voice nodes with controllable emotional delivery, and (2) pairing those voice nodes with video shots for provider-backed lip sync.
- Use this for scripted dialogue, narration, and directed voice-over. NOT for music, SFX, or ambient sound design.

---

## Stage 1 — Voice node creation with emotional control

Preparation:
1. Gather the dialogue lines and identify speaker, intent, timing, and scene pressure for each line.
2. If the voice belongs to an established character, read the character record first so age, role, and approved vocal identity stay coherent.
3. Decide whether the job is narration, direct on-screen dialogue, or an off-screen internal voice. Delivery language changes with context.

Creation flow:
1. Use canvas.batchCreate when you already know the full line set and want all audio nodes created together. Otherwise use canvas.addNode per line.
2. Title each node so the line can be identified later — for example "VO 04 - confession under breath" instead of pasting the entire sentence into the title.
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
- The prompt describes DELIVERY behavior, not the line itself (the line goes in the prompt text proper).
- Useful delivery ingredients: pace, breath pattern, strain, softness or projection, confidence, urgency, hesitation, smile in the voice, vocal fatigue.
- Match prompt and vector. Do not pair a contempt-heavy vector with a prompt asking for warm reassurance.

Sequence consistency:
- For a scene with multiple lines from the same speaker, compare all emotion vectors before generating. Emotional escalation should feel intentional from line to line.
- If the audio will later drive lip sync (stage 2), keep line lengths and intensity compatible with the intended shot durations.
- Connect voice nodes to their speaking video nodes with canvas.connectNodes when editorial relationships matter — this is the bridge into stage 2.

Review loop:
1. Generate representative lines first instead of the full sequence when the emotional direction is still uncertain.
2. If the first pass misses, adjust vector shape before rewriting the whole prompt.
3. Report the final vector and delivery intent for each line so the user can approve or refine the emotional arc.

Common stage-1 failures:
- Using one preset emotion value for every line in a scene.
- Writing generic prompts such as "very emotional voice" that do not describe delivery.
- Forgetting neutral support, which often keeps speech intelligible.
- Treating emotion vectors as a substitute for scene context and timing language.

---

## Stage 2 — Lip sync pairing

Stage 2 only applies when a voice node from stage 1 should drive mouth motion on a video shot. Lip sync only works cleanly when the shot scope is tight: one speaker, one clear line, one manageable duration.

Read and verify first:
1. Call canvas.getNode on the target video node and confirm it is the correct speaking shot.
2. Confirm the voice node for this line exists (it should, from stage 1). Reuse it; do not duplicate.
3. Confirm the target provider can support the requested setup. Use provider.getCapabilities when audio support, duration limits, or quality tiers are uncertain.

Wire the pair:
1. Connect the voice node to the video node with canvas.connectNodes so the editorial relationship is explicit.
2. Enable video-side sync settings with canvas.setVideoParams(set={ audio: true, lipSyncEnabled: true, duration: <shot length if needed> }).
3. If the speaking shot also depends on continuity anchors, set first or last frames with canvas.setVideoFrames after the image edges are wired in the correct direction.

Generation order:
- Generate the voice node first with canvas.generate so the spoken asset exists before the video pass.
- Re-read the voice node if needed and confirm it completed successfully.
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

Common stage-2 failures:
- Using canvas.updateNodes to set lip sync flags. The correct tool is canvas.setVideoParams.
- Generating the video before the voice node exists.
- Leaving multiple dialogue nodes connected to one speaking shot without a clear editorial plan.
- Trying to lip-sync a shot that visually cannot support readable mouth motion.

## Terminal commitment

This workflow is an **execution** workflow. If the user's intent is to set up
audio on the canvas (not just learn about it), it is NOT complete until at
least one of the following has executed successfully:

- `canvas.setSettings` — when the change is canvas-scoped audio configuration (provider, lip-sync toggles).
- `canvas.batchCreate` — when creating voice or dialogue nodes is the output.
- `canvas.setVideoParams` — when attaching lip-sync flags to existing video nodes (never `canvas.updateNodes` for this).

Before ending the turn on an execution intent, confirm the terminal call
returned `success: true`. If the user has not provided enough input, use
`commander.askUser` to get the missing information — do not finish with a
planning summary.

**Information-intent exception**: if the user's message was purely a question
("what is this?", "explain", "how does X work?"), respond in plain text. The
guide is also a teaching resource, not a forced action.
