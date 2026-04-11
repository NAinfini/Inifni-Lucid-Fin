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
    resolutions: ['1280x720', '1584x672', '1104x832', '720x1280', '832x1104', '672x1584', '960x960'],
    durationRange: [5, 10],
    notes: 'Image-to-video supports more aspect ratios than text-to-video.',
  },
  'pika-v2': {
    type: 'video',
    aliases: ['pika'],
    resolutions: ['1280x720', '1920x1080'],
    durationRange: [5, 10],
    notes: 'Sound effects available on web platform only, not via API.',
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
    durationRange: [4, 15],
    notes: 'Supports multi-reference images. Up to 720p.',
  },
  'kling-v1': {
    type: 'video',
    aliases: ['kling'],
    supportsAudio: true,
    qualityTiers: ['std', 'pro'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    durationRange: [5, 10],
    notes: 'Audio generation requires enable_audio. Pro mode has higher quality but 2x cost. Supports camera motion controls.',
  },
  'google-veo-2': {
    type: 'video',
    aliases: ['google-video'],
    supportsAudio: true,
    aspectRatios: ['16:9'],
    durationRange: [5, 8],
    notes: 'Audio via generateAudio parameter. Supports ambient, dialogue, and music layers in prompt.',
  },
  'wan-2.1': {
    type: 'video',
    aliases: ['wan'],
    resolutions: ['854x480', '1280x720', '1920x1080'],
    durationRange: [3, 10],
    notes: 'Frame-based duration (num_frames). Supports first and last frame images.',
  },
  'minimax-video01': {
    type: 'video',
    aliases: ['minimax'],
    resolutions: ['1280x720'],
    durationRange: [5, 10],
    notes: 'Fixed 720p output. Has prompt_optimizer for automatic prompt enhancement.',
  },
  'hunyuan-video': {
    type: 'video',
    aliases: ['hunyuan'],
    resolutions: ['854x480', '1280x720'],
    durationRange: [3, 8],
    notes: 'Frame-based duration with 4-frame alignment. Good for Asian faces and CJK text.',
  },
  'openai-dalle': {
    type: 'image',
    aliases: ['openai-image'],
    qualityTiers: ['standard', 'hd'],
    resolutions: ['1024x1024', '1024x1792', '1792x1024'],
    notes: 'Fixed resolution options only. No negative prompt or seed support.',
  },
  ideogram: {
    type: 'image',
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    notes: 'Supports negative prompt and seed. Good at text rendering in images.',
  },
  'recraft-v3': {
    type: 'image',
    aliases: ['recraft', 'recraft-v4'],
    styles: ['realistic_image', 'digital_illustration', 'digital_art', 'vector_illustration'],
    notes: 'Style-based API. Default style is realistic_image.',
  },
  'leonardo-v2': {
    type: 'image',
    resolutions: ['512x512', '1024x1024'],
    notes: 'Supports LoRA models and image-to-image.',
  },
  'google-imagen3': {
    type: 'image',
    aliases: ['google-image'],
    aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    notes: 'Predefined aspect ratios only.',
  },
  flux: {
    type: 'image',
    resolutions: ['1024x1024'],
    notes: 'Replicate-hosted. Multiple variants: schnell (fast), pro, dev.',
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
    durationRange: profile.durationRange ? [...profile.durationRange] as [number, number] : undefined,
    styles: profile.styles ? [...profile.styles] : undefined,
  };
}

export function getBuiltinProviderCapabilityProfile(
  providerId: string,
): BuiltinProviderCapabilityProfile | undefined {
  const canonicalProviderId = BUILTIN_PROVIDER_CAPABILITY_PROFILE_ALIASES[providerId];
  if (!canonicalProviderId) {
    return undefined;
  }

  return cloneCapabilityProfile(BUILTIN_PROVIDER_CAPABILITY_PROFILES[canonicalProviderId]);
}

export function listBuiltinVideoProvidersWithAudio(): string[] {
  return Object.entries(BUILTIN_PROVIDER_CAPABILITY_PROFILES)
    .filter(([, profile]) => profile.type === 'video' && profile.supportsAudio)
    .map(([providerId]) => providerId);
}

export function listBuiltinAudioGenerationProviders(
  type?: BuiltinAudioGenerationType,
): BuiltinAudioGenerationProvider[] {
  return BUILTIN_AUDIO_GENERATION_PROVIDERS
    .filter((provider) => (type ? provider.type === type : true))
    .map((provider) => ({ ...provider }));
}

export function getBuiltinVideoProviderRuntimeMetadata(
  providerId: string,
): VideoProviderRuntimeMetadata | undefined {
  const profile = getBuiltinProviderCapabilityProfile(providerId);
  if (!profile || profile.type !== 'video') {
    return undefined;
  }

  if (!profile.supportsAudio && (!profile.qualityTiers || profile.qualityTiers.length === 0)) {
    return undefined;
  }

  return {
    supportsAudio: profile.supportsAudio,
    qualityTiers: profile.qualityTiers ? [...profile.qualityTiers] : undefined,
  };
}

export function resolveVideoReferenceImageField(
  providerId: string | undefined,
  model: string | undefined,
): string | undefined {
  const normalizedProviderId = providerId?.trim().toLowerCase();
  const normalizedModel = model?.trim().toLowerCase();

  if (
    normalizedProviderId === 'replicate' ||
    normalizedModel?.startsWith('openai/sora-2')
  ) {
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
