Audio production task list (voice):

Purpose:

- Create durable voice tasks for scripted dialogue, narration, and directed voice-over.
- Do not use this guide for music, SFX, or ambient sound design.

## Preparation

1. Gather each line's speaker, intent, timing, language, and scene pressure.
2. Read the character record when an approved vocal identity already exists.
3. Decide whether the line is narration, on-screen dialogue, or an off-screen voice.

## Creation flow

1. Create one audio node per independently editable line.
2. Give each node a short production title rather than using the full dialogue as its title.
3. Put the exact spoken text in the node prompt.
4. Use `canvas.setMediaParams` with `mediaType="audio"`, `audioType="voice"`, and a deliberate emotion vector.
5. Use `task.audio` to prepare the durable Prompt Assembly, then submit the Commander-authored final prompt.

## Emotion vectors

- Supported keys are `happy`, `sad`, `angry`, `fearful`, `surprised`, `disgusted`, `contemptuous`, and `neutral`.
- Prefer one dominant emotion between 0.6 and 0.85 plus neutral or one secondary emotion.
- Match the delivery prompt to the vector; conflicting directions produce unstable speech.
- Keep emotional escalation coherent across consecutive lines from the same speaker.

Examples:

- Restrained grief: `sad 0.65`, `neutral 0.25`, `fearful 0.10`.
- Brittle anger: `angry 0.60`, `contemptuous 0.25`, `neutral 0.15`.
- Calm narration: `neutral 0.75`, `happy 0.15`, `sad 0.10`.

## Review loop

1. Generate representative lines before committing a long sequence.
2. If delivery misses, adjust the vector and delivery direction before rewriting the dialogue.
3. Report the final vector, delivery intent, provider, and resulting task artifact.

Common failures:

- Reusing one emotion vector for every line.
- Writing vague delivery prompts such as "very emotional voice".
- Treating the emotion vector as a substitute for scene context and timing.
- Claiming success before the durable audio task produces an artifact.

Possible outcomes include an explanation, revised Canvas audio facts, or a durable `task.audio`
operation. Tool results determine whether edits or generated artifacts exist. The model decides the
appropriate outcome from the user's request rather than applying a local execution-versus-information
classifier.
