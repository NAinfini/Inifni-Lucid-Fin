import { z } from 'zod';
import { canonicalJson, strictObject } from './canonical.js';
import { GeneratedResultRefSchema } from './generation.js';
import { withAttemptCommonFields } from './operation.js';
import {
  CausationRefSchema,
  CountSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PositiveCountSchema,
  RevisionSchema,
  SafeLeafDisplayLabelSchema,
  Sha256Schema,
  UserChoiceRefSchema,
} from './primitives.js';
import { ProductionRefSchema } from './production.js';
import { ActiveProtectionSchema, DeliveryProtectedFieldRefSchema } from './protection.js';
import { ProjectRefSchema } from './project.js';

const MAX_DELIVERY_ITEMS = 20_000;

function canonicalUnique(values: unknown[]): boolean {
  return new Set(values.map((value) => canonicalJson(value))).size === values.length;
}

export const DeliveryRefSchema = strictObject({
  authority: z.literal('delivery'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const DeliveryManifestRefSchema = strictObject({
  authority: z.literal('delivery_manifest'),
  id: EntityIdSchema,
  revision: z.literal(0),
  contentHash: Sha256Schema,
});
export const DeliveryItemRefSchema = strictObject({
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const ProjectMediaRefSnapshotSchema = strictObject({
  authority: z.literal('project_media_ref'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});

export const DeliveryAudioPolicySchema = z.enum(['use', 'mute', 'replace']);
export const DeliveryReviewStateSchema = z.enum(['unreviewed', 'approved', 'changes_requested']);
export const DeliveryTransitionSchema = strictObject({
  kind: z.enum(['cut', 'crossfade', 'dip_to_black']),
  durationMs: CountSchema,
});
export const DeliveryTrimSchema = strictObject({
  startMs: CountSchema,
  endMs: PositiveCountSchema,
}).refine((trim) => trim.endMs > trim.startMs, { message: 'Delivery trim is reversed' });

export const DeliveryAllowedExtensionsSchema = z
  .array(z.string().regex(/^[A-Za-z0-9]{1,12}$/))
  .min(1)
  .max(20)
  .superRefine((extensions, context) => {
    const normalized = extensions.map((extension) => extension.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: 'custom',
        message: 'Delivery extensions must be unique ignoring case',
      });
    }
  });

const DeliveryDestinationIntentShape = {
  kind: z.enum(['user_selected_file', 'user_selected_folder']),
  grantId: EntityIdSchema,
  grantHash: Sha256Schema,
  displayLabel: SafeLeafDisplayLabelSchema,
};

export const DeliveryDestinationIntentSchema = strictObject(DeliveryDestinationIntentShape);

export const ScopedDeliveryDestinationIntentSchema = strictObject({
  ...DeliveryDestinationIntentShape,
  projectId: EntityIdSchema,
  deliveryPlan: DeliveryRefSchema,
  allowedExtensions: DeliveryAllowedExtensionsSchema,
});

export const DeliveryDestinationGrantV1Schema = strictObject({
  destination: ScopedDeliveryDestinationIntentSchema,
  expiresAt: IsoTimestampSchema,
});

export const DeliveryContainerSchema = z.enum(['mp4', 'mov', 'webm']);
export const DeliveryFormatIntentSchema = strictObject({
  container: DeliveryContainerSchema,
  videoCodec: z.enum(['h264', 'h265', 'prores', 'vp9', 'av1']),
  audioCodec: z.enum(['aac', 'pcm', 'opus']).nullable(),
  width: PositiveCountSchema,
  height: PositiveCountSchema,
  frameRate: PositiveCountSchema,
  quality: z.enum(['review', 'standard', 'high', 'master']),
});

export const DeliveryItemSemanticSnapshotSchema = strictObject({
  lifecycle: z.enum(['active', 'removed']),
  removedAt: IsoTimestampSchema.nullable(),
  shot: ProductionRefSchema,
  result: GeneratedResultRefSchema,
  projectMedia: ProjectMediaRefSnapshotSchema,
  order: CountSchema,
  trimStartMs: CountSchema,
  trimEndMs: PositiveCountSchema,
  audioPolicy: DeliveryAudioPolicySchema,
  transition: DeliveryTransitionSchema,
  reviewState: DeliveryReviewStateSchema,
}).superRefine((item, context) => {
  if (item.trimEndMs <= item.trimStartMs) {
    context.addIssue({
      code: 'custom',
      path: ['trimEndMs'],
      message: 'Delivery trim end must follow start',
    });
  }
  if ((item.lifecycle === 'removed') !== (item.removedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['removedAt'],
      message: 'Removed Delivery items require removedAt and active items forbid it',
    });
  }
});

export const DeliveryItemSchema = strictObject({
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  lifecycle: z.enum(['active', 'removed']),
  removedAt: IsoTimestampSchema.nullable(),
  shot: ProductionRefSchema,
  result: GeneratedResultRefSchema,
  projectMedia: ProjectMediaRefSnapshotSchema,
  order: CountSchema,
  trimStartMs: CountSchema,
  trimEndMs: PositiveCountSchema,
  audioPolicy: DeliveryAudioPolicySchema,
  transition: DeliveryTransitionSchema,
  reviewState: DeliveryReviewStateSchema,
}).superRefine((item, context) => {
  const { id: _id, revision: _revision, contentHash: _contentHash, ...semanticInput } = item;
  const semantic = DeliveryItemSemanticSnapshotSchema.safeParse(semanticInput);
  if (!semantic.success) {
    for (const issue of semantic.error.issues) {
      context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }
  }
});

export const DeliveryCurrentChoiceSchema = strictObject({
  field: DeliveryProtectedFieldRefSchema,
  choiceId: EntityIdSchema,
});

export const DeliveryPlanSchema = strictObject({
  authority: z.literal('delivery'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  name: z.string().trim().min(1).max(240),
  lifecycle: z.enum(['active', 'archived']),
  formatIntent: DeliveryFormatIntentSchema,
  items: z.array(DeliveryItemSchema).max(MAX_DELIVERY_ITEMS),
  currentChoices: z.array(DeliveryCurrentChoiceSchema).max(50_000),
  protections: z.array(ActiveProtectionSchema).max(50_000),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).superRefine((plan, context) => {
  const itemIds = new Set<string>();
  const activeOrders = new Set<number>();
  for (const [index, item] of plan.items.entries()) {
    if (itemIds.has(item.id)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'id'],
        message: 'Delivery item IDs must be unique',
      });
    }
    itemIds.add(item.id);
    if (item.lifecycle === 'active' && activeOrders.has(item.order)) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'order'],
        message: 'Active Delivery item order must be unique',
      });
    }
    if (item.lifecycle === 'active') activeOrders.add(item.order);
  }
  const scopedFields = [
    ...plan.currentChoices.map((entry) => entry.field),
    ...plan.protections.map((entry) => entry.field),
  ];
  for (const [index, field] of scopedFields.entries()) {
    if (field.owner !== 'delivery' || field.deliveryId !== plan.id) {
      context.addIssue({
        code: 'custom',
        path:
          index < plan.currentChoices.length
            ? ['currentChoices', index, 'field']
            : ['protections', index - plan.currentChoices.length, 'field'],
        message: 'Delivery field state must belong to its Plan',
      });
    }
  }
  if (!canonicalUnique(plan.currentChoices.map((entry) => entry.field))) {
    context.addIssue({
      code: 'custom',
      path: ['currentChoices'],
      message: 'Current Delivery choices must have unique fields',
    });
  }
  if (!canonicalUnique(plan.protections.map((entry) => entry.field))) {
    context.addIssue({
      code: 'custom',
      path: ['protections'],
      message: 'Active Delivery protections must have unique fields',
    });
  }
});

