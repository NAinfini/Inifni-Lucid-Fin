import {
  ArtifactRefSchema,
  CountSchema,
  MediaInspectDefinition,
  PositiveCountSchema,
  parseCanonical,
  strictObject,
  z,
  type MediaBlob,
} from '@lucid-fin/target-contracts';

export type MediaInspectInput = ReturnType<typeof MediaInspectDefinition.parseInput>;

const MediaInspectionEvidenceSchema = strictObject({
  artifact: ArtifactRefSchema.nullable(),
  textEvidence: z.string().max(100_000),
  timecodesMs: z.array(CountSchema).max(32),
  pageNumbers: z.array(PositiveCountSchema).max(32),
});
const MediaInspectionEvidenceSetSchema = z.array(MediaInspectionEvidenceSchema).min(1).max(32);

export type MediaInspectionEvidence = z.output<typeof MediaInspectionEvidenceSchema>;

export interface MediaInspectionRequest {
  readonly blob: MediaBlob;
  readonly bytes: AsyncIterable<Uint8Array>;
  readonly view: MediaInspectInput['view'];
}

export interface MediaInspectionAdapter {
  inspect(
    request: MediaInspectionRequest,
    signal?: AbortSignal,
  ): Promise<readonly MediaInspectionEvidence[]>;
}

export function parseMediaInspectionEvidence(value: unknown): readonly MediaInspectionEvidence[] {
  return parseCanonical(MediaInspectionEvidenceSetSchema, value);
}
