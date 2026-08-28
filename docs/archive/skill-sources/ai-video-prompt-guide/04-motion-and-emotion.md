# Motion, Emotion & Narrative Techniques for AI Video Prompts

> Source: super-i.cn 提示词创作系列 + industry best practices

---

## Emotion Through Environment (环境替代情绪)

### Objective Correlative Principle

Project abstract inner emotion onto concrete weather, light, and environmental decay.

- ❌ `A young man standing in the room, looking very sad, crying, depressed, highly detailed`
- ✅ `Film-grade wide shot, solitary figure seated in dim empty apartment, back to camera, heavy rain on large glass window, blurred neon city lights beyond the rain, wilted potted plant on table, cold blue-grey palette`

**Rule**: 别让小人傻哭，让世界为他下雨 — Don't make the character cry; make the world rain for them.

### Environment-Emotion Mapping

| Emotion    | Environmental Cues                                                            |
| ---------- | ----------------------------------------------------------------------------- |
| Loneliness | Empty rooms, rain, cold blue light, wilted plants, distant city               |
| Joy        | Warm golden light, open spaces, blooming flowers, wind in hair                |
| Tension    | Narrow corridors, flickering lights, harsh shadows, tight framing             |
| Nostalgia  | Golden hour, dust motes, vintage objects, warm film grain                     |
| Dread      | Fog, darkness, dripping water, low rumble, extreme wide shot with tiny figure |
| Hope       | Dawn light, upward camera movement, clearing clouds, sprouting green          |

---

## Emotional Contrast (情绪对比)

### Kuleshov Effect

Emotion requires a reference point. If everything is high-intensity, nothing registers as high-intensity.

- ❌ Stacking same-emotion shots: tense → car chase → desk slam → argument = visual fatigue
- ✅ Extreme noise/crowding → CUT → absolute solitude/stillness

**Core insight**: Real loneliness is not crying alone in a dark room — it is feeling out of place in the middle of a celebration.

- **Shot A** (chaos): Dense crowd, loud party, packed frame
- **Shot B** (isolation): Single small figure in corner, quiet, minimal, stark contrast

### Emotional Montage (情绪蒙太奇)

> Source: Lesson 36

Three techniques for creating emotion through editing rather than performance:

1. **Environmental contrast** — juxtapose opposing emotional environments in sequence
2. **Rhythm disruption** — break established pace with sudden stillness or sudden chaos
3. **Scale shift** — cut from extreme close-up to extreme wide shot for emotional punctuation

---

## Micro-Expression Control (微表情控制)

### The "Expression Lock" Problem (表情锁定)

AI produces faces that are technically correct but lack natural variation. Strong emotion words like "Angry" or "Laughing" get reinforced frame-by-frame, causing 100% intensity expression lock — the "wax figure" problem.

- ❌ `"Beautiful woman smiling happily at the camera"` → frozen model smile
- AI lacks material physics for expressions — it hits the peak and holds it

### Process vs. Result (过程 > 结果)

Control specific physiological processes instead of naming emotional results:

| Body Part          | Process Description                                                               |
| ------------------ | --------------------------------------------------------------------------------- |
| Eyes (眼神)        | `iris in shallow focus, reflected light trembling`, `gaze drifting downward`      |
| Lips (嘴唇)        | `lower lip trembling almost imperceptibly`, `lips pressed tight`                  |
| Breathing (呼吸)   | `chest rising in shallow rapid breaths`, `one deep exhale visible`                |
| Eye sockets (眼眶) | `eye sockets reddening, moisture catching light`                                  |
| Hands (手)         | `knuckles whitening`, `fingers curling into palm`, `thumb rubbing ring nervously` |
| Jaw (下颌)         | `jaw muscles clenching and releasing`, `swallowing hard`                          |
| Nose (鼻翼)        | `nose wings flaring subtly`, `nostrils contracting`                               |

### Precise Micro-Expression Control

> Source: Lesson 29

**1. Limit Emotional Intensity (降维)** — replace broad emotion words with micro-modifiers

- **Formula**: `[Subject] + [Micro-modifier] + [Expression] + [Body state]`
- Micro-modifiers: `"a faint trace of"`, `"slightly"`, `"barely perceptible"`

**2. Action-Causation Drives Expression** — real expressions are byproducts of body movement, not standalone events

- **Formula**: `Body micro-movement + gaze shift = authentic micro-expression`
- **Causal chain**: `[Triggering event] → [Physical micro-action] → [Resulting expression]`
- ❌ `"The woman is shy and looking directly at the camera"`
- ✅ `"She feels shy, immediately lowers her head to avoid eye contact, eyes cast downward, tucks chin, lightly bites lower lip, cannot look at the camera"`

**3. Time-Sequenced Emotional Arc** — `Start state → Transition action → End micro-expression`

- Example "relief": Start: maintains serious contemplative expression → Transition: closes eyes, takes a deep visible breath → End: faint relieved smile slowly forms
- The smile is earned by the breath, not pasted on

Core: "少即是多，动即是稳" — less is more, motion creates stability.

---

## Anti-Artificiality Techniques (消除假人感)

AI-generated people often look "plastic" or "uncanny." These composition-level strategies reduce artificiality without requiring better models:

### 1. Face Occlusion (挡住脸)

AI struggles most with faces. Compositions that naturally obstruct facial detail eliminate the primary source of artificiality:

- `hand partially covering face`, `hair falling across eyes`
- `subject looking away from camera`, `back to camera`
- `mirror selfie with phone covering face`
- `silhouette framing`, `backlit with face in shadow`

### 2. POV / Mirror Framing for Naturalism

Referencing known human recording behaviors inherits authenticity:

- `mirror selfie composition` — implies handheld, imperfect angle, reflection logic
- `POV shot from inside [object]` — constrained perspective forces realism
- `security camera angle`, `webcam perspective` — low-quality framing signals authenticity

### 3. Mobile Aspect Ratio as UGC Signal

`9:16 vertical` carries implicit user-generated content associations. Mobile-native framing shifts AI output toward naturalistic rather than produced aesthetics.

### 4. Environmental Anchoring

Surround the subject with specific, concrete environmental details. Named surfaces, lighting conditions, and spatial cues give the model more real-world signals to anchor against:

- ❌ `a woman in a room`
- ✅ `a woman leaning against a rain-streaked window, condensation on glass, dim fluorescent light from the hallway behind her`

### 5. Material/Texture Specificity

Name fabric behavior and tactile qualities for clothing:

- ❌ `wearing a dress`
- ✅ `linen dress fabric responding to movement with subtle sway, visible weave texture`

---

## Multi-Character Control (多角色控制)

> Source: Lessons 37

### Why Multi-Character Fails

Two technical root causes:

- **算力偏移 (Compute drift)**: Model attention budget splits unevenly — one character gets over-rendered, others deteriorate
- **动作稀释 (Action dilution)**: Multiple simultaneous actions compete for the same latent space, producing merged/chimeric poses

### Spatial/Temporal Segmentation

When multiple characters share a scene, use structural labels instead of natural-language connectives:

- ❌ `"在一个咖啡厅里，左边的男人正在喝咖啡，同时右边的女人在开心地跳舞，接着男人站起来鼓掌。"`
- ✅ Use explicit spatial anchors: `Left side: [character A description + action]. Right side: [character B description + action]`
- ✅ Use time-segment labels for video: `[0-3s]: Character A action. [3-6s]: Character B action`

**Principle**: AI understands time-axis labels far more precisely than `then`, `next`, `simultaneously`.

### Semantic Video Editing (语义级视频编辑)

When modifying one character's action in an existing video:

- Always name what to KEEP, not just what to change
- **Formula**: `保持[右侧角色/环境/光影]完全不变，仅将[左侧角色]的动作改为[目标动作描述]`
- English: `"Keep [right character / environment / lighting] completely unchanged, only modify [left character]'s action to [target action]"`
- Without naming what to preserve, model defaults to full global redraw

---

## Multi-Stage Shot Relay (分段拍摄)

### Why Single-Shot Fails

Forcing all action into one wide static shot = surveillance-camera look. No tension, no micro-expressions.

### Director's Multi-Stage Approach

```
Stage 1 (Close-up — emotional setup):
  Generate still image first.
  Capture pre-action micro-details.
  "Face close-up. Left side: woman's eye sockets reddening,
   hair strands drifting in breeze, hand clutching an old train ticket."

Stage 2 (Medium shot — action burst):
  Switch framing, increase pace.
  Tracking shot of character breaking into motion.

Stage 3 (Wide shot — climactic freeze):
  Slow-motion upgrade shot.
  "Full wide shot, slow motion. Two figures embrace at center of platform,
   vintage train roaring past beside them, strong wind lifting her skirt hem."
```

### Background Continuity

Don't obsess over pixel-perfect background matching between stages. Just maintain `unified environment description` in each prompt. Viewers' visual attention locks onto character motion and camera movement; minor background variation is filtered by the brain.

---

## Creative Motion Frameworks

### 1. Breaking Physical Laws (打破物理规则)

| Effect           | Prompt Terms                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Reversed gravity | `Anti-gravity`, `Flowing upwards`, `Waterfall flowing skyward`                             |
| Floating objects | `Levitating`, `Floating subtly`, `Weightless debris floating in mid-air`                   |
| Mass paradox     | `Subtly levitating`, `Floating slightly above ground`, `Broken foundation visible beneath` |

**Formula**: `Subject + normal environment + abnormal physical state (core) + surrealist style + cinematic lighting`

**Video tip**: Use image-to-video (first frame). Keep motion prompt minimal — describe only environmental dynamics to prevent model from "correcting" physics back to normal.

### 2. Time Malfunction (时间故障)

| Technique           | Description                                                                  |
| ------------------- | ---------------------------------------------------------------------------- |
| Temporal Splitting  | Background = motion blur + time-lapse. Subject = frozen in perfect stillness |
| Action Interruption | Motion begins, then freezes mid-gesture. Creates psychological alertness     |

### 3. Camera as Character (镜头即角色)

| Technique         | Prompt Prefix                                                        |
| ----------------- | -------------------------------------------------------------------- |
| Giant-Descent POV | `Extreme low angle, ant's POV looking up at...`                      |
| Object POV        | `First-person POV from inside a glass cup, looking up through water` |
| Eavesdropper      | `Camera hidden behind pillar edge, peering around corner at...`      |

---

## Editorial Rhythm (剪辑节奏)

### Three-Element Rhythm Structure

```
Master shot (基础/A-roll) + Close-up insert (突刺/B-roll) + Cutaway (留白) = controlled breathing
```

1. **Generate Master Shot** — Base action sequence
2. **Find Emotional Break Point** — Cut at the pivot frame
3. **Generate Insert** — Extreme close-up of the emotional detail (2s)
4. **Generate Cutaway** — Environmental detail shot (3s)
5. **Hard-cut** insert and cutaway into master shot at break points

### Pacing Descriptors

| Speed    | Terms                                        | Mood                          |
| -------- | -------------------------------------------- | ----------------------------- |
| Slow     | `slow motion`, `升格`, `languid pace`        | Contemplation, beauty, weight |
| Normal   | `natural pace`, `real-time`                  | Documentary, observation      |
| Fast     | `rapid cuts`, `quick succession`, `whip pan` | Urgency, chaos, excitement    |
| Variable | `speed ramp`, `sudden freeze`                | Impact, emphasis              |
