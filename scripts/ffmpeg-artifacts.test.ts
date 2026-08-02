import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PLATFORM_KEYS,
  assertSafeArchiveEntries,
  computeSha256,
  installArchivePlatform,
  loadManifest,
  validateManifest,
  verifyPayload,
  type FfmpegManifest,
  type PlatformArchive,
} from './ffmpeg-artifacts.js';
import {
  createDarwinArchiveFragment,
  mergeDarwinArchiveFragments,
  type DarwinArchiveFragment,
  type DarwinPlatformKey,
} from './finalize-ffmpeg-macos-artifacts.js';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function archivePlatform(overrides: Partial<PlatformArchive> = {}): PlatformArchive {
  return {
    kind: 'archive',
    buildVersion: 'n8.1.2-34-g9b6c8969e0',
    archive: {
      url: 'https://github.com/example/releases/download/ffmpeg-8.1.2/file.zip',
      sha256: 'a'.repeat(64),
      root: 'ffmpeg-8.1.2',
    },
    commands: {
      ffmpeg: 'bin/ffmpeg.exe',
      ffprobe: 'bin/ffprobe.exe',
    },
    requiredEncoders: ['libopenh264', 'libkvazaar'],
    forbiddenBuildFlags: ['--enable-gpl', '--enable-nonfree'],
    files: [
      {
        source: 'bin/ffmpeg.exe',
        destination: 'bin/ffmpeg.exe',
        sha256: 'b'.repeat(64),
        size: 2,
        executable: true,
      },
      {
        source: 'bin/ffprobe.exe',
        destination: 'bin/ffprobe.exe',
        sha256: 'c'.repeat(64),
        size: 2,
        executable: true,
      },
    ],
    ...overrides,
  };
}

function validManifest(): FfmpegManifest {
  const buildRequired = {
    kind: 'source-build' as const,
    builder: 'scripts/build-ffmpeg-macos-lgpl.sh',
    source: {
      url: 'https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz',
      sha256: 'd'.repeat(64),
    },
    commands: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe' },
  };

  return {
    schemaVersion: 2,
    version: '8.1.2',
    license: 'LGPL-3.0-or-later',
    sourceCode: {
      url: 'https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz',
      sha256: 'd'.repeat(64),
    },
    platforms: {
      'win32-x64': archivePlatform(),
      'win32-arm64': archivePlatform(),
      'linux-x64': archivePlatform({
        commands: { ffmpeg: 'bin/ffmpeg', ffprobe: 'bin/ffprobe' },
        files: [
          {
            source: 'bin/ffmpeg',
            destination: 'bin/ffmpeg',
            sha256: 'b'.repeat(64),
            size: 2,
            executable: true,
          },
          {
            source: 'bin/ffprobe',
            destination: 'bin/ffprobe',
            sha256: 'c'.repeat(64),
            size: 2,
            executable: true,
          },
        ],
      }),
      'darwin-x64': buildRequired,
      'darwin-arm64': buildRequired,
    },
  };
}

describe('assertSafeArchiveEntries', () => {
  it('accepts normalized relative archive entries', () => {
    expect(() =>
      assertSafeArchiveEntries(['ffmpeg-8.1.2/', 'ffmpeg-8.1.2/bin/ffmpeg']),
    ).not.toThrow();
  });

  it.each([
    ['../escape'],
    ['/absolute/path'],
    ['C:/absolute/path'],
    ['root/../../escape'],
    ['root\\..\\escape'],
  ])('rejects unsafe archive path %s', (entry) => {
    expect(() => assertSafeArchiveEntries([entry])).toThrow(/unsafe archive path/i);
  });

  it('rejects duplicate archive entries', () => {
    expect(() => assertSafeArchiveEntries(['root/bin/ffmpeg', 'root/bin/ffmpeg'])).toThrow(
      /duplicate archive entry/i,
    );
  });
});

describe('validateManifest', () => {
  it('accepts a complete five-platform manifest', () => {
    expect(validateManifest(validManifest()).version).toBe('8.1.2');
  });

  it('rejects placeholder checksums', () => {
    const manifest = validManifest();
    const platform = manifest.platforms['win32-x64'];
    if (platform.kind !== 'archive') throw new Error('test fixture must be an archive');
    platform.archive.sha256 = 'PLACEHOLDER_HASH_UPDATE_AFTER_DOWNLOAD';

    expect(() => validateManifest(manifest)).toThrow(/sha-256/i);
  });

  it('rejects floating release URLs', () => {
    const manifest = validManifest();
    const platform = manifest.platforms['win32-x64'];
    if (platform.kind !== 'archive') throw new Error('test fixture must be an archive');
    platform.archive.url = 'https://github.com/example/releases/latest/download/file.zip';

    expect(() => validateManifest(manifest)).toThrow(/immutable/i);
  });

  it('rejects a platform archive that omits ffprobe', () => {
    const manifest = validManifest();
    const platform = manifest.platforms['win32-x64'];
    if (platform.kind !== 'archive') throw new Error('test fixture must be an archive');
    platform.files = platform.files.filter((file) => file.destination !== 'bin/ffprobe.exe');

    expect(() => validateManifest(manifest)).toThrow(/ffprobe/i);
  });
});

