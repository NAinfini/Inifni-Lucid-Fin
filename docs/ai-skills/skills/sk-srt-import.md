# SRT Subtitle Import

Use this when timing already exists in subtitle form and you want to turn it into editable canvas structure.

Workflow:
1. Import the SRT from the canvas toolbar once the target canvas is open.
2. Choose the right mode for the job:
   - create nodes when you need a rough script lane on the canvas
   - align to existing video nodes when the sequence order already exists
3. Treat imported lines as timing scaffolding first, not as final polished prompts.
4. Clean up long subtitle lines before turning them into voice nodes. Spoken dialogue usually needs shorter, more breathable chunks.
5. Convert the lines that matter into audio nodes, then add delivery and emotion intentionally instead of keeping raw subtitle wording forever.
6. If aligning to existing shots, review the order visually from left to right and confirm the imported text landed on the intended clips.

Checks:
- subtitle order matches the shot order
- long lines are split where natural cuts or breaths exist
- imported text is reviewed before audio generation

Avoid:
- assuming subtitle text is automatically good voiceover writing
- aligning to a canvas whose shot order is still unstable
- importing once and never checking whether timing or punctuation needs cleanup
