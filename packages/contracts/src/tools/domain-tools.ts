import { z } from 'zod';
import {
  CanvasGeometrySchema,
  CanvasPointSchema,
  CanvasSizeSchema,
  CanvasTargetBindingSchema,
  CanvasTargetSchema,
  CanvasViewportSchema,
} from '../canvas.js';
import { strictObject } from '../canonical.js';
import {
  MediaDeriveInputSchema,
  MediaDeriveSuccessSchema,
  MediaKindSchema,
  MediaSourceSelectorSchema,
  ProjectMediaLinkInputSchema,
  ProjectMediaLinkSuccessSchema,
  ProjectMediaRefSchema,
  ProjectMediaRoleSchema,
} from '../media.js';
import {
  ArtifactRefSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  PositiveCountSchema,
  PositiveNumberSchema,
  RevisionSchema,
  Sha256Schema,
} from '../primitives.js';
import {
  FactProtectionSchema,
  ProductionCitationFieldSchema,
  ProductionFactSourceSchema,
  ProductionLifecycleSchema,
  ProductionObjectTypeSchema,
  ProductionRelationSchema,
  ProductionTypedContentSchema,
} from '../production.js';
import {
  MAX_MUTATION_BATCH,
  MAX_QUERY_LENGTH,
  MAX_REFERENCE_COUNT,
  PageRequestSchema,
  defineTool,
  externalMetadata,
  mutationReceiptSchema,
  pageSchema,
  readMetadata,
  reversibleMetadata,
  uniqueArray,
  variantExecution,
} from './common.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const ProductionRelationKindSchema = z.enum([
  'contains',
  'appears_in',
  'uses',
  'located_at',
  'continues_from',
  'references',
]);

function domainReadPolicy(
  domain: 'production' | 'canvas' | 'media',
  result: 'none' | 'summary' | 'object_links',
) {
  return readMetadata({
    domain,
    scope: { project: 'current', run: 'current', crossProject: 'denied' },
    cas: { mode: 'none', expectedFields: [] },
    publicProgress: { mode: 'none', redactArguments: true },
    publicResult: { mode: result, redactProviderPayload: true },
    artifactProjection: { mode: 'none', fields: [] },
    contextFactProjection: { mode: 'authority_refs', fields: ['items'] },
    variantDiscriminant: null,
    variants: [],
  });
}

function domainWritePolicy(
  domain: 'production' | 'canvas' | 'media',
  casFields: string[],
  dynamicProtection: boolean,
) {
  return reversibleMetadata({
    domain,
    dynamicProtection,
    scope: { project: 'current', run: 'current', crossProject: 'denied' },
    cas: { mode: 'revision_and_content_hash', expectedFields: casFields },
    publicProgress: { mode: 'summary', redactArguments: true },
    publicResult: { mode: 'object_links', redactProviderPayload: true },
    artifactProjection: { mode: 'none', fields: [] },
    contextFactProjection: { mode: 'mutation_receipts', fields: ['receipts'] },
    variantDiscriminant: 'action',
    variants: [],
  });
}

