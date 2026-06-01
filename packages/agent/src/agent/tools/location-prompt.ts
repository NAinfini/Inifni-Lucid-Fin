import { locationViewToSlot, type Location, type LocationRefImageView } from '@lucid-fin/contracts';

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

  segments.push(`Cinematic environment concept art bible of ${entity.name}`);
  if (desc) segments.push(desc);
  segments.push('No characters, no people, no figures, no silhouettes — environment only');

  segments.push('Layout: five frames on one sheet, asymmetric grid');
  segments.push(
    'Frame 1 (large, left half): wide establishing shot — deep layered composition showing full spatial extent, atmospheric depth with haze or light falloff, rich material textures on surfaces (stone grain, wood patina, metal weathering, fabric drape)',
  );
  segments.push(
    'Frame 2 (top right): interior detail study — architectural close-ups showing construction joints, surface wear patterns, decorative elements, material transitions between different surfaces',
  );
  segments.push(
    'Frame 3 (middle right): atmosphere and mood study — showcasing the interplay of light and shadow, volumetric light rays, reflections on surfaces, weather effects, color temperature of the ambient light',
  );
  segments.push(
    'Frame 4 (bottom right A): primary key camera angle at eye-level, the hero staging shot a cinematographer would use for dialogue scenes, showing spatial relationships between foreground and background elements',
  );
  segments.push(
    'Frame 5 (bottom right B): alternate camera angle revealing circulation paths, doorways, corridors, or sightlines not visible in the hero shot',
  );
  segments.push(
    'Consistent lighting direction, color palette, material language, and time of day across every frame. High detail rendering with visible surface textures and material properties',
  );

  return segments.join('. ') + '.';
}

function buildFake360Prompt(entity: Location, stylePlate?: string): string {
  const desc = buildLocationDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Cinematic environment pseudo-panorama of ${entity.name}`);
  if (desc) segments.push(desc);
  segments.push('No characters, no people, no figures, no silhouettes — environment only');

  segments.push('Layout: eight panels in a 4x2 grid, camera rotated 45° per panel');
  segments.push('Reading order: 0°, 45°, 90°, 135° (top row); 180°, 225°, 270°, 315° (bottom row)');
  segments.push(
    'Same camera height, same focal length, same lighting direction, same time of day, same weather conditions across every panel. Each panel shows rich surface textures and material detail visible at the given angle',
  );

  return segments.join('. ') + '.';
}

function buildExtraAnglePrompt(entity: Location, angle: string, stylePlate?: string): string {
  const desc = buildLocationDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Cinematic environment concept art of ${entity.name}, ${angle} camera angle`);
  if (desc) segments.push(desc);
  segments.push(
    'No characters, no people, no figures, no silhouettes — environment only. Rich material textures, atmospheric depth, and clear spatial relationships',
  );

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
