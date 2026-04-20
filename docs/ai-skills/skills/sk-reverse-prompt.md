# Reverse Prompt Inference

Use this when you have a finished image and want a clean, reusable prompt instead of a vague visual summary.

Workflow:
1. Start from a real image node or reference frame, not from memory.
2. Ask for the right readout:
   - use prompt-style description when you want a recreation prompt
   - use style analysis when you want reusable look language
3. Break the result into layers before writing anything back:
   - subject and action
   - environment and time cues
   - composition and lens feel
   - lighting and atmosphere
   - style and texture
4. Rebuild the prompt in plain, generation-ready language. Keep only what is actually visible and useful.
5. Remove invented backstory, over-specific guesses, or details the frame does not clearly support.
6. If the goal is modification, keep the stable parts and only swap the layer you want to change.

Checks:
- the rewritten prompt describes visible evidence, not fantasy explanations
- the prompt is clean enough to edit later
- style traits are separated from story content when reuse matters

Avoid:
- pasting the raw description back without editing
- treating uncertain details as facts
- mixing style transfer goals with literal scene reconstruction in one messy prompt
