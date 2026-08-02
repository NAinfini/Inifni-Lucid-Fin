import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

export const PLATFORM_KEYS = [
  'win32-x64',
  'win32-arm64',
  'linux-x64',
  'darwin-x64',
  'darwin-arm64',
] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

export interface ArtifactFile {
  source: string;
  destination: string;
  sha256: string;
  size: number;
  executable?: boolean;
}

export interface PlatformArchive {
  kind: 'archive';
  buildVersion: string;
  archive: {
    url: string;
    sha256: string;
    root: string;
  };
  commands: {
    ffmpeg: string;
    ffprobe: string;
  };
  requiredEncoders: string[];
  forbiddenBuildFlags: string[];
  files: ArtifactFile[];
}

export interface PlatformSourceBuild {
  kind: 'source-build';
  builder: string;
  source: {
    url: string;
    sha256: string;
  };
  commands: {
    ffmpeg: string;
    ffprobe: string;
  };
}

export type PlatformArtifact = PlatformArchive | PlatformSourceBuild;

export interface FfmpegManifest {
  schemaVersion: 2;
  version: string;
  license: 'LGPL-3.0-or-later';
  sourceCode: {
    url: string;
    sha256: string;
  };
  platforms: Record<PlatformKey, PlatformArtifact>;
}

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const FLOATING_URL_PATTERN = /(?:\/|\b)(?:latest|main|master|head)(?:\/|\b)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function validateSha256(value: unknown, label: string): string {
  const sha256 = requireString(value, label);
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${label} must be a complete 64-character SHA-256 digest`);
  }
  return sha256.toLowerCase();
}

function validateImmutableUrl(value: unknown, label: string): string {
  const url = requireString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} must be a valid immutable HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || FLOATING_URL_PATTERN.test(parsed.pathname)) {
    throw new Error(`${label} must be an immutable HTTPS URL without floating refs`);
  }
  return url;
}

export function assertImmutableArtifactUrl(value: string, label = 'artifact URL'): void {
  validateImmutableUrl(value, label);
}

function normalizeRelativeArchivePath(value: string, label: string): string {
  if (
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value)
  ) {
    throw new Error(`Unsafe archive path in ${label}: ${value}`);
  }

  const segments = value.split('/');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Unsafe archive path in ${label}: ${value}`);
  }

  const normalized = posix.normalize(value).replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) {
    throw new Error(`Unsafe archive path in ${label}: ${value}`);
  }
  return normalized;
}

export function assertSafeArchiveEntries(entries: readonly string[]): void {
  const normalizedEntries = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizeRelativeArchivePath(entry, 'archive listing');
    if (normalizedEntries.has(normalized)) {
      throw new Error(`Duplicate archive entry: ${entry}`);
    }
    normalizedEntries.add(normalized);
  }
}

function validateCommands(value: unknown, label: string): PlatformArtifact['commands'] {
  const commands = requireRecord(value, label);
  return {
    ffmpeg: normalizeRelativeArchivePath(requireString(commands.ffmpeg, `${label}.ffmpeg`), label),
    ffprobe: normalizeRelativeArchivePath(
      requireString(commands.ffprobe, `${label}.ffprobe`),
      label,
    ),
  };
}

function validateSource(value: unknown, label: string): { url: string; sha256: string } {
  const source = requireRecord(value, label);
  return {
    url: validateImmutableUrl(source.url, `${label}.url`),
    sha256: validateSha256(source.sha256, `${label}.sha256`),
  };
}

