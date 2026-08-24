import { z } from 'zod';
import { strictObject } from './canonical.js';
import {
  CausationRefSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  CountSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';
import { GeneratedResultRefSchema } from './generation.js';
import { ActiveProtectionSchema } from './protection.js';

export const ProductionObjectTypeSchema = z.enum([
  'direction',
  'story',
  'sequence',
  'scene',
  'beat',
  'character',
  'location',
  'equipment',
  'prop',
  'wardrobe',
  'world_fact',
  'shot',
]);
export const ProductionLifecycleSchema = z.enum(['active', 'archived', 'deleted']);
export const ProductionCitationFieldSchema = z.enum([
  'summary',
  'visual_language',
  'tone',
  'constraints',
  'title',
  'premise',
  'synopsis',
  'description',
  'traits',
  'duration',
  'camera',
]);

export const ProductionRefSchema = strictObject({
  authority: z.literal('production'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});

export const ProductionRelationSchema = strictObject({
  relation: z.enum([
    'contains',
    'appears_in',
    'uses',
    'located_at',
    'continues_from',
    'references',
  ]),
  targetType: ProductionObjectTypeSchema,
  targetId: EntityIdSchema,
  ordinal: CountSchema.nullable(),
}).refine((relation) => (relation.relation === 'contains') === (relation.ordinal !== null), {
  message: 'Only containment relations have an ordinal',
});

export const FactProtectionSchema = ActiveProtectionSchema;

const productionBase = {
  authority: z.literal('production'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  lifecycle: ProductionLifecycleSchema,
  relations: z.array(ProductionRelationSchema).max(500),
  protections: z.array(FactProtectionSchema).max(200),
  createdBy: CausationRefSchema,
  updatedBy: CausationRefSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
} as const;

export const DirectionContentSchema = strictObject({
  summary: z.string().trim().min(1).max(20_000),
  visualLanguage: z.string().trim().min(1).max(20_000),
  tone: z.string().trim().min(1).max(4_000),
  constraints: z.array(z.string().trim().min(1).max(2_000)).max(100),
});
export const StoryContentSchema = strictObject({
  title: z.string().trim().min(1).max(240),
  premise: z.string().trim().min(1).max(4_000),
  synopsis: z.string().trim().min(1).max(40_000),
});
export const OrderedNarrativeContentSchema = strictObject({
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(20_000),
});
export const NamedWorldContentSchema = strictObject({
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(20_000),
  traits: z.array(z.string().trim().min(1).max(1_000)).max(100),
});
export const ShotContentSchema = strictObject({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(20_000),
  durationMs: CountSchema.nullable(),
  shotSize: z.enum(['extreme_wide', 'wide', 'medium', 'close_up', 'extreme_close_up']).nullable(),
  cameraMovement: z
    .enum(['static', 'pan', 'tilt', 'dolly', 'truck', 'crane', 'handheld', 'orbit'])
    .nullable(),
});

export const ShotResultDecisionValueSchema = z.union([
  strictObject({ state: z.literal('selected'), feedback: z.string().max(20_000) }),
  strictObject({
    state: z.literal('rejected'),
    feedback: z.string().trim().min(1).max(20_000),
  }),
  strictObject({
    state: z.literal('refine'),
    instruction: z.string().trim().min(1).max(20_000),
  }),
  strictObject({ state: z.literal('reference'), feedback: z.string().max(20_000) }),
]);
export const ShotResultDecisionSchema = strictObject({
  result: GeneratedResultRefSchema,
  value: ShotResultDecisionValueSchema,
  currentChoiceId: EntityIdSchema,
});

export const ProductionTypedContentSchema = z.union([
  strictObject({ objectType: z.literal('direction'), content: DirectionContentSchema }),
  strictObject({ objectType: z.literal('story'), content: StoryContentSchema }),
  strictObject({ objectType: z.literal('sequence'), content: OrderedNarrativeContentSchema }),
  strictObject({ objectType: z.literal('scene'), content: OrderedNarrativeContentSchema }),
  strictObject({ objectType: z.literal('beat'), content: OrderedNarrativeContentSchema }),
  strictObject({ objectType: z.literal('character'), content: NamedWorldContentSchema }),
  strictObject({ objectType: z.literal('location'), content: NamedWorldContentSchema }),
  strictObject({ objectType: z.literal('equipment'), content: NamedWorldContentSchema }),
  strictObject({ objectType: z.literal('prop'), content: NamedWorldContentSchema }),
  strictObject({ objectType: z.literal('wardrobe'), content: NamedWorldContentSchema }),
  strictObject({ objectType: z.literal('world_fact'), content: NamedWorldContentSchema }),
  strictObject({ objectType: z.literal('shot'), content: ShotContentSchema }),
]);

export const DirectionObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('direction'),
  content: DirectionContentSchema,
});
export const StoryObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('story'),
  content: StoryContentSchema,
});
export const SequenceObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('sequence'),
  content: OrderedNarrativeContentSchema,
});
export const SceneObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('scene'),
  content: OrderedNarrativeContentSchema,
});
export const BeatObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('beat'),
  content: OrderedNarrativeContentSchema,
});
export const CharacterObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('character'),
  content: NamedWorldContentSchema,
});
export const LocationObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('location'),
  content: NamedWorldContentSchema,
});
export const EquipmentObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('equipment'),
  content: NamedWorldContentSchema,
});
export const PropObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('prop'),
  content: NamedWorldContentSchema,
});
export const WardrobeObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('wardrobe'),
  content: NamedWorldContentSchema,
});
export const WorldFactObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('world_fact'),
  content: NamedWorldContentSchema,
});
export const ShotObjectSchema = strictObject({
  ...productionBase,
  type: z.literal('shot'),
  content: ShotContentSchema,
  resultDecisions: z.array(ShotResultDecisionSchema).max(10_000),
}).superRefine((shot, context) => {
  const resultIds = new Set<string>();
  let selectedCount = 0;
  for (const [index, decision] of shot.resultDecisions.entries()) {
    if (resultIds.has(decision.result.id)) {
      context.addIssue({
        code: 'custom',
        path: ['resultDecisions', index, 'result', 'id'],
        message: 'Shot result decisions must identify unique results',
      });
    }
    resultIds.add(decision.result.id);
    if (decision.value.state === 'selected') selectedCount += 1;
  }
  if (selectedCount > 1) {
    context.addIssue({
      code: 'custom',
      path: ['resultDecisions'],
      message: 'A Shot can select at most one generated result',
    });
  }
});

