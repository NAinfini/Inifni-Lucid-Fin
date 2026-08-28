# Emotion & Voice Prompting

## When to Use

When creating TTS audio nodes with emotional speech, or scoring scenes with mood-driven music/SFX.

## Emotion Vector

Audio nodes support an 8-dimensional emotion vector, each value 0-1:

| Dimension    | Use For                                 |
| ------------ | --------------------------------------- |
| happy        | Joy, excitement, warmth, humor          |
| sad          | Grief, melancholy, longing, nostalgia   |
| angry        | Rage, frustration, intensity, urgency   |
| fearful      | Anxiety, tension, dread, suspense       |
| surprised    | Shock, wonder, revelation, awe          |
| disgusted    | Revulsion, contempt, sarcasm            |
| contemptuous | Disdain, irony, cold authority          |
| neutral      | Calm narration, matter-of-fact delivery |

## Mixing Emotions

Emotions blend — don't limit to a single dimension:

- **Bittersweet**: `{ happy: 0.3, sad: 0.5, neutral: 0.2 }`
- **Nervous excitement**: `{ happy: 0.4, fearful: 0.3, surprised: 0.3 }`
- **Cold fury**: `{ angry: 0.5, contemptuous: 0.4, neutral: 0.1 }`
- **Gentle nostalgia**: `{ sad: 0.3, happy: 0.2, neutral: 0.5 }`

## Voice Prompt Tips

- Write dialogue naturally — include hesitations, emphasis markers
- Match emotion vector to the text content
- For narration, keep neutral high (0.6+) with a subtle secondary emotion
- For dramatic moments, push the primary emotion to 0.7-0.9

## SFX and Music

For `audioType: "sfx"` and `audioType: "music"`, the emotion vector influences mood selection:

- Music: maps to tempo, key, instrumentation choices
- SFX: maps to intensity, eeriness, impact weight
