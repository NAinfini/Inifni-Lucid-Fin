// DTO
export * from './dto/project.js';
export * from './dto/character.js';
export * from './dto/equipment.js';
export * from './dto/location.js';
export * from './dto/asset.js';
export * from './dto/job.js';
export * from './dto/adapter.js';
export * from './dto/provider-profile.js';
export * from './dto/timeline.js';
export * from './dto/script.js';
export * from './dto/color-style.js';
export * from './dto/workflow.js';
export * from './dto/canvas.js';
export * from './dto/presets/index.js';
export * from './llm-provider.js';
export * from './provider-media.js';

// Events
export * from './events/index.js';

// Errors
export * from './errors/index.js';
export * from './error.js';

// IPC (legacy — Phase B migrates to typed channels)
export type { IpcChannelMap, IpcStoredSession, IpcSnapshotMeta, IpcProcessPrompt } from './ipc.js';
export type { IpcChannel, IpcRequest, IpcResponse } from './ipc-helpers.js';

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
  JobId,
  SessionId,
  WorkflowRunId,
  WorkflowStageId,
  WorkflowTaskId,
  SnapshotId,
  AssetHash,
  PresetId,
  ShotTemplateId,
  ProcessPromptKey,
  PromptCode,
  IpcInvocationId,
  ToolKey,
  // IpcChannelBrand — not exported yet; Phase B replaces old IpcChannel
} from './types/brands.js';

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

// Tool definition type shape (pure type — factory in contracts-parse)
export type {
  ToolDefinitionType,
  UiEffect,
} from './types/tool-types.js';

// Table definition type shape (pure type — factory in contracts-parse)
export type {
  TableDef,
  ColumnDef,
} from './types/table-types.js';

// ── Phase B: IPC single source of truth ────────────────────────
// The generated `LucidAPI` interface — emitted by scripts/gen-preload.ts
// from the channel registry in contracts-parse. Pure types, zero zod.
export type {
  LucidAPI,
  LucidAPIInfrastructure,
} from './ipc/lucid-api.generated.js';

// ── Phase C-1: Tool catalog aggregator (pure types) ────────────
// `ToolKey` is re-exported as `CatalogToolKey` to avoid colliding with the
// legacy branded `ToolKey` above. Consumers that want the agent namespace
// should import from '@lucid-fin/contracts/agent' (via dist) or pick names
// explicitly. The branded `ToolKey` is slated for removal in a later phase.
export type { ToolCatalog, ProcessCategory } from './agent/tool-catalog-type.js';
export type { ToolKey as CatalogToolKey } from './agent/tool-catalog-type.js';
export { ENTITY_REFRESH_TOOL_ENTITY } from './agent/entity-refresh-map.js';
