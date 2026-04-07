/**
 * Reference Image Generation Prompts
 *
 * Based on research from:
 * - Character turnarounds: https://spines.com/character-turnaround
 * - AI character reference sheets: https://www.scenario.com/blog/generate-character-turnarounds-scenario
 * - Multi-angle consistency: https://editor-dev.opencreator.io/blog/ai-character-reference-sheet
 * - Professional standards: https://www.cinemadrop.com/blog/how-to-create-consistent-ai-characters-the-complete-guide-for-ai-filmmakers-in-2026
 */

export interface ReferencePromptTemplate {
  id: string;
  name: string;
  entityType: 'character' | 'equipment' | 'location';
  description: string;
  basePrompt: string;
  requiredElements: string[];
  optionalElements: string[];
  styleKeywords: string[];
  negativePrompt: string;
  recommendedSettings: {
    aspectRatio: string;
    resolution: { width: number; height: number };
    providers: string[];
  };
  examples: string[];
}

/**
 * Character Reference Sheet Template
 *
 * Standard views: front, 3/4, side, back
 * Best practices: consistent lighting, neutral pose, white background
 */
export const characterReferenceTemplate: ReferencePromptTemplate = {
  id: 'character-turnaround',
  name: 'Character Turnaround Sheet',
  entityType: 'character',
  description: 'Multi-angle character reference sheet with front, 3/4, side, and back views',
  basePrompt: `Character turnaround reference sheet, {description},
showing front view, three-quarter view, side profile view, and back view in a single image,
all views aligned horizontally on white background,
consistent lighting across all angles, neutral standing pose, full body visible,
professional character design model sheet, clean lines, detailed costume and features,
same character from multiple angles, orthographic projection style`,
  requiredElements: [
    'multiple angles (front, 3/4, side, back)',
    'consistent lighting',
    'white or neutral background',
    'neutral pose',
    'full body visible',
    'aligned horizontally',
    'same character in all views',
  ],
  optionalElements: [
    'height reference line',
    'color palette swatch',
    'expression variations',
    'detail callouts',
    'measurements',
    'front and back labels',
  ],
  styleKeywords: [
    'professional character design',
    'model sheet',
    'turnaround',
    'reference sheet',
    'clean lines',
    'detailed',
    'orthographic',
  ],
  negativePrompt: 'blurry, inconsistent lighting, different poses, different characters, cropped, low quality, perspective distortion, single view only, dynamic pose, action pose',
  recommendedSettings: {
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    providers: ['google-imagen3', 'openai-dalle', 'midjourney'],
  },
  examples: [
    'Character turnaround reference sheet, young female warrior with red armor and long black hair, showing front view, three-quarter view, side profile view, and back view in a single image, all views aligned horizontally on white background, consistent lighting, neutral standing pose, full body visible, professional character design model sheet',
    'Character turnaround reference sheet, elderly wizard with blue robes and white beard, showing front view, three-quarter view, side profile view, and back view in a single image, all views aligned horizontally on white background, consistent lighting, neutral standing pose, full body visible, professional character design model sheet',
  ],
};

/**
 * Equipment Reference Sheet Template
 *
 * Standard views: front, side, top (orthographic)
 * Best practices: technical drawing style, measurements, material callouts
 */
export const equipmentReferenceTemplate: ReferencePromptTemplate = {
  id: 'equipment-orthographic',
  name: 'Equipment Reference Sheet',
  entityType: 'equipment',
  description: 'Technical reference sheet with orthographic views (front, side, top)',
  basePrompt: `Equipment reference sheet, {description},
showing front orthographic view, side orthographic view, and top orthographic view in a single image,
all views aligned in technical drawing layout on white background,
consistent scale across all views, clean technical illustration style,
detailed mechanical parts visible, material indications,
professional product design reference sheet, blueprint style`,
  requiredElements: [
    'orthographic views (front, side, top)',
    'consistent scale',
    'white or grid background',
    'technical drawing style',
    'aligned layout',
    'detailed parts',
  ],
  optionalElements: [
    'measurements and dimensions',
    'material callouts',
    'assembly indicators',
    'scale reference',
    'isometric view',
    'exploded view',
  ],
  styleKeywords: [
    'technical drawing',
    'orthographic projection',
    'blueprint',
    'reference sheet',
    'product design',
    'mechanical',
    'detailed',
  ],
  negativePrompt: 'blurry, perspective view, artistic rendering, inconsistent scale, cropped, low quality, single view only, photorealistic, dynamic angle',
  recommendedSettings: {
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    providers: ['google-imagen3', 'openai-dalle'],
  },
  examples: [
    'Equipment reference sheet, futuristic energy sword with glowing blue blade, showing front orthographic view, side orthographic view, and top orthographic view in a single image, technical drawing layout on white background, consistent scale, detailed mechanical parts, professional product design reference sheet',
    'Equipment reference sheet, steampunk mechanical gauntlet with brass gears, showing front orthographic view, side orthographic view, and top orthographic view in a single image, technical drawing layout on white background, consistent scale, detailed mechanical parts, professional product design reference sheet',
  ],
};