export function deliveryPlanContentHashInput(plan: z.output<typeof DeliveryPlanSchema>) {
  const { contentHash: _contentHash, ...snapshot } = plan;
  return {
    ...snapshot,
    items: [...snapshot.items].sort((left, right) => left.id.localeCompare(right.id)),
    currentChoices: [...snapshot.currentChoices].sort((left, right) =>
      canonicalJson(left.field).localeCompare(canonicalJson(right.field)),
    ),
    protections: [...snapshot.protections].sort((left, right) =>
      canonicalJson(left.field).localeCompare(canonicalJson(right.field)),
    ),
  };
}

export const DeliveryMutationCommandSchema = z.union([
  strictObject({
    action: z.literal('create'),
    project: ProjectRefSchema,
    name: z.string().trim().min(1).max(240),
    formatIntent: DeliveryFormatIntentSchema,
  }),
  strictObject({
    action: z.literal('updateSettings'),
    plan: DeliveryRefSchema,
    name: z.string().trim().min(1).max(240),
    formatIntent: DeliveryFormatIntentSchema,
  }),
  strictObject({
    action: z.literal('place'),
    plan: DeliveryRefSchema,
    shot: ProductionRefSchema,
    result: GeneratedResultRefSchema,
    order: CountSchema,
    trim: DeliveryTrimSchema,
    audioPolicy: DeliveryAudioPolicySchema,
    transition: DeliveryTransitionSchema,
  }),
  strictObject({
    action: z.literal('remove'),
    plan: DeliveryRefSchema,
    item: DeliveryItemRefSchema,
  }),
  strictObject({
    action: z.literal('reorder'),
    plan: DeliveryRefSchema,
    orderedItems: z
      .array(DeliveryItemRefSchema)
      .min(1)
      .max(MAX_DELIVERY_ITEMS)
      .refine(canonicalUnique, { message: 'Ordered Delivery item refs must be unique' }),
  }),
  strictObject({
    action: z.literal('trim'),
    plan: DeliveryRefSchema,
    item: DeliveryItemRefSchema,
    value: DeliveryTrimSchema,
  }),
  strictObject({
    action: z.literal('transition'),
    plan: DeliveryRefSchema,
    item: DeliveryItemRefSchema,
    value: DeliveryTransitionSchema,
  }),
  strictObject({
    action: z.literal('audioPolicy'),
    plan: DeliveryRefSchema,
    item: DeliveryItemRefSchema,
    value: DeliveryAudioPolicySchema,
  }),
  strictObject({
    action: z.literal('reviewState'),
    plan: DeliveryRefSchema,
    item: DeliveryItemRefSchema,
    value: DeliveryReviewStateSchema,
  }),
  strictObject({ action: z.literal('archive'), plan: DeliveryRefSchema }),
  strictObject({ action: z.literal('restore'), plan: DeliveryRefSchema }),
]);

