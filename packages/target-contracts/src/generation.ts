import { z } from 'zod';
import { canonicalJson, strictObject } from './canonical.js';
import {
  AttemptStateSchema,
  OperationRefSchema,
  ProviderReceiptSchema,
  ProviderUsageSchema,
  ResultAssessmentOperationRefSchema,
  withAttemptCommonFields,
} from './operation.js';
import {
  ArtifactRefSchema,
  CanonicalDecimalSchema,
  CountSchema,
  DomainObjectAuthoritySchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoCurrencySchema,
  IsoTimestampSchema,
  PositiveCountSchema,
  ProviderModelSchema,
  ResourceAmountSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';
import { ProjectMediaRoleSchema } from './media.js';

const MAX_REFERENCE_COUNT = 100;

function uniqueCanonical(values: unknown[]): boolean {
  return new Set(values.map((value) => canonicalJson(value))).size === values.length;
}

export const GenerationReferenceBindingSchema = strictObject({
  projectMediaRefId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  blobHash: Sha256Schema,
  role: z.enum(['image_reference', 'video_reference', 'audio_reference', 'style_reference']),
  influence: z.number().min(0).max(1).finite(),
});

export const GenerationModalitySchema = z.enum(['image', 'video', 'audio']);
export const GenerationProviderSelectionSchema = strictObject({
  providerId: EntityIdSchema,
  model: z.string().trim().min(1).max(200),
});
export const GenerationProductionTargetSchema = strictObject({
  authority: z.literal('production'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const GenerationRequestReferenceSchema = strictObject({
  source: z.union([
    strictObject({ kind: z.literal('project_media_ref'), id: EntityIdSchema }),
    strictObject({ kind: z.literal('generated_result'), id: EntityIdSchema }),
  ]),
  expectedContentHash: Sha256Schema,
  role: z.enum(['image_reference', 'video_reference', 'audio_reference', 'style_reference']),
  influence: z.number().min(0).max(1).finite(),
});

const generationSpecBase = {
  target: GenerationProductionTargetSchema,
  prompt: z.string().trim().min(1).max(100_000),
  negativePrompt: z.string().max(100_000).nullable(),
  references: z.array(GenerationRequestReferenceSchema).max(MAX_REFERENCE_COUNT),
  provider: GenerationProviderSelectionSchema.nullable(),
  outputCount: PositiveCountSchema.max(100),
  seed: CountSchema.nullable(),
} as const;

export const ImageGenerationTaskSchema = z.enum([
  'create',
  'edit',
  'inpaint',
  'outpaint',
  'variation',
]);
export const VideoGenerationTaskSchema = z.enum([
  'create',
  'imageToVideo',
  'videoToVideo',
  'extend',
  'edit',
]);
export const AudioGenerationTaskSchema = z.enum(['music', 'soundEffect', 'speech']);
export const ImageGenerationSpecSchema = strictObject({
  ...generationSpecBase,
  kind: z.literal('image'),
  task: ImageGenerationTaskSchema,
  width: PositiveCountSchema.max(16_384),
  height: PositiveCountSchema.max(16_384),
  guidanceScale: z.number().min(0).max(100).finite().nullable(),
  sourceMaskRefId: EntityIdSchema.nullable(),
});
export const VideoGenerationSpecSchema = strictObject({
  ...generationSpecBase,
  kind: z.literal('video'),
  task: VideoGenerationTaskSchema,
  width: PositiveCountSchema.max(16_384),
  height: PositiveCountSchema.max(16_384),
  durationMs: PositiveCountSchema.max(3_600_000),
  frameRate: PositiveCountSchema.max(240),
  includeAudio: z.boolean(),
});
export const AudioGenerationSpecSchema = strictObject({
  ...generationSpecBase,
  kind: z.literal('audio'),
  task: AudioGenerationTaskSchema,
  durationMs: PositiveCountSchema.max(3_600_000),
  sampleRateHz: PositiveCountSchema.max(384_000),
  channels: PositiveCountSchema.max(32),
  configuredVoiceId: EntityIdSchema.nullable(),
});
export const GenerationSpecSchema = z.union([
  ImageGenerationSpecSchema,
  VideoGenerationSpecSchema,
  AudioGenerationSpecSchema,
]);

const quoteCommon = {
  quoteId: EntityIdSchema,
  quotedRequestHash: Sha256Schema,
  currency: IsoCurrencySchema,
  expiresAt: IsoTimestampSchema,
  providerId: EntityIdSchema,
  model: z.string().trim().min(1).max(200),
  quoteHash: Sha256Schema,
} as const;
export const GenerationQuoteSchema = z.union([
  strictObject({ state: z.literal('known'), ...quoteCommon, amount: CanonicalDecimalSchema }),
  strictObject({ state: z.literal('estimated'), ...quoteCommon, amount: CanonicalDecimalSchema }),
  strictObject({ state: z.literal('unknown'), ...quoteCommon }),
]);

export function generationQuoteHashInput(quote: z.output<typeof GenerationQuoteSchema>) {
  const { quoteHash: _quoteHash, ...content } = quote;
  return content;
}

export const PromptAssemblyProvenanceSchema = strictObject({
  sourceObjectId: EntityIdSchema,
  sourceRevision: CountSchema,
  sourceHash: Sha256Schema,
  assemblyHash: Sha256Schema,
  loadedSkillDigests: z.array(Sha256Schema).max(MAX_REFERENCE_COUNT),
}).superRefine(({ loadedSkillDigests }, context) => {
  loadedSkillDigests.forEach((digest, index) => {
    if (index > 0 && loadedSkillDigests[index - 1]! >= digest) {
      context.addIssue({
        code: 'custom',
        path: ['loadedSkillDigests', index],
        message: 'Loaded skill digests must be sorted and unique',
      });
    }
  });
});

export function generationPromptAssemblyHashInput(input: {
  readonly target: GenerationProductionTarget;
  readonly prompt: string;
  readonly negativePrompt: string | null;
  readonly references: readonly GenerationRequestReference[];
  readonly loadedSkillDigests: readonly string[];
}) {
  return {
    target: input.target,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    references: input.references,
    loadedSkillDigests: input.loadedSkillDigests,
  } as const;
}

export const GenerationRequestSchema = strictObject({
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  spec: GenerationSpecSchema,
  requestHash: Sha256Schema,
  idempotencyKey: Sha256Schema,
  createdAt: IsoTimestampSchema,
});

export function generationRequestHashInput(spec: z.output<typeof GenerationSpecSchema>) {
  return spec;
}

const generationAttemptFields = {
  id: EntityIdSchema,
  requestId: EntityIdSchema,
  attemptNumber: PositiveCountSchema,
  provider: ProviderModelSchema,
  quote: GenerationQuoteSchema.nullable(),
  promptProvenance: PromptAssemblyProvenanceSchema,
} as const;

function addGenerationAttemptIssues(
  attempt: {
    state: z.output<typeof AttemptStateSchema>;
    provider: z.output<typeof ProviderModelSchema>;
    receipt: z.output<typeof ProviderReceiptSchema> | null;
    quote: z.output<typeof GenerationQuoteSchema> | null;
    createdAt: string;
  },
  context: z.RefinementCtx,
): void {
  if (attempt.state === 'submitted' && attempt.receipt === null) {
    context.addIssue({
      code: 'custom',
      path: ['receipt'],
      message: `${attempt.state} generation requires the persisted provider receipt`,
    });
  }
  if (
    attempt.quote !== null &&
    (attempt.quote.providerId !== attempt.provider.providerId ||
      attempt.quote.model !== attempt.provider.model)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['quote'],
      message: 'Generation quote and resolved provider must match',
    });
  }
  if (
    attempt.quote !== null &&
    Date.parse(attempt.quote.expiresAt) <= Date.parse(attempt.createdAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['quote', 'expiresAt'],
      message: 'Generation quote must be unexpired when the Attempt is created',
    });
  }
}

export const GenerationAttemptRecordSchema = withAttemptCommonFields(
  generationAttemptFields,
).superRefine(addGenerationAttemptIssues);

export const GenerationAttemptViewSchema = withAttemptCommonFields({
  authority: z.literal('generation_attempt'),
  ...generationAttemptFields,
  request: GenerationRequestSchema,
})
  .superRefine(addGenerationAttemptIssues)
  .superRefine((attempt, context) => {
    if (attempt.requestId !== attempt.request.id) {
      context.addIssue({
        code: 'custom',
        path: ['request'],
        message: 'Generation Attempt must embed its exact Request',
      });
    }
    if (attempt.quote !== null && attempt.quote.quotedRequestHash !== attempt.request.requestHash) {
      context.addIssue({
        code: 'custom',
        path: ['quote', 'quotedRequestHash'],
        message: 'Generation quote must bind the embedded Request hash',
      });
    }
    if (
      attempt.request.spec.provider !== null &&
      (attempt.request.spec.provider.providerId !== attempt.provider.providerId ||
        attempt.request.spec.provider.model !== attempt.provider.model)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Explicit Request provider must match the resolved Attempt provider',
      });
    }
  });

