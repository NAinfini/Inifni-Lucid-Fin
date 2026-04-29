# AI Video Prompt Structure & Fundamentals

> Source: super-i.cn 提示词创作系列 + industry best practices (Kling, Sora, Veo, Runway)

---

## Core Prompt Formula

```
[Camera/Lens Spec] + [Foreground/Composition] + [Subject + Action] + [Environment] + [Lighting/Atmosphere] + [Style/Color Grade]
```

### Alternate Structures

| Formula                                                                           | Use Case                     |
| --------------------------------------------------------------------------------- | ---------------------------- |
| `Shot Type + Subject + Action + Environment + Camera Movement + Lighting + Style` | General purpose              |
| `Camera First + Scene + Subject + Motion + Atmosphere`                            | When camera work is priority |
| `Subject + Environment + Motion + Style`                                          | Simple scenes                |
| `Foreground Occlusion + Mid-ground Subject + Background Environment + Film/Color` | Cinematic depth              |

## The 6 Prompt Dimensions

### 1. Subject (主体)

- Define the main character or focal point clearly
- Place the most important content FIRST
- Include: age, gender, clothing, physical details, expression
- Example: `A young woman with curly red hair in a vintage dress`

### 2. Action (动作)

- Use **dramatic verbs**: slide, surge, drift, swoop, emerge
- Describe the PROCESS, not the RESULT
- ❌ `looking very sad, crying` → ✅ `eyes reddening, lips trembling slightly, gaze drifting downward`
- Specify micro-actions: muscle tension, breathing, gaze direction

### 3. Environment/Context (场景/环境)

- Provide rich background: `bustling Tokyo street market at night, neon signs, crowded stalls`
- Three spatial layers:
  - **Foreground**: occlusion/blocking elements (pillars, leaves, window frames)
  - **Middle ground**: subject action zone
  - **Background**: environmental context (city lights, mountains, sky)

### 4. Camera & Composition (镜头/构图)

- Shot types: wide, medium, close-up, extreme close-up, macro
- Angles: low angle, high angle, eye-level, bird's-eye, worm's-eye, Dutch angle
- Perspectives: POV, profile, over-the-shoulder
- Movement: pan, tilt, dolly, tracking, crane, arc, handheld

### 5. Lighting & Atmosphere (灯光/氛围)

- Source: natural, artificial, motivated (specify WHERE light comes from)
- Quality: soft, hard, diffused, volumetric
- Time: golden hour, blue hour, moonlit, overcast
- Color temperature: warm orange, cool blue, neutral
- Atmospheric medium: haze, dust motes, rain, fog, particles

### 6. Style & Aesthetics (风格/美学)

- Artistic direction: cinematic, documentary, noir, surreal, hyperrealistic
- Film stock/grade: Kodak Vision3, Fujifilm Eterna, teal-and-orange
- Era: 1920s film, 90s VHS, Y2K, modern clean
- Reference: specific directors, cinematographers, or films (for style only)

---

## Key Principles

### One Idea Per Prompt

Focus on a single main action or scene. Overloading produces chaos.

### Process Over Result (过程 > 结果)

- ❌ `a man who is very angry`
- ✅ `knuckles whitening as fingers press into the table surface, jaw muscles clenching`

### Verbs Over Adjectives (动词 > 形容词)

- ❌ `standing lonely in a blizzard`
- ✅ `leaning hard against the wind, pressing down a hat with force, body pitched sharply forward`

### Environmental Resistance (环境对抗)

Subject must FIGHT the environment, not merely exist in it:

- `Core action + environmental resistance + specific physical verb = story emerges`

### Specificity Over Generality

- ❌ `a building` → ✅ `a modern glass skyscraper with reflective windows and sleek architectural lines`
- ❌ `cinematic lighting` → ✅ `cold moonlight through left-side venetian blinds, warm desk lamp illuminating half the face`

---

## State Flow vs. Action Lists (状态流 vs. 动作清单)

> Source: Lesson 28 — 从动作清单到状态流

The critical shift from amateur to professional prompts: **describe state, not sequence**.

### 1. Replace Verb Stacking with Manner Words

Keep one core verb, describe HOW the movement happens:

- ❌ `he walks, looks around, sits down, picks up cup`
- ✅ `walking with weighted steps, gaze drifting absently`

