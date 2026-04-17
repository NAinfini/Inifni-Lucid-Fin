export { unsafeBrand } from './brand.js';
export {
  parseStrict,
  parseOrDegrade,
  parsePartial,
  makeBrandParser,
  makeTryBrand,
  setDegradeReporter,
  z,
  type DegradeReporter,
  type ParseContext,
} from './parse.js';

// IPC channel factories
export {
  defineInvokeChannel,
  definePushChannel,
  defineReplyChannel,
  type InvokeChannelDef,
  type PushChannelDef,
  type ReplyChannelDef,
} from './channels.js';

// Tool factory
export {
  defineTool,
  defineToolMeta,
  type ToolDef,
  type ToolRunContext,
  type ToolEvent,
} from './tools.js';

// Table factory
export { defineTable, col } from './tables.js';

// Storage table constants (Phase G1-1)
export * from './storage/tables/index.js';

// Channel registry (seed — Phase B batches append here)
export {
  allChannels,
  healthPingChannel,
  healthChannels,
  type HealthPingRequest,
  type HealthPingResponse,
} from './ipc/index.js';

// Batch 1 — settings + script
export * from './ipc/channels/batch-01.js';

// Batch 2 — character + equipment
export * from './ipc/channels/batch-02.js';

// Batch 3 — location + style + entity + colorStyle
export * from './ipc/channels/batch-03.js';

// Batch 4 — asset + storage
export * from './ipc/channels/batch-04.js';

// Batch 5 — job
export * from './ipc/channels/batch-05.js';

// Batch 6 — workflow
export * from './ipc/channels/batch-06.js';

// Batch 7 — canvas core (non-generation)
export * from './ipc/channels/batch-07.js';

// Batch 8 — canvas generation + preset
export * from './ipc/channels/batch-08.js';

// Batch 9 — commander:* (invoke + push)
export * from './ipc/channels/batch-09.js';

// Batch 10 — tail of Phase B-1 (app/ai/asset/clipboard/export/ffmpeg/
// import/ipc/keychain/lipsync/logger/render/session/shell/snapshot/
// updater/video/vision + refimage push + settings push)
export * from './ipc/channels/batch-10.js';

// ── Phase C-1: Agent / tool catalog ────────────────────────────
// `defineTool` and its types are re-exported above from `./tools.js`; the
// agent barrel adds `createCatalog` on top without duplicating them.
export { createCatalog } from './agent/catalog.js';

// ── Phase D-2: Branded-ID parsers ──────────────────────────────
export { parseProviderId, tryProviderId } from './brands/provider-id.js';

// ── Phase G1-2.1: SessionId parser + StoredSession DTO ─────────
export { parseSessionId, trySessionId } from './brands/session-id.js';
export { StoredSessionSchema, type StoredSessionDto } from './dto/stored-session.js';

// ── Phase G1-2.2: ProcessPromptKey parser + ProcessPromptRecord DTO ─
export {
  parseProcessPromptKey,
  tryProcessPromptKey,
} from './brands/process-prompt-key.js';
export {
  ProcessPromptRecordSchema,
  type ProcessPromptRecordDto,
} from './dto/process-prompt-record.js';

// ── Phase G1-2.3: JobId parser + Job DTO ───────────────────────
export { parseJobId, tryJobId } from './brands/job-id.js';
export { JobSchema, type JobDto } from './dto/job.js';

// ── Phase G1-2.4: AssetHash parser + AssetMeta / Embedding DTOs ─
export { parseAssetHash, tryAssetHash } from './brands/asset-hash.js';
export {
  AssetMetaSchema,
  EmbeddingRecordSchema,
  type AssetMetaDto,
  type EmbeddingRecordDto,
} from './dto/asset.js';

// ── Phase G1-2.5: CanvasId parser + Canvas DTO ─────────────────
export { parseCanvasId, tryCanvasId } from './brands/canvas-id.js';
export {
  CanvasSchema,
  CanvasViewportSchema,
  type CanvasDto,
} from './dto/canvas.js';

// ── Phase G1-2.6: Entity-domain ID parsers + DTOs ──────────────
export { parseCharacterId, tryCharacterId } from './brands/character-id.js';
export { parseEquipmentId, tryEquipmentId } from './brands/equipment-id.js';
export { parseLocationId, tryLocationId } from './brands/location-id.js';
export {
  CharacterSchema,
  EquipmentSchema,
  LocationSchema,
  type CharacterDto,
  type EquipmentDto,
  type LocationDto,
} from './dto/entity.js';

// ── Phase G1-2.7: SeriesId + EpisodeId parsers + Series/Episode DTOs ─
export { parseSeriesId, trySeriesId } from './brands/series-id.js';
export { parseEpisodeId, tryEpisodeId } from './brands/episode-id.js';
export {
  SeriesSchema,
  EpisodeSchema,
  type SeriesDto,
  type EpisodeDto,
} from './dto/series.js';

// ── Phase G1-2.8: PresetId parser + PresetOverride DTO ─────────
export { parsePresetId, tryPresetId } from './brands/preset-id.js';
export {
  PresetOverrideSchema,
  type PresetOverrideDto,
} from './dto/preset.js';

// ── Phase G1-2.9: ShotTemplateId parser + ShotTemplate DTO ─────
export { parseShotTemplateId, tryShotTemplateId } from './brands/shot-template-id.js';
export {
  ShotTemplateSchema,
  type ShotTemplateDto,
} from './dto/shot-template.js';

// ── Phase G1-2.10: SnapshotId parser + StoredSnapshot DTO ──────
export { parseSnapshotId, trySnapshotId } from './brands/snapshot-id.js';
export {
  StoredSnapshotSchema,
  type StoredSnapshotDto,
} from './dto/snapshot.js';

// ── Phase G1-2.11: Workflow-domain ID parsers + run/stage/task DTOs ─
export {
  parseWorkflowRunId,
  tryWorkflowRunId,
  parseWorkflowStageId,
  tryWorkflowStageId,
  parseWorkflowTaskId,
  tryWorkflowTaskId,
} from './brands/workflow-ids.js';
export {
  WorkflowRunRecordSchema,
  WorkflowStageRunRecordSchema,
  WorkflowTaskRunRecordSchema,
  type WorkflowRunRecordDto,
  type WorkflowStageRunRecordDto,
  type WorkflowTaskRunRecordDto,
} from './dto/workflow.js';

// ── Phase G2a-1: ContextItemId brand parsers + ContextItemSchema ─
export {
  parseContextItemId,
  tryContextItemId,
  freshContextItemId,
} from './brands/context-item-id.js';
export {
  ContextItemSchema,
  type ContextItemSchemaType,
} from './storage/schemas/context-graph.js';
