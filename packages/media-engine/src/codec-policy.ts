export type LgplVideoCodec = 'h264' | 'h265';
export type LgplVideoQuality = 'draft' | 'standard' | 'high';

export interface LgplVideoCodecOptions {
  /** Override only for deterministic tests; production uses the current runtime platform. */
  platform?: NodeJS.Platform;
  quality?: LgplVideoQuality;
  bitrate?: string;
}

export interface LgplVideoCodecConfig {
  encoder: string;
  outputOptions: string[];
}

const PLATFORM_ENCODERS: Record<'darwin' | 'win32' | 'linux', Record<LgplVideoCodec, string>> = {
  darwin: {
    h264: 'h264_videotoolbox',
    h265: 'hevc_videotoolbox',
  },
  win32: {
    h264: 'libopenh264',
    h265: 'libkvazaar',
  },
  linux: {
    h264: 'libopenh264',
    h265: 'libkvazaar',
  },
};

const QUALITY_BITRATES: Record<LgplVideoQuality, string> = {
  draft: '2M',
  standard: '8M',
  high: '16M',
};

/**
 * Resolves encoders included in the application's LGPL FFmpeg distribution.
 * These encoders do not support the x264/x265 CRF and preset options, so
 * quality is expressed through the portable FFmpeg bitrate control instead.
 */
export function getLgplVideoCodecConfig(
  codec: LgplVideoCodec,
  options: LgplVideoCodecOptions = {},
): LgplVideoCodecConfig {
  const platform = options.platform ?? process.platform;
  const encoders = PLATFORM_ENCODERS[platform as keyof typeof PLATFORM_ENCODERS];

  if (!encoders) {
    throw new Error(`Unsupported platform for bundled LGPL video encoding: ${platform}`);
  }

  const bitrate =
    options.bitrate ?? (options.quality ? QUALITY_BITRATES[options.quality] : undefined);

  return {
    encoder: encoders[codec],
    outputOptions: bitrate === undefined ? [] : [`-b:v ${bitrate}`],
  };
}
