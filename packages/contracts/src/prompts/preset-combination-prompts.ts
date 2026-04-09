/**
 * Preset Combination Prompt Templates
 *
 * Guidance for combining presets effectively across categories.
 */

export interface PresetCombinationGuide {
  id: string;
  name: string;
  categories: string[];
  description: string;
  intensityGuide: Record<string, number>;
  tips: string[];
}

export const presetCombinationGuides: PresetCombinationGuide[] = [
  {
    id: 'action-sequence',
    name: 'Action Sequence',
    categories: ['camera', 'flow', 'emotion'],
    description: 'High-energy action shots',
    intensityGuide: { camera: 85, flow: 90, emotion: 80 },
    tips: [
      'camera: handheld-shake or steadicam-follow at 80-90 intensity',
      'flow: energetic or frantic at 85+ intensity',
      'emotion: urgent or triumphant',
      'Avoid conflicting: do not combine slow camera with frantic flow',
    ],
  },
  {
    id: 'intimate-dialogue',
    name: 'Intimate Dialogue',
    categories: ['lens', 'composition', 'emotion', 'scene'],
    description: 'Close personal conversation shots',
    intensityGuide: { lens: 70, composition: 65, emotion: 60, scene: 50 },
    tips: [
      'lens: portrait-85mm at 70-80 intensity',
      'composition: extreme-close-up or over-the-shoulder at 60-70',
      'emotion: intimate at 60, not too high — subtle is better',
      'scene: warm lighting (golden-hour) at low intensity 40-60',
    ],
  },
  {
    id: 'establishing-wide',
    name: 'Establishing Wide Shot',
    categories: ['camera', 'lens', 'scene', 'technical'],
    description: 'Wide establishing shots for scene context',
    intensityGuide: { camera: 90, lens: 80, scene: 75, technical: 100 },
    tips: [
      'camera: crane-up or static-hold at 80-100',
      'lens: ultra-wide-14mm or wide-24mm',
      'scene: match time of day to story context',
      'technical: high-fidelity at 100 for establishing shots',
    ],
  },
];

/**
 * Intensity guidelines:
 * - 0-30: Subtle hint, barely noticeable
 * - 40-60: Moderate influence, balanced
 * - 70-85: Strong presence, clearly visible
 * - 90-100: Dominant, defines the shot
 *
 * Rule: Only one category should be at 90+ per shot.
 * Conflicting high-intensity presets cancel each other out.
 */
export const intensityGuidelines = {
  subtle: { min: 0, max: 30 },
  moderate: { min: 40, max: 60 },
  strong: { min: 70, max: 85 },
  dominant: { min: 90, max: 100 },
};
