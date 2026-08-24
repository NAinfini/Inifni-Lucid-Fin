/**
 * Pure type shapes for Batch 10 — tail of Phase B-1.
 *
 * Covers the tail invoke handlers and push channels spread across main-process
 * handlers and `electron.ts`. Shapes follow the actual handler signatures.
 *
 * Push channels:
 *  - app:ready / app:init-error
 *  - clipboard:ai-detected
 *  - logger:entry
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

// ─── clipboard:setEnabled ────────────────────────────────────
export interface ClipboardSetEnabledRequest {
  enabled: boolean;
}
export type ClipboardSetEnabledResponse = void;

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

// ─── deliveryPackage:* (5) ──────────────────────────────────
export type DeliveryPackageAttemptStatus =
  | 'queued'
  | 'running'
  | 'ready_to_publish'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recovery_required';

export interface DeliveryPackageAttemptView {
  attemptId: string;
  status: DeliveryPackageAttemptStatus;
  progress: number;
  destinationPath: string;
  manifestRevision: number;
  manifestHash: string;
  attempt: number;
  error?: string;
}

export interface DeliveryPackageStartRequest {
  taskListId: string;
  canvasId: string;
  expectedManifestRevision: number;
  expectedManifestHash: string;
}
export type DeliveryPackageStartResponse =
  | { cancelled: true }
  | { cancelled: false; attempt: DeliveryPackageAttemptView };

export interface DeliveryPackageStatusRequest {
  attemptId: string;
}
export type DeliveryPackageStatusResponse = DeliveryPackageAttemptView | null;

export interface DeliveryPackageCancelRequest {
  attemptId: string;
}
export interface DeliveryPackageCancelResponse {
  attempt: DeliveryPackageAttemptView | null;
}

export interface DeliveryPackageRetryRequest {
  attemptId: string;
}
export interface DeliveryPackageRetryResponse {
  attempt: DeliveryPackageAttemptView;
}

export interface DeliveryPackageOpenRequest {
  attemptId: string;
}
export interface DeliveryPackageOpenResponse {
  opened: true;
}

// ─── reviewCut:* (4) ────────────────────────────────────────
export type ReviewCutJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ReviewCutJobView {
  jobId: string;
  status: ReviewCutJobStatus;
  progress: number;
  outputPath: string;
  manifestRevision: number;
  manifestHash: string;
  error?: string;
}

export interface ReviewCutStartRequest {
  taskListId: string;
  canvasId: string;
  expectedManifestRevision: number;
  expectedManifestHash: string;
}
export type ReviewCutStartResponse =
  | { cancelled: true }
  | { cancelled: false; job: ReviewCutJobView };

export interface ReviewCutStatusRequest {
  jobId: string;
}
export type ReviewCutStatusResponse = ReviewCutJobView | null;

export interface ReviewCutCancelRequest {
  jobId: string;
}
export interface ReviewCutCancelResponse {
  job: ReviewCutJobView | null;
}

export interface ReviewCutOpenRequest {
  jobId: string;
}
export interface ReviewCutOpenResponse {
  opened: true;
}

// ─── session:* (5) ───────────────────────────────────────────
export interface SessionListRequest {
  limit?: number;
}
// list() strips `messages` — the remaining fields mirror SqliteIndex session rows.
export interface SessionListEntry {
  id: string;
  defaultCanvasId: string | null;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}
export type SessionListResponse = SessionListEntry[];

export interface SessionGetRequest {
  id: string;
}
export interface SessionGetResponse {
  id: string;
  defaultCanvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionUpsertRequest {
  id: string;
  defaultCanvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}
export type SessionUpsertResponse = void;

export interface SessionMoveRequest {
  id: string;
  defaultCanvasId: string | null;
}
export interface SessionMoveResponse {
  success: true;
}

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
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
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
