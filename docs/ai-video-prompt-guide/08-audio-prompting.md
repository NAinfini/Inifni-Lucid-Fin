# Audio Prompting for AI Video/Audio Generation

> Sound design prompting for audio-capable AI models.

---

## Overview

As AI video models gain native audio generation capabilities (Veo 3, Kling 2.0+, MiniMax/Hailuo), prompt engineering must expand to include sound design. Audio prompts describe the sonic landscape that accompanies the visual content.

**Key principle:** Audio follows the same rules as visual prompting — describe **physical processes**, not abstract labels.

---

## Audio Prompt Structure

```
[Sound Source Type] + [Physical Behavior] + [Spatial Position] + [Acoustic Environment] + [Emotional Quality]
```

### The 5 Audio Dimensions

#### 1. Sound Source (声源)

Name the physical object producing the sound:

- ❌ `sad music playing`
- ✅ `a solo cello playing a low sustained minor phrase`
- ❌ `ambient noise`
- ✅ `rain striking a tin roof, water dripping from a gutter into a metal bucket`

#### 2. Physical Behavior (物理行为)

Describe HOW the sound is produced:

- ❌ `loud footsteps`
- ✅ `heavy boots striking wet concrete with each deliberate step, slight echo between walls`
- ❌ `wind sound`
- ✅ `wind gusting through narrow alley gaps, whistling past corrugated metal edges`

#### 3. Spatial Position (空间位置)

Ground sound in physical space relative to the camera/listener:

- `distant thunder rolling from far left to right across the sky`
- `close whisper barely audible from just behind the camera`
- `footsteps approaching from deep background, growing louder`
- `traffic noise muffled through a closed window`

#### 4. Acoustic Environment (声学环境)

The space shapes how sound behaves:

- `large empty cathedral reverb — every sound decaying slowly with warm echo`
- `tight closet, completely dead and dry, no reverberation`
- `underwater muffled quality, high frequencies absorbed, low rumble dominant`
- `open field, no reflections, sound dissipating into open air`

#### 5. Emotional Quality (情感品质)

Use the same objective correlative principle as visual emotion presets:

- ❌ `scary sounds`
- ✅ `low-frequency rumble below conscious hearing threshold, irregular metallic creaking, sudden silence between sounds`
- ❌ `happy music`
- ✅ `light acoustic guitar picking a major-key melody, gentle finger-plucked rhythm, warm and unhurried`

---

## Audio Layer Categories

### Dialogue / Voice

```
Format: [voice quality] + [delivery style] + [emotional state through physical description] + [spatial context]
```

Examples:

- `male voice, low baritone, speaking slowly and deliberately, slight gravel in throat, close-mic intimacy`
- `female voice calling from across a courtyard, words slightly lost to distance and echo, urgency in the rising pitch`
- `child's whisper, breathy and conspiratorial, lips practically touching the ear`

### Ambient / Atmosphere

```
Format: [environmental sound sources] + [layering] + [spatial depth] + [time-of-day indicators]
```

Examples:

- `dawn forest: birdsong from multiple distances, a stream gurgling nearby, occasional branch crack from wind, dew dripping from leaves`
- `late-night city apartment: distant traffic hum, intermittent siren far away, fridge compressor cycling, clock ticking on wall`
- `underwater cave: bubbles rising and popping at surface, dripping water echoing off stone, low current whoosh`

### Music / Score

```
Format: [instrumentation] + [key/mood] + [tempo/rhythm] + [dynamics] + [production quality]
```

Examples:

- `sparse piano, minor key, slow tempo around 60 BPM, single notes with long sustain and natural decay, recorded in an empty room`
- `full orchestral swell building from strings-only to brass and timpani, major key resolution, crescendo over 8 bars`
- `lo-fi hip-hop beat, vinyl crackle, mellow jazz piano loop, soft kick and brushed snare, tape-saturated warmth`

### Sound Effects (SFX)

```
Format: [sound source] + [physical mechanism] + [intensity] + [duration/envelope] + [spatial placement]
```

Examples:

- `glass shattering on stone floor, high-pitched crystalline scatter, fragments bouncing and settling over 2 seconds`
- `heavy wooden door slowly creaking open, dry hinges groaning under weight, air pressure shift as room opens`
- `match striking, brief scratch and flare, sulfur sizzle settling into steady small flame crackle`

