import { z } from 'zod';
import { strictObject } from './canonical.js';
import { OperationRefSchema, withAttemptCommonFields } from './operation.js';
import {
  ArtifactRefSchema,
  CausationRefSchema,
  CountSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PositiveCountSchema,
  ProviderModelSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';

export const MediaKindSchema = z.enum(['image', 'video', 'audio', 'document']);

export const ImageTechnicalFactsSchema = strictObject({
  kind: z.literal('image'),
  width: PositiveCountSchema,
  height: PositiveCountSchema,
});
export const VideoTechnicalFactsSchema = strictObject({
  kind: z.literal('video'),
  width: PositiveCountSchema,
  height: PositiveCountSchema,
  durationMs: PositiveCountSchema,
  frameRate: PositiveCountSchema,
  hasAudio: z.boolean(),
});
export const AudioTechnicalFactsSchema = strictObject({
  kind: z.literal('audio'),
  durationMs: PositiveCountSchema,
  sampleRateHz: PositiveCountSchema,
  channels: PositiveCountSchema,
});
export const DocumentTechnicalFactsSchema = strictObject({
  kind: z.literal('document'),
  pageCount: PositiveCountSchema.nullable(),
});
export const MediaTechnicalFactsSchema = z.union([
  ImageTechnicalFactsSchema,
  VideoTechnicalFactsSchema,
  AudioTechnicalFactsSchema,
  DocumentTechnicalFactsSchema,
]);

export const MediaSourceSelectorSchema = z.union([
  strictObject({ kind: z.literal('project_media_ref'), id: EntityIdSchema }),
  strictObject({ kind: z.literal('global_asset'), id: EntityIdSchema }),
  strictObject({
    kind: z.literal('accepted_attachment'),
    id: EntityIdSchema.describe(
      'projectMediaRefId from an attachment in the current Run ContextManifest',
    ),
  }),
  strictObject({ kind: z.literal('generated_result'), id: EntityIdSchema }),
]);

export const MediaBlobSchema = strictObject({
  authority: z.literal('media_blob'),
  hash: Sha256Schema,
  byteLength: CountSchema,
  mimeType: z.string().trim().min(1).max(160),
  technicalFacts: MediaTechnicalFactsSchema,
  createdAt: IsoTimestampSchema,
});

export const ImportedMediaSourceSchema = strictObject({
  kind: z.literal('imported'),
  originalFileName: z.string().trim().min(1).max(512),
  importId: EntityIdSchema,
});
export const GeneratedMediaSourceSchema = strictObject({
  kind: z.literal('generated'),
  attemptId: EntityIdSchema,
  resultId: EntityIdSchema,
});
export const DerivedMediaSourceSchema = strictObject({
  kind: z.literal('derived'),
  derivationId: EntityIdSchema,
  sourceBlobHash: Sha256Schema,
});
export const MediaSourceSchema = z.union([
  ImportedMediaSourceSchema,
  GeneratedMediaSourceSchema,
  DerivedMediaSourceSchema,
]);

export const GlobalMediaFolderSchema = strictObject({
  authority: z.literal('global_media_folder'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  parentId: EntityIdSchema.nullable(),
  name: z.string().trim().min(1).max(240),
  sortOrder: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).finite(),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).superRefine(({ id, parentId }, context) => {
  if (parentId === id) {
    context.addIssue({
      code: 'custom',
      path: ['parentId'],
      message: 'Global Media Folder cannot be its own parent',
    });
  }
});

export const GlobalMediaTagsSchema = z.array(z.string().trim().min(1).max(80)).max(100);

export const GlobalMediaAssetSchema = strictObject({
  authority: z.literal('global_media_asset'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  blobHash: Sha256Schema,
  kind: MediaKindSchema,
  filename: z.string().trim().min(1).max(512),
  displayName: z.string().trim().min(1).max(240),
  source: MediaSourceSchema,
  folderId: EntityIdSchema.nullable(),
  tags: GlobalMediaTagsSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export const ProjectMediaRoleSchema = z.enum([
  'reference',
  'character',
  'location',
  'equipment',
  'prop',
  'wardrobe',
  'storyboard',
  'generated_candidate',
  'delivery_source',
]);
export const ProjectMediaProductionLinkSchema = strictObject({
  productionObjectId: EntityIdSchema,
  relation: z.enum(['depicts', 'references', 'generated_for', 'selected_for']),
});
export const ProjectMediaLifecycleSchema = z.enum(['active', 'detached']);
export const ProjectMediaRefSchema = strictObject({
  authority: z.literal('project_media_ref'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  globalAssetId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  lifecycle: ProjectMediaLifecycleSchema,
  detachedAt: IsoTimestampSchema.nullable(),
  label: z.string().trim().min(1).max(240),
  collections: z.array(z.string().trim().min(1).max(120)).max(100),
  roles: z.array(ProjectMediaRoleSchema).min(1).max(20),
  notes: z.string().max(10_000),
  productionLinks: z.array(ProjectMediaProductionLinkSchema).max(500),
  createdBy: CausationRefSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).superRefine(({ lifecycle, detachedAt }, context) => {
  if ((lifecycle === 'detached') !== (detachedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['detachedAt'],
      message: 'Detached media requires detachedAt and active media forbids it',
    });
  }
});

export const ProjectMediaLinkInputSchema = strictObject({
  mode: z.enum(['link', 'unlink']),
  mediaRef: strictObject({
    authority: z.literal('project_media_ref'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
  target: strictObject({
    authority: z.literal('production'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }),
  relation: z.enum(['depicts', 'references']),
});

export const ProjectMediaLinkSuccessSchema = strictObject({
  object: ProjectMediaRefSchema,
  previousRevision: RevisionSchema,
  eventId: EntityIdSchema,
  changedPaths: z.tuple([z.literal('productionLinks')]),
  undoRef: z.null(),
});

export const ExtractFramesTransformSchema = strictObject({
  operation: z.literal('extractFrames'),
  timecodesMs: z
    .array(CountSchema)
    .min(1)
    .max(100)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Frame timecodes must be unique',
    }),
  imageFormat: z.enum(['png', 'jpeg', 'webp']),
});
export const ClipTransformSchema = strictObject({
  operation: z.literal('clip'),
  startMs: CountSchema,
  endMs: PositiveCountSchema,
}).refine((clip) => clip.endMs > clip.startMs, { message: 'Clip end must follow start' });
export const CropTransformSchema = strictObject({
  operation: z.literal('crop'),
  x: CountSchema,
  y: CountSchema,
  width: PositiveCountSchema,
  height: PositiveCountSchema,
});
export const ResizeTransformSchema = strictObject({
  operation: z.literal('resize'),
  width: PositiveCountSchema,
  height: PositiveCountSchema,
  fit: z.enum(['contain', 'cover', 'fill']),
});
export const ProxyTransformSchema = strictObject({
  operation: z.literal('proxyTranscode'),
  container: z.enum(['mp4', 'webm', 'mov']),
  maxWidth: PositiveCountSchema,
  maxHeight: PositiveCountSchema,
  quality: z.number().min(1).max(100).finite(),
});
export const AudioExtractionTransformSchema = strictObject({
  operation: z.literal('extractAudio'),
  format: z.enum(['wav', 'mp3', 'aac', 'flac']),
  sampleRateHz: PositiveCountSchema.max(384_000),
});
export const WaveformTransformSchema = strictObject({
  operation: z.literal('waveform'),
  width: PositiveCountSchema.max(8_192),
  height: PositiveCountSchema.max(8_192),
});
export const OcrTransformSchema = strictObject({
  operation: z.literal('ocr'),
  language: z.string().trim().min(2).max(35),
  pageNumbers: z
    .array(PositiveCountSchema)
    .max(100)
    .refine((values) => new Set(values).size === values.length, {
      message: 'OCR page numbers must be unique',
    }),
});
export const TranscriptionTransformSchema = strictObject({
  operation: z.literal('transcribe'),
  language: z.string().trim().min(2).max(35).nullable(),
  provider: strictObject({
    providerId: EntityIdSchema,
    model: z.string().trim().min(1).max(200),
  }).nullable(),
});
export const MediaDerivationTransformSchema = z.union([
  ExtractFramesTransformSchema,
  ClipTransformSchema,
  CropTransformSchema,
  ResizeTransformSchema,
  ProxyTransformSchema,
  AudioExtractionTransformSchema,
  WaveformTransformSchema,
  OcrTransformSchema,
  TranscriptionTransformSchema,
]);

export const MediaDerivationSchema = strictObject({
  authority: z.literal('media_derivation'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  sourceBlobHash: Sha256Schema,
  transform: MediaDerivationTransformSchema,
  requestHash: Sha256Schema,
  idempotencyKey: Sha256Schema,
  createdAt: IsoTimestampSchema,
});

export function mediaDerivationRequestHashInput(
  derivation: z.output<typeof MediaDerivationSchema>,
) {
  return { sourceBlobHash: derivation.sourceBlobHash, transform: derivation.transform } as const;
}

export const MediaDerivationAttemptViewSchema = withAttemptCommonFields({
  authority: z.literal('media_derivation_attempt'),
  id: EntityIdSchema,
  derivation: MediaDerivationSchema,
  attemptNumber: PositiveCountSchema,
  provider: ProviderModelSchema.nullable(),
}).superRefine((attempt, context) => {
  const external = attempt.derivation.transform.operation === 'transcribe';
  if (external) {
    if (attempt.provider === null) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Transcription Attempts require a resolved provider',
      });
    }
    if (attempt.state === 'submitted' && attempt.receipt === null) {
      context.addIssue({
        code: 'custom',
        path: ['receipt'],
        message: `${attempt.state} transcription requires the persisted provider receipt`,
      });
    }
  } else {
    if (attempt.provider !== null || attempt.receipt !== null) {
      context.addIssue({
        code: 'custom',
        path: ['provider'],
        message: 'Local Media Derivation Attempts cannot contain provider state',
      });
    }
    if (attempt.state === 'submitted' || attempt.state === 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Local Media Derivation Attempts cannot enter provider submission states',
      });
    }
  }
});

export const MediaDerivationOutputSchema = strictObject({
  id: EntityIdSchema,
  derivationAttemptId: EntityIdSchema,
  blobHash: Sha256Schema,
  globalAssetId: EntityIdSchema,
  projectMediaRefId: EntityIdSchema.nullable(),
  ordinal: CountSchema,
});

export function mediaDerivationOutputIdentityInput(
  output: z.output<typeof MediaDerivationOutputSchema>,
) {
  return {
    derivationAttemptId: output.derivationAttemptId,
    ordinal: output.ordinal,
    blobHash: output.blobHash,
  } as const;
}

export const MediaDeriveAttachmentSchema = strictObject({
  enabled: z.boolean(),
  expectedProjectRevision: RevisionSchema.nullable(),
}).superRefine((attachment, context) => {
  if (attachment.enabled !== (attachment.expectedProjectRevision !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['expectedProjectRevision'],
      message: 'Project revision is required exactly when derivative attachment is enabled',
    });
  }
});

function uniqueValues(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

export const MediaDeriveOutputIntentSchema = strictObject({
  ordinal: CountSchema,
  globalAsset: strictObject({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .refine((filename) => !/[\\/]/.test(filename), {
        message: 'Derivative filename must be a leaf name',
      }),
    displayName: z.string().trim().min(1).max(240),
    folderId: EntityIdSchema.nullable(),
    tags: z
      .array(z.string().trim().min(1).max(80))
      .max(100)
      .refine(uniqueValues, { message: 'Derivative tags must be unique' }),
  }),
  projectMediaRef: strictObject({
    label: z.string().trim().min(1).max(240),
    collections: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .refine(uniqueValues, { message: 'Derivative collections must be unique' }),
    roles: z
      .array(ProjectMediaRoleSchema)
      .min(1)
      .max(20)
      .refine(uniqueValues, { message: 'Derivative roles must be unique' }),
    notes: z.string().max(10_000),
  }).nullable(),
});

const MediaDeriveOutputIntentsSchema = z
  .array(MediaDeriveOutputIntentSchema)
  .min(1)
  .max(100)
  .superRefine((intents, context) => {
    intents.forEach((intent, index) => {
      if (intent.ordinal !== index) {
        context.addIssue({
          code: 'custom',
          path: [index, 'ordinal'],
          message: 'Derivative output ordinals must be contiguous from zero',
        });
      }
    });
  });

const MediaDeriveBase = {
  source: MediaSourceSelectorSchema,
  expectedSourceHash: Sha256Schema,
  attach: MediaDeriveAttachmentSchema,
  outputIntents: MediaDeriveOutputIntentsSchema,
} as const;
const MediaDeriveInputVariantSchema = z.union([
  strictObject({
    operation: z.literal('extractFrames'),
    ...MediaDeriveBase,
    timecodesMs: z
      .array(CountSchema)
      .min(1)
      .max(100)
      .refine((values) => new Set(values).size === values.length, {
        message: 'Frame timecodes must be unique',
      }),
    imageFormat: z.enum(['png', 'jpeg', 'webp']),
  }),
  strictObject({
    operation: z.literal('clip'),
    ...MediaDeriveBase,
    startMs: CountSchema,
    endMs: PositiveCountSchema,
  }).refine((clip) => clip.endMs > clip.startMs, { message: 'Clip range is reversed' }),
  strictObject({
    operation: z.literal('crop'),
    ...MediaDeriveBase,
    x: CountSchema,
    y: CountSchema,
    width: PositiveCountSchema,
    height: PositiveCountSchema,
  }),
  strictObject({
    operation: z.literal('resize'),
    ...MediaDeriveBase,
    width: PositiveCountSchema,
    height: PositiveCountSchema,
    fit: z.enum(['contain', 'cover', 'fill']),
  }),
  strictObject({
    operation: z.literal('proxyTranscode'),
    ...MediaDeriveBase,
    container: z.enum(['mp4', 'webm', 'mov']),
    maxWidth: PositiveCountSchema,
    maxHeight: PositiveCountSchema,
    quality: z.number().min(1).max(100).finite(),
  }),
  strictObject({
    operation: z.literal('extractAudio'),
    ...MediaDeriveBase,
    format: z.enum(['wav', 'mp3', 'aac', 'flac']),
    sampleRateHz: PositiveCountSchema.max(384_000),
  }),
  strictObject({
    operation: z.literal('waveform'),
    ...MediaDeriveBase,
    width: PositiveCountSchema.max(8_192),
    height: PositiveCountSchema.max(8_192),
  }),
  strictObject({
    operation: z.literal('ocr'),
    ...MediaDeriveBase,
    language: z.string().trim().min(2).max(35),
    pageNumbers: z
      .array(PositiveCountSchema)
      .max(100)
      .refine((values) => new Set(values).size === values.length, {
        message: 'OCR page numbers must be unique',
      }),
  }),
  strictObject({
    operation: z.literal('transcribe'),
    ...MediaDeriveBase,
    language: z.string().trim().min(2).max(35).nullable(),
    provider: strictObject({
      providerId: EntityIdSchema,
      model: z.string().trim().min(1).max(200),
    }).nullable(),
  }),
]);
export const MediaDeriveInputSchema = MediaDeriveInputVariantSchema.superRefine(
  (input, context) => {
    const expectedOutputCount = input.operation === 'extractFrames' ? input.timecodesMs.length : 1;
    if (input.outputIntents.length !== expectedOutputCount) {
      context.addIssue({
        code: 'custom',
        path: ['outputIntents'],
        message:
          input.operation === 'extractFrames'
            ? 'Frame output intents must match frame timecodes one-for-one'
            : 'This derivative operation requires exactly one output intent',
      });
    }
    input.outputIntents.forEach((intent, index) => {
      if (input.attach.enabled !== (intent.projectMediaRef !== null)) {
        context.addIssue({
          code: 'custom',
          path: ['outputIntents', index, 'projectMediaRef'],
          message: input.attach.enabled
            ? 'Attached derivatives require Project Media metadata for every output'
            : 'Detached derivatives forbid Project Media metadata',
        });
      }
    });
  },
);
export const MediaDeriveSuccessSchema = strictObject({
  operation: OperationRefSchema,
  derivationId: EntityIdSchema,
  attemptId: EntityIdSchema,
  requestHash: Sha256Schema,
  artifacts: z.array(ArtifactRefSchema).max(100),
  globalAssets: z.array(GlobalMediaAssetSchema).max(100),
  projectMediaRefs: z.array(ProjectMediaRefSchema).max(100),
});

export const MediaSchema = z.union([
  MediaBlobSchema,
  GlobalMediaFolderSchema,
  GlobalMediaAssetSchema,
  ProjectMediaRefSchema,
  MediaDerivationSchema,
  MediaDerivationAttemptViewSchema,
]);

export type MediaKind = z.infer<typeof MediaKindSchema>;
export type MediaTechnicalFacts = z.infer<typeof MediaTechnicalFactsSchema>;
export type MediaBlob = z.infer<typeof MediaBlobSchema>;
export type GlobalMediaFolder = z.infer<typeof GlobalMediaFolderSchema>;
export type GlobalMediaAsset = z.infer<typeof GlobalMediaAssetSchema>;
export type ProjectMediaRole = z.infer<typeof ProjectMediaRoleSchema>;
export type ProjectMediaLifecycle = z.infer<typeof ProjectMediaLifecycleSchema>;
export type ProjectMediaRef = z.infer<typeof ProjectMediaRefSchema>;
export type ProjectMediaLinkInput = z.infer<typeof ProjectMediaLinkInputSchema>;
export type ProjectMediaLinkSuccess = z.infer<typeof ProjectMediaLinkSuccessSchema>;
export type MediaDerivationTransform = z.infer<typeof MediaDerivationTransformSchema>;
export type MediaDerivation = z.infer<typeof MediaDerivationSchema>;
export type MediaDerivationAttemptView = z.infer<typeof MediaDerivationAttemptViewSchema>;
export type MediaDerivationOutput = z.infer<typeof MediaDerivationOutputSchema>;
export type MediaDeriveOutputIntent = z.infer<typeof MediaDeriveOutputIntentSchema>;
export type Media = z.infer<typeof MediaSchema>;
