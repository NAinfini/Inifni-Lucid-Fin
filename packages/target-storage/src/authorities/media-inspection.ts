import { MediaInspectDefinition } from '@lucid-fin/target-contracts';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { resolveRunMediaSource } from '../internal/media-source.js';
import { TargetStorageError } from '../kernel/errors.js';
import {
  parseMediaInspectionEvidence,
  type MediaInspectionAdapter,
  type MediaInspectInput,
} from '../kernel/media-inspector.js';
import type { MediaCas } from '../kernel/media-cas.js';
import type { TargetStore } from '../kernel/store.js';

export type MediaInspectSuccess = ReturnType<typeof MediaInspectDefinition.parseSuccess>;

export interface MediaInspectionAuthority {
  inspect(
    runId: string,
    input: MediaInspectInput,
    signal?: AbortSignal,
  ): Promise<MediaInspectSuccess>;
}

function invalid(message: string): TargetStorageError {
  return new TargetStorageError('INVALID_REQUEST', message);
}

function corrupt(message: string, cause: unknown): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', message, { cause });
}

export function createMediaInspectionAuthority(
  store: TargetStore,
  mediaCas: MediaCas,
  mediaInspector: MediaInspectionAdapter,
): MediaInspectionAuthority {
  return Object.freeze({
    async inspect(runId: string, inputValue: MediaInspectInput, signal?: AbortSignal) {
      const input = MediaInspectDefinition.parseInput(inputValue);
      const source = resolveRunMediaSource(getTargetStoreDatabase(store), runId, input.source);
      if (source.blob.hash !== input.expectedSourceHash) {
        throw invalid('Media inspection source does not match the expected content hash');
      }
      const expected = { hash: source.blob.hash, byteLength: source.blob.byteLength };
      await mediaCas.verify(expected);
      const supplied = await mediaInspector.inspect(
        { blob: source.blob, bytes: mediaCas.openVerified(expected), view: input.view },
        signal,
      );
      let evidence: ReturnType<typeof parseMediaInspectionEvidence>;
      try {
        evidence = parseMediaInspectionEvidence(supplied);
      } catch (cause) {
        throw corrupt('Media inspection adapter evidence is invalid', cause);
      }
      return MediaInspectDefinition.parseSuccess({
        observations: evidence.map((entry, ordinal) => {
          const evidenceHash = hashCanonical({
            artifact: entry.artifact,
            textEvidence: entry.textEvidence,
            timecodesMs: entry.timecodesMs,
            pageNumbers: entry.pageNumbers,
          });
          return {
            observationId: `observation.${hashCanonical({
              sourceContentHash: source.blob.hash,
              view: input.view,
              ordinal,
              evidenceHash,
            })}`,
            source: input.source,
            sourceContentHash: source.blob.hash,
            viewKind: input.view.kind,
            artifact: entry.artifact,
            textEvidence: entry.textEvidence,
            timecodesMs: entry.timecodesMs,
            pageNumbers: entry.pageNumbers,
          };
        }),
      });
    },
  });
}
