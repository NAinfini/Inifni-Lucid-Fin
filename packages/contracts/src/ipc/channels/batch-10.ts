/**
 * Pure type shapes for Batch 10 — tail of Phase B-1.
 *
 * Covers 47 invoke handlers and 9 push channels spread across many handler
 * files (see `apps/desktop-main/src/ipc/handlers/**` and `electron.ts`).
 *
 * Shapes follow the actual handler signatures. Media-engine DTOs
 * (NLEProject, SubtitleCue, RenderSegment, etc.) stay `unknown` — contracts
 * cannot depend on media-engine, and zodifying those lives in a later phase.
 *
 * Push channels:
 *  - ai:stream / ai:event
 *  - app:ready / app:init-error
 *  - clipboard:ai-detected
 *  - logger:entry
 *  - refimage:start / refimage:complete / refimage:failed
 *  - settings:providerKeyUpdated
 *  - updater:toast
 *  Note: `updater:status` is only registered as INVOKE (see Approach section
 *  in batch-10 spec); the same channel string is also emitted from
 *  `auto-updater.ts`, but a single registry entry per channel avoids
 *  codegen-name collisions. Renderer handles the emitted event by listening
 *  on the invoke's channel name directly.
 */

// Re-used type from llm-provider for keychain:test
import type { LLMProviderRuntimeInput } from '../../llm-provider.js';
export type { LLMProviderRuntimeInput } from '../../llm-provider.js';

// ─── app ─────────────────────────────────────────────────────
export type AppVersionRequest = Record<string, never>;
export type AppVersionResponse = string;

// ─── ai:chat ─────────────────────────────────────────────────
export interface AiChatRequest {
  message: string;
  context?: Record<string, unknown>;
}
// Handler returns the assistant reply string (or the error message on failure).
export type AiChatResponse = string;

// ─── ai:prompt:* ─────────────────────────────────────────────
export type AiPromptListRequest = Record<string, never>;
export interface AiPromptListEntry {
  code: string;
  name: string;
  type: string;
  hasCustom: boolean;
}
export type AiPromptListResponse = AiPromptListEntry[];

export interface AiPromptGetRequest {
  code: string;
}
export interface AiPromptGetResponse {
  code: string;
  name: string;
  defaultValue: string;
  customValue: string | null;
}

export interface AiPromptSetCustomRequest {
  code: string;
  value: string;
}
export type AiPromptSetCustomResponse = void;

export interface AiPromptClearCustomRequest {
  code: string;
}
export type AiPromptClearCustomResponse = void;

// ─── asset:* (embeddings + semantic search) ──────────────────
export interface AssetGenerateEmbeddingRequest {
  assetHash: string;
}
export interface AssetGenerateEmbeddingResponse {
  ok: boolean;
}

export type AssetReindexEmbeddingsRequest = Record<string, never>;
export interface AssetReindexEmbeddingsResponse {
  indexed: number;
  failed: number;
}

export interface AssetSearchSemanticRequest {
  query: string;
  limit?: number;
}
// Handler returns `db.searchByTokens(...)`; shape is storage-owned and
// opaque at the contract layer.
export type AssetSearchSemanticResponse = unknown[];

// ─── clipboard:setEnabled ────────────────────────────────────
export interface ClipboardSetEnabledRequest {
  enabled: boolean;
}
export type ClipboardSetEnabledResponse = void;

// ─── export:* (6) ────────────────────────────────────────────
// NLE export — format discriminates fcpxml/edl.
export interface ExportNleRequest {
  format: 'fcpxml' | 'edl';
  // NLEProject lives in media-engine; not contract-owned yet.
  project: unknown;
  outputPath?: string;
}
export type ExportNleResponse =
  | null
  | {
      outputPath: string;
      format: 'fcpxml' | 'edl';
      fileSize: number;
    };

export interface ExportAssetBundleRequest {
  assetHashes: string[];
  outputPath?: string;
}
export type ExportAssetBundleResponse =
  | null
  | {
      outputPath: string;
      fileCount: number;
      fileSize: number;
    };

export interface ExportSubtitlesRequest {
  format: 'srt' | 'ass';
  // SubtitleCue shape is media-engine-owned.
  cues: unknown[];
  outputPath: string;
  videoWidth?: number;
  videoHeight?: number;
}
export type ExportSubtitlesResponse = void;

export interface ExportStoryboardNode {
  title: string;
  prompt?: string;
  assetHash?: string;
  type: string;
  sceneNumber?: string;
  shotOrder?: number;
  annotation?: string;
  colorTag?: string;
  tags?: string[];
  providerId?: string;
  seed?: number;
}
export interface ExportStoryboardRequest {
  nodes: ExportStoryboardNode[];
  projectTitle?: string;
  outputPath?: string;
}
export type ExportStoryboardResponse =
  | null
  | { outputPath: string; nodeCount: number; fileSize: number };

