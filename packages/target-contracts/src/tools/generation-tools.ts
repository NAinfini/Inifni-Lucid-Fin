import { z } from 'zod';
import { strictObject } from '../canonical.js';
import {
  ChoiceOwnerRefSchema,
  DecisionProtectionCommandSchema,
  DecisionRecordCommandSchema,
} from '../decision.js';
import {
  AudioGenerationTaskSchema,
  EvaluationInputSchema,
  EvaluationSuccessSchema,
  GenerationQuoteInputSchema,
  GenerationQuoteSuccessSchema,
  GenerationProviderSelectionSchema,
  GenerationSubmissionSuccessSchema,
  GenerationSpecSchema,
  GenerationSubmitInputSchema,
  ImageGenerationTaskSchema,
  ResultQueryInputSchema,
  ResultQuerySuccessSchema,
  VideoGenerationTaskSchema,
} from '../generation.js';
import {
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  ProviderModelSchema,
  Sha256Schema,
  UserChoiceRefSchema,
} from '../primitives.js';
import {
  MAX_REFERENCE_COUNT,
  defineTool,
  externalMetadata,
  readMetadata,
  reversibleMetadata,
  uniqueArray,
  variantExecution,
} from './common.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const TIME = '2026-08-15T12:00:00.000Z';

const ModalitySchema = z.enum(['image', 'video', 'audio']);
export const ExactGenerationSpecSchema = GenerationSpecSchema;

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
const ProviderCapabilitySchema = strictObject({
  provider: ProviderModelSchema,
  modality: ModalitySchema,
  imageTasks: z.array(ImageGenerationTaskSchema).max(5),
  videoTasks: z.array(VideoGenerationTaskSchema).max(5),
  audioTasks: z.array(AudioGenerationTaskSchema).max(3),
  parameters: z.array(ProviderParameterSchema).max(20),
  quoteSupport: z.enum(['exact', 'estimate', 'unavailable']),
  availability: z.enum(['available', 'degraded', 'unavailable']),
  capabilityVersion: z.string().min(1).max(80),
  freshAt: IsoTimestampSchema,
});

function generationReadPolicy(domain: 'provider' | 'generation' | 'result') {
  return readMetadata({
    domain,
    scope: { project: 'current', run: 'current', crossProject: 'denied' },
    cas: { mode: 'none', expectedFields: [] },
    publicProgress: { mode: 'none', redactArguments: true },
    publicResult: { mode: 'summary', redactProviderPayload: true },
    artifactProjection: { mode: 'none', fields: [] },
    contextFactProjection: { mode: 'authority_refs', fields: ['items'] },
    variantDiscriminant: null,
    variants: [],
  });
}

export const ProviderCapabilitiesDefinition = defineTool({
  id: 'provider.capabilities',
  description:
    'Inspect configured provider/model modalities, limits, parameters, quotes, and availability.',
  metadata: generationReadPolicy('provider'),
  inputSchema: strictObject({
    modality: ModalitySchema.nullable(),
    providerIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'provider IDs'),
    models: uniqueArray(
      strictObject({ providerId: EntityIdSchema, model: z.string().trim().min(1).max(200) }),
      0,
      MAX_REFERENCE_COUNT,
      'provider models',
    ),
  }),
  successSchema: strictObject({
    capabilities: z.array(ProviderCapabilitySchema).max(MAX_REFERENCE_COUNT),
  }),
  examples: {
    input: { modality: 'video', providerIds: [], models: [] },
    success: {
      capabilities: [
        {
          provider: { providerId: 'provider.1', model: 'video-model', reasoningStrength: null },
          modality: 'video',
          imageTasks: [],
          videoTasks: ['create', 'imageToVideo'],
          audioTasks: [],
          parameters: [{ name: 'durationMs', required: true, minimum: 1_000, maximum: 10_000 }],
          quoteSupport: 'estimate',
          availability: 'available',
          capabilityVersion: '2026-08-15',
          freshAt: TIME,
        },
      ],
    },
  },
});