export const ProductionObjectSchema = z.union([
  DirectionObjectSchema,
  StoryObjectSchema,
  SequenceObjectSchema,
  SceneObjectSchema,
  BeatObjectSchema,
  CharacterObjectSchema,
  LocationObjectSchema,
  EquipmentObjectSchema,
  PropObjectSchema,
  WardrobeObjectSchema,
  WorldFactObjectSchema,
  ShotObjectSchema,
]);
export const ProductionFactSourceSchema = strictObject({
  id: EntityIdSchema,
  productionObjectId: EntityIdSchema,
  field: ProductionCitationFieldSchema,
  source: DomainObjectRefSchema,
  relation: z.enum(['supports', 'supersedes', 'contradicts']),
  createdAt: IsoTimestampSchema,
});
export const ProductionObjectViewV1Schema = strictObject({
  object: ProductionObjectSchema,
  factSources: z.array(ProductionFactSourceSchema).max(500),
}).superRefine((view, context) => {
  for (const [index, factSource] of view.factSources.entries()) {
    if (factSource.productionObjectId !== view.object.id) {
      context.addIssue({
        code: 'custom',
        path: ['factSources', index, 'productionObjectId'],
        message: 'Production fact source must belong to the viewed object',
      });
    }
  }
});
export const ProductionSchema = ProductionObjectSchema;

export type ProductionObjectType = z.infer<typeof ProductionObjectTypeSchema>;
export type ProductionRelation = z.infer<typeof ProductionRelationSchema>;
export type FactProtection = z.infer<typeof FactProtectionSchema>;
export type ProductionRef = z.infer<typeof ProductionRefSchema>;
export type ShotResultDecisionValue = z.infer<typeof ShotResultDecisionValueSchema>;
export type ShotResultDecision = z.infer<typeof ShotResultDecisionSchema>;
export type ProductionObject = z.infer<typeof ProductionObjectSchema>;
export type ProductionFactSource = z.infer<typeof ProductionFactSourceSchema>;
export type ProductionObjectViewV1 = z.infer<typeof ProductionObjectViewV1Schema>;
export type Production = z.infer<typeof ProductionSchema>;
