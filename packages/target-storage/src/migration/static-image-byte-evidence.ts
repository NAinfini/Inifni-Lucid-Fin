import { open, type FileHandle } from 'node:fs/promises';
import type { LegacyStaticImageFormat } from './media-preflight.js';

const MAXIMUM_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const MIME_TYPES: Readonly<Record<LegacyStaticImageFormat, string>> = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
});

export interface LegacyStaticImageByteEvidence {
  readonly type: 'image';
  readonly format: LegacyStaticImageFormat;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

function hasPrefix(buffer: Buffer, prefix: readonly number[]): boolean {
  return (
    buffer.byteLength >= prefix.length && prefix.every((byte, index) => buffer[index] === byte)
  );
}

function hasAscii(buffer: Buffer, offset: number, text: string): boolean {
  return buffer.toString('ascii', offset, offset + text.length) === text;
}

function detectedFormat(header: Buffer): LegacyStaticImageFormat | null {
  if (hasPrefix(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (hasPrefix(header, [0xff, 0xd8, 0xff])) return 'jpg';
  if (hasAscii(header, 0, 'GIF87a') || hasAscii(header, 0, 'GIF89a')) return 'gif';
  if (hasAscii(header, 0, 'BM')) return 'bmp';
  if (hasPrefix(header, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(header, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'tiff';
  }
  if (hasAscii(header, 0, 'RIFF') && hasAscii(header, 8, 'WEBP')) return 'webp';
  return null;
}

async function readRange(
  handle: FileHandle,
  byteLength: number,
  offset: number,
  length: number,
  label: string,
): Promise<Buffer> {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > byteLength - length
  ) {
    throw new TypeError(`Legacy ${label} is truncated`);
  }
  const buffer = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await handle.read(buffer, total, length - total, offset + total);
    if (bytesRead === 0) throw new TypeError(`Legacy ${label} is truncated`);
    total += bytesRead;
  }
  return buffer;
}

function dimensions(width: number, height: number, label: string): ImageDimensions {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new TypeError(`Legacy ${label} dimensions must be positive safe integers`);
  }
  return { width, height };
}

async function pngDimensions(handle: FileHandle, byteLength: number): Promise<ImageDimensions> {
  const header = await readRange(handle, byteLength, 0, 24, 'PNG header');
  if (
    !hasPrefix(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    header.readUInt32BE(8) !== 13 ||
    !hasAscii(header, 12, 'IHDR')
  ) {
    throw new TypeError('Legacy PNG has an invalid IHDR header');
  }
  return dimensions(header.readUInt32BE(16), header.readUInt32BE(20), 'PNG');
}

function standaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7);
}

async function jpgDimensions(handle: FileHandle, byteLength: number): Promise<ImageDimensions> {
  const signature = await readRange(handle, byteLength, 0, 2, 'JPEG signature');
  if (signature[0] !== 0xff || signature[1] !== 0xd8) {
    throw new TypeError('Legacy JPEG has an invalid signature');
  }

  let offset = 2;
  let markerCount = 0;
  while (offset < byteLength && markerCount < 100_000) {
    markerCount += 1;
    const prefix = await readRange(handle, byteLength, offset, 1, 'JPEG marker');
    offset += 1;
    if (prefix[0] !== 0xff) throw new TypeError('Legacy JPEG marker prefix is invalid');

    let marker: number;
    do {
      const value = await readRange(handle, byteLength, offset, 1, 'JPEG marker');
      offset += 1;
      marker = value[0]!;
    } while (marker === 0xff);
    if (marker === 0x00) throw new TypeError('Legacy JPEG contains an invalid stuffed marker');
    if (marker === 0xd9 || marker === 0xda) {
      throw new TypeError('Legacy JPEG has no dimension-bearing frame header');
    }
    if (standaloneJpegMarker(marker)) continue;

    const lengthBytes = await readRange(handle, byteLength, offset, 2, 'JPEG segment');
    const segmentLength = lengthBytes.readUInt16BE(0);
    if (segmentLength < 2 || offset > byteLength - segmentLength) {
      throw new TypeError('Legacy JPEG segment length is invalid');
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 11) throw new TypeError('Legacy JPEG frame header is incomplete');
      const frame = await readRange(handle, byteLength, offset, 8, 'JPEG frame header');
      const components = frame[7]!;
      if (frame[2] === 0 || components === 0 || segmentLength !== 8 + components * 3) {
        throw new TypeError('Legacy JPEG frame header is invalid');
      }
      return dimensions(frame.readUInt16BE(5), frame.readUInt16BE(3), 'JPEG');
    }
    offset += segmentLength;
  }
  throw new TypeError('Legacy JPEG has no dimension-bearing frame header');
}

