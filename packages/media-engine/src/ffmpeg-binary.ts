import { join } from 'path';
import { existsSync } from 'fs';

/**
 * FFmpeg binary path resolution.
 *
 * Production: bundled in extraResources/bin/<platform>/
 * Development: local resources/bin/<platform>/ or FFMPEG_PATH env var or system PATH
 *
 * Platform key format: `${process.platform}-${process.arch}` e.g. "win32-x64"
 */

export type FfmpegBinaryName = 'ffmpeg' | 'ffprobe';

/** Supported platform keys matching ffmpeg-checksums.json */
const SUPPORTED_PLATFORMS = ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64'] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

function getPlatformKey(): SupportedPlatform | null {
  const key = `${process.platform}-${process.arch}`;
  if (SUPPORTED_PLATFORMS.includes(key as SupportedPlatform)) {
    return key as SupportedPlatform;
  }
  return null;
}

function binaryFilename(name: FfmpegBinaryName): string {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

/**
 * Resolve the absolute path to a bundled FFmpeg binary.
 *
 * Resolution order:
 * 1. Production: `process.resourcesPath/bin/<platform>/<binary>`
 * 2. Development: `<repoRoot>/resources/bin/<platform>/<binary>`
 * 3. Env override: `FFMPEG_PATH` (for ffmpeg) / `FFPROBE_PATH` (for ffprobe)
 * 4. Fallback: bare binary name (relies on system PATH) — development only
 */
export function resolveFfmpegBinary(name: FfmpegBinaryName): string {
  const platform = getPlatformKey();
  const filename = binaryFilename(name);

  // 1. Production path (Electron packaged app)
  // process.resourcesPath is an Electron-specific property, not in Node.js types.
  const resourcesPath = (process as unknown as Record<string, unknown>).resourcesPath;
  if (typeof resourcesPath === 'string') {
    const prodPath = join(resourcesPath, 'bin', platform ?? '', filename);
    if (existsSync(prodPath)) return prodPath;
  }

  // 2. Development path (repo root / resources / bin / <platform>)
  if (platform) {
    // Walk up from this file to find the repo root.
    // In dev, this module lives at packages/media-engine/dist/ffmpeg-binary.js
    // or packages/media-engine/src/ffmpeg-binary.ts (when running via tsx/vitest).
    // We try a few likely repo-root anchors.
    const candidates = [
      // When running from repo root (common in monorepo)
      join(process.cwd(), 'resources', 'bin', platform, filename),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  }

  // 3. Env override
  const envKey = name === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
  const envPath = process.env[envKey];
  if (envPath) return envPath;

  // 4. Fallback to system PATH (development only)
  return filename;
}

/**
 * Returns true if the current platform is in the supported platform matrix.
 */
export function isPlatformSupported(): boolean {
  return getPlatformKey() !== null;
}

/**
 * Returns the current platform key or throws if unsupported.
 */
export function requirePlatformKey(): SupportedPlatform {
  const key = getPlatformKey();
  if (!key) {
    throw new Error(
      `Unsupported platform: ${process.platform}-${process.arch}. ` +
        `Supported: ${SUPPORTED_PLATFORMS.join(', ')}`,
    );
  }
  return key;
}
