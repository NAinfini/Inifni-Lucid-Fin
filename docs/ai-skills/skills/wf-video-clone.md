# Video Clone -> Remake

Use this when you want to rebuild the structure of an existing video inside Lucid instead of starting from an empty canvas.

Workflow:

1. Open the Video Clone dialog from the canvas toolbar and choose the source file.
2. Tune scene detection sensitivity. Lower values keep more cuts; higher values merge similar shots.
3. Run the clone. Lucid detects scenes, extracts a keyframe for each scene, and creates a new canvas automatically.
4. Review the generated sequence node by node. Each scene becomes a video node with a source frame and an inferred prompt.
5. Fix bad scene boundaries first. If the detector merged two beats, split them manually before polishing prompts.
6. Refine prompts only after the editorial order feels right. Preserve shot purpose, then improve style language, motion, and subject specificity.
7. Attach recurring character, location, and prop refs so later regenerations stay consistent with the source sequence.
8. Keep first-frame and cross-shot continuity where transitions matter. The extracted frames are most useful as anchors, not as final truth.
9. Regenerate a few representative shots before you batch the whole remake.

Checks:

- scene order matches the source rhythm
- prompts describe the real shot, not a generic summary
- recurring entities are attached with reusable refs
- the remake keeps the original editorial intent even if the style changes

Avoid:

- trusting raw auto-descriptions without human review
- cloning style while losing the original shot structure
- batch-regenerating before you fix incorrect cut detection