const ProductionRefSchema = strictObject({
  authority: z.literal('production'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
const ProductionIncludeSchema = z.enum(['content', 'relations', 'citations', 'protections']);
const PRODUCTION_INCLUDE_ORDER = Object.freeze([
  'content',
  'relations',
  'citations',
  'protections',
] as const);
const ProductionIncludesSchema = uniqueArray(
  ProductionIncludeSchema,
  0,
  PRODUCTION_INCLUDE_ORDER.length,
  'production includes',
).refine(
  (includes) =>
    includes.every(
      (include, index) =>
        index === 0 ||
        PRODUCTION_INCLUDE_ORDER.indexOf(includes[index - 1]!) <
          PRODUCTION_INCLUDE_ORDER.indexOf(include),
    ),
  { message: 'Production includes must use canonical section order' },
);
const ProductionSectionSchema = z.union([
  strictObject({ section: z.literal('content'), content: ProductionTypedContentSchema }),
  strictObject({
    section: z.literal('relations'),
    relations: z.array(ProductionRelationSchema).max(500),
  }),
  strictObject({
    section: z.literal('citations'),
    factSources: z.array(ProductionFactSourceSchema).max(500),
  }),
  strictObject({
    section: z.literal('protections'),
    protections: z.array(FactProtectionSchema).max(200),
  }),
]);
const ProductionObjectViewSchema = strictObject({
  ref: ProductionRefSchema,
  type: ProductionObjectTypeSchema,
  lifecycle: ProductionLifecycleSchema,
  title: z.string().min(1).max(240),
  summary: z.string().max(20_000),
  sections: z
    .array(ProductionSectionSchema)
    .max(PRODUCTION_INCLUDE_ORDER.length)
    .refine(
      (sections) =>
        sections.every(
          ({ section }, index) =>
            index === 0 ||
            PRODUCTION_INCLUDE_ORDER.indexOf(sections[index - 1]!.section) <
              PRODUCTION_INCLUDE_ORDER.indexOf(section),
        ),
      { message: 'Production sections must be unique and use canonical order' },
    ),
});

export const ProductionQueryDefinition = defineTool({
  id: 'production.query',
  version: '2.0.0',
  description:
    'Inspect typed Production objects, parent-to-child containment relations, lifecycle, and cited fact sources.',
  metadata: domainReadPolicy('production', 'object_links'),
  inputSchema: strictObject({
    refs: uniqueArray(ProductionRefSchema, 0, MAX_REFERENCE_COUNT, 'production refs'),
    kinds: uniqueArray(ProductionObjectTypeSchema, 0, 12, 'production kinds'),
    parentRef: ProductionRefSchema.nullable(),
    relation: ProductionRelationKindSchema.nullable(),
    include: ProductionIncludesSchema,
    page: PageRequestSchema,
  }),
  successSchema: pageSchema(ProductionObjectViewSchema),
  examples: {
    input: {
      refs: [],
      kinds: ['shot'],
      parentRef: null,
      relation: null,
      include: ['content', 'relations', 'citations', 'protections'],
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          ref: { authority: 'production', id: 'shot.1', revision: 2, contentHash: HASH_A },
          type: 'shot',
          lifecycle: 'active',
          title: 'Harbor reveal',
          summary: 'A wide reveal of the moonlit harbor.',
          sections: [
            {
              section: 'content',
              content: {
                objectType: 'shot',
                content: {
                  title: 'Harbor reveal',
                  description: 'A wide reveal of the moonlit harbor.',
                  durationMs: 5_000,
                  shotSize: 'wide',
                  cameraMovement: 'static',
                },
              },
            },
            { section: 'relations', relations: [] },
            {
              section: 'citations',
              factSources: [
                {
                  id: 'fact-source.1',
                  productionObjectId: 'shot.1',
                  field: 'description',
                  source: {
                    authority: 'production',
                    id: 'story.1',
                    revision: 1,
                    contentHash: HASH_B,
                  },
                  relation: 'supports',
                  createdAt: '2026-08-15T12:00:00.000Z',
                },
              ],
            },
            { section: 'protections', protections: [] },
          ],
        },
      ],
      nextCursor: null,
    },
  },
});

const ProductionCreateSchema = strictObject({
  action: z.literal('create'),
  expectedProjectRevision: RevisionSchema,
  parentRef: ProductionRefSchema.nullable(),
  order: CountSchema.nullable(),
  value: ProductionTypedContentSchema,
}).refine((mutation) => (mutation.parentRef === null) === (mutation.order === null), {
  message: 'Production create parentRef and order must both be null or both be present',
});

function expectedProductionRefMatches({
  ref,
  expectedRevision,
  expectedContentHash,
}: {
  readonly ref: { readonly revision: number; readonly contentHash: string };
  readonly expectedRevision: number;
  readonly expectedContentHash: string;
}) {
  return ref.revision === expectedRevision && ref.contentHash === expectedContentHash;
}

const ExpectedProductionRefSchema = strictObject({
  ref: ProductionRefSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
}).refine(expectedProductionRefMatches, {
  message: 'Expected Production revision and content hash must match ref',
});
const ProductionUpdateSchema = strictObject({
  action: z.literal('update'),
  ref: ProductionRefSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
  value: ProductionTypedContentSchema,
}).refine(expectedProductionRefMatches, {
  message: 'Expected Production revision and content hash must match ref',
});
const ProductionRelateSchema = strictObject({
  action: z.literal('relate'),
  mode: z.enum(['link', 'unlink']),
  relation: ProductionRelationKindSchema,
  ordinal: CountSchema.nullable(),
  source: ExpectedProductionRefSchema,
  target: ExpectedProductionRefSchema,
}).refine(
  (mutation) =>
    mutation.mode === 'unlink' ||
    (mutation.relation === 'contains') === (mutation.ordinal !== null),
  { message: 'Only linked containment relations have an ordinal' },
);
const ProductionReorderSchema = strictObject({
  action: z.literal('reorder'),
  parent: ExpectedProductionRefSchema,
  orderedChildIds: uniqueArray(EntityIdSchema, 1, MAX_MUTATION_BATCH, 'ordered child IDs'),
});
const ProductionLifecycleMutationSchema = strictObject({
  action: z.enum(['archive', 'restore']),
  ref: ProductionRefSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
}).refine(expectedProductionRefMatches, {
  message: 'Expected Production revision and content hash must match ref',
});
const ProductionCiteSchema = strictObject({
  action: z.literal('cite'),
  ref: ProductionRefSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
  field: ProductionCitationFieldSchema,
  sourceRef: DomainObjectRefSchema,
  relation: z.enum(['supports', 'supersedes', 'contradicts']),
}).refine(expectedProductionRefMatches, {
  message: 'Expected Production revision and content hash must match ref',
});
export const ProductionMutationInputSchema = z.union([
  ProductionCreateSchema,
  ProductionUpdateSchema,
  ProductionRelateSchema,
  ProductionReorderSchema,
  ProductionLifecycleMutationSchema,
  ProductionCiteSchema,
]);
export const ProductionMutationActionSchema = z.enum([
  'create',
  'update',
  'relate',
  'reorder',
  'archive',
  'restore',
  'cite',
]);
export const ProductionMutationReceiptSchema = mutationReceiptSchema(ProductionRefSchema);
export type ProductionMutationReceipt = z.infer<typeof ProductionMutationReceiptSchema>;

export const ProductionMutateDefinition = defineTool({
  id: 'production.mutate',
  version: '2.0.0',
  description:
    'Create or revise typed Production facts, parent-to-child containment relations, ordering, lifecycle, and citations.',
  metadata: {
    ...domainWritePolicy(
      'production',
      ['expectedProjectRevision', 'expectedRevision', 'expectedContentHash'],
      true,
    ),
    variants: ProductionMutationActionSchema.options.map((discriminant) =>
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
  inputSchema: ProductionMutationInputSchema,
  successSchema: strictObject({
    receipts: z.array(ProductionMutationReceiptSchema).min(0).max(MAX_MUTATION_BATCH),
  }),
  examples: {
    input: {
      action: 'create',
      expectedProjectRevision: 4,
      parentRef: null,
      order: null,
      value: {
        objectType: 'story',
        content: {
          title: 'The Harbor',
          premise: 'A courier must cross a moonlit harbor.',
          synopsis: 'The courier finds an unexpected ally before dawn.',
        },
      },
    },
    success: {
      receipts: [
        {
          object: { authority: 'production', id: 'story.1', revision: 0, contentHash: HASH_A },
          previousRevision: null,
          eventId: 'event.1',
          changedPaths: ['content'],
          undoRef: null,
        },
      ],
    },
  },
});

const CanvasPlacementRefSchema = strictObject({
  placementId: EntityIdSchema,
  revision: RevisionSchema,
});
const CanvasTargetRefSchema = strictObject({
  authority: z.enum(['production', 'project_media_ref', 'generated_result', 'delivery']),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
const CanvasSpatialObjectSchema = z.union([
  strictObject({ kind: z.literal('placement'), id: EntityIdSchema, revision: RevisionSchema }),
  strictObject({ kind: z.literal('group'), id: EntityIdSchema, revision: RevisionSchema }),
  strictObject({ kind: z.literal('edge'), id: EntityIdSchema, revision: RevisionSchema }),
  strictObject({ kind: z.literal('annotation'), id: EntityIdSchema, revision: RevisionSchema }),
  strictObject({ kind: z.literal('saved_view'), id: EntityIdSchema, revision: RevisionSchema }),
]);
const CanvasQueryItemSchema = z.union([
  strictObject({
    object: strictObject({
      kind: z.literal('placement'),
      id: EntityIdSchema,
      revision: RevisionSchema,
    }),
    target: CanvasTargetBindingSchema,
    position: CanvasPointSchema,
    size: CanvasSizeSchema,
    zIndex: z.number().int().finite(),
  }),
  strictObject({
    object: strictObject({
      kind: z.literal('group'),
      id: EntityIdSchema,
      revision: RevisionSchema,
    }),
    title: z.string().trim().min(1).max(240),
    placementIds: z.array(EntityIdSchema).max(20_000),
  }),
  strictObject({
    object: strictObject({
      kind: z.literal('edge'),
      id: EntityIdSchema,
      revision: RevisionSchema,
    }),
    sourcePlacementId: EntityIdSchema,
    targetPlacementId: EntityIdSchema,
    label: z.string().max(240),
  }),
  strictObject({
    object: strictObject({
      kind: z.literal('annotation'),
      id: EntityIdSchema,
      revision: RevisionSchema,
    }),
    placementId: EntityIdSchema.nullable(),
    text: z.string().trim().min(1).max(20_000),
    geometry: CanvasGeometrySchema.nullable(),
  }),
  strictObject({
    object: strictObject({
      kind: z.literal('saved_view'),
      id: EntityIdSchema,
      revision: RevisionSchema,
    }),
    name: z.string().trim().min(1).max(120),
    viewport: CanvasViewportSchema,
  }),
]);
const CanvasIncludeSchema = z.enum(['placements', 'groups', 'edges', 'annotations', 'saved_views']);
const CANVAS_INCLUDE_ORDER = Object.freeze(CanvasIncludeSchema.options);
const CanvasIncludesSchema = uniqueArray(
  CanvasIncludeSchema,
  1,
  CANVAS_INCLUDE_ORDER.length,
  'Canvas includes',
).refine(
  (includes) =>
    includes.every(
      (include, index) =>
        index === 0 ||
        CANVAS_INCLUDE_ORDER.indexOf(includes[index - 1]!) < CANVAS_INCLUDE_ORDER.indexOf(include),
    ),
  { message: 'Canvas includes must use canonical order' },
);
const CANVAS_ITEM_KIND_ORDER = Object.freeze([
  'placement',
  'group',
  'edge',
  'annotation',
  'saved_view',
] as const);
const CanvasQueryPageSchema = pageSchema(CanvasQueryItemSchema).refine(
  ({ items }) =>
    items.every((item, index) => {
      if (index === 0) return true;
      const previous = items[index - 1]!.object;
      const current = item.object;
      const kindOrder =
        CANVAS_ITEM_KIND_ORDER.indexOf(previous.kind) -
        CANVAS_ITEM_KIND_ORDER.indexOf(current.kind);
      return kindOrder < 0 || (kindOrder === 0 && previous.id < current.id);
    }),
  { message: 'Canvas query items must be unique and use canonical kind and ID order' },
);

export const CanvasQueryDefinition = defineTool({
  id: 'canvas.query',
  version: '2.0.0',
  description: 'Inspect bounded Canvas placements, groups, edges, annotations, and saved views.',
  metadata: domainReadPolicy('canvas', 'none'),
  inputSchema: strictObject({
    bounds: CanvasGeometrySchema.nullable(),
    targetRefs: uniqueArray(CanvasTargetRefSchema, 0, MAX_REFERENCE_COUNT, 'Canvas target refs'),
    groupIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'group IDs'),
    edgeIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'edge IDs'),
    include: CanvasIncludesSchema,
    page: PageRequestSchema,
  }),
  successSchema: strictObject({
    canvasRevision: RevisionSchema,
    canvasContentHash: Sha256Schema,
    page: CanvasQueryPageSchema,
  }),
  examples: {
    input: {
      bounds: null,
      targetRefs: [],
      groupIds: [],
      edgeIds: [],
      include: ['placements'],
      page: { cursor: null, limit: 20 },
    },
    success: {
      canvasRevision: 2,
      canvasContentHash: HASH_A,
      page: {
        items: [
          {
            object: { kind: 'placement', id: 'placement.1', revision: 1 },
            target: {
              targetType: 'production',
              targetId: 'shot.1',
              targetRevision: 2,
              targetContentHash: HASH_B,
            },
            position: { x: 100, y: 80 },
            size: { width: 320, height: 180 },
            zIndex: 1,
          },
        ],
        nextCursor: null,
      },
    },
  },
});

const GeometrySchema = CanvasGeometrySchema;
const ExpectedPlacementListSchema = uniqueArray(
  CanvasPlacementRefSchema,
  1,
  MAX_MUTATION_BATCH,
  'placement revisions',
);
const CanvasMutationInputSchema = z.union([
  strictObject({
    action: z.literal('place'),
    target: CanvasTargetSchema,
    geometry: GeometrySchema,
    expectedCanvasRevision: RevisionSchema,
  }),
  strictObject({
    action: z.enum(['move', 'resize']),
    placementId: EntityIdSchema,
    geometry: GeometrySchema,
    expectedCanvasRevision: RevisionSchema,
    expectedPlacementRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('group'),
    placements: ExpectedPlacementListSchema,
    title: z.string().trim().min(1).max(240),
    expectedCanvasRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('ungroup'),
    groupId: EntityIdSchema,
    expectedCanvasRevision: RevisionSchema,
    expectedGroupRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('connect'),
    sourcePlacementId: EntityIdSchema,
    targetPlacementId: EntityIdSchema,
    label: z.string().max(240),
    expectedCanvasRevision: RevisionSchema,
  }).refine((edge) => edge.sourcePlacementId !== edge.targetPlacementId, {
    message: 'Canvas edge endpoints must differ',
  }),
  strictObject({
    action: z.literal('disconnect'),
    edgeId: EntityIdSchema,
    expectedCanvasRevision: RevisionSchema,
    expectedEdgeRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('annotate'),
    placementId: EntityIdSchema.nullable(),
    text: z.string().trim().min(1).max(20_000),
    geometry: GeometrySchema.nullable(),
    expectedCanvasRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('arrange'),
    placements: ExpectedPlacementListSchema,
    layout: z.enum(['row', 'column', 'grid', 'timeline']),
    spacing: PositiveNumberSchema,
    expectedCanvasRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('remove'),
    placements: ExpectedPlacementListSchema,
    expectedCanvasRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('save_view'),
    viewId: EntityIdSchema.nullable(),
    name: z.string().trim().min(1).max(120),
    viewport: CanvasViewportSchema,
    expectedCanvasRevision: RevisionSchema,
  }),
  strictObject({
    action: z.literal('restore_view'),
    viewId: EntityIdSchema,
    expectedCanvasRevision: RevisionSchema,
    expectedViewRevision: RevisionSchema,
  }),
]);
const CanvasMutationReceiptSchema = mutationReceiptSchema(CanvasSpatialObjectSchema);

export const CanvasMutateDefinition = defineTool({
  id: 'canvas.mutate',
  description:
    'Change Canvas spatial placement, grouping, edges, annotations, arrangement, or views.',
  metadata: {
    ...domainWritePolicy(
      'canvas',
      ['expectedCanvasRevision', 'expectedPlacementRevision', 'expectedGroupRevision'],
      false,
    ),
    variants: [
      'place',
      'move',
      'resize',
      'group',
      'ungroup',
      'connect',
      'disconnect',
      'annotate',
      'arrange',
      'remove',
      'save_view',
      'restore_view',
    ].map((discriminant) =>
      variantExecution({
        discriminant,
        profile: 'RW',
        effect: 'reversible_write',
        permissions: ['project.write'],
        confirmation: 'none',
        cost: 'none',
        unknownCost: 'not_applicable',
        cas: 'revision',
        idempotency: 'operation_fingerprint',
        retry: 'before_commit',
        timeout: 'bounded_write',
        cancellation: 'before_commit',
        recovery: 'event_receipt',
        unknownStateNeverResubmit: false,
      }),
    ),
  },
  inputSchema: CanvasMutationInputSchema,
  successSchema: strictObject({
    canvasRevision: RevisionSchema,
    canvasContentHash: Sha256Schema,
    receipts: z.array(CanvasMutationReceiptSchema).min(1).max(MAX_MUTATION_BATCH),
  }),
  examples: {
    input: {
      action: 'place',
      target: { targetType: 'production', targetId: 'shot.1' },
      geometry: { position: { x: 100, y: 80 }, size: { width: 320, height: 180 } },
      expectedCanvasRevision: 2,
    },
    success: {
      canvasRevision: 3,
      canvasContentHash: HASH_B,
      receipts: [
        {
          object: { kind: 'placement', id: 'placement.1', revision: 1 },
          previousRevision: null,
          eventId: 'event.2',
          changedPaths: ['position', 'size'],
          undoRef: 'undo.2',
        },
      ],
    },
  },
});

const MediaScopeSchema = z.enum(['project', 'global']);
const MediaIntegritySchema = z.enum(['valid', 'missing', 'corrupt', 'unknown']);
const MediaViewSchema = strictObject({
  scope: MediaScopeSchema,
  globalAssetId: EntityIdSchema,
  projectMediaRef: strictObject({
    authority: z.literal('project_media_ref'),
    id: EntityIdSchema,
    revision: RevisionSchema,
    contentHash: Sha256Schema,
  }).nullable(),
  blobHash: Sha256Schema,
  kind: MediaKindSchema,
  displayName: z.string().min(1).max(240),
  tags: z.array(z.string().min(1).max(80)).max(100),
  roles: z.array(ProjectMediaRoleSchema).max(20),
  integrity: MediaIntegritySchema,
});

export const MediaQueryDefinition = defineTool({
  id: 'media.query',
  description: 'Search Project or Global Media by typed identity, metadata, usage, and integrity.',
  metadata: domainReadPolicy('media', 'object_links'),
  inputSchema: strictObject({
    scope: MediaScopeSchema,
    globalAssetIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'global asset IDs'),
    projectMediaRefIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'Project Media refs'),
    blobHashes: uniqueArray(Sha256Schema, 0, MAX_REFERENCE_COUNT, 'blob hashes'),
    mediaKinds: uniqueArray(MediaKindSchema, 0, 4, 'media kinds'),
    tags: uniqueArray(z.string().trim().min(1).max(80), 0, 100, 'media tags'),
    roles: uniqueArray(ProjectMediaRoleSchema, 0, 9, 'media roles'),
    integrity: uniqueArray(MediaIntegritySchema, 0, 4, 'integrity states'),
    query: z.string().max(MAX_QUERY_LENGTH),
    page: PageRequestSchema,
  }),
  successSchema: pageSchema(MediaViewSchema),
  examples: {
    input: {
      scope: 'project',
      globalAssetIds: [],
      projectMediaRefIds: [],
      blobHashes: [],
      mediaKinds: ['image'],
      tags: ['harbor'],
      roles: ['reference'],
      integrity: ['valid'],
      query: 'moonlight',
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          scope: 'project',
          globalAssetId: 'asset.1',
          projectMediaRef: {
            authority: 'project_media_ref',
            id: 'media.1',
            revision: 1,
            contentHash: HASH_A,
          },
          blobHash: HASH_A,
          kind: 'image',
          displayName: 'Moonlit harbor',
          tags: ['harbor'],
          roles: ['reference'],
          integrity: 'valid',
        },
      ],
      nextCursor: null,
    },
  },
});

