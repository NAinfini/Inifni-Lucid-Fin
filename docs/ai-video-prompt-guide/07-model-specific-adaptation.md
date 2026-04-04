# Model-Specific Prompt Adaptation

> Per-model prompt strategies for optimal results across AI video generation providers.

---

## Overview

Each AI video model has different prompt parsing, optimal lengths, negative prompt support, and quirks. This guide provides model-specific adaptation rules for Lucid Fin's preset prompt system.

**Key insight:** A prompt optimized for one model may produce poor results on another. The prompt assembler should adapt output based on the target provider.

---

## Quick Reference Table

| Model              | Prompt Length | Neg. Prompt          | i2v                   | Camera Control       | Open Source      | Duration |
| ------------------ | ------------- | -------------------- | --------------------- | -------------------- | ---------------- | -------- |
| **Kling 2.0**      | 100-200 words | Yes (separate field) | Yes                   | API params + prompt  | No               | 5-10s    |
| **Runway Gen-4**   | 50-100 words  | No                   | Yes                   | Director Mode fields | No               | 5-10s    |
| **Luma Ray 2**     | 50-150 words  | No                   | Yes                   | Prompt + keyframe    | No               | 5s       |
| **Wan 2.1**        | 50-150 words  | Yes                  | Yes (dedicated model) | Prompt               | Yes (Apache 2.0) | ~5s      |
| **MiniMax/Hailuo** | 80-150 words  | No                   | Yes (first_frame)     | Director Mode params | No               | 5-6s     |
| **Pika 2.0+**      | 30-100 words  | Yes                  | Yes (core feature)    | Prompt (weaker)      | No               | 3-4s     |
| **Seedance**       | 50-120 words  | Limited              | Yes                   | Prompt               | No               | 5-8s     |
| **HunyuanVideo**   | 50-200 words  | Yes                  | Yes                   | Prompt               | Yes (Tencent)    | ~5s      |
| **CogVideoX**      | 50-200 words  | Yes                  | Yes                   | Prompt               | Yes (Apache 2.0) | 6s       |

---

## 1. Kling 2.0 (Kuaishou 可灵)

### Prompt Strategy

Kling 2.0 is the most well-rounded model for detailed cinematic prompts. It processes natural language well and has the broadest feature set.

**Optimal structure:**

```
[Shot Type] + [Subject + Appearance] + [Action (state flow)] + [Environment] + [Camera Movement] + [Lighting] + [Style/Color Grade]
```

### Prompt Length

- **Sweet spot**: 100-200 words
- Handles detailed prompts better than most competitors
- Degrades beyond ~300 words (starts ignoring late-prompt elements)
- For i2v: 20-50 words (motion/change only)

### Negative Prompts

- **Supported** via separate `negative_prompt` field
- Effective negatives: `blurry, distorted, deformed, low quality, watermark, text, jittery, morphing, static`
- The `negative_prompt` goes through the same encoder as the positive prompt

### Unique Features

- **Lip sync**: Native support for dialogue-synced video — provide audio alongside the prompt
- **Multi-character control**: Improved in 2.0 — use spatial anchoring: `Character A on the left... Character B on the right...` or Chinese labels `左侧/右侧`
- **Time-segment labels**: Multi-stage prompts with time markers: `[0-3s]: action A. [3-6s]: action B.`
- **Camera control API**: 6-axis structured camera parameters separate from text prompt — overrides prompt-based camera instructions:
  - `horizontal` (-10 to 10): truck left/right
  - `vertical` (-10 to 10): crane up/down
  - `pan` (-10 to 10): pan rotation
  - `tilt` (-10 to 10): tilt rotation
  - `roll` (-10 to 10): roll rotation
  - `zoom` (-10 to 10): zoom in/out
- **Master mode**: Enhanced prompt understanding mode that dedicates more compute to prompt adherence
- **Extended video**: Up to 3 minutes with clip-chaining extensions
- **Character ID**: Reference face images for identity consistency across clips
- **cfg_scale**: Exposed parameter (0.0-1.0) controlling prompt adherence vs. creative freedom

### Camera/Motion Control

- Text-based: `camera slowly pans left`, `dolly in`, `aerial drone shot`, `handheld follow`
- API parameters: structured `camera_control` with type, direction, speed — these override text
- When using Camera control API, remove camera instructions from the text prompt to avoid conflicts
- Kling is particularly good at: orbital shots, crane movements, dolly-in, tracking shots

### Quirks & Pitfalls

