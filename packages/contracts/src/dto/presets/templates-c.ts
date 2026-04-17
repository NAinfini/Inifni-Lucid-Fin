/**
 * PRESET_TEMPLATE_LIBRARY fragment c. See templates-types.ts.
 */
import type { PresetTemplateEntry } from './templates-types.js';

export const PRESET_TEMPLATES_c: Record<string, PresetTemplateEntry> = {
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
};
