import { z } from 'zod';
import { strictObject } from '../canonical.js';
import {
  DeliveryAudioPolicySchema,
  DeliveryDestinationIntentSchema,
  DeliveryFormatIntentSchema,
  DeliveryItemRefSchema,
  DeliveryManifestRefSchema,
  DeliveryManifestSchema,
  DeliveryMutationCommandSchema,
  DeliveryPlanSchema,
  DeliveryPreviewRequestSchema,
  DeliveryRefSchema,
  DeliveryReviewStateSchema,
  DeliveryTrimSchema,
  DeliveryTransitionSchema,
} from '../delivery.js';
import {
  AttemptStateSchema,
  OperationCancelInputSchema,
  OperationCancelOutputSchema,
  OperationGetInputSchema,
  OperationGetOutputSchema,
  OperationKindSchema,
  OperationRefSchema,
} from '../operation.js';
import {
  ArtifactRefSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  PositiveCountSchema,
  ResourceAmountSchema,
  RevisionSchema,
  Sha256Schema,
  UserChoiceRefSchema,
} from '../primitives.js';
import {
  MAX_MUTATION_BATCH,
  MAX_REFERENCE_COUNT,
  PageRequestSchema,
  controlMetadata,
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

const DeliveryViewSchema = strictObject({
  plan: DeliveryPlanSchema,
  manifests: z.array(DeliveryManifestRefSchema).max(MAX_MUTATION_BATCH),
  operations: z.array(OperationRefSchema).max(MAX_MUTATION_BATCH),
});

function deliveryReadPolicy() {
  return readMetadata({
    domain: 'delivery',
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

export const DeliveryQueryDefinition = defineTool({
  id: 'delivery.query',
  description:
    'Inspect Delivery plans, items, trims, audio policy, manifests, exports, and blockers.',
  metadata: deliveryReadPolicy(),
  inputSchema: strictObject({
    planIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'delivery plan IDs'),
    itemIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'delivery item IDs'),
    manifestIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'manifest IDs'),
    include: uniqueArray(
      z.enum(['items', 'format', 'review', 'manifests', 'operations', 'protections']),
      0,
      6,
      'delivery includes',
    ),
    page: PageRequestSchema,
  }),
  successSchema: pageSchema(DeliveryViewSchema),
  examples: {
    input: {
      planIds: ['delivery.1'],
      itemIds: [],
      manifestIds: [],
      include: ['items', 'format'],
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          plan: {
            authority: 'delivery',
            id: 'delivery.1',
            projectId: 'project.1',
            revision: 2,
            contentHash: HASH_A,
            name: 'Review sequence',
            lifecycle: 'active',
            formatIntent: {
              container: 'mp4',
              videoCodec: 'h264',
              audioCodec: 'aac',
              width: 1_920,
              height: 1_080,
              frameRate: 24,
              quality: 'review',
            },
            items: [],
            currentChoices: [],
            protections: [],
            createdAt: '2026-08-16T12:00:00.000Z',
            updatedAt: '2026-08-16T12:00:00.000Z',
          },
          manifests: [],
          operations: [],
        },
      ],
      nextCursor: null,
    },
  },
});

export const DeliveryMutateDefinition = defineTool({
  id: 'delivery.mutate',
  description:
    'Create or revise a reversible Delivery draft, sequence, trims, transitions, and audio policy.',
  metadata: {
    ...reversibleMetadata({
      domain: 'delivery',
      dynamicProtection: true,
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: ['project', 'plan', 'item', 'orderedItems', 'shot', 'result'],
      },
      publicProgress: { mode: 'summary', redactArguments: true },
      publicResult: { mode: 'object_links', redactProviderPayload: true },
      artifactProjection: { mode: 'none', fields: [] },
      contextFactProjection: { mode: 'mutation_receipts', fields: ['plan', 'receipts'] },
      variantDiscriminant: 'action',
      variants: [],
    }),
    variants: [
      'create',
      'updateSettings',
      'place',
      'remove',
      'reorder',
      'trim',
      'transition',
      'audioPolicy',
      'reviewState',
      'archive',
      'restore',
    ].map((discriminant) =>
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
  inputSchema: DeliveryMutationCommandSchema,
  successSchema: strictObject({
    plan: DeliveryRefSchema,
    choice: UserChoiceRefSchema,
  }),
  examples: {
    input: {
      action: 'create',
      project: { authority: 'project', id: 'project.1', revision: 4, contentHash: HASH_A },
      name: 'Review sequence',
      formatIntent: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1_920,
        height: 1_080,
        frameRate: 24,
        quality: 'review',
      },
    },
    success: {
      plan: { authority: 'delivery', id: 'delivery.1', revision: 0, contentHash: HASH_B },
      choice: { authority: 'user_choice', id: 'choice.delivery.1', choiceHash: HASH_C },
    },
  },
});

