import { z, type ZodType } from 'zod';
import { strictObject, parseCanonical } from './canonical.js';
import {
  CanvasDocumentSchema,
  CanvasGeometrySchema,
  CanvasPointSchema,
  CanvasSizeSchema,
  CanvasTargetSchema,
  CanvasViewportSchema,
} from './canvas.js';
import { SkillProvenanceSchema, SkillTrustSchema } from './capability-catalog.js';
import {
  ChatSchema,
  MessageAttachmentSchema,
  MessageBlockSchema,
  MessageSchema,
  UserMessageSchema,
} from './conversation.js';
import {
  ChoiceOwnerRefSchema,
  DecisionProtectionCommandSchema,
  DecisionRecordCommandSchema,
  UserChoiceSchema,
} from './decision.js';
import {
  DeliveryAllowedExtensionsSchema,
  DeliveryDestinationGrantV1Schema,
  DeliveryManifestSchema,
  DeliveryMutationCommandSchema,
  DeliveryPlanSchema,
  DeliveryRefSchema,
} from './delivery.js';
import {
  GlobalMediaAssetSchema,
  MediaKindSchema,
  ProjectMediaLinkInputSchema,
  ProjectMediaLinkSuccessSchema,
  ProjectMediaRefSchema,
  ProjectMediaRoleSchema,
} from './media.js';
import {
  OperationCancelInputSchema,
  OperationCancelOutputSchema,
  OperationGetInputSchema,
  OperationGetOutputSchema,
  OperationRefSchema,
} from './operation.js';
import {
  ArtifactRefSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PermissionModeSchema,
  ResourceBudgetSchema,
  RevisionSchema,
  SafeLeafDisplayLabelSchema,
  SequenceSchema,
  Sha256Schema,
  UserChoiceRefSchema,
} from './primitives.js';
import {
  ProductionCitationFieldSchema,
  ProductionLifecycleSchema,
  ProductionObjectTypeSchema,
  ProductionObjectViewV1Schema,
  ProductionRelationSchema,
  ProductionTypedContentSchema,
} from './production.js';
import {
  PluginPackageApplyInputV1Schema,
  PluginPackageApplyOutputV1Schema,
  PluginPackageIdentityV1Schema,
  PluginPackageQueryInputV1Schema,
  PluginPackageQueryOutputV1Schema,
} from './plugin.js';
import {
  GeneratedResultRefSchema,
  ResultQueryInputSchema,
  ResultQuerySuccessSchema,
} from './generation.js';
import {
  ProductionMutationActionSchema,
  ProductionMutationReceiptSchema,
} from './tools/domain-tools.js';
import { MAX_MUTATION_BATCH } from './tools/common.js';
import { HistoryQueryDefinition } from './tools/context-tools.js';
import {
  ProjectEnabledSkillsSchema,
  ProjectFormatPolicySchema,
  ProjectLifecycleSchema,
  ProjectSchema,
  ProjectSettingsSchema,
} from './project.js';
import {
  PublicRunEventSchema,
  RunInboxMessageSchema,
  RunSchema,
  SelectedContextRefSchema,
  TaskListSchema,
} from './run.js';

export const WIRE_VERSION = 1 as const;
export const TARGET_WIRE_INVOKE_CHANNEL_V1 = 'lucid-fin:target:wire:v1' as const;
export const TARGET_WIRE_PUSH_CHANNEL_V1 = 'lucid-fin:target:push:v1' as const;
export const TARGET_DESKTOP_API_GLOBAL_V1 = 'lucidTarget' as const;

export const WireCursorV1Schema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^cur_[A-Za-z0-9_-]+$/);
export const OpaqueCapabilityTokenV1Schema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^cap_[A-Za-z0-9_-]+$/);

const PageInputV1Schema = strictObject({
  cursor: WireCursorV1Schema.nullable(),
  limit: z.number().int().min(1).max(200).finite(),
});

function pageOf<Item extends ZodType>(item: Item) {
  return strictObject({
    items: z.array(item).max(200),
    nextCursor: WireCursorV1Schema.nullable(),
  });
}

export const ProjectSummaryV1Schema = strictObject({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(240),
  lifecycle: ProjectLifecycleSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  updatedAt: IsoTimestampSchema,
});

export const GlobalMediaAssetViewV1Schema = strictObject({
  asset: GlobalMediaAssetSchema,
  byteLength: CountSchema,
  mimeType: z.string().trim().min(1).max(160),
});