export const GenerationQuoteDefinition = defineTool({
  id: 'generation.quote',
  description: 'Quote cost and time for one exact typed image, video, or audio generation request.',
  metadata: {
    ...generationReadPolicy('generation'),
    cost: { mode: 'quote_only', unknownCost: 'project_policy', dimension: 'cost' },
    retry: { mode: 'safe', technicalAttemptLimit: 1 },
  },
  inputSchema: GenerationQuoteInputSchema,
  successSchema: GenerationQuoteSuccessSchema,
  examples: {
    input: {
      spec: {
        kind: 'image',
        task: 'create',
        target: {
          authority: 'production',
          id: 'shot.1',
          revision: 2,
          contentHash: HASH_A,
        },
        prompt: 'Wide moonlit harbor, restrained contrast.',
        negativePrompt: null,
        references: [],
        provider: { providerId: 'provider.1', model: 'image-model' },
        outputCount: 2,
        seed: 42,
        width: 1_920,
        height: 1_080,
        guidanceScale: 7.5,
        sourceMaskRefId: null,
      },
    },
    success: {
      quote: {
        state: 'estimated',
        quoteId: 'quote.1',
        quotedRequestHash: HASH_C,
        amount: '0.2',
        currency: 'USD',
        expiresAt: '2026-08-15T12:05:00.000Z',
        providerId: 'provider.1',
        model: 'image-model',
        quoteHash: HASH_B,
      },
      estimatedDurationMs: 30_000,
      constraints: [],
    },
  },
});

export const GenerationSubmitDefinition = defineTool({
  id: 'generation.submit',
  description:
    'Submit one exact image, video, or audio generation request through a configured provider.',
  metadata: {
    ...externalMetadata({
      domain: 'generation',
      domainMutation: true,
      permissions: ['project.write', 'generate'],
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: [
          'expectedProjectRevision',
          'spec.target.revision',
          'spec.target.contentHash',
        ],
      },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'result_cards', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['immediateResults.artifact'] },
      contextFactProjection: {
        mode: 'operation_state',
        fields: ['operation', 'immediateResults'],
      },
      variantDiscriminant: 'spec.kind',
      variants: [],
    }),
    variants: ['image', 'video', 'audio'].map((discriminant) =>
      variantExecution({
        discriminant,
        profile: 'EXT',
        effect: 'external',
        permissions: ['project.write', 'generate'],
        confirmation: 'none',
        cost: 'metered_known_or_unknown',
        unknownCost: 'blocked_when_capped',
        cas: 'revision_and_content_hash',
        idempotency: 'attempt_fingerprint',
        retry: 'receipt_reconcile_only',
        timeout: 'provider',
        cancellation: 'provider_declared',
        recovery: 'provider_receipt',
        unknownStateNeverResubmit: true,
      }),
    ),
  },
  inputSchema: GenerationSubmitInputSchema,
  successSchema: GenerationSubmissionSuccessSchema,
  examples: {
    input: {
      spec: {
        kind: 'video',
        task: 'create',
        target: {
          authority: 'production',
          id: 'shot.1',
          revision: 2,
          contentHash: HASH_A,
        },
        prompt: 'Slow dolly across a moonlit harbor.',
        negativePrompt: 'No text overlays.',
        references: [],
        provider: { providerId: 'provider.1', model: 'video-model' },
        outputCount: 2,
        seed: 42,
        width: 1_920,
        height: 1_080,
        durationMs: 5_000,
        frameRate: 24,
        includeAudio: false,
      },
      quote: {
        state: 'estimated',
        quoteId: 'quote.1',
        quotedRequestHash: HASH_C,
        amount: '0.4',
        currency: 'USD',
        expiresAt: '2026-08-15T12:05:00.000Z',
        providerId: 'provider.1',
        model: 'video-model',
        quoteHash: HASH_B,
      },
      expectedProjectRevision: 4,
      promptProvenance: {
        sourceObjectId: 'shot.1',
        sourceRevision: 2,
        sourceHash: HASH_A,
        assemblyHash: HASH_C,
        loadedSkillDigests: [HASH_A, HASH_B],
      },
      outputIntents: [
        {
          variantIndex: 0,
          globalAsset: {
            filename: 'moonlit-harbor-1.mp4',
            displayName: 'Moonlit Harbor 1',
            folderId: null,
            tags: ['generated', 'harbor'],
          },
          projectMediaRef: {
            label: 'Moonlit Harbor candidate 1',
            collections: ['Generated candidates'],
            roles: ['generated_candidate'],
            notes: 'Generated for shot.1.',
          },
        },
        {
          variantIndex: 1,
          globalAsset: {
            filename: 'moonlit-harbor-2.mp4',
            displayName: 'Moonlit Harbor 2',
            folderId: null,
            tags: ['generated', 'harbor'],
          },
          projectMediaRef: {
            label: 'Moonlit Harbor candidate 2',
            collections: ['Generated candidates'],
            roles: ['generated_candidate'],
            notes: 'Generated for shot.1.',
          },
        },
      ],
    },
    success: {
      operation: {
        id: 'operation.generation.1',
        revision: 1,
        kind: 'generation_attempt',
        ownerRef: {
          authority: 'generation_attempt',
          id: 'attempt.generation.1',
          revision: 1,
          contentHash: HASH_B,
        },
      },
      generationRequestId: 'generation.1',
      attemptId: 'attempt.generation.1',
      state: 'submitted',
      requestHash: HASH_C,
      reservation: { state: 'estimated', value: '0.4', currency: 'USD' },
      immediateResults: [],
    },
  },
});