export const DeliveryManifestItemSchema = strictObject({
  deliveryItemId: EntityIdSchema,
  deliveryItemRevision: RevisionSchema,
  deliveryItemContentHash: Sha256Schema,
  shotId: EntityIdSchema,
  shotRevision: RevisionSchema,
  shotContentHash: Sha256Schema,
  generatedResultId: EntityIdSchema,
  generatedResultRevision: z.literal(0),
  generatedResultContentHash: Sha256Schema,
  projectMediaRefId: EntityIdSchema,
  projectMediaRevision: RevisionSchema,
  projectMediaContentHash: Sha256Schema,
  globalAssetId: EntityIdSchema,
  globalAssetRevision: RevisionSchema,
  globalAssetContentHash: Sha256Schema,
  blobHash: Sha256Schema,
  order: CountSchema,
  trimStartMs: CountSchema,
  trimEndMs: PositiveCountSchema,
  audioPolicy: DeliveryAudioPolicySchema,
  transition: DeliveryTransitionSchema,
  reviewState: DeliveryReviewStateSchema,
}).refine((item) => item.trimEndMs > item.trimStartMs, {
  message: 'Delivery manifest trim end must follow start',
});
export const DeliveryManifestChoiceSchema = strictObject({
  field: DeliveryProtectedFieldRefSchema,
  choice: UserChoiceRefSchema,
});
export const DeliveryManifestSchema = strictObject({
  authority: z.literal('delivery_manifest'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  revision: z.literal(0),
  contentHash: Sha256Schema,
  sourcePlan: DeliveryRefSchema,
  formatIntent: DeliveryFormatIntentSchema,
  items: z.array(DeliveryManifestItemSchema).max(MAX_DELIVERY_ITEMS),
  currentChoices: z.array(DeliveryManifestChoiceSchema).max(50_000),
  protections: z.array(DeliveryManifestChoiceSchema).max(50_000),
  createdBy: CausationRefSchema,
  frozenAt: IsoTimestampSchema,
}).superRefine((manifest, context) => {
  const itemIds = manifest.items.map((item) => item.deliveryItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Manifest item IDs must be unique',
    });
  }
  for (const [group, entries] of [
    ['currentChoices', manifest.currentChoices],
    ['protections', manifest.protections],
  ] as const) {
    if (!canonicalUnique(entries.map((entry) => entry.field))) {
      context.addIssue({
        code: 'custom',
        path: [group],
        message: `Manifest ${group} fields must be unique`,
      });
    }
    for (const [index, entry] of entries.entries()) {
      if (entry.field.deliveryId !== manifest.sourcePlan.id) {
        context.addIssue({
          code: 'custom',
          path: [group, index, 'field', 'deliveryId'],
          message: 'Manifest field snapshots must belong to the source Plan',
        });
      }
    }
  }
});

export function deliveryManifestContentHashInput(
  manifest: z.output<typeof DeliveryManifestSchema>,
) {
  const { contentHash: _contentHash, ...snapshot } = manifest;
  return snapshot;
}

