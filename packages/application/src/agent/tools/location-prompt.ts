import type { Location } from '@lucid-fin/contracts';

export function buildLocationRefImagePrompt(entity: Location, slot: string): string {
  const slotDescriptions: Record<string, string> = {
    'main': 'wide establishing shot, full environment visible, cinematic composition, showing overall scale and layout, weather traces visible on the ground plane',
    'wide-establishing': 'wide establishing shot, full environment visible, cinematic composition, showing overall scale and layout, weather traces visible on the ground plane',
    'interior-detail': 'architectural close detail study, furniture, joints, wear patterns, and material transitions visible, shadows pool in recessed doorways',
    'atmosphere': 'atmospheric mood study, emphasizing lighting, weather, and time of day, light filters through dusty panes, shadows pool in recessed doorways, rain collects in gutter channels',
    'key-angle-1': 'key camera angle, eye-level cinematic shot, showing primary viewpoint for scene staging with layered foreground, midground, and background depth',
    'key-angle-2': 'alternate camera angle, different perspective of the same location, revealing secondary details and circulation paths',
    'overhead': 'overhead bird\'s eye view, looking straight down, showing spatial layout, drainage lines, and circulation paths',
  };
  const slotDesc = slotDescriptions[slot] ?? `${slot} angle view`;

  const descParts: string[] = [];
  if (entity.description) descParts.push(entity.description);
  if (entity.architectureStyle) descParts.push(`Architecture: ${entity.architectureStyle}`);
  if (entity.mood) descParts.push(`Mood: ${entity.mood}`);
  if (entity.lighting) descParts.push(`Lighting: ${entity.lighting}`);
  if (entity.weather) descParts.push(`Weather: ${entity.weather}`);
  if (entity.timeOfDay) descParts.push(`Time of day: ${entity.timeOfDay}`);
  if (entity.dominantColors && entity.dominantColors.length > 0) descParts.push(`Color palette: ${entity.dominantColors.join(', ')}`);
  if (entity.keyFeatures && entity.keyFeatures.length > 0) descParts.push(`Key features: ${entity.keyFeatures.join(', ')}`);
  if (entity.atmosphereKeywords && entity.atmosphereKeywords.length > 0) descParts.push(`Atmosphere: ${entity.atmosphereKeywords.join(', ')}`);
  if (entity.tags && entity.tags.length > 0) descParts.push(`Keywords: ${entity.tags.join(', ')}`);
  const richDesc = descParts.length > 0 ? descParts.join('. ') + '. ' : '';

  return `Environment concept art reference. ${entity.name}. `
    + `${richDesc}`
    + `${slotDesc}. `
    + `No characters, no people, no figures, empty scene, environment only. `
    + `Detailed textures, professional environment concept art, cinematic quality.`;
}
