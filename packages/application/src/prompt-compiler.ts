import type {
  PresetTrackSet,
  PresetTrack,
  PresetCategory,
  PresetDefinition,
  PresetTrackEntry,
  CameraDirection,
  CharacterRef,
  EquipmentRef,
  LocationRef,
  Character,
  Equipment,
  EquipmentLoadout,
  Location,
  PresetPromptParamDef,
  PromptParamIntensityLevels,
  PresetParamMap,
} from '@lucid-fin/contracts';
import { createEmptyPresetTrackSet } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PromptMode = 'text-to-image' | 'image-to-image' | 'image-to-video' | 'text-to-video' | 'character-sheet' | 'voice' | 'music' | 'sfx';

export interface StyleGuideDefaults {
  artStyle?: string;          // e.g. 'cinematic-realism', maps to look preset
  lighting?: string;          // e.g. 'dramatic', maps to scene preset
  colorPalette?: string;      // e.g. 'teal-orange', maps to look preset
  defaultPresets?: Partial<Record<PresetCategory, {
    presetId: string;
    intensity?: number;
    params?: Record<string, unknown>;
  }>>;
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
  equipmentRefs?: Array<EquipmentRef | string>;
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
    tempo?: string;       // 'slow', 'moderate', 'fast', '120bpm'
    key?: string;         // 'C minor', 'A major'
    instrumentation?: string[];  // ['piano', 'strings', 'drums']
    timeSignature?: string;       // '4/4', '3/4'
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
  source: string;  // 'user-text', 'character:id', 'location:id', 'preset:id', 'connected-text', 'equipment', 'ref-anchor'
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

// ---------------------------------------------------------------------------
// Model-specific word budgets (from docs/ai-video-prompt-guide/07)
// ---------------------------------------------------------------------------

interface WordBudget {
  positive: number;
  negative: number;
}

const MODEL_BUDGETS: Record<string, WordBudget> = {
  kling: { positive: 300, negative: 50 },
  runway: { positive: 150, negative: 40 },
  luma: { positive: 250, negative: 40 },
  ray: { positive: 250, negative: 40 },
  wan: { positive: 250, negative: 50 },
  minimax: { positive: 250, negative: 40 },
  hailuo: { positive: 250, negative: 40 },
  pika: { positive: 150, negative: 50 },
  seedance: { positive: 200, negative: 40 },
  hunyuan: { positive: 300, negative: 60 },
  cogvideo: { positive: 300, negative: 60 },
  sora: { positive: 250, negative: 40 },
  veo: { positive: 250, negative: 40 },
  default: { positive: 300, negative: 60 },
};

function getBudget(providerId: string): WordBudget {
  const key = providerId.toLowerCase();
  for (const [prefix, budget] of Object.entries(MODEL_BUDGETS)) {
    if (prefix !== 'default' && key.includes(prefix)) return budget;
  }
  return MODEL_BUDGETS.default;
}

// ---------------------------------------------------------------------------
// Preset stacking order
// ---------------------------------------------------------------------------

const PRESET_STACK_ORDER: PresetCategory[] = [
  'camera',
  'lens',
  'scene',
  'look',
  'composition',
  'emotion',
  'flow',
  'technical',
];

const CONFLICT_GROUPS: Record<string, string[]> = {
  'scene:key-lighting': ['scene:high-key', 'scene:low-key', 'scene:chiaroscuro'],
  'lens:focal-length': ['lens:ultra-wide-14mm', 'lens:wide-24mm', 'lens:telephoto-135mm', 'lens:long-telephoto-200mm', 'lens:macro'],
  'camera:primary': ['camera:static-hold', 'camera:dolly-in', 'camera:dolly-out', 'camera:orbit-cw', 'camera:orbit-ccw', 'camera:pan-left', 'camera:pan-right'],
  'look:base-style': ['look:cinematic-realism', 'look:anime-cel', 'look:comic-book', 'look:watercolor-ink', 'look:oil-paint', 'look:pixel-art'],
};

const I2V_ALLOWED_CATEGORIES: ReadonlySet<PresetCategory> = new Set<PresetCategory>([
  'camera',
  'flow',
]);

const I2V_CAMERA_KEYWORDS = [
  'camera',
  'shot',
  'pan',
  'tilt',
  'zoom',
  'dolly',
  'truck',
  'orbit',
  'track',
  'follow',
  'crane',
  'handheld',
  'push-in',
  'pull-out',
  'whip',
  'boom',
  'arc',
  'steadicam',
  'slow-motion',
];

const I2V_ACTION_KEYWORDS = [
  'move',
  'motion',
  'walk',
  'run',
  'turn',
  'walks',
  'runs',
  'turns',
  'look',
  'looks',
  'gesture',
  'step',
  'steps',
  'reach',
  'reaches',
  'spin',
  'spins',
  'drift',
  'drifts',
  'transition',
  // Force-reaction / physics verbs (Runway Gen-4.5, Kling 3.0)
  'impact',
  'crumple',
  'shatter',
  'recoil',
  'collapse',
  'scatter',
  'ripple',
  'sway',
  'sways',
  'tremble',
  'trembles',
  'settle',
  'settles',
  'flutter',
  'flutters',
  'surge',
  'surges',
  'pour',
  'pours',
  'splash',
  'fall',
  'falls',
  'rise',
  'rises',
  'slide',
  'slides',
  'swing',
  'swings',
  'accelerat',
  'decelerat',
  // Endpoint/resolution descriptors
  'gradually',
  'slowly',
  'briskly',
  'then settles',
  'comes to rest',
];

const I2V_APPEARANCE_KEYWORDS = [
  'dress',
  'coat',
  'jacket',
  'shirt',
  'skirt',
  'hair',
  'eyes',
  'jewelry',
  'face',
  'skin',
  'silk',
  'red',
  'blue',
  'gold',
];

// ---------------------------------------------------------------------------
// Intensity helpers
// ---------------------------------------------------------------------------

function intensityWord(pct: number): string {
  if (pct <= 25) return 'subtle';
  if (pct <= 50) return 'gentle';
  if (pct <= 75) return 'pronounced';
  return 'dramatic intense';
}

const DIRECTION_PHRASES: Record<CameraDirection, string> = {
  front: 'from the front',
  back: 'from behind',
  left: 'from the left',
  right: 'from the right',
  above: 'from above',
  below: 'from below',
  'over-shoulder-left': 'over left shoulder',
  'over-shoulder-right': 'over right shoulder',
  'dutch-angle': 'at a dutch angle',
  pov: 'point of view',
  'tracking-behind': 'tracking from behind',
  'worms-eye': 'from worm\'s eye view',
  'high-angle': 'from a high angle',
  profile: 'from profile angle',
};

function computeEffectiveIntensity(trackIntensity: number | undefined, entryIntensity: number | undefined): number {
  const t = trackIntensity ?? 100;
  const e = entryIntensity ?? 100;
  return Math.round(t * e / 100);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPresetMap(library: PresetDefinition[]): Record<string, PresetDefinition> {
  const map: Record<string, PresetDefinition> = {};
  for (const p of library) {
    map[p.id] = p;
  }
  return map;
}

function trimToWordBudget(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

/**
 * For blend entries, interpolate two prompt fragments by factor.
 * factor 0 = 100% A, factor 100 = 100% B.
 */
function blendPromptFragments(
  promptA: string,
  promptB: string,
  factor: number,
): string {
  const normalizedFactor = factor > 0 && factor <= 1 ? factor * 100 : factor;
  if (normalizedFactor <= 0) return promptA;
  if (normalizedFactor >= 100) return promptB;

  const weightA = Math.round(100 - normalizedFactor);
  const weightB = Math.round(normalizedFactor);

  if (!promptA && !promptB) return '';
  if (!promptA) return promptB;
  if (!promptB) return promptA;

  return `(${weightA}% ${promptA}), (${weightB}% ${promptB})`;
}

function readPromptFragment(preset: PresetDefinition | undefined): string {
  if (!preset) return '';
  const maybePromptFragment = (preset as unknown as { promptFragment?: unknown }).promptFragment;
  if (typeof maybePromptFragment === 'string' && maybePromptFragment.trim()) {
    return maybePromptFragment.trim();
  }
  return preset.prompt?.trim() ?? '';
}

export function resolveIntensityLevel(levels: PromptParamIntensityLevels, value: number): string {
  const thresholds = [100, 75, 50, 25, 0] as const;
  for (const t of thresholds) {
    if (value >= t && levels[t]) return levels[t]!;
  }
  return '';
}

export function resolvePromptTemplate(
  template: string,
  paramDefs: PresetPromptParamDef[],
  paramValues: Record<string, unknown>,
): string {
  let result = template;
  for (const def of paramDefs) {
    const value = paramValues[def.key] ?? def.default;
    let phrase: string;
    if (def.type === 'intensity' && def.levels) {
      const numVal = typeof value === 'number' ? value : Number(value) || 0;
      phrase = resolveIntensityLevel(def.levels, numVal);
    } else {
      phrase = String(value);
    }
    result = result.replace(new RegExp(`\\{${def.key}\\}`, 'g'), phrase);
  }
  return result;
}

function resolveEntryPrompt(
  entry: PresetTrackEntry,
  presetMap: Record<string, PresetDefinition>,
): string {
  const presetA = presetMap[entry.presetId];

  // v2: try promptTemplate + promptParamDefs first
  if (presetA?.promptTemplate && presetA.promptParamDefs?.length) {
    const paramValues = { ...presetA.defaults, ...entry.params } as Record<string, unknown>;
    const promptA = resolvePromptTemplate(presetA.promptTemplate, presetA.promptParamDefs, paramValues);

    if (entry.blend) {
      const presetB = presetMap[entry.blend.presetIdB];
      const promptB = presetB?.promptTemplate && presetB.promptParamDefs?.length
        ? resolvePromptTemplate(presetB.promptTemplate, presetB.promptParamDefs, { ...presetB.defaults, ...entry.blend.paramsB } as Record<string, unknown>)
        : readPromptFragment(presetB);
      return blendPromptFragments(promptA, promptB, entry.blend.factor);
    }

    return promptA;
  }

  // v1 fallback: use prompt/promptFragment
  const promptA = readPromptFragment(presetA);
  if (entry.blend) {
    const presetB = presetMap[entry.blend.presetIdB];
    const promptB = readPromptFragment(presetB);
    return blendPromptFragments(promptA, promptB, entry.blend.factor);
  }
  return promptA;
}

function readPresetNegativePrompt(preset: PresetDefinition | undefined): string | undefined {
  if (!preset) return undefined;
  const explicitNegative = (preset as unknown as { negativePrompt?: unknown }).negativePrompt;
  if (typeof explicitNegative === 'string' && explicitNegative.trim()) {
    return explicitNegative.trim();
  }
  const fromDefaultParams = preset.defaultParams?.negativePrompt;
  if (typeof fromDefaultParams === 'string' && fromDefaultParams.trim()) {
    return fromDefaultParams.trim();
  }
  return undefined;
}

function normalizeTextSegment(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Roughly detect whether a prompt is predominantly English / ASCII. The
 * image-to-video stripper below uses English keyword lists to separate
 * motion clauses from static appearance clauses; that heuristic makes no
 * sense for CJK or RTL prompts where the keyword list matches nothing and
 * the stripper would silently return an empty string, leaving the provider
 * with no prompt at all.
 *
 * Threshold is deliberately low (50%): a mostly-Chinese prompt with a few
 * English proper nouns ("Elf Girl") still falls into the "not English"
 * branch, and mixed content slips into the safe no-op path by default.
 */
function isPredominantlyAscii(value: string): boolean {
  if (!value) return true;
  let ascii = 0;
  let total = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      if (code !== 0x20) ascii += 1;
    } else {
      // CJK, arabic, cyrillic — any non-ASCII character disqualifies.
      total += 1;
    }
    total += code <= 0x20 ? 0 : 1;
  }
  if (total === 0) return true;
  return ascii / total >= 0.5;
}

function stripForImageToVideo(value: string): string {
  const normalized = normalizeTextSegment(value);
  if (!normalized) return '';
  // English-only keyword match — for non-English prompts, run a minimal
  // pass that keeps motion-like clauses by structural cues only (punctuation)
  // and returns the normalized prompt otherwise. Better to pass an
  // unfiltered motion-rich prompt to the provider than a silently empty
  // one produced by a regex that doesn't understand the language.
  if (!isPredominantlyAscii(normalized)) {
    return normalized;
  }
  const clauses = normalized
    .split(/(?:,|;|[.!?。！？])|\bthen\b/gi)
    .map((item) => item.trim())
    .filter(Boolean);
  const motionOnly = clauses.filter((clause) => {
    const lower = clause.toLowerCase();
    const hasCamera = I2V_CAMERA_KEYWORDS.some((keyword) => lower.includes(keyword));
    const hasAction = I2V_ACTION_KEYWORDS.some((keyword) => lower.includes(keyword));
    const hasAppearance = I2V_APPEARANCE_KEYWORDS.some((keyword) => lower.includes(keyword));
    const isStaticOnly =
      !hasCamera &&
      /\bstands?\b|\bsits?\b|\bis\b/.test(lower) &&
      !/\bwalks?\b|\bturns?\b|\bmoves?\b|\blooks?\b/.test(lower);
    if (!hasCamera && !hasAction) {
      return false;
    }
    return !(hasAppearance && isStaticOnly);
  });
  // If the keyword pass filtered everything out for English content, fall
  // back to the normalized prompt — dropping all content is worse than
  // forwarding a mixed-appearance prompt.
  return motionOnly.length > 0 ? motionOnly.join('. ') : normalized;
}

function mergeParams(target: Record<string, unknown>, input?: Record<string, unknown>): void {
  if (!input) return;
  for (const [key, value] of Object.entries(input)) {
    target[key] = value;
  }
}

function getEntryParams(entry: PresetTrackEntry): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  mergeParams(params, entry.params as Record<string, unknown>);
  if (entry.blend?.paramsB) {
    mergeParams(params, entry.blend.paramsB as Record<string, unknown>);
  }
  return params;
}

function collectReferenceImages(input: PromptCompilerInput): string[] {
  const hashes = new Set<string>();

  for (const hash of input.referenceImages ?? []) {
    if (typeof hash === 'string' && hash.trim()) {
      hashes.add(hash.trim());
    }
  }

  for (const ref of input.characterRefs ?? []) {
    const withHashes = ref as CharacterRef & {
      referenceImages?: string[];
      referenceImageHash?: string;
      imageHash?: string;
    };
    if (Array.isArray(withHashes.referenceImages)) {
      for (const hash of withHashes.referenceImages) {
        if (typeof hash === 'string' && hash.trim()) hashes.add(hash.trim());
      }
    }
    if (typeof withHashes.referenceImageHash === 'string' && withHashes.referenceImageHash.trim()) {
      hashes.add(withHashes.referenceImageHash.trim());
    }
    if (typeof withHashes.imageHash === 'string' && withHashes.imageHash.trim()) {
      hashes.add(withHashes.imageHash.trim());
    }
  }

  for (const ref of input.locationRefs ?? []) {
    if (typeof ref.referenceImageHash === 'string' && ref.referenceImageHash.trim()) {
      hashes.add(ref.referenceImageHash.trim());
    }
  }

  // Collect reference images from resolved character entities
  for (const resolved of input.characters ?? []) {
    for (const img of resolved.character.referenceImages ?? []) {
      if (typeof img.assetHash === 'string' && img.assetHash.trim()) {
        hashes.add(img.assetHash.trim());
      }
    }
  }

  // Collect reference images from resolved location entities
  for (const location of input.locations ?? []) {
    for (const img of (location as { referenceImages?: Array<{ assetHash: string }> }).referenceImages ?? []) {
      if (typeof img.assetHash === 'string' && img.assetHash.trim()) {
        hashes.add(img.assetHash.trim());
      }
    }
  }

  // Collect reference images from standalone equipment entities
  for (const item of input.equipmentItems ?? []) {
    for (const img of (item as { referenceImages?: Array<{ assetHash: string }> }).referenceImages ?? []) {
      if (typeof img.assetHash === 'string' && img.assetHash.trim()) {
        hashes.add(img.assetHash.trim());
      }
    }
  }

  return Array.from(hashes);
}

function pushVisualPart(target: string[], value: string | undefined): void {
  const normalized = normalizeTextSegment(value ?? '');
  if (normalized) {
    target.push(normalized);
  }
}

function describeCharacterIdentity(
  resolved: ResolvedCharacter,
  mode: PromptMode,
): string {
  const { character } = resolved;
  const fragments: string[] = [];

  pushVisualPart(fragments, character.description);
  pushVisualPart(fragments, character.appearance);

  if (character.face) {
    const faceParts: string[] = [];
    if (character.face.eyeShape && character.face.eyeColor) faceParts.push(`${character.face.eyeShape} ${character.face.eyeColor} eyes`);
    else {
      pushVisualPart(faceParts, character.face.eyeColor);
      pushVisualPart(faceParts, character.face.eyeShape);
    }
    pushVisualPart(faceParts, character.face.noseType ? `${character.face.noseType} nose` : undefined);
    pushVisualPart(faceParts, character.face.lipShape ? `${character.face.lipShape} lips` : undefined);
    pushVisualPart(faceParts, character.face.jawline ? `${character.face.jawline} jawline` : undefined);
    pushVisualPart(faceParts, character.face.definingFeatures);
    if (faceParts.length > 0) fragments.push(faceParts.join(', '));
  }

  if (character.hair) {
    const hairParts = [
      character.hair.color,
      character.hair.style,
      character.hair.length,
      character.hair.texture,
    ].map((part) => normalizeTextSegment(part ?? '')).filter(Boolean);
    if (hairParts.length > 0) fragments.push(`${hairParts.join(', ')} hair`);
  }

  pushVisualPart(fragments, character.skinTone ? `${character.skinTone} skin tone` : undefined);

  if (character.body) {
    const bodyParts = [
      character.body.height,
      character.body.build,
      character.body.proportions,
    ].map((part) => normalizeTextSegment(part ?? '')).filter(Boolean);
    if (bodyParts.length > 0) fragments.push(bodyParts.join(', '));
  }

  for (const trait of character.distinctTraits ?? []) {
    pushVisualPart(fragments, trait);
  }

  if (resolved.costume) {
    const costume = character.costumes.find((item) => item.id === resolved.costume || item.name === resolved.costume);
    pushVisualPart(fragments, costume?.description ?? resolved.costume);
  }

  for (const item of resolved.equipment ?? []) {
    const equipmentParts: string[] = [];
    pushVisualPart(equipmentParts, item.name);
    pushVisualPart(equipmentParts, item.description);
    pushVisualPart(equipmentParts, item.material);
    pushVisualPart(equipmentParts, item.color);
    pushVisualPart(equipmentParts, item.condition);
    pushVisualPart(equipmentParts, item.visualDetails);
    if (equipmentParts.length > 0) fragments.push(equipmentParts.join(', '));
  }

  if (resolved.emotion) {
    fragments.push(
      mode === 'image-to-video'
        ? `same expression continuity: ${resolved.emotion}`
        : `expression reads ${resolved.emotion}`,
    );
  }

  if (fragments.length === 0) {
    return '';
  }

  const prefix = character.name ? `${character.name}: ` : 'Character: ';
  return `${prefix}${fragments.join('; ')}`;
}

function describeLocationIdentity(location: Location, mode: PromptMode): string {
  const fragments: string[] = [];

  pushVisualPart(fragments, location.name);
  pushVisualPart(fragments, location.subLocation);
  pushVisualPart(fragments, location.description);
  pushVisualPart(fragments, location.timeOfDay ? `${location.timeOfDay}` : undefined);
  pushVisualPart(fragments, location.weather);
  pushVisualPart(fragments, location.lighting);
  pushVisualPart(fragments, location.architectureStyle);
  pushVisualPart(fragments, location.mood ? `${location.mood} mood` : undefined);

  if (location.dominantColors?.length) {
    fragments.push(`${location.dominantColors.join(', ')} palette`);
  }
  if (location.keyFeatures?.length) {
    fragments.push(location.keyFeatures.join(', '));
  }
  if (location.atmosphereKeywords?.length) {
    fragments.push(location.atmosphereKeywords.join(', '));
  }

  if (fragments.length === 0) {
    return '';
  }

  const prefix = mode === 'image-to-video' ? 'same location continuity' : 'Location';
  return `${prefix}: ${fragments.join('; ')}`;
}

function describeStandaloneEquipment(item: Equipment): string {
  const fragments: string[] = [];
  pushVisualPart(fragments, item.name);
  pushVisualPart(fragments, item.description);
  pushVisualPart(fragments, item.material);
  pushVisualPart(fragments, item.color);
  pushVisualPart(fragments, item.condition);
  pushVisualPart(fragments, item.visualDetails);
  return fragments.length > 0 ? `Visible equipment: ${fragments.join('; ')}` : '';
}

function applyIntensityAndDirection(
  fragment: string,
  effectiveIntensity: number,
  direction: CameraDirection | undefined,
): string {
  if (!fragment) return '';
  const word = intensityWord(effectiveIntensity);
  const dirPhrase = direction ? ` ${DIRECTION_PHRASES[direction]}` : '';
  return `${word} ${fragment}${dirPhrase} (${effectiveIntensity}%)`;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function detectConflicts(
  presetTracks: PresetTrackSet | undefined,
  presetMap: Record<string, PresetDefinition>,
): PromptDiagnostic[] {
  if (!presetTracks) return [];
  const diagnostics: PromptDiagnostic[] = [];

  // Check built-in conflict groups
  for (const [groupName, memberIds] of Object.entries(CONFLICT_GROUPS)) {
    const activeMembers: Array<{ presetId: string; intensity: number; category: PresetCategory }> = [];
    for (const category of PRESET_STACK_ORDER) {
      const track = presetTracks[category];
      if (!track?.entries) continue;
      for (const entry of track.entries) {
        if (entry.enabled === false) continue;
        if (memberIds.includes(entry.presetId)) {
          const effective = computeEffectiveIntensity(track.intensity, entry.intensity);
          activeMembers.push({ presetId: entry.presetId, intensity: effective, category });
        }
      }
    }
    if (activeMembers.length > 1) {
      activeMembers.sort((a, b) => b.intensity - a.intensity);
      const winner = activeMembers[0];
      const losers = activeMembers.slice(1);
      diagnostics.push({
        type: 'conflict',
        severity: 'warning',
        message: `Conflicting presets in group "${groupName}": using ${winner.presetId} (${winner.intensity}%), skipping ${losers.map(l => l.presetId).join(', ')}`,
        source: groupName,
      });
    }
  }

  // Also check preset-level conflictGroup field
  const byGroup = new Map<string, Array<{ presetId: string; intensity: number }>>();
  for (const category of PRESET_STACK_ORDER) {
    const track = presetTracks[category];
    if (!track?.entries) continue;
    for (const entry of track.entries) {
      if (entry.enabled === false) continue;
      const preset = presetMap[entry.presetId];
      if (preset?.conflictGroup) {
        const effective = computeEffectiveIntensity(track.intensity, entry.intensity);
        if (!byGroup.has(preset.conflictGroup)) byGroup.set(preset.conflictGroup, []);
        byGroup.get(preset.conflictGroup)!.push({ presetId: entry.presetId, intensity: effective });
      }
    }
  }
  for (const [group, members] of byGroup) {
    if (members.length > 1) {
      members.sort((a, b) => b.intensity - a.intensity);
      diagnostics.push({
        type: 'conflict',
        severity: 'warning',
        message: `Conflicting presets in group "${group}": using ${members[0].presetId} (${members[0].intensity}%), skipping ${members.slice(1).map(m => m.presetId).join(', ')}`,
        source: group,
      });
    }
  }

  return diagnostics;
}

function detectDuplicatePhrases(segments: PromptSegment[]): PromptDiagnostic[] {
  const diagnostics: PromptDiagnostic[] = [];
  const seen = new Map<string, string>(); // normalized phrase -> source

  for (const seg of segments) {
    // Split into phrases (3+ word groups)
    const words = seg.text.toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i <= words.length - 3; i++) {
      const phrase = words.slice(i, i + 3).join(' ');
      if (seen.has(phrase) && seen.get(phrase) !== seg.source) {
        diagnostics.push({
          type: 'duplicate',
          severity: 'info',
          message: `Duplicate phrase "${phrase}" found in ${seg.source} and ${seen.get(phrase)}`,
          source: seg.source,
        });
        break; // One duplicate per segment is enough
      }
      seen.set(phrase, seg.source);
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Camera-aware character description
// ---------------------------------------------------------------------------

// Shot-size tokens checked against the preset ID's hyphen/underscore-separated
// segments. Segment-based matching avoids substring false positives like
// `surface`→"face" or `clearance`→"close" that the old `.includes()` hack hit.
const CLOSE_UP_TOKENS = new Set(['close', 'closeup', 'close-up', 'face', 'macro', 'extreme']);
const WIDE_TOKENS = new Set(['wide', 'establishing', 'aerial', 'panorama', 'panoramic']);

function tokenizePresetId(presetId: string): string[] {
  return presetId.toLowerCase().split(/[-_\s]+/).filter((token) => token.length > 0);
}

export function getCameraShot(presetTracks: PresetTrackSet | undefined): CameraShot {
  if (!presetTracks) return 'default';
  const cameraTrack = presetTracks.camera;
  if (!cameraTrack?.entries?.length) return 'default';
  const firstEntry = cameraTrack.entries[0];
  const tokens = tokenizePresetId(firstEntry.presetId ?? '');
  if (tokens.length === 0) return 'default';
  if (tokens.some((token) => CLOSE_UP_TOKENS.has(token))) return 'close-up';
  if (tokens.some((token) => WIDE_TOKENS.has(token))) return 'wide';
  return 'medium';
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]*[.!?]?/);
  return match ? match[0].trim() : text.trim();
}

export function buildCharacterDescription(resolved: ResolvedCharacter, shot: CameraShot): string {
  const { character, equipment, emotion, costume } = resolved;

  const hasStructured = !!(character.face || character.hair || character.body || character.skinTone);

  if (hasStructured) {
    const parts: string[] = [];

    switch (shot) {
      case 'close-up': {
        parts.push(character.name);
        // face details
        if (character.face) {
          const face = character.face;
          const eyeParts: string[] = [];
          if (face.eyeShape) eyeParts.push(face.eyeShape);
          if (face.eyeColor) eyeParts.push(face.eyeColor);
          if (eyeParts.length) parts.push(`${eyeParts.join(' ')} eyes`);
          if (face.noseType) parts.push(`${face.noseType} nose`);
          if (face.lipShape) parts.push(`${face.lipShape} lips`);
          if (face.jawline) parts.push(`${face.jawline} jawline`);
          if (face.definingFeatures) parts.push(face.definingFeatures);
        }
        // hair
        if (character.hair) {
          const hair = character.hair;
          const hairParts: string[] = [];
          if (hair.color) hairParts.push(hair.color);
          if (hair.length) hairParts.push(hair.length);
          if (hair.style) hairParts.push(hair.style);
          if (hair.texture) hairParts.push(hair.texture);
          if (hairParts.length) parts.push(hairParts.join(' '));
        }
        if (character.skinTone) parts.push(`${character.skinTone} skin`);
        if (emotion) parts.push(`looking ${emotion}`);
        if (character.distinctTraits?.length) {
          parts.push(...character.distinctTraits);
        }
        break;
      }
      case 'medium': {
        parts.push(character.name);
        if (character.age) parts.push(`age ${character.age}`);
        // face summary line
        if (character.face) {
          const face = character.face;
          const eyeDesc = [face.eyeColor, face.eyeShape].filter(Boolean).join(' ');
          if (eyeDesc) parts.push(`${eyeDesc} eyes`);
          if (face.jawline) parts.push(`${face.jawline} face`);
        }
        // hair
        if (character.hair) {
          const hair = character.hair;
          const hairParts: string[] = [];
          if (hair.color) hairParts.push(hair.color);
          if (hair.style) hairParts.push(hair.style);
          if (hairParts.length) parts.push(hairParts.join(' '));
        }
        if (character.skinTone) parts.push(`${character.skinTone} skin`);
        if (character.body?.build) parts.push(`${character.body.build} build`);
        // costume with material/color/condition
        const costumeObj = costume
          ? character.costumes.find((c) => c.id === costume || c.name === costume)
          : undefined;
        if (costumeObj) {
          parts.push(`wearing ${costumeObj.description || costumeObj.name}`);
        }
        // equipment names from loadout
        if (equipment?.length) {
          const eqNames = equipment.map((e) => e.name);
          parts.push(`carrying ${eqNames.join(', ')}`);
        }
        break;
      }
      case 'wide': {
        parts.push(character.name);
        if (character.body?.build) parts.push(`${character.body.build} build`);
        // one distinctive silhouette feature
        if (character.hair) {
          const hair = character.hair;
          const hairParts: string[] = [];
          if (hair.color) hairParts.push(hair.color);
          if (hair.style) hairParts.push(hair.style);
          if (hairParts.length) parts.push(`${hairParts.join(' ')} hair`);
        }
        if (character.distinctTraits?.length) {
          parts.push(character.distinctTraits[0]);
        }
        break;
      }
      default: {
        parts.push(character.name);
        // face summary
        if (character.face) {
          const face = character.face;
          const eyeDesc = [face.eyeColor, face.eyeShape].filter(Boolean).join(' ');
          if (eyeDesc) parts.push(`${eyeDesc} eyes`);
        }
        if (character.hair) {
          const hair = character.hair;
          const hairParts: string[] = [];
          if (hair.color) hairParts.push(hair.color);
          if (hair.style) hairParts.push(hair.style);
          if (hairParts.length) parts.push(hairParts.join(' '));
        }
        if (character.body?.build) parts.push(`${character.body.build} build`);
        break;
      }
    }

    // Add equipment for non-medium shots (medium already adds it above)
    if (shot !== 'medium' && shot !== 'close-up' && equipment?.length) {
      const eqNames = equipment.map((e) => e.name);
      parts.push(`carrying ${eqNames.join(', ')}`);
    }

    return parts.filter(Boolean).join(', ');
  }

  // Fallback: v1 behavior using free-text appearance
  const parts: string[] = [];

  switch (shot) {
    case 'close-up': {
      parts.push(character.name);
      if (character.age) parts.push(`age ${character.age}`);
      if (character.appearance) parts.push(firstSentence(character.appearance));
      if (emotion) parts.push(emotion);
      break;
    }
    case 'medium': {
      parts.push(character.name);
      const costumeObj = costume
        ? character.costumes.find((c) => c.id === costume || c.name === costume)
        : undefined;
      if (costumeObj) {
        parts.push(`wearing ${costumeObj.description || costumeObj.name}`);
      }
      if (character.appearance) parts.push(firstSentence(character.appearance));
      break;
    }
    case 'wide': {
      parts.push(character.name);
      if (character.appearance) {
        const brief = firstSentence(character.appearance);
        parts.push(brief);
      }
      break;
    }
    default: {
      parts.push(character.name);
      if (character.appearance) parts.push(firstSentence(character.appearance));
      break;
    }
  }

  if (equipment?.length) {
    const eqNames = equipment.map((e) => e.name);
    parts.push(`carrying ${eqNames.join(', ')}`);
  }

  return parts.filter(Boolean).join(', ');
}

function _buildLocationDescription(location: Location): string {
  const parts: string[] = [];

  const nameSegment = location.name;
  const timeSegment = location.timeOfDay ? ` at ${location.timeOfDay}` : '';
  let firstPart = `${nameSegment}${timeSegment}`;
  if (location.architectureStyle) firstPart += `, ${location.architectureStyle}`;
  parts.push(firstPart);

  if (location.keyFeatures?.length) parts.push(location.keyFeatures.join(', '));
  if (location.dominantColors?.length) parts.push(`dominated by ${location.dominantColors.join(' and ')} tones`);
  if (location.description) parts.push(location.description);
  if (location.lighting) parts.push(`${location.lighting} lighting`);
  if (location.mood) parts.push(`${location.mood} atmosphere`);
  if (location.atmosphereKeywords?.length) parts.push(`${location.atmosphereKeywords.join(', ')} atmosphere`);
  if (location.weather) parts.push(location.weather);

  return parts.filter(Boolean).join('. ');
}

function _buildStandaloneEquipmentDescription(items: Equipment[]): string {
  const descriptions = items.map((item) => {
    const detailParts: string[] = [];
    if (item.material || item.color) {
      const matColor = [item.material, item.color].filter(Boolean).join(' ');
      if (matColor) detailParts.push(matColor);
    }
    if (item.condition) detailParts.push(`${item.condition} condition`);
    if (item.visualDetails) detailParts.push(item.visualDetails);

    if (detailParts.length) {
      return `${item.name}: ${detailParts.join(', ')}`;
    }
    if (item.description) return `${item.name}: ${firstSentence(item.description)}`;
    return item.name;
  });
  return `Props: ${descriptions.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Style guide cascade
// ---------------------------------------------------------------------------

function applyStyleGuideDefaults(
  tracks: PresetTrackSet | undefined,
  styleGuide: StyleGuideDefaults | undefined,
  presetMap: Record<string, PresetDefinition>,
): PresetTrackSet | undefined {
  if (!styleGuide) return tracks;

  // Start with existing tracks or empty
  const result = tracks ? { ...tracks } : createEmptyPresetTrackSet();

  // Apply explicit defaultPresets for categories with no entries
  if (styleGuide.defaultPresets) {
    for (const [category, def] of Object.entries(styleGuide.defaultPresets) as Array<[PresetCategory, { presetId: string; intensity?: number; params?: Record<string, unknown> }]>) {
      const track = result[category];
      if (!track.entries.length && presetMap[def.presetId]) {
        (result as Record<PresetCategory, PresetTrack>)[category] = {
          ...track,
          intensity: def.intensity ?? 100,
          entries: [{
            id: `sg-${category}-0`,
            category,
            presetId: def.presetId,
            params: (def.params ?? {}) as PresetParamMap,
            order: 0,
          }],
        };
      }
    }
  }

  // Map artStyle → look preset (if look track is empty)
  if (styleGuide.artStyle && !result.look.entries.length) {
    const lookId = `look:${styleGuide.artStyle}`;
    if (presetMap[lookId]) {
      result.look = {
        ...result.look,
        entries: [{
          id: 'sg-look-art',
          category: 'look' as const,
          presetId: lookId,
          params: {} as PresetParamMap,
          order: 0,
        }],
      };
    }
  }

  // Map lighting → scene preset (if scene track is empty)
  if (styleGuide.lighting && !result.scene.entries.length) {
    const lightingMap: Record<string, string> = {
      'natural': '',
      'studio': 'scene:high-key',
      'dramatic': 'scene:low-key',
      'neon': 'scene:neon-noir',
      'rim': 'scene:rim-light',
      'golden-hour': 'scene:golden-hour',
      'moonlit': 'scene:moonlit-night',
    };
    const sceneId = lightingMap[styleGuide.lighting];
    if (sceneId && presetMap[sceneId]) {
      result.scene = {
        ...result.scene,
        entries: [{
          id: 'sg-scene-light',
          category: 'scene' as const,
          presetId: sceneId,
          params: {} as PresetParamMap,
          order: 0,
        }],
      };
    }
  }

  // Map colorPalette → look preset (append if look track exists, else set)
  if (styleGuide.colorPalette) {
    const colorId = `look:${styleGuide.colorPalette}`;
    if (presetMap[colorId] && !result.look.entries.some(e => e.presetId === colorId)) {
      result.look = {
        ...result.look,
        entries: [
          ...result.look.entries,
          {
            id: 'sg-look-color',
            category: 'look' as const,
            presetId: colorId,
            params: {} as PresetParamMap,
            order: result.look.entries.length,
          },
        ],
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Audio compilers (voice / music / sfx)
// ---------------------------------------------------------------------------

function compileVoice(input: PromptCompilerInput): CompiledPrompt {
  const segments: PromptSegment[] = [];

  // Character vocal traits
  const character = input.characters?.[0]?.character;
  if (character?.vocalTraits) {
    const vt = character.vocalTraits;
    const traitParts: string[] = [];
    if (vt.pitch) traitParts.push(`${vt.pitch} voice`);
    if (vt.accent) traitParts.push(`${vt.accent} accent`);
    if (vt.cadence) traitParts.push(`${vt.cadence} cadence`);
    if (traitParts.length) {
      segments.push({ source: 'character:vocal', text: traitParts.join(', '), trimmed: false });
    }
  }

  // Emotion
  const emotion = input.emotion ?? input.characters?.[0]?.emotion;
  if (emotion) {
    segments.push({ source: 'emotion', text: `${emotion} tone`, trimmed: false });
  }

  // Dialogue text
  if (input.dialogueText?.trim()) {
    segments.push({ source: 'dialogue', text: input.dialogueText.trim(), trimmed: false });
  } else if (input.prompt?.trim()) {
    segments.push({ source: 'user-text', text: input.prompt.trim(), trimmed: false });
  }

  const prompt = segments.map(s => s.text).filter(Boolean).join('. ');

  return {
    prompt,
    diagnostics: [],
    segments,
    wordCount: prompt.split(/\s+/).filter(Boolean).length,
    budget: 0,
  };
}

function compileMusic(input: PromptCompilerInput): CompiledPrompt {
  const segments: PromptSegment[] = [];

  // User prompt
  if (input.prompt?.trim()) {
    segments.push({ source: 'user-text', text: input.prompt.trim(), trimmed: false });
  }

  // Genre
  if (input.musicConfig?.genre) {
    segments.push({ source: 'music:genre', text: input.musicConfig.genre, trimmed: false });
  }

  // Tempo
  if (input.musicConfig?.tempo) {
    segments.push({ source: 'music:tempo', text: `${input.musicConfig.tempo} tempo`, trimmed: false });
  }

  // Key
  if (input.musicConfig?.key) {
    segments.push({ source: 'music:key', text: `key of ${input.musicConfig.key}`, trimmed: false });
  }

  // Time signature
  if (input.musicConfig?.timeSignature) {
    segments.push({ source: 'music:time', text: `${input.musicConfig.timeSignature} time`, trimmed: false });
  }

  // Instrumentation
  if (input.musicConfig?.instrumentation?.length) {
    segments.push({ source: 'music:instruments', text: `featuring ${input.musicConfig.instrumentation.join(', ')}`, trimmed: false });
  }

  // Scene mood from location or emotion presets
  if (input.locations?.[0]?.mood) {
    segments.push({ source: 'location:mood', text: `${input.locations[0].mood} mood`, trimmed: false });
  }

  // Duration
  if (input.durationSeconds) {
    segments.push({ source: 'duration', text: `${input.durationSeconds} seconds`, trimmed: false });
  }

  const prompt = segments.map(s => s.text).filter(Boolean).join(', ');

  return {
    prompt,
    diagnostics: [],
    segments,
    wordCount: prompt.split(/\s+/).filter(Boolean).length,
    budget: 0,
  };
}

function compileSfx(input: PromptCompilerInput): CompiledPrompt {
  const segments: PromptSegment[] = [];

  // User prompt (action/sound description)
  if (input.prompt?.trim()) {
    segments.push({ source: 'user-text', text: input.prompt.trim(), trimmed: false });
  }

  // Environment from location
  if (input.locations?.[0]) {
    const loc = input.locations[0];
    const envParts: string[] = [];
    if (loc.name) envParts.push(loc.name);
    if (loc.atmosphereKeywords?.length) envParts.push(loc.atmosphereKeywords.join(', '));
    if (envParts.length) {
      segments.push({ source: 'location:env', text: `in ${envParts.join(', ')}`, trimmed: false });
    }
  }

  // Material from equipment
  if (input.equipmentItems?.length) {
    const materials = input.equipmentItems
      .filter(eq => eq.material)
      .map(eq => `${eq.material} ${eq.name}`);
    if (materials.length) {
      segments.push({ source: 'equipment:material', text: materials.join(', '), trimmed: false });
    }
  }

  // Spatial placement
  if (input.sfxPlacement) {
    const placementMap: Record<string, string> = {
      close: 'close-up, intimate proximity',
      mid: 'medium distance',
      far: 'distant, ambient',
    };
    segments.push({ source: 'sfx:placement', text: placementMap[input.sfxPlacement] ?? input.sfxPlacement, trimmed: false });
  }

  // Duration
  if (input.durationSeconds) {
    segments.push({ source: 'duration', text: `${input.durationSeconds} seconds`, trimmed: false });
  }

  const prompt = segments.map(s => s.text).filter(Boolean).join(', ');

  return {
    prompt,
    diagnostics: [],
    segments,
    wordCount: prompt.split(/\s+/).filter(Boolean).length,
    budget: 0,
  };
}

// ---------------------------------------------------------------------------
// Character-sheet compiler
// ---------------------------------------------------------------------------

function compileCharacterSheet(
  input: PromptCompilerInput,
  presetMap: Record<string, PresetDefinition>,
): CompiledPrompt {
  const character = input.characters?.[0]?.character;
  if (!character) {
    return { prompt: '', diagnostics: [], segments: [], wordCount: 0, budget: 0 };
  }

  const resolved = input.characters![0];
  const sections: string[] = [];

  // 1. Header
  sections.push('Create a professional character turnaround and expression sheet.');

  // 2. SUBJECT
  const subjectParts: string[] = [];
  const genderLabel = character.gender ?? 'person';
  const ageLabel = character.age ? `${character.age}` : '';
  subjectParts.push(`A consistent original character named ${character.name}, a ${ageLabel} ${genderLabel}, with:`);

  if (character.face) {
    const faceParts: string[] = [];
    if (character.face.eyeShape && character.face.eyeColor) faceParts.push(`${character.face.eyeShape} ${character.face.eyeColor} eyes`);
    else if (character.face.eyeColor) faceParts.push(`${character.face.eyeColor} eyes`);
    if (character.face.noseType) faceParts.push(`${character.face.noseType} nose`);
    if (character.face.lipShape) faceParts.push(`${character.face.lipShape} lips`);
    if (character.face.jawline) faceParts.push(`${character.face.jawline} jawline`);
    if (character.face.definingFeatures) faceParts.push(character.face.definingFeatures);
    if (faceParts.length) subjectParts.push(`- Face: ${faceParts.join(', ')}`);
  }

  if (character.hair) {
    const hairParts: string[] = [];
    if (character.hair.color) hairParts.push(character.hair.color);
    if (character.hair.style) hairParts.push(character.hair.style);
    if (character.hair.length) hairParts.push(character.hair.length);
    if (character.hair.texture) hairParts.push(character.hair.texture);
    if (hairParts.length) subjectParts.push(`- Hair: ${hairParts.join(', ')}`);
  }

  if (character.skinTone) subjectParts.push(`- Skin tone: ${character.skinTone}`);

  if (character.body) {
    const bodyParts: string[] = [];
    if (character.body.height) bodyParts.push(character.body.height);
    if (character.body.build) bodyParts.push(character.body.build);
    if (character.body.proportions) bodyParts.push(character.body.proportions);
    if (bodyParts.length) subjectParts.push(`- Body type: ${bodyParts.join(', ')}`);
  }

  if (character.distinctTraits?.length) {
    subjectParts.push(`- Distinct traits: ${character.distinctTraits.join(', ')}`);
  }

  // Fallback if no structured fields
  if (subjectParts.length <= 1 && character.appearance) {
    subjectParts.push(character.appearance);
  }

  sections.push(`\nSUBJECT (Character Identity):\n${subjectParts.join('\n')}`);

  // 3. OUTFIT from loadout
  const outfitParts: string[] = [];
  if (resolved.equipment?.length) {
    for (const eq of resolved.equipment) {
      const details: string[] = [eq.name];
      if (eq.material) details.push(eq.material);
      if (eq.color) details.push(eq.color);
      if (eq.condition) details.push(eq.condition);
      if (eq.visualDetails) details.push(eq.visualDetails);
      if (!eq.material && !eq.color && eq.description) details.push(eq.description);
      outfitParts.push(details.join(', '));
    }
  }
  // Also check costumes
  if (resolved.costume) {
    const costumeObj = character.costumes.find(c => c.id === resolved.costume || c.name === resolved.costume);
    if (costumeObj?.description) {
      outfitParts.unshift(costumeObj.description);
    }
  }
  if (outfitParts.length) {
    sections.push(`\nOUTFIT (locked for consistency):\nCharacter wears:\n${outfitParts.join('\n')}\nRepeat exact outfit details to maintain consistency across all views.`);
  }

  // 4. POSE & TURNAROUND
  sections.push(`\nPOSE & TURNAROUND (main sheet):
Display the SAME character (identical design, no variation) in:
- Front view (neutral pose, arms slightly away from body)
- Left profile view
- Right profile view
- Back view

All views must:
- Match perfectly in proportions, clothing, hairstyle, and colors
- Be aligned evenly in a clean two-row model sheet layout
- Keep full body visible in every body panel with no cropped limbs or hair tips
- Look like the same model rotated in space`);

  // 5. EXPRESSION SHEET
  sections.push(`\nEXPRESSION SHEET (face close-ups):
Include detailed headshots showing:
- Neutral
- Happy
- Sad
- Angry
- Surprised
- Determined

Faces must remain structurally identical across emotions.`);

  // 6. STYLE (from look preset or input)
  let styleText = 'Highly detailed, professional character design sheet, studio quality';
  const lookTrack = input.presetTracks?.look;
  if (lookTrack?.entries?.length) {
    const firstLook = presetMap[lookTrack.entries[0].presetId];
    if (firstLook) {
      styleText = `${firstLook.name} style. ${styleText}`;
    }
  }
  sections.push(`\nSTYLE:\n${styleText}`);

  // 7. LIGHTING
  sections.push(`\nLIGHTING:
Neutral, even studio lighting
No dramatic shadows (to preserve true colors and details)`);

  // 8. COMPOSITION
  sections.push(`\nCOMPOSITION:
- Orthographic-style reference sheet
- Clean white or neutral background
- Symmetrical layout, evenly spaced
- Full body visible in every body panel + separate expression row`);

  // 9. COLOR & RENDER
  sections.push(`\nCOLOR & RENDER QUALITY:
Sharp focus, ultra-detailed textures, consistent color grading
Production-ready, animation/model sheet quality`);

  // 10. NEGATIVE
  const negativePrompt = 'No style variation, no redesign, no extra limbs, no distorted anatomy, no inconsistent face, no changing outfit, no blur, no noise, no text, no watermark';

  // 11. TECHNICAL
  sections.push(`\nTECHNICAL:
Aspect ratio 16:9
High resolution, 4K or higher`);

  const referenceImages = collectReferenceImages(input);

  return {
    prompt: sections.join('\n'),
    negativePrompt,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    diagnostics: [],
    segments: [{ source: 'character-sheet', text: sections.join('\n'), trimmed: false }],
    wordCount: sections.join('\n').split(/\s+/).filter(Boolean).length,
    budget: 0, // no budget for character sheets
  };
}

// ---------------------------------------------------------------------------
// Main compiler
// ---------------------------------------------------------------------------

export function compilePrompt(input: PromptCompilerInput): CompiledPrompt {
  const presetMap = buildPresetMap(input.presetLibrary);
  const budget = getBudget(input.providerId);

  if (input.mode === 'character-sheet') {
    return compileCharacterSheet(input, presetMap);
  }

  if (input.mode === 'voice') {
    return compileVoice(input);
  }
  if (input.mode === 'music') {
    return compileMusic(input);
  }
  if (input.mode === 'sfx') {
    return compileSfx(input);
  }

  // Apply style guide defaults to empty preset tracks
  const effectivePresetTracks = applyStyleGuideDefaults(input.presetTracks, input.styleGuide, presetMap);

  const trackedSegments: PromptSegment[] = [];
  const negativeSegments: string[] = [];
  const adapterParams: Record<string, unknown> = {};
  const referenceImages = collectReferenceImages(input);

  // 1. User text (scene prompt)
  if (input.prompt?.trim()) {
    const normalized =
      input.mode === 'image-to-video' ? stripForImageToVideo(input.prompt) : normalizeTextSegment(input.prompt);
    if (normalized) {
      trackedSegments.push({ source: 'user-text', text: normalized, trimmed: false });
    }
  }

  // 2. Connected text node content
  if (input.connectedTextContent) {
    for (const text of input.connectedTextContent) {
      const trimmed =
        input.mode === 'image-to-video' ? stripForImageToVideo(text) : normalizeTextSegment(text);
      if (trimmed) trackedSegments.push({ source: 'connected-text', text: trimmed, trimmed: false });
    }
  }

  // 3. Inject visible entity context so provider-facing prompts carry the same
  // continuity-critical identity details that node refs encode structurally.

  for (const resolved of input.characters ?? []) {
    const text = describeCharacterIdentity(resolved, input.mode);
    if (text) {
      trackedSegments.push({
        source: `character:${resolved.character.id}`,
        text,
        trimmed: false,
      });
    }
  }

  for (const location of input.locations ?? []) {
    const text = describeLocationIdentity(location, input.mode);
    if (text) {
      trackedSegments.push({
        source: `location:${location.id}`,
        text,
        trimmed: false,
      });
    }
  }

  for (const item of input.equipmentItems ?? []) {
    const text = describeStandaloneEquipment(item);
    if (text) {
      trackedSegments.push({
        source: `equipment:${item.id}`,
        text,
        trimmed: false,
      });
    }
  }

  // 4. Stack presets in order
  {
    for (const category of PRESET_STACK_ORDER) {
      if (input.mode === 'image-to-video' && !I2V_ALLOWED_CATEGORIES.has(category)) {
        continue;
      }

      const track = effectivePresetTracks?.[category];
      if (!track || !track.entries || track.entries.length === 0) continue;

      const withIntensity = track.entries
        .filter((entry) => entry.enabled !== false)
        .map((entry) => ({
          entry,
          effective: computeEffectiveIntensity(track.intensity, entry.intensity),
        }))
        .filter(({ effective }) => effective >= 10)
        .sort((a, b) => b.effective - a.effective);

      for (const { entry, effective } of withIntensity) {
        const fragment = resolveEntryPrompt(entry, presetMap);
        if (fragment) {
          trackedSegments.push({ source: 'preset:' + entry.presetId, text: applyIntensityAndDirection(fragment, effective, entry.direction), trimmed: false });
        }

        const preset = presetMap[entry.presetId];
        mergeParams(adapterParams, preset?.defaultParams as Record<string, unknown> | undefined);
        mergeParams(adapterParams, getEntryParams(entry));
      }
    }
  }

  // 5. Collect negative prompts from node text and presets
  if (input.negativePrompt?.trim()) {
    negativeSegments.push(input.negativePrompt.trim());
  }

  {
    for (const category of PRESET_STACK_ORDER) {
      const track = effectivePresetTracks?.[category];
      if (!track || !track.entries) continue;
      for (const entry of track.entries) {
        const preset = presetMap[entry.presetId];
        const neg = readPresetNegativePrompt(preset);
        if (neg) {
          negativeSegments.push(neg);
        }
      }
    }
  }

  // Style coherence footer — only reference style fields that were actually applied
  if (input.styleGuide?.artStyle || input.styleGuide?.colorPalette) {
    const styleParts: string[] = [];
    const artStyleApplied =
      input.styleGuide.artStyle &&
      effectivePresetTracks?.look.entries.some(e => e.id === 'sg-look-art');
    const colorPaletteApplied =
      input.styleGuide.colorPalette &&
      effectivePresetTracks?.look.entries.some(e => e.id === 'sg-look-color');
    if (artStyleApplied) styleParts.push(input.styleGuide.artStyle!.replace(/-/g, ' '));
    if (colorPaletteApplied) styleParts.push(`${input.styleGuide.colorPalette!.replace(/-/g, ' ')} color palette`);
    if (styleParts.length) {
      trackedSegments.push({
        source: 'style-guide',
        text: `Maintain consistent ${styleParts.join(' with ')} visual language throughout`,
        trimmed: false,
      });
    }
  }

  // 6. Assemble final prompt with word budget trimming
  const diagnostics: PromptDiagnostic[] = [];

  // Conflict detection
  diagnostics.push(...detectConflicts(effectivePresetTracks, presetMap));

  // Duplicate detection
  diagnostics.push(...detectDuplicatePhrases(trackedSegments));

  // Budget pre-check
  const rawPrompt = trackedSegments.map(s => normalizeTextSegment(s.text)).filter(Boolean).join('. ').replace(/\.\s*\./g, '. ');
  const wordCount = rawPrompt.split(/\s+/).filter(Boolean).length;
  if (wordCount > budget.positive) {
    diagnostics.push({
      type: 'budget_warning',
      severity: 'warning',
      message: `Prompt has ${wordCount} words, budget is ${budget.positive}. ${wordCount - budget.positive} words will be trimmed.`,
    });
  }
  const prompt = trimToWordBudget(rawPrompt, budget.positive);

  // Mark trimmed segments
  const promptWords = prompt.split(/\s+/).filter(Boolean).length;
  let runningWords = 0;
  for (const seg of trackedSegments) {
    const segWords = seg.text.split(/\s+/).filter(Boolean).length;
    runningWords += segWords;
    seg.trimmed = runningWords > promptWords;
  }

  const rawNegative = Array.from(new Set(negativeSegments)).join(', ');
  const negativePrompt = rawNegative
    ? trimToWordBudget(rawNegative, budget.negative)
    : undefined;

  const params = Object.keys(adapterParams).length > 0 ? adapterParams : undefined;

  return {
    prompt,
    negativePrompt,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    params,
    diagnostics,
    segments: trackedSegments,
    wordCount,
    budget: budget.positive,
  };
}
