import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type FfmpegBinaryName = 'ffmpeg' | 'ffprobe';

export const SUPPORTED_PLATFORMS = [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export interface FfmpegResolutionContext {
  platform?: NodeJS.Platform;
  arch?: string;
  cwd?: string;
  resourcesPath?: string;
  env?: NodeJS.ProcessEnv;
}

function processResourcesPath(): string | undefined {
  const value = (process as unknown as Record<string, unknown>).resourcesPath;
  return typeof value === 'string' ? value : undefined;
}

function getPlatformKey(platform: NodeJS.Platform, arch: string): SupportedPlatform | null {
  const key = `${platform}-${arch}`;
  return SUPPORTED_PLATFORMS.includes(key as SupportedPlatform) ? (key as SupportedPlatform) : null;
}

function binaryFilename(name: FfmpegBinaryName, platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${name}.exe` : name;
}

/**
 * Resolves an explicit override first, then a verified bundled payload.
 * Packaged applications fail closed when their payload is missing; only development may use PATH.
 */
export function resolveFfmpegBinary(
  name: FfmpegBinaryName,
  context: FfmpegResolutionContext = {},
): string {
  const platformName = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;
  const cwd = context.cwd ?? process.cwd();
  const resourcesPath = context.resourcesPath ?? processResourcesPath();
  const env = context.env ?? process.env;
  const envKey = name === 'ffprobe' ? 'FFPROBE_PATH' : 'FFMPEG_PATH';
  const envPath = env[envKey];
  if (envPath) return envPath;

  const platform = getPlatformKey(platformName, arch);
  const filename = binaryFilename(name, platformName);

  if (resourcesPath) {
    if (!platform) {
      throw new Error(
        `Unsupported packaged FFmpeg platform: ${platformName}-${arch}. ` +
          `Supported: ${SUPPORTED_PLATFORMS.join(', ')}`,
      );
    }
    const bundledPath = join(resourcesPath, 'bin', platform, 'bin', filename);
    if (existsSync(bundledPath)) return bundledPath;
    throw new Error(`Bundled ${name} binary is missing: ${bundledPath}`);
  }

  if (platform) {
    const developmentPath = join(cwd, 'resources', 'bin', platform, 'bin', filename);
    if (existsSync(developmentPath)) return developmentPath;
  }

  return filename;
}

export function isPlatformSupported(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  return getPlatformKey(platform, arch) !== null;
}

export function requirePlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): SupportedPlatform {
  const key = getPlatformKey(platform, arch);
  if (!key) {
    throw new Error(
      `Unsupported platform: ${platform}-${arch}. Supported: ${SUPPORTED_PLATFORMS.join(', ')}`,
    );
  }
  return key;
}
