import { describe, expect, it } from 'vitest';
import { sanitizePng } from './sanitize-png.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!)! & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + data.length);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return chunk;
}

function makeIHDR(colorType: number): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(1, 0); // width
  data.writeUInt32BE(1, 4); // height
  data.writeUInt8(8, 8); // bit depth
  data.writeUInt8(colorType, 9);
  return makeChunk('IHDR', data);
}

function buildPng(parts: Buffer[]): Buffer {
  return Buffer.concat([PNG_SIG, ...parts]);
}

const IDAT = makeChunk('IDAT', Buffer.from([0x00]));
const IEND = makeChunk('IEND', Buffer.alloc(0));

describe('sanitizePng', () => {
  it('returns non-PNG buffers unchanged', () => {
    const buf = Buffer.from('not a png');
    expect(sanitizePng(buf)).toBe(buf);
  });

  it('returns unchanged PNG when no bad chunks present', () => {
    const png = buildPng([makeIHDR(6), IDAT, IEND]);
    expect(sanitizePng(png)).toBe(png);
  });

  it('strips iCCP chunks', () => {
    const iccp = makeChunk('iCCP', Buffer.from('sRGB\x00\x00deadbeef'));
    const png = buildPng([makeIHDR(6), iccp, IDAT, IEND]);
    const clean = sanitizePng(png);
    expect(clean.length).toBeLessThan(png.length);
    expect(clean.subarray(0, 8)).toEqual(PNG_SIG);
    expect(clean.includes(Buffer.from('iCCP'))).toBe(false);
    expect(clean.includes(Buffer.from('IDAT'))).toBe(true);
    expect(clean.includes(Buffer.from('IEND'))).toBe(true);
  });

  it('strips tRNS when alpha channel is present (color type 6)', () => {
    const trns = makeChunk('tRNS', Buffer.from([0x00, 0x00]));
    const png = buildPng([makeIHDR(6), trns, IDAT, IEND]);
    const clean = sanitizePng(png);
    expect(clean.includes(Buffer.from('tRNS'))).toBe(false);
  });

  it('keeps tRNS when color type has no alpha channel (type 2 / RGB)', () => {
    const trns = makeChunk('tRNS', Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    const png = buildPng([makeIHDR(2), trns, IDAT, IEND]);
    const clean = sanitizePng(png);
    expect(clean.includes(Buffer.from('tRNS'))).toBe(true);
  });

  it('strips both iCCP and tRNS in one pass', () => {
    const iccp = makeChunk('iCCP', Buffer.from('sRGB\x00\x00x'));
    const trns = makeChunk('tRNS', Buffer.from([0x00, 0x00]));
    const png = buildPng([makeIHDR(6), iccp, trns, IDAT, IEND]);
    const clean = sanitizePng(png);
    expect(clean.includes(Buffer.from('iCCP'))).toBe(false);
    expect(clean.includes(Buffer.from('tRNS'))).toBe(false);
    expect(clean.includes(Buffer.from('IDAT'))).toBe(true);
  });

  it('returns original buffer when PNG is malformed', () => {
    const truncated = Buffer.concat([PNG_SIG, Buffer.from([0x00, 0x00])]);
    expect(sanitizePng(truncated)).toBe(truncated);
  });
});