function validateArchivePlatform(value: Record<string, unknown>, label: string): PlatformArchive {
  const archiveValue = requireRecord(value.archive, `${label}.archive`);
  const commands = validateCommands(value.commands, `${label}.commands`);
  const rawFiles = value.files;
  if (!Array.isArray(rawFiles) || rawFiles.length < 2) {
    throw new Error(`${label}.files must list at least ffmpeg and ffprobe`);
  }

  const destinations = new Set<string>();
  const files = rawFiles.map((rawFile, index): ArtifactFile => {
    const file = requireRecord(rawFile, `${label}.files[${index}]`);
    const source = normalizeRelativeArchivePath(
      requireString(file.source, `${label}.files[${index}].source`),
      `${label}.files[${index}].source`,
    );
    const destination = normalizeRelativeArchivePath(
      requireString(file.destination, `${label}.files[${index}].destination`),
      `${label}.files[${index}].destination`,
    );
    if (destinations.has(destination)) {
      throw new Error(`${label} has duplicate payload destination: ${destination}`);
    }
    destinations.add(destination);
    if (!Number.isSafeInteger(file.size) || (file.size as number) <= 0) {
      throw new Error(`${label}.files[${index}].size must be a positive integer`);
    }
    if (file.executable !== undefined && typeof file.executable !== 'boolean') {
      throw new Error(`${label}.files[${index}].executable must be boolean`);
    }
    return {
      source,
      destination,
      sha256: validateSha256(file.sha256, `${label}.files[${index}].sha256`),
      size: file.size as number,
      ...(file.executable === undefined ? {} : { executable: file.executable }),
    };
  });

  if (!destinations.has(commands.ffmpeg)) {
    throw new Error(`${label}.files must include the declared ffmpeg command`);
  }
  if (!destinations.has(commands.ffprobe)) {
    throw new Error(`${label}.files must include the declared ffprobe command`);
  }

  return {
    kind: 'archive',
    buildVersion: requireString(value.buildVersion, `${label}.buildVersion`),
    archive: {
      url: validateImmutableUrl(archiveValue.url, `${label}.archive.url`),
      sha256: validateSha256(archiveValue.sha256, `${label}.archive.sha256`),
      root: normalizeRelativeArchivePath(
        requireString(archiveValue.root, `${label}.archive.root`),
        `${label}.archive.root`,
      ),
    },
    commands,
    requiredEncoders: requireStringArray(value.requiredEncoders, `${label}.requiredEncoders`),
    forbiddenBuildFlags: requireStringArray(
      value.forbiddenBuildFlags,
      `${label}.forbiddenBuildFlags`,
    ),
    files,
  };
}

function validateSourceBuild(value: Record<string, unknown>, label: string): PlatformSourceBuild {
  return {
    kind: 'source-build',
    builder: normalizeRelativeArchivePath(
      requireString(value.builder, `${label}.builder`),
      `${label}.builder`,
    ),
    source: validateSource(value.source, `${label}.source`),
    commands: validateCommands(value.commands, `${label}.commands`),
  };
}

export function validateManifest(value: unknown): FfmpegManifest {
  const manifest = requireRecord(value, 'manifest');
  if (manifest.schemaVersion !== 2) throw new Error('manifest.schemaVersion must be 2');
  const version = requireString(manifest.version, 'manifest.version');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('manifest.version must be an exact semantic version');
  }
  if (manifest.license !== 'LGPL-3.0-or-later') {
    throw new Error('manifest.license must be LGPL-3.0-or-later');
  }

  const platformsValue = requireRecord(manifest.platforms, 'manifest.platforms');
  const actualKeys = Object.keys(platformsValue).sort();
  const expectedKeys = [...PLATFORM_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`manifest.platforms must contain exactly: ${PLATFORM_KEYS.join(', ')}`);
  }

  const platforms = {} as Record<PlatformKey, PlatformArtifact>;
  for (const key of PLATFORM_KEYS) {
    const label = `manifest.platforms.${key}`;
    const platform = requireRecord(platformsValue[key], label);
    if (platform.kind === 'archive') {
      platforms[key] = validateArchivePlatform(platform, label);
    } else if (platform.kind === 'source-build') {
      platforms[key] = validateSourceBuild(platform, label);
    } else {
      throw new Error(`${label}.kind must be archive or source-build`);
    }
  }

  return {
    schemaVersion: 2,
    version,
    license: 'LGPL-3.0-or-later',
    sourceCode: validateSource(manifest.sourceCode, 'manifest.sourceCode'),
    platforms,
  };
}

export async function loadManifest(path: string): Promise<FfmpegManifest> {
  const content = await readFile(path, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid FFmpeg manifest JSON at ${path}`, { cause: error });
  }
  return validateManifest(value);
}

export async function computeSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function payloadPath(directory: string, relativePath: string): string {
  const normalized = normalizeRelativeArchivePath(relativePath, 'payload destination');
  const target = resolve(directory, ...normalized.split('/'));
  const root = resolve(directory);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Unsafe payload destination: ${relativePath}`);
  }
  return target;
}