export const DeliveryItemRangeSchema = strictObject({
  startItem: CountSchema,
  endItem: CountSchema,
}).refine((range) => range.endItem >= range.startItem, {
  message: 'Delivery item range is reversed',
});
export const ReviewCutRequestSchema = strictObject({
  manifest: DeliveryManifestRefSchema,
  range: DeliveryItemRangeSchema.nullable(),
});
export const DeliveryPreviewRequestSchema = strictObject({
  plan: DeliveryRefSchema,
  range: DeliveryItemRangeSchema.nullable(),
});

export const ReviewCutAttemptSchema = withAttemptCommonFields({
  authority: z.literal('review_cut_attempt'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  manifest: DeliveryManifestRefSchema,
  request: ReviewCutRequestSchema,
  requestHash: Sha256Schema,
  idempotencyKey: Sha256Schema,
  provider: z.null(),
  receipt: z.null(),
  usage: z.null(),
  outputBlobHash: Sha256Schema.nullable(),
}).superRefine((attempt, context) => {
  if (canonicalJson(attempt.manifest) !== canonicalJson(attempt.request.manifest)) {
    context.addIssue({
      code: 'custom',
      path: ['request', 'manifest'],
      message: 'Review Cut request must bind the exact manifest',
    });
  }
  if (attempt.state === 'submitted' || attempt.state === 'unknown') {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'Local Review Cut cannot enter provider states',
    });
  }
  if ((attempt.state === 'succeeded') !== (attempt.outputBlobHash !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['outputBlobHash'],
      message: 'Successful Review Cut requires exactly one output blob',
    });
  }
});

export const DeliveryExportSchema = withAttemptCommonFields({
  authority: z.literal('delivery_export'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  runId: EntityIdSchema,
  manifest: DeliveryManifestRefSchema,
  destination: DeliveryDestinationIntentSchema,
  overwriteExisting: z.boolean(),
  requestHash: Sha256Schema,
  idempotencyKey: Sha256Schema,
  provider: z.null(),
  receipt: z.null(),
  usage: z.null(),
  outputBlobHash: Sha256Schema.nullable(),
  outputContentHash: Sha256Schema.nullable(),
}).superRefine((attempt, context) => {
  if (attempt.state === 'submitted' || attempt.state === 'unknown') {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'Local Delivery Export cannot enter provider states',
    });
  }
  const hasOutput = attempt.outputBlobHash !== null && attempt.outputContentHash !== null;
  if ((attempt.outputBlobHash === null) !== (attempt.outputContentHash === null)) {
    context.addIssue({
      code: 'custom',
      path: ['outputContentHash'],
      message: 'Delivery Export output hashes must be present together',
    });
  }
  if ((attempt.state === 'succeeded') !== hasOutput) {
    context.addIssue({
      code: 'custom',
      path: ['outputBlobHash'],
      message: 'Successful Delivery Export requires exact output hashes',
    });
  }
});

export const DeliverySchema = DeliveryPlanSchema;

export type DeliveryRef = z.infer<typeof DeliveryRefSchema>;
export type DeliveryManifestRef = z.infer<typeof DeliveryManifestRefSchema>;
export type DeliveryItemRef = z.infer<typeof DeliveryItemRefSchema>;
export type DeliveryItem = z.infer<typeof DeliveryItemSchema>;
export type DeliveryItemSemanticSnapshot = z.infer<typeof DeliveryItemSemanticSnapshotSchema>;
export type DeliveryDestinationIntent = z.infer<typeof DeliveryDestinationIntentSchema>;
export type ScopedDeliveryDestinationIntent = z.infer<
  typeof ScopedDeliveryDestinationIntentSchema
>;
export type DeliveryDestinationGrantV1 = z.infer<typeof DeliveryDestinationGrantV1Schema>;
export type DeliveryFormatIntent = z.infer<typeof DeliveryFormatIntentSchema>;
export type DeliveryMutationCommand = z.infer<typeof DeliveryMutationCommandSchema>;
export type DeliveryPlan = z.infer<typeof DeliveryPlanSchema>;
export type ReviewCutRequest = z.infer<typeof ReviewCutRequestSchema>;
export type ReviewCutAttempt = z.infer<typeof ReviewCutAttemptSchema>;
export type DeliveryManifest = z.infer<typeof DeliveryManifestSchema>;
export type DeliveryExport = z.infer<typeof DeliveryExportSchema>;
export type Delivery = z.infer<typeof DeliverySchema>;
