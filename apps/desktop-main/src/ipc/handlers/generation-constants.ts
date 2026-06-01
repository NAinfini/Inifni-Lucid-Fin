import type { StyleGuide } from '@lucid-fin/contracts';

export const DEFAULT_IMAGE_SIZE = { width: 1024, height: 1024 };
export const DEFAULT_VIDEO_SIZE = { width: 1280, height: 720 };
export const DEFAULT_VIDEO_DURATION = 5;
export const DEFAULT_AUDIO_DURATION = 5;
export const MAX_VARIANTS = 9;
export const MAX_ACCUMULATED_VARIANTS = 20;

export const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};

export const STYLE_GUIDE_LIGHTING_PRESETS: Record<
  StyleGuide['global']['lighting'],
  string | undefined
> = {
  natural: undefined,
  studio: 'scene:high-key',
  dramatic: 'scene:low-key',
  neon: 'scene:neon-noir',
  custom: undefined,
};
