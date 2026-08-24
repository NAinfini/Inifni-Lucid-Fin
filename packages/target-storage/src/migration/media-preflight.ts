import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, open, readdir, type FileHandle } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { hashCanonical } from '../internal/hashes.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const LEGACY_STATIC_IMAGE_FORMATS = ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff'] as const;

export type LegacyStaticImageFormat = (typeof LEGACY_STATIC_IMAGE_FORMATS)[number];

const FORMATS = {
  image: new Set<string>(LEGACY_STATIC_IMAGE_FORMATS),
  video: new Set(['mp4', 'mov', 'webm']),
  audio: new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a']),
} as const;

type LegacyMediaType = keyof typeof FORMATS;

export type LegacyMediaPreflightBlocker =
  | {
      readonly kind: 'invalid_media_hash';
      readonly rowId: string;
      readonly hash: string;
      readonly reason: 'not_sha256' | 'uppercase_or_noncanonical';
    }
  | {
      readonly kind: 'invalid_media_type';
      readonly rowId: string;
      readonly hash: string;
      readonly actual: string;
    }
  | {
      readonly kind: 'invalid_media_format';
      readonly rowId: string;
      readonly hash: string;
      readonly type: LegacyMediaType;
      readonly actual: string;
    }
  | {
      readonly kind: 'invalid_media_size';
      readonly rowId: string;
      readonly hash: string;
      readonly reason: 'not_integer' | 'negative';
    }
  | {
      readonly kind: 'missing_media_bytes';
      readonly hash: string;
      readonly expectedRelativePath: string;
    }
  | {
      readonly kind: 'media_hash_mismatch';
      readonly hash: string;
      readonly relativePath: string;
      readonly actualHash: string;
    }
  | {
      readonly kind: 'media_size_mismatch';
      readonly hash: string;
      readonly relativePath: string;
      readonly expectedBytes: string;
      readonly actualBytes: string;
    }
  | {
      readonly kind: 'orphan_media_file';
      readonly relativePath: string;
      readonly actualHash: string;
      readonly actualBytes: string;
    }
  | {
      readonly kind: 'unreadable_media_file';
      readonly relativePath: string;
      readonly errorCode: string;
    }
  | {
      readonly kind: 'non_regular_media_entry';
      readonly relativePath: string;
      readonly entryKind: 'symlink' | 'other';
    };

export interface LegacyMediaPreflightReport {
  readonly database: Readonly<{
    assetCount: number;
    declaredBytes: string;
    nullOrZeroSizeCount: number;
  }>;
  readonly cas: Readonly<{
    mediaFileCount: number;
    mediaBytes: string;
    sidecarFileCount: number;
    sidecarBytes: string;
  }>;
  readonly verifiedAssetCount: number;
  readonly verifiedAssetHashes: readonly string[];
  readonly fingerprint: string;
  readonly blockers: readonly LegacyMediaPreflightBlocker[];
  readonly ok: boolean;
}

interface AssetContentRow {
  readonly source_rowid: bigint;
  readonly hash: unknown;
  readonly type: unknown;
  readonly format: unknown;
  readonly file_size: unknown;
}

interface ExpectedMediaFile {
  readonly rowId: string;
  readonly hash: string;
  readonly relativePath: string;
  readonly declaredBytes: bigint | null;
}

interface ScannedMediaFile {
  readonly relativePath: string;
  readonly actualHash: string;
  readonly actualBytes: bigint;
}

interface ScannedSidecar {
  readonly relativePath: string;
  readonly actualBytes: bigint;
}

interface CasScan {
  readonly files: readonly ScannedMediaFile[];
  readonly sidecars: readonly ScannedSidecar[];
  readonly unreadablePaths: ReadonlySet<string>;
  readonly blockers: readonly LegacyMediaPreflightBlocker[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portableRelativePath(rootPath: string, filePath: string): string {
  return relative(rootPath, filePath).split(sep).join('/');
}

function entryKind(entry: { isSymbolicLink(): boolean }): 'symlink' | 'other' {
  return entry.isSymbolicLink() ? 'symlink' : 'other';
}

function errorCode(cause: unknown): string {
  const code = (cause as NodeJS.ErrnoException).code;
  return typeof code === 'string' && code ? code : 'UNKNOWN';
}

async function inspectOpenFile(
  handle: FileHandle,
): Promise<{ actualHash: string; actualBytes: bigint }> {
  const info = await handle.stat({ bigint: true });
  if (!info.isFile()) throw new TypeError('Legacy CAS entry is not a regular file');
  const digest = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let actualBytes = 0n;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0) break;
    digest.update(buffer.subarray(0, bytesRead));
    actualBytes += BigInt(bytesRead);
  }
  return { actualHash: digest.digest('hex'), actualBytes };
}

