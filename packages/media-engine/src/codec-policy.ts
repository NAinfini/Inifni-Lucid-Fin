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

interface PlatformCodecConfig {
  encoders: Record<LgplVideoCodec, string>;
  outputOptions: string[];
}

const PLATFORM_CODECS: Record<'darwin' | 'win32' | 'linux', PlatformCodecConfig> = {
  darwin: {
    encoders: {
      h264: 'h264_videotoolbox',
      h265: 'hevc_videotoolbox',
    },
    outputOptions: ['-allow_sw 1'],
  },
  win32: {
    encoders: {
      h264: 'libopenh264',
      h265: 'libkvazaar',
    },
    outputOptions: [],
  },
  linux: {
    encoders: {
      h264: 'libopenh264',
      h265: 'libkvazaar',
    },
    outputOptions: [],
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
  const platformConfig = PLATFORM_CODECS[platform as keyof typeof PLATFORM_CODECS];

  if (!platformConfig) {
    throw new Error(`Unsupported platform for bundled LGPL video encoding: ${platform}`);
  }

  const bitrate =
    options.bitrate ?? (options.quality ? QUALITY_BITRATES[options.quality] : undefined);

  return {
    encoder: platformConfig.encoders[codec],
    outputOptions: [
      ...platformConfig.outputOptions,
      ...(bitrate === undefined ? [] : [`-b:v ${bitrate}`]),
    ],
  };
}
