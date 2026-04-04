# Style, Texture & Aesthetics for AI Video Prompts

> Source: super-i.cn 提示词创作系列 + industry style references

---

## Visual Style Categories

### Cinematic Styles

| Style                 | Key Prompt Terms                                                                                    | Characteristics                              |
| --------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Hollywood Blockbuster | `cinematic, anamorphic lens flare, epic scale, IMAX`                                                | Wide shots, dramatic lighting, high contrast |
| Film Noir             | `high contrast black and white, deep shadows, venetian blind light, femme fatale`                   | Hard light, mystery, urban night             |
| French New Wave       | `handheld, natural light, jump cuts, casual framing`                                                | Documentary-feel, spontaneous                |
| Wes Anderson          | `symmetrical composition, pastel palette, flat lighting, centered framing`                          | Whimsical, precise, stylized                 |
| Wong Kar-wai          | `smeared neon reflections, step-printed motion blur, saturated reds and greens, expired film grain` | Moody, romantic, time-distorted              |
| Kubrick               | `one-point perspective, symmetrical, cold light, wide angle`                                        | Controlled, unsettling, precise              |

### Animation & Digital Styles

| Style              | Key Prompt Terms                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Makoto Shinkai     | `hyper-detailed clouds, luminous sky gradients, vivid blues and oranges, dust motes in golden light` |
| Studio Ghibli      | `hand-painted watercolor backgrounds, soft pastoral light, detailed nature, gentle wind movement`    |
| Pixar/3D Animation | `Pixar-style 3D animation, subsurface scattering, expressive character design`                       |
| Anime (general)    | `anime style, cel-shaded, dynamic action lines, vibrant colors`                                      |
| Rotoscope          | `rotoscope style, hand-traced over live footage, painterly line art`                                 |

### Photographic Styles

| Style              | Key Prompt Terms                                                                    |
| ------------------ | ----------------------------------------------------------------------------------- |
| Fashion Editorial  | `editorial photography, studio lighting, high-fashion pose, clean background`       |
| Street Photography | `candid, natural light, urban environment, decisive moment, grain`                  |
| Portrait           | `shallow depth of field, soft key light, catch light in eyes, bokeh background`     |
| Product/Commercial | `studio lighting, reflective surface, clean gradient background, product hero shot` |
| Documentary        | `available light, handheld, observational, unposed`                                 |

### Experimental & Surreal

| Style          | Key Prompt Terms                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Surrealist     | `surrealist, impossible geometry, melting forms, dreamlike atmosphere`                                                                                                                       |
| Cyberpunk      | `neon-soaked, rain-slicked streets, holographic displays, dystopian, cyan and magenta`                                                                                                       |
| Vaporwave      | `vaporwave aesthetic, pastel gradients, greek statues, glitch artifacts, 80s nostalgia`                                                                                                      |
| Y2K/Millennium | `Y2K aesthetic, brushed chrome, iridescent surfaces, cold blue grading, soft-focus halation, long exposure light trails, vintage CD cover composition, retro-futurist, chromatic aberration` |
| Brutalist      | `raw concrete, geometric shapes, monumental scale, harsh shadows`                                                                                                                            |

---

## Simulating Real Devices (模拟真实设备)

> Source: Lesson 4

### Anti-AI Device Behavior

- `iPhone-style` — removes DSLR perfection, adds phone realism
- `Candid shot` / `Secretly photographed` — naturalizes posture
- `Slightly shaky` / `Softly blurred due to motion` — breaks static rigidity

**Rules:**

- Never mix film stock + render engine terms (direct conflict)
- Use only ONE core aesthetic per prompt
- Place style/texture terms in the latter half
- "完美的照片是摆出来的，不完美的照片才是抓拍的生活" — Perfect photos are posed; imperfect photos are life caught in the act.

---

## Film Stock & Color Science References

| Film Stock         | Character                     | Prompt Term                        | Best Use                   |
| ------------------ | ----------------------------- | ---------------------------------- | -------------------------- |
| Kodak Vision3 500T | Warm, rich, tungsten-balanced | `Kodak Vision3 500T color science` | Cinematic warm             |
| Kodak Vision3 250D | Natural daylight, clean       | `Kodak Vision3 250D`               | Natural daylight           |
| Fujifilm Eterna    | Cool, muted, cinematic        | `Fujifilm Eterna color grading`    | Moody cinematic            |
| Kodak Portra 400   | Warm skin tones, soft         | `Kodak Portra 400 film`            | Portrait, lifestyle        |
| Fujifilm Pro 400H  | Cool, strong greens/blues     | `Fujifilm Pro 400H`                | Japanese style, landscapes |
| Kodak Gold 200     | Warm, high saturation, retro  | `Kodak Gold 200`                   | Street, summer nostalgia   |
| Ilford HP5         | Classic B&W, rich grain       | `Ilford HP5 black and white`       | B&W drama                  |
| CineStill 800T     | Tungsten halation, red halos  | `CineStill 800T halation`          | Night, film noir           |

