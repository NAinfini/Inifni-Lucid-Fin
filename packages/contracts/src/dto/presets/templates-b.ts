/**
 * PRESET_TEMPLATE_LIBRARY fragment b. See templates-types.ts.
 */
import type { PresetTemplateEntry } from './templates-types.js';

export const PRESET_TEMPLATES_b: Record<string, PresetTemplateEntry> = {
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
};
