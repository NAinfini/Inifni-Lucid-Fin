# Dual Prompt Strategy

## When to Use
When the same scene needs different descriptions for still image generation vs video generation.

## Why Dual Prompts?
Image and video AI models respond differently to the same prompt:
- **Image models** excel with: spatial composition, texture detail, color precision, static mood
- **Video models** excel with: motion verbs, temporal transitions, camera movements, action continuity

## Prompt Structure

### Image Prompt Pattern
```
[Subject] in [setting], [composition detail], [lighting quality],
[color palette], [texture/material], [artistic style]
```
Focus on: what the frame looks like frozen in time.

### Video Prompt Pattern
```
[Camera move]: [Subject] [action verb] [direction],
[lighting transition], [atmospheric motion], [temporal cue]
```
Focus on: what changes over 5-15 seconds.

## Examples

### Scene: Character walking through rain

**Image Prompt:**
A woman in a dark trench coat stands at a rain-soaked crosswalk, neon reflections on wet asphalt, shallow depth of field, warm tungsten streetlights against cool blue rain, film grain, 35mm cinematic still

**Video Prompt:**
Slow tracking shot following a woman in a dark trench coat as she crosses a rain-soaked intersection, camera dollies right, raindrops catch neon light, puddle reflections ripple with each step, ambient city noise fades

## Applying in Lucid Fin
Each node has a single `prompt` field. Write the prompt targeting the node's generation type — image-style for image nodes, video-style for video nodes. If you need both a still and a motion version of the same scene, create two nodes (one image, one video) with appropriately tailored prompts.