export const OverviewV1Schema = strictObject({
  project: ProjectSchema,
  activeRuns: z.array(RunSchema).max(100),
  taskLists: z.array(TaskListSchema).max(100),
  counts: strictObject({
    chats: CountSchema,
    deliveryPlans: CountSchema,
    media: CountSchema,
    productionObjects: CountSchema,
  }),
});

export const ProjectCapabilityProviderSummaryV1Schema = strictObject({
  id: EntityIdSchema,
  displayName: z.string().trim().min(1).max(240),
  providerKind: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(200),
  status: z.enum(['ready', 'unavailable', 'disabled']),
  revision: RevisionSchema,
});
export const ProjectCapabilitySkillEligibilityV1Schema = z.enum(['available', 'quarantined']);
export const ProjectCapabilitySkillIndexV1Schema = strictObject({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000),
  version: z.string().trim().min(1).max(80),
  contentHash: Sha256Schema,
  provenance: SkillProvenanceSchema,
  trust: SkillTrustSchema,
  eligibility: ProjectCapabilitySkillEligibilityV1Schema,
  quarantineReason: z.string().trim().min(1).max(4_000).nullable(),
  pluginPackage: PluginPackageIdentityV1Schema.nullable(),
});
export const ProjectCapabilitiesV1Schema = strictObject({
  projectId: EntityIdSchema,
  providers: z.array(ProjectCapabilityProviderSummaryV1Schema).max(500),
  skills: z.array(ProjectCapabilitySkillIndexV1Schema).max(500),
});
export type ProjectCapabilitiesV1 = z.output<typeof ProjectCapabilitiesV1Schema>;

const ProjectCreateInputV1Schema = strictObject({
  name: z.string().trim().min(1).max(240),
  permissionMode: PermissionModeSchema,
  budget: ResourceBudgetSchema,
  formatPolicy: ProjectFormatPolicySchema,
});
const ProjectCapabilitiesGetInputV1Schema = strictObject({ projectId: EntityIdSchema });
const ProjectUpdateInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  name: z.string().trim().min(1).max(240).nullable(),
  lifecycle: ProjectLifecycleSchema.nullable(),
});
const ProjectSettingsUpdateInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
  defaultProviderProfileId: EntityIdSchema.nullable(),
  formatPolicy: ProjectFormatPolicySchema,
  permission: PermissionModeSchema,
  budget: ResourceBudgetSchema,
  enabledSkills: ProjectEnabledSkillsSchema,
});
const ProjectCreateOutputV1Schema = strictObject({
  project: ProjectSchema,
  settings: ProjectSettingsSchema,
}).refine(({ project, settings }) => project.id === settings.projectId, {
  path: ['settings', 'projectId'],
  message: 'Project settings must belong to the created Project',
});

const MediaPickerConstraintsV1Schema = strictObject({
  kinds: z.array(MediaKindSchema).min(1).max(4),
  multiple: z.boolean(),
});
const ExportPickerConstraintsV1Schema = strictObject({
  chatId: EntityIdSchema,
  projectId: EntityIdSchema,
  deliveryPlan: DeliveryRefSchema,
  destination: z.enum(['file', 'folder']),
  suggestedFileName: z.string().trim().min(1).max(240).nullable(),
  allowedExtensions: DeliveryAllowedExtensionsSchema,
});
export const CapabilityGrantV1Schema = strictObject({
  capabilityToken: OpaqueCapabilityTokenV1Schema,
  displayLabel: SafeLeafDisplayLabelSchema,
  expiresAt: IsoTimestampSchema,
});
export const ExportPickerResultV1Schema = z.union([
  strictObject({ state: z.literal('selected'), grant: DeliveryDestinationGrantV1Schema }),
  strictObject({ state: z.literal('cancelled') }),
]);

const GlobalMediaListInputV1Schema = strictObject({
  kinds: z.array(MediaKindSchema).max(4),
  query: z.string().trim().max(500),
  page: PageInputV1Schema,
});
const GlobalMediaImportInputV1Schema = strictObject({
  capabilityToken: OpaqueCapabilityTokenV1Schema,
  displayName: z.string().trim().min(1).max(240).nullable(),
  tags: z.array(z.string().trim().min(1).max(80)).max(100),
});
const GlobalMediaRemoveInputV1Schema = strictObject({
  globalAssetId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
});
const GlobalMediaRemoveOutputV1Schema = strictObject({
  globalAssetId: EntityIdSchema,
  removed: z.literal(true),
  blobRetainedForGarbageCollection: z.literal(true),
});

const ChatListInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  lifecycle: z.array(z.enum(['active', 'archived', 'deleted'])).max(3),
  page: PageInputV1Schema,
});
const ChatCreateInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  title: z.string().trim().min(1).max(240),
});
const ChatRenameInputV1Schema = strictObject({
  chatId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  title: z.string().trim().min(1).max(240),
});
const ChatLifecycleInputV1Schema = strictObject({
  chatId: EntityIdSchema,
  expectedRevision: RevisionSchema,
});
const MessageListInputV1Schema = strictObject({
  chatId: EntityIdSchema,
  beforeSequence: SequenceSchema.nullable(),
  page: PageInputV1Schema,
});
const MessageSendInputV1Schema = strictObject({
  chatId: EntityIdSchema,
  blocks: z.array(MessageBlockSchema).min(1).max(1000),
  attachments: z.array(MessageAttachmentSchema).max(100),
  selectedContext: z.array(SelectedContextRefSchema).max(1_000),
  supersedesMessageId: EntityIdSchema.nullable(),
  exportDestinationGrant: DeliveryDestinationGrantV1Schema.nullable(),
});
const MessageSendOutputV1Schema = strictObject({
  message: UserMessageSchema,
  chat: ChatSchema,
  acceptedRun: RunSchema,
}).superRefine(({ message, chat, acceptedRun }, context) => {
  if (
    chat.id !== message.chatId ||
    chat.id !== acceptedRun.chatId ||
    chat.projectId !== message.projectId ||
    chat.projectId !== acceptedRun.projectId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['chat'],
      message: 'Accepted Message, Chat, and Run must belong to the same Chat and Project',
    });
  }
});

const CanvasPlaceCommandV1Schema = strictObject({
  action: z.literal('place'),
  target: CanvasTargetSchema,
  position: CanvasPointSchema,
  size: CanvasSizeSchema,
  zIndex: z.number().int().finite(),
});
const CanvasMoveCommandV1Schema = strictObject({
  action: z.literal('move'),
  placementId: EntityIdSchema,
  position: CanvasPointSchema,
});
const CanvasResizeCommandV1Schema = strictObject({
  action: z.literal('resize'),
  placementId: EntityIdSchema,
  size: CanvasSizeSchema,
});
const CanvasRemoveCommandV1Schema = strictObject({
  action: z.literal('remove'),
  placementIds: z.array(EntityIdSchema).min(1).max(500),
});
const CanvasConnectCommandV1Schema = strictObject({
  action: z.literal('connect'),
  edgeId: EntityIdSchema,
  sourcePlacementId: EntityIdSchema,
  targetPlacementId: EntityIdSchema,
  label: z.string().max(240),
}).refine((edge) => edge.sourcePlacementId !== edge.targetPlacementId, {
  message: 'Canvas edge endpoints must differ',
});
const CanvasDisconnectCommandV1Schema = strictObject({
  action: z.literal('disconnect'),
  edgeId: EntityIdSchema,
});
const CanvasGroupCommandV1Schema = strictObject({
  action: z.literal('group'),
  groupId: EntityIdSchema,
  title: z.string().trim().min(1).max(240),
  placementIds: z.array(EntityIdSchema).min(1).max(500),
});
const CanvasUngroupCommandV1Schema = strictObject({
  action: z.literal('ungroup'),
  groupId: EntityIdSchema,
});
const CanvasAnnotateCommandV1Schema = strictObject({
  action: z.literal('annotate'),
  annotationId: EntityIdSchema,
  placementId: EntityIdSchema.nullable(),
  text: z.string().trim().min(1).max(20_000),
  geometry: CanvasGeometrySchema.nullable(),
});
const CanvasSaveViewCommandV1Schema = strictObject({
  action: z.literal('save_view'),
  viewId: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  viewport: CanvasViewportSchema,
});
const CanvasRestoreViewCommandV1Schema = strictObject({
  action: z.literal('restore_view'),
  viewId: EntityIdSchema,
});
const CanvasCommandV1Schema = z.union([
  CanvasPlaceCommandV1Schema,
  CanvasMoveCommandV1Schema,
  CanvasResizeCommandV1Schema,
  CanvasRemoveCommandV1Schema,
  CanvasConnectCommandV1Schema,
  CanvasDisconnectCommandV1Schema,
  CanvasGroupCommandV1Schema,
  CanvasUngroupCommandV1Schema,
  CanvasAnnotateCommandV1Schema,
  CanvasSaveViewCommandV1Schema,
  CanvasRestoreViewCommandV1Schema,
]);
const CanvasApplyInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  expectedCanvasRevision: RevisionSchema,
  command: CanvasCommandV1Schema,
});

const ProjectMediaListInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  roles: z.array(ProjectMediaRoleSchema).max(20),
  query: z.string().trim().max(500),
  page: PageInputV1Schema,
});
const ProjectMediaAttachInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  expectedProjectRevision: RevisionSchema,
  globalAssetId: EntityIdSchema,
  expectedExistingRef: strictObject({
    id: EntityIdSchema,
    expectedRevision: RevisionSchema,
    expectedContentHash: Sha256Schema,
  }).nullable(),
  label: z.string().trim().min(1).max(240),
  collections: z.array(z.string().trim().min(1).max(120)).max(100),
  roles: z.array(ProjectMediaRoleSchema).min(1).max(20),
  notes: z.string().max(10_000),
});
const ProjectMediaDetachInputV1Schema = strictObject({
  projectMediaRefId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  expectedContentHash: Sha256Schema,
});
const ProjectMediaMutationReceiptV1Schema = strictObject({
  object: ProjectMediaRefSchema,
  previousRevision: RevisionSchema.nullable(),
  eventId: EntityIdSchema,
  changedPaths: z
    .array(z.string().trim().min(1).max(160))
    .min(1)
    .max(100)
    .refine((paths) => new Set(paths).size === paths.length, {
      message: 'Changed paths must be unique',
    }),
  undoRef: EntityIdSchema.nullable(),
});
const ProjectMediaAttachOutputV1Schema = ProjectMediaMutationReceiptV1Schema.refine(
  (receipt) => receipt.object.lifecycle === 'active',
  { message: 'Attached Project Media must be active' },
);
const ProjectMediaDetachOutputV1Schema = ProjectMediaMutationReceiptV1Schema.refine(
  (receipt) => receipt.object.lifecycle === 'detached' && receipt.previousRevision !== null,
  { message: 'Detached Project Media must identify its previous revision' },
);

const ProjectMediaPreviewRefV1Schema = strictObject({
  authority: z.literal('project_media_ref'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
const PreviewableArtifactV1Schema = ArtifactRefSchema.refine(
  (artifact) => artifact.kind === 'image' || artifact.kind === 'video' || artifact.kind === 'audio',
  { message: 'Media Preview artifacts must be image, video, or audio' },
);
export const MediaPreviewSourceV1Schema = z.union([
  strictObject({
    kind: z.literal('project_media_ref'),
    ref: ProjectMediaPreviewRefV1Schema,
  }),
  strictObject({
    kind: z.literal('generated_result'),
    result: GeneratedResultRefSchema,
    artifact: PreviewableArtifactV1Schema,
  }),
]);
export type MediaPreviewSourceV1 = z.output<typeof MediaPreviewSourceV1Schema>;
export const MediaPreviewIssueInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  source: MediaPreviewSourceV1Schema,
});
export type MediaPreviewIssueInputV1 = z.output<typeof MediaPreviewIssueInputV1Schema>;
export const MediaPreviewCapabilityUrlV1Schema = z
  .string()
  .max(512)
  .regex(/^lucid-target-media:\/\/preview\/cap_[A-Za-z0-9_-]+$/u);
export const MediaPreviewKindV1Schema = z.enum(['image', 'video', 'audio']);
export const MediaPreviewMimeTypeV1Schema = z
  .string()
  .regex(/^(?:image|video|audio)\/[a-z0-9!#$&^_.+-]+$/u);
export const MediaPreviewCapabilityGrantV1Schema = strictObject({
  url: MediaPreviewCapabilityUrlV1Schema,
  expiresAt: IsoTimestampSchema,
  kind: MediaPreviewKindV1Schema,
  mimeType: MediaPreviewMimeTypeV1Schema,
});
export type MediaPreviewCapabilityGrantV1 = z.output<typeof MediaPreviewCapabilityGrantV1Schema>;

const ProductionQueryInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  ids: z.array(EntityIdSchema).max(500),
  types: z.array(ProductionObjectTypeSchema).max(20),
  includeArchived: z.boolean(),
  includeFactSources: z.boolean(),
  page: PageInputV1Schema,
});
const ProductionRefV1Schema = strictObject({
  authority: z.literal('production'),
  id: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
});
const ProductionCreateInputV1Schema = strictObject({
  action: z.literal('create'),
  projectId: EntityIdSchema,
  expectedProjectRevision: RevisionSchema,
  value: ProductionTypedContentSchema,
  relations: z.array(ProductionRelationSchema).max(500),
});
const ProductionReplaceInputV1Schema = strictObject({
  action: z.literal('replace'),
  projectId: EntityIdSchema,
  ref: ProductionRefV1Schema,
  lifecycle: ProductionLifecycleSchema,
  value: ProductionTypedContentSchema,
  relations: z.array(ProductionRelationSchema).max(500),
});
const ProductionCiteInputV1Schema = strictObject({
  action: z.literal('cite'),
  projectId: EntityIdSchema,
  ref: ProductionRefV1Schema,
  field: ProductionCitationFieldSchema,
  source: DomainObjectRefSchema,
  relation: z.enum(['supports', 'supersedes', 'contradicts']),
});
const ProductionApplyInputV1Schema = z.union([
  ProductionCreateInputV1Schema,
  ProductionReplaceInputV1Schema,
  ProductionCiteInputV1Schema,
]);

const DeliveryQueryInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  deliveryPlanIds: z.array(EntityIdSchema).max(200),
  page: PageInputV1Schema,
});
const DeliveryQueryOutputV1Schema = strictObject({
  plans: z.array(DeliveryPlanSchema).max(200),
  manifests: z.array(DeliveryManifestSchema).max(200),
  operations: z.array(OperationRefSchema).max(500),
  nextCursor: WireCursorV1Schema.nullable(),
});
const DeliveryApplyOutputV1Schema = strictObject({
  plan: DeliveryPlanSchema,
  choice: UserChoiceSchema,
});

