import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from '../../../storage/src/schema-sql.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import {
  listGlobalMediaFolders,
  loadGlobalMediaAsset,
  loadMediaBlob,
} from '../internal/media-records.js';
import { createFilesystemMediaCas } from '../internal/filesystem-media-cas.js';
import { openTargetStore } from '../kernel/store.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import { preflightLegacyInputs, type LegacyPreflightPaths } from './legacy-preflight.js';
import { buildLegacyMigrationReadinessReport } from './migration-readiness.js';
import { classifyLegacyPhaseOne } from './phase-one-classification.js';
import { rehearseRepresentativeLegacyImageCatalog } from './representative-image-catalog-rehearsal.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function jpg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(17);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  bytes.writeUInt16BE(11, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  bytes.set([1, 1, 0x11, 0, 0xff, 0xd9], 11);
  return bytes;
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(26);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8L', 12, 'ascii');
  bytes.writeUInt32LE(5, 16);
  bytes[20] = 0x2f;
  bytes.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return bytes;
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(10);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(width, 6);
  bytes.writeUInt16LE(height, 8);
  return bytes;
}

function bmp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(54);
  bytes.write('BM', 0, 'ascii');
  bytes.writeUInt32LE(bytes.byteLength, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  return bytes;
}

function tiff(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(38);
  bytes.write('II', 0, 'ascii');
  bytes.writeUInt16LE(42, 2);
  bytes.writeUInt32LE(8, 4);
  bytes.writeUInt16LE(2, 8);
  bytes.writeUInt16LE(256, 10);
  bytes.writeUInt16LE(4, 12);
  bytes.writeUInt32LE(1, 14);
  bytes.writeUInt32LE(width, 18);
  bytes.writeUInt16LE(257, 22);
  bytes.writeUInt16LE(4, 24);
  bytes.writeUInt32LE(1, 26);
  bytes.writeUInt32LE(height, 30);
  return bytes;
}

interface FixtureMediaInput {
  readonly type: string;
  readonly format: string;
  readonly bytes: Buffer;
  readonly width?: number;
  readonly height?: number;
}

const STATIC_IMAGE_MEDIA: readonly FixtureMediaInput[] = [
  { type: 'image', format: 'png', bytes: PNG_BYTES, width: 1, height: 1 },
  { type: 'image', format: 'jpg', bytes: jpg(3, 2), width: 3, height: 2 },
  { type: 'image', format: 'webp', bytes: webp(5, 4), width: 5, height: 4 },
  { type: 'image', format: 'gif', bytes: gif(7, 6), width: 7, height: 6 },
  { type: 'image', format: 'bmp', bytes: bmp(9, 8), width: 9, height: 8 },
  { type: 'image', format: 'tiff', bytes: tiff(11, 10), width: 11, height: 10 },
];
const STATIC_IMAGE_MIME_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
} as const;

const CREATED_AT = 1_700_000_000_000;
const UPDATED_AT = CREATED_AT + 1_000;
const temporaryDirectories: string[] = [];

