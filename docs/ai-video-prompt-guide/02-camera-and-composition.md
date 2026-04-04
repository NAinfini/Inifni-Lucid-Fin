# Camera, Lens & Composition for AI Video Prompts

> Source: super-i.cn 提示词创作系列 + industry references

---

## Shot Types (景别)

| Shot                      | English Terms                            | Use Case                        |
| ------------------------- | ---------------------------------------- | ------------------------------- |
| 远景 (Extreme Wide)       | `Extreme wide shot`, `establishing shot` | Scene setting, scale, isolation |
| 全景 (Wide)               | `Wide shot`, `full shot`                 | Full body + environment         |
| 中景 (Medium)             | `Medium shot`, `mid shot`                | Waist-up, dialogue, action      |
| 近景 (Medium Close-up)    | `Medium close-up`                        | Chest-up, emotional detail      |
| 特写 (Close-up)           | `Close-up`                               | Face, emotional intensity       |
| 大特写 (Extreme Close-up) | `Extreme close-up`, `macro close-up`     | Eyes, hands, micro-details      |

### Extreme Close-up for Emotion (强制注意力)

At peak emotional moments, don't write `a man`. Open with extreme shot scale + body part + micro-action:

- **Suppressed rage**: `Extreme close-up of knuckles whitening, fingers pressing into surface`
- **Fear**: `Extreme close-up of iris in shallow focus, reflected light trembling`
- Benefit: micro/macro framing is more physically stable for AI models

---

## Camera Angles (角度)

| Angle      | English Terms                             | Emotional Effect                |
| ---------- | ----------------------------------------- | ------------------------------- |
| 平视       | `Eye-level shot`                          | Neutral, objective              |
| 仰拍       | `Low angle`, `worm's-eye view`            | Power, dominance, awe           |
| 俯拍       | `High angle`, `bird's-eye view`           | Vulnerability, overview         |
| 斜角       | `Dutch angle`, `canted angle`             | Unease, tension, disorientation |
| 蚂蚁视角   | `Ant's POV`, `extreme low angle`          | Giant-scale, sci-fi awe         |
| 物体内视角 | `First-person POV from inside a [object]` | Unique constrained perspective  |

### Angle + Focal Length Combinations

| Goal                | Combination                |
| ------------------- | -------------------------- |
| Natural documentary | `eye-level + 35mm + f2.8`  |
| High-end portrait   | `low-angle + 85mm + f1.8`  |
| Dramatic/artistic   | `high-angle + 50mm + f5.6` |

Core: Tell AI where the photographer stands and at what angle.

### Creative Angle Techniques

- **Giant-Descent POV (巨物降临)**: `Extreme low angle, ant's POV looking up at...`
- **Constrained Object POV**: `First-person POV from inside a glass cup, looking up through water`

---

## Composition Control (构图控制)

> Source: Lesson 1

### Subject Positioning (主体位置)

- AI defaults to center composition — orderly but powerless
- Rule of Thirds: position subject at grid intersections
- Formula: `subject positioned at [left/right] one-third of the frame`
- Core rule: "主体偏离，画面才有深度" — offset subjects produce depth

### Visual Leading Lines (视觉动线)

- Use concrete elements (roads, light, gaze, railings) to guide the eye
- Formula: `leading lines from foreground toward the subject`
- Key terms: `leading lines`, `vanishing perspective`, `diagonal light guiding viewer's eye`

### Asymmetric Balance (非对称平衡)

- Balance ≠ symmetry; it's visual weight distribution
- Counterweights: light/shadow, object, color contrast, architecture
- Formula: `balanced by [element] on the opposite side`

### Narrative Composition (构图叙事)

> Source: Lesson 26

Three principles: Rule of Thirds (subject offset) + Leading Lines (eye guidance) + Visual Weight Balance (asymmetric counterweight).

Universal formula: `[composition method] + [subject & position] + [environment & leading lines] + [light/style/balance]`