describe('verifyPayload', () => {
  it('rejects a missing required binary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-payload-test-'));
    temporaryDirectories.push(directory);
    const platform = archivePlatform();

    await expect(verifyPayload(directory, platform)).rejects.toThrow(/missing payload file/i);
  });

  it('rejects a payload file with the wrong SHA-256', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-payload-test-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'bin'), { recursive: true });
    await writeFile(join(directory, 'bin', 'ffmpeg.exe'), 'no');
    await writeFile(join(directory, 'bin', 'ffprobe.exe'), 'no');
    const platform = archivePlatform({
      files: [
        {
          source: 'bin/ffmpeg.exe',
          destination: 'bin/ffmpeg.exe',
          sha256: sha256('ok'),
          size: 2,
          executable: true,
        },
        {
          source: 'bin/ffprobe.exe',
          destination: 'bin/ffprobe.exe',
          sha256: sha256('ok'),
          size: 2,
          executable: true,
        },
      ],
    });

    await expect(verifyPayload(directory, platform)).rejects.toThrow(/checksum mismatch/i);
  });

  it('accepts files whose size and checksum match the manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-payload-test-'));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, 'bin'), { recursive: true });
    await writeFile(join(directory, 'bin', 'ffmpeg.exe'), 'ok');
    await writeFile(join(directory, 'bin', 'ffprobe.exe'), 'ok');
    const platform = archivePlatform({
      files: [
        {
          source: 'bin/ffmpeg.exe',
          destination: 'bin/ffmpeg.exe',
          sha256: sha256('ok'),
          size: 2,
          executable: true,
        },
        {
          source: 'bin/ffprobe.exe',
          destination: 'bin/ffprobe.exe',
          sha256: sha256('ok'),
          size: 2,
          executable: true,
        },
      ],
    });

    await expect(verifyPayload(directory, platform)).resolves.toBeUndefined();
  });
});

