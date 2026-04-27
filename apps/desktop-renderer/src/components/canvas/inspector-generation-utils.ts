import type { NodeKind } from '@lucid-fin/contracts';

export type VisualGenerationNodeType = Extract<NodeKind, 'image' | 'video'>;
export type ResolutionPresetValue =
  | 'provider-default'
  | 'square-1024'
  | 'square-2048'
  | 'landscape-1344-768'
  | 'portrait-768-1344'
  | 'landscape-720'
  | 'landscape-1080'
  | 'portrait-720'
  | 'portrait-1080'
  | 'custom';

export type ResolutionPreset = {
  value: Exclude<ResolutionPresetValue, 'custom' | 'provider-default'>;
  groupLabel: 'Square' | 'Landscape' | 'Portrait';
  label: string;
  width: number;
  height: number;
};

export const CUSTOM_RESOLUTION_VALUE = 'custom' as const;
export const PROVIDER_DEFAULT_RESOLUTION_VALUE = 'provider-default' as const;
export const DEFAULT_IMAGE_RESOLUTION = { width: 1024, height: 1024 } as const;
export const DEFAULT_VIDEO_RESOLUTION = { width: 1280, height: 720 } as const;
export const DURATION_PRESETS = [3, 5, 8, 10, 15] as const;
export const FPS_PRESETS = [24, 30, 60] as const;

// Image node presets — every size is accepted natively by all mainstream
// image providers we ship (OpenAI gpt-image-1, Imagen 4, Flux Pro/Ultra,
// Ideogram V3, Recraft V3, Nano Banana). 1536 (3:2/2:3) intentionally
// omitted at user's request. 512 dropped (SD1.5 relic — modern providers
// reject it).
export const IMAGE_RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { value: 'square-1024',       groupLabel: 'Square',    label: '1024 × 1024',     width: 1024, height: 1024 },
  { value: 'landscape-1344-768', groupLabel: 'Landscape', label: '1344 × 768 (16:9)', width: 1344, height: 768 },
  { value: 'portrait-768-1344',  groupLabel: 'Portrait',  label: '768 × 1344 (9:16)', width: 768,  height: 1344 },
  { value: 'square-2048',       groupLabel: 'Square',    label: '2048 × 2048',     width: 2048, height: 2048 },
] as const;

// Video node presets — 4K omitted because only Veo supports it (everywhere
// else it would force a clamp-down). Covers 720p/1080p landscape + vertical.
export const VIDEO_RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { value: 'landscape-720',  groupLabel: 'Landscape', label: '1280 × 720 (HD)',   width: 1280, height: 720  },
  { value: 'landscape-1080', groupLabel: 'Landscape', label: '1920 × 1080 (FHD)', width: 1920, height: 1080 },
  { value: 'portrait-720',   groupLabel: 'Portrait',  label: '720 × 1280',        width: 720,  height: 1280 },
  { value: 'portrait-1080',  groupLabel: 'Portrait',  label: '1080 × 1920',       width: 1080, height: 1920 },
] as const;

/**
 * Legacy combined export retained for callers that haven't migrated to the
 * node-type-specific lists yet. New code should prefer
 * `getResolutionPresetsForNodeType(nodeType)`.
 */
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  ...IMAGE_RESOLUTION_PRESETS,
  ...VIDEO_RESOLUTION_PRESETS,
];

export function getResolutionPresetsForNodeType(
  nodeType: VisualGenerationNodeType,
): readonly ResolutionPreset[] {
  return nodeType === 'video' ? VIDEO_RESOLUTION_PRESETS : IMAGE_RESOLUTION_PRESETS;
}

type SeedRequestInput = {
  seed?: number;
  seedLocked: boolean;
  randomSeed: number;
};

type SeedRequestResult = {
  requestSeed: number;
  persistImmediately?: number;
  persistAfterCompletion?: number;
};

export function getDefaultResolution(nodeType: VisualGenerationNodeType): {
  width: number;
  height: number;
} {
  return nodeType === 'video' ? DEFAULT_VIDEO_RESOLUTION : DEFAULT_IMAGE_RESOLUTION;
}

export function getResolutionPresetValue(
  nodeType: VisualGenerationNodeType,
  width?: number,
  height?: number,
): ResolutionPresetValue {
  // Node override absent ⇒ "provider default" (falls through to canvas
  // publishResolution or factory default at render time).
  if (width == null && height == null) return PROVIDER_DEFAULT_RESOLUTION_VALUE;
  const fallback = getDefaultResolution(nodeType);
  const resolvedWidth = width ?? fallback.width;
  const resolvedHeight = height ?? fallback.height;
  const list = getResolutionPresetsForNodeType(nodeType);
  const match = list.find(
    (preset) => preset.width === resolvedWidth && preset.height === resolvedHeight,
  );
  return match?.value ?? CUSTOM_RESOLUTION_VALUE;
}

export function getResolutionPresetDimensions(
  value: ResolutionPresetValue,
): { width: number; height: number } | null {
  if (value === CUSTOM_RESOLUTION_VALUE || value === PROVIDER_DEFAULT_RESOLUTION_VALUE) {
    return null;
  }
  const match = RESOLUTION_PRESETS.find((preset) => preset.value === value);
  return match ? { width: match.width, height: match.height } : null;
}

export function createRandomSeed(random: () => number = Math.random): number {
  return Math.max(1, Math.floor(random() * 2_147_483_647));
}

export function resolveSeedRequest(input: SeedRequestInput): SeedRequestResult {
  if (input.seedLocked && Number.isInteger(input.seed)) {
    return {
      requestSeed: input.seed as number,
    };
  }
  if (input.seedLocked) {
    return {
      requestSeed: input.randomSeed,
      persistImmediately: input.randomSeed,
    };
  }
  return {
    requestSeed: input.randomSeed,
    persistAfterCompletion: input.randomSeed,
  };
}