const MediaInspectionViewSchema = z.union([
  strictObject({ kind: z.literal('image'), maxDimension: PositiveCountSchema.max(8_192) }),
  strictObject({
    kind: z.literal('video_frames'),
    timecodesMs: uniqueArray(CountSchema, 1, 32, 'video timecodes'),
    maxDimension: PositiveCountSchema.max(8_192),
  }),
  strictObject({
    kind: z.literal('audio_window'),
    startMs: CountSchema,
    endMs: PositiveCountSchema,
  }).refine((window) => window.endMs > window.startMs, { message: 'Audio window is reversed' }),
  strictObject({ kind: z.literal('waveform'), width: PositiveCountSchema.max(8_192) }),
  strictObject({
    kind: z.literal('document_pages'),
    pageNumbers: uniqueArray(PositiveCountSchema, 1, 32, 'page numbers'),
  }),
  strictObject({
    kind: z.literal('text'),
    start: CountSchema,
    length: PositiveCountSchema.max(100_000),
  }),
]);
const MediaObservationSchema = strictObject({
  observationId: EntityIdSchema,
  source: MediaSourceSelectorSchema,
  sourceContentHash: Sha256Schema,
  viewKind: z.enum(['image', 'video_frames', 'audio_window', 'waveform', 'document_pages', 'text']),
  artifact: ArtifactRefSchema.nullable(),
  textEvidence: z.string().max(100_000),
  timecodesMs: z.array(CountSchema).max(32),
  pageNumbers: z.array(PositiveCountSchema).max(32),
});