export const ResultQueryDefinition = defineTool({
  id: 'result.query',
  description: 'Inspect generated candidates, artifacts, provenance, and assessments.',
  metadata: {
    ...generationReadPolicy('result'),
    publicResult: { mode: 'result_cards', redactProviderPayload: true },
    artifactProjection: { mode: 'from_success', fields: ['items.artifact'] },
  },
  inputSchema: ResultQueryInputSchema,
  successSchema: ResultQuerySuccessSchema,
  examples: {
    input: {
      resultIds: ['result.1'],
      requestIds: [],
      targetRefs: [],
      include: ['artifact', 'prompt'],
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          resultRef: {
            authority: 'generated_result',
            id: 'result.1',
            revision: 0,
            contentHash: HASH_A,
          },
          requestId: 'generation.1',
          targetRef: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_B },
          technicalValidation: {
            state: 'valid',
            mimeTypeValid: true,
            dimensionsValid: true,
            durationValid: true,
            failureCode: null,
          },
          artifact: {
            kind: 'video',
            id: 'artifact.1',
            contentHash: HASH_C,
            mimeType: 'video/mp4',
            width: 1_920,
            height: 1_080,
            durationMs: 5_000,
          },
          submittedPrompt: 'Slow dolly across a moonlit harbor.',
          referenceBindings: null,
          provider: null,
          assessmentIds: null,
        },
      ],
      nextCursor: null,
    },
  },
});

const localEvaluationKinds = ['technical_integrity', 'delivery_readiness'] as const;
const providerEvaluationKinds = ['reference_similarity', 'continuity', 'coverage'] as const;

