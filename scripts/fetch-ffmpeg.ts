/**
 * Installs a pinned, checksum-verified FFmpeg payload for one platform.
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.ts
 *   node scripts/fetch-ffmpeg.ts --verify
 *   node scripts/fetch-ffmpeg.ts --platform linux-x64
 *   node scripts/fetch-ffmpeg.ts --archive /path/to/pinned-build.zip
 */

import { resolve, join } from 'node:path';
import {
  PLATFORM_KEYS,
  currentPlatformKey,
  installArchivePlatform,
  loadManifest,
  smokeTestPayload,
  verifyPayload,
  type PlatformKey,
} from './ffmpeg-artifacts.ts';

interface CliOptions {
  archivePath?: string;
  platform?: PlatformKey;
  verifyOnly: boolean;
  skipSmoke: boolean;
}

const REPO_ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = join(REPO_ROOT, 'packages', 'media-engine', 'ffmpeg-checksums.json');
const BIN_ROOT = join(REPO_ROOT, 'resources', 'bin');

function usage(): string {
  return [
    'Usage: node scripts/fetch-ffmpeg.ts [options]',
    '',
    'Options:',
    '  --platform <platform>  Target an exact supported platform',
    '  --archive <path>       Install from a local archive after checksum verification',
    '  --verify               Verify an already-installed payload only',
    '  --skip-smoke           Skip executable version/build/encoder checks',
    '  --help                 Show this help',
  ].join('\n');
}

function parsePlatform(value: string | undefined): PlatformKey {
  if (!value || !PLATFORM_KEYS.includes(value as PlatformKey)) {
    throw new Error(`Unsupported --platform value. Expected one of: ${PLATFORM_KEYS.join(', ')}`);
  }
  return value as PlatformKey;
}

function requireOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { verifyOnly: false, skipSmoke: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--platform':
        options.platform = parsePlatform(requireOptionValue(args, index, argument));
        index += 1;
        break;
      case '--archive':
        options.archivePath = resolve(requireOptionValue(args, index, argument));
        index += 1;
        break;
      case '--verify':
        options.verifyOnly = true;
        break;
      case '--skip-smoke':
        options.skipSmoke = true;
        break;
      case '--help':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${argument}\n\n${usage()}`);
    }
  }
  if (options.verifyOnly && options.archivePath) {
    throw new Error('--verify and --archive cannot be used together');
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest(MANIFEST_PATH);
  const platformKey = options.platform ?? currentPlatformKey();
  const platform = manifest.platforms[platformKey];
  const destination = join(BIN_ROOT, platformKey);

  console.log(`FFmpeg ${manifest.version} (${manifest.license})`);
  console.log(`Platform: ${platformKey}`);

  if (platform.kind === 'source-build') {
    throw new Error(
      `No trusted prebuilt payload is registered for ${platformKey}. ` +
        `Build it with ${platform.builder}, publish the immutable artifact, then replace this ` +
        'source-build gate with its archive and per-file checksums.',
    );
  }

  if (options.verifyOnly) {
    await verifyPayload(destination, platform);
  } else {
    await installArchivePlatform(platform, destination, {
      ...(options.archivePath ? { archivePath: options.archivePath } : {}),
    });
  }

  const canRunNatively = platformKey === currentPlatformKey();
  if (!options.skipSmoke && canRunNatively) {
    await smokeTestPayload(destination, manifest.version, platform);
    console.log('Payload checksum and native smoke checks passed.');
  } else if (!options.skipSmoke) {
    console.log('Payload checksums passed; native smoke skipped for cross-architecture target.');
  } else {
    console.log('Payload checksums passed; smoke checks explicitly skipped.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
