# Lighting & Atmosphere for AI Video Prompts

> Source: super-i.cn 提示词创作系列 + cinematography references

---

## Core Lighting Formula

> Source: Lesson 2

**Light = Direction × Contrast Ratio × Color Temperature**

**Direction:** Specify physical path — where light comes from, what it strikes, what shadow it creates

- ❌ `cinematic lighting, detailed portrait`
- ✅ `soft sunlight entering from the right window, lighting the subject's face, casting long shadows on the table`

**Contrast Ratio:** Specify bright and dark zones explicitly

- ✅ `strong contrast ratio, bright on face, dark background, deep shadow on left side`

**Color Temperature:** Emotional and temporal meaning

| Time  | Temperature | Mood          | Prompt                                 |
| ----- | ----------- | ------------- | -------------------------------------- |
| Dawn  | Cool        | Quiet, hazy   | `misty morning light, cool tone`       |
| Noon  | Neutral     | Clear         | `neutral daylight`                     |
| Dusk  | Warm        | Romantic      | `golden hour sunlight`                 |
| Night | Mixed       | Urban, lonely | `warm lamp light, cool ambient shadow` |

---

## Motivated Lighting (有源光)

Never write generic `dim lighting`. Always specify WHERE the light originates:

| ❌ Generic           | ✅ Motivated                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `dim lighting`       | `cold moonlight through left-side venetian blinds`                  |
| `warm light`         | `warm vintage desk lamp illuminating only half the subject's face`  |
| `dramatic lighting`  | `single overhead fluorescent tube, harsh shadows below eyes`        |
| `cinematic lighting` | `soft key from camera-left with gentle fill, rim light from behind` |

### Light-Shadow Boundary (明暗交界线)

The line between light and shadow on the subject expresses psychological state:

- Sharp boundary = tension, conflict, duality
- Soft boundary = gentleness, uncertainty, transition

---

## Indoor Lighting (室内光线)

> Source: Lesson 20

"You used outdoor lighting logic to write indoor lighting."

### Three Principles

**1. Anchor light to physical object (锚定实体法则)** — Ask: "Who is emitting the light in this room?"

- Name the emitter (window, lamp, candle) + casting action + receiving surface
- **Formula**: `[Scene description] + [Specific light-source entity] + [Light projection action] + [Receiving object]`
- Example: `"Afternoon sun entering through a gap in linen curtains, casting a sharp beam across a dusty wooden floor"`
- Example: `"Neon sign on a rain-wet window casting colored reflections across the interior walls"`

**2. Describe falloff path, not intensity (光影雕刻法则)** — Words like "soft," "weak," "bright" are low-weight signals to AI

- **Formula**: `[Subject action] + [Light start point (bright)] + [Light endpoint (falloff/disappearance)]`
- "Don't tell AI 'it's dark here' — tell it 'the light cannot reach here'"
- Decay vocabulary:
  - `Rapid falloff / High contrast falloff` → drama, tension
  - `Gradual fade / Soft gradient` → gentleness, calm
  - `Pool of light` → confined, isolated circle of illumination

**3. Describe bounce/reflected light (全局光照法则)** — Real interior photography uses 漫反射 (diffuse reflection), not direct projection

- **Formula**: `[Material environment] + [Key light striking surface] + [Reflected ambient color fill]`
- Key insight: when white sunlight hits a yellow floor, reflected ambient carries warm hue. Describing this color-temperature transfer massively increases realism.
- Matte/rough surfaces → soft diffuse reflection (warm/vintage feel)
- Glossy/polished surfaces → specular reflection (modern/tech/luxury feel)

---

## Cinematic Atmosphere (电影级氛围)

> Source: Lesson 32

### 1. Light & Contrast — Chiaroscuro, not mood adjectives

- ❌ `"sad atmosphere, depressing dark vibe, gloomy mood"` → AI applies global averaging
- Formula: `[large dark area] + [single specific light source] + [high contrast term]`
- Key terms: `absolute shadow`, `single directional source`, `Rembrandt lighting`, `film noir lighting`, `chiaroscuro`, `high contrast`

### 2. Color Temperature — ONE dominant key color, opposing temperature only as subtle accent