/**
 * Location Reference Sheet Template
 *
 * Standard views: wide establishing shot + 2-3 key angles
 * Best practices: consistent lighting/time of day, atmospheric consistency
 */
export const locationReferenceTemplate: ReferencePromptTemplate = {
  id: 'location-multi-angle',
  name: 'Location Reference Sheet',
  entityType: 'location',
  description: 'Multi-angle location reference with establishing shot and key views',
  basePrompt: `Location reference sheet, {description},
showing wide establishing shot in top panel and 2-3 different key camera angles in bottom panels,
all views in a single composite image with consistent lighting and atmosphere,
{timeOfDay} lighting, consistent weather and mood across all views,
professional environment concept art reference sheet, cinematic composition,
architectural details visible, scale reference with human figure`,
  requiredElements: [
    'wide establishing shot',
    '2-3 key angles',
    'consistent lighting',
    'consistent atmosphere',
    'same location in all views',
    'composite layout',
  ],
  optionalElements: [
    'human figure for scale',
    'time of day specification',
    'weather conditions',
    'mood/atmosphere keywords',
    'architectural details',
    'floor plan overlay',
  ],
  styleKeywords: [
    'environment concept art',
    'location reference',
    'establishing shot',
    'cinematic',
    'architectural',
    'atmospheric',
  ],
  negativePrompt: 'blurry, inconsistent lighting, different locations, different time of day, low quality, single view only, cropped, people as main focus',
  recommendedSettings: {
    aspectRatio: '16:9',
    resolution: { width: 1920, height: 1080 },
    providers: ['google-imagen3', 'midjourney'],
  },
  examples: [
    'Location reference sheet, cyberpunk city street with neon signs, showing wide establishing shot in top panel and 2-3 different key camera angles in bottom panels, all views in a single composite image with consistent night lighting and rainy atmosphere, professional environment concept art reference sheet',
    'Location reference sheet, medieval castle throne room with stone pillars, showing wide establishing shot in top panel and 2-3 different key camera angles in bottom panels, all views in a single composite image with consistent warm torch lighting, professional environment concept art reference sheet',
  ],
};

/**
 * All reference templates
 */
export const referencePromptTemplates: Record<string, ReferencePromptTemplate> = {
  'character-turnaround': characterReferenceTemplate,
  'equipment-orthographic': equipmentReferenceTemplate,
  'location-multi-angle': locationReferenceTemplate,
};

/**
 * Get template by entity type
 */
export function getReferenceTemplate(entityType: 'character' | 'equipment' | 'location'): ReferencePromptTemplate {
  switch (entityType) {
    case 'character':
      return characterReferenceTemplate;
    case 'equipment':
      return equipmentReferenceTemplate;
    case 'location':
      return locationReferenceTemplate;
  }
}

/**
 * Build prompt from template
 */
export function buildReferencePrompt(
  template: ReferencePromptTemplate,
  description: string,
  options?: {
    timeOfDay?: string;
    includeOptional?: string[];
  },
): string {
  let prompt = template.basePrompt.replace('{description}', description);

  if (options?.timeOfDay && template.entityType === 'location') {
    prompt = prompt.replace('{timeOfDay}', options.timeOfDay);
  }

  if (options?.includeOptional) {
    const optionalText = options.includeOptional.join(', ');
    prompt += `, ${optionalText}`;
  }

  return prompt;
}