---

## Texture & Material Terms

| Texture            | Prompt Terms                                                          | Use Case             |
| ------------------ | --------------------------------------------------------------------- | -------------------- |
| Film grain         | `subtle film grain`, `organic noise`, `16mm grain`                    | Warmth, organic feel |
| Digital noise      | `sensor noise`, `high ISO grain`                                      | Night, documentary   |
| Lens imperfections | `chromatic aberration`, `subtle lens distortion`, `barrel distortion` | Vintage, character   |
| Halation           | `halation around highlights`, `light bleed`                           | Dream, nostalgia     |
| Sharpness          | `razor sharp`, `clinical focus`                                       | Modern, technical    |
| Softness           | `slight soft focus`, `diffusion filter`, `Pro-Mist filter`            | Romance, beauty      |
| Anamorphic         | `anamorphic lens flare`, `horizontal blue streak`, `oval bokeh`       | Cinematic epic       |

### Physical Craft Textures

For breaking AI's digital feel, specify the **substrate material** before the subject:

| Craft               | Prompt Terms                                                                                  | Key Detail                                                     |
| ------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Cross-stitch        | `cross-stitch needlepoint on Aida cloth grid, dense colored cotton thread, X-shaped stitches` | Specify stitch density and thread thickness                    |
| Needle felt / Wool  | `needle felt wool doll, coarse mixed-color wool, fuzzy surface detail`                        | Name the material substrate (felt, wool roving)                |
| Embroidery          | `hand-embroidered on linen, satin stitch fill, visible thread sheen`                          | Describe shadow between stitch rows                            |
| Miniature / Diorama | `miniature diorama, tilt-shift photography, handmade craft aesthetic`                         | Add real-world imperfections (slight irregularity, glue marks) |
| Stop-motion         | `stop-motion animation, clay/plasticine figures, visible fingerprints on surface`             | Frame rate matters — low FPS (5-8) reads as authentic          |

**Key principle**: Name imperfections explicitly — real stitches have slight irregularity, thread sheen varies, shadows form between rows. These micro-details are what the brain uses to classify as "physical" rather than "rendered."

---

## Style Extraction (风格提取)

> Source: Lesson 17

### Three Steps

**1. Look for What Is Absent** — style is defined by deliberate exclusions

**2. Sample Purification** — supply 3+ images sharing visual DNA but different subjects; extract commonality

**3. System Building** — four-dimensional Style Guide:

- Space and Composition (framing, scale, perspective)
- Light and Atmosphere (sources, air quality, direction)
- Color and Texture (palette, grain, saturation)
- Negative Constraints (what must NEVER appear)

Core: "Style is not a list of descriptors — it is a set of repeated, deliberate exclusions."

---

## Feature Collapse (特征塌陷)

> Source: Lesson 10

Deliberately compressing non-subject features for artistic effect.

### Three Techniques

1. **Subtraction Aesthetics** — low-info backgrounds force detail collapse
2. **Feature Decay for Tension** — vocabulary between concrete/abstract → edges dissolve like smoke
3. **Local Reinforcement** — weight 1-2 visual anchors heavily, let everything else collapse

### Style Combinations

| Style               | Recipe                                                           |
| ------------------- | ---------------------------------------------------------------- |
| Emotional Portrait  | Background collapse + razor-sharp eyes + film grain              |
| Dreamcore           | Global feature decay + low contrast + VHS bloom                  |
| Cyber-Impressionism | Neon motion blur + color-block collapse + sharp foreground metal |

---

## Portrait De-Greasing (人像去油)

> Source: Lesson 18

AI's training bias toward ArtStation/Behance commercial imagery causes a default "greasy/plastic skin" look. Fix it by resetting three dimensions:

### 1. Material Downgrading (材质降维)

Move from describing how skin **looks** → how it **feels**.

| ❌ Kill List                  | ✅ Replace With                               |
| ----------------------------- | --------------------------------------------- |
| `perfect skin`, `smooth face` | `biological skin texture`, `uneven skin tone` |
| `8k resolution`, `soft skin`  | `subsurface scattering`, `fine peach fuzz`    |
| `beautiful complexion`        | `raw photograph`, `digital noise`             |