export async function verifyPayload(directory: string, platform: PlatformArchive): Promise<void> {
  for (const file of platform.files) {
    const path = payloadPath(directory, file.destination);
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Missing payload file: ${file.destination}`, { cause: error });
      }
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Payload entry must be a regular file: ${file.destination}`);
    }
    if (stats.size !== file.size) {
      throw new Error(
        `Payload size mismatch for ${file.destination}: expected ${file.size}, got ${stats.size}`,
      );
    }
    const actual = await computeSha256(path);
    if (actual !== file.sha256) {
      throw new Error(
        `Checksum mismatch for ${file.destination}: expected ${file.sha256}, got ${actual}`,
      );
    }
  }
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`FFmpeg artifact download failed (${response.status}): ${url}`);
  }
  await pipeline(response.body, createWriteStream(destination, { flags: 'wx' }));
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const { stdout } = await execFileAsync('tar', ['-tf', archivePath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  assertSafeArchiveEntries(entries);
  return entries.map((entry) => normalizeRelativeArchivePath(entry, 'archive listing'));
}

async function extractArchiveEntry(
  archivePath: string,
  archiveEntry: string,
  destination: string,
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const output = createWriteStream(destination, { flags: 'wx' });
  const child = spawn('tar', ['-xOf', archivePath, archiveEntry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 16_384) stderr += chunk;
  });

  const exit = new Promise<void>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('close', (code) => {
      if (code === 0) resolveExit();
      else
        rejectExit(new Error(`tar failed for ${archiveEntry}: ${stderr.trim() || `exit ${code}`}`));
    });
  });

  await Promise.all([pipeline(child.stdout, output), exit]);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function replaceDirectoryAtomically(staging: string, destination: string): Promise<void> {
  const backup = `${destination}.backup-${process.pid}-${Date.now()}`;
  const hadDestination = await pathExists(destination);
  if (hadDestination) await rename(destination, backup);
  try {
    await rename(staging, destination);
  } catch (error) {
    if (hadDestination) await rename(backup, destination);
    throw error;
  }
  if (hadDestination) await rm(backup, { recursive: true, force: true });
}

export interface InstallArchiveOptions {
  archivePath?: string;
}

export async function installArchivePlatform(
  platform: PlatformArchive,
  destination: string,
  options: InstallArchiveOptions = {},
): Promise<void> {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const staging = join(parent, `.${basename(destination)}.staging-${nonce}`);
  const downloadedArchive = join(parent, `.${basename(destination)}.download-${nonce}`);
  const archivePath = options.archivePath ?? downloadedArchive;
  await mkdir(staging, { recursive: false });

  try {
    if (!options.archivePath) await downloadFile(platform.archive.url, archivePath);
    const archiveHash = await computeSha256(archivePath);
    if (archiveHash !== platform.archive.sha256) {
      throw new Error(
        `Archive checksum mismatch: expected ${platform.archive.sha256}, got ${archiveHash}`,
      );
    }

    const entries = new Set(await listArchiveEntries(archivePath));
    for (const file of platform.files) {
      const archiveEntry = posix.join(platform.archive.root, file.source);
      if (!entries.has(archiveEntry)) {
        throw new Error(`Required archive entry is missing: ${archiveEntry}`);
      }
      const outputPath = payloadPath(staging, file.destination);
      await extractArchiveEntry(archivePath, archiveEntry, outputPath);
      if (file.executable && process.platform !== 'win32') await chmod(outputPath, 0o755);
    }

    await verifyPayload(staging, platform);
    await replaceDirectoryAtomically(staging, destination);
  } finally {
    if (await pathExists(staging)) await rm(staging, { recursive: true, force: true });
    if (!options.archivePath && (await pathExists(downloadedArchive))) {
      await rm(downloadedArchive, { force: true });
    }
  }
}

async function runCommand(path: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync(path, args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  return `${stdout}\n${stderr}`;
}

export async function smokeTestPayload(
  directory: string,
  version: string,
  platform: PlatformArchive,
): Promise<void> {
  const ffmpeg = payloadPath(directory, platform.commands.ffmpeg);
  const ffprobe = payloadPath(directory, platform.commands.ffprobe);
  const [versionOutput, buildConfig, encoders, probeVersion] = await Promise.all([
    runCommand(ffmpeg, ['-version']),
    runCommand(ffmpeg, ['-hide_banner', '-buildconf']),
    runCommand(ffmpeg, ['-hide_banner', '-encoders']),
    runCommand(ffprobe, ['-version']),
  ]);
  if (!versionOutput.includes(version) || !probeVersion.includes(version)) {
    throw new Error(`Bundled ffmpeg/ffprobe do not report required version ${version}`);
  }
  for (const flag of platform.forbiddenBuildFlags) {
    if (buildConfig.includes(flag))
      throw new Error(`Forbidden FFmpeg build flag detected: ${flag}`);
  }
  for (const encoder of platform.requiredEncoders) {
    if (!encoders.includes(encoder))
      throw new Error(`Required FFmpeg encoder is missing: ${encoder}`);
  }
}

export function currentPlatformKey(): PlatformKey {
  const key = `${process.platform}-${process.arch}`;
  if (!PLATFORM_KEYS.includes(key as PlatformKey)) {
    throw new Error(`Unsupported FFmpeg platform: ${key}`);
  }
  return key as PlatformKey;
}
