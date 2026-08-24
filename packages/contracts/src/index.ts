// DTO
export * from './dto/project.js';
export * from './dto/character.js';
export * from './dto/equipment.js';
export * from './dto/location.js';
export * from './dto/asset.js';
export * from './dto/folder.js';
export * from './dto/generation.js';
export * from './dto/resolution.js';
export * from './dto/adapter.js';
export * from './dto/provider-profile.js';
export * from './dto/ordered-delivery.js';
export * from './dto/script.js';
export * from './dto/color-style.js';
export * from './dto/visual-style.js';
export * from './dto/task-execution.js';
export * from './dto/prompt-assembly.js';
export * from './dto/canvas.js';
export * from './dto/presets/index.js';
export * from './llm-provider.js';
export * from './provider-media.js';
export * from './media-provider-catalog.js';
export * from './oauth-provider.js';

// Events
export * from './events/index.js';

// Errors
export * from './errors/index.js';
export * from './error.js';

// IPC (legacy — Phase B migrates to typed channels)
export type { IpcChannelMap, IpcStoredSession, IpcSnapshotMeta, IpcProcessPrompt } from './ipc.js';
export type { IpcChannel, IpcRequest, IpcResponse } from './ipc-helpers.js';
export type {
  CommanderStartRequest,
  CommanderStartResponse,
  CommanderRunIntent,
  CommanderAttachmentInput,
  CommanderAttachmentRole,
  CommanderRunAttachment,
  CommanderRunRecord,
  CommanderRunStatus,
  CommanderRunControlAction,
  CommanderRunControlRequest,
  CommanderRunControlResponse,
  CommanderRunTreeRequest,
  CommanderRunTreeResponse,
  PublicContextItem,
  CommanderContextCacheRun,
  CommanderContextCache,
  CommanderRunGetRequest,
  CommanderRunGetResponse,
  CommanderEventsHydrateRequest,
  CommanderEventsHydrateResponse,
  CommanderStreamPayload,
  CommanderProcessBehaviorSettings,
  CommanderPromptGuide,
  CommanderPromptGuideRetention,
  CommanderQualityGateBehavior,
  CommanderToolActionResponse,
  CommanderToolAnswerRequest,
  CommanderToolAnswerResponse,
  CommanderToolDecisionRequest,
  CommanderToolDecisionResponse,
  CommanderTaskListGuidePhase,
} from './ipc/channels/batch-09.js';
export { COMMANDER_GUIDE_LIMITS } from './ipc/channels/batch-09.js';
export type {
  CanvasDeliveryUpdateRequest,
  CanvasDeliveryUpdateResponse,
} from './ipc/channels/batch-07.js';

// ── Phase A: Type Foundation ───────────────────────────────────

// Branded IDs (type-only, zero runtime)
export type {
  CanvasId,
  NodeId,
  CharacterId,
  EquipmentId,
  LocationId,
  ProviderId,
  AdapterId,
  SessionId,
  TaskListId,
  TaskId,
  SnapshotId,
  AssetHash,
  AssetEntryId,
  PresetId,
  ShotTemplateId,
  ProcessPromptKey,
  PromptCode,
  IpcInvocationId,
  ToolKey,
  // IpcChannelBrand — not exported yet; Phase B replaces old IpcChannel
} from './types/brands.js';

// ── Phase G2a-1: ContextItem types ────────────────────────────
export type {
  ContextItemId,
  EntityRef,
  UserMessageItem,
  AssistantTurnItem,
  ToolResultItem,
  EntitySnapshotItem,
  GuideItem,
  SessionSummaryItem,
  ReferenceItem,
  ScratchpadItem,
  ContextItem,
  CompactionKeepRules,
  CompactStrategy,
  CompactionPolicy,
  TokenBudget,
  CompactionResult,
} from './agent/context-graph.js';

// Node-kind taxonomy
export {
  NODE_KINDS,
  GENERATABLE_NODE_KINDS,
  VISUAL_NODE_KINDS,
  GENERATION_INTENTS,
  type NodeKind,
  type GeneratableNodeKind,
  type VisualNodeKind,
  type MediaNodeKind,
  type GenerationIntent,
} from './types/node-kinds.js';