**Principle**: Effect-first → Material-first.

### 2. Lighting Downgrading (光照降维)

Force light as **physics**, not as **mood**.

| ❌ Kill List                              | ✅ Replace With                             |
| ----------------------------------------- | ------------------------------------------- |
| `cinematic lighting`, `golden hour`       | `harsh direct camera flash`, `hard shadows` |
| `soft diffused glow`, `dreamy atmosphere` | `Rembrandt lighting`, `harsh flashlight`    |

**Principle**: Emotion → Physics.

### 3. Sharpness Reset (锐度重置)

Redirect from digital-sharp renders → analog optical warmth.

| ❌ Kill List                    | ✅ Replace With                                                                |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `sharp focus`, `hyper detailed` | `soft optical focus`, `low contrast edges`                                     |
| (over-sharpening in general)    | `film halation around highlights` ⚡ **single most critical de-greasing term** |
|                                 | `Kodak Portra 400 grain`, `without over-sharpening`                            |

**Principle**: Digital-sharp → Analog optical.

### Summary

Stack all three resets together. The "greasy" look is not one problem — it's three defaults reinforcing each other (perfect material + mood lighting + digital sharpness). Breaking all three simultaneously forces the AI to produce authentic photographic texture.

---

## Robustness Breaking (鲁棒性破坏)

> Source: Lesson 8

Deliberately introducing controlled instability to escape AI's "statistically safest answer."

### Three Layers

1. **Composition Breaking** — displace center-point default
2. **Light Breaking** — destroy uniform formula lighting (add uneven illumination, spill, mixed temperature)
3. **Style Breaking** — introduce texture deviation, grain, edge imperfection

Stack all three for "relaxed, real, just-right disorder."

---

## Quality & Technical Modifiers

### Use Carefully

These modifiers have specific effects and should be used intentionally:

| Modifier          | Effect                             | When to Use                     |
| ----------------- | ---------------------------------- | ------------------------------- |
| `8K`              | Ultra-sharp, can remove atmosphere | Only when sharpness is priority |
| `highly detailed` | Forces fine detail                 | Texture-focused shots           |
| `photorealistic`  | Pushes toward photo-real           | When avoiding stylized look     |
| `cinematic`       | General film look                  | Baseline quality boost          |
| `raw`             | Unprocessed, natural               | Documentary, ungraded           |

### Negative Prompt Terms (What to Exclude)

| Term                | What It Prevents       |
| ------------------- | ---------------------- |
| `no watermark`      | Branding artifacts     |
| `no text overlay`   | Unwanted text          |
| `no distortion`     | Limb/face warping      |
| `no blur`           | Unintended motion blur |
| `deformed, mutated` | Body horror artifacts  |

---

## Aspect Ratio Impact on Style

| Ratio                | Feel               | Use Case                 |
| -------------------- | ------------------ | ------------------------ |
| 16:9                 | Standard cinematic | Default for most content |
| 2.39:1 (Cinemascope) | Epic, cinematic    | Action, landscape, drama |
| 4:3                  | Classic, intimate  | Period pieces, indie     |
| 1:1                  | Social, focused    | Instagram, album art     |
| 9:16 (Vertical)      | Mobile-first       | TikTok, Reels, Stories   |
| 2:1                  | Modern wide        | Netflix originals        |

---

## Environment Presets

### Interior Environments

| Setting            | Key Descriptors                                                               |
| ------------------ | ----------------------------------------------------------------------------- |
| Luxury Hotel Lobby | `marble floors, warm sconce lighting, crystal chandelier, muted conversation` |
| Abandoned Factory  | `rusted machinery, broken windows, shafts of dusty light, concrete`           |
| Modern Office      | `clean white surfaces, monitor glow, floor-to-ceiling windows`                |
| Cozy Café          | `warm wood tones, steam rising from cups, soft pendant lights, rain outside`  |
| Underground Club   | `neon red and blue, smoke haze, bass vibrations, crowded silhouettes`         |

### Exterior Environments

| Setting        | Key Descriptors                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| Urban Night    | `rain-slicked streets, neon reflections, passing headlights, steam from grates` |
| Forest Dawn    | `morning mist, shafts of golden light through canopy, dew on leaves`            |
| Desert         | `endless sand dunes, heat haze, burning sky gradient, harsh shadows`            |
| Snowy Mountain | `pristine white, blue shadows on snow, frosted breath, alpine clarity`          |
| Tokyo Street   | `crowded crosswalk, kanji signage, convenience store glow, umbrellas`           |