interface Fixture extends LegacyPreflightPaths {
  readonly directory: string;
  readonly hash: string;
  readonly sourceMediaPath: string;
  readonly media: readonly Readonly<{
    hash: string;
    sourceMediaPath: string;
    input: FixtureMediaInput;
    assetId: string;
  }>[];
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  mediaInput: FixtureMediaInput | readonly FixtureMediaInput[] = {
    type: 'image',
    format: 'png',
    bytes: PNG_BYTES,
  },
): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-representative-catalog-'));
  temporaryDirectories.push(directory);
  const mainDatabasePath = join(directory, 'lucid-fin.db');
  const promptsDatabasePath = join(directory, 'prompts.db');
  const assetsRoot = join(directory, 'assets');
  const mediaItems = Array.isArray(mediaInput) ? mediaInput : [mediaInput];
  const assetIds = [
    'asset.one',
    'asset.two',
    'asset.three',
    'asset.four',
    'asset.five',
    'asset.six',
  ];
  const media: Array<Fixture['media'][number]> = [];
  for (const [index, input] of mediaItems.entries()) {
    const hash = createHash('sha256').update(input.bytes).digest('hex');
    const sourceMediaDirectory = join(assetsRoot, input.type, hash.slice(0, 2));
    const sourceMediaPath = join(sourceMediaDirectory, `${hash}.${input.format}`);
    await mkdir(sourceMediaDirectory, { recursive: true });
    await writeFile(sourceMediaPath, input.bytes);
    const assetId = assetIds[index];
    if (!assetId) throw new Error('Fixture supports at most six media records');
    media.push({ hash, sourceMediaPath, input, assetId });
  }

  const main = new DatabaseSync(mainDatabasePath);
  try {
    main.exec(SCHEMA_SQL);
    const insertContent = main.prepare(
      `INSERT INTO asset_contents (
         hash, type, format, prompt, provider, created_at, file_size,
         width, height, duration, has_audio, generation_metadata
       ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, 0, NULL)`,
    );
    for (const item of media) {
      insertContent.run(
        item.hash,
        item.input.type,
        item.input.format,
        CREATED_AT,
        item.input.bytes.byteLength,
        item.input.width ?? 1,
        item.input.height ?? 1,
      );
    }
    main
      .prepare(
        `INSERT INTO asset_folders (id, parent_id, name, sort_order, created_at, updated_at)
         VALUES ('folder.root', NULL, 'Private Root', 0, ?, ?),
                ('folder.child', 'folder.root', 'Private Child', 1, ?, ?)`,
      )
      .run(CREATED_AT, UPDATED_AT, CREATED_AT, UPDATED_AT);
    const insertEntry = main.prepare(
      `INSERT INTO asset_entries (id, asset_hash, display_name, tags, folder_id, created_at)
       VALUES (?, ?, ?, ?, 'folder.child', ?)`,
    );
    for (const [index, item] of media.entries()) {
      insertEntry.run(
        item.assetId,
        item.hash,
        index === 0 ? 'Private Frame' : `Private ${item.input.format.toUpperCase()} Frame`,
        JSON.stringify(index === 0 ? ['hero', 'reference'] : ['hero', item.input.format]),
        CREATED_AT,
      );
    }
  } finally {
    main.close();
  }

  const prompts = new DatabaseSync(promptsDatabasePath);
  try {
    prompts.exec(`
      CREATE TABLE process_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        default_value TEXT NOT NULL,
        custom_value TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE t_prompt_overrides (
        code TEXT PRIMARY KEY,
        customValue TEXT NOT NULL
      );
    `);
  } finally {
    prompts.close();
  }

  return {
    directory,
    mainDatabasePath,
    promptsDatabasePath,
    assetsRoot,
    hash: media[0]!.hash,
    sourceMediaPath: media[0]!.sourceMediaPath,
    media,
  };
}