### 2. Anchor + Satellite Actions

One governing action (torso/legs) + modifiers (head/arms/expression):

- Anchor: `striding forward` (the core movement)
- Satellites: `head slightly lowered`, `coat swaying`, `fingers tapping thigh`

### 3. State Snapshot

Describe the specific mid-action moment, not the sequence:

- ❌ `he finishes drink, then slams glass`
- ✅ `glass pressed against table, liquid still airborne`
- AI infers before/after automatically — the freeze-frame approach produces more cinematic results

**Rule**: Use ONE tense per prompt. Formula: `Subject + Environment + one clear time state + style`

### State Flow Diagnostic Framework

"动作崩坏从来不是随机概率问题，它一定对应着一条写错了逻辑的提示词" — Action collapse always corresponds to a prompt with flawed logic.

| Check                | Problem                                | Fix                                              |
| -------------------- | -------------------------------------- | ------------------------------------------------ |
| Too many verbs?      | Instruction conflict → twisted poses   | Delete verbs, replace with manner words          |
| No hierarchy?        | Mechanical stiffness → all limbs equal | One anchor action; others subordinate            |
| Temporal connectors? | Time collapse → simultaneous states    | Delete "then/after"; describe current state only |

---

## Time Words as Emotional Triggers (时间词)

> Source: Lesson 11

Adding temporal state triggers AI's "time compensation mechanism":

**Past Tense ("Emotional Residue"):**

- `leftover, half-eaten, crumpled, worn, faded, abandoned, after`
- AI fills in logical aftermath details (wear, mess, decay)

**Present Continuous ("Decisive Moment"):**

- `mid-leap, straining, billowing, swirling, collapsing, surging, trembling`
- AI activates physics simulation: motion blur, edge softening, particles

**Future Tense ("Psychological Tension"):**

- `about to, impending, moments before, on the verge of, bracing for`
- AI renders the 0.1-second before the event — preparatory body language, negative space

---

## Perturbation Words (扰动词)

> Source: Lesson 6

Tokens with no clear visual meaning that alter attention weight distribution.

### Three Problems Solved

1. **Subject over-optimization** — perturbation bleeds off attention, renders more naturally
2. **Abstract word exaggeration** — interrupts AI's automatic embellishment
3. **Auto-completion of unspecified content** — consumes attention budget, protects subject priority

### Workflow

1. Write subject + basic lighting first ("主体先落地" — subject renders stably first)
2. Insert perturbation token after subject (priority separator)
3. Add atmosphere/filter words after perturbation ("抽象效果可控" — dispersed, prevents subject occlusion)
4. Generate at low intensity (recommended weight range: 0.3~0.9), compare, adjust
5. Multiple effect words need clear ordering ("多效果顺序清晰" — perturbation enforces generation priority)

---

## Word Trimming (剪词)

> Source: Lesson 7

"正向控框架，剪词控质量" — positive prompts control framework; pruning controls quality.

### Three Categories to Cut

1. **Cut Dirt (脏感)**: noise, grain, haze, meaningless flares
2. **Cut Plastic (塑料感)**: false highlights, unnatural sheen, metallic fabric
3. **Cut Fake Light (假光)**: floating glows, edge halos, sourceless light

### Three-Step Workflow

1. Write pure positive prompts with NO style inflation — avoid `"高清, super detailed, 8k, sharp face, 照片级, 超写实"`
2. Add grouped negative prompts by category (dirt-cutting, plastic-cutting, fake-light-cutting)
3. Treat negatives as PRE-structure, not post-fix — they shape the generation from the start

Core: "高端画面本质上是减法的结果" — high-quality images are fundamentally subtraction.

Reference: Broadbent's Attention Filter Model — "高级感不是堆满细节，而是干净简洁+主次明确+逻辑清晰" (premium = clean + clear hierarchy + logical).

---

## JSON Prompt Structure (JSON生图)

> Source: Lessons 14-15

### What JSON Actually Does

- Structural tool, not aesthetic — "industrial pipeline, not beauty filter"
- Reduces randomness, enforces logical priority among elements
- JSON is middleware for LLM interpretation, NOT direct image model input

### Three Misconceptions

