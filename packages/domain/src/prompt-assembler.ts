import type { Scene, Character, StyleGuide, Keyframe, SceneSegment } from '@lucid-fin/contracts';

/**
 * Assemble a prompt for keyframe image generation.
 */
export function assembleKeyframePrompt(
  scene: Scene,
  characters: Character[],
  styleGuide: StyleGuide,
  keyframe: Keyframe,
): string {
  const parts: string[] = [];

  // Scene context
  parts.push(`Scene: ${scene.title}`);
  if (scene.location) parts.push(`Location: ${scene.location}`);
  if (scene.timeOfDay) parts.push(`Time: ${scene.timeOfDay}`);
  if (scene.description) parts.push(scene.description);

  // Characters in scene
  const sceneChars = characters.filter(
    (c) => scene.characters.includes(c.id) || scene.characters.includes(c.name),
  );
  if (sceneChars.length > 0) {
    const charDescs = sceneChars.map((c) => {
      let desc = c.name;
      if (c.appearance) desc += ` — ${c.appearance}`;
      return desc;
    });
    parts.push(`Characters: ${charDescs.join('; ')}`);
  }

  // Keyframe-specific prompt
  if (keyframe.prompt) parts.push(keyframe.prompt);

  // Style guide injection
  parts.push(assembleStyleString(styleGuide, scene.id));

  return parts.filter(Boolean).join('. ');
}

/**
 * Assemble a prompt for video segment generation.
 */
export function assembleSegmentPrompt(
  segment: SceneSegment,
  scene: Scene,
  characters: Character[],
  styleGuide: StyleGuide,
): string {
  const parts: string[] = [];

  // Scene context
  parts.push(`Scene: ${scene.title}`);
  if (scene.location) parts.push(`Location: ${scene.location}`);
  if (scene.timeOfDay) parts.push(`Time: ${scene.timeOfDay}`);

  // Characters
  const sceneChars = characters.filter(
    (c) => scene.characters.includes(c.id) || scene.characters.includes(c.name),
  );
  if (sceneChars.length > 0) {
    const charDescs = sceneChars.map((c) => {
      let desc = c.name;
      if (c.appearance) desc += ` (${c.appearance})`;
      return desc;
    });
    parts.push(`Characters: ${charDescs.join('; ')}`);
  }

  // Motion / Camera / Mood
  if (segment.motion) parts.push(`Motion: ${segment.motion}`);
  if (segment.camera) parts.push(`Camera: ${segment.camera}`);
  if (segment.mood) parts.push(`Mood: ${segment.mood}`);

  // Duration hint
  if (segment.duration) parts.push(`Duration: ${segment.duration}s`);

  // Style
  parts.push(assembleStyleString(styleGuide, scene.id));

  return parts.filter(Boolean).join('. ');
}

/**
 * Build a style description string from the style guide.
 */
function assembleStyleString(styleGuide: StyleGuide, sceneId?: string): string {
  const g = styleGuide.global;
  const override = sceneId ? styleGuide.sceneOverrides[sceneId] : undefined;
  const effective = override ? { ...g, ...override } : g;

  const styleParts: string[] = [];
  if (effective.artStyle) styleParts.push(`Style: ${effective.artStyle}`);
  if (effective.lighting) styleParts.push(`Lighting: ${effective.lighting}`);
  if (effective.texture) styleParts.push(`Texture: ${effective.texture}`);
  if (effective.colorPalette?.primary)
    styleParts.push(
      `Color palette: ${effective.colorPalette.primary}, ${effective.colorPalette.secondary}`,
    );
  if (effective.freeformDescription) styleParts.push(effective.freeformDescription);

  return styleParts.join(', ');
}

/**
 * Build a negative prompt combining global and segment-level negatives.
 */
export function assembleNegativePrompt(globalNegative?: string, segmentNegative?: string): string {
  const parts = [globalNegative, segmentNegative].filter(Boolean);
  return parts.join(', ');
}