async function gifDimensions(handle: FileHandle, byteLength: number): Promise<ImageDimensions> {
  const header = await readRange(handle, byteLength, 0, 10, 'GIF logical screen descriptor');
  if (!hasAscii(header, 0, 'GIF87a') && !hasAscii(header, 0, 'GIF89a')) {
    throw new TypeError('Legacy GIF has an invalid signature');
  }
  return dimensions(header.readUInt16LE(6), header.readUInt16LE(8), 'GIF');
}

async function bmpDimensions(handle: FileHandle, byteLength: number): Promise<ImageDimensions> {
  const header = await readRange(handle, byteLength, 0, 18, 'BMP header');
  if (!hasAscii(header, 0, 'BM')) throw new TypeError('Legacy BMP has an invalid signature');
  const dibLength = header.readUInt32LE(14);
  if (dibLength === 12) {
    const core = await readRange(handle, byteLength, 18, 8, 'BMP core header');
    if (core.readUInt16LE(4) !== 1 || core.readUInt16LE(6) === 0) {
      throw new TypeError('Legacy BMP core header is invalid');
    }
    return dimensions(core.readUInt16LE(0), core.readUInt16LE(2), 'BMP');
  }
  if (dibLength < 40 || 14 + dibLength > byteLength) {
    throw new TypeError('Legacy BMP DIB header is invalid');
  }
  const info = await readRange(handle, byteLength, 18, 12, 'BMP info header');
  if (info.readUInt16LE(8) !== 1 || info.readUInt16LE(10) === 0) {
    throw new TypeError('Legacy BMP info header is invalid');
  }
  return dimensions(info.readInt32LE(0), Math.abs(info.readInt32LE(4)), 'BMP');
}

function tiffReaders(header: Buffer): Readonly<{
  uint16: (buffer: Buffer, offset: number) => number;
  uint32: (buffer: Buffer, offset: number) => number;
}> {
  if (hasAscii(header, 0, 'II')) {
    return {
      uint16: (buffer, offset) => buffer.readUInt16LE(offset),
      uint32: (buffer, offset) => buffer.readUInt32LE(offset),
    };
  }
  if (hasAscii(header, 0, 'MM')) {
    return {
      uint16: (buffer, offset) => buffer.readUInt16BE(offset),
      uint32: (buffer, offset) => buffer.readUInt32BE(offset),
    };
  }
  throw new TypeError('Legacy TIFF has an invalid byte order');
}

async function tiffDimensions(handle: FileHandle, byteLength: number): Promise<ImageDimensions> {
  const header = await readRange(handle, byteLength, 0, 8, 'TIFF header');
  const readers = tiffReaders(header);
  if (readers.uint16(header, 2) !== 42) throw new TypeError('Legacy TIFF magic is invalid');
  const ifdOffset = readers.uint32(header, 4);
  const countBytes = await readRange(handle, byteLength, ifdOffset, 2, 'TIFF image directory');
  const entryCount = readers.uint16(countBytes, 0);
  const directoryLength = 2 + entryCount * 12 + 4;
  const directory = await readRange(
    handle,
    byteLength,
    ifdOffset,
    directoryLength,
    'TIFF image directory',
  );
  let width: number | undefined;
  let height: number | undefined;
  for (let index = 0; index < entryCount; index += 1) {
    const offset = 2 + index * 12;
    const tag = readers.uint16(directory, offset);
    if (tag !== 256 && tag !== 257) continue;
    if ((tag === 256 ? width : height) !== undefined) {
      throw new TypeError('Legacy TIFF contains duplicate dimension tags');
    }
    const type = readers.uint16(directory, offset + 2);
    const count = readers.uint32(directory, offset + 4);
    if (count !== 1 || (type !== 3 && type !== 4)) {
      throw new TypeError('Legacy TIFF dimension tag has an unsupported representation');
    }
    const value =
      type === 3 ? readers.uint16(directory, offset + 8) : readers.uint32(directory, offset + 8);
    if (tag === 256) width = value;
    else height = value;
  }
  return dimensions(width ?? 0, height ?? 0, 'TIFF');
}

