import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { preflightLegacyMedia } from './media-preflight.js';

const MEDIA_BYTES = Buffer.from('legacy-media');
const MEDIA_HASH = createHash('sha256').update(MEDIA_BYTES).digest('hex');
const MEDIA_RELATIVE_PATH = `image/${MEDIA_HASH.slice(0, 2)}/${MEDIA_HASH}.png`;
const temporaryDirectories: string[] = [];

interface MediaFixture {
  readonly directory: string;
  readonly databasePath: string;
  readonly assetsRoot: string;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<MediaFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-media-preflight-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const assetsRoot = join(directory, 'assets');
  await mkdir(assetsRoot);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (
        hash TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        format TEXT NOT NULL,
        file_size INTEGER
      );
    `);
  } finally {
    database.close();
  }
  return { directory, databasePath, assetsRoot };
}

function insertAsset(
  source: MediaFixture,
  asset: {
    readonly hash: string;
    readonly type: string;
    readonly format: string;
    readonly fileSize: number | null;
  },
): void {
  const database = new DatabaseSync(source.databasePath);
  try {
    database
      .prepare('INSERT INTO asset_contents (hash, type, format, file_size) VALUES (?, ?, ?, ?)')
      .run(asset.hash, asset.type, asset.format, asset.fileSize);
  } finally {
    database.close();
  }
}

async function writeAsset(
  source: MediaFixture,
  hash: string,
  type: string,
  format: string,
  bytes: Uint8Array,
): Promise<string> {
  const directory = join(source.assetsRoot, type, hash.slice(0, 2));
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${hash}.${format}`);
  await writeFile(path, bytes);
  return path;
}

