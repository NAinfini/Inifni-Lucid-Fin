import fs from 'node:fs';
import type { AssetType } from '@lucid-fin/contracts';

export type MediaInspection = {
  type: AssetType;
  format: string;
  mimeType: string;
};

const HEADER_BYTES = 256;

const IMAGE_INSPECTIONS: Record<string, MediaInspection> = {
  png: { type: 'image', format: 'png', mimeType: 'image/png' },
  jpg: { type: 'image', format: 'jpg', mimeType: 'image/jpeg' },
  webp: { type: 'image', format: 'webp', mimeType: 'image/webp' },
  gif: { type: 'image', format: 'gif', mimeType: 'image/gif' },
  bmp: { type: 'image', format: 'bmp', mimeType: 'image/bmp' },
  tiff: { type: 'image', format: 'tiff', mimeType: 'image/tiff' },
};

const VIDEO_INSPECTIONS: Record<string, MediaInspection> = {
  mp4: { type: 'video', format: 'mp4', mimeType: 'video/mp4' },
  mov: { type: 'video', format: 'mov', mimeType: 'video/quicktime' },
  webm: { type: 'video', format: 'webm', mimeType: 'video/webm' },
};

const AUDIO_INSPECTIONS: Record<string, MediaInspection> = {
  mp3: { type: 'audio', format: 'mp3', mimeType: 'audio/mpeg' },
  wav: { type: 'audio', format: 'wav', mimeType: 'audio/wav' },
  ogg: { type: 'audio', format: 'ogg', mimeType: 'audio/ogg' },
  flac: { type: 'audio', format: 'flac', mimeType: 'audio/flac' },
  aac: { type: 'audio', format: 'aac', mimeType: 'audio/aac' },
  m4a: { type: 'audio', format: 'm4a', mimeType: 'audio/mp4' },
};

export function inspectBufferMedia(buffer: Buffer): MediaInspection | undefined {
  if (buffer.length < 2) {
    return undefined;
  }

  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return IMAGE_INSPECTIONS.png;
  }
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return IMAGE_INSPECTIONS.jpg;
  }
  if (hasAscii(buffer, 0, 'GIF87a') || hasAscii(buffer, 0, 'GIF89a')) {
    return IMAGE_INSPECTIONS.gif;
  }
  if (hasAscii(buffer, 0, 'BM')) {
    return IMAGE_INSPECTIONS.bmp;
  }
  if (hasPrefix(buffer, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(buffer, [0x4d, 0x4d, 0x00, 0x2a])) {
    return IMAGE_INSPECTIONS.tiff;
  }
  if (hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WEBP')) {
    return IMAGE_INSPECTIONS.webp;
  }

  if (hasAscii(buffer, 0, 'RIFF') && hasAscii(buffer, 8, 'WAVE')) {
    return AUDIO_INSPECTIONS.wav;
  }
  if (hasAscii(buffer, 0, 'fLaC')) {
    return AUDIO_INSPECTIONS.flac;
  }
  if (hasAscii(buffer, 0, 'OggS')) {
    return AUDIO_INSPECTIONS.ogg;
  }
  if (looksLikeAdtsAac(buffer)) {
    return AUDIO_INSPECTIONS.aac;
  }
  if (hasAscii(buffer, 0, 'ID3') || looksLikeMp3Frame(buffer)) {
    return AUDIO_INSPECTIONS.mp3;
  }

  if (looksLikeWebm(buffer)) {
    return VIDEO_INSPECTIONS.webm;
  }

  if (buffer.length >= 12 && hasAscii(buffer, 4, 'ftyp')) {
    const brand = readAscii(buffer, 8, 12);
    if (brand === 'qt  ') {
      return VIDEO_INSPECTIONS.mov;
    }
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'M4P ' || brand === 'isma') {
      return AUDIO_INSPECTIONS.m4a;
    }
    return VIDEO_INSPECTIONS.mp4;
  }

  return undefined;
}

export function inspectFileMedia(filePath: string): MediaInspection | undefined {
  const file = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const bytesRead = fs.readSync(file, header, 0, HEADER_BYTES, 0);
    return inspectBufferMedia(header.subarray(0, bytesRead));
  } finally {
    fs.closeSync(file);
  }
}

export function ensureExpectedMediaType(
  inspection: MediaInspection | undefined,
  expectedType: AssetType,
  sourceLabel: string,
): MediaInspection {
  if (!inspection) {
    throw new Error(`Unsupported or unrecognized asset media for ${sourceLabel}`);
  }
  if (inspection.type !== expectedType) {
    throw new Error(
      `Expected ${expectedType} asset but detected ${inspection.type}/${inspection.format}`,
    );
  }
  return inspection;
}

function hasPrefix(buffer: Buffer, prefix: number[]): boolean {
  if (buffer.length < prefix.length) {
    return false;
  }
  return prefix.every((value, index) => buffer[index] === value);
}

function hasAscii(buffer: Buffer, start: number, expected: string): boolean {
  return readAscii(buffer, start, start + expected.length) === expected;
}

function readAscii(buffer: Buffer, start: number, end: number): string {
  return buffer.toString('ascii', start, Math.min(buffer.length, end));
}

function looksLikeWebm(buffer: Buffer): boolean {
  if (!hasPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return false;
  }
  return readAscii(buffer, 0, Math.min(buffer.length, 64)).toLowerCase().includes('webm');
}

function looksLikeAdtsAac(buffer: Buffer): boolean {
  if (buffer.length < 2) {
    return false;
  }
  return buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
}

function looksLikeMp3Frame(buffer: Buffer): boolean {
  if (buffer.length < 2) {
    return false;
  }
  if (buffer[0] !== 0xff || (buffer[1] & 0xe0) !== 0xe0) {
    return false;
  }
  const layerBits = (buffer[1] >> 1) & 0x03;
  return layerBits !== 0;
}
