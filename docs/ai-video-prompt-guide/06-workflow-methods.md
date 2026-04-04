# Production Workflow & Advanced Methods

> Source: super-i.cn 提示词创作系列 — techniques for iterating, debugging, and refining AI-generated imagery

---

## Fake Causality (假因果)

> Source: Lesson 13

Plant a fictional cause to force the AI to generate non-average effects.

### 1. State Causality

Replace action with ongoing state (implies elapsed time):

- ❌ "a girl running" → ✅ describe the state of having been running (sweat, fatigue, dishevelment)
- AI sacrifices "clean perfection" for real texture

### 2. Emotion as Filter

Strong emotional state auto-adjusts color temperature, contrast, framing:

- ❌ "sunny street" → ✅ "nostalgic" triggers desaturation, film grain, warm-yellow shift
- AI invents logical environmental details (wall marks, floor scratches)

### 3. Surreal Cause + Extreme Result

- Formula: `[extreme visual outcome] + [invented dramatic reason]`
- Fictional light source origin forces AI to violate normal physics

---

## Reverse Control via Prohibition (逆向控制)

> Source: Lesson 5

### Three Techniques

**1. Negative prompts override defaults** — AI auto-adds processing; use `--no` to forbid

**2. Decompose abstract words** into measurable visual instructions:

| Abstract | Replace With                                                  |
| -------- | ------------------------------------------------------------- |
| Dreamy   | `Low saturation + Soft diffused light + Telephoto lens`       |
| High-end | `Strong light contrast + Negative space + Clean composition`  |
| Texture  | `Subtle side lighting + High shadow contrast + Macro details` |

**3. Lock scene boundaries** — tighter boundaries = less AI improvisation

Core: "The more explicitly you prohibit, the more constrained AI becomes to authentic source material."

---

## Image Deconstruction (拆解画面)

> Source: Lesson 16

### Three Methods

**1. Lock the Invariant** — identify the ONE element whose removal would make the reference worthless

**2. Extract Structural Skeleton** — focus on composition, lighting logic, spatial relationship (not style words)

**3. Error-Verification Loop** — reverse-prompt → generate → compare → correct

**Formula:** `Perfect prompt = A (core invariant) + B (structural skeleton) + C (style modifiers)`
Conventional reverse-prompting only captures C.

---

## Reference Image Logic (参考图逻辑)

> Source: Lesson 19

"参考图不是许愿池，它是原材料仓库" — reference images are raw material warehouses, not wishing wells.

### Three Techniques

**1. Dimension Locking** — assign each reference to ONE feature dimension (low-frequency/high-frequency/semantic)

**2. Single-Channel Priority** — don't describe in text what the reference already carries visually

**3. Text-First Workflow:**

- Step 1: Blind Run (text only, iterate to ~70% structure)
- Step 2: Dimension Injection (one reference for one dimension)
- Step 3: Fine-tuning (adjust single dimension only)

---

## Reverse-Engineering Mental Images (反向破译)

> Source: Lesson 27

**1. Sensory-to-Visual Translation** — describe feelings to LLM; AI returns structured visual parameters

**2. Reference Image Micro-Expression Analysis** — upload approximation, AI extracts what you instinctively recognized

**3. Environmental Chain-Reaction** — shift from subject's action to environment's physical response

---

## Three-Step Precise Reproduction (精准复刻)

> Source: Lesson 31

**1. Reverse Interview** — put AI in interviewer mode (shot scale, composition, light, style questions)

**2. Logical Reorganization** — sort into tool-specific formulas:

- Image: `[subject] + [environment] + [composition/angle] + [light/color] + [style]`
- Video: `[subject motion] + [camera motion] + [environment motion] + [sustained atmosphere]`

**3. Contrast Calibration** — diagnose failures (locate → attribute cause → state target)

---

## Salvaging Failed Shots (废片价值)

> Source: Lesson 30

**1. Reuse lighting/composition** — save failed image as reference for good atmosphere

**2. Inpainting** — mask only broken area, describe only what should appear in mask

**3. Extract errors as negative constraints** — each failure becomes an error notebook entry

---

## AI Video Consistency (一致性攻略)

> Source: Lesson 24

### Three Dimensions of Control

**1. Asset Dimension** — Build "Neural Anchors" (神经锚点)

