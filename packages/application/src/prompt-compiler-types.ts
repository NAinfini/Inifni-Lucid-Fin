import type {
  PresetCategory,
  PresetTrackSet,
  PresetDefinition,
  CharacterRef,
  EquipmentRef,
  LocationRef,
  Character,
  Equipment,
  EquipmentLoadout,
  Location,
} from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PromptMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'image-to-video'
  | 'text-to-video'
  | 'character-sheet'
  | 'voice'
  | 'music'
  | 'sfx';

export interface StyleGuideDefaults {
  artStyle?: string; // e.g. 'cinematic-realism', maps to look preset
  lighting?: string; // e.g. 'dramatic', maps to scene preset
  colorPalette?: string; // e.g. 'teal-orange', maps to look preset
  defaultPresets?: Partial<
    Record<
      PresetCategory,
      {
        presetId: string;
        intensity?: number;
        params?: Record<string, unknown>;
      }
    >
  >;
}

export type CameraShot = 'close-up' | 'medium' | 'wide' | 'default';

export interface ResolvedCharacter {
  character: Character;
  loadout?: EquipmentLoadout;
  equipment?: Equipment[];
  emotion?: string;
  costume?: string;
}

export interface PromptCompilerInput {
  nodeType: 'image' | 'video' | 'audio';
  /** User-written scene text / prompt */
  prompt?: string;
  /** User-written exclusions / failure modes to avoid */
  negativePrompt?: string;
  presetTracks?: PresetTrackSet;
  characterRefs?: CharacterRef[];
  equipmentRefs?: EquipmentRef[];
  locationRefs?: LocationRef[];
  /** Resolved character entities with loadout + equipment */
  characters?: ResolvedCharacter[];
  /** Standalone equipment not tied to any character */
  equipmentItems?: Equipment[];
  /** Resolved location entities */
  locations?: Location[];
  /** Text content from connected TextNode edges */
  connectedTextContent?: string[];
  /** Optional pre-resolved reference image hashes */
  referenceImages?: string[];
  /** Provider ID for model-specific word budgets */
  providerId: string;
  mode: PromptMode;
  /** Full preset library so we can resolve preset IDs to prompt text */
  presetLibrary: PresetDefinition[];
  /** Style guide defaults: act as cascading defaults, node presets override */
  styleGuide?: StyleGuideDefaults;
  /** For voice mode: dialogue text to synthesize */
  dialogueText?: string;
  /** For voice mode: emotion label */
  emotion?: string;
  /** For music mode: genre, tempo, key, instrumentation */
  musicConfig?: {
    genre?: string;
    tempo?: string; // 'slow', 'moderate', 'fast', '120bpm'
    key?: string; // 'C minor', 'A major'
    instrumentation?: string[]; // ['piano', 'strings', 'drums']
    timeSignature?: string; // '4/4', '3/4'
  };
  /** For sfx mode: spatial placement */
  sfxPlacement?: 'close' | 'mid' | 'far';
  /** Duration hint for audio generation */
  durationSeconds?: number;
}

export interface PromptDiagnostic {
  type: 'conflict' | 'duplicate' | 'budget_warning' | 'trimmed' | 'info';
  severity: 'warning' | 'info';
  message: string;
  source?: string;
}

export interface PromptSegment {
  source: string; // 'user-text', 'character:id', 'location:id', 'preset:id', 'connected-text', 'equipment', 'ref-anchor'
  text: string;
  trimmed: boolean;
}

export interface CompiledPrompt {
  prompt: string;
  negativePrompt?: string;
  referenceImages?: string[];
  params?: Record<string, unknown>;
  diagnostics: PromptDiagnostic[];
  segments: PromptSegment[];
  wordCount: number;
  budget: number;
}
