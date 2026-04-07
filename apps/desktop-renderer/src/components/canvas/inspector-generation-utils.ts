import type { CanvasNodeType } from '@lucid-fin/contracts';

export type VisualGenerationNodeType = Extract<CanvasNodeType, 'image' | 'video'>;
export type ResolutionPresetValue =
  | 'square-512'
  | 'square-1024'
  | 'square-2048'
  | 'landscape-720'
  | 'landscape-1080'
  | 'landscape-4k'
  | 'portrait-720'
  | 'portrait-1080'
  | 'widescreen-1920'
  | 'widescreen-2560'
  | 'custom';

export type ResolutionPreset = {
  value: Exclude<ResolutionPresetValue, 'custom'>;
  groupLabel: 'Square' | 'Landscape' | 'Portrait' | 'Widescreen';
  label: string;
  width: number;
  height: number;
};

export const CUSTOM_RESOLUTION_VALUE = 'custom' as const;
export const DEFAULT_IMAGE_RESOLUTION = { width: 1024, height: 1024 } as const;
export const DEFAULT_VIDEO_RESOLUTION = { width: 1280, height: 720 } as const;
export const DURATION_PRESETS = [3, 5, 8, 10, 15] as const;
export const FPS_PRESETS = [24, 30, 60] as const;
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { value: 'square-512', groupLabel: 'Square', label: '512 × 512', width: 512, height: 512 },
  { value: 'square-1024', groupLabel: 'Square', label: '1024 × 1024', width: 1024, height: 1024 },
  { value: 'square-2048', groupLabel: 'Square', label: '2048 × 2048', width: 2048, height: 2048 },
  { value: 'landscape-720', groupLabel: 'Landscape', label: '1280 × 720 (HD)', width: 1280, height: 720 },
  { value: 'landscape-1080', groupLabel: 'Landscape', label: '1920 × 1080 (FHD)', width: 1920, height: 1080 },
  { value: 'landscape-4k', groupLabel: 'Landscape', label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
  { value: 'portrait-720', groupLabel: 'Portrait', label: '720 × 1280', width: 720, height: 1280 },
  { value: 'portrait-1080', groupLabel: 'Portrait', label: '1080 × 1920', width: 1080, height: 1920 },
  { value: 'widescreen-1920', groupLabel: 'Widescreen', label: '1920 × 832', width: 1920, height: 832 },
  { value: 'widescreen-2560', groupLabel: 'Widescreen', label: '2560 × 1080', width: 2560, height: 1080 },
] as const;

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
  const fallback = getDefaultResolution(nodeType);
  const resolvedWidth = width ?? fallback.width;
  const resolvedHeight = height ?? fallback.height;
  const match = RESOLUTION_PRESETS.find(
    (preset) => preset.width === resolvedWidth && preset.height === resolvedHeight,
  );
  return match?.value ?? CUSTOM_RESOLUTION_VALUE;
}

export function getResolutionPresetDimensions(
  value: ResolutionPresetValue,
): { width: number; height: number } | null {
  if (value === CUSTOM_RESOLUTION_VALUE) {
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