- ❌ Listing multiple colors simultaneously → causes "Color Pollution" (muddy mixing)
- Formula: `"The entire scene is dominated by [key color/mood light], only [specific minimal area] catches a subtle [secondary color/fill light]"`
- Control words: `dominated by`, `subtle`, `faint`, `only a hint of`
- Reference: 橙青调色 (orange-teal grading) for cinematic standard

### 3. Focus & Depth — blur is narrative, not defect

- ❌ `"highly detailed, sharp focus on everything, 8k, 16k, UHD"` → surveillance-camera aesthetic
- Subject sharp + background dissolved → isolation, intimacy ("the world is irrelevant to me")
- Environment sharp + subject blurred → overwhelmed, lost ("I am swallowed by the world")
- **Formula**: `[Lens/aperture parameter] + [Subject sharpness] + [Background bokeh/blur]`

### Master Atmosphere Formula (4-Zone Structure)

```
[Medium & Subject] + [Focus/Depth Zone] + [Light/Shadow Zone] + [Color Temperature Zone]
```

### Anti-Pattern Examples (What NOT To Write)

- ❌ `"A portrait of a man sitting in a room, sad atmosphere, depressing dark vibe, gloomy mood, highly detailed, 8k, masterpiece."`
- ❌ `"A cinematic shot of a girl in a cafe, warm sunlight, cool blue ambient light, rich colors, atmospheric lighting, highly detailed, 8k."`
- ❌ `"A lonely girl walking in a rainy city street at night, highly detailed buildings, sharp focus on rain drops, sharp focus on background, intricate neon signs, 8k, masterpiece."`

---

## Atmospheric Media (大气介质)

Real cinematography: light always travels through a medium. AI images without atmosphere have a "vacuum feel."

### Essential Atmosphere Terms

| Term                                  | Effect                            | When to Use                   |
| ------------------------------------- | --------------------------------- | ----------------------------- |
| `atmospheric haze`                    | Ambient softness, depth           | Outdoor, dusk, distance       |
| `dust motes floating and glowing`     | Quiet melancholy, passage of time | Indoor, golden hour, memories |
| `particles`                           | General atmospheric presence      | Any scene needing depth       |
| `volumetric light` / `Tyndall effect` | Visible light rays                | Forests, windows, fog         |
| `morning mist`                        | Low-hanging moisture              | Dawn, waterfront, mountains   |
| `smoke wisps`                         | Gritty atmosphere                 | Bars, factories, battlefields |
| `rain`                                | Emotional weight, isolation       | Drama, noir, melancholy       |
| `fog`                                 | Mystery, isolation                | Horror, thriller, dream       |
| `lens flare`                          | Warmth, nostalgia                 | Backlit scenes                |

### Fatal Mistakes

1. Stacking `8K, detail, clean sharp focus` — instructs AI to ERASE atmospheric particles (direct cause of plastic feel)
2. Writing `Tyndall effect` without a medium — light shafts look painted on
3. Writing `clean clear sky` — removes the air itself

### Atmosphere + Motion Tip

Floating glowing dust in a still image, when animated (Kling/Hailuo), sustains an emotionally resonant long take suitable for MV chorus sequences.

---

## Color & Color Grading (色彩/调色)

### HEX Color Grading Method (HEX调色法)

> Source: Lesson 38

Shift color control from post-processing to the generation stage:

1. **Extract palette** — Upload reference images → extract dominant HEX values → generate swatch card
2. **Feed color card** — Use swatch as visual reference input alongside text prompt
3. **Extend to video** — Use color-locked still as "first frame" (首帧) in video tool. Write ONLY motion in video prompt.

**Key principle**: For video prompts, `只写动作` (write only action/motion). Never describe lighting or color in the video prompt; the model propagates the first frame's color system.

### Data-Driven Color Grading (数据驱动型调色)

> Source: Lesson 23

The "AI look" comes not from poor prompting but from absent color grading. Semantic style tags (`"Wong Kar-wai style"`) get probability-averaged into mediocrity. **Replace vague aesthetics with measurable data.**

#### Aesthetic Dimensionality Reduction (美学降维)

Decompose any reference look into 4 measurable parameters:

| Parameter                         | What to Extract             | Example Value                  |
| --------------------------------- | --------------------------- | ------------------------------ |
| Hue Distribution (色相分布)       | Dominant + accent HEX codes | `#CBBFA2` (Arrakis dust beige) |
| Luminance Ratio (明暗比例)        | Key:fill ratio              | `16:1` highlight ratio         |
| Color Temperature Bias (色温倾向) | Kelvin offset from neutral  | `+2500K` warmer                |
| Saturation Mapping (饱和度映射)   | Per-zone saturation levels  | Extreme desaturation, matte    |

#### Parameter Embedding (参数嵌入法)

Embed extracted values directly as "data anchors" in natural language:

❌ **Wrong** — adjective-only:

> `"Cinematic shot, dark moody atmosphere, teal and orange style, very detailed."`

✅ **Right** — quantified anchors:

> `"IMAX ultra-wide, backlit silhouette at 16:1 highlight ratio, soft roll-off on sun. Volumetric haze, heavy dust. Monochromatic extreme desaturation — dominant hue Arrakis dust beige (#CBBFA2) and matte brown. Shadows: compressed deep charcoal with minimal teal bias. Bleach Bypass film grain, matte surface."`

**Negative prompt**: `saturated colors, blue sky, vivid elements, clear atmosphere, glossy finish, HDR style, sharp sun outline`

#### Closed-Loop AI Validation (闭环验证)

Human eyes are unreliable validators — the brain auto-corrects white balance after prolonged viewing. Use a multimodal AI as objective reviewer:

1. Upload **Image A** (your generation) + **Image B** (reference frame)
2. Ask AI to identify deviations across exposure, color temp, contrast
3. Use structured feedback to revise prompt:

| Deviation Type | Example Finding                  | Correction                |
| -------------- | -------------------------------- | ------------------------- |
| Exposure Bias  | -1.5 to -2.0 EV underexposed     | `Whites +40, Shadows +50` |
| Color Temp     | +2500K warmer than reference     | Shift color temp anchor   |
| Contrast       | Shadows artificially crushed -30 | Adjust shadow descriptor  |

4. Repeat until **≥95% color fingerprint match**

**Core principle**: "所有的'艺术感'最终都可以被拆解为'信息量'" — All aesthetic quality can ultimately be decomposed into information.

### Color Temperature Guide

| Temperature | HEX Range               | Mood                              |
| ----------- | ----------------------- | --------------------------------- |
| Warm/Golden | `#FF9500` – `#FFD700`   | Nostalgia, comfort, hope          |
| Cool/Blue   | `#205276` – `#4A90D9`   | Isolation, technology, melancholy |
| Neutral     | `#9BA8B8` – `#C0C0C0`   | Documentary, objective            |
| Teal-Orange | Complementary pairing   | Cinematic standard                |
| Red-shifted | `#8B0000` – `#FF4444`   | Danger, passion, anger            |
| Desaturated | Low saturation variants | Memory, dream, flashback          |

### Style-Specific Color References

| Style          | Color Approach                                              |
| -------------- | ----------------------------------------------------------- |
| Film Noir      | High contrast B&W, deep shadows, occasional warm highlights |
| Cyberpunk      | Neon magenta + cyan, deep blue shadows                      |
| Wes Anderson   | Pastel symmetry, warm yellows and pinks                     |
| Blade Runner   | Smoggy amber + blue neon                                    |
| Makoto Shinkai | Hyper-saturated blues and oranges, luminous clouds          |
| Wong Kar-wai   | Smoky greens, deep reds, grain                              |

---

## Lighting Setup Patterns

### Three-Point Lighting (described, not named)

```
Subject illuminated from front with soft fill light,
strong backlight creating a halo rim,
key light from 45° camera-left casting gentle shadows
```

### Single Source Drama

```
Single practical light from [source],
casting deep shadows on the opposite side,
subject half-illuminated
```

### Natural Golden Hour

```
Low-angle warm sunlight from behind subject,
lens flare, long shadows stretching forward,
golden particles floating in the backlit air
```

### Moonlit Night

```
Cold blue moonlight from above-right,
subject silhouetted against slightly brighter background,
atmospheric haze softening distant elements
```
