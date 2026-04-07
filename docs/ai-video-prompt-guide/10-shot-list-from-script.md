# Shot List Generation from Script

> How to break a script into a structured shot list for AI video production, with camera, motion, and timing annotations.

---

## Core Principle

A shot list translates narrative beats into **visual instructions**. Each shot = one generation unit. The goal is to give each AI video node enough context to generate a coherent, directable clip.

---

## Shot List Schema

Each shot should define:

```
Shot #  | Scene | Duration | Shot Type | Angle | Motion | Subject Action | Location | Lighting | Notes
```

**Minimal viable shot for AI generation:**
```
[SHOT TYPE] [ANGLE]: [SUBJECT] [ACTION/STATE], [LOCATION], [LIGHTING], [DURATION]s
```

**Example:**
```
ECU LOW ANGLE: weathered hands gripping a katana hilt, rain-soaked dojo floor,
single motivated candle backlight, 4s
```

---

## Shot Type Reference

| Code | Name | Use |
|---|---|---|
| ELS | Extreme Long Shot | Establish world, scale |
| LS | Long Shot | Full body, environment context |
| MS | Medium Shot | Waist up, dialogue, reaction |
| MCU | Medium Close-Up | Chest up, emotional beats |
| CU | Close-Up | Face, object detail |
| ECU | Extreme Close-Up | Eyes, hands, texture |
| OTS | Over-the-Shoulder | Conversation, POV implied |
| POV | Point of View | Immersive, subjective |
| INSERT | Insert Shot | Object detail, cutaway |

---

## Script-to-Shot Decomposition Rules

1. **One action = one shot** — do not combine two distinct actions in one generation
2. **1 narrative beat = 1–3 shots** — establish, action, reaction
3. **Establish before detail** — open each scene with ELS/LS before cutting to CU
4. **Use action verbs, not progressive** — "turns" not "is turning", "rain falls" not "rainy"
5. **Match cut opportunities** — note when consecutive shots share a motion axis for smooth editing
6. **Reaction shots** — every significant action needs a reaction shot (separate node)
7. **B-roll slots** — mark atmospheric/environment shots explicitly; these generate independently

---

## Prompt Template per Shot

```
[SHOT_TYPE] [CAMERA_ANGLE], [SUBJECT]: [ACTION_STATE_FLOW],
[ENVIRONMENT]: [LOCATION_DETAIL],
[LIGHTING]: [SOURCE] [QUALITY] [DIRECTION],
[MOTION]: [CAMERA_MOVE] [SPEED],
[DURATION]: [N]s
```

**State Flow rule (from 01-prompt-structure):** describe mid-action state, not sequences.
- ❌ "the samurai draws his sword and turns"
- ✅ "samurai mid-draw, body torqued 45°, sword half-unsheathed"

---

## Scene Header Block

Prepend each scene's shots with a shared context block to reduce per-shot verbosity:

```
[SCENE CONTEXT: feudal Japan, mountain temple exterior, dusk, overcast diffused light,
visual style: ink wash painting with photorealistic texture overlay]
```

All shots in the scene inherit this context; individual shot prompts only override what changes.

---

## Model-Specific Shot Duration

| Model | Recommended clip length | Notes |
|---|---|---|
| Kling 2.0 | 5–10s | Longer clips maintain motion coherence |
| Runway Gen-4 | 4–8s | Shorter clips = more control; keep prompts under 200 chars |
| Wan 2.1 | 3–6s | Degrades past 6s; always add `cinematic, 24fps` to every prompt |
| Sora | 5–20s | Handles long shots well; longer narrative prompts preferred |
| Luma Ray 2 | 5–9s | Sweet spot for motion quality |

---

## Anti-Patterns

- **Overloading one shot** — multiple scene changes in one prompt = incoherent output
- **Skipping shot type** — models default to medium shot without explicit instruction
- **Vague motion** — "camera moves" is useless; use "slow push-in", "handheld drift left", "static locked"
- **Missing duration** — always specify; models pad or cut arbitrarily without it