export const HistoryQueryOrderV1Schema = z.enum(['chronological', 'reverse_chronological']);
export type HistoryQueryOrderV1 = z.output<typeof HistoryQueryOrderV1Schema>;
const HistoryQueryInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  query: HistoryQueryDefinition.inputSchema,
  order: HistoryQueryOrderV1Schema,
});
const ResultQueryInputV1Schema = strictObject({
  projectId: EntityIdSchema,
  query: ResultQueryInputSchema,
});

const RunEventsListInputV1Schema = strictObject({
  runId: EntityIdSchema,
  afterSequence: SequenceSchema.nullable(),
  page: PageInputV1Schema,
});
const RunControlInputV1Schema = z.union([
  strictObject({
    runId: EntityIdSchema,
    expectedRevision: RevisionSchema,
    action: z.literal('pause'),
    expectedStatus: z.literal('running'),
  }),
  strictObject({
    runId: EntityIdSchema,
    expectedRevision: RevisionSchema,
    action: z.literal('resume'),
    expectedStatus: z.literal('paused'),
  }),
  strictObject({
    runId: EntityIdSchema,
    expectedRevision: RevisionSchema,
    action: z.literal('cancel'),
    expectedStatus: z.enum([
      'accepted',
      'running',
      'waiting_question',
      'waiting_confirmation',
      'paused',
      'recovering',
    ]),
    terminalSummary: z.string().trim().min(1).max(100_000),
  }),
]);
const RunSendFollowupInputV1Schema = strictObject({
  runId: EntityIdSchema,
  expectedRevision: RevisionSchema,
  text: z.string().trim().min(1).max(200_000),
  selectedContext: z.array(SelectedContextRefSchema).max(1_000),
  exportDestinationGrant: DeliveryDestinationGrantV1Schema.nullable(),
});