export const TechnicalValidationSchema = strictObject({
  state: z.enum(['pending', 'valid', 'invalid']),
  mimeTypeValid: z.boolean().nullable(),
  dimensionsValid: z.boolean().nullable(),
  durationValid: z.boolean().nullable(),
  failureCode: z
    .enum(['unreadable', 'wrong_media_kind', 'wrong_dimensions', 'wrong_duration', 'missing_bytes'])
    .nullable(),
});

export const GeneratedResultRefSchema = strictObject({
  authority: z.literal('generated_result'),
  id: EntityIdSchema,
  revision: z.literal(0),
  contentHash: Sha256Schema,
});
export const GeneratedResultSchema = strictObject({
  authority: z.literal('generated_result'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  revision: z.literal(0),
  contentHash: Sha256Schema,
  generationRequestId: EntityIdSchema,
  generationAttemptId: EntityIdSchema,
  targetProductionObjectId: EntityIdSchema,
  globalMediaAssetId: EntityIdSchema,
  mediaBlobHash: Sha256Schema,
  projectMediaRefId: EntityIdSchema,
  mediaKind: GenerationModalitySchema,
  variantIndex: CountSchema,
  submittedPrompt: z.string().min(1).max(100_000),
  submittedNegativePrompt: z.string().max(100_000).nullable(),
  promptProvenance: PromptAssemblyProvenanceSchema,
  referenceBindings: z.array(GenerationReferenceBindingSchema).max(MAX_REFERENCE_COUNT),
  provider: ProviderModelSchema,
  seed: CountSchema.nullable(),
  receipt: ProviderReceiptSchema,
  usage: ProviderUsageSchema,
  technicalValidation: TechnicalValidationSchema,
  createdAt: IsoTimestampSchema,
});

export function generatedResultContentHashInput(result: z.output<typeof GeneratedResultSchema>) {
  const { contentHash: _contentHash, ...snapshot } = result;
  return snapshot;
}

export const GeneratedResultIncludeSchema = z.enum([
  'artifact',
  'prompt',
  'references',
  'provider',
  'assessments',
]);
export const ResultQueryInputSchema = strictObject({
  resultIds: z
    .array(EntityIdSchema)
    .max(MAX_REFERENCE_COUNT)
    .refine(uniqueCanonical, { message: 'Result IDs must be unique' }),
  requestIds: z
    .array(EntityIdSchema)
    .max(MAX_REFERENCE_COUNT)
    .refine(uniqueCanonical, { message: 'Request IDs must be unique' }),
  targetRefs: z
    .array(DomainObjectRefSchema)
    .max(MAX_REFERENCE_COUNT)
    .refine(uniqueCanonical, { message: 'Target refs must be unique' }),
  include: z
    .array(GeneratedResultIncludeSchema)
    .max(5)
    .refine(uniqueCanonical, { message: 'Result includes must be unique' }),
  page: strictObject({
    cursor: z.string().min(1).max(1_000).nullable(),
    limit: PositiveCountSchema.max(100),
  }),
});
export const GeneratedResultQueryViewSchema = strictObject({
  resultRef: GeneratedResultRefSchema,
  requestId: EntityIdSchema,
  targetRef: GenerationProductionTargetSchema,
  technicalValidation: TechnicalValidationSchema,
  artifact: ArtifactRefSchema.nullable(),
  submittedPrompt: z.string().min(1).max(100_000).nullable(),
  referenceBindings: z.array(GenerationReferenceBindingSchema).max(MAX_REFERENCE_COUNT).nullable(),
  provider: ProviderModelSchema.nullable(),
  assessmentIds: z.array(EntityIdSchema).max(MAX_REFERENCE_COUNT).nullable(),
});
export const ResultQuerySuccessSchema = strictObject({
  items: z.array(GeneratedResultQueryViewSchema).max(100),
  nextCursor: z.string().min(1).max(1_000).nullable(),
});

export function assertGeneratedResultQueryProjection(
  input: z.output<typeof ResultQueryInputSchema>,
  view: z.output<typeof GeneratedResultQueryViewSchema>,
): void {
  const fields = {
    artifact: view.artifact,
    prompt: view.submittedPrompt,
    references: view.referenceBindings,
    provider: view.provider,
    assessments: view.assessmentIds,
  } as const;
  for (const [include, value] of Object.entries(fields)) {
    if (
      input.include.includes(include as z.output<typeof GeneratedResultIncludeSchema>) !==
      (value !== null)
    ) {
      throw new Error(`Result projection ${include} does not match include selection`);
    }
  }
}

export const EvaluationKindSchema = z.enum([
  'technical_integrity',
  'reference_similarity',
  'continuity',
  'coverage',
  'delivery_readiness',
]);
const EvaluationSubjectsSchema = z
  .array(DomainObjectRefSchema)
  .max(MAX_REFERENCE_COUNT)
  .refine(uniqueCanonical, { message: 'Evaluation subjects must be unique' });
export const EvaluationInputSchema = z.union([
  strictObject({
    kind: z.literal('technical_integrity'),
    subjects: EvaluationSubjectsSchema.min(1),
    checks: z
      .array(z.enum(['readable', 'media_kind', 'dimensions', 'duration', 'audio_presence']))
      .min(1)
      .max(5)
      .refine(uniqueCanonical, { message: 'Technical checks must be unique' }),
    provider: z.null(),
  }),
  strictObject({
    kind: z.literal('reference_similarity'),
    subjects: EvaluationSubjectsSchema.min(1),
    references: z
      .array(DomainObjectRefSchema)
      .min(1)
      .max(MAX_REFERENCE_COUNT)
      .refine(uniqueCanonical, { message: 'Evaluation references must be unique' }),
    aspects: z
      .array(z.enum(['composition', 'identity', 'palette', 'lighting', 'motion']))
      .min(1)
      .max(5)
      .refine(uniqueCanonical, { message: 'Similarity aspects must be unique' }),
    provider: GenerationProviderSelectionSchema.nullable(),
  }),
  strictObject({
    kind: z.literal('continuity'),
    subjects: EvaluationSubjectsSchema.min(2),
    aspects: z
      .array(z.enum(['identity', 'wardrobe', 'props', 'location', 'lighting', 'screen_direction']))
      .min(1)
      .max(6)
      .refine(uniqueCanonical, { message: 'Continuity aspects must be unique' }),
    provider: GenerationProviderSelectionSchema.nullable(),
  }),
  strictObject({
    kind: z.literal('coverage'),
    subjects: EvaluationSubjectsSchema.min(1),
    requirements: z
      .array(z.string().trim().min(1).max(2_000))
      .min(1)
      .max(100)
      .refine(uniqueCanonical, { message: 'Coverage requirements must be unique' }),
    provider: GenerationProviderSelectionSchema.nullable(),
  }),
  strictObject({
    kind: z.literal('delivery_readiness'),
    subjects: EvaluationSubjectsSchema.min(1),
    checks: z
      .array(
        z.enum(['all_items_resolve', 'format_match', 'trim_valid', 'audio_valid', 'hashes_valid']),
      )
      .min(1)
      .max(5)
      .refine(uniqueCanonical, { message: 'Delivery checks must be unique' }),
    provider: z.null(),
  }),
]);

export const ResultAssessmentSubjectRoleSchema = z.enum(['subject', 'reference']);
export const ResultAssessmentSubjectSchema = strictObject({
  attemptId: EntityIdSchema,
  role: ResultAssessmentSubjectRoleSchema,
  ordinal: CountSchema,
  authority: DomainObjectAuthoritySchema,
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const EvaluationFindingSchema = strictObject({
  severity: z.enum(['info', 'warning', 'error']),
  subjectRef: DomainObjectRefSchema,
  criterion: z.string().min(1).max(240),
  finding: z.string().min(1).max(4_000),
  evidenceRefs: z.array(DomainObjectRefSchema).max(MAX_REFERENCE_COUNT),
});
export const FinalAssessmentSchema = strictObject({
  kind: EvaluationKindSchema,
  subjects: z
    .array(strictObject({ role: ResultAssessmentSubjectRoleSchema, ref: DomainObjectRefSchema }))
    .max(MAX_REFERENCE_COUNT * 2),
  findings: z.array(EvaluationFindingSchema).max(500),
  limitations: z.array(z.string().min(1).max(4_000)).max(100),
  recommendations: z.array(z.string().min(1).max(4_000)).max(100),
  artifacts: z.array(ArtifactRefSchema).max(100),
  createdAt: IsoTimestampSchema,
  assessmentHash: Sha256Schema,
});

export function finalAssessmentHashInput(assessment: z.output<typeof FinalAssessmentSchema>) {
  const { assessmentHash: _assessmentHash, ...content } = assessment;
  return content;
}

export const ResultAssessmentAttemptViewSchema = withAttemptCommonFields({
  authority: z.literal('result_assessment_attempt'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  request: EvaluationInputSchema,
  requestHash: Sha256Schema,
  idempotencyKey: Sha256Schema,
  provider: ProviderModelSchema.nullable(),
  assessment: FinalAssessmentSchema.nullable(),
}).superRefine((attempt, context) => {
  if ((attempt.state === 'succeeded') !== (attempt.assessment !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['assessment'],
      message: 'A final assessment exists exactly when its Attempt succeeds',
    });
  }
  if (attempt.assessment !== null && attempt.assessment.kind !== attempt.request.kind) {
    context.addIssue({
      code: 'custom',
      path: ['assessment', 'kind'],
      message: 'Final assessment kind must match its Request',
    });
  }
  const local =
    attempt.request.kind === 'technical_integrity' || attempt.request.kind === 'delivery_readiness';
  if (local) {
    if (attempt.provider !== null || attempt.receipt !== null) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Local Evaluation Attempts cannot contain provider state',
      });
    }
    if (attempt.state === 'submitted' || attempt.state === 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Local Evaluation Attempts cannot enter provider submission states',
      });
    }
  } else {
    if (attempt.provider === null) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Provider-backed Evaluation Attempts require a resolved provider',
      });
    }
    if (attempt.state === 'submitted' && attempt.receipt === null) {
      context.addIssue({
        code: 'custom',
        path: ['receipt'],
        message: `${attempt.state} provider Evaluation requires the persisted receipt`,
      });
    }
    if (
      attempt.provider !== null &&
      attempt.request.provider !== null &&
      (attempt.provider.providerId !== attempt.request.provider.providerId ||
        attempt.provider.model !== attempt.request.provider.model)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Explicit Evaluation provider must match the resolved Attempt provider',
      });
    }
  }
  if (attempt.assessment !== null) {
    const expectedSubjects = [
      ...attempt.request.subjects.map((ref) => ({ role: 'subject' as const, ref })),
      ...(attempt.request.kind === 'reference_similarity'
        ? attempt.request.references.map((ref) => ({ role: 'reference' as const, ref }))
        : []),
    ];
    if (canonicalJson(attempt.assessment.subjects) !== canonicalJson(expectedSubjects)) {
      context.addIssue({
        code: 'custom',
        path: ['assessment', 'subjects'],
        message: 'Final assessment subjects must exactly match the ordered frozen Request refs',
      });
    }
    const primary = new Set(attempt.request.subjects.map((ref) => canonicalJson(ref)));
    const frozen = new Set(expectedSubjects.map(({ ref }) => canonicalJson(ref)));
    attempt.assessment.findings.forEach((finding, findingIndex) => {
      if (!primary.has(canonicalJson(finding.subjectRef))) {
        context.addIssue({
          code: 'custom',
          path: ['assessment', 'findings', findingIndex, 'subjectRef'],
          message: 'Assessment finding subject must be a primary Request subject',
        });
      }
      finding.evidenceRefs.forEach((ref, evidenceIndex) => {
        if (!frozen.has(canonicalJson(ref))) {
          context.addIssue({
            code: 'custom',
            path: ['assessment', 'findings', findingIndex, 'evidenceRefs', evidenceIndex],
            message: 'Assessment evidence must belong to the frozen Request refs',
          });
        }
      });
    });
  }
});