async function inspectFile(filePath: string) {
  const handle = await open(filePath, 'r');
  try {
    return await inspectOpenFile(handle);
  } finally {
    await handle.close();
  }
}

async function scanLegacyCas(rootPath: string): Promise<CasScan> {
  const files: ScannedMediaFile[] = [];
  const sidecars: ScannedSidecar[] = [];
  const unreadablePaths = new Set<string>();
  const blockers: LegacyMediaPreflightBlocker[] = [];

  let rootInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    rootInfo = await lstat(rootPath);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { files, sidecars, unreadablePaths, blockers };
    }
    unreadablePaths.add('.');
    blockers.push({
      kind: 'unreadable_media_file',
      relativePath: '.',
      errorCode: errorCode(cause),
    });
    return { files, sidecars, unreadablePaths, blockers };
  }
  if (!rootInfo.isDirectory()) {
    blockers.push({
      kind: 'non_regular_media_entry',
      relativePath: '.',
      entryKind: rootInfo.isSymbolicLink() ? 'symlink' : 'other',
    });
    return { files, sidecars, unreadablePaths, blockers };
  }

  async function visit(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      const relativePath = portableRelativePath(rootPath, directory) || '.';
      unreadablePaths.add(relativePath);
      blockers.push({
        kind: 'unreadable_media_file',
        relativePath,
        errorCode: errorCode(cause),
      });
      return;
    }
    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const filePath = join(directory, entry.name);
      const relativePath = portableRelativePath(rootPath, filePath);
      if (entry.isDirectory()) {
        await visit(filePath);
        continue;
      }
      if (!entry.isFile()) {
        blockers.push({
          kind: 'non_regular_media_entry',
          relativePath,
          entryKind: entryKind(entry),
        });
        continue;
      }
      try {
        const inspected = await inspectFile(filePath);
        if (entry.name.endsWith('.meta.json')) {
          sidecars.push({ relativePath, actualBytes: inspected.actualBytes });
        } else {
          files.push({ relativePath, ...inspected });
        }
      } catch (cause) {
        unreadablePaths.add(relativePath);
        blockers.push({
          kind: 'unreadable_media_file',
          relativePath,
          errorCode: errorCode(cause),
        });
      }
    }
  }

  await visit(rootPath);
  files.sort((left, right) => compareText(left.relativePath, right.relativePath));
  sidecars.sort((left, right) => compareText(left.relativePath, right.relativePath));
  return { files, sidecars, unreadablePaths, blockers };
}