export interface ExportMetadataNode {
  id: string;
  type: string;
  title: string;
  prompt?: string;
  negativePrompt?: string;
  providerId?: string;
  seed?: number;
  width?: number;
  height?: number;
  assetHash?: string;
  cost?: number;
  generationTimeMs?: number;
  sceneNumber?: string;
  shotOrder?: number;
  colorTag?: string;
  tags?: string[];
}
export interface ExportMetadataRequest {
  format: 'csv' | 'json';
  nodes: ExportMetadataNode[];
  projectTitle?: string;
  outputPath?: string;
}
export type ExportMetadataResponse =
  | null
  | {
      outputPath: string;
      format: 'csv' | 'json';
      nodeCount: number;
      fileSize: number;
    };

export interface ExportCapcutNode {
  title: string;
  assetHash: string;
  type: string;
  durationMs?: number;
}
export interface ExportCapcutRequest {
  nodes: ExportCapcutNode[];
  projectTitle?: string;
  outputDir?: string;
}
export type ExportCapcutResponse = null | { draftDir: string };

// ─── ffmpeg:* ────────────────────────────────────────────────
export interface FfmpegProbeRequest {
  filePath: string;
}
export interface FfmpegProbeResponse {
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
}

export interface FfmpegThumbnailRequest {
  filePath: string;
  timestamp: number;
}
export type FfmpegThumbnailResponse = string;

export interface FfmpegTranscodeRequest {
  input: string;
  output: string;
  options?: Record<string, unknown>;
}
export type FfmpegTranscodeResponse = void;

// ─── import:srt ──────────────────────────────────────────────
export interface ImportSrtRequest {
  canvasId: string;
  filePath: string;
  alignToNodes?: boolean;
}
export interface ImportSrtResponse {
  importedCount: number;
  alignedCount: number;
  noVideoNodes?: boolean;
}

// ─── ipc:ping — INTENTIONALLY UNREGISTERED ───────────────────
// Skipped to avoid a namespace collision with `LucidAPIInfrastructure.ipc`.
// See the matching note in the zod batch-10 registry file.

// ─── keychain:* (5) ──────────────────────────────────────────
export interface KeychainGetRequest {
  provider: string;
}
export type KeychainGetResponse = string | null;

export interface KeychainSetRequest {
  provider: string;
  apiKey: string;
}
export type KeychainSetResponse = void;

export interface KeychainDeleteRequest {
  provider: string;
}
export type KeychainDeleteResponse = void;

export interface KeychainTestRequest {
  provider: string;
  group?: 'llm' | 'image' | 'video' | 'audio' | 'vision';
  providerConfig?: LLMProviderRuntimeInput;
  baseUrl?: string;
  model?: string;
}
export type KeychainTestResponse = { ok: true } | { ok: false; error: string };

export interface KeychainIsConfiguredRequest {
  provider: string;
}
export type KeychainIsConfiguredResponse = boolean;

// ─── lipsync:* ───────────────────────────────────────────────
export type LipsyncCheckAvailabilityRequest = Record<string, never>;
export interface LipsyncCheckAvailabilityResponse {
  available: boolean;
  backend: string;
}

export interface LipsyncProcessRequest {
  canvasId: string;
  nodeId: string;
}
export type LipsyncProcessResponse = void;

// ─── logger:getRecent ────────────────────────────────────────
// LoggerEntry is owned by the desktop-main logger module. Contracts can't
// import from the app, so the shape is mirrored here.
export interface LoggerEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string;
  message: string;
  detail?: string;
}
export type LoggerGetRecentRequest = Record<string, never>;
export type LoggerGetRecentResponse = LoggerEntry[];

// ─── render:* (3) ────────────────────────────────────────────
export interface RenderStartRequest {
  sceneId: string;
  // RenderSegment[] is media-engine-owned.
  segments: unknown[];
  outputFormat: 'mp4' | 'mov' | 'webm';
  resolution?: { width: number; height: number };
  fps?: number;
  // RenderCodec / RenderPreset unions live in media-engine.
  codec?: string;
  quality?: string;
  outputPath?: string;
}
export interface RenderStartResponse {
  jobId: string;
  outputPath: string;
  duration: number;
  format: 'mp4' | 'mov' | 'webm';
}

export interface RenderCancelRequest {
  jobId: string;
}
export type RenderCancelResponse = void;

export interface RenderStatusRequest {
  jobId: string;
}
export interface RenderStatusResponse {
  progress: number;
  stage:
    | 'queued'
    | 'rendering'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'unknown';
  outputPath?: string;
  error?: string;
}

