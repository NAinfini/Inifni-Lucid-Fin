import type {
  PresetTrackSet,
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
} from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PromptMode = 'text-to-image' | 'image-to-video' | 'text-to-video';

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
}

export interface CompiledPrompt {
  prompt: string;
  negativePrompt?: string;
  referenceImages?: string[];
  params?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Model-specific word budgets (from docs/ai-video-prompt-guide/07)
// ---------------------------------------------------------------------------

interface WordBudget {
  positive: number;
  negative: number;
}

const MODEL_BUDGETS: Record<string, WordBudget> = {
  kling: { positive: 200, negative: 50 },
  runway: { positive: 100, negative: 40 },
  luma: { positive: 150, negative: 40 },
  ray: { positive: 150, negative: 40 },
  wan: { positive: 150, negative: 50 },
  minimax: { positive: 150, negative: 40 },
  hailuo: { positive: 150, negative: 40 },
  pika: { positive: 100, negative: 50 },
  seedance: { positive: 120, negative: 40 },
  hunyuan: { positive: 200, negative: 60 },
  cogvideo: { positive: 200, negative: 60 },
  sora: { positive: 150, negative: 40 },
  veo: { positive: 150, negative: 40 },
  default: { positive: 200, negative: 60 },
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

function resolveEntryPrompt(
  entry: PresetTrackEntry,
  presetMap: Record<string, PresetDefinition>,
): string {
  const presetA = presetMap[entry.presetId];
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

function stripForImageToVideo(value: string): string {
  const normalized = normalizeTextSegment(value);
  if (!normalized) return '';
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
  return motionOnly.join('. ');
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

  return Array.from(hashes);
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
// Camera-aware character description
// ---------------------------------------------------------------------------

export function getCameraShot(presetTracks: PresetTrackSet | undefined): CameraShot {
  if (!presetTracks) return 'default';
  const cameraTrack = presetTracks.camera;
  if (!cameraTrack?.entries?.length) return 'default';
  const firstEntry = cameraTrack.entries[0];
  const presetId = firstEntry.presetId?.toLowerCase() ?? '';
  if (presetId.includes('close') || presetId.includes('face') || presetId.includes('macro')) return 'close-up';
  if (presetId.includes('wide') || presetId.includes('establishing') || presetId.includes('aerial')) return 'wide';
  return 'medium';
}

function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]*[.!?]?/);
  return match ? match[0].trim() : text.trim();
}

function buildCharacterDescription(resolved: ResolvedCharacter, shot: CameraShot): string {
  const { character, equipment, emotion, costume } = resolved;
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

function buildLocationDescription(location: Location): string {
  const parts: string[] = [];

  const typeLabel = location.type === 'interior'
    ? 'Interior of'
    : location.type === 'exterior'
      ? 'Exterior of'
      : '';
  const nameSegment = typeLabel ? `${typeLabel} ${location.name}` : location.name;
  const timeSegment = location.timeOfDay ? ` at ${location.timeOfDay}` : '';
  parts.push(`${nameSegment}${timeSegment}`);

  if (location.description) parts.push(location.description);
  if (location.lighting) parts.push(`${location.lighting} lighting`);
  if (location.mood) parts.push(`${location.mood} atmosphere`);
  if (location.weather) parts.push(location.weather);

  return parts.filter(Boolean).join('. ');
}

function buildStandaloneEquipmentDescription(items: Equipment[]): string {
  const descriptions = items.map((item) => {
    if (item.description) return `${item.name}: ${firstSentence(item.description)}`;
    return item.name;
  });
  return `Props: ${descriptions.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Main compiler
// ---------------------------------------------------------------------------

export function compilePrompt(input: PromptCompilerInput): CompiledPrompt {
  const presetMap = buildPresetMap(input.presetLibrary);
  const budget = getBudget(input.providerId);
  const segments: string[] = [];
  const negativeSegments: string[] = [];
  const adapterParams: Record<string, unknown> = {};
  const referenceImages = collectReferenceImages(input);

  // 1. User text (scene prompt)
  if (input.prompt?.trim()) {
    const normalized =
      input.mode === 'image-to-video' ? stripForImageToVideo(input.prompt) : normalizeTextSegment(input.prompt);
    if (normalized) {
      segments.push(normalized);
    }
  }

  // 2. Connected text node content
  if (input.connectedTextContent) {
    for (const text of input.connectedTextContent) {
      const trimmed =
        input.mode === 'image-to-video' ? stripForImageToVideo(text) : normalizeTextSegment(text);
      if (trimmed) segments.push(trimmed);
    }
  }

  // 3. Location descriptions (rich or fallback to ID)
  if (input.locations?.length) {
    for (const location of input.locations) {
      const desc = buildLocationDescription(location);
      if (desc) segments.push(desc);
    }
  } else if (input.locationRefs?.length) {
    const locations = input.locationRefs
      .map((ref) => ref.locationId?.trim())
      .filter((value): value is string => Boolean(value));
    if (locations.length) {
      segments.push(`Location: ${locations.join(', ')}`);
    }
  }

  // 4. Character descriptions (camera-aware or fallback to ID)
  if (input.characters?.length) {
    const shot = getCameraShot(input.presetTracks);
    for (const resolved of input.characters) {
      const desc = buildCharacterDescription(resolved, shot);
      if (desc) segments.push(desc);
    }
  } else if (input.characterRefs?.length) {
    const characters = input.characterRefs
      .map((ref) => ref.characterId?.trim())
      .filter((value): value is string => Boolean(value));
    if (characters.length) {
      segments.push(`Characters: ${characters.join(', ')}`);
    }
  }

  // 5. Standalone equipment (rich or fallback to ID)
  if (input.equipmentItems?.length) {
    segments.push(buildStandaloneEquipmentDescription(input.equipmentItems));
  } else if (input.equipmentRefs?.length) {
    const equipment = input.equipmentRefs
      .map((value) => typeof value === 'string' ? value.trim() : value.equipmentId.trim())
      .filter(Boolean);
    if (equipment.length) {
      segments.push(`Equipment: ${equipment.join(', ')}`);
    }
  }

  // 3. Stack presets in order
  {
    for (const category of PRESET_STACK_ORDER) {
      if (input.mode === 'image-to-video' && !I2V_ALLOWED_CATEGORIES.has(category)) {
        continue;
      }

      const track = input.presetTracks?.[category];
      if (!track || !track.entries || track.entries.length === 0) continue;
      if (track.aiDecide) continue;

      const withIntensity = track.entries
        .filter((entry) => !entry.aiDecide && entry.enabled !== false)
        .map((entry) => ({
          entry,
          effective: computeEffectiveIntensity(track.intensity, entry.intensity),
        }))
        .filter(({ effective }) => effective >= 10)
        .sort((a, b) => b.effective - a.effective);

      for (const { entry, effective } of withIntensity) {
        const fragment = resolveEntryPrompt(entry, presetMap);
        if (fragment) {
          segments.push(applyIntensityAndDirection(fragment, effective, entry.direction));
        }

        const preset = presetMap[entry.presetId];
        mergeParams(adapterParams, preset?.defaultParams as Record<string, unknown> | undefined);
        mergeParams(adapterParams, getEntryParams(entry));
      }
    }
  }

  // 4. Collect negative prompts from presets
  {
    for (const category of PRESET_STACK_ORDER) {
      const track = input.presetTracks?.[category];
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

  // 5. Assemble final prompt with word budget trimming
  const rawPrompt = segments
    .map((segment) => normalizeTextSegment(segment))
    .filter(Boolean)
    .join('. ')
    .replace(/\.\s*\./g, '. ');
  const prompt = trimToWordBudget(rawPrompt, budget.positive);

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
  };
}
