import {
  locationViewToSlot,
  type Location,
  type LocationRefImageView,
} from '@lucid-fin/contracts';

/**
 * Phase 2 overhaul — location ref-image prompts.
 *
 * Two primary views replace the old 7-slot enum:
 *
 *   - `bible` — a five-frame environment bible on one image: wide establish,
 *     interior detail, atmosphere study, key camera angle A, key camera
 *     angle B. Produces the most useful reference per call and matches the
 *     industry practice flagged in Phase 0 diagnosis.
 *   - `fake-360` — eight 45° panels stitched into a pseudo-panorama. A
 *     reasonable substitute for a true equirectangular 360, which current
 *     generators don't reliably produce.
 *   - `extra-angle` — free-form custom angle when needed.
 *
 * stylePlate (canvas-scoped free-form style prompt) leads when present.
 */
function buildLocationDescription(entity: Location): string {
  const parts: string[] = [];
  if (entity.description) parts.push(entity.description);
  if (entity.architectureStyle) parts.push(`Architecture: ${entity.architectureStyle}`);
  if (entity.mood) parts.push(`Mood: ${entity.mood}`);
  if (entity.lighting) parts.push(`Lighting: ${entity.lighting}`);
  if (entity.weather) parts.push(`Weather: ${entity.weather}`);
  if (entity.timeOfDay) parts.push(`Time of day: ${entity.timeOfDay}`);
  if (entity.dominantColors && entity.dominantColors.length > 0) {
    parts.push(`Color palette: ${entity.dominantColors.join(', ')}`);
  }
  if (entity.keyFeatures && entity.keyFeatures.length > 0) {
    parts.push(`Key features: ${entity.keyFeatures.join(', ')}`);
  }
  if (entity.atmosphereKeywords && entity.atmosphereKeywords.length > 0) {
    parts.push(`Atmosphere: ${entity.atmosphereKeywords.join(', ')}`);
  }
  if (entity.tags && entity.tags.length > 0) {
    parts.push(`Keywords: ${entity.tags.join(', ')}`);
  }
  return parts.join('. ');
}

function buildBiblePrompt(entity: Location, stylePlate?: string): string {
  const desc = buildLocationDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push('Environment concept art bible for production reference');
  segments.push('Five-frame composite on one image');
  segments.push('Frame 1 (large, left): wide establishing shot, full environment visible, cinematic composition, layered foreground/midground/background depth');
  segments.push('Frame 2 (top right): interior detail study, architectural close-ups, material transitions, wear patterns');
  segments.push('Frame 3 (middle right): atmosphere study, lighting and weather emphasis, shadows pool in recesses, rain or dust as appropriate');
  segments.push('Frame 4 (bottom right A): primary key camera angle, eye-level cinematic shot for scene staging');
  segments.push('Frame 5 (bottom right B): alternate key camera angle, secondary perspective revealing circulation paths');
  segments.push(`Location: ${entity.name}`);
  if (desc) segments.push(desc);
  segments.push('No characters, no people, no figures, environment only');
  segments.push('Detailed textures, professional environment concept art, cinematic quality, consistent lighting and material language across all frames');

  return segments.join('. ') + '.';
}

function buildFake360Prompt(entity: Location, stylePlate?: string): string {
  const desc = buildLocationDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push('Environment pseudo-panorama for production reference');
  segments.push('Eight panels arranged in a 4x2 grid, each panel shows the scene from a camera rotated 45 degrees from the previous one');
  segments.push('Reading order left-to-right, top-to-bottom: 0°, 45°, 90°, 135° (top row); 180°, 225°, 270°, 315° (bottom row)');
  segments.push('All panels share the same camera height, same focal length, same lighting, same time of day');
  segments.push('Consistent material and color palette across every panel so they read as views of the same space');
  segments.push(`Location: ${entity.name}`);
  if (desc) segments.push(desc);
  segments.push('No characters, no people, no figures, environment only');
  segments.push('Detailed textures, professional environment concept art, cinematic quality');

  return segments.join('. ') + '.';
}

function buildExtraAnglePrompt(
  entity: Location,
  angle: string,
  stylePlate?: string,
): string {
  const desc = buildLocationDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Environment concept art reference, ${angle} camera angle`);
  segments.push(`Location: ${entity.name}`);
  if (desc) segments.push(desc);
  segments.push('No characters, no people, no figures, environment only');
  segments.push('Detailed textures, professional environment concept art, cinematic quality');

  return segments.join('. ') + '.';
}

export function buildLocationRefImagePrompt(
  entity: Location,
  view: LocationRefImageView,
  stylePlate?: string,
): string {
  if (view.kind === 'bible') return buildBiblePrompt(entity, stylePlate);
  if (view.kind === 'fake-360') return buildFake360Prompt(entity, stylePlate);
  return buildExtraAnglePrompt(entity, view.angle, stylePlate);
}

export { locationViewToSlot };
