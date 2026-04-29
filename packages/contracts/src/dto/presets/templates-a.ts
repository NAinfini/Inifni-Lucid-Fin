/**
 * PRESET_TEMPLATE_LIBRARY fragment a. See templates-types.ts.
 */
import type { PresetTemplateEntry } from './templates-types.js';

export const PRESET_TEMPLATES_a: Record<string, PresetTemplateEntry> = {
  // ── camera samples ──
  'camera:dolly-in': {
    template:
      '{speed} camera dolly in toward the subject, {depth_effect} depth parallax, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow creeping', 'smooth', 'brisk', 'rapid'],
      },
      {
        key: 'depth_effect',
        label: 'Depth Effect',
        type: 'intensity',
        default: 70,
        levels: {
          0: 'minimal',
          25: 'subtle',
          50: 'noticeable',
          75: 'pronounced',
          100: 'dramatic layered',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on dolly track',
        options: ['on dolly track', 'handheld dolly', 'steadicam approach'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:orbit-cw': {
    template: 'camera orbits {speed} clockwise around the subject, {arc_width} arc, {elevation}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'arc_width',
        label: 'Arc Width',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'tight narrow',
          25: 'quarter',
          50: 'half',
          75: 'three-quarter',
          100: 'full 360-degree',
        },
      },
      {
        key: 'elevation',
        label: 'Elevation',
        type: 'select',
        default: 'at eye level',
        options: ['from below', 'at eye level', 'from slightly above', 'from high above'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:static-hold': {
    template: 'camera holds {stability} still, {framing} locked-off static shot',
    paramDefs: [
      {
        key: 'stability',
        label: 'Stability',
        type: 'select',
        default: 'completely',
        options: ['almost completely', 'completely', 'rock-solid'],
      },
      {
        key: 'framing',
        label: 'Framing',
        type: 'select',
        default: 'symmetrically',
        options: ['loosely', 'symmetrically', 'tightly'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:zoom-in': {
    template:
      '{speed} camera zoom in toward the subject, {tightness} tightening framing, {focus} focus',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow gradual', 'smooth', 'brisk', 'rapid snapping'],
      },
      {
        key: 'tightness',
        label: 'Tightness',
        type: 'intensity',
        default: 60,
        levels: {
          0: 'barely',
          25: 'slightly',
          50: 'noticeably',
          75: 'dramatically',
          100: 'extremely tight',
        },
      },
      {
        key: 'focus',
        label: 'Focus',
        type: 'select',
        default: 'maintaining sharp focus',
        options: ['maintaining sharp focus', 'with rack focus', 'soft focus transition'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:zoom-out': {
    template:
      '{speed} camera zoom out from the subject, {expansion} widening frame, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow gradual', 'smooth', 'brisk', 'rapid'],
      },
      {
        key: 'expansion',
        label: 'Expansion',
        type: 'intensity',
        default: 60,
        levels: {
          0: 'barely',
          25: 'slightly',
          50: 'noticeably',
          75: 'dramatically',
          100: 'fully wide revealing',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'smooth optical',
        options: ['smooth optical', 'on tripod', 'handheld'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:pan-left': {
    template: 'camera pans {speed} to the left, {arc} sweep, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'arc',
        label: 'Pan Arc',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely',
          25: 'slight',
          50: 'moderate',
          75: 'wide sweeping',
          100: 'full-frame panoramic',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on fluid head tripod',
        options: ['on fluid head tripod', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:pan-right': {
    template: 'camera pans {speed} to the right, {arc} sweep, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'arc',
        label: 'Pan Arc',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely',
          25: 'slight',
          50: 'moderate',
          75: 'wide sweeping',
          100: 'full-frame panoramic',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on fluid head tripod',
        options: ['on fluid head tripod', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:tilt-up': {
    template: 'camera tilts {speed} upward, {elevation} vertical arc, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'elevation',
        label: 'Elevation',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely',
          25: 'slight',
          50: 'moderate',
          75: 'sweeping upward',
          100: 'full vertical reveal',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on fluid head tripod',
        options: ['on fluid head tripod', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:tilt-down': {
    template: 'camera tilts {speed} downward, {declination} vertical arc, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'declination',
        label: 'Declination',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely',
          25: 'slight',
          50: 'moderate',
          75: 'sweeping downward',
          100: 'full vertical descent',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on fluid head tripod',
        options: ['on fluid head tripod', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:dolly-out': {
    template:
      '{speed} camera dolly out away from the subject, {depth_effect} depth parallax, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow creeping', 'smooth', 'brisk', 'rapid'],
      },
      {
        key: 'depth_effect',
        label: 'Depth Effect',
        type: 'intensity',
        default: 70,
        levels: {
          0: 'minimal',
          25: 'subtle',
          50: 'noticeable',
          75: 'pronounced',
          100: 'dramatic layered',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on dolly track',
        options: ['on dolly track', 'handheld dolly', 'steadicam retreat'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:truck-left': {
    template:
      'camera trucks {speed} laterally to the left, {distance} sideways travel, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'distance',
        label: 'Distance',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely a nudge',
          25: 'short slide',
          50: 'moderate travel',
          75: 'wide lateral sweep',
          100: 'full-frame crossing',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on dolly track',
        options: ['on dolly track', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:truck-right': {
    template:
      'camera trucks {speed} laterally to the right, {distance} sideways travel, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'distance',
        label: 'Distance',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely a nudge',
          25: 'short slide',
          50: 'moderate travel',
          75: 'wide lateral sweep',
          100: 'full-frame crossing',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on dolly track',
        options: ['on dolly track', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:orbit-ccw': {
    template:
      'camera orbits {speed} counter-clockwise around the subject, {arc_width} arc, {elevation}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'arc_width',
        label: 'Arc Width',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'tight narrow',
          25: 'quarter',
          50: 'half',
          75: 'three-quarter',
          100: 'full 360-degree',
        },
      },
      {
        key: 'elevation',
        label: 'Elevation',
        type: 'select',
        default: 'at eye level',
        options: ['from below', 'at eye level', 'from slightly above', 'from high above'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:crane-up': {
    template:
      'camera cranes {speed} upward, {height_gain} vertical rise, {framing} framing throughout',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'height_gain',
        label: 'Height Gain',
        type: 'intensity',
        default: 60,
        levels: {
          0: 'barely rising',
          25: 'low rise',
          50: 'moderate ascent',
          75: 'high rise',
          100: 'soaring vertical',
        },
      },
      {
        key: 'framing',
        label: 'Framing',
        type: 'select',
        default: 'subject-centered',
        options: ['wide environmental', 'subject-centered', 'downward looking'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:crane-down': {
    template:
      'camera cranes {speed} downward, {depth_drop} vertical descent, {framing} framing throughout',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'depth_drop',
        label: 'Depth Drop',
        type: 'intensity',
        default: 60,
        levels: {
          0: 'barely descending',
          25: 'low drop',
          50: 'moderate descent',
          75: 'deep descent',
          100: 'full dramatic drop',
        },
      },
      {
        key: 'framing',
        label: 'Framing',
        type: 'select',
        default: 'subject-centered',
        options: ['wide environmental', 'subject-centered', 'upward looking'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:handheld-shake': {
    template:
      'handheld camera with {shake} organic movement, {rhythm} shakiness pattern, {focus} focus',
    paramDefs: [
      {
        key: 'shake',
        label: 'Shake Amount',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely perceptible',
          25: 'slight tremor',
          50: 'natural handheld',
          75: 'heavy shake',
          100: 'violent jitter',
        },
      },
      {
        key: 'rhythm',
        label: 'Rhythm',
        type: 'select',
        default: 'irregular organic',
        options: ['slow drift', 'irregular organic', 'quick nervous', 'erratic chaotic'],
      },
      {
        key: 'focus',
        label: 'Focus',
        type: 'select',
        default: 'maintained throughout',
        options: ['maintained throughout', 'occasional rack', 'slightly soft'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:steadicam-follow': {
    template:
      'steadicam follows {speed} behind subject, {smoothness} fluid glide, {proximity} following distance',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'at pace', 'urgently'],
      },
      {
        key: 'smoothness',
        label: 'Smoothness',
        type: 'intensity',
        default: 85,
        levels: {
          0: 'rough bouncing',
          25: 'mostly smooth',
          50: 'fluid',
          75: 'gliding',
          100: 'perfectly silky',
        },
      },
      {
        key: 'proximity',
        label: 'Proximity',
        type: 'select',
        default: 'medium distance',
        options: ['close over-shoulder', 'medium distance', 'far tracking'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:subtle-drift': {
    template: 'camera drifts {direction} with {drift} barely perceptible movement, {stabilization}',
    paramDefs: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 'slowly sideways',
        options: ['slowly sideways', 'gently forward', 'slightly rotating', 'softly floating'],
      },
      {
        key: 'drift',
        label: 'Drift Amount',
        type: 'intensity',
        default: 25,
        levels: {
          0: 'imperceptible',
          25: 'barely noticeable',
          50: 'gentle',
          75: 'noticeable',
          100: 'deliberate slow drift',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'smooth electronic',
        options: ['smooth electronic', 'optical', 'minimal correction'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:push-in': {
    template: '{speed} push in toward the subject, {pressure} sense of enclosure, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow deliberate', 'smooth', 'urgent', 'rapid'],
      },
      {
        key: 'pressure',
        label: 'Pressure',
        type: 'intensity',
        default: 65,
        levels: {
          0: 'casual',
          25: 'gentle',
          50: 'purposeful',
          75: 'intense',
          100: 'claustrophobic',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on track',
        options: ['on track', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:pull-out': {
    template: '{speed} pull out away from subject, {reveal} expanding reveal, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow gradual', 'smooth', 'brisk', 'rapid'],
      },
      {
        key: 'reveal',
        label: 'Reveal',
        type: 'intensity',
        default: 65,
        levels: {
          0: 'minimal',
          25: 'slight',
          50: 'moderate',
          75: 'broad',
          100: 'epic wide reveal',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on track',
        options: ['on track', 'handheld', 'steadicam'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:lateral-slide-left': {
    template: 'camera slides {speed} laterally left, {distance} horizontal travel, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'distance',
        label: 'Distance',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'tiny nudge',
          25: 'short slide',
          50: 'moderate travel',
          75: 'long sweep',
          100: 'full-frame lateral',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on track',
        options: ['on track', 'slider', 'handheld'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:lateral-slide-right': {
    template:
      'camera slides {speed} laterally right, {distance} horizontal travel, {stabilization}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly', 'rapidly'],
      },
      {
        key: 'distance',
        label: 'Distance',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'tiny nudge',
          25: 'short slide',
          50: 'moderate travel',
          75: 'long sweep',
          100: 'full-frame lateral',
        },
      },
      {
        key: 'stabilization',
        label: 'Stabilization',
        type: 'select',
        default: 'on track',
        options: ['on track', 'slider', 'handheld'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:arc-left': {
    template: 'camera arcs {speed} leftward around the subject, {arc_angle} arc sweep, {elevation}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'arc_angle',
        label: 'Arc Angle',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely curved',
          25: 'slight arc',
          50: 'quarter arc',
          75: 'half arc',
          100: 'sweeping full arc',
        },
      },
      {
        key: 'elevation',
        label: 'Elevation',
        type: 'select',
        default: 'at eye level',
        options: ['from below', 'at eye level', 'from above'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:arc-right': {
    template:
      'camera arcs {speed} rightward around the subject, {arc_angle} arc sweep, {elevation}',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'arc_angle',
        label: 'Arc Angle',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'barely curved',
          25: 'slight arc',
          50: 'quarter arc',
          75: 'half arc',
          100: 'sweeping full arc',
        },
      },
      {
        key: 'elevation',
        label: 'Elevation',
        type: 'select',
        default: 'at eye level',
        options: ['from below', 'at eye level', 'from above'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:whip-pan': {
    template:
      '{speed} whip pan {direction}, {motion_blur} motion blur streak, {landing} landing frame',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'fast',
        options: ['fast', 'very fast', 'blistering'],
      },
      {
        key: 'motion_blur',
        label: 'Motion Blur',
        type: 'intensity',
        default: 80,
        levels: {
          0: 'minimal',
          25: 'slight streaking',
          50: 'moderate blur',
          75: 'heavy smear',
          100: 'full trailing streak',
        },
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 'horizontally',
        options: ['horizontally', 'diagonally upward', 'diagonally downward'],
      },
      {
        key: 'landing',
        label: 'Landing Frame',
        type: 'select',
        default: 'sharp cut-in',
        options: ['sharp cut-in', 'smooth settle', 'brief overshoot'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:snap-zoom': {
    template: '{speed} snap zoom {direction}, {punch} visual punch, {focus} focus on landing',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'rapid',
        options: ['fast', 'rapid', 'instantaneous'],
      },
      {
        key: 'punch',
        label: 'Punch',
        type: 'intensity',
        default: 80,
        levels: {
          0: 'subtle',
          25: 'noticeable',
          50: 'impactful',
          75: 'jarring',
          100: 'extreme shock zoom',
        },
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 'in toward subject',
        options: ['in toward subject', 'out from subject'],
      },
      {
        key: 'focus',
        label: 'Focus',
        type: 'select',
        default: 'sharp snap focus',
        options: ['sharp snap focus', 'rack focus', 'held sharp'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:parallax-reveal': {
    template:
      'parallax reveal with {speed} lateral movement, {depth_layers} depth layering, {subject_reveal} subject emergence',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'slow',
        options: ['very slow', 'slow', 'moderate'],
      },
      {
        key: 'depth_layers',
        label: 'Depth Layers',
        type: 'intensity',
        default: 70,
        levels: {
          0: 'flat single plane',
          25: 'two-layer',
          50: 'three-layer',
          75: 'deep multi-layer',
          100: 'cinematic full parallax',
        },
      },
      {
        key: 'subject_reveal',
        label: 'Subject Reveal',
        type: 'select',
        default: 'gradual emergence',
        options: ['sudden reveal', 'gradual emergence', 'slow atmospheric unveiling'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:rack-focus': {
    template:
      '{speed} rack focus {direction}, {transition} focus transition, {planes} focal planes',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow', 'smooth', 'quick snap'],
      },
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 'from foreground to background',
        options: [
          'from foreground to background',
          'from background to foreground',
          'between subjects',
        ],
      },
      {
        key: 'transition',
        label: 'Transition',
        type: 'intensity',
        default: 60,
        levels: {
          0: 'instant cut',
          25: 'brief',
          50: 'smooth',
          75: 'lingering',
          100: 'very slow drift',
        },
      },
      {
        key: 'planes',
        label: 'Focal Planes',
        type: 'select',
        default: 'distinct separation',
        options: ['close separation', 'distinct separation', 'wide separation'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:handheld-run': {
    template:
      'running handheld camera with {bounce} vertical bounce, {urgency} sense of urgency, {focus} focus stability',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'at running pace',
        options: ['jogging pace', 'at running pace', 'sprinting pace'],
      },
      {
        key: 'bounce',
        label: 'Bounce',
        type: 'intensity',
        default: 65,
        levels: {
          0: 'minimal',
          25: 'slight bob',
          50: 'natural running bounce',
          75: 'heavy jarring',
          100: 'chaotic frantic',
        },
      },
      {
        key: 'urgency',
        label: 'Urgency',
        type: 'intensity',
        default: 70,
        levels: {
          0: 'casual',
          25: 'purposeful',
          50: 'urgent',
          75: 'frantic',
          100: 'desperate chase',
        },
      },
      {
        key: 'focus',
        label: 'Focus',
        type: 'select',
        default: 'mostly maintained',
        options: ['razor sharp', 'mostly maintained', 'occasionally lost'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:fpv-glide': {
    template:
      'FPV drone {speed} glide through environment, {banking} banking turns, {altitude} flight altitude',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smooth',
        options: ['slow drifting', 'smooth', 'brisk', 'racing fast'],
      },
      {
        key: 'banking',
        label: 'Banking',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'level no bank',
          25: 'subtle lean',
          50: 'moderate banking',
          75: 'aggressive lean',
          100: 'extreme racing bank',
        },
      },
      {
        key: 'altitude',
        label: 'Altitude',
        type: 'select',
        default: 'low skimming',
        options: ['ground-level skimming', 'low skimming', 'mid-air', 'high sweeping'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:spiral-rise': {
    template:
      'camera spirals {speed} upward and outward, {spiral_tightness} spiral path, {height} final height',
    paramDefs: [
      {
        key: 'speed',
        label: 'Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'briskly'],
      },
      {
        key: 'spiral_tightness',
        label: 'Spiral Tightness',
        type: 'intensity',
        default: 50,
        levels: {
          0: 'very wide lazy spiral',
          25: 'loose spiral',
          50: 'moderate spiral',
          75: 'tight corkscrew',
          100: 'extremely tight rise',
        },
      },
      {
        key: 'height',
        label: 'Height',
        type: 'select',
        default: 'mid-height reveal',
        options: ['low sweep', 'mid-height reveal', 'soaring high overhead'],
      },
    ],
    conflictGroup: 'camera:primary',
  },
  'camera:bullet-time': {
    template:
      'bullet-time effect, camera revolves {speed} around frozen or slow-motion subject, {revolution} arc covered, {subject_motion} subject motion',
    paramDefs: [
      {
        key: 'speed',
        label: 'Camera Speed',
        type: 'select',
        default: 'smoothly',
        options: ['slowly', 'smoothly', 'rapidly'],
      },
      {
        key: 'revolution',
        label: 'Revolution',
        type: 'intensity',
        default: 75,
        levels: {
          0: 'slight rotation',
          25: 'quarter turn',
          50: 'half turn',
          75: 'three-quarter sweep',
          100: 'full 360-degree revolution',
        },
      },
      {
        key: 'subject_motion',
        label: 'Subject Motion',
        type: 'select',
        default: 'nearly frozen slow motion',
        options: ['completely frozen', 'nearly frozen slow motion', 'ultra-slow motion'],
      },
    ],
    conflictGroup: 'camera:primary',
  },

  // ── scene (lighting) samples ──
  'scene:high-key': {
    template:
      '{fill_strength} even fill lighting, {shadow_depth} shadows, {color_temp} white balance, {contrast} contrast ratio',
    paramDefs: [
      {
        key: 'fill_strength',
        label: 'Fill Strength',
        type: 'intensity',
        default: 80,
        levels: {
          0: 'minimal',
          25: 'moderate',
          50: 'strong',
          75: 'bright',
          100: 'blazing overexposed',
        },
      },
      {
        key: 'shadow_depth',
        label: 'Shadow Depth',
        type: 'intensity',
        default: 20,
        levels: { 0: 'no', 25: 'barely visible', 50: 'soft', 75: 'noticeable', 100: 'defined' },
      },
      {
        key: 'color_temp',
        label: 'Color Temperature',
        type: 'select',
        default: 'neutral',
        options: ['cool daylight', 'neutral', 'warm tungsten'],
      },
      {
        key: 'contrast',
        label: 'Contrast',
        type: 'intensity',
        default: 25,
        levels: { 0: 'flat zero', 25: 'low', 50: 'moderate', 75: 'punchy', 100: 'extreme high' },
      },
    ],
    conflictGroup: 'scene:key-lighting',
  },
  'scene:low-key': {
    template:
      '{key_direction} dramatic key light, {shadow_depth} deep shadows, {fill_ratio} fill ratio, {mood} atmosphere',
    paramDefs: [
      {
        key: 'key_direction',
        label: 'Key Direction',
        type: 'select',
        default: 'side-angled',
        options: ['frontal', 'side-angled', 'overhead', 'low-raking'],
      },
      {
        key: 'shadow_depth',
        label: 'Shadow Depth',
        type: 'intensity',
        default: 85,
        levels: {
          0: 'light',
          25: 'moderate',
          50: 'heavy',
          75: 'crushing',
          100: 'near-total darkness',
        },
      },
      {
        key: 'fill_ratio',
        label: 'Fill Ratio',
        type: 'intensity',
        default: 20,
        levels: {
          0: 'no fill',
          25: 'faint bounce',
          50: 'subtle ambient',
          75: 'moderate fill',
          100: 'balanced fill',
        },
      },
      {
        key: 'mood',
        label: 'Mood',
        type: 'select',
        default: 'dramatic',
        options: ['mysterious', 'dramatic', 'sinister', 'contemplative'],
      },
    ],
    conflictGroup: 'scene:key-lighting',
  },
  'scene:rim-light': {
    template:
      'rim lighting from {direction}, {rim_width} luminous edge, {shadow_depth} shadows, {color_temp} color temperature',
    paramDefs: [
      {
        key: 'direction',
        label: 'Direction',
        type: 'select',
        default: 'behind',
        options: ['behind', 'behind-left', 'behind-right', 'above'],
      },
      {
        key: 'rim_width',
        label: 'Rim Width',
        type: 'intensity',
        default: 60,
        levels: { 0: 'hair-thin', 25: 'narrow', 50: 'medium', 75: 'wide', 100: 'broad dramatic' },
      },
      {
        key: 'shadow_depth',
        label: 'Shadow Depth',
        type: 'intensity',
        default: 50,
        levels: { 0: 'no', 25: 'soft', 50: 'moderate', 75: 'deep', 100: 'crushing' },
      },
      {
        key: 'color_temp',
        label: 'Color Temperature',
        type: 'select',
        default: 'warm',
        options: ['cool blue', 'neutral', 'warm', 'golden'],
      },
    ],
  },

  // ── look samples ──
};
