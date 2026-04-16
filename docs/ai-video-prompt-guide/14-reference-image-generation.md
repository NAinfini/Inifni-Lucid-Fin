# Reference Image Generation Prompts

## Overview

This guide provides prompt templates for generating multi-angle reference images for characters, equipment, and locations. These templates are designed to produce consistent, professional reference sheets that can be used throughout your project.

## Research Sources

Based on industry best practices from:
- [Character Turnaround Best Practices](https://spines.com/character-turnaround)
- [AI Character Turnarounds with Scenario](https://www.scenario.com/blog/generate-character-turnarounds-scenario)
- [Multi-Angle Reference Sheets](https://editor-dev.opencreator.io/blog/ai-character-reference-sheet)
- [AI Character Consistency Guide 2026](https://www.cinemadrop.com/blog/how-to-create-consistent-ai-characters-the-complete-guide-for-ai-filmmakers-in-2026)
- [Character Turnarounds by Elbert Gu](https://lbrtgu.com/new-blog/2026/2/7/character-turnarounds)

## Character Turnaround Sheet

### Purpose
Generate a production-ready character model sheet in a single image: full-body multi-view turnaround plus enlarged facial expression studies.

### Standard Layout
- **Top row**: Front, left profile, right profile, back view
- **Bottom row**: Enlarged face studies with multiple emotions
- **Body panels**: Full body visible in every panel, identical scale
- **Face panels**: Head-and-shoulders only, same face structure in every emotion

### Best Practices
- Consistent lighting across all panels
- Neutral standing pose for body views
- White or neutral background
- Full body visible in every body panel
- Same character proportions in all body views
- Expression panels must keep identical facial structure, hairstyle, and color
- Explicitly forbid cropped limbs, extra props, extra characters, and scene background clutter

### Default Prompt Template

```
Character turnaround model sheet, {CHARACTER_DESCRIPTION},
two-row layout on white background,
top row shows full-body front view, left profile, right profile, and back view at identical scale,
full body visible in every body panel, neutral standing pose, arms slightly away from body,
bottom row shows enlarged head-and-shoulders face studies with neutral, happy, sad, angry, surprised, and determined expressions,
same character in every panel, identical facial structure, hairstyle, costume, proportions, and colors,
professional character design model sheet, clean lines, even studio lighting, orthographic reference feel
```

### Negative Prompt

```
blurry, inconsistent lighting, different poses, different characters, cropped limbs,
waist-up only, single view only, dynamic pose, action pose, extra props, background scene clutter
```

### Recommended Settings
- **Aspect Ratio**: 3:2 (2048x1360)
- **Providers**: Google Imagen 4, OpenAI gpt-image-1
- **Variant Count**: 3-5 (to get best result)

### Examples

**Example 1: Fantasy Warrior**
```
Character turnaround model sheet, young female warrior with red armor and long black hair,
two-row layout on white background,
top row shows full-body front view, left profile, right profile, and back view at identical scale,
bottom row shows enlarged face studies with neutral, happy, sad, angry, surprised, and determined expressions,
same character in every panel, consistent lighting, neutral standing pose, full body visible
```

**Example 2: Sci-Fi Character**
```
Character turnaround model sheet, cyberpunk hacker with neon blue jacket and augmented eyes,
two-row layout on white background,
top row shows full-body front view, left profile, right profile, and back view at identical scale,
bottom row shows enlarged face studies with neutral, happy, sad, angry, surprised, and determined expressions,
same character in every panel, consistent lighting, neutral standing pose, full body visible
```

## Equipment Reference Sheet

### Purpose
Generate technical reference sheet with orthographic views (front, side, top) for props and equipment.

### Standard Views
- **Front orthographic**: Straight-on view
- **Side orthographic**: Pure side view
- **Top orthographic**: Bird's eye view

### Best Practices
- Technical drawing style
- Consistent scale across all views
- White or grid background
- Detailed mechanical parts visible
- Material indications
- Clean, precise lines

### Default Prompt Template

```
Equipment reference sheet, {EQUIPMENT_DESCRIPTION},
showing front orthographic view, side orthographic view, and top orthographic view in a single image,
all views aligned in technical drawing layout on white background,
consistent scale across all views, clean technical illustration style,
detailed mechanical parts visible, material indications,
professional product design reference sheet, blueprint style
```

### Negative Prompt

```
blurry, perspective view, artistic rendering, inconsistent scale, cropped, 
low quality, single view only, photorealistic, dynamic angle
```

### Recommended Settings
- **Aspect Ratio**: 16:9 (1920x1080)
- **Providers**: Google Imagen 4, OpenAI gpt-image-1
- **Variant Count**: 2-3

### Examples

**Example 1: Weapon**
```
Equipment reference sheet, futuristic energy sword with glowing blue blade,
showing front orthographic view, side orthographic view, and top orthographic view in a single image,
technical drawing layout on white background, consistent scale,
detailed mechanical parts, professional product design reference sheet
```

**Example 2: Device**
```
Equipment reference sheet, steampunk mechanical gauntlet with brass gears,
showing front orthographic view, side orthographic view, and top orthographic view in a single image,
technical drawing layout on white background, consistent scale,
detailed mechanical parts, professional product design reference sheet
```

## Location Reference Sheet

### Purpose
Generate multi-angle location reference with establishing shot and key camera angles.

### Standard Views
- **Wide establishing shot**: Full view of location (top panel)
- **Key angle 1**: Important camera position
- **Key angle 2**: Alternative view
- **Key angle 3** (optional): Additional perspective

### Best Practices
- Consistent lighting and time of day
- Consistent weather and atmosphere
- Same location in all views
- Architectural details visible
- Scale reference (human figure optional)
- Cinematic composition

### Default Prompt Template

```
Location reference sheet, {LOCATION_DESCRIPTION},
showing wide establishing shot in top panel and 2-3 different key camera angles in bottom panels,
all views in a single composite image with consistent lighting and atmosphere,
{TIME_OF_DAY} lighting, consistent weather and mood across all views,
professional environment concept art reference sheet, cinematic composition,
architectural details visible, scale reference with human figure
```

### Negative Prompt

```
blurry, inconsistent lighting, different locations, different time of day, 
low quality, single view only, cropped, people as main focus
```

### Recommended Settings
- **Aspect Ratio**: 16:9 (1920x1080)
- **Providers**: Google Imagen 4, OpenAI gpt-image-1
- **Variant Count**: 2-4

### Examples

**Example 1: Urban Scene**
```
Location reference sheet, cyberpunk city street with neon signs,
showing wide establishing shot in top panel and 2-3 different key camera angles in bottom panels,
all views in a single composite image with consistent night lighting and rainy atmosphere,
professional environment concept art reference sheet, cinematic composition
```

**Example 2: Interior**
```
Location reference sheet, medieval castle throne room with stone pillars,
showing wide establishing shot in top panel and 2-3 different key camera angles in bottom panels,
all views in a single composite image with consistent warm torch lighting,
professional environment concept art reference sheet, cinematic composition
```

## Advanced Tips

### Character Consistency
- Define 15-20 specific physical attributes before generating
- Generate 8-10 reference images for best consistency
- Use locked seed for variations
- Include distinctive features in description

### Multi-Angle Composition
- Specify "aligned horizontally" or "aligned in grid" for layout
- Use "orthographic projection" for technical accuracy
- Add "model sheet" or "reference sheet" keywords
- Include "consistent lighting" explicitly

### Quality Control
- Always specify "professional" and "detailed"
- Use "clean lines" for clarity
- Avoid action poses for reference sheets
- Request "full body visible" to prevent cropping

## Integration with Lucid Fin

These prompts are integrated into the Character, Equipment, and Location managers. When generating reference images:

1. Select entity type (Character/Equipment/Location)
2. For standard slots, prefer the built-in slot template instead of hand-writing a custom prompt
3. Only override prompt when you need a user-approved custom layout or style
4. Strengthen entity data first, then generate with recommended settings
5. Review whether the sheet actually proves silhouette, construction, and identity before accepting it

## Customization

Users can customize these templates in Settings > Generation > Reference Prompts. All templates can be:
- Edited to match your style
- Reset to defaults
- Duplicated for variations
- Shared across projects
