/**
 * Built-in shot templates — prefabricated multi-track preset combinations.
 */
import type { PresetCategory, PresetTrack } from './core.js';
import { buildPresetId } from './params.js';

export interface ShotTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  tracks: Partial<Record<PresetCategory, PresetTrack>>;
  createdAt?: number;
}

function shotTrack<C extends PresetCategory>(
  category: C,
  presetName: string,
  intensity: number,
): PresetTrack<C> {
  return {
    category,
    intensity,
    entries: [
      {
        id: `tmpl-${category}-${presetName}`,
        category,
        presetId: buildPresetId(category, presetName),
        params: {},
        order: 0,
        intensity,
      },
    ],
  };
}

export const BUILT_IN_SHOT_TEMPLATES: ShotTemplate[] = [
  {
    id: 'builtin-tmpl-dramatic-reveal',
    name: 'Dramatic Reveal',
    description: 'Push-in camera with rim lighting and tense emotion',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'push-in', 80),
      scene: shotTrack('scene', 'rim-light', 70),
      emotion: shotTrack('emotion', 'tense', 90),
    },
  },
  {
    id: 'builtin-tmpl-establishing-shot',
    name: 'Establishing Shot',
    description: 'Wide crane-up with natural lighting and cinematic quality',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'crane-up', 100),
      scene: shotTrack('scene', 'golden-hour', 80),
      technical: shotTrack('technical', 'high-fidelity', 100),
    },
  },
  {
    id: 'builtin-tmpl-intimate-dialogue',
    name: 'Intimate Dialogue',
    description: 'Close framing with portrait lens and warm intimate tone',
    builtIn: true,
    tracks: {
      composition: shotTrack('composition', 'extreme-close-up', 70),
      lens: shotTrack('lens', 'portrait-85mm', 80),
      emotion: shotTrack('emotion', 'intimate', 60),
    },
  },
  {
    id: 'builtin-tmpl-chase-sequence',
    name: 'Chase Sequence',
    description: 'Handheld camera with energetic flow and urgent emotion',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'handheld-shake', 90),
      flow: shotTrack('flow', 'energetic', 80),
      emotion: shotTrack('emotion', 'urgent', 85),
    },
  },
  {
    id: 'builtin-tmpl-dreamy-flashback',
    name: 'Dreamy Flashback',
    description: 'Soft vintage lens with pastel dream look and reflective emotion',
    builtIn: true,
    tracks: {
      lens: shotTrack('lens', 'vintage-soft', 70),
      look: shotTrack('look', 'pastel-dream', 60),
      emotion: shotTrack('emotion', 'reflective', 80),
    },
  },
  {
    id: 'builtin-tmpl-horror-suspense',
    name: 'Horror Suspense',
    description: 'Slow push-in with low-key lighting and ominous dread',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'push-in', 50),
      scene: shotTrack('scene', 'low-key', 90),
      emotion: shotTrack('emotion', 'ominous', 95),
    },
  },
  {
    id: 'builtin-tmpl-action-wide',
    name: 'Action Wide',
    description: 'Steadicam with wide composition and triumphant emotion',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'steadicam-follow', 80),
      composition: shotTrack('composition', 'negative-space', 70),
      emotion: shotTrack('emotion', 'triumphant', 75),
    },
  },
  // Director styles
  {
    id: 'builtin-tmpl-wes-anderson',
    name: 'Wes Anderson',
    description: 'Symmetrical centered framing with pastel look and playful emotion',
    builtIn: true,
    tracks: {
      composition: shotTrack('composition', 'symmetrical', 90),
      look: shotTrack('look', 'wes-anderson-pastel', 85),
      emotion: shotTrack('emotion', 'playful', 70),
    },
  },
  {
    id: 'builtin-tmpl-wong-karwai',
    name: 'Wong Kar-wai',
    description: 'Telephoto compression with neon look and melancholic emotion',
    builtIn: true,
    tracks: {
      lens: shotTrack('lens', 'telephoto-135mm', 80),
      look: shotTrack('look', 'wong-karwai-neon', 90),
      emotion: shotTrack('emotion', 'melancholic', 85),
    },
  },
  {
    id: 'builtin-tmpl-kubrick',
    name: 'Kubrick One-Point',
    description: 'One-point symmetry with wide lens and ominous tension',
    builtIn: true,
    tracks: {
      composition: shotTrack('composition', 'leading-lines', 95),
      look: shotTrack('look', 'kubrick-symmetry', 90),
      emotion: shotTrack('emotion', 'ominous', 80),
    },
  },
  {
    id: 'builtin-tmpl-shinkai',
    name: 'Shinkai Luminous',
    description: 'Luminous sky with golden-hour scene and awe emotion',
    builtIn: true,
    tracks: {
      look: shotTrack('look', 'shinkai-luminous', 90),
      scene: shotTrack('scene', 'golden-hour', 85),
      emotion: shotTrack('emotion', 'awe', 80),
    },
  },
  // Genre scenes
  {
    id: 'builtin-tmpl-sci-fi-wide',
    name: 'Sci-Fi Wide',
    description: 'Ultra-wide lens with neon-noir scene and awe emotion',
    builtIn: true,
    tracks: {
      lens: shotTrack('lens', 'ultra-wide-14mm', 85),
      scene: shotTrack('scene', 'neon-noir', 90),
      emotion: shotTrack('emotion', 'awe', 75),
    },
  },
  {
    id: 'builtin-tmpl-war-documentary',
    name: 'War Documentary',
    description: 'Handheld telephoto with gritty look and urgent emotion',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'handheld-shake', 85),
      lens: shotTrack('lens', 'telephoto-135mm', 75),
      look: shotTrack('look', 'documentary-gritty', 80),
      emotion: shotTrack('emotion', 'urgent', 90),
    },
  },
  {
    id: 'builtin-tmpl-romance-golden',
    name: 'Romance Golden',
    description: 'Portrait lens with golden hour and intimate emotion',
    builtIn: true,
    tracks: {
      lens: shotTrack('lens', 'portrait-85mm', 80),
      scene: shotTrack('scene', 'golden-hour', 85),
      emotion: shotTrack('emotion', 'intimate', 90),
    },
  },
  {
    id: 'builtin-tmpl-western-duel',
    name: 'Western Duel',
    description: 'Extreme close-up with harsh sun and tense emotion',
    builtIn: true,
    tracks: {
      composition: shotTrack('composition', 'extreme-close-up', 90),
      scene: shotTrack('scene', 'high-key', 70),
      emotion: shotTrack('emotion', 'tense', 95),
      flow: shotTrack('flow', 'stop-and-breathe', 80),
    },
  },
  // Compound movements
  {
    id: 'builtin-tmpl-dolly-zoom',
    name: 'Dolly Zoom (Vertigo)',
    description: 'Pull-out camera with snap-zoom and ominous dread',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'pull-out', 90),
      emotion: shotTrack('emotion', 'ominous', 85),
    },
  },
  {
    id: 'builtin-tmpl-crane-pan-reveal',
    name: 'Crane Pan Reveal',
    description: 'Crane-up with pan and awe-inspiring establishing scale',
    builtIn: true,
    tracks: {
      camera: shotTrack('camera', 'crane-up', 90),
      scene: shotTrack('scene', 'volumetric-godrays', 75),
      emotion: shotTrack('emotion', 'awe', 85),
    },
  },
  // Mood/atmosphere
  {
    id: 'builtin-tmpl-neon-rain-noir',
    name: 'Neon Rain Noir',
    description: 'Neon-noir scene with film noir look and melancholic mood',
    builtIn: true,
    tracks: {
      scene: shotTrack('scene', 'neon-noir', 90),
      look: shotTrack('look', 'noir-film', 80),
      emotion: shotTrack('emotion', 'melancholic', 75),
    },
  },
  {
    id: 'builtin-tmpl-blizzard-isolation',
    name: 'Blizzard Isolation',
    description: 'Blizzard scene with negative space and melancholic emotion',
    builtIn: true,
    tracks: {
      scene: shotTrack('scene', 'snow-blizzard', 90),
      composition: shotTrack('composition', 'negative-space', 85),
      emotion: shotTrack('emotion', 'melancholic', 80),
    },
  },
];
