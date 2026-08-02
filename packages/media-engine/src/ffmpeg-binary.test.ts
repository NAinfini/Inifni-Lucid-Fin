import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

// Mock fs.existsSync so we can control which paths "exist"
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => false) };
});

import { existsSync } from 'fs';
import { resolveFfmpegBinary, isPlatformSupported, requirePlatformKey } from './ffmpeg-binary.js';

const existsSyncMock = vi.mocked(existsSync);

describe('resolveFfmpegBinary', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;

    // Remove resourcesPath if set
    const proc = process as unknown as Record<string, unknown>;
    if ('resourcesPath' in process) {
      delete proc.resourcesPath;
    }
  });

  it('returns production bundled path when resourcesPath is set and binary exists', () => {
    (process as unknown as Record<string, unknown>).resourcesPath = '/app/resources';
    const platform = `${process.platform}-${process.arch}`;
    const expectedFilename = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const expectedPath = path.join('/app/resources', 'bin', platform, 'bin', expectedFilename);

    existsSyncMock.mockImplementation((p) => p === expectedPath);

    expect(resolveFfmpegBinary('ffmpeg')).toBe(expectedPath);
  });

  it('returns dev resources path when resourcesPath is not set but local binary exists', () => {
    const platform = `${process.platform}-${process.arch}`;
    const expectedFilename = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const expectedPath = path.join(
      process.cwd(),
      'resources',
      'bin',
      platform,
      'bin',
      expectedFilename,
    );

    existsSyncMock.mockImplementation((p) => p === expectedPath);

    expect(resolveFfmpegBinary('ffmpeg')).toBe(expectedPath);
  });

  it('gives an explicit FFMPEG_PATH override precedence over bundled binaries', () => {
    process.env.FFMPEG_PATH = '/custom/ffmpeg';
    (process as unknown as Record<string, unknown>).resourcesPath = '/app/resources';
    existsSyncMock.mockReturnValue(true);

    expect(resolveFfmpegBinary('ffmpeg')).toBe('/custom/ffmpeg');
  });

  it('returns FFPROBE_PATH env var for ffprobe', () => {
    process.env.FFPROBE_PATH = '/custom/ffprobe';
    existsSyncMock.mockReturnValue(false);

    expect(resolveFfmpegBinary('ffprobe')).toBe('/custom/ffprobe');
  });

  it('falls back to bare binary name when nothing else is available', () => {
    existsSyncMock.mockReturnValue(false);
    const expected = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

    expect(resolveFfmpegBinary('ffmpeg')).toBe(expected);
  });

  it('throws instead of silently using PATH when a packaged payload is missing', () => {
    (process as unknown as Record<string, unknown>).resourcesPath = '/app/resources';
    existsSyncMock.mockReturnValue(false);

    expect(() => resolveFfmpegBinary('ffmpeg')).toThrow(/bundled ffmpeg binary is missing/i);
  });

  it('resolves the Windows ARM64 payload from the five-platform matrix', () => {
    const expectedPath = path.join('C:\\app\\resources', 'bin', 'win32-arm64', 'bin', 'ffmpeg.exe');
    existsSyncMock.mockImplementation((candidate) => candidate === expectedPath);

    expect(
      resolveFfmpegBinary('ffmpeg', {
        platform: 'win32',
        arch: 'arm64',
        resourcesPath: 'C:\\app\\resources',
      }),
    ).toBe(expectedPath);
  });

  it('resolves ffprobe with .exe suffix on win32', () => {
    existsSyncMock.mockReturnValue(false);
    const result = resolveFfmpegBinary('ffprobe');

    if (process.platform === 'win32') {
      expect(result).toBe('ffprobe.exe');
    } else {
      expect(result).toBe('ffprobe');
    }
  });
});

describe('isPlatformSupported', () => {
  it('returns true for the current test platform when it is in the five-platform matrix', () => {
    const key = `${process.platform}-${process.arch}`;
    const supported = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64'];
    expect(isPlatformSupported()).toBe(supported.includes(key));
  });

  it('includes Windows ARM64', () => {
    expect(isPlatformSupported('win32', 'arm64')).toBe(true);
  });
});

describe('requirePlatformKey', () => {
  it('returns the platform key on supported platforms', () => {
    const key = `${process.platform}-${process.arch}`;
    const supported = ['win32-x64', 'win32-arm64', 'darwin-x64', 'darwin-arm64', 'linux-x64'];
    if (supported.includes(key)) {
      expect(requirePlatformKey()).toBe(key);
    } else {
      expect(() => requirePlatformKey()).toThrow('Unsupported platform');
    }
  });
});