- Never combine character + scene + action in one prompt ("一锅炖" / one-pot stew = guaranteed inconsistency)
- Generate orthographic three-view reference (三视图): front, side, back
- Prompt template: `"Side view of a 3D stylized [character] running, full character reference sheet, model sheet, three-view turnaround, full body shot, front view, side view, back"`
- Upload all views into video tool's subject feature to create reusable "Character ID"

**Enhanced Asset Sheet Template** (16:9 layout):

```
[Style anchor], professional 3D character asset presentation sheet,
16:9 aspect ratio.
Left: detailed close-up bust portrait facing forward.
Right: full-body A-pose three-view turnaround —
  正视图 FRONT VIEW | 侧视图 SIDE VIEW | 后视图 BACK VIEW.
[Proportion spec: 8-head supermodel ratio for anime appeal].
Signature accessories arranged in negative space around figure.
High-fidelity, cinematic quality render.
```

**Proportion tip**: Without explicit spec, AI defaults to realistic 7.5-head proportions. For stylized/anime characters, specify `8-head body` or `超模身材` (supermodel proportions).

**2D-to-3D Visual Anchor**: Text prompts alone produce structurally random 3D geometry. Always supply a 2D reference image as anchor — then prompt only _departures_ from that reference, not full appearance reconstruction.

**2. Spatial Dimension** — Static definition, dynamic execution

- Generate character on plain background first
- Composite into environment separately
- Use composite as start frame + end frame
- "不要让视频模型去'设计'画面，只让它去'驱动'画面" — Don't let the video model design the frame, only drive it

**3. Time Dimension** — Fragment shots to counter 时间漂移 (temporal drift)

- Each additional frame compounds error exponentially
- High-fidelity sweet zone: **2-4 seconds per clip**
- Each clip = one core action (atomic shots)
- Edit together in post

**Summary formula**: Divide assets (lock visual variables) + Divide space (lock environment variables) + Divide time (lock randomness variables) = Control the variables

---

## Environment as Realism (环境决定真实)

> Source: Lesson 25

### Three Techniques

**1. Spatial Layering** — decompose scene into 3 planes

- Foreground: blurred obstructing elements (depth-of-field, presence)
- Midground: physical contact (boots in mud, hand on rock)
- Background: progressive fading, atmospheric haze

**2. Causal Logic** — don't stack nouns; connect with cause-and-effect verbs (_casting, reflecting, blocking, filtering through_)

- **Causal template**: "Because [X] blocks/causes [Y], [Z] results"
- Light causality: how plants block light, casting dappled shadows
- Material causality:
  - ❌ `"Cyberpunk street, raining, neon lights, puddles on the ground"`
  - ✅ `"Close-up of asphalt ground. Uneven potholes filled with dirty rainwater mixed with oil. Pink and blue neon signs reflected in puddles, distorted by ripples from falling raindrops and oily rainbow texture on water surface"`
- Time causality: `"Due to years of water leakage, orange rust streaks run down from metal bolts. Thick dust accumulated on horizontal surfaces; vertical surfaces remain clean"`
- Add flaw descriptors (lens dirt, scratches, uneven surfaces) — these are signals the brain uses to classify as photographic rather than CG

**3. Light + Weather as State** — describe what weather DOES, not labels

- ❌ "raining" → ✅ "mist rising from warm ground, soaked clothes clinging to body"
- ❌ "windy" → ✅ "trash flying, hair violently whipping across face"

---

## Director Thinking (导演思维)

> Source: Lesson 34

"做AI的导演，而不是打字员" — Be AI's director, not its typist.

### 1. Staging First (调度优先)

Set up the physical space before describing the subject:

- **Formula**: `[Foreground occlusion] + [Subject in midground] + [Background layer] + [Motivated light: origin, color, temp] + [Camera movement relative to foreground]`
- Z-axis depth, motivated lighting, and parallax camera are staging tools

### 2. Narrative First (叙事优先)

Every shot needs a core dramatic action, not a feature list:

- **Formula**: `[Core action/goal] + [Physical environment as obstacle] + [Physiological response] + [Single motivated camera behavior]`
- ❌ "girl crying in rain" → ✅ "girl frantically searching trash bin for discarded ring, hands cut, not stopping"
- One core verb escalation per scene, not adjective stacking