### Master Template

```
[subject], positioned at [left/right/top/bottom] one-third,
[leading lines / light direction] guiding toward subject,
[balance element], [lighting], [environment], --ar 3:4
```

---

## Camera Movements (运镜)

| Movement | English Terms                       | Effect                    |
| -------- | ----------------------------------- | ------------------------- |
| 横摇     | `Pan left/right`                    | Survey, reveal            |
| 纵摇     | `Tilt up/down`                      | Scale reveal, dramatic    |
| 推       | `Dolly in`, `push in`               | Intimate, focus           |
| 拉       | `Dolly out`, `pull back`            | Reveal context, isolation |
| 横移     | `Truck left/right`, `lateral dolly` | Parallax, depth           |
| 跟       | `Tracking shot`, `following shot`   | Action, pursuit           |
| 升降     | `Crane up/down`, `jib`              | Grand reveal, overview    |
| 环绕     | `Arc shot`, `orbit`                 | 360° character study      |
| 手持     | `Handheld`, `slight handheld shake` | Documentary, urgency      |
| 稳定器   | `Steadicam`, `gimbal shot`          | Smooth tracking           |

### Compound Movements

- **Dolly Zoom (Vertigo Effect)**: `dolly out while zooming in` — unsettling perspective shift
- **Arc Track**: `tracking with slight orbit` — dynamic movement around moving subjects
- **Crane Pan**: `rise vertically while panning` — reveal expansive landscapes
- **Push-In Tilt**: `move forward while tilting up` — dramatic building/character reveals
- **Parallax Truck**: `truck right, foreground elements (blinds) and background (bookshelves) move at different speeds`

### Parallax Camera Movement (视差运镜)

- ❌ Simple `Pan right` or `Zoom in` — only stretches a 2D plane
- ✅ Combine movement with layered space: `Truck right, camera passes behind foreground blinds, background bookshelves shift at different speed`
- Physical parallax breaks the posed/static feel immediately
- **Image-to-video parallax tip**: For i2v with foreground occlusion, use a short motion prompt like `"镜头微微向前推进，掠过柱子"` (camera gently pushes forward, passing the pillar). This produces natural "naked-eye 3D" parallax.

---

## Camera Movement Logic for Video (运镜逻辑)

> Source: Lesson 21

### Three Methods to Eliminate Posed Feel

**1. Refuse the God's Eye View** — start with imperfect framing

- Foreground obstruction, off-center composition, peeking view
- Formula: `[Initial incomplete state] + [Camera movement] + [Final settled framing]`

**2. De-smooth the Camera** — introduce human imperfection

- Decelerating push, micro-pause, handheld shake
- Give the virtual camera physical weight and body

**3. Invert Time Relationship** — camera reacts AFTER subject moves (~0.5s delay)

- Delayed tracking, reactive framing
- "Briefly out of frame" — subject escapes frame because action was too fast
- "This sense of losing control is the ultimate weapon for breaking the AI illusion"

---

## Kinematics Deconstruction (运动学解构)

> Source: Lesson 22

### Three Techniques for Video Reverse-Engineering

**1. Three-Frame Temporal Sampling** — extract Setup (T=0) + Climax + Resolve
**2. Camera Motion Vector Analysis** — distinguish dolly (parallax) vs. zoom (scale only)
**3. Parameterization** — convert emotional prose to execution format:

| Emotional                  | Parameterized                                  |
| -------------------------- | ---------------------------------------------- |
| "Camera pans across scene" | `Camera Move: Pan Right / Horizontal Pan: +10` |
| "Intense, violent motion"  | `Motion Weight: 8 / Chaos: 20`                 |

---

## Lens References (镜头参考)

Naming a real lens causes AI to draw on its optical data, producing natural bokeh:

| Lens                      | Character                                                    |
| ------------------------- | ------------------------------------------------------------ |
| `Leitz Summilux-C`        | Creamy, dreamy bokeh                                         |
| `Cooke S4`                | Warm skin tones, gentle falloff ("Cooke Look")               |
| `Panavision C-Series`     | Anamorphic, oval bokeh, blue streak flares                   |
| `Arri/Zeiss Master Prime` | Clinical sharpness, clean bokeh                              |
| `Canon FD`                | Vintage, warm, slight chromatic aberration                   |
| `Helios 44`               | Swirling/rotational bokeh (八羽怪), vintage Soviet rendering |
| `Petzval`                 | Strong vignette, swirling bokeh, painterly edges             |
| `Hawk V-Lite`             | Vintage anamorphic flare character, warm                     |
| `Lensbaby`                | Selective focus, creative tilt distortion                    |

**Key insight**: Equipment names are style encoders — `Helios 44` doesn't just signal "vintage lens," it activates swirling bokeh patterns from real optical training data. Specifying bokeh _character_ (round vs oval vs swirling) produces meaningfully different outputs.

---

## Z-Axis Depth (纵深三层)

Every prompt should define three spatial layers:

```
Foreground (遮挡物) → Middle Ground (主体) → Background (环境)
```

Example:

```
Through heavily blurred tropical banana leaves [foreground],
a woman in a silk dress makes a tense phone call [mid-ground],
dim luxury hotel lobby with warm sconce lighting [background]
```

---

## Foreground Occlusion Techniques (前景遮挡)

> Source: Lesson 39

### Physical Foreground

Objects between camera and subject create depth:

- `textured marble pillar silhouetted edge`
- `tropical banana leaf, heavily blurred`
- `door frame edge`, `window frame`
- `chain-link fence, shallow DOF`

### Atmospheric Foreground

Making air itself visible:

- `dust motes floating and glowing` — Shinkai-style soul element
- `atmospheric haze`
- `particles catching light`
- `rain droplets on lens surface`
- `morning mist hanging at waist level`

### Why Physical Foreground Works

AI by default renders a "floating omniscient eye." Adding foreground forces Z-axis depth calculation, creating 3D effect on 2D canvas. The foreground element is not just a barrier — it's a narrative "screen" implying the viewer is positioned somewhere physical.

---

## Pseudo-Perspective (伪透视)

> Source: Lesson 9

### Three Spatial Tricks

**1. Linear Extension (方向词)** — plant invisible trend lines

- Key terms: `stretching`, `converging lines`, `vanishing point`, `receding`

**2. Atmospheric Perspective (密度词)** — "describe the air, not the environment"

- Key terms: `layered fog`, `volumetric lighting`, `atmospheric depth`, `foreground bokeh`

**3. Forced Perspective (尺度词)** — exaggerated scale contrast

- Key terms: `tiny silhouette`, `gigantic`, `worm's-eye view`, `overwhelming scale`

### Ready-to-Use Formulas

```
Infinite Extension: [Subject] + [linear guides] + [vanishing point] + [wide-angle]
Colossal Pressure: [Tiny subject] + [massive object] + [upward angle] + [scale words]
Atmospheric Depth: [Foreground occlusion] + [midground subject] + [layered fog] + [blurred background]
```

---

## Lens-Emotion Matching (镜头情绪匹配)

> Source: Lesson 33

### Dimension 1: Shot Size = Psychological Distance

**Long shot** — "情绪去参与化" (emotional de-participation). The viewer sees the character as a visual element, not a protagonist. Produces loneliness, insignificance, scale.

- Example: `"Extreme wide shot, tiny solitary figure on a vast empty salt flat, dramatic clouds overhead, figure barely distinguishable from the landscape"`
- ⚠️ Don't use for: extreme joy, intimate connection, or scenes requiring facial empathy

**Medium shot** — social distance, stable narrative. The "conversation range."