export function evaluationRequestHashInput(input: z.output<typeof EvaluationInputSchema>) {
  return input;
}

export const GenerationConstraintSchema = strictObject({
  field: z.enum([
    'width',
    'height',
    'durationMs',
    'frameRate',
    'outputCount',
    'sampleRateHz',
    'channels',
  ]),
  normalizedValue: z.union([z.number().finite(), z.boolean()]),
  message: z.string().max(2_000),
});
export const GenerationQuoteInputSchema = strictObject({ spec: GenerationSpecSchema });
export const GenerationQuoteSuccessSchema = strictObject({
  quote: GenerationQuoteSchema,
  estimatedDurationMs: CountSchema.nullable(),
  constraints: z.array(GenerationConstraintSchema).max(20),
});

export const GenerationOutputIntentSchema = strictObject({
  variantIndex: CountSchema,
  globalAsset: strictObject({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine((filename) => !/[\\/]/.test(filename), {
        message: 'Generated filename must be a leaf name',
      }),
    displayName: z.string().trim().min(1).max(240),
    folderId: EntityIdSchema.nullable(),
    tags: z
      .array(z.string().trim().min(1).max(80))
      .max(100)
      .refine(uniqueCanonical, { message: 'Generated asset tags must be unique' }),
  }),
  projectMediaRef: strictObject({
    label: z.string().trim().min(1).max(240),
    collections: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .refine(uniqueCanonical, { message: 'Generated media collections must be unique' }),
    roles: z
      .array(ProjectMediaRoleSchema)
      .min(1)
      .max(20)
      .refine(uniqueCanonical, { message: 'Generated media roles must be unique' })
      .refine((roles) => roles.includes('generated_candidate'), {
        message: 'Generated Project Media must include the generated_candidate role',
      }),
    notes: z.string().max(10_000),
  }),
});

