/**
 * PRESET_TEMPLATE_LIBRARY fragment d. See templates-types.ts.
 */
import type { PresetTemplateEntry } from './templates-types.js';

export const PRESET_TEMPLATES_d: Record<string, PresetTemplateEntry> = {
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
};