1. JSON does NOT improve quality automatically (it organizes, not beautifies)
2. JSON cannot be fed directly to image tools (`{ } " :` treated as noise)
3. JSON does NOT replace creative thinking

### Anchor-First Priority

- `Subject_Core` field first (raw descriptors, non-negotiable)
- `Environment` field second
- `Style` field last
- Prevents "Style Glossing" (AI beautification overriding narrative)

---

## Hallucination Chain Reactions (幻觉链反应)

> Source: Lesson 12

### Three Stages & Countermeasures

**Stage 1 — Semantic Bias:** Place context words adjacent to ambiguous terms for aesthetic misreading
**Stage 2 — Auto-Completion:** Use high-weight visual anchors to force the associative chain into a single lane
**Stage 3 — Fabrication Explosion:** Place constraints at the END of prompt as "brake pad"

### Three Principles

1. Before AI misreads — give it "a beautiful wrong option"
2. While AI free-associates — build it a "one-way road"
3. When AI wants to over-add — call "Cut"

---

## What to Avoid

| ❌ Don't                                       | ✅ Instead                                      |
| ---------------------------------------------- | ----------------------------------------------- |
| Stack `8k, highly detailed, clean sharp focus` | Use atmosphere: `dust motes, atmospheric haze`  |
| Write `cinematic lighting` without a source    | Specify: `warm practical lamp from screen-left` |
| Use `beautiful, amazing, stunning`             | Describe specific visual details                |
| Describe emotional results                     | Describe physiological processes                |
| Use abstract concepts                          | Use concrete visual descriptions                |
| Overload one prompt with many actions          | One core action per prompt                      |
| Write `various` or `good-looking`              | Be specific about what and how                  |

---

## Duration × Prompt Strategy (时长 × 提示词策略)

Video clip duration fundamentally changes how prompts should be written. Longer clips need simpler, sustained prompts. Shorter clips can handle precise moment-capture.

### Duration Sweet Spots

| Duration            | Prompt Strategy                                                                                                                  | Example                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **2-4s**            | **Peak moment snapshot** — describe a single freeze-frame-worthy instant. Maximum detail, minimum temporal complexity.           | `glass shattering mid-air, liquid suspended in crystalline droplets, each fragment catching warm sidelight`         |
| **5-6s**            | **Single sustained action** — one clear movement from beginning to peak. Room for one camera movement.                           | `subject walks steadily forward through falling rain, coat collar pulled up, head slightly bowed against the wind`  |
| **8-10s**           | **Action + reaction** — one primary action with a natural consequence. Simpler prompt than 5s, paradoxically.                    | `figure pushes through heavy door into bright sunlight, pausing as eyes adjust to the light`                        |
| **10-16s**          | **Sustained state with micro-evolution** — describe an ongoing state that subtly shifts. Minimal action verbs.                   | `sitting alone at a window table, steam rising from a cup, city lights shifting outside, rain streaking down glass` |
| **16s+** (extended) | **Simplest possible prompt** — one subject, one sustained action, one environment. More words = more incoherence at this length. | `woman walking along a coastal path at sunset, wind in her hair, ocean waves below`                                 |

### Key Principles

1. **Inverse relationship**: longer clip = simpler prompt. AI models lose coherence when asked to maintain complex visual specifications over long durations.
2. **5s is the sweet spot** for maximum prompt complexity — detailed camera work, precise lighting, specific micro-actions all render well.
3. **Beyond 10s**: drop all secondary actions, satellite movements, and detailed atmosphere. Keep: one subject, one action, one environment.
4. **Speed modifiers compound duration**: `slow-motion-4x` on a 5s clip effectively needs prompting for a 1.25s moment. Write for the PERCEIVED duration, not the clock duration.

### Duration-Aware Word Budgets

| Duration | Recommended prompt length      |
| -------- | ------------------------------ |
| 2-4s     | 50-100 words (dense, detailed) |
| 5-6s     | 40-80 words (focused)          |
| 8-10s    | 30-60 words (selective)        |
| 10-16s   | 20-40 words (essential only)   |
| 16s+     | 15-30 words (minimal)          |

These are for the COMBINED final prompt (scene text + all preset prompts concatenated). Individual preset prompts should remain 1-3 sentences; the system should intelligently trim or prioritize when the concatenated total exceeds the budget for the target duration.

