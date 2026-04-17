/**
 * PRESET_TEMPLATE_LIBRARY fragment f. See templates-types.ts.
 */
import type { PresetTemplateEntry } from './templates-types.js';

export const PRESET_TEMPLATES_f: Record<string, PresetTemplateEntry> = {
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
