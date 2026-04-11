# Video Clone & Scene Analysis

## When to Use
When reverse-engineering a reference video, analyzing scene structure, or remaking existing footage with AI.

## Scene Detection Sensitivity
The `threshold` parameter controls how aggressive scene detection is:
- **0.1-0.2**: Very sensitive — detects minor lighting changes, camera movements
- **0.3-0.4**: Balanced (recommended) — detects clear cuts and major transitions
- **0.5-0.7**: Conservative — only detects hard cuts between very different scenes
- **0.8+**: Minimal — only dramatic scene changes

## Post-Clone Workflow
After cloning a video, the generated prompts are raw descriptions. Refine them:

1. **Style Unification**: Extract style from the best-described node using `style-analysis`, apply to Style Guide
2. **Prompt Enhancement**: Add cinematic language — camera moves, lighting quality, mood descriptors
3. **Character Consistency**: Create character entities from the descriptions, assign them to nodes
4. **Timing**: Adjust node durations to match original pacing or your target pacing
5. **Cross-Frame Continuity**: Already set up automatically — verify `firstFrameAssetHash` is populated

## Tips for Better Clones
- Use high-quality source video (1080p+) for better keyframe descriptions
- For music videos or fast-cut content, lower the threshold (0.2)
- For dialogue scenes, use default threshold (0.4)
- Review and remove redundant scenes before regenerating
- Add SRT subtitles to create matching audio nodes