function stringColumn(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function mediaType(value: string): value is LegacyMediaType {
  return Object.hasOwn(FORMATS, value);
}

function expectedMediaFiles(
  database: DatabaseSync,
  blockers: LegacyMediaPreflightBlocker[],
): {
  readonly files: readonly ExpectedMediaFile[];
  readonly assetCount: number;
  readonly declaredBytes: bigint;
  readonly nullOrZeroSizeCount: number;
} {
  const statement = database.prepare(
    'SELECT rowid AS source_rowid, hash, type, format, file_size FROM asset_contents ORDER BY hash, rowid',
  );
  statement.setReadBigInts(true);
  const files: ExpectedMediaFile[] = [];
  let assetCount = 0;
  let declaredBytes = 0n;
  let nullOrZeroSizeCount = 0;

  for (const row of statement.iterate() as Iterable<AssetContentRow>) {
    assetCount += 1;
    const rowId = row.source_rowid.toString();
    const hash = stringColumn(row.hash) ?? '';
    if (!SHA256_PATTERN.test(hash)) {
      blockers.push({
        kind: 'invalid_media_hash',
        rowId,
        hash,
        reason:
          /^[A-Fa-f0-9]{64}$/.test(hash) && hash !== hash.toLowerCase()
            ? 'uppercase_or_noncanonical'
            : 'not_sha256',
      });
      continue;
    }
    const type = stringColumn(row.type) ?? '';
    if (!mediaType(type)) {
      blockers.push({ kind: 'invalid_media_type', rowId, hash, actual: type });
      continue;
    }
    const format = stringColumn(row.format) ?? '';
    if (!FORMATS[type].has(format)) {
      blockers.push({ kind: 'invalid_media_format', rowId, hash, type, actual: format });
      continue;
    }

    let expectedBytes: bigint | null = null;
    if (row.file_size === null || row.file_size === 0n) {
      nullOrZeroSizeCount += 1;
    } else if (typeof row.file_size !== 'bigint') {
      blockers.push({ kind: 'invalid_media_size', rowId, hash, reason: 'not_integer' });
    } else if (row.file_size < 0n) {
      blockers.push({ kind: 'invalid_media_size', rowId, hash, reason: 'negative' });
    } else {
      expectedBytes = row.file_size;
      declaredBytes += row.file_size;
    }

    files.push({
      rowId,
      hash,
      relativePath: `${type}/${hash.slice(0, 2)}/${hash}.${format}`,
      declaredBytes: expectedBytes,
    });
  }

  return { files, assetCount, declaredBytes, nullOrZeroSizeCount };
}

/**
 * Read-only verification of the one production Legacy CAS root. The caller
 * first validates the Legacy database schema and owns its read-only handle.
 */
export async function preflightLegacyMedia(
  database: DatabaseSync,
  assetsRootInput: string,
): Promise<LegacyMediaPreflightReport> {
  const blockers: LegacyMediaPreflightBlocker[] = [];
  const expected = expectedMediaFiles(database, blockers);
  const cas = await scanLegacyCas(resolve(assetsRootInput));
  blockers.push(...cas.blockers);
  const actualByPath = new Map(cas.files.map((file) => [file.relativePath, file]));
  const expectedPaths = new Set(expected.files.map((file) => file.relativePath));
  let verifiedAssetCount = 0;
  const verifiedAssetHashes: string[] = [];

  for (const file of expected.files) {
    const actual = actualByPath.get(file.relativePath);
    if (!actual) {
      if (!cas.unreadablePaths.has(file.relativePath)) {
        blockers.push({
          kind: 'missing_media_bytes',
          hash: file.hash,
          expectedRelativePath: file.relativePath,
        });
      }
      continue;
    }
    let verified = true;
    if (actual.actualHash !== file.hash) {
      verified = false;
      blockers.push({
        kind: 'media_hash_mismatch',
        hash: file.hash,
        relativePath: file.relativePath,
        actualHash: actual.actualHash,
      });
    }
    if (file.declaredBytes !== null && actual.actualBytes !== file.declaredBytes) {
      verified = false;
      blockers.push({
        kind: 'media_size_mismatch',
        hash: file.hash,
        relativePath: file.relativePath,
        expectedBytes: file.declaredBytes.toString(),
        actualBytes: actual.actualBytes.toString(),
      });
    }
    if (verified) {
      verifiedAssetCount += 1;
      verifiedAssetHashes.push(file.hash);
    }
  }

  for (const file of cas.files) {
    if (!expectedPaths.has(file.relativePath)) {
      blockers.push({
        kind: 'orphan_media_file',
        relativePath: file.relativePath,
        actualHash: file.actualHash,
        actualBytes: file.actualBytes.toString(),
      });
    }
  }

  const mediaBytes = cas.files.reduce((total, file) => total + file.actualBytes, 0n);
  const sidecarBytes = cas.sidecars.reduce((total, file) => total + file.actualBytes, 0n);
  const fingerprint = hashCanonical({
    expected: expected.files.map(({ rowId, hash, relativePath, declaredBytes }) => ({
      rowId,
      hash,
      relativePath,
      declaredBytes: declaredBytes?.toString() ?? null,
    })),
    files: cas.files.map(({ relativePath, actualHash, actualBytes }) => ({
      relativePath,
      actualHash,
      actualBytes: actualBytes.toString(),
    })),
    sidecars: cas.sidecars.map(({ relativePath, actualBytes }) => ({
      relativePath,
      actualBytes: actualBytes.toString(),
    })),
    blockers,
  });

  return {
    database: {
      assetCount: expected.assetCount,
      declaredBytes: expected.declaredBytes.toString(),
      nullOrZeroSizeCount: expected.nullOrZeroSizeCount,
    },
    cas: {
      mediaFileCount: cas.files.length,
      mediaBytes: mediaBytes.toString(),
      sidecarFileCount: cas.sidecars.length,
      sidecarBytes: sidecarBytes.toString(),
    },
    verifiedAssetCount,
    verifiedAssetHashes,
    fingerprint,
    blockers,
    ok: blockers.length === 0,
  };
}