describe('installArchivePlatform', () => {
  it('extracts only the declared payload and atomically replaces stale output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ffmpeg-install-test-'));
    temporaryDirectories.push(directory);
    const archiveSource = join(directory, 'archive-source');
    const archiveRoot = join(archiveSource, 'ffmpeg-8.1.2');
    await mkdir(join(archiveRoot, 'bin'), { recursive: true });
    await writeFile(join(archiveRoot, 'bin', 'ffmpeg.exe'), 'ok');
    await writeFile(join(archiveRoot, 'bin', 'ffprobe.exe'), 'ok');

    const archivePath = join(directory, 'payload.tar');
    await execFileAsync('tar', ['-cf', archivePath, '-C', archiveSource, 'ffmpeg-8.1.2']);

    const platform = archivePlatform({
      archive: {
        url: 'https://github.com/example/releases/download/ffmpeg-8.1.2/payload.tar',
        sha256: await computeSha256(archivePath),
        root: 'ffmpeg-8.1.2',
      },
      files: [
        {
          source: 'bin/ffmpeg.exe',
          destination: 'bin/ffmpeg.exe',
          sha256: sha256('ok'),
          size: 2,
          executable: true,
        },
        {
          source: 'bin/ffprobe.exe',
          destination: 'bin/ffprobe.exe',
          sha256: sha256('ok'),
          size: 2,
          executable: true,
        },
      ],
    });
    const destination = join(directory, 'installed');
    await mkdir(destination);
    await writeFile(join(destination, 'stale.txt'), 'stale');

    await installArchivePlatform(platform, destination, { archivePath });

    await expect(readFile(join(destination, 'bin', 'ffmpeg.exe'), 'utf8')).resolves.toBe('ok');
    await expect(readFile(join(destination, 'bin', 'ffprobe.exe'), 'utf8')).resolves.toBe('ok');
    await expect(readFile(join(destination, 'stale.txt'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});

describe('repository manifest', () => {
  it('contains real immutable metadata for all five supported platforms', async () => {
    const manifest = await loadManifest(
      join(import.meta.dirname, '..', 'packages', 'media-engine', 'ffmpeg-checksums.json'),
    );

    expect(manifest.version).toBe('8.1.2');
    expect(Object.keys(manifest.platforms).sort()).toEqual([...PLATFORM_KEYS].sort());
    expect(manifest.platforms['win32-x64']).toMatchObject({ kind: 'archive' });
    expect(manifest.platforms['win32-arm64']).toMatchObject({ kind: 'archive' });
    expect(manifest.platforms['linux-x64']).toMatchObject({ kind: 'archive' });
    expect(manifest.platforms['darwin-x64']).toMatchObject({ kind: 'source-build' });
    expect(manifest.platforms['darwin-arm64']).toMatchObject({ kind: 'source-build' });
  });
});

async function createDarwinFixture(platformKey: DarwinPlatformKey): Promise<{
  archivePath: string;
  payloadDirectory: string;
  fragment: DarwinArchiveFragment;
}> {
  const directory = await mkdtemp(join(tmpdir(), `ffmpeg-${platformKey}-finalize-test-`));
  temporaryDirectories.push(directory);
  const payloadDirectory = join(directory, platformKey);
  await Promise.all([
    mkdir(join(payloadDirectory, 'bin'), { recursive: true }),
    mkdir(join(payloadDirectory, 'licenses'), { recursive: true }),
    mkdir(join(payloadDirectory, 'provenance'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(payloadDirectory, 'bin', 'ffmpeg'), 'ffmpeg-binary'),
    writeFile(join(payloadDirectory, 'bin', 'ffprobe'), 'ffprobe-binary'),
    writeFile(join(payloadDirectory, 'licenses', 'ffmpeg-LGPLv3.txt'), 'LGPLv3'),
    writeFile(
      join(payloadDirectory, 'provenance', 'ffmpeg-buildconf.txt'),
      'configuration: --disable-gpl --disable-nonfree --enable-videotoolbox',
    ),
    writeFile(join(payloadDirectory, 'SHA256SUMS'), 'payload checksums'),
  ]);
  const archivePath = join(directory, `ffmpeg-${platformKey}-8.1.2-lgpl.tar.gz`);
  await writeFile(archivePath, `immutable archive for ${platformKey}`);
  const fragment = await createDarwinArchiveFragment({
    platformKey,
    payloadDirectory,
    archivePath,
    archiveUrl: `https://github.com/example/project/releases/download/ffmpeg-8.1.2-lgpl-v1/ffmpeg-${platformKey}-8.1.2-lgpl.tar.gz`,
  });
  return { archivePath, payloadDirectory, fragment };
}

describe('macOS immutable artifact finalization', () => {
  it('records real archive and per-file SHA-256 values', async () => {
    const { archivePath, fragment } = await createDarwinFixture('darwin-arm64');

    expect(fragment.platform.archive.sha256).toBe(await computeSha256(archivePath));
    expect(fragment.platform.files.map((file) => file.destination)).toHaveLength(5);
    expect(fragment.platform.files.map((file) => file.destination)).toEqual(
      expect.arrayContaining([
        'bin/ffmpeg',
        'bin/ffprobe',
        'licenses/ffmpeg-LGPLv3.txt',
        'provenance/ffmpeg-buildconf.txt',
        'SHA256SUMS',
      ]),
    );
    expect(fragment.platform.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  });

  it('rejects a payload whose native build enabled GPL', async () => {
    const { archivePath, payloadDirectory } = await createDarwinFixture('darwin-x64');
    await writeFile(
      join(payloadDirectory, 'provenance', 'ffmpeg-buildconf.txt'),
      'configuration: --enable-gpl --disable-nonfree',
    );

    await expect(
      createDarwinArchiveFragment({
        platformKey: 'darwin-x64',
        payloadDirectory,
        archivePath,
        archiveUrl:
          'https://github.com/example/project/releases/download/ffmpeg-8.1.2-lgpl-v1/ffmpeg-darwin-x64-8.1.2-lgpl.tar.gz',
      }),
    ).rejects.toThrow(/forbidden GPL\/nonfree/i);
  });

  it('merges both native artifacts into a complete validated manifest', async () => {
    const [x64, arm64] = await Promise.all([
      createDarwinFixture('darwin-x64'),
      createDarwinFixture('darwin-arm64'),
    ]);

    const merged = mergeDarwinArchiveFragments(validManifest(), [x64.fragment, arm64.fragment]);

    expect(merged.platforms['darwin-x64']).toMatchObject({ kind: 'archive' });
    expect(merged.platforms['darwin-arm64']).toMatchObject({ kind: 'archive' });
  });
});