export const MediaInspectDefinition = defineTool({
  id: 'media.inspect',
  description: 'Create bounded model-readable observations tied to an accepted media content hash.',
  metadata: {
    ...domainReadPolicy('media', 'summary'),
    artifactProjection: { mode: 'from_success', fields: ['observations.artifact'] },
  },
  inputSchema: strictObject({
    source: MediaSourceSelectorSchema,
    expectedSourceHash: Sha256Schema,
    view: MediaInspectionViewSchema,
  }),
  successSchema: strictObject({
    observations: z.array(MediaObservationSchema).min(1).max(32),
  }),
  examples: {
    input: {
      source: { kind: 'project_media_ref', id: 'media.1' },
      expectedSourceHash: HASH_A,
      view: { kind: 'image', maxDimension: 2_048 },
    },
    success: {
      observations: [
        {
          observationId: 'observation.1',
          source: { kind: 'project_media_ref', id: 'media.1' },
          sourceContentHash: HASH_A,
          viewKind: 'image',
          artifact: {
            kind: 'image',
            id: 'observation-artifact.1',
            contentHash: HASH_B,
            mimeType: 'image/png',
            width: 2_048,
            height: 1_152,
            durationMs: null,
          },
          textEvidence: '',
          timecodesMs: [],
          pageNumbers: [],
        },
      ],
    },
  },
});

