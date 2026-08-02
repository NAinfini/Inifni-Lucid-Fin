import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertImmutableArtifactUrl,
  computeSha256,
  loadManifest,
  validateManifest,
  type ArtifactFile,
  type FfmpegManifest,
  type PlatformArchive,
} from './ffmpeg-artifacts.ts';

export const DARWIN_PLATFORM_KEYS = ['darwin-x64', 'darwin-arm64'] as const;
export type DarwinPlatformKey = (typeof DARWIN_PLATFORM_KEYS)[number];

export interface DarwinArchiveFragment {
  schemaVersion: 1;
  platformKey: DarwinPlatformKey;
  platform: PlatformArchive;
}

export interface CreateDarwinArchiveFragmentOptions {
  platformKey: DarwinPlatformKey;
  payloadDirectory: string;
  archivePath: string;
  archiveUrl: string;
  buildVersion?: string;
}

const REQUIRED_PAYLOAD_PATHS = [
  'bin/ffmpeg',
  'bin/ffprobe',
  'licenses/ffmpeg-LGPLv3.txt',
  'provenance/ffmpeg-buildconf.txt',
  'SHA256SUMS',
] as const;

function isDarwinPlatformKey(value: string): value is DarwinPlatformKey {
  return DARWIN_PLATFORM_KEYS.includes(value as DarwinPlatformKey);
}

function toPosixRelativePath(root: string, path: string): string {
  const rootPath = resolve(root);
  const targetPath = resolve(path);
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`Payload path escapes its root: ${path}`);
  }
  const relativePath = relative(rootPath, targetPath).split(sep).join('/');
  if (!relativePath || relativePath === '.' || relativePath.startsWith('../')) {
    throw new Error(`Invalid payload path: ${path}`);
  }
  return posix.normalize(relativePath);
}

async function collectPayloadFiles(directory: string): Promise<ArtifactFile[]> {
  const root = resolve(directory);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`FFmpeg payload must be a real directory: ${directory}`);
  }

  const paths: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Symlinks are forbidden in FFmpeg payloads: ${path}`);
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        paths.push(path);
      } else {
        throw new Error(`Unsupported FFmpeg payload entry: ${path}`);
      }
    }
  }
  await visit(root);

  const files = await Promise.all(
    paths.map(async (path): Promise<ArtifactFile> => {
      const stats = await lstat(path);
      const relativePath = toPosixRelativePath(root, path);
      const executable =
        relativePath.startsWith('bin/') ||
        (relativePath.startsWith('lib/') && relativePath.endsWith('.dylib'));
      return {
        source: relativePath,
        destination: relativePath,
        sha256: await computeSha256(path),
        size: stats.size,
        ...(executable ? { executable: true } : {}),
      };
    }),
  );
  files.sort((left, right) => left.destination.localeCompare(right.destination, 'en'));
  return files;
}

export async function createDarwinArchiveFragment(
  options: CreateDarwinArchiveFragmentOptions,
): Promise<DarwinArchiveFragment> {
  assertImmutableArtifactUrl(options.archiveUrl, 'macOS FFmpeg archive URL');
  const archiveStats = await lstat(options.archivePath);
  if (!archiveStats.isFile() || archiveStats.isSymbolicLink()) {
    throw new Error(`FFmpeg archive must be a regular file: ${options.archivePath}`);
  }

  const files = await collectPayloadFiles(options.payloadDirectory);
  const payloadPaths = new Set(files.map((file) => file.destination));
  for (const requiredPath of REQUIRED_PAYLOAD_PATHS) {
    if (!payloadPaths.has(requiredPath)) {
      throw new Error(`macOS FFmpeg payload is missing ${requiredPath}`);
    }
  }

  const buildConfiguration = await readFile(
    resolve(options.payloadDirectory, 'provenance', 'ffmpeg-buildconf.txt'),
    'utf8',
  );
  if (/--enable-(?:gpl|nonfree)(?:\s|$)/.test(buildConfiguration)) {
    throw new Error('macOS FFmpeg payload enables a forbidden GPL/nonfree build flag');
  }
  for (const requiredFlag of ['--disable-gpl', '--disable-nonfree']) {
    if (!buildConfiguration.includes(requiredFlag)) {
      throw new Error(`macOS FFmpeg payload does not prove ${requiredFlag}`);
    }
  }

  return {
    schemaVersion: 1,
    platformKey: options.platformKey,
    platform: {
      kind: 'archive',
      buildVersion: options.buildVersion ?? '8.1.2-lucid-fin-macos-1',
      archive: {
        url: options.archiveUrl,
        sha256: await computeSha256(options.archivePath),
        root: options.platformKey,
      },
      commands: {
        ffmpeg: 'bin/ffmpeg',
        ffprobe: 'bin/ffprobe',
      },
      requiredEncoders: ['h264_videotoolbox', 'hevc_videotoolbox'],
      forbiddenBuildFlags: ['--enable-gpl', '--enable-nonfree'],
      files,
    },
  };
}

function parseDarwinArchiveFragment(value: unknown, label: string): DarwinArchiveFragment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const fragment = value as Partial<DarwinArchiveFragment>;
  if (fragment.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  if (typeof fragment.platformKey !== 'string' || !isDarwinPlatformKey(fragment.platformKey)) {
    throw new Error(`${label}.platformKey must be darwin-x64 or darwin-arm64`);
  }
  if (!fragment.platform || fragment.platform.kind !== 'archive') {
    throw new Error(`${label}.platform must be an archive descriptor`);
  }
  return fragment as DarwinArchiveFragment;
}

export function mergeDarwinArchiveFragments(
  manifest: FfmpegManifest,
  fragments: readonly DarwinArchiveFragment[],
): FfmpegManifest {
  const fragmentsByPlatform = new Map<DarwinPlatformKey, DarwinArchiveFragment>();
  for (const fragment of fragments) {
    const parsed = parseDarwinArchiveFragment(fragment, `fragment[${fragmentsByPlatform.size}]`);
    if (fragmentsByPlatform.has(parsed.platformKey)) {
      throw new Error(`Duplicate macOS FFmpeg fragment: ${parsed.platformKey}`);
    }
    fragmentsByPlatform.set(parsed.platformKey, parsed);
  }
  for (const platformKey of DARWIN_PLATFORM_KEYS) {
    if (!fragmentsByPlatform.has(platformKey)) {
      throw new Error(`Missing macOS FFmpeg fragment: ${platformKey}`);
    }
  }
  const x64Fragment = fragmentsByPlatform.get('darwin-x64');
  const arm64Fragment = fragmentsByPlatform.get('darwin-arm64');
  if (!x64Fragment || !arm64Fragment) {
    throw new Error('Both macOS FFmpeg fragments are required');
  }

  const merged: FfmpegManifest = {
    ...manifest,
    platforms: {
      ...manifest.platforms,
      'darwin-x64': x64Fragment.platform,
      'darwin-arm64': arm64Fragment.platform,
    },
  };
  return validateManifest(merged);
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function optionValues(args: readonly string[], option: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    values.push(value);
    index += 1;
  }
  return values;
}

function requiredOption(args: readonly string[], option: string): string {
  const values = optionValues(args, option);
  if (values.length !== 1) throw new Error(`${option} must be provided exactly once`);
  const value = values[0];
  if (!value) throw new Error(`${option} must be provided exactly once`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8');
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON at ${path}`, { cause: error });
  }
}