export const EvaluationRunDefinition = defineTool({
  id: 'evaluation.run',
  description:
    'Evaluate technical, similarity, continuity, coverage, or delivery evidence without choosing a winner.',
  metadata: {
    ...externalMetadata({
      domain: 'evaluation',
      domainMutation: true,
      permissions: ['project.read', 'evaluate'],
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: { mode: 'content_hash', expectedFields: ['subjects.contentHash'] },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'summary', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['assessment.artifacts'] },
      contextFactProjection: {
        mode: 'operation_state',
        fields: ['assessmentId', 'assessment.findings'],
      },
      variantDiscriminant: 'kind',
      variants: [],
    }),
    variants: [
      ...localEvaluationKinds.map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'R',
          effect: 'read',
          permissions: ['project.read', 'evaluate'],
          confirmation: 'none',
          cost: 'none',
          unknownCost: 'not_applicable',
          cas: 'content_hash',
          idempotency: 'attempt_fingerprint',
          retry: 'safe',
          timeout: 'long_running',
          cancellation: 'cooperative',
          recovery: 'authority_reread',
          unknownStateNeverResubmit: false,
        }),
      ),
      ...providerEvaluationKinds.map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'EXT',
          effect: 'external',
          permissions: ['project.read', 'evaluate'],
          confirmation: 'none',
          cost: 'metered_known_or_unknown',
          unknownCost: 'blocked_when_capped',
          cas: 'content_hash',
          idempotency: 'attempt_fingerprint',
          retry: 'receipt_reconcile_only',
          timeout: 'provider',
          cancellation: 'provider_declared',
          recovery: 'provider_receipt',
          unknownStateNeverResubmit: true,
        }),
      ),
    ],
  },
  inputSchema: EvaluationInputSchema,
  successSchema: EvaluationSuccessSchema,
  examples: {
    input: {
      kind: 'reference_similarity',
      subjects: [
        { authority: 'generated_result', id: 'result.1', revision: 0, contentHash: HASH_A },
      ],
      references: [
        { authority: 'project_media_ref', id: 'media.1', revision: 1, contentHash: HASH_B },
      ],
      aspects: ['composition', 'lighting'],
      provider: { providerId: 'provider.1', model: 'vision-model' },
    },
    success: {
      operation: {
        id: 'operation.assessment.1',
        revision: 1,
        kind: 'result_assessment',
        ownerRef: {
          authority: 'result_assessment_attempt',
          id: 'assessment.1',
          revision: 1,
          contentHash: HASH_C,
        },
      },
      assessmentId: 'assessment.1',
      state: 'succeeded',
      assessment: {
        kind: 'reference_similarity',
        subjects: [
          {
            role: 'subject',
            ref: {
              authority: 'generated_result',
              id: 'result.1',
              revision: 0,
              contentHash: HASH_A,
            },
          },
          {
            role: 'reference',
            ref: {
              authority: 'project_media_ref',
              id: 'media.1',
              revision: 1,
              contentHash: HASH_B,
            },
          },
        ],
        findings: [
          {
            severity: 'info',
            subjectRef: {
              authority: 'generated_result',
              id: 'result.1',
              revision: 0,
              contentHash: HASH_A,
            },
            criterion: 'lighting',
            finding: 'The cool key light aligns with the reference.',
            evidenceRefs: [
              {
                authority: 'project_media_ref',
                id: 'media.1',
                revision: 1,
                contentHash: HASH_B,
              },
            ],
          },
        ],
        limitations: [],
        recommendations: ['Show both candidates to the user.'],
        artifacts: [],
        createdAt: TIME,
        assessmentHash: HASH_C,
      },
    },
  },
});

const DecisionRecordSuccessSchema = strictObject({
  choice: UserChoiceRefSchema,
  action: z.enum(['select', 'reject', 'refine', 'use_as_reference', 'undo']),
  owner: ChoiceOwnerRefSchema,
  currentState: z.enum(['selected', 'rejected', 'refine', 'reference', 'unreviewed']).nullable(),
  eventId: EntityIdSchema,
});