const InteractionAnswerInputV1Schema = strictObject({
  interactionId: EntityIdSchema,
  answer: z.union([
    strictObject({ kind: z.literal('free_text'), text: z.string().trim().min(1).max(200_000) }),
    strictObject({
      kind: z.literal('options'),
      optionIds: z.array(EntityIdSchema).min(1).max(100),
    }),
  ]),
});
const InteractionAnswerOutputV1Schema = strictObject({
  interactionId: EntityIdSchema,
  messageId: EntityIdSchema,
  state: z.literal('answered'),
});
const ConfirmationRespondInputV1Schema = strictObject({
  confirmationId: EntityIdSchema,
  immutableInputHash: Sha256Schema,
  decision: z.enum(['approved', 'denied']),
});
const ConfirmationRespondOutputV1Schema = strictObject({
  confirmationId: EntityIdSchema,
  messageId: EntityIdSchema,
  decision: z.enum(['approved', 'denied']),
  effect: z.union([
    z.null(),
    strictObject({
      kind: z.literal('skill_registered'),
      projectId: EntityIdSchema,
      skillId: EntityIdSchema,
      version: z.string().trim().min(1).max(80),
      contentHash: Sha256Schema,
      projectSettingsRevision: RevisionSchema,
      projectSettingsContentHash: Sha256Schema,
      effectiveFrom: z.literal('next_root_run'),
    }),
    strictObject({
      kind: z.literal('delivery_mutated'),
      dispatchOperationId: EntityIdSchema,
      plan: DeliveryRefSchema,
      choice: UserChoiceRefSchema,
      outcomeHash: Sha256Schema,
    }),
    strictObject({
      kind: z.literal('production_mutated'),
      dispatchOperationId: EntityIdSchema,
      action: ProductionMutationActionSchema,
      receipts: z.array(ProductionMutationReceiptSchema).min(1).max(MAX_MUTATION_BATCH),
      outcomeHash: Sha256Schema,
    }),
    strictObject({
      kind: z.literal('decision_recorded'),
      dispatchOperationId: EntityIdSchema,
      choice: UserChoiceRefSchema,
      action: z.enum(['select', 'reject', 'refine', 'use_as_reference', 'undo']),
      owner: ChoiceOwnerRefSchema,
      currentState: z
        .enum(['selected', 'rejected', 'refine', 'reference', 'unreviewed'])
        .nullable(),
      eventId: EntityIdSchema,
      outcomeHash: Sha256Schema,
    }),
    strictObject({
      kind: z.literal('decision_protection_changed'),
      dispatchOperationId: EntityIdSchema,
      choice: UserChoiceRefSchema,
      active: z.boolean(),
      owner: ChoiceOwnerRefSchema,
      eventId: EntityIdSchema,
      outcomeHash: Sha256Schema,
    }),
  ]),
});

interface WireMethodDefinition<Input extends ZodType, Output extends ZodType> {
  readonly inputSchema: Input;
  readonly outputSchema: Output;
}

function wireMethod<Input extends ZodType, Output extends ZodType>(
  inputSchema: Input,
  outputSchema: Output,
): WireMethodDefinition<Input, Output> {
  return Object.freeze({ inputSchema, outputSchema });
}