// ─── session:* (4) ───────────────────────────────────────────
export interface SessionListRequest {
  limit?: number;
}
// list() strips `messages` — the remaining fields mirror SqliteIndex session rows.
export interface SessionListEntry {
  id: string;
  canvasId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export type SessionListResponse = SessionListEntry[];

export interface SessionGetRequest {
  id: string;
}
export interface SessionGetResponse {
  id: string;
  canvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionUpsertRequest {
  id: string;
  canvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}
export type SessionUpsertResponse = void;

export interface SessionDeleteRequest {
  id: string;
}
export interface SessionDeleteResponse {
  success: boolean;
}

// ─── shell:openExternal ──────────────────────────────────────
export interface ShellOpenExternalRequest {
  url: string;
}
// Handler returns the shell.openExternal promise (boolean undefined). Kept
// permissive — renderer typically ignores the result.
export type ShellOpenExternalResponse = unknown;

// ─── snapshot:* (4) ──────────────────────────────────────────
export interface SnapshotCaptureRequest {
  sessionId: string;
  label: string;
  trigger?: 'auto' | 'manual';
}
// The handler strips the `data` blob before returning; the remaining keys
// are whatever `captureSnapshot` stamps on — kept opaque here.
export type SnapshotCaptureResponse = Record<string, unknown>;

export interface SnapshotListRequest {
  sessionId: string;
}
export type SnapshotListResponse = Array<Record<string, unknown>>;

export interface SnapshotRestoreRequest {
  snapshotId: string;
}
export interface SnapshotRestoreResponse {
  success: boolean;
}

export interface SnapshotDeleteRequest {
  snapshotId: string;
}
export interface SnapshotDeleteResponse {
  success: boolean;
}

// ─── updater:* (4 invoke) ────────────────────────────────────
export interface UpdaterUpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}
export interface UpdaterStatus {
  state:
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'error';
  progress?: number;
  info?: UpdaterUpdateInfo;
  error?: string;
}
export type UpdaterCheckRequest = Record<string, never>;
export type UpdaterCheckResponse = void;

export type UpdaterDownloadRequest = Record<string, never>;
export type UpdaterDownloadResponse = void;

export type UpdaterInstallRequest = Record<string, never>;
export type UpdaterInstallResponse = void;

export type UpdaterStatusRequest = Record<string, never>;
export type UpdaterStatusResponse = UpdaterStatus;

// ─── video:* (3) ─────────────────────────────────────────────
export type VideoPickFileRequest = Record<string, never>;
export type VideoPickFileResponse = string | null;

export interface VideoExtractLastFrameRequest {
  canvasId: string;
  nodeId: string;
}
export type VideoExtractLastFrameResponse = void;

export interface VideoCloneRequest {
  filePath: string;
  threshold?: number;
}
export interface VideoCloneResponse {
  canvasId: string;
  nodeCount: number;
}

// ─── vision:describeImage ────────────────────────────────────
export interface VisionDescribeImageRequest {
  assetHash: string;
  assetType: 'image' | 'video';
  style?: 'prompt' | 'description' | 'style-analysis';
}
export interface VisionDescribeImageResponse {
  prompt: string;
}

// ─── Push payloads ───────────────────────────────────────────

// ai:stream — main process emits either a delta chunk (event.content) or the
// whole error message string; kept as raw string at the contract.
export type AiStreamPayload = string;

// ai:event — mirrors AgentEvent from @lucid-fin/application. Duplicated here
// because contracts cannot depend on application.
export interface AiEventPayload {
  type:
    | 'tool_call'
    | 'tool_result'
    | 'stream_chunk'
    | 'error'
    | 'done'
    | 'tool_confirm'
    | 'tool_question'
    | 'thinking';
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  content?: string;
  error?: string;
  tier?: number;
  question?: string;
  options?: Array<{ label: string; description?: string }>;
  startedAt?: number;
  completedAt?: number;
}

// app:ready — fire-and-forget with no payload (Electron sends `undefined`).
export type AppReadyPayload = undefined;

// app:init-error — emitted as `String(err)`.
export type AppInitErrorPayload = string;

// clipboard:ai-detected
export interface ClipboardAiDetectedPayload {
  text: string;
}

// logger:entry — mirrors LoggerEntry above.
export type LoggerEntryPayload = LoggerEntry;

// refimage:start / :complete / :failed — emitted from commander-tool-deps.
export interface RefimageStartPayload {
  jobId: string;
  provider: string;
  width: number;
  height: number;
}
export interface RefimageCompletePayload {
  jobId: string;
  assetHash: string;
}
export interface RefimageFailedPayload {
  jobId: string;
  error: string;
}

// settings:providerKeyUpdated — emitted from commander-tool-deps when a
// provider's API key is stored or deleted.
export interface SettingsProviderKeyUpdatedPayload {
  group: string;
  providerId: string;
  hasKey: boolean;
}

// updater:toast — emitted from auto-updater.ts when an update is available.
export interface UpdaterToastPayload {
  version: string;
}
