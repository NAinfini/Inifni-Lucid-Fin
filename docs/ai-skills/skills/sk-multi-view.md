# Multi-View Canvas Editing

Use this when the canvas is doing too many jobs at once and you need to switch between structure, detail work, and audio review without losing context.

Views:

- Main: full graph view for sequence planning, layout, and connection sanity checks
- Edit: focused refinement for one selected node when prompt or params need concentrated attention
- Audio: voice, music, and SFX review without the visual graph getting in the way
- Materials: asset-oriented review space for media inspection and library checks as that view evolves

Recommended rhythm:

1. Rough in the sequence in Main view so order and dependencies are obvious.
2. Jump to Edit view only when one node needs concentrated prompt, preset, or provider work.
3. Use Audio view when dialogue timing, narration, music, or lip-sync relationships need review.
4. Return to Main view for continuity, missing-edge checks, and final sequencing decisions.
5. Use Materials view for asset audit or retrieval tasks instead of cluttering the graph with library browsing.

Checks:

- each view change has a purpose
- you return to Main view before large batch actions
- audio review happens before lip-sync-sensitive renders

Avoid:

- doing every task in Main view until the graph becomes unreadable
- editing prompts in bulk without returning to the sequence overview
- treating Materials as final editorial truth when it is still a supporting review surface