export const DeliveryPreviewDefinition = defineTool({
  id: 'delivery.preview',
  description: 'Render a non-final Review Cut from one exact Delivery plan revision.',
  metadata: {
    ...externalMetadata({
      domain: 'delivery',
      domainMutation: true,
      permissions: ['project.write'],
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: ['plan'],
      },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'artifact_card', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['artifact'] },
      contextFactProjection: { mode: 'operation_state', fields: ['operation', 'artifact'] },
      variantDiscriminant: null,
      variants: [],
    }),
    cost: { mode: 'none', unknownCost: 'not_applicable', dimension: 'none' },
    retry: { mode: 'before_submission', technicalAttemptLimit: 1 },
    timeout: { mode: 'long_running', maximumMs: 86_400_000 },
    cancellation: { mode: 'cooperative', preservesCommittedResults: true },
    recovery: { mode: 'authority_reread', unknownStateNeverResubmit: false },
    variants: [],
  },
  inputSchema: DeliveryPreviewRequestSchema,
  successSchema: strictObject({
    operation: OperationRefSchema,
    attemptId: EntityIdSchema,
    state: AttemptStateSchema,
    artifact: ArtifactRefSchema.nullable(),
    warnings: z.array(z.string().min(1).max(4_000)).max(100),
    usage: ResourceAmountSchema,
  }),
  examples: {
    input: {
      plan: { authority: 'delivery', id: 'delivery.1', revision: 2, contentHash: HASH_A },
      range: null,
    },
    success: {
      operation: {
        id: 'operation.preview.1',
        revision: 1,
        kind: 'review_cut_attempt',
        ownerRef: {
          authority: 'review_cut_attempt',
          id: 'preview.1',
          revision: 1,
          contentHash: HASH_B,
        },
      },
      attemptId: 'preview.1',
      state: 'running',
      artifact: null,
      warnings: [],
      usage: { state: 'known', value: '0', currency: 'USD' },
    },
  },
});

export const DeliveryFreezeDefinition = defineTool({
  id: 'delivery.freeze',
  description: 'Freeze one exact Delivery plan revision into an immutable validated manifest.',
  metadata: reversibleMetadata({
    domain: 'delivery',
    dynamicProtection: false,
    scope: { project: 'current', run: 'current', crossProject: 'denied' },
    cas: {
      mode: 'revision_and_content_hash',
      expectedFields: ['plan'],
    },
    publicProgress: { mode: 'summary', redactArguments: true },
    publicResult: { mode: 'object_links', redactProviderPayload: true },
    artifactProjection: { mode: 'none', fields: [] },
    contextFactProjection: { mode: 'authority_refs', fields: ['manifest'] },
    variantDiscriminant: null,
    variants: [],
  }),
  inputSchema: strictObject({ plan: DeliveryRefSchema }),
  successSchema: DeliveryManifestSchema,
  examples: {
    input: {
      plan: { authority: 'delivery', id: 'delivery.1', revision: 2, contentHash: HASH_A },
    },
    success: {
      authority: 'delivery_manifest',
      id: 'manifest.delivery.1',
      projectId: 'project.1',
      revision: 0,
      contentHash: HASH_B,
      sourcePlan: { authority: 'delivery', id: 'delivery.1', revision: 2, contentHash: HASH_A },
      formatIntent: {
        container: 'mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        width: 1_920,
        height: 1_080,
        frameRate: 24,
        quality: 'review',
      },
      items: [],
      currentChoices: [],
      protections: [],
      createdBy: { kind: 'run', runId: 'run.1' },
      frozenAt: '2026-08-16T12:00:00.000Z',
    },
  },
});

