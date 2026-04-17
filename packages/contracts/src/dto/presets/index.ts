/**
 * Barrel for dto/presets/* split.
 *
 * Explicit re-exports (not `export *`) so the package's `"sideEffects": false`
 * claim remains valid and tree-shakers can drop unused large tables.
 */

// ── core types ─────────────────────────────────────────────────
export { PRESET_CATEGORIES, createEmptyPresetTrackSet } from './core.js';
export type {
  PresetCategory,
  CameraDirection,
  PresetParamType,
  PresetParamValue,
  PresetParamMap,
  PresetParamDefinition,
  SphericalPosition,
  PromptParamIntensityLevels,
  PresetPromptParamDef,
  PresetDefinition,
  PresetBlendEntry,
  PresetTrackEntry,
  PresetTrack,
  PresetTrackSet,
  PresetLibraryImportPayload,
  PresetLibraryExportRequest,
  PresetLibraryExportPayload,
  PresetResetScope,
  PresetResetRequest,
} from './core.js';

// ── built-in library (assembles prompts + templates) ───────────
export { BUILT_IN_PRESET_LIBRARY } from './library.js';

// ── shot templates ─────────────────────────────────────────────
export { BUILT_IN_SHOT_TEMPLATES } from './shot-templates.js';
export type { ShotTemplate } from './shot-templates.js';
