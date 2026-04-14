export const PRESET_CATEGORIES = [
  'camera',
  'lens',
  'look',
  'scene',
  'composition',
  'emotion',
  'flow',
  'technical',
] as const;

export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

export type CameraDirection =
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'above'
  | 'below'
  | 'over-shoulder-left'
  | 'over-shoulder-right'
  | 'dutch-angle'
  | 'pov'
  | 'tracking-behind'
  | 'worms-eye'
  | 'high-angle'
  | 'profile';

export type PresetParamType = 'number' | 'string' | 'boolean' | 'enum' | 'angle';
export type PresetParamValue = string | number | boolean;
export type PresetParamMap = Record<string, PresetParamValue>;

export interface PresetParamDefinition {
  key: string;
  label: string;
  type: PresetParamType;
  description?: string;
  required?: boolean;
  min?: number;
  max?: number;
  options?: string[];
  defaultValue: PresetParamValue;
}

export interface SphericalPosition {
  label: string;
  azimuthDeg: number;
  elevationDeg: number;
  distance?: number;
  colorHex?: string;
}

/** Maps intensity percentage thresholds to descriptive phrases for prompt compilation. */
export type PromptParamIntensityLevels = Partial<Record<0 | 25 | 50 | 75 | 100, string>>;

export interface PresetPromptParamDef {
  key: string;
  label: string;
  type: 'intensity' | 'select' | 'number';
  default: number | string;
  /** For 'intensity' type: maps thresholds to descriptive phrases used in compiled prompt */
  levels?: PromptParamIntensityLevels;
  /** For 'select' type: discrete options */
  options?: string[];
  /** For 'number' type */
  min?: number;
  max?: number;
}