async function evidence(source: Fixture) {
  const preflight = await preflightLegacyInputs(source);
  if (preflight.media.status !== 'checked') throw new Error('Fixture media preflight did not run');
  const main = new DatabaseSync(source.mainDatabasePath, { readOnly: true });
  const prompts = new DatabaseSync(source.promptsDatabasePath, { readOnly: true });
  try {
    const phaseOne = classifyLegacyPhaseOne(
      { main, prompts },
      I0_LEGACY_SOURCE_SCHEMAS,
      preflight.media.report,
    );
    return {
      preflight,
      phaseOne,
      readiness: buildLegacyMigrationReadinessReport({ preflight, phaseOne }),
    };
  } finally {
    prompts.close();
    main.close();
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('representative Legacy static image catalog rehearsal', () => {
  it('copies verified bytes and reconciles Blob, Folder, and Asset after reopen', async () => {
    const source = await fixture();
    const sourceDatabaseBefore = await readFile(source.mainDatabasePath);
    const sourceMediaBefore = await readFile(source.sourceMediaPath);
    const { phaseOne, readiness } = await evidence(source);
    const targetRootPath = join(source.directory, 'target-one');

    const report = await rehearseRepresentativeLegacyImageCatalog({
      paths: source,
      readiness,
      targetRootPath,
    });

    expect(report).toMatchObject({
      schema: 'lucid-fin.legacy-representative-image-catalog-rehearsal/v1',
      source: {
        readinessFingerprint: readiness.fingerprint,
        contentFingerprint: readiness.source.contentFingerprint,
      },
      coverage: {
        classifiedSubjects: readiness.counts.classifiedSubjectCount,
        mappedSubjects: 7,
        offlineSubjects: 1,
        complete: true,
      },
      target: {
        counts: { mediaBlobs: 1, globalMediaFolders: 2, globalMediaAssets: 1 },
        offlineExport: { entryCount: 1, payloadCount: 1 },
        reopenVerified: true,
      },
      ok: true,
    });
    expect(report.mappings).toHaveLength(
      phaseOne.rootRows.classification.entries.filter(({ targetRefs }) => targetRefs.length > 0)
        .length + phaseOne.embeddedJson.classification.entries.length,
    );
    expect(report.target.schemaFingerprint).toBe(report.target.reopenedSchemaFingerprint);
    expect(report.target.contentFingerprint).toBe(report.target.reopenedContentFingerprint);
    expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(source.assetsRoot);
    expect(serialized).not.toContain(targetRootPath);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('hero');

    const targetDatabasePath = join(targetRootPath, 'catalog.sqlite');
    const store = await openTargetStore(targetDatabasePath);
    try {
      const database = getTargetStoreDatabase(store);
      expect(loadMediaBlob(database, source.hash)).toMatchObject({
        hash: source.hash,
        byteLength: PNG_BYTES.byteLength,
        mimeType: 'image/png',
        technicalFacts: { kind: 'image', width: 1, height: 1 },
        createdAt: new Date(CREATED_AT).toISOString(),
      });
      expect(
        listGlobalMediaFolders(database).map(({ id, parentId }) => ({ id, parentId })),
      ).toEqual([
        { id: 'folder.root', parentId: null },
        { id: 'folder.child', parentId: 'folder.root' },
      ]);
      expect(loadGlobalMediaAsset(database, 'asset.one')).toMatchObject({
        id: 'asset.one',
        revision: 0,
        blobHash: source.hash,
        filename: `${source.hash}.png`,
        displayName: 'Private Frame',
        source: {
          kind: 'imported',
          importId: 'asset.one',
          originalFileName: `${source.hash}.png`,
        },
        folderId: 'folder.child',
        tags: ['hero', 'reference'],
        createdAt: new Date(CREATED_AT).toISOString(),
        updatedAt: new Date(CREATED_AT).toISOString(),
      });
    } finally {
      store.close();
    }
    await createFilesystemMediaCas(join(targetRootPath, 'media')).verify({
      hash: source.hash,
      byteLength: PNG_BYTES.byteLength,
    });
    const offlineBundle = JSON.parse(
      await readFile(join(targetRootPath, 'legacy-offline-export.json'), 'utf8'),
    ) as {
      readonly schema: string;
      readonly fingerprint: string;
      readonly entryCount: number;
      readonly payloadCount: number;
    };
    expect(offlineBundle).toMatchObject({
      schema: 'lucid-fin.legacy-offline-export/v1',
      fingerprint: report.target.offlineExport.bundleFingerprint,
      entryCount: 1,
      payloadCount: 1,
    });
    expect(report.target.offlineExport.sha256).toBe(report.target.offlineExport.reopenedSha256);
    expect(await readFile(source.mainDatabasePath)).toEqual(sourceDatabaseBefore);
    expect(await readFile(source.sourceMediaPath)).toEqual(sourceMediaBefore);
  }, 15_000);

  it('transforms and reconciles the complete six-format static image family', async () => {
    const source = await fixture(STATIC_IMAGE_MEDIA);
    const sourceDatabaseBefore = await readFile(source.mainDatabasePath);
    const sourceMediaBefore = await Promise.all(
      source.media.map(({ sourceMediaPath }) => readFile(sourceMediaPath)),
    );
    const { readiness } = await evidence(source);
    const targetRootPath = join(source.directory, 'target-static-family');

    const report = await rehearseRepresentativeLegacyImageCatalog({
      paths: source,
      readiness,
      targetRootPath,
    });

    expect(report.target.counts).toEqual({
      mediaBlobs: STATIC_IMAGE_MEDIA.length,
      globalMediaFolders: 2,
      globalMediaAssets: STATIC_IMAGE_MEDIA.length,
    });
    expect(report.coverage).toMatchObject({
      classifiedSubjects: readiness.counts.classifiedSubjectCount,
      mappedSubjects:
        readiness.counts.classifiedSubjectCount - report.target.offlineExport.entryCount,
      offlineSubjects: STATIC_IMAGE_MEDIA.length,
      complete: true,
    });
    expect(report.target.offlineExport.entryCount).toBe(STATIC_IMAGE_MEDIA.length);

    const store = await openTargetStore(join(targetRootPath, 'catalog.sqlite'));
    try {
      const database = getTargetStoreDatabase(store);
      for (const { assetId, hash, input } of source.media) {
        const format = input.format as keyof typeof STATIC_IMAGE_MIME_TYPES;
        expect(loadMediaBlob(database, hash)).toMatchObject({
          hash,
          byteLength: input.bytes.byteLength,
          mimeType: STATIC_IMAGE_MIME_TYPES[format],
          technicalFacts: {
            kind: 'image',
            width: input.width,
            height: input.height,
          },
        });
        expect(loadGlobalMediaAsset(database, assetId)).toMatchObject({
          id: assetId,
          blobHash: hash,
          kind: 'image',
          filename: `${hash}.${input.format}`,
          source: {
            kind: 'imported',
            importId: assetId,
            originalFileName: `${hash}.${input.format}`,
          },
        });
        await createFilesystemMediaCas(join(targetRootPath, 'media')).verify({
          hash,
          byteLength: input.bytes.byteLength,
        });
      }
    } finally {
      store.close();
    }

    expect(await readFile(source.mainDatabasePath)).toEqual(sourceDatabaseBefore);
    await Promise.all(
      source.media.map(async ({ sourceMediaPath }, index) => {
        expect(await readFile(sourceMediaPath)).toEqual(sourceMediaBefore[index]);
      }),
    );
  });

  it('produces identical reports for independent disposable targets', async () => {
    const source = await fixture(STATIC_IMAGE_MEDIA);
    const { readiness } = await evidence(source);

    const first = await rehearseRepresentativeLegacyImageCatalog({
      paths: source,
      readiness,
      targetRootPath: join(source.directory, 'target-first'),
    });
    const second = await rehearseRepresentativeLegacyImageCatalog({
      paths: source,
      readiness,
      targetRootPath: join(source.directory, 'target-second'),
    });

    expect(second).toEqual(first);
  });

  it.each(STATIC_IMAGE_MEDIA)(
    'rejects $format when byte-derived dimensions disagree before creating a target',
    async (media) => {
      const source = await fixture(media);
      const main = new DatabaseSync(source.mainDatabasePath);
      try {
        main
          .prepare('UPDATE asset_contents SET width = ? WHERE hash = ?')
          .run((media.width ?? 1) + 1, source.hash);
      } finally {
        main.close();
      }
      const { readiness } = await evidence(source);
      const targetRootPath = join(source.directory, `dimension-target-${media.format}`);

      await expect(
        rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
      ).rejects.toThrow('static image dimensions');
      await expectMissing(targetRootPath);
    },
  );

  it.each(
    STATIC_IMAGE_MEDIA.map((declared, index) => ({
      declared,
      actual: STATIC_IMAGE_MEDIA[(index + 1) % STATIC_IMAGE_MEDIA.length]!,
    })),
  )(
    'rejects declared $declared.format when bytes prove another format before creating a target',
    async ({ actual, declared }) => {
      const source = await fixture({
        type: 'image',
        format: declared.format,
        bytes: actual.bytes,
        width: actual.width,
        height: actual.height,
      });
      const { readiness } = await evidence(source);
      const targetRootPath = join(source.directory, `identity-target-${declared.format}`);

      await expect(
        rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
      ).rejects.toThrow('byte identity');
      await expectMissing(targetRootPath);
    },
  );

  it.each([
    { media: STATIC_IMAGE_MEDIA[0]!, length: 23 },
    { media: STATIC_IMAGE_MEDIA[1]!, length: 10 },
    { media: STATIC_IMAGE_MEDIA[2]!, length: 20 },
    { media: STATIC_IMAGE_MEDIA[3]!, length: 9 },
    { media: STATIC_IMAGE_MEDIA[4]!, length: 20 },
    { media: STATIC_IMAGE_MEDIA[5]!, length: 12 },
  ])(
    'rejects truncated $media.format bytes before creating a target',
    async ({ length, media }) => {
      const source = await fixture({ ...media, bytes: media.bytes.subarray(0, length) });
      const { readiness } = await evidence(source);
      const targetRootPath = join(source.directory, `truncated-target-${media.format}`);

      await expect(
        rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
      ).rejects.toThrow();
      await expectMissing(targetRootPath);
    },
  );

  it.each(STATIC_IMAGE_MEDIA)(
    'rejects corrupted $format magic before creating a target',
    async (media) => {
      const bytes = Buffer.from(media.bytes);
      bytes[0] = 0;
      const source = await fixture({ ...media, bytes });
      const { readiness } = await evidence(source);
      const targetRootPath = join(source.directory, `magic-target-${media.format}`);

      await expect(
        rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
      ).rejects.toThrow('recognized static image');
      await expectMissing(targetRootPath);
    },
  );

  it.each([
    ['video', 'video', 'mp4', Buffer.from('00000000ftypisom')],
    ['audio', 'audio', 'wav', Buffer.from('RIFF0000WAVE')],
  ])('rejects %s before creating a target', async (_label, type, format, bytes) => {
    const source = await fixture({ type, format, bytes });
    const { readiness } = await evidence(source);
    const targetRootPath = join(source.directory, 'unsupported-target');

    await expect(
      rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
    ).rejects.toThrow('static image media family');
    await expectMissing(targetRootPath);
  });

  it('rejects unmapped Legacy media fields before creating a target', async () => {
    const source = await fixture();
    const main = new DatabaseSync(source.mainDatabasePath);
    try {
      main
        .prepare(
          `UPDATE asset_contents
              SET prompt = 'Private prompt', provider = 'provider', duration = 1, has_audio = 1
            WHERE hash = ?`,
        )
        .run(source.hash);
    } finally {
      main.close();
    }
    const { readiness } = await evidence(source);
    const targetRootPath = join(source.directory, 'unmapped-target');

    await expect(
      rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
    ).rejects.toThrow('unmapped media fields');
    await expectMissing(targetRootPath);
  });

  it('rejects other migration dispositions instead of partially transforming them', async () => {
    const source = await fixture();
    const main = new DatabaseSync(source.mainDatabasePath);
    try {
      main.exec(`
        INSERT INTO color_styles (
          id, name, source_type, palette, gradients, exposure, tags, created_at, updated_at
        ) VALUES ('style.one', 'Private Style', 'manual', '[]', '[]', '{}', '[]', 1, 1)
      `);
    } finally {
      main.close();
    }
    const { readiness } = await evidence(source);
    const targetRootPath = join(source.directory, 'partial-target');

    expect(readiness.ok).toBe(true);
    await expect(
      rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
    ).rejects.toThrow('representative catalog scope');
    await expectMissing(targetRootPath);
  });

  it('detects source drift from the approved evidence before creating a target', async () => {
    const source = await fixture();
    const { readiness } = await evidence(source);
    const main = new DatabaseSync(source.mainDatabasePath);
    try {
      main
        .prepare("UPDATE asset_entries SET display_name = 'Changed' WHERE id = 'asset.one'")
        .run();
    } finally {
      main.close();
    }
    const targetRootPath = join(source.directory, 'drift-target');

    await expect(
      rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
    ).rejects.toThrow('source snapshot');
    await expectMissing(targetRootPath);
  });

  it('never overwrites or removes an existing target root', async () => {
    const source = await fixture();
    const { readiness } = await evidence(source);
    const targetRootPath = join(source.directory, 'existing-target');
    const sentinelPath = join(targetRootPath, 'sentinel.txt');
    await mkdir(targetRootPath);
    await writeFile(sentinelPath, 'keep');

    await expect(
      rehearseRepresentativeLegacyImageCatalog({ paths: source, readiness, targetRootPath }),
    ).rejects.toThrow('already exists');
    expect(await readFile(sentinelPath, 'utf8')).toBe('keep');
  });
});