const localDeriveVariants = [
  'extractFrames',
  'clip',
  'crop',
  'resize',
  'proxyTranscode',
  'extractAudio',
  'waveform',
  'ocr',
] as const;

export const MediaDeriveDefinition = defineTool({
  id: 'media.derive',
  description:
    'Create immutable, provenance-bound media derivatives from accepted opaque media sources.',
  metadata: {
    ...externalMetadata({
      domain: 'media',
      domainMutation: true,
      permissions: ['project.write'],
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: ['expectedSourceHash', 'attach.expectedProjectRevision'],
      },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'artifact_card', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['artifacts'] },
      contextFactProjection: { mode: 'operation_state', fields: ['operation', 'artifacts'] },
      variantDiscriminant: 'operation',
      variants: [],
    }),
    variants: [
      ...localDeriveVariants.map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'RW',
          effect: 'reversible_write',
          permissions: ['project.write'],
          confirmation: 'none',
          cost: 'none',
          unknownCost: 'not_applicable',
          cas: 'revision_and_content_hash',
          idempotency: 'attempt_fingerprint',
          retry: 'before_commit',
          timeout: 'long_running',
          cancellation: 'cooperative',
          recovery: 'event_receipt',
          unknownStateNeverResubmit: false,
        }),
      ),
      variantExecution({
        discriminant: 'transcribe',
        profile: 'EXT',
        effect: 'external',
        permissions: ['project.write'],
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
    ],
  },
  inputSchema: MediaDeriveInputSchema,
  successSchema: MediaDeriveSuccessSchema,
  examples: {
    input: {
      operation: 'resize',
      source: { kind: 'project_media_ref', id: 'media.1' },
      expectedSourceHash: HASH_A,
      attach: { enabled: true, expectedProjectRevision: 4 },
      outputIntents: [
        {
          ordinal: 0,
          globalAsset: {
            filename: 'harbor-reference-1920x1080.png',
            displayName: 'Harbor reference 1920x1080',
            folderId: null,
            tags: ['harbor', 'reference'],
          },
          projectMediaRef: {
            label: 'Harbor reference 1920x1080',
            collections: ['Locations'],
            roles: ['reference'],
            notes: 'Resized from the accepted harbor reference.',
          },
        },
      ],
      width: 1_920,
      height: 1_080,
      fit: 'contain',
    },
    success: {
      operation: {
        id: 'operation.derive.1',
        revision: 1,
        kind: 'media_derivation',
        ownerRef: {
          authority: 'media_derivation_attempt',
          id: 'attempt.derive.1',
          revision: 1,
          contentHash: HASH_B,
        },
      },
      derivationId: 'derivation.1',
      attemptId: 'attempt.derive.1',
      requestHash: HASH_C,
      artifacts: [],
      globalAssets: [],
      projectMediaRefs: [],
    },
  },
});

