import type { MediaTechnicalFacts } from '@lucid-fin/target-contracts';

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
  openVerified(expected: MediaCasExpectedObject): AsyncIterable<Uint8Array>;
}
