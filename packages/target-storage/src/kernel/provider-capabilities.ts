import {
  AudioGenerationTaskSchema,
  EntityIdSchema,
  ImageGenerationTaskSchema,
  IsoTimestampSchema,
  ProviderModelSchema,
  RevisionSchema,
  VideoGenerationTaskSchema,
  parseCanonical,
  strictObject,
  z,
} from '@lucid-fin/target-contracts';

const ProviderParameterSchema = strictObject({
  name: z.enum([
    'width',
    'height',
    'durationMs',
    'frameRate',
    'outputCount',
    'seed',
    'guidanceScale',
    'includeAudio',
    'sampleRateHz',
    'channels',
  ]),
  required: z.boolean(),
  minimum: z.number().finite().nullable(),
  maximum: z.number().finite().nullable(),
});
const ProviderCapabilityEvidenceSchema = strictObject({
  modality: z.enum(['image', 'video', 'audio']),
  imageTasks: z.array(ImageGenerationTaskSchema).max(5),
  videoTasks: z.array(VideoGenerationTaskSchema).max(5),
  audioTasks: z.array(AudioGenerationTaskSchema).max(3),
  parameters: z.array(ProviderParameterSchema).max(20),
  quoteSupport: z.enum(['exact', 'estimate', 'unavailable']),
  availability: z.enum(['available', 'degraded', 'unavailable']),
  capabilityVersion: z.string().min(1).max(80),
  freshAt: IsoTimestampSchema,
});
const ProviderCapabilityEvidenceSetSchema = z.array(ProviderCapabilityEvidenceSchema).max(100);
const ProviderCapabilitiesProfileSchema = strictObject({
  id: EntityIdSchema,
  providerKind: z.string().trim().min(1).max(80),
  model: ProviderModelSchema,
  status: z.enum(['ready', 'unavailable', 'disabled']),
  revision: RevisionSchema,
  updatedAt: IsoTimestampSchema,
});

export type ProviderCapabilityEvidence = z.output<typeof ProviderCapabilityEvidenceSchema>;
export type ProviderCapabilitiesProfile = z.output<typeof ProviderCapabilitiesProfileSchema>;

export interface ProviderCapabilitiesResolver {
  resolve(
    profile: ProviderCapabilitiesProfile,
    signal?: AbortSignal,
  ): Promise<readonly ProviderCapabilityEvidence[]>;
}

export function parseProviderCapabilityEvidence(
  value: unknown,
): readonly ProviderCapabilityEvidence[] {
  return parseCanonical(ProviderCapabilityEvidenceSetSchema, value);
}

export function parseProviderCapabilitiesProfile(value: unknown): ProviderCapabilitiesProfile {
  return parseCanonical(ProviderCapabilitiesProfileSchema, value);
}
