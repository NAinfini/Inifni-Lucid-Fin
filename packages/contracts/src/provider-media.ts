import type { GenerationRequest } from './dto/generation.js';
import { getBuiltinMediaProvider, listBuiltinMediaProviders } from './media-provider-catalog.js';

export type BuiltinMediaProviderType = 'image' | 'video';
export type BuiltinAudioGenerationType = 'voice' | 'music' | 'sfx';

export interface VideoProviderRuntimeMetadata {
  supportsAudio?: boolean;
  qualityTiers?: string[];
}

export interface BuiltinProviderCapabilityProfile {
  type: BuiltinMediaProviderType;
  supportsAudio?: boolean;
  qualityTiers?: string[];
  resolutions?: string[];
  aspectRatios?: string[];
  durationRange?: [number, number];
  styles?: string[];
  notes?: string;
  /** Maximum pixel dimension (width or height). Used to clamp requests. */
  maxDimension?: number;
}

export interface BuiltinAudioGenerationProvider {
  id: string;
  name: string;
  type: BuiltinAudioGenerationType;
}

type BuiltinProviderCapabilityProfileDefinition = BuiltinProviderCapabilityProfile & {
  aliases?: string[];
};

const BUILTIN_PROVIDER_CAPABILITY_PROFILES: Record<
  string,
  BuiltinProviderCapabilityProfileDefinition