export const PUBLIC_WIRE_METHODS_V1 = Object.freeze({
  'canvas.apply': wireMethod(CanvasApplyInputV1Schema, CanvasDocumentSchema),
  'canvas.get': wireMethod(strictObject({ projectId: EntityIdSchema }), CanvasDocumentSchema),
  'chat.archive': wireMethod(ChatLifecycleInputV1Schema, ChatSchema),
  'chat.create': wireMethod(ChatCreateInputV1Schema, ChatSchema),
  'chat.delete': wireMethod(ChatLifecycleInputV1Schema, ChatSchema),
  'chat.list': wireMethod(ChatListInputV1Schema, pageOf(ChatSchema)),
  'chat.rename': wireMethod(ChatRenameInputV1Schema, ChatSchema),
  'confirmation.respond': wireMethod(
    ConfirmationRespondInputV1Schema,
    ConfirmationRespondOutputV1Schema,
  ),
  'decision.protect': wireMethod(DecisionProtectionCommandSchema, UserChoiceSchema),
  'decision.record': wireMethod(DecisionRecordCommandSchema, UserChoiceSchema),
  'delivery.apply': wireMethod(DeliveryMutationCommandSchema, DeliveryApplyOutputV1Schema),
  'delivery.query': wireMethod(DeliveryQueryInputV1Schema, DeliveryQueryOutputV1Schema),
  'history.query': wireMethod(HistoryQueryInputV1Schema, HistoryQueryDefinition.successSchema),
  'interaction.answer': wireMethod(InteractionAnswerInputV1Schema, InteractionAnswerOutputV1Schema),
  'media.global.import': wireMethod(GlobalMediaImportInputV1Schema, GlobalMediaAssetViewV1Schema),
  'media.global.list': wireMethod(
    GlobalMediaListInputV1Schema,
    pageOf(GlobalMediaAssetViewV1Schema),
  ),
  'media.global.remove': wireMethod(
    GlobalMediaRemoveInputV1Schema,
    GlobalMediaRemoveOutputV1Schema,
  ),
  'media.project.attach': wireMethod(
    ProjectMediaAttachInputV1Schema,
    ProjectMediaAttachOutputV1Schema,
  ),
  'media.project.detach': wireMethod(
    ProjectMediaDetachInputV1Schema,
    ProjectMediaDetachOutputV1Schema,
  ),
  'media.project.link': wireMethod(ProjectMediaLinkInputSchema, ProjectMediaLinkSuccessSchema),
  'media.project.list': wireMethod(ProjectMediaListInputV1Schema, pageOf(ProjectMediaRefSchema)),
  'media.preview.issue': wireMethod(
    MediaPreviewIssueInputV1Schema,
    MediaPreviewCapabilityGrantV1Schema,
  ),
  'message.list': wireMethod(MessageListInputV1Schema, pageOf(MessageSchema)),
  'message.send': wireMethod(MessageSendInputV1Schema, MessageSendOutputV1Schema),
  'operation.cancel': wireMethod(OperationCancelInputSchema, OperationCancelOutputSchema),
  'operation.get': wireMethod(OperationGetInputSchema, OperationGetOutputSchema),
  'os.export.pick': wireMethod(ExportPickerConstraintsV1Schema, ExportPickerResultV1Schema),
  'os.media.pick': wireMethod(MediaPickerConstraintsV1Schema, CapabilityGrantV1Schema),
  'overview.get': wireMethod(strictObject({ projectId: EntityIdSchema }), OverviewV1Schema),
  'plugin.apply': wireMethod(PluginPackageApplyInputV1Schema, PluginPackageApplyOutputV1Schema),
  'plugin.query': wireMethod(PluginPackageQueryInputV1Schema, PluginPackageQueryOutputV1Schema),
  'production.apply': wireMethod(ProductionApplyInputV1Schema, ProductionObjectViewV1Schema),
  'production.query': wireMethod(
    ProductionQueryInputV1Schema,
    pageOf(ProductionObjectViewV1Schema),
  ),
  'project.capabilities.get': wireMethod(
    ProjectCapabilitiesGetInputV1Schema,
    ProjectCapabilitiesV1Schema,
  ),
  'project.create': wireMethod(ProjectCreateInputV1Schema, ProjectCreateOutputV1Schema),
  'project.get': wireMethod(strictObject({ projectId: EntityIdSchema }), ProjectSchema),
  'project.list': wireMethod(PageInputV1Schema, pageOf(ProjectSummaryV1Schema)),
  'project.settings.get': wireMethod(
    strictObject({ projectId: EntityIdSchema }),
    ProjectSettingsSchema,
  ),
  'project.settings.update': wireMethod(ProjectSettingsUpdateInputV1Schema, ProjectSettingsSchema),
  'project.update': wireMethod(ProjectUpdateInputV1Schema, ProjectSchema),
  'result.query': wireMethod(ResultQueryInputV1Schema, ResultQuerySuccessSchema),
  'run.control': wireMethod(RunControlInputV1Schema, RunSchema),
  'run.events.list': wireMethod(RunEventsListInputV1Schema, pageOf(PublicRunEventSchema)),
  'run.get': wireMethod(strictObject({ runId: EntityIdSchema }), RunSchema),
  'run.sendFollowup': wireMethod(RunSendFollowupInputV1Schema, RunInboxMessageSchema),
} as const);

export type PublicWireMethodV1 = keyof typeof PUBLIC_WIRE_METHODS_V1;

const methodNames = Object.keys(PUBLIC_WIRE_METHODS_V1) as [
  PublicWireMethodV1,
  ...PublicWireMethodV1[],
];
export const PublicWireMethodV1Schema = z.enum(methodNames);

const requestVariants = Object.entries(PUBLIC_WIRE_METHODS_V1).map(([method, definition]) =>
  strictObject({
    wireVersion: z.literal(WIRE_VERSION),
    kind: z.literal('request'),
    requestId: EntityIdSchema,
    method: z.literal(method as PublicWireMethodV1),
    input: definition.inputSchema,
  }),
);
const successVariants = Object.entries(PUBLIC_WIRE_METHODS_V1).map(([method, definition]) =>
  strictObject({
    wireVersion: z.literal(WIRE_VERSION),
    kind: z.literal('success'),
    requestId: EntityIdSchema,
    method: z.literal(method as PublicWireMethodV1),
    result: definition.outputSchema,
  }),
);

type SchemaTuple = [ZodType, ZodType, ...ZodType[]];

