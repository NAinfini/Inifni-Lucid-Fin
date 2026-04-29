# CapCut Export

Use this when Lucid has already produced the usable clips and you want a clean editorial handoff for finishing.

Workflow:

1. Finalize order first. CapCut draft export follows the sequence you hand it, so fix shot order before exporting.
2. Export only nodes that already have real assets. Placeholder nodes and empty prompts do not belong in the handoff.
3. Check clip durations, especially for still images or timing-sensitive inserts. The draft exporter will use the duration you provide or the default fallback.
4. Include audio clips when dialogue, narration, or music should already arrive on the edit timeline.
5. Run Export -> CapCut and choose the destination folder. Lucid writes a CapCut draft directory with track metadata and resolved asset paths.
6. Open that draft in CapCut for trimming, transitions, captions, sound balancing, and final polish.

Checks:

- every exported node has a resolved asset
- sequence order is already approved
- durations are sane for both stills and moving clips
- audio clips are included only when they belong on the editorial timeline

Avoid:

- exporting scratch variants instead of the approved clips
- assuming CapCut will fix broken scene order for you
- sending a handoff before the source assets are actually generated