> = {
  'runway-gen4': {
    type: 'video',
    aliases: ['runway'],
    resolutions: [
      '1280x720',
      '1584x672',
      '1104x832',
      '720x1280',
      '832x1104',
      '672x1584',
      '960x960',
    ],
    durationRange: [5, 10],
    notes: 'Image-to-video supports more aspect ratios than text-to-video.',
  },
  'luma-ray2': {
    type: 'video',
    aliases: ['luma'],
    aspectRatios: ['16:9'],
    durationRange: [5, 10],
    notes: 'Supports loop parameter and keyframe interpolation with first/last frame images.',
  },
  'seedance-2': {
    type: 'video',
    aliases: ['seedance'],
    aspectRatios: ['16:9', '9:16', '21:9', '4:3', '3:4', '1:1'],
    durationRange: [5, 15],
    supportsAudio: true,
    qualityTiers: ['720p', '1080p', '4K'],
    notes:
      'Replicate Seedance 2.0 supports up to nine ordered reference images, native audio, and up to 4K output. Generic references cannot be combined with first/last-frame inputs.',
  },
  'kling-v1': {
    type: 'video',
    aliases: ['kling'],
    supportsAudio: true,
    qualityTiers: ['std', 'pro'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationRange: [5, 10],
    notes:
      'Audio generation requires enable_audio. Pro mode has higher quality but 2x cost. Supports camera motion controls.',
  },
  'google-veo-2': {
    type: 'video',
    aliases: ['google-video'],
    supportsAudio: true,
    aspectRatios: ['16:9', '9:16'],
    durationRange: [3, 10],
    notes: 'Gemini Omni Flash produces 720p video with native audio through the Interactions API.',
  },
  'minimax-video01': {
    type: 'video',
    aliases: ['minimax'],
    supportsAudio: true,
    qualityTiers: ['768P', '2K'],
    resolutions: ['1366x768', '2048x1152'],
    aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    durationRange: [4, 15],
    notes:
      'MiniMax H3 supports 768P/2K output, native stereo audio, up to nine image references, first/last frames, and 4–15 second generation. The adapter retains legacy Hailuo 2.3 compatibility.',
  },
  pixverse: {
    type: 'video',
    supportsAudio: true,
    qualityTiers: ['360p', '540p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    durationRange: [1, 15],
    notes:
      'PixVerse V6 supports text and first-frame image generation. Unverified last-frame transition payloads are rejected explicitly.',
  },
  'alibaba-wan-video': {
    type: 'video',
    supportsAudio: true,
    qualityTiers: ['720P', '1080P'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    durationRange: [2, 15],
    notes:
      'Wan 2.7 supports text-to-video, first/last frames, reference images, native audio, and region-specific Model Studio endpoints.',
  },
  ltx: {
    type: 'video',
    resolutions: ['1920x1080', '1080x1920', '2560x1440', '1440x2560', '3840x2160', '2160x3840'],
    aspectRatios: ['16:9', '9:16'],
    durationRange: [1, 20],
    supportsAudio: true,
    notes: 'LTX 2.3 accepts only its declared landscape and portrait resolution set.',
  },
  'openai-dalle': {
    type: 'image',
    aliases: ['openai-image'],
    qualityTiers: ['low', 'medium', 'high', 'auto'],
    resolutions: [
      '1024x1024',
      '1536x1024',
      '1024x1536',
      '2048x2048',
      '2048x1152',
      '3840x2160',
      '2160x3840',
    ],
    maxDimension: 3840,
    notes:
      'gpt-image-2 supports ordered high-fidelity image references through the Image API edits endpoint.',
  },
  bria: {
    type: 'image',
    qualityTiers: ['1MP', '4MP'],
    maxDimension: 4096,
    notes: 'Bria V2 supports commercially safe text generation and one reference image.',
  },
  'codex-imagegen': {
    type: 'image',
    resolutions: ['1024x1024'],
    maxDimension: 1024,
    notes:
      'Uses Codex App Server image generation with ChatGPT plan quota. Dimensions and quality are best-effort.',
  },
  ideogram: {
    type: 'image',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    maxDimension: 2048,
    notes: 'Supports negative prompt and seed. Good at text rendering in images.',
  },
  'recraft-v4': {
    type: 'image',
    aliases: ['recraft'],
    styles: ['realistic_image', 'digital_illustration', 'digital_art', 'vector_illustration'],
    maxDimension: 2048,
    notes: 'Style-based API. Max 16MP total pixels, max single dimension 4096px.',
  },
  'leonardo-v2': {
    type: 'image',
    resolutions: ['512x512', '1024x1024'],
    maxDimension: 1024,
    notes: 'Supports LoRA models and image-to-image.',
  },
  'google-imagen3': {
    type: 'image',
    aliases: ['google-image'],
    aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    maxDimension: 2048,
    notes:
      'Gemini 3.1 Flash Image supports image generation/editing, up to 14 references, and 1K/2K/4K output.',
  },
  flux: {
    type: 'image',
    resolutions: ['1024x1024'],
    maxDimension: 1440,
    notes: 'Replicate-hosted. Max dimension 1440px. Dimensions must be divisible by 32.',
  },
  replicate: {
    type: 'image',
    aliases: ['replicate-sdxl'],
    resolutions: ['1024x1024'],
    maxDimension: 1024,
    notes: 'Replicate generic. SDXL-based models: max 1024px, divisible by 8.',
  },
  'fal-ai': {
    type: 'image',
    aliases: ['fal'],
    maxDimension: 2048,
    notes: 'fal.ai hosted. Most models support 1536-2048px.',
  },
  'stability-v2': {
    type: 'image',
    aliases: ['stability', 'sd3'],
    resolutions: ['1024x1024'],
    maxDimension: 1536,
    notes: 'Stability AI. SDXL: 1024px, SD3.5 Large: up to 1536px.',
  },
  'together-ai': {
    type: 'image',
    aliases: ['together'],
    maxDimension: 1440,
    notes: 'Together AI hosted. Flux-based models: max 1440px.',
  },
  siliconflow: {
    type: 'image',
    maxDimension: 1024,
    notes: 'SiliconFlow hosted. Most models max 1024px.',
  },
  'zhipu-cogview': {
    type: 'image',
    aliases: ['cogview'],
    maxDimension: 2048,
    notes: 'CogView-4: up to 2048x2048.',
  },
  'tongyi-wanxiang': {
    type: 'image',
    aliases: ['wanxiang'],
    maxDimension: 1024,
    notes: 'Wanx v1: 1024px. Wanx v2: 2048px.',
  },
  seedream: {
    type: 'image',
    aliases: ['volcengine-image'],
    maxDimension: 2048,
    notes: 'Seedream 3.0: up to 2048x2048.',
  },
};

const BUILTIN_AUDIO_GENERATION_PROVIDERS: readonly BuiltinAudioGenerationProvider[] = [
  { id: 'elevenlabs-v2', name: 'ElevenLabs', type: 'voice' },
  { id: 'openai-tts-1-hd', name: 'OpenAI TTS', type: 'voice' },
  { id: 'fish-audio-v1', name: 'Fish Audio', type: 'voice' },
  { id: 'suno-v4', name: 'Suno AI', type: 'music' },
  { id: 'udio-v1', name: 'Udio', type: 'music' },
  { id: 'stability-audio-v2', name: 'Stability Audio', type: 'sfx' },
];

const BUILTIN_PROVIDER_CAPABILITY_PROFILE_ALIASES = Object.entries(
  BUILTIN_PROVIDER_CAPABILITY_PROFILES,
).reduce<Record<string, string>>((aliases, [providerId, profile]) => {
  aliases[providerId] = providerId;
  for (const alias of profile.aliases ?? []) {
    aliases[alias] = providerId;
  }
  return aliases;
}, {});

function cloneCapabilityProfile(
  profile: BuiltinProviderCapabilityProfile,
): BuiltinProviderCapabilityProfile {
  return {
    ...profile,
    qualityTiers: profile.qualityTiers ? [...profile.qualityTiers] : undefined,
    resolutions: profile.resolutions ? [...profile.resolutions] : undefined,
    aspectRatios: profile.aspectRatios ? [...profile.aspectRatios] : undefined,
    durationRange: profile.durationRange
      ? ([...profile.durationRange] as [number, number])
      : undefined,
    styles: profile.styles ? [...profile.styles] : undefined,
  };
}

export function getBuiltinProviderCapabilityProfile(
  providerId: string,
): BuiltinProviderCapabilityProfile | undefined {
  const canonicalProviderId = BUILTIN_PROVIDER_CAPABILITY_PROFILE_ALIASES[providerId];
  if (!canonicalProviderId) {
    const catalogEntry = listBuiltinMediaProviders().find(
      (entry) => entry.providerId === providerId.trim().toLowerCase(),
    );
    if (!catalogEntry) return undefined;
    return {
      type: catalogEntry.group,
      supportsAudio: catalogEntry.supportsAudio,
      qualityTiers: catalogEntry.qualityTiers ? [...catalogEntry.qualityTiers] : undefined,
      resolutions: catalogEntry.defaultResolution ? [catalogEntry.defaultResolution] : undefined,
      notes: catalogEntry.notes,
      maxDimension:
        catalogEntry.group === 'image'
          ? maxDimensionFromResolution(catalogEntry.defaultResolution)
          : undefined,
    };
  }

  return cloneCapabilityProfile(BUILTIN_PROVIDER_CAPABILITY_PROFILES[canonicalProviderId]);
}

export function resolveBuiltinProviderId(providerId: string): string | undefined {
  return BUILTIN_PROVIDER_CAPABILITY_PROFILE_ALIASES[providerId.trim().toLowerCase()];
}

export function listBuiltinVideoProvidersWithAudio(): string[] {
  return [
    ...new Set([
      ...Object.entries(BUILTIN_PROVIDER_CAPABILITY_PROFILES)
        .filter(([, profile]) => profile.type === 'video' && profile.supportsAudio)
        .map(([providerId]) => providerId),
      ...listBuiltinMediaProviders('video')
        .filter((provider) => provider.supportsAudio)
        .map((provider) => provider.providerId),
    ]),
  ];
}

export function listBuiltinAudioGenerationProviders(
  type?: BuiltinAudioGenerationType,
): BuiltinAudioGenerationProvider[] {
  return BUILTIN_AUDIO_GENERATION_PROVIDERS.filter((provider) =>
    type ? provider.type === type : true,
  ).map((provider) => ({ ...provider }));
}

export function getBuiltinVideoProviderRuntimeMetadata(
  providerId: string,
): VideoProviderRuntimeMetadata | undefined {
  const profile = getBuiltinProviderCapabilityProfile(providerId);
  const catalogProfile = getBuiltinMediaProvider('video', providerId);
  if ((!profile || profile.type !== 'video') && !catalogProfile) return undefined;

  const supportsAudio =
    profile?.type === 'video' ? profile.supportsAudio : catalogProfile?.supportsAudio;
  const qualityTiers =
    profile?.type === 'video' ? profile.qualityTiers : catalogProfile?.qualityTiers;
  if (!supportsAudio && (!qualityTiers || qualityTiers.length === 0)) {
    return undefined;
  }

  return {
    supportsAudio,
    qualityTiers: qualityTiers ? [...qualityTiers] : undefined,
  };
}

export function resolveVideoReferenceImageField(
  providerId: string | undefined,
  model: string | undefined,
): string | undefined {
  const normalizedProviderId = providerId?.trim().toLowerCase();
  const normalizedModel = model?.trim().toLowerCase();

  if (normalizedProviderId === 'replicate' || normalizedModel?.startsWith('openai/sora-2')) {
    if (normalizedModel?.startsWith('openai/sora-2')) {
      return 'input_reference';
    }
    if (normalizedModel?.startsWith('minimax/video-01')) {
      return 'first_frame_image';
    }
  }

  if (normalizedModel?.startsWith('minimax/video-01')) {
    return 'first_frame_image';
  }

  return undefined;
}

function normalizeReferenceValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolvePrimaryVideoConditioningImage(
  request: Pick<GenerationRequest, 'frameReferenceImages' | 'sourceImagePath' | 'referenceImages'>,
): string | undefined {
  return (
    normalizeReferenceValue(request.frameReferenceImages?.first) ??
    normalizeReferenceValue(request.sourceImagePath) ??
    normalizeReferenceValue(request.referenceImages?.[0])
  );
}

export function resolveLastVideoConditioningImage(
  request: Pick<GenerationRequest, 'frameReferenceImages'>,
): string | undefined {
  return normalizeReferenceValue(request.frameReferenceImages?.last);
}

function maxDimensionFromResolution(resolution: string | undefined): number | undefined {
  const match = resolution?.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  return Math.max(Number(match[1]), Number(match[2]));
}
