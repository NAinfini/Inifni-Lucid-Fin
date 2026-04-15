import type { Character } from '@lucid-fin/contracts';

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

function buildCharacterStudioSetup(composition: string): string {
  return `${composition}. Solid white background, even studio lighting, single character only.`;
}

function buildSingleViewPrompt(
  entity: Character,
  shotDescription: string,
  focusDescription: string,
  angleLabel?: string,
): string {
  const appearanceDesc = buildCharacterAppearancePrompt(entity);
  const angleText = angleLabel ? ` ${angleLabel} angle.` : '';

  return `${shotDescription}. `
    + `${buildCharacterStudioSetup('Tall portrait composition (2:3 aspect ratio)')} `
    + `Character: ${entity.name}. `
    + (appearanceDesc ? `${appearanceDesc}. ` : '')
    + `${focusDescription}.${angleText}`;
}

export function buildCharacterRefImagePrompt(entity: Character, slot: string): string {
  const appearanceDesc = buildCharacterAppearancePrompt(entity);
  const normalizedSlot = slot.trim().toLowerCase();

  if (normalizedSlot === 'main' || normalizedSlot === 'front') {
    return `Character turnaround sheet for production reference. `
      + `${buildCharacterStudioSetup('Wide landscape composition (3:2 aspect ratio)')} `
      + `Character: ${entity.name}. `
      + (appearanceDesc ? `${appearanceDesc}. ` : '')
      + `Top row shows matching full-body front view, left profile, rear view at identical scale. `
      + `Bottom row shows head studies with neutral, focused, stern, relieved, and surprised expressions. `
      + `Preserve the same wardrobe, silhouette, proportions, and identifying details in every panel.`;
  }

  if (normalizedSlot === 'back') {
    return buildSingleViewPrompt(
      entity,
      'Full-body rear view character reference',
      'Show the same costume from behind with hair shape, cape, backpack, and back-fastening details clearly readable',
    );
  }

  if (normalizedSlot === 'left-side') {
    return buildSingleViewPrompt(
      entity,
      'Full-body left profile character reference',
      'Keep the pose neutral with arms relaxed and slightly separated so silhouette clarity reads cleanly from head to toe',
    );
  }

  if (normalizedSlot === 'right-side') {
    return buildSingleViewPrompt(
      entity,
      'Full-body right profile character reference',
      'Keep the pose neutral with arms relaxed and slightly separated so silhouette clarity reads cleanly from head to toe',
    );
  }

  if (normalizedSlot === 'face-closeup') {
    return `Head-and-shoulders facial reference. `
      + `${buildCharacterStudioSetup('Tall portrait composition (2:3 aspect ratio)')} `
      + `Character: ${entity.name}. `
      + (appearanceDesc ? `${appearanceDesc}. ` : '')
      + `neutral expression, direct gaze, maximum face detail, clean view of the brow, eyes, nose, lips, jawline, and hairline.`;
  }

  if (normalizedSlot === 'top-down') {
    return buildSingleViewPrompt(
      entity,
      'Birds-eye character reference looking straight down',
      'Show the hair crown, shoulder shape, stance, and posture clearly from overhead',
    );
  }

  return buildSingleViewPrompt(
    entity,
    'Single-view character reference',
    'Frame the full figure cleanly so costume read, body language, and silhouette stay unambiguous',
    normalizedSlot,
  );
}
