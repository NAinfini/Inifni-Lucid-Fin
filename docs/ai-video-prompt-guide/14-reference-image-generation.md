# Reference Image Generation Prompts

## Overview

Reference images lock durable identity for characters, equipment, and locations. Every downstream shot leans on them, so the goal is a sheet the model and the pipeline can both reuse — not a dramatic hero frame.

Each entity has exactly one primary reference-image slot (plus an `extra-angle` escape hatch for rare custom views). The old per-angle slot sets (`main`/`back`/`left-side`/`right-side`/`face-closeup`/`top-down`, etc.) survive only as DB-migration aliases; do not ask the agent to generate them.

## Research Sources

- [Character Turnaround Best Practices](https://spines.com/character-turnaround)
- [AI Character Turnarounds with Scenario](https://www.scenario.com/blog/generate-character-turnarounds-scenario)
- [Multi-Angle Reference Sheets](https://editor-dev.opencreator.io/blog/ai-character-reference-sheet)
- [AI Character Consistency Guide 2026](https://www.cinemadrop.com/blog/how-to-create-consistent-ai-characters-the-complete-guide-for-ai-filmmakers-in-2026)
- [Character Turnarounds by Elbert Gu](https://lbrtgu.com/new-blog/2026/2/7/character-turnarounds)

## Character — `full-sheet`

### Purpose

One composite sheet that carries the full-body turnaround AND a compact expression set. Used as the identity anchor for every downstream character shot.

### Layout

- Exactly two rows × three columns = six panels total.
- Row heights are NOT equal. Top row ~70% of sheet height, bottom row ~30%.
- **Top row (tall, full-body, identical scale, head-to-toe, feet grounded, no crop):** column 1 front view, column 2 left profile, column 3 rear view.
- **Bottom row (shorter, head-and-shoulders, shoulders included, direct gaze):** column 1 neutral, column 2 happy, column 3 angry.
- Solid white background, flat even studio lighting, single character only, no environment, no props unless part of the costume, no cast shadows.
- **Do NOT** ask for more panels. 10-panel layouts (4 full-body + 6 expressions) collapse: the model drops the full-body row and returns only the expression grid.

### Default Prompt Template

```
Character turnaround and expression sheet, {CHARACTER_DESCRIPTION},
two rows and three columns, six panels total, separated by thin neutral gutters,
row heights NOT equal — top row occupies roughly 70% of the sheet height, bottom row roughly 30%,
top row (three tall full-body panels at identical scale, head-to-toe, feet grounded, no cropping,
arms slightly away from the body): column 1 front view, column 2 left profile, column 3 rear view,
bottom row (three shorter head-and-shoulders expression panels, shoulders included, direct gaze):
column 1 neutral, column 2 happy, column 3 angry,
solid white background, flat even studio lighting, single character only, no props unless part of the costume,
every panel shows the exact same wardrobe, silhouette, proportions, hairstyle, colors, and identifying details
```

### Negative Prompt

```
blurry, inconsistent lighting, different characters, cropped limbs, waist-up only,
single view only, action pose, extra props, scene background clutter,
equal row heights, dropped top row, dropped bottom row, more than six panels
```

### Settings

- **Aspect ratio:** 3:2 or 4:3 landscape (give the top row vertical room).
- **Providers:** Google Imagen 4, OpenAI gpt-image-1.
- **Variant count:** 3–5.

## Equipment — `ortho-grid`

### Purpose

Orthographic technical reference: silhouette, controls, materials, and handling on one sheet.

### Layout

- Two rows × two columns = four orthographic panels (plus one optional detail-closeup inset in the bottom-right when `visualDetails` calls for it).
- True orthographic projection in every panel — no perspective, no camera tilt.
- **Top-left:** front. **Top-right:** back. **Bottom-left:** left profile. **Bottom-right:** right profile.
- Solid white background, flat studio lighting, single object, no environment.

### Default Prompt Template

```
Equipment orthographic reference sheet, {EQUIPMENT_DESCRIPTION},
two rows and two columns, four orthographic panels at identical scale,
top-left front, top-right back, bottom-left left profile, bottom-right right profile,
true orthographic projection, no perspective, no vanishing points, no camera tilt,
solid white background, flat even studio lighting, single object, no environment,
detailed mechanical parts and material indications visible, professional product design reference sheet
```

### Negative Prompt

```
perspective view, inconsistent scale, single view only, artistic rendering, dynamic angle,
extra objects, environment, hero shot, single merged image
```

### Settings

- **Aspect ratio:** 1:1 or 4:3.
- **Providers:** Google Imagen 4, OpenAI gpt-image-1.
- **Variant count:** 2–3.

## Location — `bible`

### Purpose

Composite model sheet that carries wide establishing geography plus repeat camera angles for the space. The identity anchor most locations need.

### Layout

- Single image, five tiles.
- **Top half:** one large wide-establishing panel covering the full environment — entry path and far boundary visible.
- **Bottom half:** four equal tiles on a 2×2 grid — interior detail, atmosphere study, key camera angle 1, key camera angle 2.
- Neutral gutters between tiles. No tile dominates the whole frame.
- Consistent time-of-day, weather, and lighting across every tile. No characters, no people, no figures.

### Default Prompt Template

```
Location bible reference sheet, {LOCATION_DESCRIPTION},
one composite image with five tiles separated by thin neutral gutters,
top half is a single wide establishing panel showing the full environment with entry path and far boundary visible,
bottom half is a 2x2 grid of four equal tiles: interior detail, atmosphere study, key camera angle 1, key camera angle 2,
consistent {TIME_OF_DAY} lighting, consistent weather and atmosphere across every tile,
no characters, no people, no figures, empty scene, environment only,
professional environment concept art reference sheet, cinematic composition, architectural details visible
```

### Negative Prompt

```
blurry, inconsistent lighting, different locations, different time of day, characters, figures, people,
single view only, hero wall only, tile collapsed into one frame
```

### Settings

- **Aspect ratio:** 16:9 or 3:2.
- **Providers:** Google Imagen 4, OpenAI gpt-image-1.
- **Variant count:** 2–4.

## Location — `fake-360` (optional)

Use only when shots will move around the space (dolly, pan, walk-through) and you need every compass direction locked.

- One image, eight equal panels (2 rows × 4 columns).
- Top row left-to-right: 0°, 45°, 90°, 135°. Bottom row: 180°, 225°, 270°, 315°.
- Matching eye-level, time-of-day, and weather across every panel.

## Extra-angle — universal escape hatch

Every entity supports `extra-angle` with a free-form angle string for rare custom views (action pose for a character, macro of a specific mechanism for equipment, blocking diagram for a location). `extra-angle` does not replace the primary slot — it augments it.

## Advanced Tips

### Character Consistency
- Fill the character record (face, hair, body, skinTone, distinctTraits, costume) before generating. `buildCharacterAppearancePrompt` assembles those fields automatically.
- Generate 3–5 variants and promote the cleanest via `character.setRefImage` / `character.setRefImageFromNode`.
- If variants keep missing, describe the failure in one line ("top row collapsed, only expressions returned") and regenerate with corrective language — do not retry blindly.

### Equipment Consistency
- Durable identity lives in the equipment record (`material`, `color`, `condition`, `visualDetails`, `subtype`). The custom prompt is only for anti-collapse language, scale indicators, or a specific camera tweak.
- Regenerate the ortho-grid when silhouette breaks; do not add adjective piles to fix material reads — generate an `extra-angle` close-up instead.

### Location Consistency
- Lock `timeOfDay`, `weather`, `lighting`, `architectureStyle`, and `dominantColors` on the record before generating. The bible sheet inherits them.
- Every tile is empty scene — no people. If a figure appears, delete the sheet and regenerate with "no characters, no people, no figures" echoed.

### Quality Control
- Always specify the exact grid ("two rows, three columns, six panels") rather than vague "model sheet".
- Use "head-to-toe", "feet grounded", "shoulders included", "orthographic projection" — process vocabulary, not adjective piles.
- Avoid `cinematic`, `dramatic`, `epic`, `masterpiece`, `8k`, `hyperdetailed` — they destroy identity stability in ref images.

## Integration with Lucid Fin

These layouts are emitted by `buildCharacterRefImagePrompt`, `buildEquipmentRefImagePrompt`, and `buildLocationRefImagePrompt` when the agent calls the corresponding `*.generateRefImage` tool. The workflow is:

1. Fill the entity record first — durable identity is the source of truth.
2. Call `character.generateRefImage` / `equipment.generateRefImage` / `location.generateRefImage` with just the entity id. The builder compiles the prompt from the record and the layout rules above.
3. Only pass a custom `prompt` when you need direction the record cannot express. Do not repeat record fields in the custom prompt — it fights the auto-compiled appearance line.
4. Review whether the sheet actually proves silhouette, construction, and identity before accepting it. The sheet is an anchor for the whole project — a broken anchor drifts every downstream shot.

## Customization

Users can customize these templates in Settings > Generation > Reference Prompts. Templates can be edited, reset to defaults, duplicated, or shared across projects.