// Phase D-1: Generation subject + strategy key
export {
  generationStrategyKey,
  type GenerationSubject,
  type GenerationStrategyKey,
} from './types/generation-subject.js';

// Channel type shapes (pure types — factories in contracts-parse)
export type {
  InvokeChannelType,
  PushChannelType,
  ReplyChannelType,
  AnyChannelType,
} from './types/channel-types.js';

export type { UiEffect } from './types/tool-types.js';

// Table definition type shape (pure type — factory in contracts-parse)
export type { TableDef, ColumnDef } from './types/table-types.js';

// ── Phase B: IPC single source of truth ────────────────────────
// The generated `LucidAPI` interface — emitted by scripts/gen-preload.ts
// from the channel registry in contracts-parse. Pure types, zero zod.
//
// ⚠️ RUNTIME DRIFT WARNING — the runtime preload
// (apps/desktop-main/src/preload.cts, compiled to preload.cjs) is still
// hand-written and uses positional signatures for several APIs
// (e.g. `commander.chat(canvasId, message, ...)`). The generated
// `preload.generated.cts` uses object-style `method(req)` calls to match
// this type, but is NOT the active preload at runtime.
//
// Consumers that want the LIVE runtime shape MUST use
// `typeof window.lucidAPI` (see `apps/desktop-renderer/src/utils/api.ts`),
// NOT this generated type, until the runtime preload cutover completes.
// Importing `LucidAPI` from here and calling methods object-style will
// produce malformed IPC payloads that fail schema validation at runtime.
export type { LucidAPI, LucidAPIInfrastructure } from './ipc/lucid-api.generated.js';

export { ENTITY_REFRESH_TOOL_ENTITY } from './agent/entity-refresh-map.js';

// ── Commander wire envelope (v2-only) ──────────────────────────
export { COMMANDER_WIRE_VERSION, COMMANDER_WIRE_VERSION_LATEST } from './agent/wire-version.js';
export type {
  CommanderWireVersion,
  WireEnvelope,
  CommanderStreamEnvelope,
} from './agent/wire-version.js';

// ── Phase A: Commander timeline contracts ──────────────────────
export { toolRefKey, parseCanonicalToolName } from './agent/tool-ref.js';
export type { ToolRef } from './agent/tool-ref.js';
export { COMMANDER_ERROR_CODES } from './agent/error-code.js';
export type { CommanderError, CommanderErrorCode } from './agent/error-code.js';
export { PHASE_NOTE_CODES } from './agent/timeline-event.js';
export type {
  TimelineEvent,
  TimelineEventKind,
  TimelineExitDecisionMeta,
  RunResourceBudget,
  ResourceAmount,
  ResourceRemaining,
  RunResourceUsage,
  RunResourceRemainder,
  RunResourceClock,
  RunBlocker,
  ResourceStateCause,
  PhaseNoteCode,
  RunStartEvent,
  RunPausedEvent,
  RunResumedEvent,
  CommanderWorkType,
  CatalogFrozenEvent,
  RunCapabilityCatalogEntry,
  RunEndEvent,
  UserMessageEvent,
  AssistantTextEvent,
  PublicProgressEvent,
  ResourceUsageEvent,
  ResourceStateEvent,
  PublicToolDetailValue,
  PublicToolDetails,
  PublicChecklistArtifact,
  PublicAssetArtifact,
  PublicCanvasNodeArtifact,
  PublicToolArtifact,
  ContextAuthority,
  ContextFactRelation,
  PublicContextFact,
  ContextFactSource,
  ContextFactEvent,
  ToolCallEvent,
  ToolResultEvent,
  ToolConfirmPromptEvent,
  UserConfirmationEvent,
  QuestionPromptEvent,
  UserAnswerEvent,
  PhaseNoteEvent,
  CancelledEvent,
} from './agent/timeline-event.js';
