import {
  equipmentViewToSlot,
  type Equipment,
  type EquipmentRefImageView,
} from '@lucid-fin/contracts';

/**
 * Phase 2 overhaul — equipment ref-image prompts.
 *
 * `ortho-grid` replaces the old 7-slot set with a single 2x2+1 composite
 * showing front, back, left profile, right profile, plus a centered detail
 * close-up. One API call, full coverage, consistent lighting.
 *
 * `extra-angle` covers rare custom needs (in-use context shot, cutaway, etc).
 *
 * stylePlate (canvas-scoped free-form style prompt) leads when present.
 */
function buildEquipmentDescription(entity: Equipment): string {
  const parts: string[] = [];
  if (entity.description) parts.push(entity.description);
  if (entity.function) parts.push(`Function: ${entity.function}`);
  if (entity.material) parts.push(`Material surfaces: ${entity.material}`);
  if (entity.color) parts.push(`Color: ${entity.color}`);
  if (entity.condition) parts.push(`Condition: ${entity.condition}`);
  if (entity.visualDetails) parts.push(`Surface details: ${entity.visualDetails}`);
  if (entity.subtype) parts.push(`Subtype: ${entity.subtype}`);
  if (entity.tags && entity.tags.length > 0) parts.push(`Keywords: ${entity.tags.join(', ')}`);
  return parts.join('. ');
}

function buildOrthoGridPrompt(entity: Equipment, stylePlate?: string): string {
  const desc = buildEquipmentDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push('Product orthographic reference grid on one image');
  segments.push('Five panels: top-left front view, top-right back view, middle-left left profile, middle-right right profile, bottom-center macro detail close-up');
  segments.push('All orthographic panels share identical scale, identical lighting, and centered composition');
  segments.push('Bottom detail panel shows engravings, joints, or wear marks in shallow depth of field');
  segments.push('Solid white background, even studio lighting, no characters, no environment, no scene');
  segments.push(`Item: ${entity.name} (${entity.type})`);
  if (desc) segments.push(desc);
  segments.push('Object only, clean edges, high detail, consistent scale across every panel, professional product photography and technical illustration quality');

  return segments.join('. ') + '.';
}

function buildExtraAnglePrompt(
  entity: Equipment,
  angle: string,
  stylePlate?: string,
): string {
  const desc = buildEquipmentDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Product reference, ${angle} view`);
  segments.push('Solid white background, even studio lighting, no characters, no environment');
  segments.push(`Item: ${entity.name} (${entity.type})`);
  if (desc) segments.push(desc);
  segments.push('Object only, clean edges, high detail, professional product photography style');

  return segments.join('. ') + '.';
}

export function buildEquipmentRefImagePrompt(
  entity: Equipment,
  view: EquipmentRefImageView,
  stylePlate?: string,
): string {
  if (view.kind === 'ortho-grid') return buildOrthoGridPrompt(entity, stylePlate);
  return buildExtraAnglePrompt(entity, view.angle, stylePlate);
}

export { equipmentViewToSlot };