export const DecisionRecordDefinition = defineTool({
  id: 'decision.record',
  description:
    'Record one reversible candidate choice, refinement request, reference use, or undo.',
  metadata: {
    ...reversibleMetadata({
      domain: 'decision',
      dynamicProtection: true,
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: ['shot', 'result', 'currentOwner'],
      },
      publicProgress: { mode: 'summary', redactArguments: true },
      publicResult: { mode: 'result_cards', redactProviderPayload: true },
      artifactProjection: { mode: 'none', fields: [] },
      contextFactProjection: { mode: 'mutation_receipts', fields: ['choiceId', 'subject'] },
      variantDiscriminant: 'action',
      variants: [],
    }),
    variants: ['select', 'reject', 'refine', 'use_as_reference', 'undo'].map((discriminant) =>
      variantExecution({
        discriminant,
        profile: 'RW',
        effect: 'reversible_write',
        permissions: ['project.write'],
        confirmation: 'dynamic_protection',
        cost: 'none',
        unknownCost: 'not_applicable',
        cas: 'revision_and_content_hash',
        idempotency: 'operation_fingerprint',
        retry: 'before_commit',
        timeout: 'bounded_write',
        cancellation: 'before_commit',
        recovery: 'event_receipt',
        unknownStateNeverResubmit: false,
      }),
    ),
  },
  inputSchema: DecisionRecordCommandSchema,
  successSchema: DecisionRecordSuccessSchema,
  examples: {
    input: {
      action: 'select',
      shot: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_B },
      result: { authority: 'generated_result', id: 'result.1', revision: 0, contentHash: HASH_A },
      feedback: 'Use this take.',
    },
    success: {
      choice: { authority: 'user_choice', id: 'choice.1', choiceHash: HASH_C },
      action: 'select',
      owner: { authority: 'production', id: 'shot.1', revision: 3, contentHash: HASH_C },
      currentState: 'selected',
      eventId: 'event.5',
    },
  },
});
const DecisionProtectSuccessSchema = strictObject({
  choice: UserChoiceRefSchema,
  active: z.boolean(),
  owner: ChoiceOwnerRefSchema,
  eventId: EntityIdSchema,
});

export const DecisionProtectDefinition = defineTool({
  id: 'decision.protect',
  description: 'Protect or unprotect one typed Production or Delivery decision field.',
  metadata: {
    ...reversibleMetadata({
      domain: 'decision',
      dynamicProtection: false,
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: ['owner'],
      },
      publicProgress: { mode: 'summary', redactArguments: true },
      publicResult: { mode: 'object_links', redactProviderPayload: true },
      artifactProjection: { mode: 'none', fields: [] },
      contextFactProjection: { mode: 'mutation_receipts', fields: ['field', 'subject'] },
      variantDiscriminant: 'mode',
      variants: [],
    }),
    profile: 'PROTECTED',
    confirmation: { mode: 'exact_protected', globallyWaivable: false },
    variants: ['protect', 'unprotect'].map((discriminant) =>
      variantExecution({
        discriminant,
        profile: 'PROTECTED',
        effect: 'reversible_write',
        permissions: ['project.write'],
        confirmation: 'exact_protected',
        cost: 'none',
        unknownCost: 'not_applicable',
        cas: 'revision_and_content_hash',
        idempotency: 'operation_fingerprint',
        retry: 'before_commit',
        timeout: 'bounded_write',
        cancellation: 'before_commit',
        recovery: 'event_receipt',
        unknownStateNeverResubmit: false,
      }),
    ),
  },
  inputSchema: DecisionProtectionCommandSchema,
  successSchema: DecisionProtectSuccessSchema,
  examples: {
    input: {
      mode: 'protect',
      field: {
        owner: 'production',
        objectId: 'shot.1',
        field: 'resultDecision',
        resultId: 'result.1',
      },
      owner: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_A },
      reason: 'Keep the approved hero take.',
    },
    success: {
      choice: { authority: 'user_choice', id: 'choice.2', choiceHash: HASH_B },
      active: true,
      owner: { authority: 'production', id: 'shot.1', revision: 3, contentHash: HASH_B },
      eventId: 'event.6',
    },
  },
});

export const GENERATION_TOOL_DEFINITIONS = Object.freeze([
  ProviderCapabilitiesDefinition,
  GenerationQuoteDefinition,
  GenerationSubmitDefinition,
  ResultQueryDefinition,
  EvaluationRunDefinition,
  DecisionRecordDefinition,
  DecisionProtectDefinition,
] as const);
