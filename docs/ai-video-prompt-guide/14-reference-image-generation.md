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
Generate a multi-angle character reference sheet showing front, 3/4, side, and back views in a single image.

### Standard Views
- **Front view**: Character facing camera directly
- **3/4 view**: Character at 45-degree angle
- **Side profile**: Character in pure profile
- **Back view**: Character facing away

### Best Practices
- Consistent lighting across all angles
- Neutral standing pose (no action poses)
- White or neutral background
- Full body visible in all views
- Same character proportions in all views
- Aligned horizontally for easy comparison

### Default Prompt Template

```
Character turnaround reference sheet, {CHARACTER_DESCRIPTION},
showing front view, three-quarter view, side profile view, and back view in a single image,
all views aligned horizontally on white background,
consistent lighting across all angles, neutral standing pose, full body visible,
professional character design model sheet, clean lines, detailed costume and features,
same character from multiple angles, orthographic projection style
```

### Negative Prompt

```
blurry, inconsistent lighting, different poses, different characters, cropped, 
low quality, perspective distortion, single view only, dynamic pose, action pose
```

### Recommended Settings
- **Aspect Ratio**: 16:9 (1920x1080)
- **Providers**: Google Imagen 3, OpenAI DALL-E, Midjourney
- **Variant Count**: 3-5 (to get best result)

### Examples

**Example 1: Fantasy Warrior**
```
Character turnaround reference sheet, young female warrior with red armor and long black hair,
showing front view, three-quarter view, side profile view, and back view in a single image,
all views aligned horizontally on white background,
consistent lighting across all angles, neutral standing pose, full body visible,
professional character design model sheet, clean lines, detailed costume and features
```

**Example 2: Sci-Fi Character**
```
Character turnaround reference sheet, cyberpunk hacker with neon blue jacket and augmented eyes,
showing front view, three-quarter view, side profile view, and back view in a single image,
all views aligned horizontally on white background,
consistent lighting across all angles, neutral standing pose, full body visible,
professional character design model sheet, clean lines, detailed costume and features
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
- **Providers**: Google Imagen 3, OpenAI DALL-E
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
- **Providers**: Google Imagen 3, Midjourney
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
2. Choose "Use Reference Template"
3. System automatically applies appropriate prompt template
4. Customize description and optional elements
5. Generate with recommended settings

## Customization

Users can customize these templates in Settings > Generation > Reference Prompts. All templates can be:
- Edited to match your style
- Reset to defaults
- Duplicated for variations
- Shared across projects