const AttachSourceSchema = z.union([
  strictObject({ kind: z.literal('global_asset'), id: EntityIdSchema }),
  strictObject({ kind: z.literal('accepted_attachment'), id: EntityIdSchema }),
  strictObject({ kind: z.literal('generated_result'), id: EntityIdSchema }),
]);

export const MediaAttachDefinition = defineTool({
  id: 'media.attach',
  description: 'Attach one already authorized media identity to the current Project.',
  metadata: domainWritePolicy('media', ['expectedProjectRevision'], false),
  inputSchema: strictObject({
    source: AttachSourceSchema,
    expectedProjectRevision: RevisionSchema,
    label: z.string().trim().min(1).max(240),
    collections: uniqueArray(z.string().trim().min(1).max(120), 0, 100, 'collections'),
    roles: uniqueArray(ProjectMediaRoleSchema, 1, 9, 'media roles'),
    notes: z.string().max(10_000),
  }),
  successSchema: mutationReceiptSchema(ProjectMediaRefSchema),
  examples: {
    input: {
      source: { kind: 'global_asset', id: 'asset.1' },
      expectedProjectRevision: 4,
      label: 'Harbor reference',
      collections: ['Locations'],
      roles: ['reference'],
      notes: 'Primary lighting reference.',
    },
    success: {
      object: {
        authority: 'project_media_ref',
        id: 'media.1',
        projectId: 'project.1',
        globalAssetId: 'asset.1',
        revision: 1,
        contentHash: HASH_A,
        lifecycle: 'active',
        detachedAt: null,
        label: 'Harbor reference',
        collections: ['Locations'],
        roles: ['reference'],
        notes: 'Primary lighting reference.',
        productionLinks: [],
        createdBy: { kind: 'message', messageId: 'message.1' },
        createdAt: '2026-08-15T12:00:00.000Z',
        updatedAt: '2026-08-15T12:00:00.000Z',
      },
      previousRevision: null,
      eventId: 'event.3',
      changedPaths: ['project_media_ref'],
      undoRef: 'undo.3',
    },
  },
});

