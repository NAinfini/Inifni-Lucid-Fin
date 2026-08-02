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

  segments.push(
    `Professional product orthographic reference sheet of ${entity.name} (${entity.type})`,
  );
  if (desc) segments.push(desc);
  segments.push(
    'Clean matte white cyclorama backdrop, soft three-point studio lighting with diffused key light, fill light to eliminate harsh shadows, and rim light for clean edge separation. No characters, no environment, no text labels',
  );

  segments.push('Layout: five panels on one sheet in a 2×2 grid plus one centered detail panel');
  segments.push(
    'Top-left: front elevation view. Top-right: rear elevation view. Middle-left: left profile view. Middle-right: right profile view. Bottom-center: macro detail close-up showing surface textures, material finish, wear patterns, and construction details',
  );
  segments.push(
    "All panels share identical scale, identical lighting angle, and centered composition. Each view clearly shows the object's form, proportions, and surface materials",
  );

  return segments.join('. ') + '.';
}

function buildExtraAnglePrompt(entity: Equipment, angle: string, stylePlate?: string): string {
  const desc = buildEquipmentDescription(entity);
  const segments: string[] = [];

  if (stylePlate && stylePlate.length > 0) {
    segments.push(`Style: ${stylePlate}`);
  }

  segments.push(`Professional product reference of ${entity.name} (${entity.type}), ${angle} view`);
  if (desc) segments.push(desc);
  segments.push(
    'Clean matte white cyclorama backdrop, soft diffused studio lighting with rim light for edge separation. No characters, no environment. Show surface materials, proportions, and form clearly',
  );

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