- **Prompt front-loading**: Most important elements should appear first — attention drops after ~150 words
- **Chinese prompts**: Some subjects (traditional Chinese aesthetics, food) produce better results in Chinese
- **Motion default**: Tends toward moderate motion; use "explosive", "rapid", "violent" for high energy
- **Hand artifacts**: Like most models, struggles with hands in close-up
- **Text rendering**: Cannot reliably render readable text

### Style Control

- Film stock references work well: `shot on Kodak Vision3 500T`, `Fujifilm Eterna`
- Director references work: `Wong Kar-wai color grading`, `Kubrick symmetrical composition`
- Color grading language: `teal and orange`, `desaturated cool tones`, `bleach bypass`

### Duration Handling

- Default: 5 seconds, extendable to 10 seconds
- 5s: full prompt complexity allowed
- 10s: simplify to one subject, one sustained action, one environment
- Extended (chaining): keep prompts consistent across clips for continuity

### Example Prompts

**T2V:**

```
Close-up shot of a detective in a dimly lit office, smoke rising from a cigarette held loosely between two fingers. His eyes narrow as he reads a document under a single desk lamp casting hard shadows across weathered features. Camera slowly pushes in. Shot on 35mm, high contrast chiaroscuro lighting, noir color palette with deep blacks and isolated warm highlights.
```

**I2V:**

```
The woman slowly turns her head toward the camera, a faint smile forming. Hair sways gently. Background lights shift slightly.
```

---

## 2. Runway Gen-3 Alpha / Gen-4

### Prompt Strategy

Runway favors **shorter, more focused prompts**. It has strong internal prompt understanding and over-specification causes confusion.

**Optimal structure:**

```
[Subject + Action] + [Environment] + [Camera] + [Style]
```

### Prompt Length

- **Sweet spot**: 50-100 words
- Runway processes prompts more aggressively than Kling — shorter is better
- Beyond 120 words, the model starts averaging/ignoring elements
- Gen-3 Alpha Turbo: even shorter (30-70 words)

### Negative Prompts

- **Not supported** as a separate field
- Avoid unwanted elements via positive exclusion: `without text overlays`, `no watermarks`, `smooth continuous motion`
- Runway relies on its built-in quality filtering

### Unique Features

- **Director Mode** (Gen-4): Structured fields for scene, camera, and action as separate inputs rather than a single prompt string
- **Motion Brush**: Paint motion directions onto specific image regions — pixel-level motion control unique to Runway. Prompts reinforce what the brush defines
- **Style Reference Image**: Upload a separate style reference image to guide the aesthetic — more reliable than prompt-based style control
- **Green Screen mode**: Generate video with alpha channel / transparent background
- **Gen-3 Alpha Turbo**: Faster but lower quality variant — benefits from simpler prompts
- **Multi-motion**: Specify different motions for foreground vs background
- **Act-One**: Facial performance transfer from webcam to character
- **Aspect ratios**: 16:9, 9:16, 1:1, custom

### Camera/Motion Control

**Standard mode** (Gen-3): Camera movement in prompt text

- `camera pans right`, `slow dolly in`, `static wide shot`, `handheld tracking`

**Director Mode** (Gen-4): Structured fields

- `scene`: environment/setting description
- `camera`: camera movement and framing
- `action`: character/subject action
- When using Director Mode, do NOT combine all into one paragraph

### Quirks & Pitfalls

- **Over-prompting penalty**: Runway actively degrades with long, complex prompts — be concise
- **Camera instruction adherence**: Gen-3 sometimes ignores camera instructions; Gen-4 Director Mode is more reliable
- **Motion amount**: Runway defaults to moderate motion; it's harder to get very static or very dynamic shots compared to Kling
- **Style override difficulty**: Runway has a strong "house style" that's hard to override with prompt-based style references
- **No negative prompt workaround**: Use phrases like `clean, without artifacts` in the positive prompt

### Style Control

- Style keywords: `cinematic`, `photorealistic`, `documentary`, `sci-fi`, `noir`
- Film stock references have moderate effect (weaker than Kling)
- Runway's built-in style is polished and slightly "produced" — hard to get raw/gritty
- Best at: clean cinematic, photorealistic, smooth motion

### Duration Handling

- Default: 4-10 seconds (user selectable)
- 4s: detailed prompt OK
- 10s: keep to one subject, one continuous action
- Prompt complexity should inversely scale with duration (more so than Kling)

### Example Prompts

**T2V (Gen-3):**