---

## Audio-Visual Sync Principles

### 1. Sound Follows Action

Audio events should correspond to visible physical events:

- Footstep impacts sync with foot-ground contact
- Door sounds sync with door movement
- Impact sounds sync with collision frames

### 2. Anticipation Sound

Sound often precedes visual action by a fraction:

- Intake of breath before speaking
- Mechanical tension before release
- Approaching sound before subject enters frame

### 3. Sound Perspective Matches Camera

- Wide shot → sounds feel distant, more ambient
- Close-up → sounds feel intimate, detailed, present
- POV → sounds positioned as the character would hear them

### 4. Silence is a Sound

Deliberate absence of sound is a powerful tool:

- `sudden complete silence after the explosion, ringing tinnitus onset`
- `all ambient sound dropping away, leaving only the character's breathing`
- `the music cutting out abruptly, leaving raw environmental sound`

---

## Model-Specific Audio Notes

### Veo 3+

- Native audio generation alongside video via `generateAudio: true` API parameter
- Supports ambient, dialogue, and music layers in the same prompt
- Separate audio descriptions from visual with clear section markers like "Audio:" or "SFX:"
- Audio quality correlates with visual quality preset
- Best results with 100-200 word prompts that integrate audio and visual descriptions

### Kling 2.6+ / 3.0

- Audio-aware video generation via `enable_audio: true` API parameter
- Lip sync capabilities for dialogue — specify who is speaking and when
- Best results when audio prompt describes a single dominant sound layer
- Supports voice description for character speech
- Pro mode recommended for audio generation (2x cost of standard)
- Anchor hands to objects when characters interact with items that produce sound

### MiniMax / Hailuo

- Strong speech/dialogue generation via separate T2A (Text-to-Audio) API
- Voice cloning capabilities affect prompt strategy
- Music generation with style reference
- SFX generation from onomatopoeia
- Note: audio is NOT generated inline with T2V API — it's a separate audio service

### Providers WITHOUT Audio Support

- **Runway Gen-4.5**: No audio generation. Focus on visual quality and Director Mode camera control.
- **Luma Ray 2**: No audio. Strengths are physics-based rendering and keyframe interpolation.
- **Pika**: Sound effects available on web platform only, NOT via API.
- **Seedance 2**: No audio API parameter. Dance/motion generation only.
- **Wan 2.1**: No audio. Open-source model focused on visual generation.
- **HunyuanVideo**: No audio. Tencent offers separate audio models.

---

## Anti-Patterns

| ❌ Don't                                                       | ✅ Instead                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sad music`                                                    | `slow strings in a minor key, cello carrying a descending phrase, long decay between notes`                                        |
| `ambient sounds`                                               | `cicadas buzzing, distant lawnmower drone, sprinkler ticking rhythmically`                                                         |
| `loud explosion`                                               | `deep concussive boom shaking the air, followed by debris raining — glass tinkling, metal clanging, dust settling`                 |
| `someone talking`                                              | `young woman's voice, mid-range, speaking rapidly with nervous energy, slightly breathless`                                        |
| `background noise`                                             | `café: espresso machine hissing, cups clinking, murmured conversations layered, occasional door chime`                             |
| Stack audio quality words: `HD, studio quality, crystal clear` | Describe the recording quality physically: `close-mic studio recording, minimal room noise, warm analog preamp saturation`         |
| Conflict visual and audio mood                                 | Ensure audio emotional quality matches visual preset selection, or deliberately contrast for artistic effect (document the intent) |

---

## Audio Prompt Concatenation

When audio prompts are stacked with visual presets in Lucid Fin's generation pipeline:

```
Final prompt = [Visual scene/narrative text]
             + [Visual preset prompts (camera, lighting, style...)]
             + [Audio: Ambient layer]
             + [Audio: Music/score layer]
             + [Audio: SFX layer]
             + [Audio: Dialogue/voice layer]
```

Rules:

1. Audio prompts should not re-describe visual elements
2. Each audio layer should be self-contained
3. Keep each audio layer to 1-2 sentences
4. Spatial audio descriptions should be consistent with camera position
