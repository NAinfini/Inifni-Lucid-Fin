import { describe, expect, it } from 'vitest';
import { getLgplVideoCodecConfig } from './codec-policy.js';

describe('getLgplVideoCodecConfig', () => {
  it.each([
    ['darwin', 'h264', 'h264_videotoolbox'],
    ['darwin', 'h265', 'hevc_videotoolbox'],
    ['win32', 'h264', 'libopenh264'],
    ['win32', 'h265', 'libkvazaar'],
    ['linux', 'h264', 'libopenh264'],
    ['linux', 'h265', 'libkvazaar'],
  ] as const)('selects %s LGPL encoder for %s', (platform, codec, encoder) => {
    expect(getLgplVideoCodecConfig(codec, { platform })).toEqual({
      encoder,
      outputOptions: [],
    });
  });

  it('adapts render quality to compatible bitrate control instead of x264 CRF or presets', () => {
    const config = getLgplVideoCodecConfig('h264', {
      platform: 'win32',
      quality: 'standard',
    });

    expect(config.outputOptions).toEqual(['-b:v 8M']);
    expect(config.outputOptions.join(' ')).not.toMatch(/-crf|-preset/);
  });

  it('uses an explicit bitrate in preference to the quality default', () => {
    expect(
      getLgplVideoCodecConfig('h265', {
        platform: 'darwin',
        quality: 'high',
        bitrate: '50M',
      }),
    ).toEqual({
      encoder: 'hevc_videotoolbox',
      outputOptions: ['-b:v 50M'],
    });
  });

  it('rejects unsupported runtime platforms instead of selecting an unverified encoder', () => {
    expect(() =>
      getLgplVideoCodecConfig('h264', { platform: 'freebsd' as NodeJS.Platform }),
    ).toThrow('Unsupported platform for bundled LGPL video encoding: freebsd');
  });
});
