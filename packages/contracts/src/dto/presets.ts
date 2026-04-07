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
  projectId?: string;
  sphericalPositions?: SphericalPosition[];
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
  aiDecide?: boolean;
  intensity?: number;
  direction?: CameraDirection;
  blend?: PresetBlendEntry<C>;
}

export interface PresetTrack<C extends PresetCategory = PresetCategory> {
  category: C;
  aiDecide: boolean;
  intensity?: number;
  entries: Array<PresetTrackEntry<C>>;
}

export type PresetTrackSet = { [K in PresetCategory]: PresetTrack<K> };

export function createEmptyPresetTrackSet(): PresetTrackSet {
  return {
    camera: { category: 'camera', aiDecide: true, entries: [] },
    lens: { category: 'lens', aiDecide: true, entries: [] },
    look: { category: 'look', aiDecide: true, entries: [] },
    scene: { category: 'scene', aiDecide: true, entries: [] },
    composition: { category: 'composition', aiDecide: true, entries: [] },
    emotion: { category: 'emotion', aiDecide: true, entries: [] },
    flow: { category: 'flow', aiDecide: true, entries: [] },
    technical: { category: 'technical', aiDecide: true, entries: [] },
  };
}

export interface PresetLibraryImportPayload {
  presets: PresetDefinition[];
  includeBuiltIn?: boolean;
  source?: 'file' | 'clipboard' | 'api';
}

export interface PresetLibraryExportRequest {
  includeBuiltIn?: boolean;
  projectId?: string;
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

    return {
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
  projectId?: string;
  createdAt?: number;
}

function shotTrack<C extends PresetCategory>(
  category: C,
  presetName: string,
  intensity: number,
): PresetTrack<C> {
  return {
    category,
    aiDecide: false,
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