- Example: `"Medium shot, two figures seated across a small café table, warm overhead pendant light, eye-level framing, 50mm lens"`
- ⚠️ Don't use for: emotional collapse, overwhelming awe, or isolation

**Close-up** — forced empathy, tension, pressure. The audience has no escape from the emotion.

- Example: `"Extreme close-up of iris in shallow focus, reflected trembling light, barely perceptible moisture gathering at lower eyelid"`
- ⚠️ Don't open with ECU tears without prior emotional setup — it reads as melodrama, not genuine emotion

### Dimension 2: Focal Length = Spatial Pressure

| Range                | Emotional Language                            | Use Cases                                                                            | Anti-AI Insight                                               |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| 8-14mm Ultra-Wide    | Grotesque, surveillance, psychedelic          | Cyberpunk upshots, CCTV angles, surreal distortion                                   | Near-large/far-small distortion triggers subconscious unease  |
| 24-35mm Wide         | Presence, freedom, environmental storytelling | Epic landscapes, vlogs, documentary, leg elongation                                  | Natural for establishing character in world                   |
| 50mm Standard        | Calm, objective, everyday                     | **Removes "AI over-effort" artificiality** — the most important anti-AI-plastic lens | Forces AI to stop beautifying; produces human-eye perspective |
| 85mm Portrait        | Elegant, focused, commercial                  | Fashion, beauty, product, flattering compression                                     | Standard AI default — use others to break sameness            |
| 135-200mm+ Telephoto | Voyeurism, isolation, fateful distant gaze    | Wong Kar-wai style, sports telephoto, neon bokeh walls                               | Background compression creates dreamlike separation           |

### Dimension 3: Unified Spatial Logic

"景别、焦段、构图、光影，必须服务于同一个物理目标和情绪目标"
All elements must serve the same physical AND emotional goal. Contradictory optical properties produce patchwork results.

**Common contradiction errors:**

- ❌ Wide-angle lens + intimate emotion = spatial distortion fights the closeness
- ❌ Telephoto compression + environmental storytelling = background too compressed to read
- ❌ Close-up framing + establishing context = can't show the world you're trying to establish
- ❌ `远景 + 浅景深 + 广角 + 背景压缩` simultaneously = physically impossible combination → "透视混乱、边缘抠图感极强" (chaotic perspective, hard edge cutout feel)

### Style-Specific Camera Recipes

| Style                        | Shot Size    | Focal Length        | Key Elements                                                                             |
| ---------------------------- | ------------ | ------------------- | ---------------------------------------------------------------------------------------- |
| Wong Kar-wai (王家卫)        | Medium-Close | 135-200mm telephoto | Space compression, isolated protagonist in crowd, step-printed motion blur, smeared neon |
| Wes Anderson (安德森)        | Medium       | 50mm centered       | Symmetric composition, pastel tones, flat lighting, precise framing                      |
| Makoto Shinkai (新海诚)      | Medium       | Standard            | Sunset light, luminous rays, dust motes, cinematic anime still                           |
| Cyberpunk (赛博朋克)         | Wide         | 8-14mm ultra-wide   | Low-angle upshot of mega-structures, neon, rain reflections                              |
| War Documentary (战地纪录片) | Variable     | 135mm telephoto     | Space-folding, shallow DOF locking one sharp subject in chaos, grain                     |

### Film Stock as Anti-AI-Digital Modifier

Specifying a real film stock forces AI away from its clean digital default:

| Film Stock           | Visual Character                 | Best For               |
| -------------------- | -------------------------------- | ---------------------- |
| Kodak Portra 400/800 | Warm tones, soft grain           | Realistic portraits    |
| CineStill 800T       | Red halation halos around lights | Night scenes, noir     |
| Fujifilm Eterna      | Low saturation, muted            | Documentary, moody     |
| Fujifilm Superia     | Rough grain, gritty              | War/street reportage   |
| Kodak Vision3 500T   | Heavy grain, city warmth         | Urban night cinematics |
