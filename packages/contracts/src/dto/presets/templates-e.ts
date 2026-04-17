/**
 * PRESET_TEMPLATE_LIBRARY fragment e. See templates-types.ts.
 */
import type { PresetTemplateEntry } from './templates-types.js';

export const PRESET_TEMPLATES_e: Record<string, PresetTemplateEntry> = {
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
};
