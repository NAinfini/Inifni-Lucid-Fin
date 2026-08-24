import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGACY_STATIC_IMAGE_FORMATS, type LegacyStaticImageFormat } from './media-preflight.js';
import { inspectLegacyStaticImageBytes } from './static-image-byte-evidence.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.set([8, 2, 0, 0, 0], 24);
  return bytes;
}

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

interface StaticImageCase {
  readonly format: LegacyStaticImageFormat;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: Buffer;
  readonly truncatedLength: number;
}

const STATIC_IMAGES: readonly StaticImageCase[] = [
  {
    format: 'png',
    mimeType: 'image/png',
    width: 3,
    height: 2,
    bytes: png(3, 2),
    truncatedLength: 23,
  },
  {
    format: 'jpg',
    mimeType: 'image/jpeg',
    width: 5,
    height: 4,
    bytes: jpg(5, 4),
    truncatedLength: 10,
  },
  {
    format: 'webp',
    mimeType: 'image/webp',
    width: 7,
    height: 6,
    bytes: webp(7, 6),
    truncatedLength: 20,
  },
  {
    format: 'gif',
    mimeType: 'image/gif',
    width: 9,
    height: 8,
    bytes: gif(9, 8),
    truncatedLength: 9,
  },
  {
    format: 'bmp',
    mimeType: 'image/bmp',
    width: 11,
    height: 10,
    bytes: bmp(11, 10),
    truncatedLength: 20,
  },
  {
    format: 'tiff',
    mimeType: 'image/tiff',
    width: 13,
    height: 12,
    bytes: tiff(13, 12),
    truncatedLength: 12,
  },
];

async function inspect(bytes: Buffer, format: string) {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-static-image-evidence-'));
  temporaryDirectories.push(directory);
  const path = join(directory, `evidence.${format}`);
  await writeFile(path, bytes);
  return inspectLegacyStaticImageBytes(path);
}

describe('Legacy static image byte evidence', () => {
  it('keeps the evidence matrix equal to the preflight static image registry', () => {
    expect(STATIC_IMAGES.map(({ format }) => format)).toEqual(LEGACY_STATIC_IMAGE_FORMATS);
  });

  it.each(STATIC_IMAGES)(
    'derives $format identity, MIME, dimensions, and byte length from bytes',
    async ({ bytes, format, height, mimeType, width }) => {
      await expect(inspect(bytes, format)).resolves.toEqual({
        type: 'image',
        format,
        mimeType,
        width,
        height,
        byteLength: bytes.byteLength,
      });
    },
  );

  it.each(STATIC_IMAGES)(
    'rejects truncated $format evidence',
    async ({ bytes, format, truncatedLength }) => {
      await expect(inspect(bytes.subarray(0, truncatedLength), format)).rejects.toThrow();
    },
  );

  it.each(STATIC_IMAGES)(
    'rejects $format when its byte magic is corrupted',
    async ({ bytes, format }) => {
      const corrupted = Buffer.from(bytes);
      corrupted[0] = 0;
      await expect(inspect(corrupted, format)).rejects.toThrow('recognized static image');
    },
  );
});
