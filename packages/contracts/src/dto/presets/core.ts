/**
 * Pure preset types, enums, and lightweight factory helpers.
 * No runtime data tables — see params.ts / prompts.ts / templates*.ts / library.ts.
 */
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
