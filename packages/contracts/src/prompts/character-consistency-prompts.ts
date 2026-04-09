/**
 * Character Consistency Prompt Templates
 *
 * Based on research: define 15-20 specific physical traits,
 * generate 8-10 reference images for best consistency.
 * Source: cinemadrop.com/blog/how-to-create-consistent-ai-characters-2026
 */

export interface CharacterConsistencyTemplate {
  id: string;
  description: string;
  promptStructure: string;
  requiredTraits: string[];
  tips: string[];
}

export const characterConsistencyTemplates: CharacterConsistencyTemplate[] = [
  {
    id: 'character-portrait',
    description: 'Consistent character portrait across scenes',
    promptStructure: `{character_name}: {gender}, {age}, {ethnicity},
{hair_color} {hair_style} hair, {eye_color} eyes,
{distinctive_features},
wearing {outfit_description},
{expression}, {lighting}, {shot_type}`,
    requiredTraits: [
      'gender and age',
      'hair color and style',
      'eye color',
      'skin tone',
      'distinctive features (scars, marks, etc.)',
      'outfit/costume description',
    ],
    tips: [
      'Copy the exact character description from Character Manager',
      'Lock seed when generating variants of the same character',
      'Generate 8-10 reference images before using in shots',
      'Use same lighting setup across all character shots for consistency',
      'Add "consistent character design" to every prompt',
    ],
  },
  {
    id: 'character-action',
    description: 'Character in action/motion shots',
    promptStructure: `{character_description} {action},
{setting}, {camera_angle},
consistent character design, same face and outfit as reference`,
    requiredTraits: [
      'full character description (copy from portrait template)',
      'specific action being performed',
      'camera angle',
    ],
    tips: [
      'Always include full character description — do not abbreviate',
      'Reference the character\'s reference image hash in node inspector',
      'Use image-to-video for motion rather than text-to-video for better consistency',
    ],
  },
];

/**
 * Build a character consistency prompt from Character entity data
 */
export function buildCharacterPrompt(character: {
  name: string;
  description: string;
  appearance: string;
  gender?: string;
  age?: number;
}): string {
  const parts = [character.name];
  if (character.gender) parts.push(character.gender);
  if (character.age) parts.push(`age ${character.age}`);
  if (character.appearance) parts.push(character.appearance);
  if (character.description) parts.push(character.description);
  return parts.join(', ');
}
