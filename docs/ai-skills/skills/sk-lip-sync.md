# Lip Sync Video

Use this when a shot needs readable speech and the speaking performance matters on screen.

Workflow:
1. Keep the setup tight: one visible speaker, one manageable line, one shot with a readable mouth region.
2. Create or reuse a voice audio node for the line. Write the exact dialogue there, not in the video node.
3. Set voice delivery intentionally with a simple emotion vector and a short delivery note such as restrained, urgent, tired, or warm.
4. Generate the audio first so the speech asset exists before the video pass.
5. Connect the audio node to the video node so the editorial relationship is explicit.
6. Enable audio and lip sync on the video node, then set a shot duration that can realistically contain the line.
7. Prefer close or medium shots. If the mouth is tiny in frame, lip sync will not read well no matter how good the audio is.
8. Test one shot before you repeat the setup across an entire dialogue scene.

Checks:
- the line length fits the shot duration
- only one active speaking source is driving the shot
- the framing makes mouth motion legible
- the audio asset succeeded before video generation starts

Avoid:
- wide shots with tiny faces
- multiple overlapping dialogue nodes on one speaking clip
- generating the video before the voice node is ready