function schemaTuple(schemas: readonly ZodType[]): SchemaTuple {
  const [first, second, ...rest] = schemas;
  if (first === undefined || second === undefined) {
    throw new Error('Wire schema unions require at least two variants');
  }
  return [first, second, ...rest];
}

export const WireRequestV1Schema = z.union(schemaTuple(requestVariants));
export const WireSuccessV1Schema = z.union(schemaTuple(successVariants));

const StandardWireErrorV1Schema = strictObject({
  code: z.enum([
    'invalid_request',
    'permission_denied',
    'not_found',
    'revision_conflict',
    'budget_exceeded',
    'unavailable',
    'cancelled',
    'internal_failure',
    'idempotency_conflict',
  ]),
  publicSummary: z.string().trim().min(1).max(20_000),
  retryable: z.boolean(),
  correlationId: EntityIdSchema,
});

const ConfirmationRequiredWireErrorV1Schema = strictObject({
  code: z.literal('confirmation_required'),
  publicSummary: z.string().trim().min(1).max(20_000),
  retryable: z.literal(false),
  correlationId: EntityIdSchema,
  confirmationId: EntityIdSchema,
  immutableInputHash: Sha256Schema,
});

export const WireFailureV1Schema = strictObject({
  wireVersion: z.literal(WIRE_VERSION),
  kind: z.literal('failure'),
  requestId: EntityIdSchema,
  method: PublicWireMethodV1Schema,
  error: z.union([StandardWireErrorV1Schema, ConfirmationRequiredWireErrorV1Schema]),
});

export const WireResponseV1Schema = z.union([WireSuccessV1Schema, WireFailureV1Schema]);

export const RunEventCursorV1Schema = strictObject({
  sequence: SequenceSchema,
  eventHash: Sha256Schema,
});
export type RunEventCursorV1 = z.output<typeof RunEventCursorV1Schema>;
export const RunEventsAppendedPushPayloadV1Schema = strictObject({
  cursor: RunEventCursorV1Schema,
  event: PublicRunEventSchema,
}).superRefine(({ cursor, event }, context) => {
  if (cursor.sequence !== event.sequence) {
    context.addIssue({
      code: 'custom',
      path: ['cursor', 'sequence'],
      message: 'Cursor sequence mismatch',
    });
  }
  if (cursor.eventHash !== event.eventHash) {
    context.addIssue({
      code: 'custom',
      path: ['cursor', 'eventHash'],
      message: 'Cursor hash mismatch',
    });
  }
});
export const WirePushV1Schema = strictObject({
  wireVersion: z.literal(WIRE_VERSION),
  kind: z.literal('push'),
  method: z.literal('run.events.appended'),
  payload: RunEventsAppendedPushPayloadV1Schema,
});

export const WireEnvelopeV1Schema = z.union([
  WireRequestV1Schema,
  WireResponseV1Schema,
  WirePushV1Schema,
]);

type Registry = typeof PUBLIC_WIRE_METHODS_V1;
export type WireRequestV1 = {
  [Method in PublicWireMethodV1]: {
    readonly wireVersion: 1;
    readonly kind: 'request';
    readonly requestId: string;
    readonly method: Method;
    readonly input: z.output<Registry[Method]['inputSchema']>;
  };
}[PublicWireMethodV1];
export type WireSuccessV1 = {
  [Method in PublicWireMethodV1]: {
    readonly wireVersion: 1;
    readonly kind: 'success';
    readonly requestId: string;
    readonly method: Method;
    readonly result: z.output<Registry[Method]['outputSchema']>;
  };
}[PublicWireMethodV1];
export type WireFailureV1 = z.output<typeof WireFailureV1Schema>;
export type WireResponseV1 = WireSuccessV1 | WireFailureV1;
export type WirePushV1 = z.output<typeof WirePushV1Schema>;
export type WireEnvelopeV1 = WireRequestV1 | WireResponseV1 | WirePushV1;

export function parseRequestV1(input: unknown): WireRequestV1 {
  return parseCanonical(WireRequestV1Schema, input) as WireRequestV1;
}

export function parseResponseV1(input: unknown): WireResponseV1 {
  return parseCanonical(WireResponseV1Schema, input) as WireResponseV1;
}

export function parseWireEnvelopeV1(input: unknown): WireEnvelopeV1 {
  return parseCanonical(WireEnvelopeV1Schema, input) as WireEnvelopeV1;
}
