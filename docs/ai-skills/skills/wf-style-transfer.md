# Style Transfer Across Shots

Use this when one approved frame already contains the look you want and the rest of the sequence needs to inherit that look without copying its exact subject matter.

Workflow:
1. Pick the strongest finished reference frame. It should already express the palette, contrast, texture, and lighting logic you want.
2. Analyze that frame with image description or style analysis so you can extract reusable look language instead of copying the whole scene.
3. Build a style packet with only transferable traits: rendering medium, palette relationships, lens feel, contrast behavior, grain, atmosphere, and emotional pressure.
4. Move the reusable style into preset tracks or the project style guide first. Rewrite prompts only when shot-specific language still needs help.
5. Keep each target shot's subject, action, and geography intact. Only replace the look layer.
6. Preview one or two representative prompts before a full rewrite so you can catch muddy or conflicting style language early.
7. Regenerate representative shots first, then roll the transfer across the full sequence after approval.

Checks:
- the transferred style stays reusable and does not smuggle in one-off scene content
- preset tracks and prompt text are not fighting each other
- target shots still read as the same story beat after the transfer

Avoid:
- copying exact props, characters, or staging from the reference frame
- stacking multiple incompatible looks into one averaged style mush
- using prompt rewrites for changes that belong in preset tracks
