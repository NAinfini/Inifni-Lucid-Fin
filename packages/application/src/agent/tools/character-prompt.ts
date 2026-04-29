import {
  characterViewToSlot,
  type Character,
  type CharacterRefImageView,
} from '@lucid-fin/contracts';

/**
 * Character ref-image prompts.
 *
 * A character has exactly one reference-image slot — `full-sheet` — that
 * packs the full-body turnaround (front / left profile / rear) AND a
 * compact expression set (neutral / happy / angry) onto a single composed
 * sheet. The legacy per-slot set (main/back/left/right/face-closeup/
 * top-down) survives only as a DB-migration alias layer (see
 * `characterSlotToView`); it no longer drives generation and must not be
 * referenced in prompts.
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
      .map((costume) =>
        costume.name ? `${costume.name}: ${costume.description}` : costume.description,
      );
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
 *
 * Layout: 2 rows × 3 columns = 6 panels. Top row = full-body turnaround
 * (front / left profile / rear) at ~70% sheet height, bottom row =
 * expressions (neutral / happy / angry) at ~30% sheet height.
 *
 * Prompt-budget discipline (why this is short): earlier revisions poured
 * 200+ words into layout policing and anti-collapse clauses, and the
 * image model produced generic anime faces — attention was starved from
 * the character description. Layout now gets ~3 lines; the character's
 * appearance (face, hair, build, costume, distinct traits) gets the rest
 * of the budget. Identity > layout discipline. The model still collapses
 * mixed sheets sometimes; we accept that probabilistic failure rather
 * than drowning the subject description to chase it.
 */
function buildFullSheetPrompt(entity: Character, stylePlate?: string): string {
  const appearance = buildCharacterAppearancePrompt(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    // stylePlate (canvas-scoped free-form style prompt) always leads so
    // the generator locks the visual look before reading subject details.
    segments.push(`Style: ${stylePlate}`);
  }

  // Subject first — appearance carries identity, which is what every
  // downstream shot actually needs the sheet to lock.
  segments.push(`Character reference sheet of ${entity.name}`);
  if (appearance) segments.push(appearance);
  segments.push('Same wardrobe, hair, face, proportions, and colors in every panel');

  // Compact layout block. Keep this short — long layout text cannibalizes
  // the model's attention and produces generic faces.
  segments.push('Layout: six panels on one sheet, two rows of three');
  segments.push(
    'Top row (taller, ~70% height) shows full-body turnaround: front, left profile, rear — head-to-toe, feet grounded, no crop',
  );
  segments.push(
    'Bottom row (shorter, ~30% height) shows head-and-shoulders expressions: neutral, happy, angry',
  );
  segments.push(
    'Solid white studio background, flat even lighting, single character, no props, no environment',
  );

  return segments.join('. ') + '.';
}

/**
 * Build a single extra-angle view — used for rare angles (three-quarter,
 * overhead, action pose, etc.) the full-sheet doesn't capture.
 */
function buildExtraAnglePrompt(entity: Character, angle: string, stylePlate?: string): string {
  const appearance = buildCharacterAppearancePrompt(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Full-body ${angle} character reference`);
  segments.push(
    'Tall portrait composition, solid white background, even studio lighting, single character only',
  );
  segments.push(`Character: ${entity.name}`);
  if (appearance) segments.push(appearance);
  segments.push(
    'Frame the full figure cleanly so costume, body language, and silhouette read unambiguously',
  );

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