export interface PresetDefinition {
  id: string;
  category: PresetCategory;
  name: string;
  description: string;
  prompt: string;
  promptFragment?: string;
  negativePrompt?: string;
  builtIn: boolean;
  modified: boolean;
  defaultPrompt?: string;
  defaultParams?: PresetParamMap;
  params: PresetParamDefinition[];
  defaults: PresetParamMap;
  sphericalPositions?: SphericalPosition[];
  /** Parameterized prompt template with {key} placeholders. Falls back to prompt/promptFragment if absent. */
  promptTemplate?: string;
  /** Parameter definitions for promptTemplate resolution. */
  promptParamDefs?: PresetPromptParamDef[];
  /** Conflict group ID. Presets sharing the same group are mutually exclusive. */
  conflictGroup?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface PresetBlendEntry<C extends PresetCategory = PresetCategory> {
  category: C;
  presetIdB: string;
  paramsB?: PresetParamMap;
  factor: number;
  mode?: 'mix' | 'crossfade' | 'add';
}

export interface PresetTrackEntry<C extends PresetCategory = PresetCategory> {
  id: string;
  category: C;
  presetId: string;
  params: PresetParamMap;
  durationMs?: number;
  order: number;
  enabled?: boolean;
  intensity?: number;
  direction?: CameraDirection;
  blend?: PresetBlendEntry<C>;
}

export interface PresetTrack<C extends PresetCategory = PresetCategory> {
  category: C;
  intensity?: number;
  entries: Array<PresetTrackEntry<C>>;
}

export type PresetTrackSet = { [K in PresetCategory]: PresetTrack<K> };

export function createEmptyPresetTrackSet(): PresetTrackSet {
  return {
    camera: { category: 'camera', entries: [] },
    lens: { category: 'lens', entries: [] },
    look: { category: 'look', entries: [] },
    scene: { category: 'scene', entries: [] },
    composition: { category: 'composition', entries: [] },
    emotion: { category: 'emotion', entries: [] },
    flow: { category: 'flow', entries: [] },
    technical: { category: 'technical', entries: [] },
  };
}

export interface PresetLibraryImportPayload {
  presets: PresetDefinition[];
  includeBuiltIn?: boolean;
  source?: 'file' | 'clipboard' | 'api';
}

export interface PresetLibraryExportRequest {
  includeBuiltIn?: boolean;
  categories?: PresetCategory[];
}

export interface PresetLibraryExportPayload {
  version: 1;
  exportedAt: number;
  presets: PresetDefinition[];
}

export type PresetResetScope = 'prompt' | 'params' | 'all';

export interface PresetResetRequest {
  id: string;
  scope?: PresetResetScope;
}

const PRESET_NAME_LIBRARY = {
  camera: [
    'zoom-in',
    'zoom-out',
    'pan-left',
    'pan-right',
    'tilt-up',
    'tilt-down',
    'dolly-in',
    'dolly-out',
    'truck-left',
    'truck-right',
    'orbit-cw',
    'orbit-ccw',
    'crane-up',
    'crane-down',
    'handheld-shake',
    'steadicam-follow',
    'static-hold',
    'subtle-drift',
    'push-in',
    'pull-out',
    'lateral-slide-left',
    'lateral-slide-right',
    'arc-left',
    'arc-right',
    'whip-pan',
    'snap-zoom',
    'parallax-reveal',
    'rack-focus',
    'handheld-run',
    'fpv-glide',
    'spiral-rise',
    'bullet-time',
  ],
  lens: [
    'ultra-wide-14mm',
    'wide-24mm',
    'normal-50mm',
    'portrait-85mm',
    'telephoto-135mm',
    'long-telephoto-200mm',
    'macro',
    'fisheye',
    'tilt-shift',
    'anamorphic',
    'vintage-soft',
    'pinhole',
  ],
  look: [
    'cinematic-realism',
    'anime-cel',
    'watercolor-ink',
    'oil-paint',
    'claymation',
    'pixel-art',
    'comic-book',
    'noir-film',
    'sci-fi-neon',
    'fantasy-epic',
    'documentary-gritty',
    'pastel-dream',
    'gothic-baroque',
    'minimal-clean',
    'retro-80s',
    'surreal-dali-esque',
    'teal-orange',
    'monochrome-cool',
    'monochrome-warm',
    'complementary-pop',
    'analogous-serene',
    'triadic-vibrant',
    'pastel-soft',
    'earth-tones',
    'neon-synthwave',
    'bleach-bypass',
    'sepia-vintage',
    'high-contrast-bw',
    'smooth-polished',
    'matte-flat',
    'grainy-film',
    'rough-grit',
    'glossy-wet',
    'velvet-soft',
    'metallic-brushed',
    'paper-fiber',
    'ceramic-glaze',
    'glass-crisp',
    'concrete-porous',
    'fabric-weave',
    'wes-anderson-pastel',
    'wong-karwai-neon',
    'kubrick-symmetry',
    'shinkai-luminous',
    'kodak-portra-400',
    'cinestill-800t',
    'fujifilm-eterna',
    'ilford-hp5',
    'french-new-wave',
    'y2k-chrome',
    'vaporwave',
    'brutalist-concrete',
    'stop-motion-clay',
    'cross-stitch',
    'rotoscope',
    'needle-felt',
  ],
  scene: [
    'golden-hour',
    'blue-hour',
    'high-key',
    'low-key',
    'rim-light',
    'silhouette',
    'split-lighting',
    'butterfly-lighting',
    'rembrandt-lighting',
    'volumetric-godrays',
    'neon-noir',
    'candlelit',
    'moonlit',
    'overcast-soft',
    'fog-light',
    'fog-heavy',
    'rain-light',
    'rain-heavy',
    'snow-gentle',
    'snow-blizzard',
    'dust-particles',
    'smoke',
    'fire-embers',
    'underwater',
    'wind-leaves',
    'fireflies',
    'sandstorm',
    'aurora',
  ],
  composition: [
    'rule-of-thirds',
    'center-frame',
    'golden-ratio',
    'leading-lines',
    'dutch-angle',
    'negative-space',
    'symmetrical',
    'frame-within-frame',
    'over-the-shoulder',
    'extreme-close-up',
  ],
  emotion: [
    'neutral',
    'hopeful',
    'tense',
    'awe',
    'melancholic',
    'euphoric',
    'ominous',
    'intimate',
    'triumphant',
    'playful',
    'reflective',
    'urgent',
  ],
  flow: [
    'linger',
    'measured',
    'conversational',
    'energetic',
    'frantic',
    'rhythmic-pulse',
    'stop-and-breathe',
    'acceleration-ramp',
    'deceleration-ramp',
    'montage-beat',
    'hard-cut',
    'match-cut',
    'jump-cut',
    'crossfade',
    'dip-to-black',
    'dip-to-white',
    'wipe-left',
    'wipe-right',
    'whip-pan-transition',
    'morph',
    'glitch-cut',
    'film-burn',
    'luma-fade',
    'iris-close',
  ],
  technical: [
    'cinematic-scope-239',
    'standard-wide-169',
    'academy-43',
    'vertical-mobile-916',
    'square-11',
    'imax-143',
    'ultra-wide-219',
    'draft',
    'standard',
    'high-fidelity',
    'max-detail',
    'turbo-preview',
  ],
} as const satisfies Record<PresetCategory, readonly string[]>;

const CATEGORY_PROMPT_HINT: Record<PresetCategory, string> = {
  camera: 'camera movement, shot trajectory, and kinetic dynamics',
  lens: 'optical rendering, focal behavior, and depth cues',
  look: 'art-direction language, color palette, and surface texture',
  scene: 'lighting setup, weather, atmosphere, and ambient conditions',
  composition: 'subject placement, geometry, and framing balance',
  emotion: 'emotional tone, expressive body language, and atmosphere',
  flow: 'rhythm, cuts, transitions, and narrative cadence',
  technical: 'render quality, frame ratio, and output configuration',
};

const INTENSITY_PARAM: PresetParamDefinition = {
  key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 100, defaultValue: 100,
};

const CATEGORY_PARAM_DEFS: Record<PresetCategory, PresetParamDefinition[]> = {
  camera: [
    { key: 'speed', label: 'Speed', type: 'enum', options: ['slow', 'medium', 'fast'], defaultValue: 'medium' },
    INTENSITY_PARAM,
    { key: 'amplitude', label: 'Amplitude', type: 'number', min: 0, max: 100, defaultValue: 40 },
  ],
  lens: [
    { key: 'focalLengthMm', label: 'Focal Length', type: 'number', min: 8, max: 400, defaultValue: 50 },
    { key: 'distortion', label: 'Distortion', type: 'number', min: 0, max: 100, defaultValue: 15 },
    INTENSITY_PARAM,
  ],
  look: [
    { key: 'stylization', label: 'Stylization', type: 'number', min: 0, max: 100, defaultValue: 65 },
    { key: 'saturation', label: 'Saturation', type: 'number', min: 0, max: 100, defaultValue: 55 },
    { key: 'temperature', label: 'Temperature', type: 'number', min: -100, max: 100, defaultValue: 0 },
    { key: 'detail', label: 'Detail', type: 'number', min: 0, max: 100, defaultValue: 60 },
    INTENSITY_PARAM,
  ],
  scene: [
    { key: 'lightIntensity', label: 'Light Intensity', type: 'number', min: 0, max: 100, defaultValue: 70 },
    { key: 'contrast', label: 'Contrast', type: 'number', min: 0, max: 100, defaultValue: 45 },
    { key: 'density', label: 'Density', type: 'number', min: 0, max: 100, defaultValue: 45 },
    INTENSITY_PARAM,
  ],
  composition: [
    { key: 'balance', label: 'Balance', type: 'number', min: 0, max: 100, defaultValue: 50 },
    { key: 'bias', label: 'Subject Bias', type: 'enum', options: ['left', 'center', 'right'], defaultValue: 'center' },
    INTENSITY_PARAM,
  ],
  emotion: [
    { key: 'emotionIntensity', label: 'Emotion Intensity', type: 'number', min: 0, max: 100, defaultValue: 50 },
    { key: 'stability', label: 'Stability', type: 'number', min: 0, max: 100, defaultValue: 60 },
    INTENSITY_PARAM,
  ],
  flow: [
    { key: 'tempo', label: 'Tempo', type: 'number', min: 1, max: 10, defaultValue: 5 },
    { key: 'durationMs', label: 'Duration', type: 'number', min: 100, max: 5000, defaultValue: 900 },
    { key: 'softness', label: 'Softness', type: 'number', min: 0, max: 100, defaultValue: 40 },
    INTENSITY_PARAM,
  ],
  technical: [
    {
      key: 'ratio',
      label: 'Ratio',
      type: 'enum',
      options: ['2.39:1', '16:9', '4:3', '9:16', '1:1', '1.43:1', '21:9'],
      defaultValue: '16:9',
    },
    { key: 'quality', label: 'Quality', type: 'enum', options: ['low', 'medium', 'high', 'ultra'], defaultValue: 'medium' },
    { key: 'steps', label: 'Steps', type: 'number', min: 5, max: 80, defaultValue: 20 },
    { key: 'cfg', label: 'CFG', type: 'number', min: 1, max: 20, defaultValue: 7 },
    INTENSITY_PARAM,
  ],
};

const CATEGORY_DEFAULTS: Record<PresetCategory, PresetParamMap> = {
  camera: { speed: 'medium', intensity: 100, amplitude: 40 },
  lens: { focalLengthMm: 50, distortion: 15, intensity: 100 },
  look: { stylization: 65, saturation: 55, temperature: 0, detail: 60, intensity: 100 },
  scene: { lightIntensity: 70, contrast: 45, density: 45, intensity: 100 },
  composition: { balance: 50, bias: 'center', intensity: 100 },
  emotion: { emotionIntensity: 50, stability: 60, intensity: 100 },
  flow: { tempo: 5, durationMs: 900, softness: 40, intensity: 100 },
  technical: { ratio: '16:9', quality: 'medium', steps: 20, cfg: 7, intensity: 100 },
};

const ASPECT_RATIO_BY_NAME: Record<string, string> = {
  'cinematic-scope-239': '2.39:1',
  'standard-wide-169': '16:9',
  'academy-43': '4:3',
  'vertical-mobile-916': '9:16',
  'square-11': '1:1',
  'imax-143': '1.43:1',
  'ultra-wide-219': '21:9',
  'social-45': '4:5',
  'classic-32': '3:2',
  'portrait-23': '2:3',
  'panorama-329': '32:9',
  'ultratall-921': '9:21',
};

function toTitleCase(value: string): string {
  return value
    .split('-')
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function buildPresetId(category: PresetCategory, name: string): string {
  return `builtin-${category}-${name}`;
}

function buildPresetDescription(category: PresetCategory, name: string): string {
  return `${toTitleCase(name)} preset for ${category} control with production-ready defaults.`;
}

const PRESET_PROMPT_LIBRARY: Record<string, string> = {
  // ── camera (was camera + motion) ──
  'camera:zoom-in': 'smooth camera zoom in toward the subject, gradually tightening framing while maintaining focus',
  'camera:zoom-out': 'camera steadily zooms out revealing the wider scene and surrounding environment',
  'camera:pan-left': 'camera pans horizontally to the left, sweeping across the scene in a smooth lateral rotation',
  'camera:pan-right': 'camera pans horizontally to the right, revealing new elements across the frame',
  'camera:tilt-up': 'camera tilts upward from ground level, gradually revealing height and vertical scale',
  'camera:tilt-down': 'camera tilts downward, descending from an elevated view toward ground level',
  'camera:dolly-in': 'camera physically moves forward toward the subject on a dolly track, creating depth parallax',
  'camera:dolly-out': 'camera pulls back on a dolly track, creating increasing distance and depth separation',
  'camera:truck-left': 'camera trucks laterally to the left, moving parallel to the subject maintaining constant distance',
  'camera:truck-right': 'camera trucks laterally to the right, tracking alongside the scene in a smooth lateral glide',
  'camera:orbit-cw': 'camera orbits clockwise around the subject, revealing it from continuously shifting angles',
  'camera:orbit-ccw': 'camera orbits counter-clockwise around the subject, circling with fluid motion',
  'camera:crane-up': 'camera rises vertically on a crane, ascending above the scene for an elevated perspective',
  'camera:crane-down': 'camera descends vertically on a crane, lowering from an aerial view toward ground level',
  'camera:handheld-shake': 'handheld camera with subtle organic shake, giving a raw documentary feel',
  'camera:steadicam-follow': 'smooth steadicam following the subject, gliding through the scene with fluid stabilization',
  'camera:static-hold': 'camera holds completely still, locked-off static shot with no movement',
  'camera:subtle-drift': 'gentle barely perceptible camera drift, slow floating movement adding organic life to the frame',
  'camera:push-in': 'camera slowly pushes forward into the scene, gradually closing distance to the subject',
  'camera:pull-out': 'camera slowly pulls backward, widening the view and revealing surrounding context',
  'camera:lateral-slide-left': 'smooth lateral camera slide to the left, horizontal tracking motion revealing depth parallax',
  'camera:lateral-slide-right': 'smooth lateral camera slide to the right, horizontal tracking with layered depth separation',
  'camera:arc-left': 'camera arcs to the left around the subject in a curved path, shifting perspective smoothly',
  'camera:arc-right': 'camera arcs to the right around the subject in a curved path, revealing new angles',
  'camera:whip-pan': 'rapid whip pan with motion blur, fast rotational camera sweep creating energetic transition',
  'camera:snap-zoom': 'sudden fast snap zoom toward the subject, impactful punch-in creating dramatic emphasis',
  'camera:parallax-reveal': 'parallax motion where foreground and background layers move at different speeds, revealing depth',
  'camera:rack-focus': 'rack focus shifting between foreground and background subjects, redirecting attention through depth',
  'camera:handheld-run': 'running handheld camera with pronounced bounce and shake, urgent kinetic chase energy',
  'camera:fpv-glide': 'smooth FPV drone-style forward glide, flowing through the environment at speed with stable horizon',
  'camera:spiral-rise': 'camera spirals upward in a rising helical path, combining rotation with vertical ascent',
  'camera:bullet-time': 'bullet-time frozen moment with camera rotating around a suspended instant in time',

  // ── lens ──
  'lens:ultra-wide-14mm': 'ultra-wide 14mm lens, expansive field of view with barrel distortion at edges, dramatic perspective exaggeration',
  'lens:wide-24mm': 'wide-angle 24mm lens, broad perspective with subtle depth exaggeration and environmental context',
  'lens:normal-50mm': '50mm standard lens, natural human-eye perspective with minimal distortion, balanced depth of field',
  'lens:portrait-85mm': '85mm portrait lens, flattering compression with creamy shallow depth of field and soft background bokeh',
  'lens:telephoto-135mm': '135mm telephoto lens, compressed perspective flattening depth layers, isolating the subject',
  'lens:long-telephoto-200mm': '200mm telephoto lens, extreme perspective compression with heavily blurred background, narrow depth of field',
  'lens:macro': 'macro lens extreme close-up, revealing fine surface detail and textures at microscopic scale, paper-thin depth of field',
  'lens:fisheye': 'fisheye lens with extreme spherical barrel distortion, 180-degree field of view, curving all straight lines',
  'lens:tilt-shift': 'tilt-shift lens creating selective focus plane, miniature diorama effect with sharp band of focus',
  'lens:anamorphic': 'anamorphic lens with horizontal lens flares, oval bokeh, and subtle barrel squeeze creating widescreen cinematic feel',
  'lens:vintage-soft': 'vintage soft-focus lens with gentle halation around highlights, dreamy glow, and reduced contrast',
  'lens:pinhole': 'pinhole camera effect, infinite depth of field with soft overall rendering and natural vignette',

  // ── look (was style + color + texture) ──
  'look:cinematic-realism': 'photorealistic cinematic quality, film grain, natural color grading, shallow depth of field, anamorphic lens flares',
  'look:anime-cel': 'anime cel-shaded style, bold outlines, flat color fills, vibrant saturated palette, expressive stylized features',
  'look:watercolor-ink': 'watercolor and ink wash style, flowing wet-on-wet pigment bleeds, visible paper texture, organic edges',
  'look:oil-paint': 'oil painting style, visible thick impasto brushstrokes, rich layered pigments, canvas texture, classical technique',
  'look:claymation': 'claymation stop-motion style, soft rounded forms, visible finger impressions, warm tactile clay surfaces',
  'look:pixel-art': 'pixel art retro style, crisp pixel-perfect grid, limited color palette, 8-bit aesthetic with dithering',
  'look:comic-book': 'comic book illustration style, bold ink outlines, halftone dot shading, dynamic action poses, speech bubble aesthetic',
  'look:noir-film': 'film noir black-and-white style, high contrast shadows, venetian blind patterns, hard-boiled detective atmosphere',
  'look:sci-fi-neon': 'sci-fi neon cyberpunk style, glowing neon accents, holographic interfaces, dark metallic surfaces, futuristic tech',
  'look:fantasy-epic': 'epic fantasy illustration style, sweeping landscapes, dramatic magical lighting, ornate detailed armor and architecture',
  'look:documentary-gritty': 'gritty documentary style, raw handheld feel, available light, desaturated realistic tones, unpolished authenticity',
  'look:pastel-dream': 'pastel dreamlike style, soft muted pastel colors, ethereal glow, gentle gradients, serene floating quality',
  'look:gothic-baroque': 'gothic baroque style, ornate dramatic architecture, deep shadows, rich gold and crimson, religious gravitas',
  'look:minimal-clean': 'minimal clean design style, white space, geometric simplicity, crisp edges, reduced palette, modern restraint',
  'look:retro-80s': 'retro 1980s style, VHS grain, scan lines, synthwave neon gradients, chrome reflections, nostalgia aesthetic',
  'look:surreal-dali-esque': 'surrealist Dali-esque style, impossible geometry, melting forms, dreamscape logic, uncanny juxtaposition',
  'look:teal-orange': 'teal and orange color grading, complementary cool shadows against warm highlights, cinematic blockbuster palette',
  'look:monochrome-cool': 'cool monochrome palette, blue-grey single-hue range with cold steel and ice undertones',
  'look:monochrome-warm': 'warm monochrome palette, amber-sepia single-hue range with golden and umber earth tones',
  'look:complementary-pop': 'complementary color pop, opposing hue pair creating vibrant visual tension and eye-catching contrast',
  'look:analogous-serene': 'analogous serene color harmony, neighboring hues blending smoothly for calm unified palette',
  'look:triadic-vibrant': 'triadic vibrant color scheme, three evenly spaced hues creating dynamic balanced chromatic energy',
  'look:pastel-soft': 'soft pastel color palette, gentle muted tints with low saturation, airy and delicate',
  'look:earth-tones': 'natural earth tone palette, warm browns, olive greens, terracotta, and ochre, organic grounded feel',
  'look:neon-synthwave': 'neon synthwave palette, electric pink, cyan, and purple against deep black, retro-futuristic glow',
  'look:bleach-bypass': 'bleach bypass look, desaturated silvery highlights with increased contrast, muted color and metallic sheen',
  'look:sepia-vintage': 'sepia vintage toning, warm brownish-yellow monochrome evoking aged photographs and nostalgia',
  'look:high-contrast-bw': 'high contrast black and white, deep pure blacks and bright whites with minimal mid-tones',
  'look:smooth-polished': 'smooth polished surface finish, sleek reflective quality with clean uniform appearance',
  'look:matte-flat': 'matte flat surface, non-reflective diffuse finish absorbing light evenly without glare',
  'look:grainy-film': 'analog film grain texture, organic photographic noise with varying grain size and density',
  'look:rough-grit': 'rough gritty surface texture, coarse irregular particles with tactile abrasive character',
  'look:glossy-wet': 'glossy wet surface, specular reflections with liquid sheen and mirror-like highlights',
  'look:velvet-soft': 'soft velvet texture, plush micro-fiber surface absorbing light with rich deep shadows in folds',
  'look:metallic-brushed': 'brushed metallic texture, directional fine scratches on metal surface with anisotropic reflections',
  'look:paper-fiber': 'paper fiber texture, visible cellulose grain and subtle surface irregularities of fine art paper',
  'look:ceramic-glaze': 'ceramic glaze finish, smooth vitreous coating with subtle crazing pattern and pooled depth variation',
  'look:glass-crisp': 'crisp glass surface, transparent refractive material with sharp reflections and caustic light patterns',
  'look:concrete-porous': 'porous concrete texture, rough aggregate surface with air pockets and mineral variation',
  'look:fabric-weave': 'woven fabric texture, visible thread interlocking pattern with textile drape and fiber detail',
  'look:wes-anderson-pastel': 'symmetrical centered one-point composition, pastel warm yellows and pinks, flat even diffused lighting with no harsh shadows, precise deadpan framing, storybook whimsy, Kodak Vision3 250D color science',
  'look:wong-karwai-neon': 'smeared neon reflections on wet surfaces, step-printed motion blur on subject, saturated deep reds and smoky greens, expired film grain, 135mm telephoto compression isolating protagonist in crowd, CineStill 800T halation',
  'look:kubrick-symmetry': 'strict one-point perspective symmetry, cold clinical overhead lighting with no fill, wide-angle 18mm lens distortion, deep shadow corridors converging to vanishing point, unsettling geometric precision',
  'look:shinkai-luminous': 'hyper-detailed luminous sky gradients with vivid blues and oranges, dust motes floating and glowing in golden backlight, cinematic anime still quality, volumetric god rays through clouds, Tyndall effect atmosphere',
  'look:kodak-portra-400': 'Kodak Portra 400 film color science, warm natural skin tones with gentle highlight rolloff, soft organic grain, lifted shadows with creamy mid-tones, slightly warm color temperature bias',
  'look:cinestill-800t': 'CineStill 800T tungsten-balanced color science, red halation halos bleeding around practical light sources, warm orange skin tones against cool blue shadows, cinematic night atmosphere with visible grain',
  'look:fujifilm-eterna': 'Fujifilm Eterna color grading, cool muted desaturated tones, restrained cinematic palette with subtle green-blue cast in shadows, low contrast rolloff, documentary restraint',
  'look:ilford-hp5': 'Ilford HP5 black and white film, rich organic grain structure, deep pure blacks with bright whites, high dynamic range, classic analog texture with natural tonal separation',
  'look:french-new-wave': 'handheld natural available light, casual spontaneous framing with slight imperfection, desaturated documentary realism, jump-cut aesthetic energy, 35mm wide lens, Fujifilm Eterna muted tones',
  'look:y2k-chrome': 'brushed chrome and iridescent metallic surfaces, cold blue-teal color grading, soft-focus halation around highlights, chromatic aberration at edges, retro-futurist millennium aesthetic, long exposure light trails',
  'look:vaporwave': 'pastel pink and purple gradient atmosphere, glitch artifact overlays, lo-fi digital dreamscape, greek statue motifs, 80s nostalgia grid lines, low saturation with neon accent pops',
  'look:brutalist-concrete': 'raw exposed concrete surfaces with aggregate texture, monumental geometric forms casting harsh directional shadows, oppressive architectural scale, minimal ornamentation, desaturated cool palette',
  'look:stop-motion-clay': 'plasticine clay figures with visible fingerprint impressions on surface, low frame rate jitter at 8fps, warm practical tungsten lighting, handmade tactile imperfection, stop-motion animation aesthetic',
  'look:cross-stitch': 'dense colored cotton thread on Aida cloth grid, X-shaped stitch pattern visible at pixel level, slight fabric weave texture beneath, craft textile aesthetic with warm thread sheen variation between rows',
  'look:rotoscope': 'hand-traced animation over live footage, painterly organic line art with fluid movement, semi-transparent layered color fills, visible brush stroke quality, rotoscope animation style',
  'look:needle-felt': 'coarse mixed-color wool fibers with fuzzy soft surface detail, needle-felted texture with visible fiber direction, handmade doll aesthetic, warm diffused lighting on tactile craft surface',

  // ── scene (was lighting + environment) ──
  'scene:golden-hour': 'warm golden hour sunlight, low sun angle casting long shadows with rich amber and orange tones',
  'scene:blue-hour': 'cool blue hour twilight, soft diffused ambient light with deep blue and indigo atmospheric tones',
  'scene:high-key': 'bright high-key lighting, minimal shadows with even illumination and clean white tones',
  'scene:low-key': 'dramatic low-key lighting, deep shadows with selective illumination creating strong chiaroscuro contrast',
  'scene:rim-light': 'strong rim light outlining the subject edges with a bright halo, separating from background',
  'scene:silhouette': 'backlit silhouette, subject rendered as a dark shape against a bright luminous background',
  'scene:split-lighting': 'split lighting dividing the face or subject into equal halves of light and shadow',
  'scene:butterfly-lighting': 'butterfly lighting from directly above creating a shadow beneath the nose, glamorous Paramount style',
  'scene:rembrandt-lighting': 'Rembrandt lighting with a triangular highlight on the shadowed cheek, classic painterly illumination',
  'scene:volumetric-godrays': 'volumetric god rays piercing through atmosphere, visible shafts of light with dust particles',
  'scene:neon-noir': 'neon-lit noir atmosphere, colored neon reflections on wet surfaces with deep urban shadows',
  'scene:candlelit': 'warm candlelight illumination, flickering soft amber glow with intimate close-range falloff',
  'scene:moonlit': 'cool moonlight casting pale silver-blue illumination with soft long shadows in night setting',
  'scene:overcast-soft': 'soft overcast diffused lighting, even illumination with minimal shadows and neutral color temperature',
  'scene:fog-light': 'light atmospheric fog, soft mist reducing visibility with gentle diffused depth haze',
  'scene:fog-heavy': 'dense heavy fog, thick obscuring mist severely limiting visibility with ethereal atmosphere',
  'scene:rain-light': 'light rain falling, fine gentle raindrops with wet reflective surfaces and overcast sky',
  'scene:rain-heavy': 'heavy downpour rain, intense rainfall with splashing puddles, streaming water, and reduced visibility',
  'scene:snow-gentle': 'gentle snowfall, soft floating snowflakes drifting slowly with quiet winter atmosphere',
  'scene:snow-blizzard': 'blizzard whiteout conditions, driving horizontal snow with fierce wind and near-zero visibility',
  'scene:dust-particles': 'floating dust particles catching light, visible motes suspended in sunbeams with warm atmosphere',
  'scene:smoke': 'wisps of smoke drifting through the scene, curling translucent haze with atmospheric depth',
  'scene:fire-embers': 'glowing fire embers floating upward, hot orange sparks drifting against dark surroundings',
  'scene:underwater': 'underwater environment, caustic light patterns on surfaces, floating particles, blue-green color cast',
  'scene:wind-leaves': 'wind-blown leaves and debris, organic particles carried by breeze with dynamic natural motion',
  'scene:fireflies': 'bioluminescent fireflies floating, small glowing points of warm light in dark natural setting',
  'scene:sandstorm': 'sandstorm atmosphere, dense swirling sand particles with reduced visibility and warm amber haze',
  'scene:aurora': 'aurora borealis in the sky, shimmering curtains of green and purple light across the polar night',

  // ── composition ──
  'composition:rule-of-thirds': 'subject placed at rule-of-thirds intersection point, balanced asymmetric composition',
  'composition:center-frame': 'subject centered in frame with symmetrical balance, direct frontal composition',
  'composition:golden-ratio': 'composition following golden ratio spiral, subject at the natural focal convergence point',
  'composition:leading-lines': 'strong leading lines drawing the eye toward the subject, converging perspective guides',
  'composition:dutch-angle': 'tilted Dutch angle composition creating visual tension and unease, canted frame',
  'composition:negative-space': 'large areas of empty negative space surrounding the subject, minimalist isolated framing',
  'composition:symmetrical': 'perfectly symmetrical bilateral composition, mirrored balance across the center axis',
  'composition:frame-within-frame': 'subject framed within an architectural or natural secondary frame, layered depth',
  'composition:over-the-shoulder': 'over-the-shoulder framing with foreground figure partially visible, establishing spatial relationship',
  'composition:extreme-close-up': 'extreme close-up filling the frame with fine detail, intimate and intense framing',

  // ── emotion ──
  'emotion:neutral': 'neutral balanced atmosphere, calm and objective with no strong emotional weight',
  'emotion:hopeful': 'hopeful uplifting atmosphere, warm light with open airy composition suggesting optimism and possibility',
  'emotion:tense': 'tense suspenseful atmosphere, tight framing with shadows and restrained movement building anxiety',
  'emotion:awe': 'awe-inspiring grandeur, vast scale with dramatic light revealing something magnificent and overwhelming',
  'emotion:melancholic': 'melancholic somber mood, muted desaturated tones with slow contemplative movement and weight',
  'emotion:euphoric': 'euphoric joyful energy, bright vivid colors with dynamic movement and radiant light',
  'emotion:ominous': 'ominous foreboding atmosphere, dark shadows with low angles and unsettling tension building dread',
  'emotion:intimate': 'intimate close personal atmosphere, soft shallow focus with warm tones and gentle proximity',
  'emotion:triumphant': 'triumphant victorious energy, powerful upward angles with bold heroic light and grand scale',
  'emotion:playful': 'playful lighthearted mood, bright saturated colors with bouncy dynamic movement and whimsy',
  'emotion:reflective': 'reflective introspective atmosphere, still quiet moments with soft natural light and thoughtful framing',
  'emotion:urgent': 'urgent pressing atmosphere, rapid movement with tight framing and heightened intensity driving forward',

  // ── flow (was pacing + transition) ──
  'flow:linger': 'slow lingering pace, extended held moments allowing the scene to breathe with contemplative rhythm',
  'flow:measured': 'measured deliberate pacing, controlled steady rhythm with purposeful timing between beats',
  'flow:conversational': 'natural conversational pace, relaxed flowing rhythm matching dialogue and interaction tempo',
  'flow:energetic': 'energetic quick pace, brisk cuts and movements with dynamic forward momentum',
  'flow:frantic': 'frantic rapid-fire pacing, chaotic urgency with fast cuts and intense compressed timing',
  'flow:rhythmic-pulse': 'rhythmic pulsing pace, beats hitting at regular musical intervals creating hypnotic cadence',
  'flow:stop-and-breathe': 'alternating between motion and stillness, punctuated pauses creating dramatic breathing room',
  'flow:acceleration-ramp': 'gradually accelerating pace, starting slow and building speed toward a climactic peak',
  'flow:deceleration-ramp': 'gradually decelerating pace, slowing from fast action into a calm contemplative stillness',
  'flow:montage-beat': 'montage-style rhythmic cutting, quick sequential shots building narrative through juxtaposition',
  'flow:hard-cut': 'sharp instantaneous cut with no transition effect, direct immediate scene change',
  'flow:match-cut': 'match cut linking visually similar shapes or movements between shots for seamless continuity',
  'flow:jump-cut': 'jump cut creating abrupt temporal skip, jarring forward leap within the same scene',
  'flow:crossfade': 'smooth crossfade dissolve blending two shots together, gradual opacity transition',
  'flow:dip-to-black': 'fade to black transition, scene darkening to full black before the next shot emerges',
  'flow:dip-to-white': 'fade to white transition, scene brightening to pure white before revealing the next shot',
  'flow:wipe-left': 'horizontal wipe transition sweeping left, new scene sliding in from the right edge',
  'flow:wipe-right': 'horizontal wipe transition sweeping right, new scene sliding in from the left edge',
  'flow:whip-pan-transition': 'fast whip pan blur connecting two shots, motion-blur wipe creating energetic continuity',
  'flow:morph': 'morphing transition smoothly warping one scene shape into the next, fluid deformation blend',
  'flow:glitch-cut': 'digital glitch transition with pixel distortion, chromatic aberration, and data corruption artifacts',
  'flow:film-burn': 'film burn transition with organic light leak, warm overexposed chemical film degradation',
  'flow:luma-fade': 'luminance-based fade transition, bright areas dissolving first creating ethereal depth-aware blend',
  'flow:iris-close': 'circular iris closing transition, frame constricting to a point before opening on the next scene',

  // ── technical (was aspect-ratio + quality) ──
  'technical:cinematic-scope-239': '2.39:1 anamorphic cinemascope widescreen framing, ultra-wide horizontal composition',
  'technical:standard-wide-169': '16:9 standard widescreen framing, modern broadcast and web display composition',
  'technical:academy-43': '4:3 academy ratio framing, classic television and vintage film composition',
  'technical:vertical-mobile-916': '9:16 vertical portrait framing, mobile-first social media composition',
  'technical:square-11': '1:1 square framing, balanced equal-dimension composition for social media and gallery display',
  'technical:imax-143': '1.43:1 IMAX ratio framing, near-square tall format maximizing vertical field of view',
  'technical:ultra-wide-219': '21:9 ultra-widescreen framing, panoramic horizontal composition for immersive display',
  'technical:draft': 'low-fidelity draft quality, fast preview rendering with reduced detail for rapid iteration',
  'technical:standard': 'standard production quality, balanced detail and render time for general-purpose output',
  'technical:high-fidelity': 'high-fidelity quality, enhanced detail density with refined textures and precise rendering',
  'technical:max-detail': 'maximum detail ultra-quality, highest resolution rendering with full texture detail and precision',
  'technical:turbo-preview': 'turbo fast preview, minimal-step rapid generation for quick concept exploration',
};

const PRESET_TEMPLATE_LIBRARY: Record<string, {
  template: string;
  paramDefs: PresetPromptParamDef[];
  conflictGroup?: string;
}> = {
  // ── camera samples ──
  'camera:dolly-in': {
    template: '{speed} camera dolly in toward the subject, {depth_effect} depth parallax, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow creeping', 'smooth', 'brisk', 'rapid'] },
      { key: 'depth_effect', label: 'Depth Effect', type: 'intensity', default: 70, levels: { 0: 'minimal', 25: 'subtle', 50: 'noticeable', 75: 'pronounced', 100: 'dramatic layered' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on dolly track', options: ['on dolly track', 'handheld dolly', 'steadicam approach'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:orbit-cw': {
    template: 'camera orbits {speed} clockwise around the subject, {arc_width} arc, {elevation}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'arc_width', label: 'Arc Width', type: 'intensity', default: 50, levels: { 0: 'tight narrow', 25: 'quarter', 50: 'half', 75: 'three-quarter', 100: 'full 360-degree' } },
      { key: 'elevation', label: 'Elevation', type: 'select', default: 'at eye level', options: ['from below', 'at eye level', 'from slightly above', 'from high above'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:static-hold': {
    template: 'camera holds {stability} still, {framing} locked-off static shot',
    paramDefs: [
      { key: 'stability', label: 'Stability', type: 'select', default: 'completely', options: ['almost completely', 'completely', 'rock-solid'] },
      { key: 'framing', label: 'Framing', type: 'select', default: 'symmetrically', options: ['loosely', 'symmetrically', 'tightly'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:zoom-in': {
    template: '{speed} camera zoom in toward the subject, {tightness} tightening framing, {focus} focus',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow gradual', 'smooth', 'brisk', 'rapid snapping'] },
      { key: 'tightness', label: 'Tightness', type: 'intensity', default: 60, levels: { 0: 'barely', 25: 'slightly', 50: 'noticeably', 75: 'dramatically', 100: 'extremely tight' } },
      { key: 'focus', label: 'Focus', type: 'select', default: 'maintaining sharp focus', options: ['maintaining sharp focus', 'with rack focus', 'soft focus transition'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:zoom-out': {
    template: '{speed} camera zoom out from the subject, {expansion} widening frame, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow gradual', 'smooth', 'brisk', 'rapid'] },
      { key: 'expansion', label: 'Expansion', type: 'intensity', default: 60, levels: { 0: 'barely', 25: 'slightly', 50: 'noticeably', 75: 'dramatically', 100: 'fully wide revealing' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'smooth optical', options: ['smooth optical', 'on tripod', 'handheld'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:pan-left': {
    template: 'camera pans {speed} to the left, {arc} sweep, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'arc', label: 'Pan Arc', type: 'intensity', default: 50, levels: { 0: 'barely', 25: 'slight', 50: 'moderate', 75: 'wide sweeping', 100: 'full-frame panoramic' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on fluid head tripod', options: ['on fluid head tripod', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:pan-right': {
    template: 'camera pans {speed} to the right, {arc} sweep, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'arc', label: 'Pan Arc', type: 'intensity', default: 50, levels: { 0: 'barely', 25: 'slight', 50: 'moderate', 75: 'wide sweeping', 100: 'full-frame panoramic' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on fluid head tripod', options: ['on fluid head tripod', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:tilt-up': {
    template: 'camera tilts {speed} upward, {elevation} vertical arc, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'elevation', label: 'Elevation', type: 'intensity', default: 50, levels: { 0: 'barely', 25: 'slight', 50: 'moderate', 75: 'sweeping upward', 100: 'full vertical reveal' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on fluid head tripod', options: ['on fluid head tripod', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:tilt-down': {
    template: 'camera tilts {speed} downward, {declination} vertical arc, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'declination', label: 'Declination', type: 'intensity', default: 50, levels: { 0: 'barely', 25: 'slight', 50: 'moderate', 75: 'sweeping downward', 100: 'full vertical descent' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on fluid head tripod', options: ['on fluid head tripod', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:dolly-out': {
    template: '{speed} camera dolly out away from the subject, {depth_effect} depth parallax, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow creeping', 'smooth', 'brisk', 'rapid'] },
      { key: 'depth_effect', label: 'Depth Effect', type: 'intensity', default: 70, levels: { 0: 'minimal', 25: 'subtle', 50: 'noticeable', 75: 'pronounced', 100: 'dramatic layered' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on dolly track', options: ['on dolly track', 'handheld dolly', 'steadicam retreat'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:truck-left': {
    template: 'camera trucks {speed} laterally to the left, {distance} sideways travel, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'distance', label: 'Distance', type: 'intensity', default: 50, levels: { 0: 'barely a nudge', 25: 'short slide', 50: 'moderate travel', 75: 'wide lateral sweep', 100: 'full-frame crossing' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on dolly track', options: ['on dolly track', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:truck-right': {
    template: 'camera trucks {speed} laterally to the right, {distance} sideways travel, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'distance', label: 'Distance', type: 'intensity', default: 50, levels: { 0: 'barely a nudge', 25: 'short slide', 50: 'moderate travel', 75: 'wide lateral sweep', 100: 'full-frame crossing' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on dolly track', options: ['on dolly track', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:orbit-ccw': {
    template: 'camera orbits {speed} counter-clockwise around the subject, {arc_width} arc, {elevation}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'arc_width', label: 'Arc Width', type: 'intensity', default: 50, levels: { 0: 'tight narrow', 25: 'quarter', 50: 'half', 75: 'three-quarter', 100: 'full 360-degree' } },
      { key: 'elevation', label: 'Elevation', type: 'select', default: 'at eye level', options: ['from below', 'at eye level', 'from slightly above', 'from high above'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:crane-up': {
    template: 'camera cranes {speed} upward, {height_gain} vertical rise, {framing} framing throughout',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'height_gain', label: 'Height Gain', type: 'intensity', default: 60, levels: { 0: 'barely rising', 25: 'low rise', 50: 'moderate ascent', 75: 'high rise', 100: 'soaring vertical' } },
      { key: 'framing', label: 'Framing', type: 'select', default: 'subject-centered', options: ['wide environmental', 'subject-centered', 'downward looking'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:crane-down': {
    template: 'camera cranes {speed} downward, {depth_drop} vertical descent, {framing} framing throughout',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'depth_drop', label: 'Depth Drop', type: 'intensity', default: 60, levels: { 0: 'barely descending', 25: 'low drop', 50: 'moderate descent', 75: 'deep descent', 100: 'full dramatic drop' } },
      { key: 'framing', label: 'Framing', type: 'select', default: 'subject-centered', options: ['wide environmental', 'subject-centered', 'upward looking'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:handheld-shake': {
    template: 'handheld camera with {shake} organic movement, {rhythm} shakiness pattern, {focus} focus',
    paramDefs: [
      { key: 'shake', label: 'Shake Amount', type: 'intensity', default: 50, levels: { 0: 'barely perceptible', 25: 'slight tremor', 50: 'natural handheld', 75: 'heavy shake', 100: 'violent jitter' } },
      { key: 'rhythm', label: 'Rhythm', type: 'select', default: 'irregular organic', options: ['slow drift', 'irregular organic', 'quick nervous', 'erratic chaotic'] },
      { key: 'focus', label: 'Focus', type: 'select', default: 'maintained throughout', options: ['maintained throughout', 'occasional rack', 'slightly soft'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:steadicam-follow': {
    template: 'steadicam follows {speed} behind subject, {smoothness} fluid glide, {proximity} following distance',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'at pace', 'urgently'] },
      { key: 'smoothness', label: 'Smoothness', type: 'intensity', default: 85, levels: { 0: 'rough bouncing', 25: 'mostly smooth', 50: 'fluid', 75: 'gliding', 100: 'perfectly silky' } },
      { key: 'proximity', label: 'Proximity', type: 'select', default: 'medium distance', options: ['close over-shoulder', 'medium distance', 'far tracking'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:subtle-drift': {
    template: 'camera drifts {direction} with {drift} barely perceptible movement, {stabilization}',
    paramDefs: [
      { key: 'direction', label: 'Direction', type: 'select', default: 'slowly sideways', options: ['slowly sideways', 'gently forward', 'slightly rotating', 'softly floating'] },
      { key: 'drift', label: 'Drift Amount', type: 'intensity', default: 25, levels: { 0: 'imperceptible', 25: 'barely noticeable', 50: 'gentle', 75: 'noticeable', 100: 'deliberate slow drift' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'smooth electronic', options: ['smooth electronic', 'optical', 'minimal correction'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:push-in': {
    template: '{speed} push in toward the subject, {pressure} sense of enclosure, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow deliberate', 'smooth', 'urgent', 'rapid'] },
      { key: 'pressure', label: 'Pressure', type: 'intensity', default: 65, levels: { 0: 'casual', 25: 'gentle', 50: 'purposeful', 75: 'intense', 100: 'claustrophobic' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on track', options: ['on track', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:pull-out': {
    template: '{speed} pull out away from subject, {reveal} expanding reveal, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow gradual', 'smooth', 'brisk', 'rapid'] },
      { key: 'reveal', label: 'Reveal', type: 'intensity', default: 65, levels: { 0: 'minimal', 25: 'slight', 50: 'moderate', 75: 'broad', 100: 'epic wide reveal' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on track', options: ['on track', 'handheld', 'steadicam'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:lateral-slide-left': {
    template: 'camera slides {speed} laterally left, {distance} horizontal travel, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'distance', label: 'Distance', type: 'intensity', default: 50, levels: { 0: 'tiny nudge', 25: 'short slide', 50: 'moderate travel', 75: 'long sweep', 100: 'full-frame lateral' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on track', options: ['on track', 'slider', 'handheld'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:lateral-slide-right': {
    template: 'camera slides {speed} laterally right, {distance} horizontal travel, {stabilization}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly', 'rapidly'] },
      { key: 'distance', label: 'Distance', type: 'intensity', default: 50, levels: { 0: 'tiny nudge', 25: 'short slide', 50: 'moderate travel', 75: 'long sweep', 100: 'full-frame lateral' } },
      { key: 'stabilization', label: 'Stabilization', type: 'select', default: 'on track', options: ['on track', 'slider', 'handheld'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:arc-left': {
    template: 'camera arcs {speed} leftward around the subject, {arc_angle} arc sweep, {elevation}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'arc_angle', label: 'Arc Angle', type: 'intensity', default: 50, levels: { 0: 'barely curved', 25: 'slight arc', 50: 'quarter arc', 75: 'half arc', 100: 'sweeping full arc' } },
      { key: 'elevation', label: 'Elevation', type: 'select', default: 'at eye level', options: ['from below', 'at eye level', 'from above'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:arc-right': {
    template: 'camera arcs {speed} rightward around the subject, {arc_angle} arc sweep, {elevation}',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'arc_angle', label: 'Arc Angle', type: 'intensity', default: 50, levels: { 0: 'barely curved', 25: 'slight arc', 50: 'quarter arc', 75: 'half arc', 100: 'sweeping full arc' } },
      { key: 'elevation', label: 'Elevation', type: 'select', default: 'at eye level', options: ['from below', 'at eye level', 'from above'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:whip-pan': {
    template: '{speed} whip pan {direction}, {motion_blur} motion blur streak, {landing} landing frame',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'fast', options: ['fast', 'very fast', 'blistering'] },
      { key: 'motion_blur', label: 'Motion Blur', type: 'intensity', default: 80, levels: { 0: 'minimal', 25: 'slight streaking', 50: 'moderate blur', 75: 'heavy smear', 100: 'full trailing streak' } },
      { key: 'direction', label: 'Direction', type: 'select', default: 'horizontally', options: ['horizontally', 'diagonally upward', 'diagonally downward'] },
      { key: 'landing', label: 'Landing Frame', type: 'select', default: 'sharp cut-in', options: ['sharp cut-in', 'smooth settle', 'brief overshoot'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:snap-zoom': {
    template: '{speed} snap zoom {direction}, {punch} visual punch, {focus} focus on landing',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'rapid', options: ['fast', 'rapid', 'instantaneous'] },
      { key: 'punch', label: 'Punch', type: 'intensity', default: 80, levels: { 0: 'subtle', 25: 'noticeable', 50: 'impactful', 75: 'jarring', 100: 'extreme shock zoom' } },
      { key: 'direction', label: 'Direction', type: 'select', default: 'in toward subject', options: ['in toward subject', 'out from subject'] },
      { key: 'focus', label: 'Focus', type: 'select', default: 'sharp snap focus', options: ['sharp snap focus', 'rack focus', 'held sharp'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:parallax-reveal': {
    template: 'parallax reveal with {speed} lateral movement, {depth_layers} depth layering, {subject_reveal} subject emergence',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'slow', options: ['very slow', 'slow', 'moderate'] },
      { key: 'depth_layers', label: 'Depth Layers', type: 'intensity', default: 70, levels: { 0: 'flat single plane', 25: 'two-layer', 50: 'three-layer', 75: 'deep multi-layer', 100: 'cinematic full parallax' } },
      { key: 'subject_reveal', label: 'Subject Reveal', type: 'select', default: 'gradual emergence', options: ['sudden reveal', 'gradual emergence', 'slow atmospheric unveiling'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:rack-focus': {
    template: '{speed} rack focus {direction}, {transition} focus transition, {planes} focal planes',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow', 'smooth', 'quick snap'] },
      { key: 'direction', label: 'Direction', type: 'select', default: 'from foreground to background', options: ['from foreground to background', 'from background to foreground', 'between subjects'] },
      { key: 'transition', label: 'Transition', type: 'intensity', default: 60, levels: { 0: 'instant cut', 25: 'brief', 50: 'smooth', 75: 'lingering', 100: 'very slow drift' } },
      { key: 'planes', label: 'Focal Planes', type: 'select', default: 'distinct separation', options: ['close separation', 'distinct separation', 'wide separation'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:handheld-run': {
    template: 'running handheld camera with {bounce} vertical bounce, {urgency} sense of urgency, {focus} focus stability',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'at running pace', options: ['jogging pace', 'at running pace', 'sprinting pace'] },
      { key: 'bounce', label: 'Bounce', type: 'intensity', default: 65, levels: { 0: 'minimal', 25: 'slight bob', 50: 'natural running bounce', 75: 'heavy jarring', 100: 'chaotic frantic' } },
      { key: 'urgency', label: 'Urgency', type: 'intensity', default: 70, levels: { 0: 'casual', 25: 'purposeful', 50: 'urgent', 75: 'frantic', 100: 'desperate chase' } },
      { key: 'focus', label: 'Focus', type: 'select', default: 'mostly maintained', options: ['razor sharp', 'mostly maintained', 'occasionally lost'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:fpv-glide': {
    template: 'FPV drone {speed} glide through environment, {banking} banking turns, {altitude} flight altitude',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smooth', options: ['slow drifting', 'smooth', 'brisk', 'racing fast'] },
      { key: 'banking', label: 'Banking', type: 'intensity', default: 50, levels: { 0: 'level no bank', 25: 'subtle lean', 50: 'moderate banking', 75: 'aggressive lean', 100: 'extreme racing bank' } },
      { key: 'altitude', label: 'Altitude', type: 'select', default: 'low skimming', options: ['ground-level skimming', 'low skimming', 'mid-air', 'high sweeping'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:spiral-rise': {
    template: 'camera spirals {speed} upward and outward, {spiral_tightness} spiral path, {height} final height',
    paramDefs: [
      { key: 'speed', label: 'Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'briskly'] },
      { key: 'spiral_tightness', label: 'Spiral Tightness', type: 'intensity', default: 50, levels: { 0: 'very wide lazy spiral', 25: 'loose spiral', 50: 'moderate spiral', 75: 'tight corkscrew', 100: 'extremely tight rise' } },
      { key: 'height', label: 'Height', type: 'select', default: 'mid-height reveal', options: ['low sweep', 'mid-height reveal', 'soaring high overhead'] },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:bullet-time': {
    template: 'bullet-time effect, camera revolves {speed} around frozen or slow-motion subject, {revolution} arc covered, {subject_motion} subject motion',
    paramDefs: [
      { key: 'speed', label: 'Camera Speed', type: 'select', default: 'smoothly', options: ['slowly', 'smoothly', 'rapidly'] },
      { key: 'revolution', label: 'Revolution', type: 'intensity', default: 75, levels: { 0: 'slight rotation', 25: 'quarter turn', 50: 'half turn', 75: 'three-quarter sweep', 100: 'full 360-degree revolution' } },
      { key: 'subject_motion', label: 'Subject Motion', type: 'select', default: 'nearly frozen slow motion', options: ['completely frozen', 'nearly frozen slow motion', 'ultra-slow motion'] },
    ],
    conflictGroup: 'camera:primary',
  },

  // ── scene (lighting) samples ──
  'scene:high-key': {
    template: '{fill_strength} even fill lighting, {shadow_depth} shadows, {color_temp} white balance, {contrast} contrast ratio',
    paramDefs: [
      { key: 'fill_strength', label: 'Fill Strength', type: 'intensity', default: 80, levels: { 0: 'minimal', 25: 'moderate', 50: 'strong', 75: 'bright', 100: 'blazing overexposed' } },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 20, levels: { 0: 'no', 25: 'barely visible', 50: 'soft', 75: 'noticeable', 100: 'defined' } },
      { key: 'color_temp', label: 'Color Temperature', type: 'select', default: 'neutral', options: ['cool daylight', 'neutral', 'warm tungsten'] },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 25, levels: { 0: 'flat zero', 25: 'low', 50: 'moderate', 75: 'punchy', 100: 'extreme high' } },
    ],
    conflictGroup: 'scene:key-lighting',
  },
  'scene:low-key': {
    template: '{key_direction} dramatic key light, {shadow_depth} deep shadows, {fill_ratio} fill ratio, {mood} atmosphere',
    paramDefs: [
      { key: 'key_direction', label: 'Key Direction', type: 'select', default: 'side-angled', options: ['frontal', 'side-angled', 'overhead', 'low-raking'] },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 85, levels: { 0: 'light', 25: 'moderate', 50: 'heavy', 75: 'crushing', 100: 'near-total darkness' } },
      { key: 'fill_ratio', label: 'Fill Ratio', type: 'intensity', default: 20, levels: { 0: 'no fill', 25: 'faint bounce', 50: 'subtle ambient', 75: 'moderate fill', 100: 'balanced fill' } },
      { key: 'mood', label: 'Mood', type: 'select', default: 'dramatic', options: ['mysterious', 'dramatic', 'sinister', 'contemplative'] },
    ],
    conflictGroup: 'scene:key-lighting',
  },
  'scene:rim-light': {
    template: 'rim lighting from {direction}, {rim_width} luminous edge, {shadow_depth} shadows, {color_temp} color temperature',
    paramDefs: [
      { key: 'direction', label: 'Direction', type: 'select', default: 'behind', options: ['behind', 'behind-left', 'behind-right', 'above'] },
      { key: 'rim_width', label: 'Rim Width', type: 'intensity', default: 60, levels: { 0: 'hair-thin', 25: 'narrow', 50: 'medium', 75: 'wide', 100: 'broad dramatic' } },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 50, levels: { 0: 'no', 25: 'soft', 50: 'moderate', 75: 'deep', 100: 'crushing' } },
      { key: 'color_temp', label: 'Color Temperature', type: 'select', default: 'warm', options: ['cool blue', 'neutral', 'warm', 'golden'] },
    ],
  },

  // ── look samples ──
  'look:cinematic-realism': {
    template: 'photorealistic cinematic quality, {grain} film grain, {color_grade} color grading, {dof} depth of field, {flare} lens artifacts',
    paramDefs: [
      { key: 'grain', label: 'Film Grain', type: 'intensity', default: 50, levels: { 0: 'no', 25: 'faint', 50: 'subtle natural', 75: 'visible', 100: 'heavy 35mm' } },
      { key: 'color_grade', label: 'Color Grade', type: 'select', default: 'natural', options: ['desaturated', 'natural', 'warm golden', 'cool blue', 'teal-orange'] },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 60, levels: { 0: 'infinite sharp', 25: 'moderate', 50: 'shallow', 75: 'very shallow', 100: 'razor-thin bokeh' } },
      { key: 'flare', label: 'Lens Artifacts', type: 'intensity', default: 30, levels: { 0: 'none', 25: 'subtle', 50: 'visible anamorphic', 75: 'prominent', 100: 'dramatic JJ Abrams' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:anime-cel': {
    template: 'anime cel-shaded style, {outline} outlines, {color_fill} color fills, {saturation} palette, {expression} features',
    paramDefs: [
      { key: 'outline', label: 'Outline Weight', type: 'intensity', default: 75, levels: { 0: 'no', 25: 'thin subtle', 50: 'clean medium', 75: 'bold defined', 100: 'thick dramatic' } },
      { key: 'color_fill', label: 'Color Fill', type: 'select', default: 'flat', options: ['gradient shaded', 'flat', 'cel-shaded', 'watercolor blend'] },
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 80, levels: { 0: 'muted desaturated', 25: 'soft', 50: 'moderate', 75: 'vibrant saturated', 100: 'hyper-vivid' } },
      { key: 'expression', label: 'Expression Style', type: 'select', default: 'expressive stylized', options: ['realistic proportioned', 'semi-stylized', 'expressive stylized', 'chibi exaggerated'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:watercolor-ink': {
    template: 'watercolor and ink wash style, {bleed} wet-on-wet pigment bleeds, {paper_texture} paper texture, {edge_quality} edges',
    paramDefs: [
      { key: 'bleed', label: 'Bleed Amount', type: 'intensity', default: 70, levels: { 0: 'no', 25: 'subtle controlled', 50: 'flowing', 75: 'heavy organic', 100: 'uncontrolled pooling' } },
      { key: 'paper_texture', label: 'Paper Texture', type: 'intensity', default: 60, levels: { 0: 'no visible', 25: 'faint', 50: 'visible', 75: 'prominent rough', 100: 'heavy textured' } },
      { key: 'edge_quality', label: 'Edge Quality', type: 'select', default: 'organic soft', options: ['crisp defined', 'organic soft', 'feathered bleeding', 'rough torn'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:oil-paint': {
    template: 'oil painting style, {brushstroke} brushstrokes, {impasto} impasto thickness, {detail} surface detail',
    paramDefs: [
      { key: 'brushstroke', label: 'Brushstroke', type: 'select', default: 'expressive visible', options: ['smooth blended', 'expressive visible', 'palette knife', 'thick gestural'] },
      { key: 'impasto', label: 'Impasto Thickness', type: 'intensity', default: 65, levels: { 0: 'smooth flat', 25: 'subtle texture', 50: 'moderate relief', 75: 'heavy buildup', 100: 'sculptural thick' } },
      { key: 'detail', label: 'Detail Level', type: 'intensity', default: 70, levels: { 0: 'loose abstract', 25: 'gestural', 50: 'painterly', 75: 'refined', 100: 'photorealistic technique' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:claymation': {
    template: 'claymation stop-motion style, {surface_quality} clay surface, {stylization} form stylization, {lighting} warm lighting',
    paramDefs: [
      { key: 'surface_quality', label: 'Surface Quality', type: 'select', default: 'textured fingerprints', options: ['smooth clean', 'textured fingerprints', 'rough handmade', 'cracked aged'] },
      { key: 'stylization', label: 'Stylization', type: 'intensity', default: 75, levels: { 0: 'semi-realistic', 25: 'slightly rounded', 50: 'stylized', 75: 'exaggerated', 100: 'fully abstract clay' } },
      { key: 'lighting', label: 'Lighting Quality', type: 'intensity', default: 60, levels: { 0: 'flat even', 25: 'soft diffused', 50: 'warm practical', 75: 'dramatic directional', 100: 'theatrical spotlight' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:pixel-art': {
    template: 'pixel art retro style, {resolution} pixel grid, {palette_size} color palette, {dithering} dithering',
    paramDefs: [
      { key: 'resolution', label: 'Pixel Resolution', type: 'select', default: '16x16 tile', options: ['8x8 ultra-low', '16x16 tile', '32x32 medium', '64x64 detailed'] },
      { key: 'palette_size', label: 'Palette Size', type: 'select', default: '16-color', options: ['4-color gameboy', '8-color limited', '16-color', '32-color rich'] },
      { key: 'dithering', label: 'Dithering', type: 'intensity', default: 50, levels: { 0: 'no dithering', 25: 'subtle', 50: 'moderate ordered', 75: 'heavy pattern', 100: 'full noise dither' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:comic-book': {
    template: 'comic book illustration style, {outline} ink outlines, {halftone} halftone shading, {color_style} coloring',
    paramDefs: [
      { key: 'outline', label: 'Ink Outline', type: 'intensity', default: 80, levels: { 0: 'no outline', 25: 'thin inked', 50: 'clean bold', 75: 'heavy emphatic', 100: 'ultra-thick dramatic' } },
      { key: 'halftone', label: 'Halftone Shading', type: 'intensity', default: 65, levels: { 0: 'no halftone', 25: 'faint dot pattern', 50: 'classic halftone', 75: 'prominent dots', 100: 'Ben-Day dominant' } },
      { key: 'color_style', label: 'Color Style', type: 'select', default: 'flat primary', options: ['black and white', 'flat primary', 'painted covers', 'digital modern'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:noir-film': {
    template: 'film noir black-and-white style, {contrast} high contrast shadows, {shadow_pattern} shadow patterns, {atmosphere} atmosphere',
    paramDefs: [
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 85, levels: { 0: 'flat grey', 25: 'moderate', 50: 'strong', 75: 'high contrast', 100: 'pure black and white extreme' } },
      { key: 'shadow_pattern', label: 'Shadow Pattern', type: 'select', default: 'venetian blind slats', options: ['clean pools', 'venetian blind slats', 'geometric hard shadows', 'atmospheric fog patches'] },
      { key: 'atmosphere', label: 'Atmosphere', type: 'select', default: 'rain-slicked streets', options: ['dry stark interior', 'rain-slicked streets', 'smoky bar', 'foggy alley'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:sci-fi-neon': {
    template: 'sci-fi neon cyberpunk style, {neon_intensity} neon glow, {surface} metallic surfaces, {hud_elements} holographic elements',
    paramDefs: [
      { key: 'neon_intensity', label: 'Neon Intensity', type: 'intensity', default: 75, levels: { 0: 'minimal accent', 25: 'subtle glow', 50: 'vibrant neon', 75: 'saturated bloom', 100: 'overloaded neon' } },
      { key: 'surface', label: 'Surface Material', type: 'select', default: 'dark metallic', options: ['matte black', 'dark metallic', 'chrome reflective', 'carbon fiber'] },
      { key: 'hud_elements', label: 'HUD Elements', type: 'intensity', default: 50, levels: { 0: 'no HUD', 25: 'faint overlays', 50: 'subtle interfaces', 75: 'prominent holograms', 100: 'full cyberpunk HUD' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:fantasy-epic': {
    template: 'epic fantasy illustration style, {landscape_scale} sweeping landscapes, {magical_lighting} magical lighting, {detail} ornate detail',
    paramDefs: [
      { key: 'landscape_scale', label: 'Landscape Scale', type: 'intensity', default: 70, levels: { 0: 'intimate close', 25: 'moderate vista', 50: 'sweeping panorama', 75: 'grand epic', 100: 'vast mythological scale' } },
      { key: 'magical_lighting', label: 'Magical Lighting', type: 'select', default: 'golden dramatic', options: ['cool moonlit', 'golden dramatic', 'ethereal radiance', 'stormy atmospheric'] },
      { key: 'detail', label: 'Ornate Detail', type: 'intensity', default: 75, levels: { 0: 'minimal clean', 25: 'some ornament', 50: 'detailed', 75: 'richly ornate', 100: 'maximally intricate' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:documentary-gritty': {
    template: 'gritty documentary style, {handheld} handheld quality, {exposure} available light exposure, {saturation} color treatment',
    paramDefs: [
      { key: 'handheld', label: 'Handheld Character', type: 'intensity', default: 65, levels: { 0: 'locked tripod', 25: 'barely perceptible', 50: 'natural handheld', 75: 'pronounced organic', 100: 'raw shaky urgent' } },
      { key: 'exposure', label: 'Exposure Style', type: 'select', default: 'slightly underexposed', options: ['overexposed washed', 'naturally exposed', 'slightly underexposed', 'dark gritty'] },
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 30, levels: { 0: 'full desaturated', 25: 'heavily muted', 50: 'desaturated realistic', 75: 'slightly muted', 100: 'natural color' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:pastel-dream': {
    template: 'pastel dreamlike style, {softness} ethereal softness, {palette} pastel palette, {glow} ambient glow',
    paramDefs: [
      { key: 'softness', label: 'Softness', type: 'intensity', default: 75, levels: { 0: 'sharp clear', 25: 'slightly soft', 50: 'dreamy blur', 75: 'very soft ethereal', 100: 'fully diffused' } },
      { key: 'palette', label: 'Pastel Palette', type: 'select', default: 'mixed soft pastels', options: ['pink lavender', 'mint sky blue', 'peach cream', 'mixed soft pastels'] },
      { key: 'glow', label: 'Ambient Glow', type: 'intensity', default: 60, levels: { 0: 'no glow', 25: 'subtle halo', 50: 'gentle luminosity', 75: 'warm radiance', 100: 'overexposed bloom' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:gothic-baroque': {
    template: 'gothic baroque style, {ornament} ornate architectural detail, {shadow_depth} deep shadows, {palette} rich color palette',
    paramDefs: [
      { key: 'ornament', label: 'Ornate Detail', type: 'intensity', default: 80, levels: { 0: 'minimal', 25: 'some carving', 50: 'richly detailed', 75: 'heavily ornamented', 100: 'maximal gilded excess' } },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 75, levels: { 0: 'evenly lit', 25: 'soft shadows', 50: 'dramatic', 75: 'deep chiaroscuro', 100: 'near total darkness' } },
      { key: 'palette', label: 'Color Palette', type: 'select', default: 'crimson and gold', options: ['black and gold', 'crimson and gold', 'deep purple silver', 'dark stone grey'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:minimal-clean': {
    template: 'minimal clean design style, {whitespace} white space, {palette_reduction} reduced palette, {geometry} geometric simplicity',
    paramDefs: [
      { key: 'whitespace', label: 'White Space', type: 'intensity', default: 75, levels: { 0: 'dense packed', 25: 'moderate breathing room', 50: 'open layout', 75: 'generous white space', 100: 'extreme negative space' } },
      { key: 'palette_reduction', label: 'Palette Reduction', type: 'select', default: 'monochrome accent', options: ['full color minimal', 'two-tone', 'monochrome accent', 'pure black and white'] },
      { key: 'geometry', label: 'Geometry', type: 'intensity', default: 70, levels: { 0: 'organic free-form', 25: 'loosely geometric', 50: 'clean geometric', 75: 'strict grid', 100: 'pure mathematical' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:retro-80s': {
    template: 'retro 1980s style, {vhs_artifacts} VHS artifacts, {scanlines} scan lines, {neon_gradient} neon gradient palette',
    paramDefs: [
      { key: 'vhs_artifacts', label: 'VHS Artifacts', type: 'intensity', default: 60, levels: { 0: 'no artifacts', 25: 'faint tracking', 50: 'visible VHS', 75: 'heavy tape distortion', 100: 'extreme degraded tape' } },
      { key: 'scanlines', label: 'Scan Lines', type: 'intensity', default: 50, levels: { 0: 'no scan lines', 25: 'faint lines', 50: 'visible CRT', 75: 'prominent', 100: 'heavy interlaced' } },
      { key: 'neon_gradient', label: 'Neon Gradient', type: 'select', default: 'synthwave pink-purple', options: ['warm sunset orange', 'synthwave pink-purple', 'cyan-blue electric', 'chrome rainbow'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:surreal-dali-esque': {
    template: 'surrealist Dali-esque style, {distortion} impossible geometry distortion, {dreamscape} dreamscape logic, {juxtaposition} uncanny juxtaposition',
    paramDefs: [
      { key: 'distortion', label: 'Distortion Level', type: 'intensity', default: 75, levels: { 0: 'realistic grounded', 25: 'subtly warped', 50: 'noticeably surreal', 75: 'heavily distorted', 100: 'fully impossible geometry' } },
      { key: 'dreamscape', label: 'Dreamscape Quality', type: 'select', default: 'melting fluid', options: ['barren infinite', 'melting fluid', 'floating disconnected', 'layered collage'] },
      { key: 'juxtaposition', label: 'Juxtaposition', type: 'intensity', default: 65, levels: { 0: 'coherent scene', 25: 'slightly odd', 50: 'strange pairing', 75: 'jarring uncanny', 100: 'extreme contradictory' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:teal-orange': {
    template: 'teal and orange color grading, {saturation} color saturation, {contrast} shadow-highlight contrast',
    paramDefs: [
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 70, levels: { 0: 'desaturated neutral', 25: 'lightly graded', 50: 'moderately graded', 75: 'strongly graded', 100: 'hyper-saturated' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 65, levels: { 0: 'flat low contrast', 25: 'gentle contrast', 50: 'moderate punch', 75: 'high contrast', 100: 'extreme blockbuster' } },
    ],
  },
  'look:monochrome-cool': {
    template: 'cool monochrome palette, {saturation} blue-grey saturation, {contrast} tonal contrast',
    paramDefs: [
      { key: 'saturation', label: 'Color Saturation', type: 'intensity', default: 60, levels: { 0: 'pure neutral grey', 25: 'faint cool tint', 50: 'cool blue-grey', 75: 'strongly cool', 100: 'icy blue monochrome' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 55, levels: { 0: 'flat grey', 25: 'low contrast', 50: 'medium', 75: 'high contrast', 100: 'extreme black-white' } },
    ],
  },
  'look:monochrome-warm': {
    template: 'warm monochrome palette, {saturation} amber-sepia saturation, {contrast} tonal contrast',
    paramDefs: [
      { key: 'saturation', label: 'Color Saturation', type: 'intensity', default: 60, levels: { 0: 'pure neutral grey', 25: 'faint warm tint', 50: 'amber-sepia', 75: 'strongly warm', 100: 'deep golden monochrome' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 55, levels: { 0: 'flat', 25: 'low contrast', 50: 'medium', 75: 'punchy', 100: 'high contrast dramatic' } },
    ],
  },
  'look:complementary-pop': {
    template: 'complementary color pop, {saturation} hue saturation, {contrast} value contrast',
    paramDefs: [
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 80, levels: { 0: 'desaturated muted', 25: 'moderately saturated', 50: 'vibrant', 75: 'highly saturated', 100: 'maximum chromatic tension' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 65, levels: { 0: 'low flat', 25: 'gentle', 50: 'punchy', 75: 'high', 100: 'extreme opposing' } },
    ],
  },
  'look:analogous-serene': {
    template: 'analogous serene color harmony, {saturation} neighboring hue saturation, {contrast} soft contrast',
    paramDefs: [
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 55, levels: { 0: 'near grey', 25: 'soft muted', 50: 'gentle harmonious', 75: 'moderately vivid', 100: 'saturated unified' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 35, levels: { 0: 'no contrast flat', 25: 'very soft', 50: 'gentle', 75: 'moderate', 100: 'clear tonal separation' } },
    ],
  },
  'look:triadic-vibrant': {
    template: 'triadic vibrant color scheme, {saturation} chromatic saturation, {contrast} dynamic contrast',
    paramDefs: [
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 80, levels: { 0: 'desaturated', 25: 'moderately vivid', 50: 'vibrant', 75: 'highly saturated', 100: 'maximum triadic energy' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 65, levels: { 0: 'flat even', 25: 'gentle', 50: 'dynamic', 75: 'punchy', 100: 'extreme high contrast' } },
    ],
  },
  'look:pastel-soft': {
    template: 'soft pastel color palette, {saturation} pastel saturation, {contrast} gentle contrast',
    paramDefs: [
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 35, levels: { 0: 'white near-nothing', 25: 'very soft tints', 50: 'delicate pastels', 75: 'moderate muted color', 100: 'fuller soft color' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 25, levels: { 0: 'no contrast', 25: 'barely perceptible', 50: 'soft', 75: 'gentle', 100: 'moderate' } },
    ],
  },
  'look:earth-tones': {
    template: 'natural earth tone palette, {warmth} warm earth warmth, {saturation} organic saturation',
    paramDefs: [
      { key: 'warmth', label: 'Warmth', type: 'intensity', default: 65, levels: { 0: 'cool neutral earth', 25: 'slightly warm', 50: 'warm terracotta', 75: 'rich amber', 100: 'deep burnt sienna' } },
      { key: 'saturation', label: 'Saturation', type: 'intensity', default: 50, levels: { 0: 'near grey', 25: 'muted natural', 50: 'moderate organic', 75: 'rich earthy', 100: 'vivid natural' } },
    ],
  },
  'look:neon-synthwave': {
    template: 'neon synthwave palette, {neon_brightness} electric neon brightness, {contrast} deep contrast against black',
    paramDefs: [
      { key: 'neon_brightness', label: 'Neon Brightness', type: 'intensity', default: 80, levels: { 0: 'dim muted', 25: 'soft neon', 50: 'vibrant electric', 75: 'bright saturated', 100: 'blazing overdriven neon' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 80, levels: { 0: 'low contrast', 25: 'moderate', 50: 'strong dark background', 75: 'deep black', 100: 'pure black void' } },
    ],
  },
  'look:bleach-bypass': {
    template: 'bleach bypass look, {desaturation} silver desaturation, {contrast} raised contrast',
    paramDefs: [
      { key: 'desaturation', label: 'Desaturation', type: 'intensity', default: 65, levels: { 0: 'full color', 25: 'lightly desaturated', 50: 'moderately silvery', 75: 'heavily desaturated', 100: 'near monochrome' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 70, levels: { 0: 'flat', 25: 'moderate', 50: 'punchy', 75: 'high contrast', 100: 'extreme harsh' } },
    ],
  },
  'look:sepia-vintage': {
    template: 'sepia vintage toning, {sepia_intensity} sepia warmth, {aging_effect} aged photo character',
    paramDefs: [
      { key: 'sepia_intensity', label: 'Sepia Intensity', type: 'intensity', default: 70, levels: { 0: 'neutral grey', 25: 'faint warm tint', 50: 'classic sepia', 75: 'deep warm brown', 100: 'full amber sepia' } },
      { key: 'aging_effect', label: 'Aging Effect', type: 'select', default: 'moderate worn', options: ['fresh minimal', 'moderate worn', 'aged cracked edges', 'heavily degraded'] },
    ],
  },
  'look:high-contrast-bw': {
    template: 'high contrast black and white, {contrast} extreme contrast level, {midtone_treatment} midtone treatment',
    paramDefs: [
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 85, levels: { 0: 'flat grey', 25: 'moderate', 50: 'strong', 75: 'very high', 100: 'pure black and pure white' } },
      { key: 'midtone_treatment', label: 'Midtone Treatment', type: 'select', default: 'compressed minimal', options: ['preserved natural', 'compressed minimal', 'lifted shadows', 'crushed dark'] },
    ],
  },
  'look:smooth-polished': {
    template: 'smooth polished surface finish, {reflectivity} surface reflectivity, {uniformity} surface uniformity',
    paramDefs: [
      { key: 'reflectivity', label: 'Reflectivity', type: 'intensity', default: 70, levels: { 0: 'matte no reflection', 25: 'low sheen', 50: 'moderate gloss', 75: 'highly reflective', 100: 'mirror perfect' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'even', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:matte-flat': {
    template: 'matte flat surface finish, {prominence} surface flatness, {uniformity} texture uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Matte Prominence', type: 'intensity', default: 75, levels: { 0: 'slight sheen', 25: 'low gloss', 50: 'true matte', 75: 'deep matte', 100: 'chalk flat no reflection' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'even', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:grainy-film': {
    template: 'analog film grain texture, {prominence} grain prominence, {uniformity} grain distribution',
    paramDefs: [
      { key: 'prominence', label: 'Grain Prominence', type: 'intensity', default: 60, levels: { 0: 'no grain', 25: 'fine subtle', 50: 'natural medium grain', 75: 'heavy photographic', 100: 'extreme coarse grain' } },
      { key: 'uniformity', label: 'Distribution', type: 'select', default: 'varied', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:rough-grit': {
    template: 'rough gritty surface texture, {prominence} grit prominence, {uniformity} texture distribution',
    paramDefs: [
      { key: 'prominence', label: 'Grit Prominence', type: 'intensity', default: 70, levels: { 0: 'smooth', 25: 'slightly rough', 50: 'textured grit', 75: 'coarse abrasive', 100: 'extremely harsh rough' } },
      { key: 'uniformity', label: 'Distribution', type: 'select', default: 'organic', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:glossy-wet': {
    template: 'glossy wet surface finish, {prominence} wet sheen intensity, {uniformity} reflective distribution',
    paramDefs: [
      { key: 'prominence', label: 'Wet Sheen', type: 'intensity', default: 75, levels: { 0: 'barely damp', 25: 'light gloss', 50: 'wet sheen', 75: 'drenched specular', 100: 'mirror puddle reflection' } },
      { key: 'uniformity', label: 'Distribution', type: 'select', default: 'varied', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:velvet-soft': {
    template: 'soft velvet texture, {prominence} velvet depth, {uniformity} surface uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Velvet Depth', type: 'intensity', default: 70, levels: { 0: 'smooth flat fabric', 25: 'light nap', 50: 'plush velvet', 75: 'deep pile luxury', 100: 'ultra-thick crushed velvet' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'even', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:metallic-brushed': {
    template: 'brushed metallic texture, {prominence} brushing prominence, {uniformity} grain uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Brushing Prominence', type: 'intensity', default: 65, levels: { 0: 'smooth polished', 25: 'faint directional lines', 50: 'clear brushed pattern', 75: 'prominent directional grain', 100: 'heavy industrial satin' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'even', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:paper-fiber': {
    template: 'paper fiber texture, {prominence} fiber visibility, {uniformity} surface uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Fiber Visibility', type: 'intensity', default: 55, levels: { 0: 'smooth coated', 25: 'faint cellulose', 50: 'visible grain', 75: 'prominent textured', 100: 'heavy watercolor paper' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'organic', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:ceramic-glaze': {
    template: 'ceramic glaze finish, {prominence} glaze depth, {uniformity} surface uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Glaze Depth', type: 'intensity', default: 65, levels: { 0: 'unglazed matte clay', 25: 'thin wash', 50: 'typical ceramic glaze', 75: 'thick pooled glaze', 100: 'deep vitreous glass-like' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'organic', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:glass-crisp': {
    template: 'crisp glass surface, {prominence} transparency clarity, {uniformity} surface uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Clarity', type: 'intensity', default: 80, levels: { 0: 'frosted opaque', 25: 'lightly frosted', 50: 'translucent', 75: 'clear glass', 100: 'crystal optically perfect' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'even', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:concrete-porous': {
    template: 'porous concrete texture, {prominence} pore visibility, {uniformity} aggregate distribution',
    paramDefs: [
      { key: 'prominence', label: 'Pore Visibility', type: 'intensity', default: 65, levels: { 0: 'smooth formed concrete', 25: 'faint pores', 50: 'visible aggregate', 75: 'porous open texture', 100: 'heavily pitted rough' } },
      { key: 'uniformity', label: 'Distribution', type: 'select', default: 'organic', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:fabric-weave': {
    template: 'woven fabric texture, {prominence} weave visibility, {uniformity} thread uniformity',
    paramDefs: [
      { key: 'prominence', label: 'Weave Visibility', type: 'intensity', default: 65, levels: { 0: 'smooth flat fabric', 25: 'subtle thread pattern', 50: 'visible weave', 75: 'prominent textile', 100: 'coarse open weave' } },
      { key: 'uniformity', label: 'Uniformity', type: 'select', default: 'even', options: ['even', 'varied', 'organic'] },
    ],
  },
  'look:wes-anderson-pastel': {
    template: 'Wes Anderson symmetrical style, {symmetry} centered composition, {palette} warm pastel palette, {fidelity} reference fidelity',
    paramDefs: [
      { key: 'symmetry', label: 'Symmetry', type: 'intensity', default: 90, levels: { 0: 'loose asymmetric', 25: 'slightly centered', 50: 'moderately symmetrical', 75: 'strict symmetry', 100: 'perfect mathematical centering' } },
      { key: 'palette', label: 'Palette', type: 'select', default: 'warm yellows and pinks', options: ['cool mint greens', 'warm yellows and pinks', 'muted earth pastels', 'vibrant storybook'] },
      { key: 'fidelity', label: 'Reference Fidelity', type: 'intensity', default: 75, levels: { 0: 'loosely inspired', 25: 'moderate resemblance', 50: 'clear reference', 75: 'close match', 100: 'faithful recreation' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:wong-karwai-neon': {
    template: 'Wong Kar-wai neon style, {neon_saturation} saturated neon color, {motion_blur} step-printed motion blur, {fidelity} reference fidelity',
    paramDefs: [
      { key: 'neon_saturation', label: 'Neon Saturation', type: 'intensity', default: 80, levels: { 0: 'desaturated', 25: 'muted neon', 50: 'vivid saturated', 75: 'deeply saturated', 100: 'overloaded neon' } },
      { key: 'motion_blur', label: 'Motion Blur', type: 'intensity', default: 65, levels: { 0: 'sharp no blur', 25: 'faint step-print', 50: 'visible smear', 75: 'heavy step-printed', 100: 'extreme temporal blur' } },
      { key: 'fidelity', label: 'Reference Fidelity', type: 'intensity', default: 70, levels: { 0: 'loosely inspired', 25: 'moderate', 50: 'clear reference', 75: 'close match', 100: 'faithful' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:kubrick-symmetry': {
    template: 'Kubrick symmetrical style, {symmetry} one-point perspective strictness, {lighting_coldness} clinical lighting coldness, {fidelity} reference fidelity',
    paramDefs: [
      { key: 'symmetry', label: 'Symmetry Strictness', type: 'intensity', default: 90, levels: { 0: 'loose framing', 25: 'somewhat centered', 50: 'strong one-point', 75: 'strict symmetry', 100: 'perfect mathematical' } },
      { key: 'lighting_coldness', label: 'Lighting Coldness', type: 'intensity', default: 75, levels: { 0: 'warm natural', 25: 'neutral', 50: 'cool clinical', 75: 'cold overhead', 100: 'stark fluorescent' } },
      { key: 'fidelity', label: 'Reference Fidelity', type: 'intensity', default: 75, levels: { 0: 'loosely inspired', 25: 'moderate', 50: 'clear reference', 75: 'close match', 100: 'faithful' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:shinkai-luminous': {
    template: 'Makoto Shinkai luminous style, {sky_detail} sky gradient detail, {light_scattering} volumetric light scattering, {fidelity} reference fidelity',
    paramDefs: [
      { key: 'sky_detail', label: 'Sky Detail', type: 'intensity', default: 85, levels: { 0: 'plain flat sky', 25: 'simple gradient', 50: 'detailed clouds', 75: 'hyper-detailed luminous', 100: 'maximal cloud and color complexity' } },
      { key: 'light_scattering', label: 'Light Scattering', type: 'intensity', default: 75, levels: { 0: 'no atmosphere', 25: 'subtle Tyndall', 50: 'visible god rays', 75: 'prominent volumetric', 100: 'overwhelming radiance' } },
      { key: 'fidelity', label: 'Reference Fidelity', type: 'intensity', default: 75, levels: { 0: 'loosely inspired', 25: 'moderate', 50: 'clear reference', 75: 'close match', 100: 'faithful' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:kodak-portra-400': {
    template: 'Kodak Portra 400 film, {grain} organic grain, {skin_warmth} warm skin tone rendering, {fidelity} color science fidelity',
    paramDefs: [
      { key: 'grain', label: 'Film Grain', type: 'intensity', default: 50, levels: { 0: 'grain-free digital', 25: 'very fine', 50: 'natural Portra grain', 75: 'visible organic', 100: 'heavy pushed grain' } },
      { key: 'skin_warmth', label: 'Skin Warmth', type: 'intensity', default: 65, levels: { 0: 'cool neutral skin', 25: 'natural', 50: 'gently warm', 75: 'warm flattering', 100: 'deeply golden' } },
      { key: 'fidelity', label: 'Color Science Fidelity', type: 'intensity', default: 70, levels: { 0: 'loosely inspired', 25: 'moderate resemblance', 50: 'clear Portra character', 75: 'close match', 100: 'faithful film emulation' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:cinestill-800t': {
    template: 'CineStill 800T film, {halation} red halation around lights, {tungsten_balance} tungsten color balance, {fidelity} color science fidelity',
    paramDefs: [
      { key: 'halation', label: 'Red Halation', type: 'intensity', default: 65, levels: { 0: 'no halation', 25: 'faint red bleed', 50: 'visible halation', 75: 'prominent halo', 100: 'extreme red bleed' } },
      { key: 'tungsten_balance', label: 'Tungsten Balance', type: 'intensity', default: 70, levels: { 0: 'neutral daylight', 25: 'slightly warm', 50: 'warm orange practical', 75: 'strong tungsten', 100: 'deep amber tungsten' } },
      { key: 'fidelity', label: 'Color Science Fidelity', type: 'intensity', default: 70, levels: { 0: 'loosely inspired', 25: 'moderate', 50: 'clear CineStill character', 75: 'close match', 100: 'faithful emulation' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:fujifilm-eterna': {
    template: 'Fujifilm Eterna film stock, {desaturation} cool desaturated palette, {contrast} low contrast rolloff, {fidelity} color science fidelity',
    paramDefs: [
      { key: 'desaturation', label: 'Desaturation', type: 'intensity', default: 60, levels: { 0: 'full color', 25: 'lightly muted', 50: 'moderately desaturated', 75: 'restrained Eterna palette', 100: 'near monochrome' } },
      { key: 'contrast', label: 'Contrast Rolloff', type: 'intensity', default: 35, levels: { 0: 'flat no contrast', 25: 'very low', 50: 'gentle rolloff', 75: 'moderate', 100: 'normal contrast' } },
      { key: 'fidelity', label: 'Color Science Fidelity', type: 'intensity', default: 70, levels: { 0: 'loosely inspired', 25: 'moderate', 50: 'clear Eterna character', 75: 'close match', 100: 'faithful emulation' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:ilford-hp5': {
    template: 'Ilford HP5 black and white film, {grain} organic grain structure, {tonal_range} tonal separation, {fidelity} film science fidelity',
    paramDefs: [
      { key: 'grain', label: 'Film Grain', type: 'intensity', default: 65, levels: { 0: 'grain-free digital', 25: 'fine grain', 50: 'natural HP5 grain', 75: 'pushed one stop', 100: 'heavy pushed three stops' } },
      { key: 'tonal_range', label: 'Tonal Range', type: 'intensity', default: 75, levels: { 0: 'flat grey', 25: 'moderate range', 50: 'good separation', 75: 'wide dynamic range', 100: 'maximum shadow-highlight detail' } },
      { key: 'fidelity', label: 'Film Science Fidelity', type: 'intensity', default: 70, levels: { 0: 'loosely inspired', 25: 'moderate', 50: 'clear HP5 character', 75: 'close match', 100: 'faithful emulation' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:french-new-wave': {
    template: 'French New Wave cinematic style, {handheld_quality} handheld spontaneity, {light_quality} natural light quality, {film_stock} film stock character',
    paramDefs: [
      { key: 'handheld_quality', label: 'Handheld Quality', type: 'intensity', default: 65, levels: { 0: 'tripod static', 25: 'slightly casual', 50: 'natural handheld', 75: 'spontaneous imperfect', 100: 'raw urgent movement' } },
      { key: 'light_quality', label: 'Light Quality', type: 'select', default: 'soft available light', options: ['hard midday sun', 'soft available light', 'overcast diffused', 'interior window light'] },
      { key: 'film_stock', label: 'Film Stock', type: 'select', default: 'Fujifilm muted tones', options: ['high contrast BW', 'Fujifilm muted tones', 'Kodak warm', 'expired grain heavy'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:y2k-chrome': {
    template: 'Y2K chrome aesthetic, {chrome_intensity} brushed chrome surfaces, {color_grade} cold color grading, {halation} soft highlight halation',
    paramDefs: [
      { key: 'chrome_intensity', label: 'Chrome Intensity', type: 'intensity', default: 70, levels: { 0: 'matte surface', 25: 'subtle sheen', 50: 'brushed metallic', 75: 'high chrome', 100: 'mirror reflective' } },
      { key: 'color_grade', label: 'Color Grade', type: 'select', default: 'cold blue-teal', options: ['neutral silver', 'cold blue-teal', 'iridescent rainbow', 'deep chrome purple'] },
      { key: 'halation', label: 'Highlight Halation', type: 'intensity', default: 55, levels: { 0: 'sharp highlights', 25: 'faint glow', 50: 'soft halation', 75: 'prominent bloom', 100: 'heavy chromatic glow' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:vaporwave': {
    template: 'vaporwave aesthetic, {gradient_palette} pastel gradient palette, {glitch_level} glitch artifacts, {retro_elements} retro digital elements',
    paramDefs: [
      { key: 'gradient_palette', label: 'Gradient Palette', type: 'select', default: 'pink-purple-blue', options: ['pink-lavender', 'pink-purple-blue', 'teal-purple sunset', 'synthwave neon'] },
      { key: 'glitch_level', label: 'Glitch Level', type: 'intensity', default: 50, levels: { 0: 'no glitch', 25: 'subtle artifacts', 50: 'visible glitch', 75: 'heavy distortion', 100: 'extreme corrupted' } },
      { key: 'retro_elements', label: 'Retro Elements', type: 'intensity', default: 65, levels: { 0: 'abstract only', 25: 'faint grid lines', 50: 'visible 80s motifs', 75: 'prominent statue grids', 100: 'full vaporwave iconography' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:brutalist-concrete': {
    template: 'brutalist architecture style, {concrete_roughness} concrete surface roughness, {scale} monumental scale, {color_treatment} desaturated palette',
    paramDefs: [
      { key: 'concrete_roughness', label: 'Concrete Roughness', type: 'intensity', default: 70, levels: { 0: 'smooth formed', 25: 'lightly textured', 50: 'rough aggregate', 75: 'heavily porous', 100: 'raw unfinished' } },
      { key: 'scale', label: 'Monumental Scale', type: 'intensity', default: 75, levels: { 0: 'human scale', 25: 'imposing', 50: 'large monumental', 75: 'overwhelming', 100: 'crushing oppressive' } },
      { key: 'color_treatment', label: 'Color Treatment', type: 'select', default: 'cool grey desaturated', options: ['warm beige concrete', 'cool grey desaturated', 'cold blue-grey', 'near monochrome'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:stop-motion-clay': {
    template: 'stop-motion clay style, {surface_imperfection} surface imperfections, {frame_rate} low frame rate jitter, {lighting} warm lighting',
    paramDefs: [
      { key: 'surface_imperfection', label: 'Surface Imperfection', type: 'intensity', default: 70, levels: { 0: 'smooth professional', 25: 'subtle marks', 50: 'visible fingerprints', 75: 'heavily handmade', 100: 'extreme tactile roughness' } },
      { key: 'frame_rate', label: 'Frame Rate Jitter', type: 'select', default: '8fps jitter', options: ['12fps smooth', '8fps jitter', '6fps choppy', 'mixed frame stagger'] },
      { key: 'lighting', label: 'Lighting Style', type: 'select', default: 'warm tungsten', options: ['cool daylight', 'warm tungsten', 'dramatic practical', 'flat studio'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:cross-stitch': {
    template: 'cross-stitch textile style, {stitch_density} stitch density, {fabric_texture} Aida cloth texture, {thread_sheen} thread sheen',
    paramDefs: [
      { key: 'stitch_density', label: 'Stitch Density', type: 'intensity', default: 70, levels: { 0: 'sparse open grid', 25: 'light coverage', 50: 'medium density', 75: 'dense coverage', 100: 'fully packed stitches' } },
      { key: 'fabric_texture', label: 'Fabric Texture', type: 'intensity', default: 55, levels: { 0: 'no visible fabric', 25: 'faint grid', 50: 'visible weave', 75: 'prominent cloth', 100: 'heavy textile' } },
      { key: 'thread_sheen', label: 'Thread Sheen', type: 'select', default: 'cotton matte', options: ['cotton matte', 'silk sheen', 'metallic glint', 'wool textured'] },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:rotoscope': {
    template: 'rotoscope animation style, {line_quality} traced line quality, {color_fill} color fill treatment, {stylization} stylization level',
    paramDefs: [
      { key: 'line_quality', label: 'Line Quality', type: 'select', default: 'organic painterly', options: ['clean precise', 'organic painterly', 'rough gestural', 'fluid smeared'] },
      { key: 'color_fill', label: 'Color Fill', type: 'intensity', default: 60, levels: { 0: 'line art only', 25: 'sparse flat fills', 50: 'semi-transparent layered', 75: 'full painted fills', 100: 'richly layered opaque' } },
      { key: 'stylization', label: 'Stylization', type: 'intensity', default: 65, levels: { 0: 'close to live footage', 25: 'lightly stylized', 50: 'moderately stylized', 75: 'heavily stylized', 100: 'fully abstract' } },
    ],
    conflictGroup: 'look:base-style',
  },
  'look:needle-felt': {
    template: 'needle-felt craft style, {fiber_texture} wool fiber texture, {surface_fuzz} surface fuzz, {color_blending} fiber color blending',
    paramDefs: [
      { key: 'fiber_texture', label: 'Fiber Texture', type: 'intensity', default: 75, levels: { 0: 'smooth compact', 25: 'lightly felted', 50: 'visible fibers', 75: 'fuzzy surface', 100: 'extremely fluffy loose' } },
      { key: 'surface_fuzz', label: 'Surface Fuzz', type: 'select', default: 'soft halo fuzz', options: ['clean edge', 'soft halo fuzz', 'heavy fiber spray', 'directional fiber lines'] },
      { key: 'color_blending', label: 'Color Blending', type: 'intensity', default: 55, levels: { 0: 'solid flat color', 25: 'slight blend', 50: 'mixed fiber blend', 75: 'variegated', 100: 'fully blended gradient fibers' } },
    ],
    conflictGroup: 'look:base-style',
  },

  // ── lens sample ──
  'lens:portrait-85mm': {
    template: '85mm portrait lens, {compression} compression, {bokeh_quality} bokeh, {dof} depth of field',
    paramDefs: [
      { key: 'compression', label: 'Compression', type: 'intensity', default: 60, levels: { 0: 'minimal', 25: 'subtle', 50: 'flattering', 75: 'strong', 100: 'extreme telephoto-like' } },
      { key: 'bokeh_quality', label: 'Bokeh Quality', type: 'select', default: 'creamy circular', options: ['crisp hexagonal', 'creamy circular', 'swirling vintage', 'oval anamorphic'] },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 75, levels: { 0: 'deep everything sharp', 25: 'moderate', 50: 'shallow', 75: 'very shallow f/1.8', 100: 'razor-thin f/1.2' } },
    ],
    conflictGroup: 'lens:focal-length',
  },

  // ── composition sample ──
  'composition:rule-of-thirds': {
    template: 'subject placed at {intersection} thirds intersection, {balance} compositional balance, {leading} visual flow',
    paramDefs: [
      { key: 'intersection', label: 'Intersection', type: 'select', default: 'upper-right', options: ['upper-left', 'upper-right', 'lower-left', 'lower-right'] },
      { key: 'balance', label: 'Balance', type: 'intensity', default: 70, levels: { 0: 'deliberately unbalanced', 25: 'loose', 50: 'relaxed', 75: 'well-balanced', 100: 'precisely mathematical' } },
      { key: 'leading', label: 'Visual Flow', type: 'select', default: 'natural eye path', options: ['static anchored', 'natural eye path', 'diagonal movement', 'circular sweep'] },
    ],
  },

  // ── scene: remaining lighting ──
  'scene:golden-hour': {
    template: 'warm golden hour sunlight, {warmth} amber warmth, {shadow_length} long shadows, {sun_angle} sun position',
    paramDefs: [
      { key: 'warmth', label: 'Warmth', type: 'intensity', default: 70, levels: { 0: 'cool neutral sunset', 25: 'lightly warm', 50: 'warm amber glow', 75: 'rich deep gold', 100: 'blazing orange-red' } },
      { key: 'shadow_length', label: 'Shadow Length', type: 'intensity', default: 75, levels: { 0: 'minimal shadows', 25: 'short shadows', 50: 'moderate shadows', 75: 'long dramatic shadows', 100: 'extreme elongated shadows' } },
      { key: 'sun_angle', label: 'Sun Position', type: 'select', default: 'low horizon', options: ['just above horizon', 'low horizon', 'touching horizon', 'half-set'] },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:blue-hour': {
    template: 'cool blue hour twilight, {blue_depth} blue tonal depth, {ambient_quality} ambient light quality, {sky_clarity} sky clarity',
    paramDefs: [
      { key: 'blue_depth', label: 'Blue Depth', type: 'intensity', default: 65, levels: { 0: 'barely blue', 25: 'soft blue tint', 50: 'medium indigo cast', 75: 'deep blue atmosphere', 100: 'near-monochrome blue' } },
      { key: 'ambient_quality', label: 'Ambient Quality', type: 'select', default: 'soft diffused', options: ['fading daylight', 'soft diffused', 'deep twilight', 'near dark'] },
      { key: 'sky_clarity', label: 'Sky Clarity', type: 'intensity', default: 70, levels: { 0: 'overcast haze', 25: 'slight haze', 50: 'mostly clear', 75: 'clear open sky', 100: 'crystal-clear gradient' } },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:silhouette': {
    template: 'backlit silhouette, {silhouette_depth} dark shape against {background_light} luminous background, {edge_clarity} edge definition',
    paramDefs: [
      { key: 'silhouette_depth', label: 'Silhouette Depth', type: 'intensity', default: 90, levels: { 0: 'slight darkening', 25: 'semi-transparent', 50: 'recognizable form', 75: 'solid dark', 100: 'pure black shape' } },
      { key: 'background_light', label: 'Background Light', type: 'select', default: 'bright sky', options: ['warm sunset', 'bright sky', 'blazing white', 'gradient dusk'] },
      { key: 'edge_clarity', label: 'Edge Clarity', type: 'intensity', default: 70, levels: { 0: 'soft hazy edge', 25: 'slightly blurred', 50: 'defined', 75: 'sharp clear', 100: 'razor-crisp halo' } },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:split-lighting': {
    template: 'split lighting dividing {split_sharpness} halves of light and shadow, {lit_side} lit side quality, {shadow_side} shadow side depth',
    paramDefs: [
      { key: 'split_sharpness', label: 'Split Sharpness', type: 'intensity', default: 75, levels: { 0: 'blended soft', 25: 'gradual', 50: 'moderate edge', 75: 'sharp defined', 100: 'knife-edge hard' } },
      { key: 'lit_side', label: 'Lit Side', type: 'select', default: 'warm key light', options: ['cool daylight', 'warm key light', 'harsh direct', 'soft diffused'] },
      { key: 'shadow_side', label: 'Shadow Side', type: 'intensity', default: 80, levels: { 0: 'minimal shadow', 25: 'slight shadow', 50: 'moderate shadow', 75: 'deep shadow', 100: 'total darkness' } },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:butterfly-lighting': {
    template: 'butterfly lighting from directly above, {shadow_depth} shadow beneath the nose, {spread} light spread, {glamour} glamour quality',
    paramDefs: [
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 60, levels: { 0: 'no shadow', 25: 'faint butterfly', 50: 'defined butterfly', 75: 'strong butterfly', 100: 'deep dramatic shadow' } },
      { key: 'spread', label: 'Light Spread', type: 'select', default: 'medium soft box', options: ['narrow spot', 'medium soft box', 'broad beauty dish', 'wide fill panel'] },
      { key: 'glamour', label: 'Glamour Quality', type: 'intensity', default: 70, levels: { 0: 'natural minimal', 25: 'subtle sheen', 50: 'polished', 75: 'Hollywood glamour', 100: 'hyper-polished cinematic' } },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:rembrandt-lighting': {
    template: 'Rembrandt lighting with {triangle_size} triangular highlight on shadowed cheek, {key_angle} key light angle, {shadow_depth} shadow depth',
    paramDefs: [
      { key: 'triangle_size', label: 'Triangle Size', type: 'intensity', default: 65, levels: { 0: 'barely visible', 25: 'small triangle', 50: 'classic triangle', 75: 'broad triangle', 100: 'large patch' } },
      { key: 'key_angle', label: 'Key Light Angle', type: 'select', default: '45-degree side', options: ['30-degree front', '45-degree side', '60-degree side', 'steep overhead'] },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 75, levels: { 0: 'shallow', 25: 'light', 50: 'moderate', 75: 'deep', 100: 'near-black' } },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:volumetric-godrays': {
    template: 'volumetric god rays piercing through atmosphere, {ray_density} ray density, {particle_visibility} dust particles, {light_color} light color',
    paramDefs: [
      { key: 'ray_density', label: 'Ray Density', type: 'intensity', default: 65, levels: { 0: 'barely visible shafts', 25: 'faint beams', 50: 'clear god rays', 75: 'rich volumetric beams', 100: 'overwhelming blinding shafts' } },
      { key: 'particle_visibility', label: 'Particle Visibility', type: 'intensity', default: 60, levels: { 0: 'no particles', 25: 'subtle motes', 50: 'visible dust', 75: 'heavy floating particles', 100: 'dense particle field' } },
      { key: 'light_color', label: 'Light Color', type: 'select', default: 'warm golden', options: ['cool blue', 'neutral white', 'warm golden', 'warm orange'] },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:neon-noir': {
    template: 'neon-lit noir atmosphere, {neon_intensity} neon saturation, {wet_surface} wet surface reflections, {shadow_depth} deep urban shadows',
    paramDefs: [
      { key: 'neon_intensity', label: 'Neon Intensity', type: 'intensity', default: 75, levels: { 0: 'faint neon traces', 25: 'subtle colored glow', 50: 'vivid neon accents', 75: 'saturated neon flood', 100: 'blinding neon overload' } },
      { key: 'wet_surface', label: 'Wet Surface', type: 'intensity', default: 65, levels: { 0: 'dry', 25: 'slightly damp', 50: 'wet reflections', 75: 'rain-slicked mirror', 100: 'flooded puddles' } },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 80, levels: { 0: 'low contrast', 25: 'moderate shadows', 50: 'deep shadows', 75: 'crushing noir darkness', 100: 'near total black' } },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:candlelit': {
    template: 'warm candlelight illumination, {flicker} flickering quality, {warmth} amber warmth, {falloff} light falloff',
    paramDefs: [
      { key: 'flicker', label: 'Flicker', type: 'intensity', default: 55, levels: { 0: 'steady no flicker', 25: 'subtle pulse', 50: 'gentle flicker', 75: 'animated dancing flame', 100: 'dramatic rapid flicker' } },
      { key: 'warmth', label: 'Warmth', type: 'intensity', default: 80, levels: { 0: 'neutral pale', 25: 'slightly warm', 50: 'warm amber', 75: 'rich orange glow', 100: 'deep orange-red firelight' } },
      { key: 'falloff', label: 'Light Falloff', type: 'select', default: 'soft intimate radius', options: ['tight close range', 'soft intimate radius', 'gentle medium spread', 'broad warm fill'] },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:moonlit': {
    template: 'cool moonlight illumination, {silver_tone} silver-blue tone, {shadow_length} soft shadow length, {cloud_cover} cloud cover',
    paramDefs: [
      { key: 'silver_tone', label: 'Silver Tone', type: 'intensity', default: 65, levels: { 0: 'near neutral', 25: 'faint silver', 50: 'pale silver-blue', 75: 'cool silvery', 100: 'deep cold blue-white' } },
      { key: 'shadow_length', label: 'Shadow Length', type: 'intensity', default: 60, levels: { 0: 'no shadows', 25: 'short', 50: 'moderate', 75: 'long sweeping', 100: 'extreme elongated' } },
      { key: 'cloud_cover', label: 'Cloud Cover', type: 'select', default: 'clear night sky', options: ['clear night sky', 'scattered clouds', 'partly cloudy', 'overcast filtered'] },
    ],
    conflictGroup: 'scene:lighting-base',
  },
  'scene:overcast-soft': {
    template: 'soft overcast diffused lighting, {softness} diffusion quality, {shadow_depth} shadows, {color_temp} color temperature',
    paramDefs: [
      { key: 'softness', label: 'Diffusion Softness', type: 'intensity', default: 80, levels: { 0: 'thin overcast', 25: 'slight diffusion', 50: 'even diffusion', 75: 'beautifully soft', 100: 'flat wrap-around fill' } },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 20, levels: { 0: 'no shadows', 25: 'faint', 50: 'soft', 75: 'moderate defined', 100: 'noticeable' } },
      { key: 'color_temp', label: 'Color Temperature', type: 'select', default: 'neutral daylight', options: ['cool grey', 'neutral daylight', 'slightly warm', 'flat white'] },
    ],
    conflictGroup: 'scene:lighting-base',
  },

  // ── scene: remaining atmosphere/weather ──
  'scene:fog-light': {
    template: 'light atmospheric fog, {fog_density} mist density, {visibility} visibility distance, {depth_haze} depth haze',
    paramDefs: [
      { key: 'fog_density', label: 'Fog Density', type: 'intensity', default: 30, levels: { 0: 'clear air with hint', 25: 'light mist', 50: 'moderate fog', 75: 'thick mist', 100: 'heavy fog' } },
      { key: 'visibility', label: 'Visibility', type: 'select', default: 'long range partial haze', options: ['full visibility', 'long range partial haze', 'medium range', 'reduced range'] },
      { key: 'depth_haze', label: 'Depth Haze', type: 'intensity', default: 40, levels: { 0: 'flat no haze', 25: 'faint depth haze', 50: 'atmospheric depth', 75: 'strong aerial perspective', 100: 'heavy depth veil' } },
    ],
  },
  'scene:fog-heavy': {
    template: 'dense heavy fog, {fog_density} obscuring mist, {visibility} limited visibility, {color_cast} fog color',
    paramDefs: [
      { key: 'fog_density', label: 'Fog Density', type: 'intensity', default: 85, levels: { 0: 'moderate fog', 25: 'thick fog', 50: 'heavy fog', 75: 'dense obscuring fog', 100: 'total whiteout' } },
      { key: 'visibility', label: 'Visibility', type: 'select', default: 'severely limited', options: ['reduced visibility', 'severely limited', 'near zero', 'ghostly shapes only'] },
      { key: 'color_cast', label: 'Fog Color', type: 'select', default: 'grey-white neutral', options: ['pure white', 'grey-white neutral', 'warm yellow fog', 'cool blue mist'] },
    ],
  },
  'scene:rain-light': {
    template: 'light rain, {rain_intensity} gentle rainfall, {surface_wetness} wet surfaces, {sky_tone} overcast sky',
    paramDefs: [
      { key: 'rain_intensity', label: 'Rain Intensity', type: 'intensity', default: 30, levels: { 0: 'drizzle', 25: 'fine mist rain', 50: 'light shower', 75: 'steady light rain', 100: 'moderate rain' } },
      { key: 'surface_wetness', label: 'Surface Wetness', type: 'intensity', default: 60, levels: { 0: 'dry', 25: 'slightly damp', 50: 'wet sheen', 75: 'glossy reflective', 100: 'pooling puddles' } },
      { key: 'sky_tone', label: 'Sky Tone', type: 'select', default: 'overcast grey', options: ['light overcast', 'overcast grey', 'dark stormy', 'twilight overcast'] },
    ],
  },
  'scene:rain-heavy': {
    template: 'heavy downpour, {rain_intensity} intense rainfall, {splash_effect} splashing water, {visibility} reduced visibility',
    paramDefs: [
      { key: 'rain_intensity', label: 'Rain Intensity', type: 'intensity', default: 85, levels: { 0: 'moderate rain', 25: 'heavy shower', 50: 'downpour', 75: 'torrential rain', 100: 'deluge' } },
      { key: 'splash_effect', label: 'Splash Effect', type: 'intensity', default: 70, levels: { 0: 'no splash', 25: 'small droplets', 50: 'splashing puddles', 75: 'spray and splash', 100: 'violent splashing streams' } },
      { key: 'visibility', label: 'Visibility', type: 'select', default: 'reduced', options: ['moderate reduction', 'reduced', 'heavy reduction', 'near-zero visibility'] },
    ],
  },
  'scene:snow-gentle': {
    template: 'gentle snowfall, {flake_density} snowflake density, {drift_speed} drift speed, {accumulation} ground accumulation',
    paramDefs: [
      { key: 'flake_density', label: 'Flake Density', type: 'intensity', default: 35, levels: { 0: 'single flakes', 25: 'sparse flurries', 50: 'gentle snowfall', 75: 'moderate snow', 100: 'steady snowfall' } },
      { key: 'drift_speed', label: 'Drift Speed', type: 'select', default: 'slow gentle float', options: ['barely moving', 'slow gentle float', 'light breeze carry', 'moderate drift'] },
      { key: 'accumulation', label: 'Accumulation', type: 'intensity', default: 40, levels: { 0: 'no accumulation', 25: 'light dusting', 50: 'thin layer', 75: 'modest snow cover', 100: 'deep white blanket' } },
    ],
  },
  'scene:snow-blizzard': {
    template: 'blizzard conditions, {wind_intensity} driving wind and snow, {visibility} near-zero visibility, {whiteout} whiteout level',
    paramDefs: [
      { key: 'wind_intensity', label: 'Wind Intensity', type: 'intensity', default: 85, levels: { 0: 'moderate wind', 25: 'strong wind', 50: 'heavy wind', 75: 'fierce wind', 100: 'violent gale' } },
      { key: 'visibility', label: 'Visibility', type: 'select', default: 'near-zero', options: ['heavily reduced', 'near-zero', 'whiteout', 'complete whiteout'] },
      { key: 'whiteout', label: 'Whiteout Level', type: 'intensity', default: 80, levels: { 0: 'heavy snowfall', 25: 'blinding flurries', 50: 'partial whiteout', 75: 'near whiteout', 100: 'total whiteout' } },
    ],
  },
  'scene:dust-particles': {
    template: 'floating dust particles in {light_quality} light, {particle_density} particle density, {warm_tone} warm atmosphere',
    paramDefs: [
      { key: 'light_quality', label: 'Light Quality', type: 'select', default: 'golden sunbeams', options: ['cool shaft of light', 'golden sunbeams', 'warm diffused rays', 'bright direct beam'] },
      { key: 'particle_density', label: 'Particle Density', type: 'intensity', default: 55, levels: { 0: 'barely visible', 25: 'few scattered motes', 50: 'moderate floating dust', 75: 'heavy dust cloud', 100: 'thick particle field' } },
      { key: 'warm_tone', label: 'Warm Tone', type: 'intensity', default: 60, levels: { 0: 'neutral', 25: 'slightly warm', 50: 'warm amber', 75: 'rich warm glow', 100: 'intense golden warmth' } },
    ],
  },
  'scene:smoke': {
    template: '{smoke_density} smoke drifting through scene, {curl_quality} curling wisps, {opacity} translucency',
    paramDefs: [
      { key: 'smoke_density', label: 'Smoke Density', type: 'intensity', default: 50, levels: { 0: 'faint wisps', 25: 'light haze', 50: 'moderate smoke', 75: 'thick billowing', 100: 'dense obscuring cloud' } },
      { key: 'curl_quality', label: 'Curl Quality', type: 'select', default: 'gentle curling', options: ['straight rising', 'gentle curling', 'turbulent swirling', 'chaotic billowing'] },
      { key: 'opacity', label: 'Opacity', type: 'intensity', default: 50, levels: { 0: 'nearly transparent', 25: 'semi-transparent', 50: 'translucent haze', 75: 'mostly opaque', 100: 'fully opaque' } },
    ],
  },
  'scene:fire-embers': {
    template: 'glowing fire embers, {ember_density} floating sparks, {glow_intensity} orange glow, {drift} drift pattern',
    paramDefs: [
      { key: 'ember_density', label: 'Ember Density', type: 'intensity', default: 60, levels: { 0: 'single sparks', 25: 'few embers', 50: 'moderate ember stream', 75: 'heavy spark shower', 100: 'dense glowing storm' } },
      { key: 'glow_intensity', label: 'Glow Intensity', type: 'intensity', default: 75, levels: { 0: 'faint dim', 25: 'soft glow', 50: 'bright hot orange', 75: 'intense fiery glow', 100: 'blinding white-hot' } },
      { key: 'drift', label: 'Drift Pattern', type: 'select', default: 'upward floating', options: ['straight rising', 'upward floating', 'wind-carried horizontal', 'chaotic swirling'] },
    ],
  },
  'scene:underwater': {
    template: 'underwater environment, {caustic_intensity} caustic light patterns, {particle_haze} floating particles, {color_cast} color cast',
    paramDefs: [
      { key: 'caustic_intensity', label: 'Caustic Intensity', type: 'intensity', default: 65, levels: { 0: 'no caustics', 25: 'faint ripple light', 50: 'moderate caustic pattern', 75: 'vivid shifting caustics', 100: 'intense bright caustic web' } },
      { key: 'particle_haze', label: 'Particle Haze', type: 'intensity', default: 50, levels: { 0: 'crystal clear', 25: 'few particles', 50: 'moderate haze', 75: 'murky suspended particles', 100: 'heavily turbid' } },
      { key: 'color_cast', label: 'Color Cast', type: 'select', default: 'blue-green', options: ['clear blue', 'blue-green', 'deep ocean blue', 'murky green-brown'] },
    ],
  },
  'scene:wind-leaves': {
    template: 'wind-blown leaves and debris, {wind_strength} wind strength, {leaf_density} particle density, {motion_blur} motion blur',
    paramDefs: [
      { key: 'wind_strength', label: 'Wind Strength', type: 'intensity', default: 55, levels: { 0: 'gentle breeze', 25: 'light wind', 50: 'moderate wind', 75: 'strong gust', 100: 'violent storm wind' } },
      { key: 'leaf_density', label: 'Leaf Density', type: 'intensity', default: 50, levels: { 0: 'single leaf', 25: 'few leaves', 50: 'moderate scatter', 75: 'dense swirl', 100: 'thick leaf storm' } },
      { key: 'motion_blur', label: 'Motion Blur', type: 'select', default: 'moderate blur', options: ['sharp frozen', 'slight blur', 'moderate blur', 'heavy streaking blur'] },
    ],
  },
  'scene:fireflies': {
    template: 'bioluminescent fireflies, {density} floating glow points, {glow_color} warm light color, {flicker_pattern} blink pattern',
    paramDefs: [
      { key: 'density', label: 'Firefly Density', type: 'intensity', default: 50, levels: { 0: 'single firefly', 25: 'few scattered', 50: 'moderate cluster', 75: 'many twinkling', 100: 'dense magical cloud' } },
      { key: 'glow_color', label: 'Glow Color', type: 'select', default: 'warm yellow-green', options: ['cool blue-white', 'warm yellow-green', 'golden amber', 'soft white'] },
      { key: 'flicker_pattern', label: 'Flicker Pattern', type: 'select', default: 'natural random pulse', options: ['steady glow', 'natural random pulse', 'slow fade on/off', 'rapid twinkling'] },
    ],
  },
  'scene:sandstorm': {
    template: 'sandstorm atmosphere, {sand_density} swirling sand density, {visibility} visibility, {amber_haze} amber haze',
    paramDefs: [
      { key: 'sand_density', label: 'Sand Density', type: 'intensity', default: 70, levels: { 0: 'light dust', 25: 'moderate dust cloud', 50: 'heavy sand suspension', 75: 'dense sandstorm', 100: 'complete sand wall' } },
      { key: 'visibility', label: 'Visibility', type: 'select', default: 'reduced', options: ['slightly reduced', 'reduced', 'heavily obscured', 'near zero'] },
      { key: 'amber_haze', label: 'Amber Haze', type: 'intensity', default: 75, levels: { 0: 'neutral grey', 25: 'slight warm tint', 50: 'amber haze', 75: 'deep warm amber', 100: 'intense orange tint' } },
    ],
  },
  'scene:aurora': {
    template: 'aurora borealis, {curtain_intensity} shimmering curtains of light, {color_range} color palette, {sky_clarity} night sky clarity',
    paramDefs: [
      { key: 'curtain_intensity', label: 'Curtain Intensity', type: 'intensity', default: 70, levels: { 0: 'faint shimmer', 25: 'soft curtains', 50: 'vivid bands', 75: 'intense rippling curtains', 100: 'overwhelming dancing lights' } },
      { key: 'color_range', label: 'Color Palette', type: 'select', default: 'green and purple', options: ['green only', 'green and purple', 'green pink and blue', 'full spectrum'] },
      { key: 'sky_clarity', label: 'Sky Clarity', type: 'intensity', default: 80, levels: { 0: 'hazy obscured', 25: 'light haze', 50: 'partly clear', 75: 'clear polar night', 100: 'crystal-clear star field' } },
    ],
  },

  // ── lens: remaining ──
  'lens:ultra-wide-14mm': {
    template: '14mm ultra-wide lens, {distortion} barrel distortion, {perspective_exaggeration} perspective stretch, {dof} depth of field',
    paramDefs: [
      { key: 'distortion', label: 'Barrel Distortion', type: 'intensity', default: 70, levels: { 0: 'corrected flat', 25: 'slight curve', 50: 'moderate barrel', 75: 'strong barrel distortion', 100: 'extreme edge warp' } },
      { key: 'perspective_exaggeration', label: 'Perspective Exaggeration', type: 'intensity', default: 75, levels: { 0: 'minimal', 25: 'slight', 50: 'noticeable', 75: 'dramatic', 100: 'extreme depth exaggeration' } },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 20, levels: { 0: 'razor shallow', 25: 'moderately shallow', 50: 'medium', 75: 'mostly deep', 100: 'infinite everything sharp' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:wide-24mm': {
    template: '24mm wide-angle lens, {perspective} perspective depth, {distortion} subtle distortion, {dof} depth of field',
    paramDefs: [
      { key: 'perspective', label: 'Perspective Depth', type: 'intensity', default: 60, levels: { 0: 'flat neutral', 25: 'slight depth', 50: 'moderate exaggeration', 75: 'pronounced depth', 100: 'strong wide-angle depth' } },
      { key: 'distortion', label: 'Distortion', type: 'intensity', default: 30, levels: { 0: 'corrected', 25: 'slight barrel', 50: 'moderate barrel', 75: 'noticeable', 100: 'heavy distortion' } },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 35, levels: { 0: 'shallow for wide', 25: 'moderately deep', 50: 'deep', 75: 'very deep', 100: 'near infinite' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:normal-50mm': {
    template: '50mm standard lens, {naturalness} natural perspective, {distortion} minimal distortion, {dof} depth of field',
    paramDefs: [
      { key: 'naturalness', label: 'Natural Perspective', type: 'intensity', default: 80, levels: { 0: 'slightly artificial', 25: 'near natural', 50: 'natural', 75: 'very natural', 100: 'perfectly human-eye' } },
      { key: 'distortion', label: 'Distortion', type: 'intensity', default: 5, levels: { 0: 'zero distortion', 25: 'minimal', 50: 'slight', 75: 'moderate', 100: 'noticeable' } },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 50, levels: { 0: 'very shallow', 25: 'shallow', 50: 'balanced medium', 75: 'deep', 100: 'near infinite' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:telephoto-135mm': {
    template: '135mm telephoto lens, {compression} perspective compression, {subject_isolation} subject isolation, {dof} depth of field',
    paramDefs: [
      { key: 'compression', label: 'Compression', type: 'intensity', default: 70, levels: { 0: 'minimal compression', 25: 'slight', 50: 'moderate', 75: 'strong depth flattening', 100: 'extreme compression' } },
      { key: 'subject_isolation', label: 'Subject Isolation', type: 'intensity', default: 75, levels: { 0: 'background visible', 25: 'slightly separated', 50: 'well isolated', 75: 'clearly isolated', 100: 'completely separated' } },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 70, levels: { 0: 'deep', 25: 'moderate', 50: 'shallow', 75: 'very shallow', 100: 'razor thin' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:long-telephoto-200mm': {
    template: '200mm long telephoto lens, {compression} extreme compression, {bokeh_quality} bokeh quality, {dof} depth of field',
    paramDefs: [
      { key: 'compression', label: 'Compression', type: 'intensity', default: 85, levels: { 0: 'moderate compression', 25: 'strong', 50: 'heavy flattening', 75: 'extreme compression', 100: 'maximum telephoto flat' } },
      { key: 'bokeh_quality', label: 'Bokeh Quality', type: 'select', default: 'smooth creamy', options: ['crisp edges', 'smooth creamy', 'swirling', 'feathered soft'] },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 85, levels: { 0: 'moderate shallow', 25: 'shallow', 50: 'very shallow', 75: 'razor thin', 100: 'paper-thin sliver' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:macro': {
    template: 'macro lens extreme close-up, {magnification} magnification level, {dof} paper-thin depth of field, {detail_level} surface detail',
    paramDefs: [
      { key: 'magnification', label: 'Magnification', type: 'intensity', default: 75, levels: { 0: 'close focus', 25: 'near macro', 50: '1:1 macro', 75: 'high magnification', 100: 'extreme microscopic' } },
      { key: 'dof', label: 'Depth of Field', type: 'intensity', default: 90, levels: { 0: 'moderate shallow', 25: 'very shallow', 50: 'razor thin', 75: 'paper-thin', 100: 'near-infinite plane' } },
      { key: 'detail_level', label: 'Detail Level', type: 'intensity', default: 85, levels: { 0: 'softly detailed', 25: 'moderately detailed', 50: 'highly detailed', 75: 'micro-textured', 100: 'ultra-fine microscopic detail' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:fisheye': {
    template: 'fisheye lens, {distortion_degree} spherical barrel distortion, {fov} field of view, {horizon_curve} horizon curvature',
    paramDefs: [
      { key: 'distortion_degree', label: 'Distortion Degree', type: 'intensity', default: 85, levels: { 0: 'mild fisheye', 25: 'moderate fisheye', 50: 'strong fisheye', 75: 'extreme fisheye', 100: 'full circular fisheye' } },
      { key: 'fov', label: 'Field of View', type: 'select', default: '180-degree', options: ['140-degree', '160-degree', '180-degree', 'full circular'] },
      { key: 'horizon_curve', label: 'Horizon Curve', type: 'intensity', default: 80, levels: { 0: 'slight curve', 25: 'moderate bend', 50: 'strong arc', 75: 'dramatic bow', 100: 'extreme spherical bend' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:tilt-shift': {
    template: 'tilt-shift lens, {focus_band} selective focus band, {miniature_effect} miniature diorama effect, {tilt_angle} tilt angle',
    paramDefs: [
      { key: 'focus_band', label: 'Focus Band', type: 'intensity', default: 65, levels: { 0: 'very wide band', 25: 'moderate band', 50: 'narrow sharp band', 75: 'very narrow', 100: 'razor-thin focus line' } },
      { key: 'miniature_effect', label: 'Miniature Effect', type: 'intensity', default: 70, levels: { 0: 'subtle selective focus', 25: 'slight miniature', 50: 'clear diorama feel', 75: 'strong miniature', 100: 'extreme toy model look' } },
      { key: 'tilt_angle', label: 'Tilt Angle', type: 'select', default: 'moderate tilt', options: ['slight tilt', 'moderate tilt', 'strong tilt', 'maximum tilt'] },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:anamorphic': {
    template: 'anamorphic lens, {lens_flare} horizontal lens flares, {bokeh_shape} oval bokeh, {squeeze} anamorphic squeeze character',
    paramDefs: [
      { key: 'lens_flare', label: 'Lens Flare', type: 'intensity', default: 65, levels: { 0: 'no flares', 25: 'subtle streak', 50: 'visible horizontal flare', 75: 'dramatic anamorphic streak', 100: 'intense long horizontal beam' } },
      { key: 'bokeh_shape', label: 'Bokeh Shape', type: 'select', default: 'oval stretched', options: ['circular', 'slightly oval', 'oval stretched', 'highly elongated'] },
      { key: 'squeeze', label: 'Squeeze Character', type: 'intensity', default: 60, levels: { 0: 'spherical feel', 25: 'slight squeeze', 50: 'moderate anamorphic', 75: 'strong cinematic squeeze', 100: 'extreme scope feel' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:vintage-soft': {
    template: 'vintage soft-focus lens, {halation} highlight halation, {softness} dreamy softness, {contrast} contrast level',
    paramDefs: [
      { key: 'halation', label: 'Halation', type: 'intensity', default: 60, levels: { 0: 'no halation', 25: 'faint glow', 50: 'gentle halation', 75: 'pronounced glow bleed', 100: 'heavy bloom' } },
      { key: 'softness', label: 'Softness', type: 'intensity', default: 65, levels: { 0: 'sharp with character', 25: 'slightly soft', 50: 'dreamy soft', 75: 'very soft', 100: 'heavily diffused' } },
      { key: 'contrast', label: 'Contrast', type: 'intensity', default: 35, levels: { 0: 'flat low contrast', 25: 'reduced contrast', 50: 'moderate', 75: 'normal', 100: 'full contrast' } },
    ],
    conflictGroup: 'lens:focal-length',
  },
  'lens:pinhole': {
    template: 'pinhole camera effect, {sharpness} infinite depth rendering, {vignette} natural vignette, {rendering_quality} overall rendering',
    paramDefs: [
      { key: 'sharpness', label: 'Sharpness', type: 'intensity', default: 40, levels: { 0: 'very soft all over', 25: 'soft', 50: 'slightly soft', 75: 'moderate', 100: 'relatively sharp pinhole' } },
      { key: 'vignette', label: 'Vignette', type: 'intensity', default: 70, levels: { 0: 'no vignette', 25: 'slight darkening', 50: 'moderate vignette', 75: 'heavy vignette', 100: 'extreme tunnel vignette' } },
      { key: 'rendering_quality', label: 'Rendering Quality', type: 'select', default: 'soft diffuse all planes', options: ['sharp central focus', 'soft diffuse all planes', 'painterly soft', 'extreme diffusion'] },
    ],
    conflictGroup: 'lens:focal-length',
  },

  // ── composition: remaining ──
  'composition:center-frame': {
    template: 'centered framing with {symmetry} symmetry, {subject_fill} subject fill, {background_balance} background balance',
    paramDefs: [
      { key: 'symmetry', label: 'Symmetry', type: 'intensity', default: 80, levels: { 0: 'loose centered', 25: 'approximate symmetry', 50: 'balanced symmetry', 75: 'precise symmetry', 100: 'perfect bilateral mirror' } },
      { key: 'subject_fill', label: 'Subject Fill', type: 'select', default: 'medium centered', options: ['tight portrait fill', 'medium centered', 'small centered in space', 'full frame fill'] },
      { key: 'background_balance', label: 'Background Balance', type: 'intensity', default: 65, levels: { 0: 'minimal background', 25: 'compressed background', 50: 'balanced', 75: 'spacious background', 100: 'wide environmental context' } },
    ],
  },
  'composition:golden-ratio': {
    template: 'golden ratio spiral composition, {adherence} adherence to phi ratio, {spiral_direction} spiral direction, {focal_placement} focal point placement',
    paramDefs: [
      { key: 'adherence', label: 'Adherence', type: 'intensity', default: 75, levels: { 0: 'loose approximation', 25: 'general guidance', 50: 'moderate precision', 75: 'close adherence', 100: 'mathematically precise' } },
      { key: 'spiral_direction', label: 'Spiral Direction', type: 'select', default: 'left to right', options: ['left to right', 'right to left', 'diagonal rising', 'diagonal descending'] },
      { key: 'focal_placement', label: 'Focal Placement', type: 'select', default: 'at convergence point', options: ['at spiral origin', 'at convergence point', 'along spiral arc', 'near center of phi rectangle'] },
    ],
  },
  'composition:leading-lines': {
    template: 'leading lines composition, {line_strength} converging guides, {line_type} line type, {depth_pull} depth pull toward subject',
    paramDefs: [
      { key: 'line_strength', label: 'Line Strength', type: 'intensity', default: 70, levels: { 0: 'subtle implied lines', 25: 'faint guides', 50: 'clear leading lines', 75: 'strong converging lines', 100: 'dominant dramatic convergence' } },
      { key: 'line_type', label: 'Line Type', type: 'select', default: 'architectural perspective', options: ['road or path', 'architectural perspective', 'natural organic', 'diagonal abstract'] },
      { key: 'depth_pull', label: 'Depth Pull', type: 'intensity', default: 65, levels: { 0: 'flat decorative', 25: 'slight depth suggestion', 50: 'moderate depth pull', 75: 'strong receding depth', 100: 'extreme vanishing point pull' } },
    ],
  },
  'composition:dutch-angle': {
    template: 'Dutch angle tilt, {tilt_degree} camera tilt, {tension_level} visual tension, {horizon_break} horizon line break',
    paramDefs: [
      { key: 'tilt_degree', label: 'Tilt Degree', type: 'intensity', default: 60, levels: { 0: 'barely tilted', 25: 'slight canted angle', 50: 'moderate Dutch angle', 75: 'strong tilt', 100: 'extreme near-diagonal' } },
      { key: 'tension_level', label: 'Tension Level', type: 'intensity', default: 65, levels: { 0: 'playful tilt', 25: 'mild unease', 50: 'noticeable tension', 75: 'strong unease', 100: 'extreme disorientation' } },
      { key: 'horizon_break', label: 'Horizon Direction', type: 'select', default: 'rising left to right', options: ['rising left to right', 'falling left to right', 'steep rising', 'steep falling'] },
    ],
  },
  'composition:negative-space': {
    template: 'negative space composition, {space_ratio} empty space proportion, {space_character} space character, {subject_scale} subject scale',
    paramDefs: [
      { key: 'space_ratio', label: 'Space Ratio', type: 'intensity', default: 70, levels: { 0: 'slight negative space', 25: 'moderate open area', 50: 'generous space', 75: 'dominant empty space', 100: 'extreme minimal subject' } },
      { key: 'space_character', label: 'Space Character', type: 'select', default: 'clean open field', options: ['sky or horizon', 'clean open field', 'textured neutral', 'deep dark void'] },
      { key: 'subject_scale', label: 'Subject Scale', type: 'intensity', default: 30, levels: { 0: 'tiny in frame', 25: 'small', 50: 'medium', 75: 'medium-large', 100: 'large but surrounded by space' } },
    ],
  },
  'composition:symmetrical': {
    template: 'symmetrical bilateral composition, {symmetry_precision} mirror precision, {axis_orientation} axis orientation, {depth_layers} depth layers',
    paramDefs: [
      { key: 'symmetry_precision', label: 'Symmetry Precision', type: 'intensity', default: 85, levels: { 0: 'approximate', 25: 'mostly symmetrical', 50: 'balanced', 75: 'precise', 100: 'perfect mathematical mirror' } },
      { key: 'axis_orientation', label: 'Axis Orientation', type: 'select', default: 'vertical center', options: ['vertical center', 'horizontal center', 'diagonal', 'radial'] },
      { key: 'depth_layers', label: 'Depth Layers', type: 'intensity', default: 50, levels: { 0: 'flat 2D symmetry', 25: 'shallow depth', 50: 'moderate depth layers', 75: 'deep receding symmetry', 100: 'infinite corridor symmetry' } },
    ],
  },
  'composition:frame-within-frame': {
    template: 'frame-within-frame composition, {frame_type} secondary frame element, {frame_depth} depth layering, {subject_placement} subject placement',
    paramDefs: [
      { key: 'frame_type', label: 'Frame Type', type: 'select', default: 'architectural opening', options: ['architectural opening', 'natural foliage arch', 'window or doorway', 'shadow silhouette frame'] },
      { key: 'frame_depth', label: 'Frame Depth', type: 'intensity', default: 65, levels: { 0: 'flat near-same plane', 25: 'slight depth separation', 50: 'moderate depth layers', 75: 'clear depth staging', 100: 'extreme foreground-background separation' } },
      { key: 'subject_placement', label: 'Subject Placement', type: 'select', default: 'centered in inner frame', options: ['centered in inner frame', 'offset in frame', 'partially framed', 'deep background'] },
    ],
  },
  'composition:over-the-shoulder': {
    template: 'over-the-shoulder framing, {foreground_presence} foreground figure presence, {eyeline_angle} eyeline angle, {subject_visibility} subject visibility',
    paramDefs: [
      { key: 'foreground_presence', label: 'Foreground Presence', type: 'intensity', default: 60, levels: { 0: 'barely visible shoulder', 25: 'partial shoulder', 50: 'clear shoulder and head', 75: 'dominant foreground figure', 100: 'large foreground blocking edge' } },
      { key: 'eyeline_angle', label: 'Eyeline Angle', type: 'select', default: 'level eyeline', options: ['slightly below eyeline', 'level eyeline', 'slightly above eyeline', 'steep high angle'] },
      { key: 'subject_visibility', label: 'Subject Visibility', type: 'intensity', default: 70, levels: { 0: 'partially obscured', 25: 'half visible', 50: 'mostly visible', 75: 'clearly visible', 100: 'full subject in clean view' } },
    ],
  },
  'composition:extreme-close-up': {
    template: 'extreme close-up framing, {crop_tightness} crop tightness, {detail_focus} detail focus area, {intimacy} intimacy intensity',
    paramDefs: [
      { key: 'crop_tightness', label: 'Crop Tightness', type: 'intensity', default: 85, levels: { 0: 'tight close-up', 25: 'close-up', 50: 'extreme close-up', 75: 'very extreme', 100: 'ultra-tight macro close-up' } },
      { key: 'detail_focus', label: 'Detail Focus', type: 'select', default: 'eyes or face detail', options: ['eyes or face detail', 'hands or extremity', 'texture surface', 'object detail'] },
      { key: 'intimacy', label: 'Intimacy Level', type: 'intensity', default: 80, levels: { 0: 'clinical observational', 25: 'close inspection', 50: 'intimate detail', 75: 'intense personal', 100: 'overwhelming immersive' } },
    ],
  },

  // ── emotion sample ──
  'emotion:tense': {
    template: '{atmosphere} tense atmosphere, {environment_cue} environmental cues, {rhythm} visual rhythm, {color_shift} color shift',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 70, levels: { 0: 'barely', 25: 'subtly', 50: 'noticeably', 75: 'palpably', 100: 'overwhelmingly' } },
      { key: 'environment_cue', label: 'Environment Cues', type: 'select', default: 'narrowing shadows', options: ['still silence', 'narrowing shadows', 'flickering lights', 'enclosing walls'] },
      { key: 'rhythm', label: 'Visual Rhythm', type: 'select', default: 'tight constrained', options: ['slow building', 'tight constrained', 'staccato jarring', 'accelerating'] },
      { key: 'color_shift', label: 'Color Shift', type: 'select', default: 'desaturated cool', options: ['none', 'desaturated cool', 'sickly green', 'high contrast BW'] },
    ],
  },

  // ── emotion: remaining ──
  'emotion:neutral': {
    template: '{atmosphere} neutral atmosphere, {tone} emotional tone, {light_quality} light quality',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 50, levels: { 0: 'void of emotion', 25: 'mostly neutral', 50: 'calm and balanced', 75: 'poised and objective', 100: 'completely impartial' } },
      { key: 'tone', label: 'Emotional Tone', type: 'select', default: 'balanced', options: ['detached', 'balanced', 'observational', 'composed'] },
      { key: 'light_quality', label: 'Light Quality', type: 'select', default: 'even diffused', options: ['flat even', 'even diffused', 'soft natural', 'neutral overhead'] },
    ],
  },
  'emotion:hopeful': {
    template: '{atmosphere} hopeful atmosphere, {light_quality} uplifting light, {color_warmth} warm color tones, {space} spatial openness',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 65, levels: { 0: 'barely present', 25: 'subtly', 50: 'noticeably', 75: 'strongly', 100: 'overwhelmingly' } },
      { key: 'light_quality', label: 'Light Quality', type: 'select', default: 'gentle morning', options: ['gentle morning', 'golden breakthrough', 'soft diffused', 'radiant backlit'] },
      { key: 'color_warmth', label: 'Color Warmth', type: 'intensity', default: 60, levels: { 0: 'neutral tones', 25: 'slightly warm', 50: 'warm amber', 75: 'rich golden', 100: 'blazing sunrise' } },
      { key: 'space', label: 'Spatial Openness', type: 'select', default: 'open airy', options: ['contained but bright', 'open airy', 'vast expansive', 'infinite horizon'] },
    ],
  },
  'emotion:awe': {
    template: '{atmosphere} awe-inspiring grandeur, {scale} scale, {light_drama} dramatic light, {perspective} perspective',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 80, levels: { 0: 'modest', 25: 'impressive', 50: 'breathtaking', 75: 'overwhelming', 100: 'incomprehensible vastness' } },
      { key: 'scale', label: 'Scale', type: 'select', default: 'monumental', options: ['large', 'monumental', 'colossal', 'cosmic infinite'] },
      { key: 'light_drama', label: 'Light Drama', type: 'intensity', default: 75, levels: { 0: 'soft even', 25: 'subtle rays', 50: 'god rays', 75: 'heavenly beams', 100: 'transcendent radiance' } },
      { key: 'perspective', label: 'Perspective', type: 'select', default: 'low looking up', options: ['eye level', 'low looking up', 'aerial overview', 'extreme ultra-wide'] },
    ],
  },
  'emotion:melancholic': {
    template: '{atmosphere} melancholic somber mood, {color_grade} color grading, {movement} movement quality, {isolation} sense of isolation',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 70, levels: { 0: 'slightly wistful', 25: 'pensive', 50: 'sorrowful', 75: 'heavy grief', 100: 'crushing desolation' } },
      { key: 'color_grade', label: 'Color Grade', type: 'select', default: 'muted desaturated', options: ['cool grey', 'muted desaturated', 'blue-tinted', 'drained sepia'] },
      { key: 'movement', label: 'Movement Quality', type: 'select', default: 'slow contemplative', options: ['static still', 'slow contemplative', 'drifting aimless', 'barely perceptible'] },
      { key: 'isolation', label: 'Isolation', type: 'intensity', default: 65, levels: { 0: 'surrounded', 25: 'slightly apart', 50: 'alone', 75: 'isolated', 100: 'utterly solitary' } },
    ],
  },
  'emotion:euphoric': {
    template: '{atmosphere} euphoric joyful energy, {color_vibrancy} vivid colors, {movement} dynamic movement, {light_intensity} radiant light',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 75, levels: { 0: 'mildly pleased', 25: 'cheerful', 50: 'joyful', 75: 'exhilarated', 100: 'ecstatic bliss' } },
      { key: 'color_vibrancy', label: 'Color Vibrancy', type: 'intensity', default: 80, levels: { 0: 'muted', 25: 'bright', 50: 'vivid', 75: 'blazing saturated', 100: 'electric oversaturated' } },
      { key: 'movement', label: 'Movement', type: 'select', default: 'dynamic sweeping', options: ['bouncy rhythmic', 'dynamic sweeping', 'spinning whirling', 'explosive burst'] },
      { key: 'light_intensity', label: 'Light Intensity', type: 'intensity', default: 70, levels: { 0: 'soft glow', 25: 'bright', 50: 'brilliant', 75: 'radiant flooding', 100: 'blinding luminance' } },
    ],
  },
  'emotion:ominous': {
    template: '{atmosphere} ominous foreboding atmosphere, {shadow_depth} deep shadows, {angle} unsettling angle, {dread_build} dread building',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 75, levels: { 0: 'mildly uneasy', 25: 'unsettling', 50: 'threatening', 75: 'deeply ominous', 100: 'inescapable doom' } },
      { key: 'shadow_depth', label: 'Shadow Depth', type: 'intensity', default: 80, levels: { 0: 'light shadows', 25: 'moderate shadow', 50: 'deep shadows', 75: 'near-black', 100: 'absolute darkness' } },
      { key: 'angle', label: 'Camera Angle', type: 'select', default: 'low angle upward', options: ['slightly low', 'low angle upward', 'extreme dutch angle', 'overhead menacing'] },
      { key: 'dread_build', label: 'Dread Building', type: 'select', default: 'slow creeping', options: ['sudden', 'slow creeping', 'tension mounting', 'inevitable approach'] },
    ],
  },
  'emotion:intimate': {
    template: '{atmosphere} intimate close atmosphere, {proximity} sense of proximity, {light_softness} soft warm light, {focus} shallow focus',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 70, levels: { 0: 'merely close', 25: 'personal', 50: 'intimate', 75: 'deeply private', 100: 'vulnerably exposed' } },
      { key: 'proximity', label: 'Proximity', type: 'select', default: 'close personal', options: ['personal space', 'close personal', 'touching near', 'breath-close'] },
      { key: 'light_softness', label: 'Light Softness', type: 'intensity', default: 75, levels: { 0: 'neutral', 25: 'soft warm', 50: 'gentle glow', 75: 'tender warm', 100: 'caressing luminance' } },
      { key: 'focus', label: 'Depth of Field', type: 'select', default: 'shallow soft bokeh', options: ['moderate', 'shallow soft bokeh', 'razor thin', 'painterly blur'] },
    ],
  },
  'emotion:triumphant': {
    template: '{atmosphere} triumphant victorious energy, {angle} heroic angle, {light_power} powerful light, {scale} grand scale',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 80, levels: { 0: 'modest success', 25: 'proud', 50: 'victorious', 75: 'triumphant', 100: 'legendary conquest' } },
      { key: 'angle', label: 'Heroic Angle', type: 'select', default: 'low hero angle', options: ['eye level confident', 'low hero angle', 'extreme low upward', 'crane ascending'] },
      { key: 'light_power', label: 'Light Power', type: 'intensity', default: 75, levels: { 0: 'soft fill', 25: 'strong side light', 50: 'bold rim light', 75: 'heroic backlight', 100: 'divine radiance' } },
      { key: 'scale', label: 'Grand Scale', type: 'select', default: 'monumental', options: ['impressive', 'monumental', 'epic sweeping', 'colossal world-spanning'] },
    ],
  },
  'emotion:playful': {
    template: '{atmosphere} playful lighthearted mood, {color_energy} saturated colors, {movement} bouncy movement, {whimsy} whimsy detail',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 65, levels: { 0: 'lightly fun', 25: 'cheerful', 50: 'playful', 75: 'whimsical', 100: 'cartoonish exuberant' } },
      { key: 'color_energy', label: 'Color Energy', type: 'intensity', default: 70, levels: { 0: 'muted soft', 25: 'bright', 50: 'saturated', 75: 'vivid pop', 100: 'neon rainbow' } },
      { key: 'movement', label: 'Movement', type: 'select', default: 'bouncy rhythmic', options: ['gentle skip', 'bouncy rhythmic', 'erratic playful', 'spinning twirling'] },
      { key: 'whimsy', label: 'Whimsy', type: 'select', default: 'subtle quirk', options: ['realistic grounded', 'subtle quirk', 'whimsical accents', 'full storybook fantasy'] },
    ],
  },
  'emotion:reflective': {
    template: '{atmosphere} reflective introspective atmosphere, {stillness} quiet stillness, {light_nature} natural light, {framing} thoughtful framing',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 65, levels: { 0: 'briefly pausing', 25: 'contemplative', 50: 'deeply reflective', 75: 'meditative', 100: 'transcendently still' } },
      { key: 'stillness', label: 'Stillness', type: 'intensity', default: 70, levels: { 0: 'slow movement', 25: 'gentle drift', 50: 'near still', 75: 'motionless', 100: 'frozen suspended' } },
      { key: 'light_nature', label: 'Light Nature', type: 'select', default: 'soft natural window', options: ['early morning soft', 'soft natural window', 'golden hour quiet', 'diffused overcast'] },
      { key: 'framing', label: 'Framing', type: 'select', default: 'wide observational', options: ['intimate close', 'wide observational', 'environmental portrait', 'solitary negative space'] },
    ],
  },
  'emotion:urgent': {
    template: '{atmosphere} urgent pressing atmosphere, {movement_speed} rapid movement, {framing_tension} tight framing, {intensity} heightened intensity',
    paramDefs: [
      { key: 'atmosphere', label: 'Atmosphere', type: 'intensity', default: 75, levels: { 0: 'mildly rushed', 25: 'pressing', 50: 'urgent', 75: 'crisis-level', 100: 'desperate frantic' } },
      { key: 'movement_speed', label: 'Movement Speed', type: 'select', default: 'rapid cutting', options: ['brisk handheld', 'rapid cutting', 'frenetic chase', 'whip-pan burst'] },
      { key: 'framing_tension', label: 'Framing Tension', type: 'intensity', default: 70, levels: { 0: 'open wide', 25: 'slightly tight', 50: 'close tight', 75: 'claustrophobic', 100: 'extreme close-up' } },
      { key: 'intensity', label: 'Intensity', type: 'select', default: 'building escalating', options: ['sustained high', 'building escalating', 'explosive burst', 'relentless driving'] },
    ],
  },

  // ── flow: pacing ──
  'flow:linger': {
    template: '{pace} slow lingering pace, {held_duration} held moments, {rhythm} contemplative rhythm',
    paramDefs: [
      { key: 'pace', label: 'Pace', type: 'intensity', default: 25, levels: { 0: 'nearly frozen', 25: 'very slow', 50: 'leisurely', 75: 'unhurried', 100: 'meditative drift' } },
      { key: 'held_duration', label: 'Held Duration', type: 'select', default: 'extended lingering', options: ['briefly held', 'extended lingering', 'prolonged dwelling', 'indefinitely suspended'] },
      { key: 'rhythm', label: 'Rhythm Pattern', type: 'select', default: 'long breath exhale', options: ['even steady', 'long breath exhale', 'drifting formless', 'wave-like ebb'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:measured': {
    template: '{pace} measured deliberate pacing, {beat_regularity} beat regularity, {control} controlled rhythm',
    paramDefs: [
      { key: 'pace', label: 'Pace', type: 'intensity', default: 50, levels: { 0: 'very deliberate', 25: 'slow measured', 50: 'steady controlled', 75: 'purposeful brisk', 100: 'precisely timed' } },
      { key: 'beat_regularity', label: 'Beat Regularity', type: 'select', default: 'metronomic steady', options: ['loose organic', 'metronomic steady', 'precise clockwork', 'formal ceremonial'] },
      { key: 'control', label: 'Control Quality', type: 'select', default: 'deliberate purposeful', options: ['relaxed', 'deliberate purposeful', 'calculated restrained', 'exacting precise'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:conversational': {
    template: '{pace} conversational pace, {dialogue_rhythm} dialogue rhythm, {natural_flow} natural flow',
    paramDefs: [
      { key: 'pace', label: 'Pace', type: 'intensity', default: 50, levels: { 0: 'languorous', 25: 'relaxed', 50: 'natural', 75: 'engaged quick', 100: 'rapid-fire banter' } },
      { key: 'dialogue_rhythm', label: 'Dialogue Rhythm', type: 'select', default: 'natural back-and-forth', options: ['slow thoughtful', 'natural back-and-forth', 'overlapping casual', 'rapid witty exchange'] },
      { key: 'natural_flow', label: 'Flow Quality', type: 'select', default: 'relaxed organic', options: ['structured scripted', 'relaxed organic', 'improvisational loose', 'naturalistic observational'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:energetic': {
    template: '{pace} energetic quick pace, {momentum} forward momentum, {cut_energy} cut energy',
    paramDefs: [
      { key: 'pace', label: 'Pace', type: 'intensity', default: 70, levels: { 0: 'brisk', 25: 'quick', 50: 'energetic', 75: 'high-tempo', 100: 'lightning fast' } },
      { key: 'momentum', label: 'Momentum', type: 'select', default: 'driving forward', options: ['steady push', 'driving forward', 'surging burst', 'unstoppable charge'] },
      { key: 'cut_energy', label: 'Cut Energy', type: 'intensity', default: 65, levels: { 0: 'smooth transitions', 25: 'snappy cuts', 50: 'punchy edits', 75: 'rapid-fire', 100: 'staccato assault' } },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:frantic': {
    template: '{pace} frantic rapid-fire pacing, {chaos_level} chaotic urgency, {compression} compressed timing',
    paramDefs: [
      { key: 'pace', label: 'Pace', type: 'intensity', default: 90, levels: { 0: 'fast', 25: 'very fast', 50: 'frantic', 75: 'chaotic rush', 100: 'overwhelming overload' } },
      { key: 'chaos_level', label: 'Chaos Level', type: 'select', default: 'urgent disarray', options: ['rapid ordered', 'urgent disarray', 'frenetic scatter', 'maximal chaos'] },
      { key: 'compression', label: 'Time Compression', type: 'intensity', default: 80, levels: { 0: 'slightly compressed', 25: 'noticeably fast', 50: 'time-compressed', 75: 'intensely rapid', 100: 'hyper-compressed' } },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:rhythmic-pulse': {
    template: '{pace} rhythmic pulsing pace, {pulse_regularity} pulse regularity, {musical_sync} musical beat alignment',
    paramDefs: [
      { key: 'pace', label: 'Pace', type: 'intensity', default: 60, levels: { 0: 'slow pulse', 25: 'moderate beat', 50: 'rhythmic pulse', 75: 'strong beat', 100: 'driving pulse' } },
      { key: 'pulse_regularity', label: 'Pulse Regularity', type: 'select', default: 'steady metronomic', options: ['loose groove', 'steady metronomic', 'syncopated offbeat', 'hypnotic lockstep'] },
      { key: 'musical_sync', label: 'Musical Sync', type: 'select', default: 'on-beat cuts', options: ['free flowing', 'on-beat cuts', 'downbeat emphasis', 'every measure'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:stop-and-breathe': {
    template: '{motion_contrast} alternating motion and stillness, {pause_weight} pause weight, {breath_rhythm} breathing rhythm',
    paramDefs: [
      { key: 'motion_contrast', label: 'Motion Contrast', type: 'intensity', default: 70, levels: { 0: 'subtle variation', 25: 'noticeable shift', 50: 'clear contrast', 75: 'strong dynamic', 100: 'extreme poles' } },
      { key: 'pause_weight', label: 'Pause Weight', type: 'select', default: 'meaningful breath', options: ['brief rest', 'meaningful breath', 'long held exhale', 'suspended stillness'] },
      { key: 'breath_rhythm', label: 'Breath Rhythm', type: 'select', default: 'organic uneven', options: ['regular intervals', 'organic uneven', 'emotionally timed', 'dramatic punctuation'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:acceleration-ramp': {
    template: '{start_pace} starting pace accelerating to {peak} climactic peak, {ramp_curve} acceleration curve',
    paramDefs: [
      { key: 'start_pace', label: 'Start Pace', type: 'select', default: 'slow deliberate', options: ['near still', 'slow deliberate', 'moderate opening', 'already moving'] },
      { key: 'peak', label: 'Climactic Peak', type: 'intensity', default: 90, levels: { 0: 'moderate speed', 25: 'fast', 50: 'very fast', 75: 'frantic', 100: 'explosive maximum' } },
      { key: 'ramp_curve', label: 'Acceleration Curve', type: 'select', default: 'gradual build', options: ['linear steady', 'gradual build', 'exponential surge', 'sudden final rush'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:deceleration-ramp': {
    template: '{start_pace} starting pace decelerating to {final_stillness} stillness, {wind_down} wind-down quality',
    paramDefs: [
      { key: 'start_pace', label: 'Start Pace', type: 'select', default: 'fast action', options: ['moderate motion', 'fast action', 'frantic rush', 'explosive opening'] },
      { key: 'final_stillness', label: 'Final Stillness', type: 'intensity', default: 20, levels: { 0: 'gentle slow', 25: 'calm still', 50: 'nearly motionless', 75: 'serene halt', 100: 'absolute stillness' } },
      { key: 'wind_down', label: 'Wind-Down Quality', type: 'select', default: 'graceful deceleration', options: ['abrupt stop', 'graceful deceleration', 'exhale settling', 'peaceful dissolution'] },
    ],
    conflictGroup: 'flow:pacing',
  },
  'flow:montage-beat': {
    template: '{cut_speed} montage-style rhythmic cutting, {shot_variety} shot variety, {narrative_build} narrative juxtaposition',
    paramDefs: [
      { key: 'cut_speed', label: 'Cut Speed', type: 'intensity', default: 70, levels: { 0: 'slow montage', 25: 'moderate cuts', 50: 'quick cutting', 75: 'rapid montage', 100: 'flash-cut barrage' } },
      { key: 'shot_variety', label: 'Shot Variety', type: 'select', default: 'mixed angles and scales', options: ['similar angles', 'mixed angles and scales', 'extreme contrasts', 'thematic groupings'] },
      { key: 'narrative_build', label: 'Narrative Build', type: 'select', default: 'building crescendo', options: ['parallel montage', 'building crescendo', 'associative juxtaposition', 'rhythmic accumulation'] },
    ],
    conflictGroup: 'flow:pacing',
  },

  // ── flow: transition ──
  'flow:hard-cut': {
    template: '{sharpness} instantaneous hard cut, {contrast} scene contrast, {timing} cut timing',
    paramDefs: [
      { key: 'sharpness', label: 'Cut Sharpness', type: 'select', default: 'sharp immediate', options: ['crisp', 'sharp immediate', 'jarring abrupt', 'brutal direct'] },
      { key: 'contrast', label: 'Scene Contrast', type: 'intensity', default: 60, levels: { 0: 'similar scenes', 25: 'mild contrast', 50: 'noticeable shift', 75: 'strong contrast', 100: 'maximum juxtaposition' } },
      { key: 'timing', label: 'Cut Timing', type: 'select', default: 'on action beat', options: ['before action peak', 'on action beat', 'after impact', 'mid-movement'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:match-cut': {
    template: '{match_quality} match cut linking {match_type} between shots, {continuity} continuity feel',
    paramDefs: [
      { key: 'match_quality', label: 'Match Quality', type: 'intensity', default: 80, levels: { 0: 'loose approximation', 25: 'similar shape', 50: 'clear match', 75: 'precise alignment', 100: 'perfect geometric match' } },
      { key: 'match_type', label: 'Match Type', type: 'select', default: 'shape and form', options: ['movement direction', 'shape and form', 'color and tone', 'subject position'] },
      { key: 'continuity', label: 'Continuity', type: 'select', default: 'seamless flow', options: ['invisible edit', 'seamless flow', 'graceful bridge', 'poetic connection'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:jump-cut': {
    template: '{jump_intensity} jump cut creating {temporal_skip} temporal skip, {jarring_quality} jarring quality',
    paramDefs: [
      { key: 'jump_intensity', label: 'Jump Intensity', type: 'intensity', default: 65, levels: { 0: 'slight skip', 25: 'noticeable jump', 50: 'abrupt leap', 75: 'jarring cut', 100: 'disorienting lurch' } },
      { key: 'temporal_skip', label: 'Temporal Skip', type: 'select', default: 'brief forward skip', options: ['slight moment', 'brief forward skip', 'moderate time leap', 'significant gap'] },
      { key: 'jarring_quality', label: 'Jarring Quality', type: 'select', default: 'intentional abruptness', options: ['subtle irregularity', 'intentional abruptness', 'stylistic energy', 'aggressive disruption'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:crossfade': {
    template: '{fade_speed} smooth crossfade dissolve, {opacity_blend} opacity blend, {mood_bridge} mood bridging',
    paramDefs: [
      { key: 'fade_speed', label: 'Fade Speed', type: 'select', default: 'gradual smooth', options: ['quick soft', 'gradual smooth', 'long slow', 'dreamy extended'] },
      { key: 'opacity_blend', label: 'Opacity Blend', type: 'intensity', default: 50, levels: { 0: 'barely overlapping', 25: 'brief overlap', 50: 'even blend', 75: 'long overlap', 100: 'prolonged double-exposure' } },
      { key: 'mood_bridge', label: 'Mood Bridge', type: 'select', default: 'gentle transition', options: ['neutral blend', 'gentle transition', 'emotional carry-over', 'dreamlike merge'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:dip-to-black': {
    template: '{dip_speed} fade to black, {black_duration} black hold, {re_emergence} re-emergence quality',
    paramDefs: [
      { key: 'dip_speed', label: 'Dip Speed', type: 'select', default: 'gradual fade', options: ['quick dip', 'gradual fade', 'slow descent', 'prolonged darkening'] },
      { key: 'black_duration', label: 'Black Duration', type: 'intensity', default: 40, levels: { 0: 'instant touch', 25: 'brief moment', 50: 'held beat', 75: 'long pause', 100: 'extended darkness' } },
      { key: 're_emergence', label: 'Re-emergence', type: 'select', default: 'gradual reveal', options: ['immediate cut', 'gradual reveal', 'slow brightening', 'gentle dawn'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:dip-to-white': {
    template: '{dip_speed} fade to white, {white_duration} white hold, {return_quality} return quality',
    paramDefs: [
      { key: 'dip_speed', label: 'Dip Speed', type: 'select', default: 'gradual brightening', options: ['flash quick', 'gradual brightening', 'slow bloom', 'overexposure creep'] },
      { key: 'white_duration', label: 'White Duration', type: 'intensity', default: 35, levels: { 0: 'instant flash', 25: 'brief white', 50: 'held moment', 75: 'long white pause', 100: 'extended blankness' } },
      { key: 'return_quality', label: 'Return Quality', type: 'select', default: 'emerging from light', options: ['cut from white', 'emerging from light', 'cooling down', 'crystallizing reveal'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:wipe-left': {
    template: '{wipe_speed} horizontal wipe sweeping left, {edge_quality} wipe edge, {new_scene} new scene arrival',
    paramDefs: [
      { key: 'wipe_speed', label: 'Wipe Speed', type: 'select', default: 'smooth moderate', options: ['slow reveal', 'smooth moderate', 'brisk sweep', 'rapid wipe'] },
      { key: 'edge_quality', label: 'Edge Quality', type: 'select', default: 'clean sharp edge', options: ['soft blurred edge', 'clean sharp edge', 'hard graphic edge', 'feathered blend'] },
      { key: 'new_scene', label: 'New Scene Feel', type: 'intensity', default: 55, levels: { 0: 'subtle arrival', 25: 'smooth entry', 50: 'clear replacement', 75: 'assertive entry', 100: 'forceful reveal' } },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:wipe-right': {
    template: '{wipe_speed} horizontal wipe sweeping right, {edge_quality} wipe edge, {new_scene} new scene arrival',
    paramDefs: [
      { key: 'wipe_speed', label: 'Wipe Speed', type: 'select', default: 'smooth moderate', options: ['slow reveal', 'smooth moderate', 'brisk sweep', 'rapid wipe'] },
      { key: 'edge_quality', label: 'Edge Quality', type: 'select', default: 'clean sharp edge', options: ['soft blurred edge', 'clean sharp edge', 'hard graphic edge', 'feathered blend'] },
      { key: 'new_scene', label: 'New Scene Feel', type: 'intensity', default: 55, levels: { 0: 'subtle arrival', 25: 'smooth entry', 50: 'clear replacement', 75: 'assertive entry', 100: 'forceful reveal' } },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:whip-pan-transition': {
    template: '{whip_speed} fast whip pan blur transition, {motion_blur_intensity} motion blur, {energy} kinetic energy',
    paramDefs: [
      { key: 'whip_speed', label: 'Whip Speed', type: 'select', default: 'sharp rapid', options: ['quick snap', 'sharp rapid', 'violent whip', 'lightning streak'] },
      { key: 'motion_blur_intensity', label: 'Motion Blur', type: 'intensity', default: 80, levels: { 0: 'slight smear', 25: 'noticeable blur', 50: 'heavy streaking', 75: 'full blur wipe', 100: 'total abstraction' } },
      { key: 'energy', label: 'Kinetic Energy', type: 'select', default: 'high-energy action', options: ['snappy transition', 'high-energy action', 'propulsive momentum', 'explosive burst'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:morph': {
    template: '{morph_speed} morphing transition warping {warp_quality} between scenes, {fluidity} fluid deformation',
    paramDefs: [
      { key: 'morph_speed', label: 'Morph Speed', type: 'select', default: 'smooth gradual', options: ['instant snap', 'smooth gradual', 'slow liquid', 'dreamy prolonged'] },
      { key: 'warp_quality', label: 'Warp Quality', type: 'intensity', default: 70, levels: { 0: 'slight warp', 25: 'noticeable deform', 50: 'flowing morph', 75: 'dramatic transformation', 100: 'complete dissolution' } },
      { key: 'fluidity', label: 'Fluidity', type: 'select', default: 'liquid organic', options: ['mechanical grid', 'liquid organic', 'elastic stretch', 'water ripple'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:glitch-cut': {
    template: '{glitch_intensity} digital glitch transition, {artifact_type} visual artifacts, {corruption_feel} data corruption feel',
    paramDefs: [
      { key: 'glitch_intensity', label: 'Glitch Intensity', type: 'intensity', default: 70, levels: { 0: 'subtle flicker', 25: 'minor distortion', 50: 'visible glitch', 75: 'heavy corruption', 100: 'total system failure' } },
      { key: 'artifact_type', label: 'Artifact Type', type: 'select', default: 'pixel distortion and chromatic aberration', options: ['scanline tear', 'pixel distortion and chromatic aberration', 'block corruption', 'signal noise'] },
      { key: 'corruption_feel', label: 'Corruption Feel', type: 'select', default: 'digital breakdown', options: ['aesthetic glitch-art', 'digital breakdown', 'broadcast failure', 'data loss'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:film-burn': {
    template: '{burn_intensity} film burn transition, {light_leak} organic light leak, {chemical_feel} chemical film degradation',
    paramDefs: [
      { key: 'burn_intensity', label: 'Burn Intensity', type: 'intensity', default: 65, levels: { 0: 'faint glow', 25: 'warm flare', 50: 'bright burn', 75: 'intense overexposure', 100: 'full white-out burn' } },
      { key: 'light_leak', label: 'Light Leak', type: 'select', default: 'warm orange leak', options: ['cool blue edge', 'warm orange leak', 'red chemical burn', 'golden halation'] },
      { key: 'chemical_feel', label: 'Chemical Feel', type: 'select', default: 'analog film degradation', options: ['clean flare', 'analog film degradation', 'vintage decay', 'hand-processed organic'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:luma-fade': {
    template: '{luma_direction} luminance-based fade transition, {bright_lead} bright area dissolve, {depth_quality} depth-aware blending',
    paramDefs: [
      { key: 'luma_direction', label: 'Luma Direction', type: 'select', default: 'highlights first', options: ['shadows first', 'highlights first', 'midtones dissolve', 'radial from center'] },
      { key: 'bright_lead', label: 'Bright Lead', type: 'intensity', default: 65, levels: { 0: 'uniform fade', 25: 'slight luma bias', 50: 'clear luma-based', 75: 'strong highlight lead', 100: 'light dissolves last' } },
      { key: 'depth_quality', label: 'Depth Quality', type: 'select', default: 'ethereal layered', options: ['flat uniform', 'ethereal layered', 'atmospheric depth', 'volumetric dissolve'] },
    ],
    conflictGroup: 'flow:transition',
  },
  'flow:iris-close': {
    template: '{iris_speed} circular iris closing transition, {center_point} center point, {frame_constriction} frame constriction',
    paramDefs: [
      { key: 'iris_speed', label: 'Iris Speed', type: 'select', default: 'smooth closing', options: ['slow deliberate', 'smooth closing', 'brisk snap', 'rapid close'] },
      { key: 'center_point', label: 'Center Point', type: 'select', default: 'on subject face', options: ['frame center', 'on subject face', 'action point', 'custom offset'] },
      { key: 'frame_constriction', label: 'Frame Constriction', type: 'intensity', default: 75, levels: { 0: 'partial close', 25: 'mostly closed', 50: 'near point', 75: 'pinpoint', 100: 'sealed shut' } },
    ],
    conflictGroup: 'flow:transition',
  },

  // ── technical: aspect-ratio ──
  'technical:cinematic-scope-239': {
    template: '2.39:1 anamorphic cinemascope widescreen framing, {framing_style} horizontal composition, {letterbox} letterbox treatment',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'ultra-wide panoramic', options: ['wide establishing', 'ultra-wide panoramic', 'extreme horizontal', 'intimate widescreen'] },
      { key: 'letterbox', label: 'Letterbox Treatment', type: 'select', default: 'standard black bars', options: ['standard black bars', 'blurred fill bars', 'color-matched bars', 'clean crop'] },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },
  'technical:standard-wide-169': {
    template: '16:9 standard widescreen framing, {framing_style} composition, {display_context} display context',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'broadcast balanced', options: ['broadcast balanced', 'cinematic wide', 'intimate medium', 'dynamic action'] },
      { key: 'display_context', label: 'Display Context', type: 'select', default: 'universal screen', options: ['television broadcast', 'universal screen', 'web streaming', 'presentation'] },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },
  'technical:academy-43': {
    template: '4:3 academy ratio framing, {framing_style} classic composition, {era_feel} era feel',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'centered classic', options: ['tight portrait feel', 'centered classic', 'symmetrical formal', 'theatrical stage'] },
      { key: 'era_feel', label: 'Era Feel', type: 'select', default: 'classic film', options: ['vintage television', 'classic film', 'documentary archival', 'contemporary nostalgic'] },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },
  'technical:vertical-mobile-916': {
    template: '9:16 vertical portrait framing, {framing_style} mobile composition, {content_type} content type',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'social media optimized', options: ['tight portrait', 'social media optimized', 'story-format', 'full-bleed vertical'] },
      { key: 'content_type', label: 'Content Type', type: 'select', default: 'social short-form', options: ['social short-form', 'vertical documentary', 'mobile gaming', 'portrait narrative'] },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },
  'technical:square-11': {
    template: '1:1 square framing, {framing_style} equal-dimension composition, {visual_balance} visual balance',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'centered balanced', options: ['centered balanced', 'offset dynamic', 'tight detail', 'wide environmental'] },
      { key: 'visual_balance', label: 'Visual Balance', type: 'select', default: 'symmetrical gallery', options: ['symmetrical gallery', 'dynamic asymmetric', 'minimal clean', 'Instagram grid'] },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },
  'technical:imax-143': {
    template: '1.43:1 IMAX ratio framing, {framing_style} near-square tall format, {vertical_field} vertical field of view',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'maximizing vertical', options: ['tall panoramic', 'maximizing vertical', 'immersive full', 'expansive overhead'] },
      { key: 'vertical_field', label: 'Vertical Field', type: 'intensity', default: 85, levels: { 0: 'standard height', 25: 'extended vertical', 50: 'tall expanded', 75: 'near-square tall', 100: 'maximum vertical FOV' } },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },
  'technical:ultra-wide-219': {
    template: '21:9 ultra-widescreen framing, {framing_style} panoramic composition, {immersion} immersive quality',
    paramDefs: [
      { key: 'framing_style', label: 'Framing Style', type: 'select', default: 'panoramic sweep', options: ['environmental context', 'panoramic sweep', 'cinematic ultra-wide', 'monitor ultrawide'] },
      { key: 'immersion', label: 'Immersion', type: 'intensity', default: 75, levels: { 0: 'standard wide', 25: 'noticeably wide', 50: 'expansive panoramic', 75: 'deeply immersive', 100: 'peripheral-filling' } },
    ],
    conflictGroup: 'technical:aspect-ratio',
  },

  // ── technical: quality ──
  'technical:draft': {
    template: '{fidelity} draft quality rendering, {render_speed} fast generation, {noise_tolerance} noise tolerance',
    paramDefs: [
      { key: 'fidelity', label: 'Detail Level', type: 'intensity', default: 20, levels: { 0: 'bare minimum', 25: 'low fidelity', 50: 'rough preview', 75: 'basic output', 100: 'acceptable draft' } },
      { key: 'render_speed', label: 'Render Speed', type: 'select', default: 'fast preview', options: ['fastest possible', 'fast preview', 'quick iteration', 'rapid prototype'] },
      { key: 'noise_tolerance', label: 'Noise Tolerance', type: 'select', default: 'high noise acceptable', options: ['high noise acceptable', 'moderate noise ok', 'some grain fine', 'minimal quality floor'] },
    ],
    conflictGroup: 'technical:quality',
  },
  'technical:standard': {
    template: '{fidelity} standard production quality, {render_balance} balanced render time, {output_quality} general-purpose output',
    paramDefs: [
      { key: 'fidelity', label: 'Detail Level', type: 'intensity', default: 55, levels: { 0: 'minimal', 25: 'basic', 50: 'standard', 75: 'refined', 100: 'polished standard' } },
      { key: 'render_balance', label: 'Render Balance', type: 'select', default: 'speed-quality balance', options: ['speed-favored', 'speed-quality balance', 'quality-favored', 'precise output'] },
      { key: 'output_quality', label: 'Output Quality', type: 'select', default: 'production-ready', options: ['prototype', 'production-ready', 'client-presentable', 'broadcast-safe'] },
    ],
    conflictGroup: 'technical:quality',
  },
  'technical:high-fidelity': {
    template: '{fidelity} high-fidelity quality, {texture_detail} refined textures, {render_precision} precise rendering',
    paramDefs: [
      { key: 'fidelity', label: 'Detail Level', type: 'intensity', default: 80, levels: { 0: 'good', 25: 'detailed', 50: 'highly detailed', 75: 'refined precise', 100: 'ultra-detailed' } },
      { key: 'texture_detail', label: 'Texture Detail', type: 'select', default: 'enhanced texture density', options: ['good texture', 'enhanced texture density', 'fine micro-detail', 'surface-level precision'] },
      { key: 'render_precision', label: 'Render Precision', type: 'select', default: 'high precision', options: ['standard', 'high precision', 'maximum fidelity steps', 'artifact-free'] },
    ],
    conflictGroup: 'technical:quality',
  },
  'technical:max-detail': {
    template: '{fidelity} maximum detail ultra-quality, {resolution_quality} highest resolution rendering, {texture_precision} full texture precision',
    paramDefs: [
      { key: 'fidelity', label: 'Detail Level', type: 'intensity', default: 100, levels: { 0: 'high', 25: 'very high', 50: 'ultra', 75: 'maximum', 100: 'absolute maximum detail' } },
      { key: 'resolution_quality', label: 'Resolution Quality', type: 'select', default: 'maximum resolution', options: ['high resolution', 'maximum resolution', 'native maximum', 'upscaled ultra'] },
      { key: 'texture_precision', label: 'Texture Precision', type: 'select', default: 'full detail surface', options: ['detailed', 'full detail surface', 'micro-texture accurate', 'photorealistic precision'] },
    ],
    conflictGroup: 'technical:quality',
  },
  'technical:turbo-preview': {
    template: '{fidelity} turbo fast preview, {step_reduction} minimal-step generation, {concept_speed} rapid concept exploration',
    paramDefs: [
      { key: 'fidelity', label: 'Detail Level', type: 'intensity', default: 10, levels: { 0: 'bare concept', 25: 'rough idea', 50: 'quick preview', 75: 'fast draft', 100: 'acceptable turbo' } },
      { key: 'step_reduction', label: 'Step Reduction', type: 'select', default: 'minimal steps', options: ['extreme reduction', 'minimal steps', 'fast preset', 'quick sample'] },
      { key: 'concept_speed', label: 'Concept Speed', type: 'select', default: 'instant iteration', options: ['rapid ideation', 'instant iteration', 'quick test', 'batch preview'] },
    ],
    conflictGroup: 'technical:quality',
  },
};

function buildPresetPrompt(category: PresetCategory, name: string): string {
  return PRESET_PROMPT_LIBRARY[`${category}:${name}`]
    ?? `${toTitleCase(name)}, ${CATEGORY_PROMPT_HINT[category]}`;
}

function buildDefaults(category: PresetCategory, name: string): PresetParamMap {
  if (category !== 'technical' || !ASPECT_RATIO_BY_NAME[name]) {
    return { ...CATEGORY_DEFAULTS[category] };
  }
  const ratio = ASPECT_RATIO_BY_NAME[name] ?? '16:9';
  return { ...CATEGORY_DEFAULTS.technical, ratio };
}

function cloneParamDefs(category: PresetCategory): PresetParamDefinition[] {
  return CATEGORY_PARAM_DEFS[category].map((param) => ({
    ...param,
    options: param.options ? [...param.options] : undefined,
  }));
}

const builtInPresetLibrary = PRESET_CATEGORIES.flatMap((category) => {
  return PRESET_NAME_LIBRARY[category].map((name): PresetDefinition => {
    const defaults = buildDefaults(category, name);
    const prompt = buildPresetPrompt(category, name);

    const preset: PresetDefinition = {
      id: buildPresetId(category, name),
      category,
      name,
      description: buildPresetDescription(category, name),
      prompt,
      builtIn: true,
      modified: false,
      defaultPrompt: prompt,
      defaultParams: { ...defaults },
      params: cloneParamDefs(category),
      defaults,
    };

    const presetKey = `${category}:${name}`;
    const templateEntry = PRESET_TEMPLATE_LIBRARY[presetKey];
    if (templateEntry) {
      preset.promptTemplate = templateEntry.template;
      preset.promptParamDefs = templateEntry.paramDefs;
      if (templateEntry.conflictGroup) {
        preset.conflictGroup = templateEntry.conflictGroup;
      }
    }

    return preset;
  });
});

if (builtInPresetLibrary.length !== 186) {
  throw new Error(`BUILT_IN_PRESET_LIBRARY must contain 186 presets, got ${builtInPresetLibrary.length}`);
}

export const BUILT_IN_PRESET_LIBRARY: PresetDefinition[] = builtInPresetLibrary;

// ---------------------------------------------------------------------------
// Shot Templates
// ---------------------------------------------------------------------------

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
