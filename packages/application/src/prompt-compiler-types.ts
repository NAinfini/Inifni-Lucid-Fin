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
  CanvasVisualStylePolicy,
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

export interface PromptExpanderContext {
  prompt: string;
  providerId: string;
  mode: PromptMode;
}

export interface PromptReferenceBinding {
  entityType: 'character' | 'equipment' | 'location';
  entityId: string;
  imageHash: string;
}

export type PromptExpander = (ctx: PromptExpanderContext) => Promise<string>;

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
  /** Host-resolved identity roles aligned to referenceImages. */
  referenceBindings?: PromptReferenceBinding[];
  /** Provider ID */
  providerId: string;
  mode: PromptMode;
  /** Full preset library so we can resolve preset IDs to prompt text */
  presetLibrary: PresetDefinition[];
  /** Style guide defaults: act as cascading defaults, node presets override */
  styleGuide?: StyleGuideDefaults;
  /** Canonical Canvas draft style. Approved workflow styles are compiled by the workflow host. */
  visualStylePolicy?: CanvasVisualStylePolicy;
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
  /** Optional LLM expander for prompt enrichment */
  expandWithLLM?: PromptExpander;
}

export interface PromptDiagnostic {
  type: 'conflict' | 'duplicate' | 'info';
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
  /** LLM-enhanced version of the prompt (populated when expandWithLLM is provided) */
  enhancedPrompt?: string;
}

export interface PromptCompilationMetrics {
  providerId: string;
  mode: PromptMode;
  promptHash: string;
  wordCount: number;
  segmentSources: string[];
  referenceImageCount: number;
  diagnosticCounts: Record<string, number>;
  hadSynergyBonus: boolean;
  hadEnhancedPrompt: boolean;
  trimmedSegmentCount: number;
  timestamp: number;
}
