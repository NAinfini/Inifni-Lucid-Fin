// Strips broken ancillary chunks from PNG buffers written by AI providers.
// Two chunks routinely trigger libpng warnings on decode in Chromium:
//   - iCCP: "known incorrect sRGB profile" — some providers embed a legacy
//     libpng-generated sRGB ICC profile that fails the 2019 validation tweak.
//   - tRNS: "invalid with alpha channel" — some encoders add tRNS alongside
//     an alpha channel (color types 4/6), which is spec-illegal.
// Both are harmless visually, but the warnings are noisy. Since we own the
// bytes at write-time, we re-emit the PNG without those chunks. CRCs on
// kept chunks are preserved (we validate but don't recompute — the chunk
// bytes are unchanged, only their position in the stream shifts).

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * If `buffer` is a PNG, strip `iCCP` and (when an alpha channel is present)
 * `tRNS` chunks and return the cleaned buffer. Non-PNG inputs and malformed
 * PNGs are returned untouched — this is a best-effort sanitizer, not a
 * validator. Safe to call on every image write.
 */
export function sanitizePng(buffer: Buffer): Buffer {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return buffer;

  try {
    const out: Buffer[] = [PNG_SIGNATURE];
    let offset = 8;
    let colorType = -1;
    let changed = false;

    while (offset < buffer.length) {
      if (offset + 12 > buffer.length) return buffer; // malformed; bail
      const length = buffer.readUInt32BE(offset);
      const end = offset + 8 + length + 4;
      if (end > buffer.length) return buffer;
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');

      if (type === 'IHDR') colorType = buffer[offset + 8 + 9]!;

      const drop =
        type === 'iCCP' ||
        (type === 'tRNS' && (colorType === 4 || colorType === 6));

      if (drop) {
        changed = true;
      } else {
        out.push(buffer.subarray(offset, end));
      }

      offset = end;
      if (type === 'IEND') break;
    }

    return changed ? Buffer.concat(out) : buffer;
  } catch {
    return buffer;
  }
}