async function report(source: MediaFixture) {
  const database = new DatabaseSync(source.databasePath, { readOnly: true });
  try {
    return await preflightLegacyMedia(database, source.assetsRoot);
  } finally {
    database.close();
  }
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy media preflight', () => {
  it('verifies the exact CAS path, bytes, sidecar accounting, determinism, and no mutation', async () => {
    const source = await fixture();
    insertAsset(source, {
      hash: MEDIA_HASH,
      type: 'image',
      format: 'png',
      fileSize: MEDIA_BYTES.byteLength,
    });
    const mediaPath = await writeAsset(source, MEDIA_HASH, 'image', 'png', MEDIA_BYTES);
    const sidecarPath = join(
      source.assetsRoot,
      'image',
      MEDIA_HASH.slice(0, 2),
      `${MEDIA_HASH}.meta.json`,
    );
    await writeFile(sidecarPath, '{}');
    const before = {
      database: await fileFingerprint(source.databasePath),
      media: await fileFingerprint(mediaPath),
      sidecar: await fileFingerprint(sidecarPath),
    };

    const first = await report(source);
    const second = await report(source);

    expect(first).toMatchObject({
      database: {
        assetCount: 1,
        declaredBytes: MEDIA_BYTES.byteLength.toString(),
        nullOrZeroSizeCount: 0,
      },
      cas: {
        mediaFileCount: 1,
        mediaBytes: MEDIA_BYTES.byteLength.toString(),
        sidecarFileCount: 1,
        sidecarBytes: '2',
      },
      verifiedAssetCount: 1,
      verifiedAssetHashes: [MEDIA_HASH],
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect({
      database: await fileFingerprint(source.databasePath),
      media: await fileFingerprint(mediaPath),
      sidecar: await fileFingerprint(sidecarPath),
    }).toEqual(before);
  });

  it('blocks a database asset whose expected bytes are missing', async () => {
    const source = await fixture();
    insertAsset(source, {
      hash: MEDIA_HASH,
      type: 'image',
      format: 'png',
      fileSize: MEDIA_BYTES.byteLength,
    });
    const before = await fileFingerprint(source.databasePath);

    const result = await report(source);

    expect(result.blockers).toEqual([
      {
        kind: 'missing_media_bytes',
        hash: MEDIA_HASH,
        expectedRelativePath: MEDIA_RELATIVE_PATH,
      },
    ]);
    expect(result.ok).toBe(false);
    expect(await fileFingerprint(source.databasePath)).toBe(before);
  });

  it('blocks both content-hash and declared-size mismatches without changing the file', async () => {
    const source = await fixture();
    insertAsset(source, {
      hash: MEDIA_HASH,
      type: 'image',
      format: 'png',
      fileSize: MEDIA_BYTES.byteLength,
    });
    const tampered = Buffer.from('tampered-media-bytes');
    const mediaPath = await writeAsset(source, MEDIA_HASH, 'image', 'png', tampered);
    const before = await fileFingerprint(mediaPath);

    const result = await report(source);

    expect(result.blockers).toEqual([
      {
        kind: 'media_hash_mismatch',
        hash: MEDIA_HASH,
        relativePath: MEDIA_RELATIVE_PATH,
        actualHash: createHash('sha256').update(tampered).digest('hex'),
      },
      {
        kind: 'media_size_mismatch',
        hash: MEDIA_HASH,
        relativePath: MEDIA_RELATIVE_PATH,
        expectedBytes: MEDIA_BYTES.byteLength.toString(),
        actualBytes: tampered.byteLength.toString(),
      },
    ]);
    expect(result.ok).toBe(false);
    expect(await fileFingerprint(mediaPath)).toBe(before);
  });

  it('reports invalid identities, locations, sizes, and orphan files deterministically', async () => {
    const source = await fixture();
    const uppercaseHash = MEDIA_HASH.toUpperCase();
    const invalidTypeHash = createHash('sha256').update('invalid-type').digest('hex');
    const invalidFormatHash = createHash('sha256').update('invalid-format').digest('hex');
    const invalidSizeBytes = Buffer.from('invalid-size');
    const invalidSizeHash = createHash('sha256').update(invalidSizeBytes).digest('hex');
    insertAsset(source, {
      hash: uppercaseHash,
      type: 'image',
      format: 'png',
      fileSize: 1,
    });
    insertAsset(source, {
      hash: invalidTypeHash,
      type: 'document',
      format: 'pdf',
      fileSize: 1,
    });
    insertAsset(source, {
      hash: invalidFormatHash,
      type: 'image',
      format: 'exe',
      fileSize: 1,
    });
    insertAsset(source, {
      hash: invalidSizeHash,
      type: 'image',
      format: 'png',
      fileSize: 1.5,
    });
    await writeAsset(source, invalidSizeHash, 'image', 'png', invalidSizeBytes);
    const orphanBytes = Buffer.from('orphan-media');
    const orphanNameHash = createHash('sha256').update('orphan-name').digest('hex');
    const orphanPath = await writeAsset(source, orphanNameHash, 'image', 'png', orphanBytes);

    const first = await report(source);
    const second = await report(source);

    expect(first.blockers).toHaveLength(5);
    expect(first.blockers).toEqual(
      expect.arrayContaining([
        {
          kind: 'invalid_media_hash',
          rowId: '1',
          hash: uppercaseHash,
          reason: 'uppercase_or_noncanonical',
        },
        {
          kind: 'invalid_media_type',
          rowId: '2',
          hash: invalidTypeHash,
          actual: 'document',
        },
        {
          kind: 'invalid_media_format',
          rowId: '3',
          hash: invalidFormatHash,
          type: 'image',
          actual: 'exe',
        },
        {
          kind: 'invalid_media_size',
          rowId: '4',
          hash: invalidSizeHash,
          reason: 'not_integer',
        },
        {
          kind: 'orphan_media_file',
          relativePath: `image/${orphanNameHash.slice(0, 2)}/${orphanNameHash}.png`,
          actualHash: createHash('sha256').update(orphanBytes).digest('hex'),
          actualBytes: orphanBytes.byteLength.toString(),
        },
      ]),
    );
    expect(first).toEqual(second);
    expect(await fileFingerprint(orphanPath)).toBe(
      createHash('sha256').update(orphanBytes).digest('hex'),
    );
  });
});