const GenerationOutputIntentsSchema = z
  .array(GenerationOutputIntentSchema)
  .min(1)
  .max(100)
  .superRefine((intents, context) => {
    intents.forEach((intent, index) => {
      if (intent.variantIndex !== index) {
        context.addIssue({
          code: 'custom',
          path: [index, 'variantIndex'],
          message: 'Generation variant indexes must be contiguous from zero',
        });
      }
    });
  });

export const GenerationSubmitInputSchema = strictObject({
  spec: GenerationSpecSchema,
  quote: GenerationQuoteSchema.nullable(),
  expectedProjectRevision: RevisionSchema,
  promptProvenance: PromptAssemblyProvenanceSchema,
  outputIntents: GenerationOutputIntentsSchema,
}).superRefine((input, context) => {
  if (
    input.spec.provider !== null &&
    input.quote !== null &&
    (input.spec.provider.providerId !== input.quote.providerId ||
      input.spec.provider.model !== input.quote.model)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['quote'],
      message: 'Generation quote must match the explicitly requested provider',
    });
  }
  if (input.outputIntents.length !== input.spec.outputCount) {
    context.addIssue({
      code: 'custom',
      path: ['outputIntents'],
      message: 'Generation output intents must match outputCount one-for-one',
    });
  }
  const { target } = input.spec;
  if (
    input.promptProvenance.sourceObjectId !== target.id ||
    input.promptProvenance.sourceRevision !== target.revision ||
    input.promptProvenance.sourceHash !== target.contentHash
  ) {
    context.addIssue({
      code: 'custom',
      path: ['promptProvenance'],
      message: 'Prompt provenance must bind the exact Generation target',
    });
  }
});
export const ImmediateGeneratedResultSchema = strictObject({
  resultId: EntityIdSchema,
  artifact: ArtifactRefSchema,
  technicalState: z.enum(['pending', 'valid', 'invalid']),
});
export const GenerationSubmissionSuccessSchema = strictObject({
  operation: OperationRefSchema,
  generationRequestId: EntityIdSchema,
  attemptId: EntityIdSchema,
  state: AttemptStateSchema,
  requestHash: Sha256Schema,
  reservation: ResourceAmountSchema,
  immediateResults: z.array(ImmediateGeneratedResultSchema).max(100),
});
const EvaluationOperationRefSchema = ResultAssessmentOperationRefSchema.and(OperationRefSchema);
const EvaluationResultBaseShape = {
  operation: EvaluationOperationRefSchema,
  assessmentId: EntityIdSchema,
} as const;
export const EvaluationSuccessSchema = z
  .union([
    strictObject({
      ...EvaluationResultBaseShape,
      state: z.literal('succeeded'),
      assessment: FinalAssessmentSchema,
    }),
    strictObject({
      ...EvaluationResultBaseShape,
      state: AttemptStateSchema.exclude(['succeeded']),
      assessment: z.null(),
    }),
  ])
  .superRefine((result, context) => {
    if (result.operation.ownerRef.id !== result.assessmentId) {
      context.addIssue({
        code: 'custom',
        path: ['operation', 'ownerRef', 'id'],
        message: 'Evaluation Operation owner must match assessmentId',
      });
    }
  });

export const GenerationSchema = z.union([
  GenerationRequestSchema,
  GenerationAttemptViewSchema,
  GeneratedResultSchema,
  ResultAssessmentAttemptViewSchema,
]);

export type GenerationReferenceBinding = z.infer<typeof GenerationReferenceBindingSchema>;
export type GenerationProductionTarget = z.infer<typeof GenerationProductionTargetSchema>;
export type GenerationRequestReference = z.infer<typeof GenerationRequestReferenceSchema>;
export type GenerationSpec = z.infer<typeof GenerationSpecSchema>;
export type GenerationQuote = z.infer<typeof GenerationQuoteSchema>;
export type GenerationOutputIntent = z.infer<typeof GenerationOutputIntentSchema>;
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
export type GenerationAttemptRecord = z.infer<typeof GenerationAttemptRecordSchema>;
export type GenerationAttemptView = z.infer<typeof GenerationAttemptViewSchema>;
export type GeneratedResult = z.infer<typeof GeneratedResultSchema>;
export type GeneratedResultRef = z.infer<typeof GeneratedResultRefSchema>;
export type ResultAssessmentAttemptView = z.infer<typeof ResultAssessmentAttemptViewSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
