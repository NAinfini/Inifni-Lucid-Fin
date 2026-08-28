import type { MediaTechnicalFacts } from '@lucid-fin/contracts';

export interface MediaImportDescriptor {
  readonly capabilityToken: string;
  readonly importId: string;
  readonly originalFileName: string;
  readonly blobHash: string;
  readonly byteLength: number;
  readonly mimeType: string;
  readonly technicalFacts: MediaTechnicalFacts;
}

export interface ResolvedMediaImportCapability {
  readonly descriptor: MediaImportDescriptor;
  openBytes(): AsyncIterable<Uint8Array>;
}

export interface MediaImportCapabilityResolver {
  resolve(capabilityToken: string): Promise<ResolvedMediaImportCapability>;
}

export interface MediaCasExpectedObject {
  readonly hash: string;
  readonly byteLength: number;
}

export interface MediaCasByteRange {
  readonly start: number;
  readonly end: number;
}

export interface MediaCasPutResult extends MediaCasExpectedObject {
  readonly disposition: 'created' | 'existing';
}

export interface MediaCas {
  putVerified(
    expected: MediaCasExpectedObject,
    bytes: AsyncIterable<Uint8Array>,
  ): Promise<MediaCasPutResult>;
  stat(hash: string): Promise<MediaCasExpectedObject | null>;
  verify(expected: MediaCasExpectedObject): Promise<void>;
  /** Implementations verify the object before yielding its first byte. */
  openVerified(expected: MediaCasExpectedObject): AsyncIterable<Uint8Array>;
  /** Implementations verify the object before yielding the selected range's first byte. */
  openVerifiedRange?(
    expected: MediaCasExpectedObject,
    range: MediaCasByteRange,
  ): AsyncIterable<Uint8Array>;
}

export function assertMediaCasByteRange(
  expected: MediaCasExpectedObject,
  range: MediaCasByteRange,
): MediaCasByteRange {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end >= expected.byteLength
  ) {
    throw new RangeError('Media CAS byte range is invalid');
  }
  return Object.freeze({ start: range.start, end: range.end });
}

export function openVerifiedMediaCasRange(
  cas: MediaCas,
  expected: MediaCasExpectedObject,
  rangeInput: MediaCasByteRange,
): AsyncIterable<Uint8Array> {
  const range = assertMediaCasByteRange(expected, rangeInput);
  if (cas.openVerifiedRange !== undefined) return cas.openVerifiedRange(expected, range);

  return {
    async *[Symbol.asyncIterator]() {
      let offset = 0;
      for await (const chunk of cas.openVerified(expected)) {
        const chunkEnd = offset + chunk.byteLength;
        if (chunkEnd > range.start && offset <= range.end) {
          const start = Math.max(range.start - offset, 0);
          const end = Math.min(range.end + 1 - offset, chunk.byteLength);
          if (end > start) yield chunk.slice(start, end);
        }
        offset = chunkEnd;
        if (offset > range.end) return;
      }
    },
  };
}