export const DeliveryExportDefinition = defineTool({
  id: 'delivery.export',
  description: 'Export one frozen manifest to a user-authorized opaque destination token.',
  metadata: {
    ...externalMetadata({
      domain: 'delivery',
      domainMutation: true,
      permissions: ['project.write', 'delivery.export'],
      category: 'protected_external',
      exactConfirmation: true,
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: { mode: 'content_hash', expectedFields: ['manifest'] },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'artifact_card', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['artifact'] },
      contextFactProjection: { mode: 'operation_state', fields: ['operation', 'artifact'] },
      variantDiscriminant: null,
      variants: [],
    }),
    cost: { mode: 'none', unknownCost: 'not_applicable', dimension: 'none' },
    retry: { mode: 'before_submission', technicalAttemptLimit: 1 },
    timeout: { mode: 'long_running', maximumMs: 86_400_000 },
    cancellation: { mode: 'cooperative', preservesCommittedResults: true },
    recovery: { mode: 'authority_reread', unknownStateNeverResubmit: false },
  },
  inputSchema: strictObject({
    manifest: DeliveryManifestRefSchema,
    destination: DeliveryDestinationIntentSchema,
    overwriteExisting: z.boolean(),
  }),
  successSchema: strictObject({
    operation: OperationRefSchema,
    exportId: EntityIdSchema,
    state: AttemptStateSchema,
    destinationLabel: z.string().min(1).max(500),
    contentHash: Sha256Schema.nullable(),
    artifact: ArtifactRefSchema.nullable(),
    cost: ResourceAmountSchema,
  }),
  examples: {
    input: {
      manifest: {
        authority: 'delivery_manifest',
        id: 'manifest.delivery.1',
        revision: 0,
        contentHash: HASH_A,
      },
      destination: {
        kind: 'user_selected_file',
        grantId: 'grant.1',
        grantHash: HASH_B,
        displayLabel: 'movie.mp4',
      },
      overwriteExisting: false,
    },
    success: {
      operation: {
        id: 'operation.export.1',
        revision: 1,
        kind: 'delivery_export',
        ownerRef: {
          authority: 'delivery_export',
          id: 'export.1',
          revision: 1,
          contentHash: HASH_B,
        },
      },
      exportId: 'export.1',
      state: 'running',
      destinationLabel: 'movie.mp4',
      contentHash: null,
      artifact: null,
      cost: { state: 'known', value: '0', currency: 'USD' },
    },
  },
});

export const OperationGetDefinition = defineTool({
  id: 'operation.get',
  description:
    'Read or receipt-reconcile existing long-running operations without resubmitting them.',
  metadata: {
    ...readMetadata({
      domain: 'operation',
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: { mode: 'none', expectedFields: [] },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'summary', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['operations.artifacts'] },
      contextFactProjection: { mode: 'operation_state', fields: ['operations'] },
      variantDiscriminant: 'operations.kind',
      variants: [],
    }),
    variants: [
      ...['generation_attempt', 'media_derivation', 'result_assessment'].map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'R',
          effect: 'read',
          permissions: ['project.read'],
          confirmation: 'none',
          cost: 'none',
          unknownCost: 'not_applicable',
          cas: 'none',
          idempotency: 'read_fingerprint',
          retry: 'receipt_reconcile_only',
          timeout: 'bounded_read',
          cancellation: 'read_only',
          recovery: 'provider_receipt',
          unknownStateNeverResubmit: true,
        }),
      ),
      ...['review_cut_attempt', 'delivery_export'].map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'R',
          effect: 'read',
          permissions: ['project.read'],
          confirmation: 'none',
          cost: 'none',
          unknownCost: 'not_applicable',
          cas: 'none',
          idempotency: 'read_fingerprint',
          retry: 'safe',
          timeout: 'bounded_read',
          cancellation: 'read_only',
          recovery: 'authority_reread',
          unknownStateNeverResubmit: false,
        }),
      ),
    ],
  },
  inputSchema: OperationGetInputSchema,
  successSchema: OperationGetOutputSchema,
  examples: {
    input: {
      operations: [
        {
          id: 'operation.generation.1',
          revision: 1,
          kind: 'generation_attempt',
          ownerRef: {
            authority: 'generation_attempt',
            id: 'attempt.1',
            revision: 1,
            contentHash: HASH_A,
          },
        },
      ],
    },
    success: {
      operations: [
        {
          ref: {
            id: 'operation.generation.1',
            revision: 2,
            kind: 'generation_attempt',
            ownerRef: {
              authority: 'generation_attempt',
              id: 'attempt.1',
              revision: 2,
              contentHash: HASH_B,
            },
          },
          state: 'running',
          cancelRequested: false,
          progressPercent: 30,
          usage: {
            inputTokens: { state: 'unknown' },
            outputTokens: { state: 'unknown' },
            generatedUnits: { state: 'estimated', value: 1 },
            cost: { state: 'estimated', value: '0.2', currency: 'USD' },
          },
          publicErrorCode: null,
          resultRefs: [],
          artifacts: [],
        },
      ],
    },
  },
});