```
A woman walks alone through a foggy forest at dawn, sunlight filtering through trees. Camera tracks alongside her at medium distance. Soft natural lighting, muted greens, cinematic.
```

**Director Mode (Gen-4):**

```
Scene: An empty subway platform at 2 AM, fluorescent lights flickering, distant rumble.
Camera: Slow dolly forward along the platform edge.
Action: A lone figure in a dark coat stands motionless at the far end, facing away.
```

---

## 3. Luma Dream Machine / Ray 2

### Prompt Strategy

Luma excels at **physics-based rendering** and spatial understanding. It responds well to prompts that describe physical reality.

**Optimal structure:**

```
[Subject + Physical Details] + [Action with Physics] + [Environment + Materials] + [Camera] + [Lighting Physics]
```

### Prompt Length

- **Sweet spot**: 50-150 words
- Handles moderate-length prompts well
- Physics-specific vocabulary is high-value: describing material properties, light behavior, and forces adds quality without bloating

### Negative Prompts

- **Not supported** as a separate parameter
- Use positive framing: `realistic motion, natural physics, no jitter`

### Unique Features

- **Physics simulation**: Best-in-class physical realism — liquid, cloth, fire, smoke, gravity all render naturally
- **Spatial understanding**: Strong 3D scene comprehension and world model
- **Keyframe interpolation**: Provide start image + end image — the model generates smooth transitions between them. Directly maps to Lucid Fin's canvas workflow
- **Keyframe camera paths**: Define camera start and end positions for precise movement
- **Loop generation**: Can generate seamless looping videos
- **Material responsiveness**: Describing materials (silk, metal, water, glass) produces accurate physical rendering
- **Light physics**: Caustics, reflections, refractions render with high fidelity
- **Extended duration**: Ray 2 supports up to 9-10 second clips (vs. original Dream Machine's 5 seconds)

### Camera/Motion Control

- Text-based with strong adherence: `camera slowly orbits clockwise`, `dolly forward through the scene`
- **Keyframe system**: Define camera start position and end position — the model interpolates
- Physics-aware camera: `handheld with natural sway`, `steadicam smooth glide`
- Luma is one of the best at faithful camera movement execution

### Quirks & Pitfalls

- **Character faces**: Less consistent than Kling for human faces, especially in close-up
- **Stylization limits**: Best at photorealistic/natural; struggles more with heavy stylization (anime, pixel art)
- **Prompt parsing**: Less sophisticated natural language understanding than Kling — simpler sentence structure works better
- **Speed**: Generation can be slow for high-quality outputs

### Style Control

- Best at: photorealistic, natural, cinematic
- Material-based style works well: `shot on ARRI Alexa`, `anamorphic glass`, `natural film grain`
- Physics vocabulary enhances quality: `volumetric fog scattering light`, `caustic reflections on ceiling`, `silk catching light along each fold`

### Duration Handling

- Default: ~5 seconds
- Keep prompts focused on one physical event at this duration
- Continuous states (flowing water, drifting smoke) work best for full-length clips

### Example Prompts

**T2V:**

```
A glass sphere rolls slowly across a polished marble table, refracting the warm lamplight through its surface, casting dancing caustic patterns on the dark wood. Camera holds still at table level, shallow focus on the sphere. Dust particles drift through the warm light beam.
```

**I2V:**

```
Gentle wind picks up, silk curtain billows inward, dust particles begin to catch the shifting light. Camera drifts slightly to the right.
```

---

## 4. Wan 2.1 (Alibaba / Tongyi 通义万相)

### Prompt Strategy

Wan 2.1 is open-source with a bilingual T5 encoder. It genuinely understands sentence structure (not keyword-based). LoRA ecosystem enables strong style control.

**Optimal structure:**

```
[Subject Description] + [Action/Motion] + [Environment/Setting] + [Camera Movement] + [Lighting/Atmosphere] + [Style/Quality]
```

### Prompt Length

- **14B model**: 50-150 words (handles longer prompts well)
- **1.3B model**: 30-80 words (keep focused)
- **With LoRA**: 30-60 words (let the LoRA style dominate)
- **i2v**: 20-60 words (motion/change only)

### Negative Prompts

- **Supported** via separate `negative_prompt` parameter
- Uses classifier-free guidance (CFG typically 5.0-7.5)
- Effective negatives: `blurry, distorted, deformed, low quality, watermark, text overlay, static, frozen, jittery, unnatural motion`

### Unique Features

- **Open source** (Apache 2.0): Run locally with ComfyUI or diffusers
- **Bilingual T5 encoder**: Native Chinese + English understanding — not translation
- **LoRA ecosystem**: Extensive community LoRAs for style, character consistency, and quality enhancement
- **First-Last-Frame mode (FLF2V)**: Generate video connecting two keyframe images — directly maps to Lucid Fin's canvas workflow
- **Variable resolution**: Multiple aspect ratios at 480p/720p
- **ComfyUI integration**: Deep workflow node integration for complex pipelines

### Camera/Motion Control

- Natural language in prompt: `camera slowly pans left`, `dolly in`, `tracking shot`, `aerial drone shot`
- Particularly responsive to: `slow motion`, `fast motion`, `time-lapse`, `orbit around`, `first-person POV`
- For precise control, ComfyUI supports camera trajectory conditioning nodes

### Quirks & Pitfalls

- **Chinese prompt advantage**: Some subjects (ink wash painting, Chinese architecture, food) produce dramatically better results in Chinese
- **Bilingual mixing is valid**: `A young woman in 旗袍, walking through a bamboo forest` works
- **Motion default**: Tends toward subtle motion; use strong action verbs for dynamic shots
- **Multi-character**: >2 characters causes identity merging — use spatial separation
- **VRAM**: 14B model needs 24GB+ (RTX 4090/A100); 1.3B runs on 8GB
- **Temporal coherence**: Clips >3 seconds may show character appearance drift

### Style Control

- Film references: `shot on 35mm film`, `Kodak Portra 400`, `anamorphic lens flare`
- Art style: `watercolor`, `anime`, `photorealistic`, `oil painting`
- Director references work well: `Wong Kar-wai color grading`, `Wes Anderson symmetrical composition`
- **LoRA provides strongest style control** — overrides prompt-based styling

### Duration Handling

- Default: 81 frames at 16fps ≈ 5 seconds
- Prompt doesn't need to change for default length
- Shorter (2-3s): single clear action
- Max length: continuous state, not action sequence
- FLF2V: duration fixed by frame interpolation count

### Example Prompts

**T2V (English):**

```
A lone samurai stands at the edge of a misty cliff at dawn, torn cloak whipping in the wind. Camera slowly pushes in from medium to close-up. Golden morning light breaks through fog from behind creating volumetric rays. Shot on 35mm film with warm grain, desaturated blues and warm highlights.
```

**T2V (Chinese — better for Chinese aesthetics):**

```
水墨画风格，一位白衣少女撑着油纸伞，缓步走过古镇石桥。细雨纷飞，桥下流水潺潺。镜头从远景缓缓推进到中景。淡雅的色调，宣纸质感，留白构图。
```

**I2V:**

```
The woman slowly turns her head to the right and smiles, hair swaying with movement. Soft breeze causes petals to drift. Camera remains static.
```

---

## 5. MiniMax / Hailuo AI (Video-01, Video-01-Live)

### Prompt Strategy

MiniMax has two model variants: Video-01 (versatile, stylizable) and Video-01-Live (naturalistic/documentary). The standout feature is **Director Mode** for structured camera control.

**Optimal structure:**

```
[Shot Type/Framing] + [Subject + Appearance] + [Action/Movement] + [Environment] + [Camera Movement] + [Lighting] + [Mood] + [Style]
```

### Prompt Length

- **Sweet spot**: 80-150 words
- Handles detailed prompts well (up to ~2000 characters)
- Very short prompts (<20 words) produce generic results
- Video-01-Live: slightly shorter, more naturalistic prompts (50-100 words)

### Negative Prompts

- **Not supported** — no separate negative prompt field
- Use exclusionary positive language: `without text`, `clean frame`, `smooth natural motion without jitter`

### Unique Features

- **Director Mode**: Structured camera control via API parameters — `camera_control.type` (pan/tilt/dolly/zoom/orbit/static), `camera_control.config` (direction, speed, angle) — overrides text prompt camera instructions
- **Video-01-Live**: Specialized for realistic "live footage" aesthetic
- **Subject Reference**: Character reference images for identity consistency
- **Prompt Optimization**: Built-in LLM prompt expansion in web UI
- **Audio integration**: Some versions support synchronized audio

### Camera/Motion Control

**Standard mode** (prompt text):

- `pan left`, `tilt up`, `zoom in`, `dolly forward`, `tracking shot`, `orbit`, `crane shot`

**Director Mode** (API parameters — preferred):

```
camera_control: {
  type: "dolly",
  direction: "forward",
  speed: "slow"
}
```

- Director Mode overrides text prompt camera instructions
- This is MiniMax's strongest differentiator

### Quirks & Pitfalls

- **No negative prompts**: Must be woven into positive prompt
- **Slow generation**: 3-10 minutes per clip (slower than competitors)
- **Camera jitter**: Without Director Mode, camera can be unpredictable — specify "static camera" for locked shots
- **Face consistency**: Multiple characters in same frame can cause face-swapping
- **Video-01-Live limitations**: Cannot produce heavily stylized outputs (anime, watercolor) — naturalistic only
- **English preferred**: English prompts produce more predictable results for camera/motion terms

### Style Control

- Video-01: versatile — `cinematic`, `photorealistic`, `documentary`, `film noir`, `cyberpunk`, `vintage 8mm`
- Video-01-Live: locked to realistic/naturalistic styles
- Film stock references have moderate effect: `shot on Kodak Vision3 500T` adds warmth/grain
- Color grading: `teal and orange`, `desaturated cool tones`, `high contrast black and white`

### Duration Handling

- Default: ~5-6 seconds (model-determined, not user-configurable via standard API)
- Extended via clip chaining (last frame → first frame of next)
- Single quick action for short clips, continuous state for maximum length

### Example Prompts

**T2V (Video-01):**

```
Close-up shot of an elderly man at a wooden bar counter late at night. He slowly lifts a whiskey glass, amber liquid catching the warm glow of a single Edison bulb. Weathered hands tremble slightly. Empty bar behind him, chairs upturned. Camera holds steady with gentle breathing motion. Shallow depth of field, warm golden highlights, cinematic film grain.
```

**Video-01-Live (naturalistic):**

```
A woman in a red jacket walks through a crowded morning street market, weaving between vendors. Handheld camera follows from behind at shoulder height. Natural morning sunlight, slight lens flare. Documentary style, authentic candid feel.
```

---

## 6. Pika 2.0+ (Pika Labs)

### Prompt Strategy

Pika is the **"less is more"** model. Short, focused prompts outperform detailed descriptions. It has unique creative modes (Modify, Extend, Pikaffects) that change prompt strategy entirely.

**Optimal structure:**

```
[Subject + Action] + [Environment] + [Style/Mood]
```

### Prompt Length

- **Sweet spot**: 30-100 words
- **Pikaffects**: 5-20 words (the effect IS the prompt)
- **Modify mode**: 10-30 words (single instruction)
- Beyond 150 words: model selectively ignores elements

### Negative Prompts

- **Supported** via separate field (web UI and API)
- Effective negatives: `blurry, distorted, deformed, watermark, text, static, jittery, morphing`
- Optional — works well without them for most cases

### Unique Features

- **Pikaffects**: One-click effects (crush, melt, explode, inflate, dissolve, cake-ify) — effect name IS the prompt
- **Scene Ingredients** (2.1): Structured input — Subject, Scene, Action, Style as separate fields
- **Modify Mode**: Edit existing video with natural language (`"make it rain"`, `"change shirt to blue"`)
- **Extend Mode**: Continue a clip with follow-up prompt
- **Lip Sync**: Audio + image/video → lip-synced talking head
- **Sound Effects**: Automatic or prompted SFX generation

### Camera/Motion Control

- Text-based but **weaker adherence** than competitors
- Pair camera with complementary subject motion: `camera tracks left as the woman walks left`
- For static shots: explicitly state `static camera, locked off`
- Sometimes ignores camera instructions entirely — less reliable than Kling/MiniMax Director Mode

### Quirks & Pitfalls

- **Short clips**: 3-4 seconds default — need Extend mode for longer
- **Simplicity bias**: Gravitates toward clean/simple — complex multi-character scenes often fail
- **Pikaffects override**: When using effects, text prompt influence is reduced
- **House style**: Has a recognizable "Pika look" that's hard to override
- **Scene Ingredients**: Not all API endpoints support the structured input — some only accept flat prompt string
- **Motion default**: Tends toward subtle/gentle motion

### Style Control

- Keywords: `cinematic`, `anime`, `3d-animation`, `natural`, `pixel art`, `watercolor`, `noir`
- API `style` parameter: preset names (`default`, `anime`, `3d-animation`, `natural`, `cinematic`)
- Style presets and prompt-based style can conflict — pick one approach

### Duration Handling

- Default: 3-4 seconds
- Longer: use Extend mode (chain clips)
- Each clip prompt describes one continuous state
- Extend mode: describe what happens NEXT, not a recap

### Example Prompts

**T2V:**

```
A golden retriever puppy runs through wildflowers in slow motion, ears flopping. Warm afternoon sunlight, shallow depth of field, cinematic.
```

**Modify Mode:**

```
Make it a rainy night scene with neon reflections on wet pavement.
```

**Scene Ingredients (2.1):**

```
Subject: A young astronaut in a white spacesuit
Scene: Mars surface, red desert with distant mountains
Action: Slowly plants a flag, looking up at the sky
Style: Cinematic, photorealistic, anamorphic lens flare
```

---

## 7. Seedance (ByteDance 即梦)

### Prompt Strategy

ByteDance's Seedance specializes in **motion generation** — particularly dance, body movement, and character animation. It has strong motion coherence and character consistency.

**Optimal structure:**

```
[Subject + Appearance] + [Motion/Dance Description] + [Environment] + [Camera] + [Style]
```

### Prompt Length

- **Sweet spot**: 50-120 words
- Motion descriptions benefit from specificity — name body parts and movement qualities
- Environmental descriptions can be minimal if motion is the focus

### Negative Prompts

- **Limited support** — model-dependent; check API docs for current version
- Focus on positive prompt quality

### Unique Features

- **Dance/motion specialization**: Best-in-class for choreographed body movement
- **Character consistency**: Strong identity preservation across clips — Jimeng platform supports character locks (角色锁定) with reference images
- **Motion reference**: Can accept motion reference input alongside text prompt
- **Body part specificity**: Responds well to per-body-part motion descriptions
- **Built-in prompt enhancer**: The Jimeng platform has an LLM preprocessor (提示词优化) that expands short prompts automatically before feeding to the video model — can improve naive prompts but may misinterpret precise intent

### Camera/Motion Control

- Standard prompt-based camera terms
- Motion vocabulary is the strength: describe specific body movements, dance styles, gesture qualities
- `fluid arm movements`, `sharp hip isolations`, `slow-motion pirouette`, `explosive jump with full extension`

### Quirks & Pitfalls

- **Non-dance content**: Less versatile than general-purpose models for static scenes or environments
- **Complex environments**: Better with simple backgrounds that don't compete with motion
- **Audio sync**: Dance generation works best when describing rhythm/tempo in the prompt
- **Style range**: More limited stylization options compared to Kling or Runway

### Style Control

- Works well with: `cinematic`, `music video`, `professional dance studio`, `stage performance`
- Lighting for motion: `dramatic stage lighting`, `spotlight following the dancer`
- Less responsive to film stock references or heavy artistic styles

### Duration Handling

- Default: 5-8 seconds
- Dance sequences benefit from longer clips — describe a continuous movement phrase
- For short clips: single gesture or movement beat

### Example Prompts

**Dance:**

```
A female dancer in flowing white dress performs a contemporary dance sequence — arms extending gracefully upward, body spiraling slowly, fabric trailing through the air. Dark stage with single warm spotlight from above. Camera slowly orbits at waist height. Cinematic, shallow depth of field.
```

**Motion:**

```
A martial artist executes a slow-motion roundhouse kick, leg fully extended, body perfectly balanced on the supporting leg. Hair and loose clothing trailing the movement. Studio setting with dramatic side lighting.
```

---

## 8. HunyuanVideo (Tencent 混元)

### Prompt Strategy

Tencent's open-source video model with bilingual support. Uses a **Dual-Stream to Single-Stream DiT** architecture with a critical differentiator: an **MLLM (Hunyuan-Large) as its text encoder** instead of CLIP/T5. This gives HunyuanVideo significantly better natural language comprehension than most competitors — it genuinely parses multi-clause sentences, spatial relationships, and temporal sequences.

**Optimal structure:**

```
[Subject] + [Action] + [Environment] + [Camera/Composition] + [Lighting] + [Style]
```

### Prompt Length

- **Sweet spot**: 50-200 words (up to 256 tokens processed by the MLLM encoder)
- Because the MLLM encoder understands natural language deeply, HunyuanVideo is **more forgiving of prompt order and style** than CLIP/T5-based models — paragraph-style descriptions work well
- Handles bilingual prompts (Chinese + English) natively
- Less tolerant of filler words than U-Net models — but better at extracting meaning from complex sentences

### Negative Prompts

- **Supported** via separate parameter
- DiT-based CFG guidance applies negatives effectively
- Standard negatives: `blurry, deformed, low quality, watermark, static, jitter`

### Unique Features

- **MLLM text encoder**: Uses Hunyuan-Large (a bilingual multimodal LLM) instead of CLIP/T5 — the single biggest differentiator. Better spatial reasoning ("A is to the left of B"), temporal sequence understanding, and multi-clause comprehension
- **Open source** (Tencent Open Source): Full weights on HuggingFace
- **Dual-Stream to Single-Stream DiT**: Architecture allows both independent and joint processing of text and visual tokens
- **3D VAE**: Custom causal 3D VAE for efficient spatial-temporal compression
- **Bilingual**: Native Chinese + English through the MLLM encoder
- **Unified image and video**: Can generate both images and videos from the same model
- **Asian face/culture strength**: Training data produces particularly good results for Asian faces and cultural contexts
- **Resolution flexibility**: Supports various aspect ratios
- **Community LoRA support**: Growing ecosystem on HuggingFace/ModelScope

### Camera/Motion Control

- Text-based: standard cinematic camera vocabulary
- DiT attention means camera instructions compete equally with other prompt elements — don't bury camera movement at the end
- Place camera instructions mid-prompt for balanced attention

### Quirks & Pitfalls

- **VRAM hungry**: Full model requires 60-80GB VRAM at full resolution; FP8 and quantized versions exist for consumer GPUs
- **CFG scale sensitivity**: Too high (>7) produces oversaturated, artifact-heavy results — community consensus is CFG 1.0-6.0
- **Token efficiency**: Every word matters more in DiT — eliminate filler ruthlessly
- **Asian face bias**: Produces exceptionally good Asian faces but may struggle with high diversity
- **Community maturity**: Younger ecosystem than Wan 2.1 — fewer LoRAs and workflow integrations
- **Temporal length**: Standard clip length ~5 seconds (129 frames)
- **Motion amount control**: No explicit motion intensity parameters — controlled purely through prompt language ("slowly" vs "rapidly")

### Style Control

- Chinese aesthetic subjects: use Chinese-language prompts
- Western cinema references: use English
- Film stock references: moderate effect
- Art style keywords: standard response to `cinematic`, `anime`, `watercolor`, etc.

### Duration Handling

- Default: ~5 seconds
- Same principles as other models: simpler prompts for longer clips
- Continuous state descriptions work best at full duration

### Example Prompts

**T2V:**

```
A young woman in traditional hanfu sits by a lotus pond at golden hour, gently dipping her fingers in the water. Ripples spread outward catching warm light. Camera slowly pushes in from medium to close-up. Soft natural lighting, warm tones, cinematic depth of field.
```

**I2V:**

```
Wind gradually picks up, hair and fabric beginning to sway. Lotus petals detach and drift across the water surface. Light shifts warmer.
```

---

## 9. CogVideoX (Tsinghua / ZhipuAI 智谱)

### Prompt Strategy

CogVideoX is a DiT-based open-source model from Tsinghua/ZhipuAI. It uses **T5-XXL as its text encoder** (max ~226 tokens) and a 3D full-attention transformer architecture. Responds best to **dense, descriptive paragraph-style prompts** rather than keyword lists.

**Optimal structure:**

```
[Subject + Detailed Description] + [Action] + [Environment] + [Camera] + [Lighting] + [Style + Quality]
```

### Prompt Length

- **Sweet spot**: 50-200 words (T5-XXL encoder processes up to ~226 tokens)
- **Tolerates longer prompts** better than most models — the DiT architecture maintains attention across longer sequences
- The 5B parameter version handles complexity well
- Place critical elements early for priority weighting
- Official recommendation: use ZhipuAI's built-in prompt optimization LLM to expand short prompts to ~100-word descriptions

### Negative Prompts

- **Supported** via CFG guidance
- Standard negatives effective: `blurry, worst quality, deformed, watermark`
- CFG scale typically 6.0-8.0

### Unique Features

- **Open source** (Apache 2.0): Full weights available on HuggingFace with first-class Diffusers integration
- **3D full-attention DiT**: Full 3D attention across spatial and temporal dimensions simultaneously (not separate spatial + temporal) — improves temporal coherence
- **Structured prompt following**: Better at honoring detailed multi-element prompts than many competitors
- **Native 6-second clips**: 49 frames per generation (longer default than Pika)
- **Multiple model sizes**: CogVideoX-2B (fast, lower quality) and CogVideoX-5B (slower, higher quality)
- **Dedicated I2V model**: CogVideoX-5B-I2V is a separate model with separate weights (not a mode switch) — image is encoded via 3D VAE and concatenated with noise latents
- **Expert attention**: Mixture-of-experts architecture variants for efficiency

### Camera/Motion Control

- Text-based with good adherence
- `tracking shot`, `static camera`, `slowly panning`, `aerial view`, `first-person perspective`
- Benefits from being explicit about camera speed and direction
- DiT architecture gives more balanced attention to camera instructions vs. subject descriptions

### Quirks & Pitfalls

- **Fixed frame count**: Output is exactly 49 frames per generation (~6s at 8fps, ~2s at 24fps) — this is a hard architectural constraint
- **DiT-specific**: Prompt parsing differs from U-Net diffusion models — what works for Stable Diffusion may not transfer directly
- **Prompt sensitivity**: Small prompt changes can produce very different results — less stable than some commercial alternatives
- **2B vs 5B motion quality**: The 2B model produces noticeably jittery motion; the 5B model is significantly better
- **Face quality at distance**: Faces at medium-to-far distances can be low quality; close-up faces are better
- **Compute requirements**: 5B model needs substantial VRAM (~16GB+)
- **Resolution**: Standard output is 720x480 or 480x720 — higher resolutions require upscaling
- **Community size**: Smaller community than Wan 2.1 — fewer guides and LoRAs available
- **Chinese text encoder**: Some CogVideoX versions have a Chinese-primary encoder where Chinese prompts outperform English

### Style Control

- Standard style keywords work: `cinematic`, `photorealistic`, `anime`, `oil painting`
- Film references: moderate effectiveness
- Quality modifiers: `high quality`, `detailed` have mild positive effect (unlike the quality-stacking anti-pattern with image models)

### Duration Handling

- Default: 6 seconds (49 frames at ~8fps or 48 frames at 8fps depending on config)
- Longer than Pika's default — can handle more complex single actions
- Same principle: simpler prompts for longer perceived duration

### Example Prompts

**T2V:**

```
A vintage red convertible drives along a winding coastal road at sunset. The camera follows from a helicopter perspective, slowly descending. Ocean waves crash against cliffs below. Golden hour lighting paints everything in warm amber. The driver's silk scarf streams in the wind. Photorealistic, shot on 65mm large format, shallow depth of field, cinematic color grading with warm highlights and cool shadows.
```

**I2V:**

```
Car begins to accelerate, wheels spinning, scarf streaming more intensely. Camera slowly pulls back to reveal more of the coastline. Sunset light deepens toward orange.
```

---

## Prompt Assembler Adaptation Rules

When Lucid Fin's prompt assembler compiles preset prompts for a specific target model, apply these rules:

### Length Budget Enforcement

```typescript
const MODEL_WORD_BUDGETS: Record<string, { t2v: number; i2v: number }> = {
  kling: { t2v: 200, i2v: 50 },
  runway: { t2v: 100, i2v: 40 },
  luma: { t2v: 150, i2v: 50 },
  wan: { t2v: 150, i2v: 60 },
  minimax: { t2v: 150, i2v: 50 },
  pika: { t2v: 80, i2v: 30 },
  seedance: { t2v: 120, i2v: 50 },
  hunyuan: { t2v: 200, i2v: 50 },
  cogvideo: { t2v: 200, i2v: 60 },
};
```

When the concatenated prompt exceeds the budget:

1. Trim Quality preset text first (least impact)
2. Trim Environment preset text second
3. Trim Texture preset text third
4. Never trim Camera, Motion, or Subject description

### Negative Prompt Routing

```
Model supports negative prompt → send separately
Model doesn't (Runway, Luma, MiniMax) → weave into positive prompt as exclusionary clauses
```

### I2V Mode Detection

When the generation is image-to-video:

1. Strip all appearance/subject description from the assembled prompt
2. Strip environment description (unless it changes)
3. Keep only: Motion, Camera, Pacing, temporal modifiers
4. Apply the model's i2v word budget

### Camera Control Routing

```
Model has structured camera API (Kling, MiniMax Director Mode, Runway Gen-4) → send camera as API params, remove from text
Model is text-only → keep camera instructions in prompt text
```

### FLF2V (First-Last-Frame) Routing

For Wan 2.1 FLF2V mode (generating video between two keyframe images):

1. Describe the JOURNEY between the two visual states
2. Do not describe either image's appearance
3. Focus on: motion trajectory, camera movement, atmospheric shift
4. This directly maps to Lucid Fin's canvas workflow: Image A → Video → Image B