function usage(): string {
  return [
    'Usage:',
    '  node scripts/finalize-ffmpeg-macos-artifacts.ts create --platform <darwin-x64|darwin-arm64> --payload <dir> --archive <file> --url <immutable-url> --output <json>',
    '  node scripts/finalize-ffmpeg-macos-artifacts.ts merge --manifest <json> --fragment <json> --fragment <json> --output <json>',
  ].join('\n');
}

async function main(args: readonly string[]): Promise<void> {
  const [command] = args;
  if (command === 'create') {
    const platformValue = requiredOption(args, '--platform');
    if (!isDarwinPlatformKey(platformValue)) {
      throw new Error('--platform must be darwin-x64 or darwin-arm64');
    }
    const fragment = await createDarwinArchiveFragment({
      platformKey: platformValue,
      payloadDirectory: resolve(requiredOption(args, '--payload')),
      archivePath: resolve(requiredOption(args, '--archive')),
      archiveUrl: requiredOption(args, '--url'),
    });
    const output = resolve(requiredOption(args, '--output'));
    await writeJsonAtomically(output, fragment);
    console.log(`Wrote immutable ${platformValue} FFmpeg fragment: ${output}`);
    return;
  }

  if (command === 'merge') {
    const manifestPath = resolve(requiredOption(args, '--manifest'));
    const fragmentPaths = optionValues(args, '--fragment').map((path) => resolve(path));
    if (fragmentPaths.length !== 2) throw new Error('merge requires exactly two --fragment files');
    const manifest = await loadManifest(manifestPath);
    const fragments = await Promise.all(
      fragmentPaths.map(async (path, index) =>
        parseDarwinArchiveFragment(await readJson(path), `fragment[${index}]`),
      ),
    );
    const merged = mergeDarwinArchiveFragments(manifest, fragments);
    const output = resolve(requiredOption(args, '--output'));
    await writeJsonAtomically(output, merged);
    console.log(`Wrote complete immutable FFmpeg manifest: ${output}`);
    return;
  }

  throw new Error(usage());
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