---

## Image-to-Video vs. Text-to-Video Prompting (图生视频 vs. 文生视频)

The prompt strategy differs fundamentally between text-to-video (t2v) and image-to-video (i2v) workflows.

### Text-to-Video (t2v)

Full scene description needed — the prompt is the ONLY input:

```
[Subject appearance] + [Action] + [Environment] + [Camera] + [Lighting] + [Style]
```

All 6 dimensions must be specified because the model has no visual reference.

### Image-to-Video (i2v)

The reference image already defines appearance, environment, lighting, and style. The prompt should describe **ONLY what changes**:

```
[Motion/Action ONLY] + [Camera movement if needed] + [Temporal quality]
```

#### i2v Rules

1. **DO NOT re-describe appearance** — the image already shows what the subject looks like
   - ❌ `a young woman with curly red hair in a vintage dress walks forward`
   - ✅ `walks forward with gentle steps, hair swaying slightly`

2. **DO NOT re-describe environment** — the image already shows the setting
   - ❌ `in a rainy Tokyo street at night with neon signs`
   - ✅ `rain intensifying, neon reflections rippling in growing puddles`

3. **Focus on DELTA** — what changes from the still image
   - `eyes slowly opening, chest rising with a deep breath`
   - `wind picking up, leaves beginning to scatter`
   - `camera slowly dollying in, background softening`

4. **Keep it short** — i2v prompts should be 15-40 words. The image carries most of the information.

5. **Specify temporal direction** — the model needs to know WHERE the action goes from the image:
   - `leaning forward` (from upright starting position in image)
   - `turning to look left` (from forward-facing position in image)
   - `smoke beginning to rise` (from still scene in image)

### Comparison

| Aspect             | t2v Prompt          | i2v Prompt            |
| ------------------ | ------------------- | --------------------- |
| Subject appearance | Required (detailed) | Omit (image provides) |
| Environment        | Required            | Omit unless changing  |
| Lighting           | Required            | Omit unless changing  |
| Style              | Required            | Omit (image provides) |
| Motion/action      | Required            | **Primary focus**     |
| Camera movement    | Required            | Include if needed     |
| Prompt length      | 50-100 words        | 15-40 words           |

### Multi-Image-to-Video (Keyframe i2v)

