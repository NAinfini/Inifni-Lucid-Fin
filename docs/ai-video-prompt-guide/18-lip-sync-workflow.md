# Lip Sync Workflow

## When to Use

When you need character dialogue with synchronized mouth motion in generated video clips.

## Prerequisites

1. A video node with a generated or uploaded video asset
2. An audio node (audioType: "voice") with generated TTS or uploaded voice audio
3. Lip sync backend configured in Settings (cloud API or local Wav2Lip)

## Setup Steps

1. Create the voice audio node with dialogue text and emotion vector
2. Generate the TTS audio
3. Connect the audio node → video node via a canvas edge
4. Enable `lipSyncEnabled: true` on the video node
5. Generate/regenerate the video — lip sync runs as a post-processing step

## Best Practices

- Generate audio BEFORE video — the video generation should reference the audio timing
- Keep dialogue under 15 seconds per clip to match typical video node duration
- Use clear, enunciated dialogue for best lip sync results
- If lip sync fails, the original video is preserved — check the node's variant list
- For non-dialogue scenes (narration over B-roll), don't enable lip sync

## Troubleshooting

- **"No audio track attached"**: Ensure the audio node is connected via an edge to the video node
- **"Lip sync not configured"**: Set up the lip sync backend in Settings
- **Poor sync quality**: Try the alternative backend (cloud vs local), or re-generate with clearer audio