### 3. Editing & Reshooting (剪辑与补拍思维)

"把AI的直出当素材，用补拍建构节奏" — Treat AI output as raw material; build rhythm through reshooting.

- A-roll/B-roll assembly: 15s base long-take + 2s extreme close-up insert at emotional break + 3s B-roll cutaway
- Each AI generation is one shot, not the final film

---

## Breaking AI's Visual Defaults (重塑AI想象力)

> Source: Lesson 35

Three techniques for escaping "big film feel" sameness:

### 1. Break Physical Laws (打破物理规则)

- Anti-gravity, mass/volume paradox, inverted causality
- Example: `"A photorealistic polar bear holding a phone, sitting on a moss-covered boulder suspended mid-air, massive waterfall flowing upward against gravity, debris floating weightlessly"`
- **Image-to-video tip**: When converting physics-defying stills to video, write ONLY environmental motion (e.g., `"保持画面的失重状态。背景的瀑布水流持续向上倒流冲上云霄"`). Describing subject motion causes the model to "correct" physics back to normal.

### 2. Make Time Malfunction (时间故障)

- Temporal splitting: background = motion blur + time-lapse, subject = frozen in perfect stillness
- Action interruption: motion begins then freezes mid-gesture — creates psychological alertness

### 3. Make Camera a Character (镜头即角色)

- Giant-Descent POV: `"Extreme low angle, ant's POV looking up at..."`
- Object POV: `"First-person POV from inside a glass cup, looking up through water"`
- Eavesdropper: `"Camera hidden behind pillar edge, peering around corner at..."`

---

## Video Prompt Kinematics (运动学解构)

> Source: Lesson 22

Video is "continuous change of time and space parameters" — NOT "a picture that moves." A static screenshot contains zero information about T=1, T=2...T=n.

### Three-Frame Analysis (三帧定乾坤)

When reverse-engineering a reference video, extract three keyframes:

| Frame                       | Purpose                         |
| --------------------------- | ------------------------------- |
| **起始帧** (Setup, T=0)     | Calm state before action begins |
| **爆发帧** (Climax, T=peak) | Maximum motion and light change |
| **结尾帧** (Resolve, T=end) | State after motion concludes    |

Feed all three to a multimodal model with temporal reasoning to extract motion vectors — not aesthetics.

### Action + Parameter Format (动作+参数极简原则)

Replace vague emotional language with parameterized instructions:

| ❌ Vague/Emotional                   | ✅ Parameterized                               |
| ------------------------------------ | ---------------------------------------------- |
| `Camera pans across scene`           | `Camera Move: Pan Right / Horizontal Pan: +10` |
| `Extremely dynamic, violent motion`  | `Motion Weight: 8 / Chaos: 20`                 |
| `Time-lapse feel, fast light change` | `Speed: 2.0 / Lighting: Time-lapse`            |

### Critical Distinction: Dolly vs Zoom

| Movement              | Background Behavior                                       | Parameter       |
| --------------------- | --------------------------------------------------------- | --------------- |
| **推镜头 (Dolly In)** | Parallax — foreground/background shift at different rates | `dolly_forward` |
| **变焦 (Zoom In)**    | Scale only — no parallax                                  | `zoom_in`       |

Confusing these is "the difference between cinematic quality and a PowerPoint animation."

### Video Prompt Rules

**Include** (execution format):

- Camera movement type + direction
- Motion vectors with axis and magnitude
- Focal length / DOF changes (e.g., `f/2.8 → f/11`)
- Speed values, motion blur level
- Subject action as physics: trajectory, acceleration, spatial displacement

**Exclude** (废词 / invalid noise):

- Aesthetic adjectives: `"epic"`, `"majestic"`, `"full of tension"`
- Emotional metaphors: `"like a bird soaring over stormy seas"`
- Vague atmosphere: `"cinematic feel"`, `"hopeful mood"`

### Video Prompt Template

```
Subject: [physical description].
Action: [specific motion verb + direction].
Camera: [movement type]: [direction], [speed]. [DOF change if any].
```

Example:

```
Subject: Cyberpunk City Street, Neon lights.
Action: Hyper-lapse forward.
Camera: Dolly Forward: Fast, Motion Blur: High.
```
