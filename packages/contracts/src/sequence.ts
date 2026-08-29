import { z } from 'zod';
import { canonicalJson, strictObject } from './canonical.js';
import { GeneratedResultRefSchema } from './generation.js';
import {
  CountSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PositiveCountSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';
import { ProductionRefSchema } from './production.js';

const MAX_SEQUENCE_ITEMS = 20_000;

export const SequenceLifecycleSchema = z.enum(['active', 'archived']);
export const SequenceRefSchema = strictObject({
  authority: z.literal('sequence'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const SequenceItemRefSchema = strictObject({
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
export const SequenceClipAudioPolicySchema = z.enum(['use', 'mute', 'replace']);
export const SequenceClipReviewStateSchema = z.enum([
  'unreviewed',
  'approved',
  'changes_requested',
]);
export const SequenceClipTransitionSchema = strictObject({
  kind: z.enum(['cut', 'crossfade', 'dip_to_black']),
  durationMs: CountSchema,
});
export const SequenceClipTrimSchema = strictObject({
  startMs: CountSchema,
  endMs: PositiveCountSchema,
}).refine((trim) => trim.endMs > trim.startMs, { message: 'Sequence clip trim is reversed' });

const sequenceItemBase = {
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  ordinal: CountSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
} as const;

export const SequenceSceneItemSchema = strictObject({
  ...sequenceItemBase,
  kind: z.literal('scene'),
  parentItemId: z.null(),
  scene: ProductionRefSchema,
});
export const SequenceShotItemSchema = strictObject({
  ...sequenceItemBase,
  kind: z.literal('shot'),
  parentItemId: EntityIdSchema,
  shot: ProductionRefSchema,
});
export const SequenceClipItemSchema = strictObject({
  ...sequenceItemBase,
  kind: z.literal('clip'),
  parentItemId: EntityIdSchema,
  result: GeneratedResultRefSchema,
  trim: SequenceClipTrimSchema,
  audioPolicy: SequenceClipAudioPolicySchema,
  transition: SequenceClipTransitionSchema,
  reviewState: SequenceClipReviewStateSchema,
});
export const SequenceItemSchema = z.union([
  SequenceSceneItemSchema,
  SequenceShotItemSchema,
  SequenceClipItemSchema,
]);

export function sequenceItemContentHashInput(item: z.output<typeof SequenceItemSchema>) {
  const { contentHash: _contentHash, ...snapshot } = item;
  return snapshot;
}

export const SequenceDocumentSchema = strictObject({
  authority: z.literal('sequence'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  name: z.string().trim().min(1).max(240),
  lifecycle: SequenceLifecycleSchema,
  items: z.array(SequenceItemSchema).max(MAX_SEQUENCE_ITEMS),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
  archivedAt: IsoTimestampSchema.nullable(),
}).superRefine((sequence, context) => {
  if ((sequence.lifecycle === 'archived') !== (sequence.archivedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['archivedAt'],
      message: 'Archived Sequences require archivedAt and active Sequences forbid it',
    });
  }
  const items = new Map(sequence.items.map((item) => [item.id, item]));
  if (items.size !== sequence.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Sequence item IDs must be unique' });
  }
  const siblingOrdinals = new Map<string, number[]>();
  for (const [index, item] of sequence.items.entries()) {
    const parent = item.parentItemId === null ? null : items.get(item.parentItemId);
    if (item.kind === 'scene' && item.parentItemId !== null) {
      context.addIssue({ code: 'custom', path: ['items', index, 'parentItemId'], message: 'Scenes are roots' });
    }
    if (item.kind === 'shot' && (parent === undefined || parent.kind !== 'scene')) {
      context.addIssue({ code: 'custom', path: ['items', index, 'parentItemId'], message: 'Shots require a Scene parent' });
    }
    if (item.kind === 'clip' && (parent === undefined || parent.kind !== 'shot')) {
      context.addIssue({ code: 'custom', path: ['items', index, 'parentItemId'], message: 'Clips require a Shot parent' });
    }
    const key = item.parentItemId ?? '';
    const ordinals = siblingOrdinals.get(key) ?? [];
    ordinals.push(item.ordinal);
    siblingOrdinals.set(key, ordinals);
  }
  for (const [parentItemId, ordinals] of siblingOrdinals) {
    const sorted = [...ordinals].sort((left, right) => left - right);
    if (sorted.some((ordinal, index) => ordinal !== index)) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: `Sequence siblings under ${parentItemId || 'root'} must have dense ordinals`,
      });
    }
  }
});

export function sequenceDocumentContentHashInput(sequence: z.output<typeof SequenceDocumentSchema>) {
  const { contentHash: _contentHash, ...snapshot } = sequence;
  return {
    ...snapshot,
    items: [...snapshot.items].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export const SequenceMutationCommandSchema = z.union([
  strictObject({
    action: z.literal('append_scene'),
    scene: ProductionRefSchema,
  }),
  strictObject({
    action: z.literal('append_shot'),
    sceneItem: SequenceItemRefSchema,
    shot: ProductionRefSchema,
  }),
  strictObject({
    action: z.literal('append_clip'),
    shotItem: SequenceItemRefSchema,
    result: GeneratedResultRefSchema,
    trim: SequenceClipTrimSchema,
    audioPolicy: SequenceClipAudioPolicySchema,
    transition: SequenceClipTransitionSchema,
    reviewState: SequenceClipReviewStateSchema,
  }),
  strictObject({
    action: z.literal('update_clip'),
    item: SequenceItemRefSchema,
    result: GeneratedResultRefSchema,
    trim: SequenceClipTrimSchema,
    audioPolicy: SequenceClipAudioPolicySchema,
    transition: SequenceClipTransitionSchema,
    reviewState: SequenceClipReviewStateSchema,
  }),
  strictObject({
    action: z.literal('move'),
    item: SequenceItemRefSchema,
    parentItemId: EntityIdSchema.nullable(),
    index: CountSchema,
  }),
  strictObject({
    action: z.literal('reorder'),
    parentItemId: EntityIdSchema.nullable(),
    orderedItems: z
      .array(SequenceItemRefSchema)
      .min(1)
      .max(MAX_SEQUENCE_ITEMS)
      .refine(
        (items) => new Set(items.map((item) => canonicalJson(item))).size === items.length,
        { message: 'Ordered Sequence item refs must be unique' },
      ),
  }),
  strictObject({ action: z.literal('remove'), item: SequenceItemRefSchema }),
  strictObject({ action: z.literal('rename'), name: z.string().trim().min(1).max(240) }),
  strictObject({ action: z.literal('archive') }),
  strictObject({ action: z.literal('restore') }),
]);

export type SequenceRef = z.infer<typeof SequenceRefSchema>;
export type SequenceItemRef = z.infer<typeof SequenceItemRefSchema>;
export type SequenceLifecycle = z.infer<typeof SequenceLifecycleSchema>;
export type SequenceClipTrim = z.infer<typeof SequenceClipTrimSchema>;
export type SequenceClipTransition = z.infer<typeof SequenceClipTransitionSchema>;
export type SequenceClipAudioPolicy = z.infer<typeof SequenceClipAudioPolicySchema>;
export type SequenceClipReviewState = z.infer<typeof SequenceClipReviewStateSchema>;
export type SequenceItem = z.infer<typeof SequenceItemSchema>;
export type SequenceDocument = z.infer<typeof SequenceDocumentSchema>;