export const OperationCancelDefinition = defineTool({
  id: 'operation.cancel',
  description:
    'Request owner-specific cancellation for existing operations while retaining valid results and usage.',
  metadata: {
    ...controlMetadata({
      domain: 'operation',
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      cas: { mode: 'state', expectedFields: ['expectedRevision', 'expectedState'] },
      publicProgress: { mode: 'operation', redactArguments: true },
      publicResult: { mode: 'summary', redactProviderPayload: true },
      artifactProjection: { mode: 'from_success', fields: ['operations.artifacts'] },
      contextFactProjection: { mode: 'operation_state', fields: ['operations'] },
      variantDiscriminant: 'operations.ref.kind',
      variants: [],
    }),
    variants: [
      ...['generation_attempt', 'media_derivation', 'result_assessment'].map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'EXT',
          effect: 'external',
          permissions: ['run.control'],
          confirmation: 'none',
          cost: 'none',
          unknownCost: 'not_applicable',
          cas: 'state',
          idempotency: 'operation_fingerprint',
          retry: 'receipt_reconcile_only',
          timeout: 'long_running',
          cancellation: 'provider_declared',
          recovery: 'provider_receipt',
          unknownStateNeverResubmit: true,
        }),
      ),
      ...['review_cut_attempt', 'delivery_export'].map((discriminant) =>
        variantExecution({
          discriminant,
          profile: 'EXT',
          effect: 'external',
          permissions: ['run.control'],
          confirmation: 'none',
          cost: 'none',
          unknownCost: 'not_applicable',
          cas: 'state',
          idempotency: 'operation_fingerprint',
          retry: 'before_commit',
          timeout: 'long_running',
          cancellation: 'cooperative',
          recovery: 'authority_reread',
          unknownStateNeverResubmit: false,
        }),
      ),
    ],
  },
  inputSchema: OperationCancelInputSchema,
  successSchema: OperationCancelOutputSchema,
  examples: {
    input: {
      operations: [
        {
          ref: {
            id: 'operation.generation.1',
            revision: 2,
            kind: 'generation_attempt',
            ownerRef: {
              authority: 'generation_attempt',
              id: 'attempt.1',
              revision: 2,
              contentHash: HASH_A,
            },
          },
          expectedRevision: 2,
          expectedState: 'running',
        },
      ],
    },
    success: {
      operations: [
        {
          ref: {
            id: 'operation.generation.1',
            revision: 3,
            kind: 'generation_attempt',
            ownerRef: {
              authority: 'generation_attempt',
              id: 'attempt.1',
              revision: 3,
              contentHash: HASH_C,
            },
          },
          state: 'running',
          cancelRequested: true,
          progressPercent: 30,
          usage: {
            inputTokens: { state: 'unknown' },
            outputTokens: { state: 'unknown' },
            generatedUnits: { state: 'known', value: 1 },
            cost: { state: 'known', value: '0.2', currency: 'USD' },
          },
          publicErrorCode: null,
          resultRefs: [],
          artifacts: [],
        },
      ],
    },
  },
});

export const DELIVERY_TOOL_DEFINITIONS = Object.freeze([
  DeliveryQueryDefinition,
  DeliveryMutateDefinition,
  DeliveryPreviewDefinition,
  DeliveryFreezeDefinition,
  DeliveryExportDefinition,
  OperationGetDefinition,
  OperationCancelDefinition,
] as const);