When generating video between two keyframe images (Lucid Fin's primary canvas workflow):

```
[Motion from Image A state to Image B state] + [Camera movement] + [Transition quality]
```

The prompt describes the JOURNEY between two known visual states:

- ✅ `subject gradually stands from seated position, turning to face the window, natural movement`
- ✅ `camera slowly orbiting clockwise, lighting shifting from warm interior to cool window light`
- ❌ `a woman in a red dress sits in a chair by a window` (this is Image A — already known)

---

## Anti-AI Realism: Breaking the "Perfect Photo" Look

> Source: super-i.cn Lesson 4 + Lesson 21

AI defaults to perfect studio photography: centered subjects, ideal lighting, flawless skin. Real footage has imperfections. These techniques break the "AI look."

### Device Simulation Keywords

| Keyword                                           | Effect                                            |
| ------------------------------------------------- | ------------------------------------------------- |
| `iPhone-style`                                    | Mobile phone naturalism instead of DSLR bokeh     |
| `candid shot` / `secretly photographed`           | Reduces subject "posing" behavior                 |
| `slightly shaky` / `softly blurred due to motion` | Adds handheld imperfection                        |
| `shot through wire fence` / `partially obscured`  | Foreground obstruction = observation authenticity |

### Film Stock Simulation

| Film Stock          | Character                         | Use Case                       |
| ------------------- | --------------------------------- | ------------------------------ |
| `Kodak Portra 400`  | Warm, natural skin tones          | Portraits, life                |
| `Fujifilm Pro 400H` | Cool-toned, blue-green emphasis   | Japanese aesthetic, landscapes |
| `Kodak Gold 200`    | Warm, saturated, retro            | Nostalgia, summer, street      |
| `Cinestill 800T`    | Night halation, dreamy highlights | Cinema, night scenes           |

### Rendering vs. Film

- Film stock keywords (`Kodak Portra 400 grain`) and 3D rendering keywords (`Octane Render`, `Unreal Engine 5`) are **mutually exclusive** — never combine them.
- Place style/texture keywords in the **second half** of the prompt as "润色" (polish) after subject and scene are established.

### Art Direction Anchors

- `Wes Anderson style` — symmetry, pastel palette, deadpan
- `Blade Runner 2049 aesthetic` — cyberpunk, high contrast, neon
- `Hiroshi Sugimoto` — minimalism, long exposure, vast negative space
- **Rule**: one style anchor per prompt. Don't stack.

### Aesthetic Modifier Keywords

| Keyword      | Effect                           |
| ------------ | -------------------------------- |
| `minimalist` | Clean, high-end, whitespace      |
| `brutalist`  | Concrete, geometric, cold        |
| `ethereal`   | Soft light, dreamlike            |
| `gritty`     | High contrast, raw, dark realism |

---

## De-Smoothing Camera Movement for Video

> Source: super-i.cn Lesson 21

AI video cameras are "too perfect" — mathematically smooth, omniscient, instant-tracking. Real cinematography has human artifacts. Three techniques to fix this:

### 1. Incomplete Starting Points

Don't let the first frame be a "finished photo." Break perfect composition:

- **Foreground obstruction**: `camera peeks through iron fence slats`, `partially blocked by doorframe`
- **Off-center composition**: `subject at edge of frame, drifting into center`
- **Discovery framing**: `camera finds the subject, adjusting focus mid-shot`

### 2. Operational Artifacts

Real operators have weight, breathing, hesitation:

- `decelerating push` — movement isn't constant velocity
- `micro-pause` / `brief hesitation` — operator processes what they see
- `handheld breathing tremor` — subtle shake from human body
- `footstep vibration` — camera bounces with walking

### 3. Delayed Tracking (延迟跟随)

Real cameras respond ~0.5 seconds late to subject movement:

- `camera reacts with a delay` — passive response
- `whip pan to catch up` — rushed tracking
- `subject briefly exits frame` — camera loses then finds subject

**Core principle**: make the AI camera "笨一点" (dumber) — it doesn't know where subjects are, can't perfectly stabilize, and responds half a beat late.

---

## Force-Reaction Physics Prompting

> Source: Runway Gen-4.5 + Kling 3.0 best practices

Modern video models function as physics simulators. Describe physical **forces and consequences**, not appearances:

### Force Language

- ❌ `car crash` → ✅ `heavy sedan at high velocity impacts concrete, hood crumples with resistance, glass shatters forward, chassis recoils`
- ❌ `wind blowing` → ✅ `gusts pulling fabric taut, hair whipping across face, leaves torn from branches`

### Motion Endpoints

Always specify where motion **ends**. Open-ended motion causes generation hangs:

- ✅ `hair gently moves in breeze, then settles back into place`
- ✅ `glass tips, liquid breaches rim, impacts table, milk expands outward`
- ❌ `hair blows in wind` (no endpoint — model doesn't know when to stop)

### Weight & Resistance

Add physical weight to make motion believable:

- **Heavy**: `dense, solid, weighted, momentum, resistance, inertia`
- **Light**: `delicate, floating, drifting, featherweight`
- **Interaction verbs**: `impacts, crumples, recoils, shatters, ripples, settles`

---

## Video Reverse Engineering (运动学解构)

> Source: super-i.cn Lesson 22

When recreating a reference video, extract motion parameters — don't describe what you see:

### Three-Frame Method

Extract three keyframes from the reference:

1. **Setup frame** — initial state before movement
2. **Climax frame** — maximum motion intensity
3. **Resolution frame** — post-action state

### Parameter Extraction

Convert visual observations into actionable specifications:

| Observation       | Vague prompt           | Parametric prompt                                                                       |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| Fast-moving shot  | `dramatic, fast-paced` | `Dolly Forward: Fast, Motion Blur: High, Speed: 2.0x`                                   |
| Soft camera drift | `gentle movement`      | `Slow truck right, 0.5x speed, minimal parallax shift`                                  |
| Subject pivoting  | `person turns around`  | `180-degree rotation over 3s, weight shifts to rear foot, hair follows with 0.3s delay` |

**Core shift**: from "wish-making" (hoping AI understands sentiment) to "programming" (providing actionable parameters).