function uint24LittleEndian(buffer: Buffer, offset: number): number {
  return buffer[offset]! | (buffer[offset + 1]! << 8) | (buffer[offset + 2]! << 16);
}

function webpChunkDimensions(chunkType: string, payload: Buffer): ImageDimensions | null {
  if (chunkType === 'VP8X') {
    if (payload.byteLength !== 10 || payload[1] !== 0 || payload[2] !== 0 || payload[3] !== 0) {
      throw new TypeError('Legacy WebP VP8X header is invalid');
    }
    return dimensions(
      uint24LittleEndian(payload, 4) + 1,
      uint24LittleEndian(payload, 7) + 1,
      'WebP',
    );
  }
  if (chunkType === 'VP8L') {
    if (payload.byteLength < 5 || payload[0] !== 0x2f) {
      throw new TypeError('Legacy WebP VP8L header is invalid');
    }
    const packed = payload.readUInt32LE(1);
    return dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1, 'WebP');
  }
  if (chunkType === 'VP8 ') {
    if (payload.byteLength < 10 || !hasPrefix(payload.subarray(3), [0x9d, 0x01, 0x2a])) {
      throw new TypeError('Legacy WebP VP8 frame header is invalid');
    }
    return dimensions(payload.readUInt16LE(6) & 0x3fff, payload.readUInt16LE(8) & 0x3fff, 'WebP');
  }
  return null;
}

async function webpDimensions(handle: FileHandle, byteLength: number): Promise<ImageDimensions> {
  const header = await readRange(handle, byteLength, 0, 12, 'WebP RIFF header');
  if (!hasAscii(header, 0, 'RIFF') || !hasAscii(header, 8, 'WEBP')) {
    throw new TypeError('Legacy WebP has an invalid RIFF signature');
  }
  if (header.readUInt32LE(4) + 8 !== byteLength) {
    throw new TypeError('Legacy WebP RIFF length does not match its bytes');
  }

  let offset = 12;
  while (offset < byteLength) {
    const chunkHeader = await readRange(handle, byteLength, offset, 8, 'WebP chunk header');
    const chunkType = chunkHeader.toString('ascii', 0, 4);
    const chunkLength = chunkHeader.readUInt32LE(4);
    const paddedLength = chunkLength + (chunkLength % 2);
    const payload = await readRange(
      handle,
      byteLength,
      offset + 8,
      chunkLength,
      `WebP ${chunkType} chunk`,
    );
    const found = webpChunkDimensions(chunkType, payload);
    if (found) return found;
    offset += 8 + paddedLength;
  }
  throw new TypeError('Legacy WebP has no dimension-bearing image chunk');
}

async function inspectDimensions(
  handle: FileHandle,
  byteLength: number,
  format: LegacyStaticImageFormat,
): Promise<ImageDimensions> {
  switch (format) {
    case 'png':
      return pngDimensions(handle, byteLength);
    case 'jpg':
      return jpgDimensions(handle, byteLength);
    case 'webp':
      return webpDimensions(handle, byteLength);
    case 'gif':
      return gifDimensions(handle, byteLength);
    case 'bmp':
      return bmpDimensions(handle, byteLength);
    case 'tiff':
      return tiffDimensions(handle, byteLength);
  }
}

/** Derives static image identity and dimensions from verified Legacy CAS bytes. */
export async function inspectLegacyStaticImageBytes(
  sourcePath: string,
): Promise<LegacyStaticImageByteEvidence> {
  const handle = await open(sourcePath, 'r');
  try {
    const info = await handle.stat({ bigint: true });
    if (!info.isFile() || info.size <= 0n || info.size > MAXIMUM_SAFE_INTEGER) {
      throw new TypeError('Legacy static image is not a positive-size regular file');
    }
    const byteLength = Number(info.size);
    const header = await readRange(
      handle,
      byteLength,
      0,
      Math.min(byteLength, 256),
      'static image header',
    );
    const format = detectedFormat(header);
    if (format === null) {
      throw new TypeError('Legacy media bytes are not a recognized static image');
    }
    const { width, height } = await inspectDimensions(handle, byteLength, format);
    return {
      type: 'image',
      format,
      mimeType: MIME_TYPES[format],
      width,
      height,
      byteLength,
    };
  } finally {
    await handle.close();
  }
}