export const MediaLinkDefinition = defineTool({
  id: 'media.link',
  description: 'Link or unlink an active Project Media reference and a Production object.',
  metadata: {
    ...domainWritePolicy('media', ['mediaRef', 'target'], false),
    contextFactProjection: { mode: 'mutation_receipts', fields: ['object'] },
    variantDiscriminant: 'mode',
    variants: ['link', 'unlink'].map((discriminant) =>
      variantExecution({
        discriminant,
        profile: 'RW',
        effect: 'reversible_write',
        permissions: ['project.write'],
        confirmation: 'none',
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
  inputSchema: ProjectMediaLinkInputSchema,
  successSchema: ProjectMediaLinkSuccessSchema,
  examples: {
    input: {
      mode: 'link',
      mediaRef: {
        authority: 'project_media_ref',
        id: 'media.1',
        revision: 1,
        contentHash: HASH_A,
      },
      target: { authority: 'production', id: 'location.1', revision: 2, contentHash: HASH_A },
      relation: 'references',
    },
    success: {
      object: {
        authority: 'project_media_ref',
        id: 'media.1',
        projectId: 'project.1',
        globalAssetId: 'asset.1',
        revision: 2,
        contentHash: HASH_B,
        lifecycle: 'active',
        detachedAt: null,
        label: 'Harbor reference',
        collections: ['Locations'],
        roles: ['reference'],
        notes: 'Primary lighting reference.',
        productionLinks: [{ productionObjectId: 'location.1', relation: 'references' }],
        createdBy: { kind: 'message', messageId: 'message.1' },
        createdAt: '2026-08-15T12:00:00.000Z',
        updatedAt: '2026-08-15T12:01:00.000Z',
      },
      previousRevision: 1,
      eventId: 'event.4',
      changedPaths: ['productionLinks'],
      undoRef: null,
    },
  },
});

export const DOMAIN_TOOL_DEFINITIONS = Object.freeze([
  ProductionQueryDefinition,
  ProductionMutateDefinition,
  CanvasQueryDefinition,
  CanvasMutateDefinition,
  MediaQueryDefinition,
  MediaInspectDefinition,
  MediaDeriveDefinition,
  MediaAttachDefinition,
  MediaLinkDefinition,
] as const);
