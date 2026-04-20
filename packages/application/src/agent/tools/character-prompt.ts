import {
  characterViewToSlot,
  type Character,
  type CharacterRefImageView,
} from '@lucid-fin/contracts';

/**
 * Phase 2 overhaul — character ref-image prompts.
 *
 * The old per-slot template set (main/back/left/right/face-closeup/top-down)
 * is replaced by a single composite `full-sheet` prompt. One generation call
 * produces ONE image that packs front, back, left/right profiles, full body,
 * AND detailed expressions onto a single sheet the model composes. This
 * matches Q27 ("front back side full body, + detailed faces in one image")
 * and halves API cost vs. the old 6-slot approach.
 *
 * `extra-angle` covers any rare custom view.
 *
 * stylePlate (when present) is inserted as the FIRST prompt segment — the
 * style prompt always leads so downstream generators lock the look before
 * the subject description. Both the user and Commander AI can edit the
 * canvas-scoped stylePlate directly.
 */
export function buildCharacterAppearancePrompt(entity: Character): string {
  const parts: string[] = [];

  if (entity.role && entity.role !== 'extra') {
    parts.push(`Role: ${entity.role}`);
  }

  const ageGender: string[] = [];
  if (entity.age) ageGender.push(`${entity.age} years old`);
  if (entity.gender) ageGender.push(entity.gender);
  if (ageGender.length > 0) parts.push(ageGender.join(', '));

  if (entity.description) parts.push(entity.description);

  const face = entity.face;
  if (face) {
    const faceParts: string[] = [];
    if (face.eyeShape) faceParts.push(`${face.eyeShape} eyes`);
    if (face.eyeColor) faceParts.push(`${face.eyeColor} irises`);
    if (face.noseType) faceParts.push(`${face.noseType} nose`);
    if (face.lipShape) faceParts.push(`${face.lipShape} lips`);
    if (face.jawline) faceParts.push(`${face.jawline} jawline`);
    if (face.definingFeatures) faceParts.push(face.definingFeatures);
    if (faceParts.length > 0) parts.push(`Face: ${faceParts.join(', ')}`);
  }

  const hair = entity.hair;
  if (hair) {
    const hairParts: string[] = [];
    if (hair.color) hairParts.push(`${hair.color} hair`);
    if (hair.length) hairParts.push(`${hair.length} length`);
    if (hair.style) hairParts.push(`${hair.style} style`);
    if (hair.texture) hairParts.push(`${hair.texture} texture`);
    if (hairParts.length > 0) parts.push(`Hair: ${hairParts.join(', ')}`);
  }

  if (entity.skinTone) parts.push(`Skin tone: ${entity.skinTone}`);

  const body = entity.body;
  if (body) {
    const bodyParts: string[] = [];
    if (body.height) bodyParts.push(body.height);
    if (body.build) bodyParts.push(`${body.build} build`);
    if (body.proportions) bodyParts.push(body.proportions);
    if (bodyParts.length > 0) parts.push(`Body: ${bodyParts.join(', ')}`);
  }

  if (entity.distinctTraits && entity.distinctTraits.length > 0) {
    parts.push(`Distinctive: ${entity.distinctTraits.join(', ')}`);
  }

  if (entity.costumes && entity.costumes.length > 0) {
    const costumeDescs = entity.costumes
      .filter((costume) => costume.description)
      .map((costume) => (costume.name ? `${costume.name}: ${costume.description}` : costume.description));
    if (costumeDescs.length > 0) {
      parts.push(`Costume materials and textures: ${costumeDescs.join('; ')}`);
    }
  }

  if (entity.appearance && parts.length === 0) {
    parts.push(entity.appearance);
  } else if (entity.appearance) {
    parts.push(`Additional: ${entity.appearance}`);
  }

  return parts.join('. ');
}

/**
 * Build the full-sheet composite prompt — everything on one image.
 * The layout string tells the model to produce a three-band composition so
 * training examples of model sheets reliably activate.
 */
function buildFullSheetPrompt(entity: Character, stylePlate?: string): string {
  const appearance = buildCharacterAppearancePrompt(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    // stylePlate (canvas-scoped free-form style prompt) always leads so
    // the generator locks the visual look before reading subject details.
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push('Character turnaround and expression sheet for production reference');
  segments.push('Wide landscape composition, three horizontal bands');
  segments.push('Top band: four matching full-body panels showing front, left profile, right profile, and rear — identical scale, feet grounded, no cropping');
  segments.push('Middle band: one taller full-body hero pose, clean silhouette, arms relaxed');
  segments.push('Bottom band: six head-and-shoulders expression panels showing neutral, happy, sad, angry, surprised, and determined — each panel reads the same face shape, hairstyle, and lighting');
  segments.push('Solid white background, even studio lighting, single character only, no props unless they are part of the costume');
  segments.push(`Character: ${entity.name}`);
  if (appearance) segments.push(appearance);
  segments.push('Preserve wardrobe, silhouette, proportions, and identifying details across every panel');

  return segments.join('. ') + '.';
}

/**
 * Build a single extra-angle view — used for rare angles (three-quarter,
 * overhead, action pose, etc.) the full-sheet doesn't capture.
 */
function buildExtraAnglePrompt(
  entity: Character,
  angle: string,
  stylePlate?: string,
): string {
  const appearance = buildCharacterAppearancePrompt(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Full-body ${angle} character reference`);
  segments.push('Tall portrait composition, solid white background, even studio lighting, single character only');
  segments.push(`Character: ${entity.name}`);
  if (appearance) segments.push(appearance);
  segments.push('Frame the full figure cleanly so costume, body language, and silhouette read unambiguously');

  return segments.join('. ') + '.';
}

export function buildCharacterRefImagePrompt(
  entity: Character,
  view: CharacterRefImageView,
  stylePlate?: string,
): string {
  if (view.kind === 'full-sheet') {
    return buildFullSheetPrompt(entity, stylePlate);
  }
  return buildExtraAnglePrompt(entity, view.angle, stylePlate);
}

/**
 * Convert a view to its storage-slot string (re-export helper so callers can
 * key reference-image rows without importing the contracts helper directly).
 */
export { characterViewToSlot };
