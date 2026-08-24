/**
 * Batch 10 — tail of Phase B-1 IPC migration.
 *
 * Registers the remaining invoke handlers and push channels that were not
 * covered by batches 1-9. Storage-owned blobs remain opaque at this boundary.
 *
 * Collision note: `updater:status` is also emitted via `webContents.send`
 * from `auto-updater.ts`. To avoid a codegen name clash between an invoke
 * and a push on the same channel string, only the invoke entry is registered
 * here. The renderer listens for status events on the same channel name
 * through the generic subscription surface.
 */
import { z } from 'zod';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

// ─── app:version ─────────────────────────────────────────────
const AppVersionRequest = z.object({}).strict();
const AppVersionResponse = z.string();
export const appVersionChannel = defineInvokeChannel({
  channel: 'app:version',
  request: AppVersionRequest,
  response: AppVersionResponse,
});
export type AppVersionRequest = z.infer<typeof AppVersionRequest>;
export type AppVersionResponse = z.infer<typeof AppVersionResponse>;

// ─── clipboard:setEnabled ────────────────────────────────────
const ClipboardSetEnabledRequest = z.object({ enabled: z.boolean() });
const ClipboardSetEnabledResponse = z.void();
export const clipboardSetEnabledChannel = defineInvokeChannel({
  channel: 'clipboard:setEnabled',
  request: ClipboardSetEnabledRequest,
  response: ClipboardSetEnabledResponse,
});
export type ClipboardSetEnabledRequest = z.infer<typeof ClipboardSetEnabledRequest>;
export type ClipboardSetEnabledResponse = z.infer<typeof ClipboardSetEnabledResponse>;

// ─── ffmpeg:probe ────────────────────────────────────────────
const FfmpegProbeRequest = z.object({ filePath: z.string() });
const FfmpegProbeResponse = z.object({
  duration: z.number(),
  width: z.number(),
  height: z.number(),
  codec: z.string(),
  fps: z.number(),
});
export const ffmpegProbeChannel = defineInvokeChannel({
  channel: 'ffmpeg:probe',
  request: FfmpegProbeRequest,
  response: FfmpegProbeResponse,
});
export type FfmpegProbeRequest = z.infer<typeof FfmpegProbeRequest>;
export type FfmpegProbeResponse = z.infer<typeof FfmpegProbeResponse>;

// ─── ffmpeg:thumbnail ────────────────────────────────────────
const FfmpegThumbnailRequest = z.object({
  filePath: z.string(),
  timestamp: z.number(),
});
const FfmpegThumbnailResponse = z.string();
export const ffmpegThumbnailChannel = defineInvokeChannel({
  channel: 'ffmpeg:thumbnail',
  request: FfmpegThumbnailRequest,
  response: FfmpegThumbnailResponse,
});
export type FfmpegThumbnailRequest = z.infer<typeof FfmpegThumbnailRequest>;
export type FfmpegThumbnailResponse = z.infer<typeof FfmpegThumbnailResponse>;

// ─── ffmpeg:transcode ────────────────────────────────────────
const FfmpegTranscodeRequest = z.object({
  input: z.string(),
  output: z.string(),
  options: z.record(z.string(), z.unknown()).optional(),
});
const FfmpegTranscodeResponse = z.void();
export const ffmpegTranscodeChannel = defineInvokeChannel({
  channel: 'ffmpeg:transcode',
  request: FfmpegTranscodeRequest,
  response: FfmpegTranscodeResponse,
});
export type FfmpegTranscodeRequest = z.infer<typeof FfmpegTranscodeRequest>;
export type FfmpegTranscodeResponse = z.infer<typeof FfmpegTranscodeResponse>;

// ─── ipc:ping — typed descriptor, NOT in allChannels ────────
// The hand-written infrastructure surface (see `LucidAPIInfrastructure`) owns
// the `ipc` namespace with `cancel/onInvocation/onEvent`. Registering any
// channel with the `ipc:` prefix makes the codegen emit a `LucidAPI_Ipc`
// interface that shadows the infra methods and causes a TS2430 extends
// conflict.
//
// The channel descriptor is exported so `electron.ts` can migrate from the
// raw `ipcMain.handle('ipc:ping', ...)` to `registerInvoke`. It is NOT
// included in `appChannels` / `allChannels` to keep codegen safe.
const IpcPingRequest = z.object({}).strict().default({});
const IpcPingResponse = z.literal('pong');
export const pingChannel = defineInvokeChannel({
  channel: 'ipc:ping',
  request: IpcPingRequest,
  response: IpcPingResponse,
});
export type IpcPingRequest = z.infer<typeof IpcPingRequest>;
export type IpcPingResponse = z.infer<typeof IpcPingResponse>;

// ─── app:restart ──────────────────────────────────────────────
const AppRestartRequest = z.object({}).strict().default({});
const AppRestartResponse = z.void();
export const appRestartChannel = defineInvokeChannel({
  channel: 'app:restart',
  request: AppRestartRequest,
  response: AppRestartResponse,
});
export type AppRestartRequest = z.infer<typeof AppRestartRequest>;
export type AppRestartResponse = z.infer<typeof AppRestartResponse>;

// ─── keychain:* ──────────────────────────────────────────────
const KeychainGetRequest = z.object({ provider: z.string() });
const KeychainGetResponse = z.string().nullable();
export const keychainGetMaskedChannel = defineInvokeChannel({
  channel: 'keychain:getMasked',
  request: KeychainGetRequest,
  response: KeychainGetResponse,
});
export type KeychainGetRequest = z.infer<typeof KeychainGetRequest>;
export type KeychainGetResponse = z.infer<typeof KeychainGetResponse>;

const KeychainSetRequest = z.object({
  provider: z.string(),
  apiKey: z.string(),
});
const KeychainSetResponse = z.void();
export const keychainSetChannel = defineInvokeChannel({
  channel: 'keychain:set',
  request: KeychainSetRequest,
  response: KeychainSetResponse,
});
export type KeychainSetRequest = z.infer<typeof KeychainSetRequest>;
export type KeychainSetResponse = z.infer<typeof KeychainSetResponse>;

const KeychainDeleteRequest = z.object({ provider: z.string() });
const KeychainDeleteResponse = z.void();
export const keychainDeleteChannel = defineInvokeChannel({
  channel: 'keychain:delete',
  request: KeychainDeleteRequest,
  response: KeychainDeleteResponse,
});
export type KeychainDeleteRequest = z.infer<typeof KeychainDeleteRequest>;
export type KeychainDeleteResponse = z.infer<typeof KeychainDeleteResponse>;

// Mirror of LLMProviderRuntimeInput (`contracts/src/llm-provider.ts`): an
// `id`-required partial of LLMProviderRuntimeConfig.
const LLMProviderRuntimeInputShape = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
    protocol: z
      .enum(['openai-compatible', 'openai-responses', 'anthropic', 'gemini', 'cohere'])
      .optional(),
    authStyle: z.enum(['bearer', 'x-api-key', 'x-goog-api-key', 'none']).optional(),
    contextWindow: z.number().optional(),
  })
  .passthrough();

const KeychainTestRequest = z
  .object({
    provider: z.string(),
    group: z.enum(['llm', 'image', 'video', 'audio', 'vision']).optional(),
    providerConfig: LLMProviderRuntimeInputShape.optional(),
    baseUrl: z.string().optional(),
    model: z.string().optional(),
  })
  .passthrough();
const KeychainTestResponse = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export const keychainTestChannel = defineInvokeChannel({
  channel: 'keychain:test',
  request: KeychainTestRequest,
  response: KeychainTestResponse,
});
export type KeychainTestRequest = z.infer<typeof KeychainTestRequest>;
export type KeychainTestResponse = z.infer<typeof KeychainTestResponse>;

const KeychainIsConfiguredRequest = z.object({ provider: z.string() });
const KeychainIsConfiguredResponse = z.boolean();
export const keychainIsConfiguredChannel = defineInvokeChannel({
  channel: 'keychain:isConfigured',
  request: KeychainIsConfiguredRequest,
  response: KeychainIsConfiguredResponse,
});
export type KeychainIsConfiguredRequest = z.infer<typeof KeychainIsConfiguredRequest>;
export type KeychainIsConfiguredResponse = z.infer<typeof KeychainIsConfiguredResponse>;

// ─── logger:getRecent ────────────────────────────────────────
const LoggerEntryShape = z
  .object({
    id: z.string(),
    timestamp: z.number(),
    level: z.enum(['debug', 'info', 'warn', 'error', 'fatal']),
    category: z.string(),
    message: z.string(),
    detail: z.string().optional(),
  })
  .passthrough();
const LoggerGetRecentRequest = z.object({}).strict();
const LoggerGetRecentResponse = z.array(LoggerEntryShape);
export const loggerGetRecentChannel = defineInvokeChannel({
  channel: 'logger:getRecent',
  request: LoggerGetRecentRequest,
  response: LoggerGetRecentResponse,
});
export type LoggerGetRecentRequest = z.infer<typeof LoggerGetRecentRequest>;
export type LoggerGetRecentResponse = z.infer<typeof LoggerGetRecentResponse>;

// ─── deliveryPackage:* ──────────────────────────────────────
const DeliveryPackageStatus = z.enum([
  'queued',
  'running',
  'ready_to_publish',
  'completed',
  'failed',
  'cancelled',
  'recovery_required',
]);
const DeliveryPackageAttemptView = z
  .object({
    attemptId: z.string().min(1),
    status: DeliveryPackageStatus,
    progress: z.number().min(0).max(100),
    destinationPath: z.string().min(1),
    manifestRevision: z.number().int().positive(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    attempt: z.number().int().positive(),
    error: z.string().optional(),
  })
  .strict();

const DeliveryPackageStartRequest = z
  .object({
    taskListId: z.string().min(1),
    canvasId: z.string().min(1),
    expectedManifestRevision: z.number().int().positive(),
    expectedManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const DeliveryPackageStartResponse = z.discriminatedUnion('cancelled', [
  z.object({ cancelled: z.literal(true) }).strict(),
  z.object({ cancelled: z.literal(false), attempt: DeliveryPackageAttemptView }).strict(),
]);
export const deliveryPackageStartChannel = defineInvokeChannel({
  channel: 'deliveryPackage:start',
  request: DeliveryPackageStartRequest,
  response: DeliveryPackageStartResponse,
});
export type DeliveryPackageStartRequest = z.infer<typeof DeliveryPackageStartRequest>;
export type DeliveryPackageStartResponse = z.infer<typeof DeliveryPackageStartResponse>;

const DeliveryPackageStatusRequest = z.object({ attemptId: z.string().min(1) }).strict();
const DeliveryPackageStatusResponse = DeliveryPackageAttemptView.nullable();
export const deliveryPackageStatusChannel = defineInvokeChannel({
  channel: 'deliveryPackage:status',
  request: DeliveryPackageStatusRequest,
  response: DeliveryPackageStatusResponse,
});
export type DeliveryPackageStatusRequest = z.infer<typeof DeliveryPackageStatusRequest>;
export type DeliveryPackageStatusResponse = z.infer<typeof DeliveryPackageStatusResponse>;

const DeliveryPackageCancelRequest = z.object({ attemptId: z.string().min(1) }).strict();
const DeliveryPackageCancelResponse = z
  .object({ attempt: DeliveryPackageAttemptView.nullable() })
  .strict();
export const deliveryPackageCancelChannel = defineInvokeChannel({
  channel: 'deliveryPackage:cancel',
  request: DeliveryPackageCancelRequest,
  response: DeliveryPackageCancelResponse,
});
export type DeliveryPackageCancelRequest = z.infer<typeof DeliveryPackageCancelRequest>;
export type DeliveryPackageCancelResponse = z.infer<typeof DeliveryPackageCancelResponse>;

const DeliveryPackageRetryRequest = z.object({ attemptId: z.string().min(1) }).strict();
const DeliveryPackageRetryResponse = z.object({ attempt: DeliveryPackageAttemptView }).strict();
export const deliveryPackageRetryChannel = defineInvokeChannel({
  channel: 'deliveryPackage:retry',
  request: DeliveryPackageRetryRequest,
  response: DeliveryPackageRetryResponse,
});
export type DeliveryPackageRetryRequest = z.infer<typeof DeliveryPackageRetryRequest>;
export type DeliveryPackageRetryResponse = z.infer<typeof DeliveryPackageRetryResponse>;

const DeliveryPackageOpenRequest = z.object({ attemptId: z.string().min(1) }).strict();
const DeliveryPackageOpenResponse = z.object({ opened: z.literal(true) }).strict();
export const deliveryPackageOpenChannel = defineInvokeChannel({
  channel: 'deliveryPackage:open',
  request: DeliveryPackageOpenRequest,
  response: DeliveryPackageOpenResponse,
});
export type DeliveryPackageOpenRequest = z.infer<typeof DeliveryPackageOpenRequest>;
export type DeliveryPackageOpenResponse = z.infer<typeof DeliveryPackageOpenResponse>;

// ─── reviewCut:* (4) ────────────────────────────────────────
const ReviewCutStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
const ReviewCutJobView = z
  .object({
    jobId: z.string().min(1),
    status: ReviewCutStatus,
    progress: z.number().min(0).max(100),
    outputPath: z.string().min(1),
    manifestRevision: z.number().int().positive(),
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    error: z.string().optional(),
  })
  .strict();

const ReviewCutStartRequest = z
  .object({
    taskListId: z.string().min(1),
    canvasId: z.string().min(1),
    expectedManifestRevision: z.number().int().positive(),
    expectedManifestHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const ReviewCutStartResponse = z.discriminatedUnion('cancelled', [
  z.object({ cancelled: z.literal(true) }).strict(),
  z.object({ cancelled: z.literal(false), job: ReviewCutJobView }).strict(),
]);
export const reviewCutStartChannel = defineInvokeChannel({
  channel: 'reviewCut:start',
  request: ReviewCutStartRequest,
  response: ReviewCutStartResponse,
});
export type ReviewCutStartRequest = z.infer<typeof ReviewCutStartRequest>;
export type ReviewCutStartResponse = z.infer<typeof ReviewCutStartResponse>;

const ReviewCutStatusRequest = z.object({ jobId: z.string().min(1) }).strict();
const ReviewCutStatusResponse = ReviewCutJobView.nullable();
export const reviewCutStatusChannel = defineInvokeChannel({
  channel: 'reviewCut:status',
  request: ReviewCutStatusRequest,
  response: ReviewCutStatusResponse,
});
export type ReviewCutStatusRequest = z.infer<typeof ReviewCutStatusRequest>;
export type ReviewCutStatusResponse = z.infer<typeof ReviewCutStatusResponse>;

const ReviewCutCancelRequest = z.object({ jobId: z.string().min(1) }).strict();
const ReviewCutCancelResponse = z.object({ job: ReviewCutJobView.nullable() }).strict();
export const reviewCutCancelChannel = defineInvokeChannel({
  channel: 'reviewCut:cancel',
  request: ReviewCutCancelRequest,
  response: ReviewCutCancelResponse,
});
export type ReviewCutCancelRequest = z.infer<typeof ReviewCutCancelRequest>;
export type ReviewCutCancelResponse = z.infer<typeof ReviewCutCancelResponse>;

const ReviewCutOpenRequest = z.object({ jobId: z.string().min(1) }).strict();
const ReviewCutOpenResponse = z.object({ opened: z.literal(true) }).strict();
export const reviewCutOpenChannel = defineInvokeChannel({
  channel: 'reviewCut:open',
  request: ReviewCutOpenRequest,
  response: ReviewCutOpenResponse,
});
export type ReviewCutOpenRequest = z.infer<typeof ReviewCutOpenRequest>;
export type ReviewCutOpenResponse = z.infer<typeof ReviewCutOpenResponse>;

// ─── session:* (5) ───────────────────────────────────────────
const SessionListRequest = z.object({ limit: z.number().optional() });
const SessionListResponse = z.array(
  z
    .object({
      id: z.string(),
      defaultCanvasId: z.string().nullable(),
      title: z.string(),
      messageCount: z.number().int().nonnegative(),
      createdAt: z.number(),
      updatedAt: z.number(),
    })
    .passthrough(),
);
export const sessionListChannel = defineInvokeChannel({
  channel: 'session:list',
  request: SessionListRequest,
  response: SessionListResponse,
});
export type SessionListRequest = z.infer<typeof SessionListRequest>;
export type SessionListResponse = z.infer<typeof SessionListResponse>;

const SessionGetRequest = z.object({ id: z.string() });
const SessionGetResponse = z
  .object({
    id: z.string(),
    defaultCanvasId: z.string().nullable(),
    title: z.string(),
    messages: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough();
export const sessionGetChannel = defineInvokeChannel({
  channel: 'session:get',
  request: SessionGetRequest,
  response: SessionGetResponse,
});
export type SessionGetRequest = z.infer<typeof SessionGetRequest>;
export type SessionGetResponse = z.infer<typeof SessionGetResponse>;

const SessionUpsertRequest = z.object({
  id: z.string(),
  defaultCanvasId: z.string().nullable(),
  title: z.string(),
  messages: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
const SessionUpsertResponse = z.void();
export const sessionUpsertChannel = defineInvokeChannel({
  channel: 'session:upsert',
  request: SessionUpsertRequest,
  response: SessionUpsertResponse,
});
export type SessionUpsertRequest = z.infer<typeof SessionUpsertRequest>;
export type SessionUpsertResponse = z.infer<typeof SessionUpsertResponse>;

const SessionMoveRequest = z.object({
  id: z.string().min(1),
  defaultCanvasId: z.string().min(1).nullable(),
});
const SessionMoveResponse = z.object({ success: z.literal(true) });
export const sessionMoveChannel = defineInvokeChannel({
  channel: 'session:move',
  request: SessionMoveRequest,
  response: SessionMoveResponse,
});
export type SessionMoveRequest = z.infer<typeof SessionMoveRequest>;
export type SessionMoveResponse = z.infer<typeof SessionMoveResponse>;

const SessionDeleteRequest = z.object({ id: z.string() });
const SessionDeleteResponse = z.object({ success: z.boolean() });
export const sessionDeleteChannel = defineInvokeChannel({
  channel: 'session:delete',
  request: SessionDeleteRequest,
  response: SessionDeleteResponse,
});
export type SessionDeleteRequest = z.infer<typeof SessionDeleteRequest>;
export type SessionDeleteResponse = z.infer<typeof SessionDeleteResponse>;

// ─── shell:openExternal ──────────────────────────────────────
const ShellOpenExternalRequest = z.object({ url: z.string() });
// shell.openExternal() returns `Promise<void>` when skipped, or resolves after
// the OS opens the URL; kept permissive.
const ShellOpenExternalResponse = z.unknown();
export const shellOpenExternalChannel = defineInvokeChannel({
  channel: 'shell:openExternal',
  request: ShellOpenExternalRequest,
  response: ShellOpenExternalResponse,
});
export type ShellOpenExternalRequest = z.infer<typeof ShellOpenExternalRequest>;
export type ShellOpenExternalResponse = z.infer<typeof ShellOpenExternalResponse>;

// ─── snapshot:* (4) ──────────────────────────────────────────
const SnapshotCaptureRequest = z.object({
  sessionId: z.string(),
  label: z.string(),
  trigger: z.enum(['auto', 'manual']).optional(),
});
const SnapshotCaptureResponse = z.record(z.string(), z.unknown());
export const snapshotCaptureChannel = defineInvokeChannel({
  channel: 'snapshot:capture',
  request: SnapshotCaptureRequest,
  response: SnapshotCaptureResponse,
});
export type SnapshotCaptureRequest = z.infer<typeof SnapshotCaptureRequest>;
export type SnapshotCaptureResponse = z.infer<typeof SnapshotCaptureResponse>;

const SnapshotListRequest = z.object({ sessionId: z.string() });
const SnapshotListResponse = z.array(z.record(z.string(), z.unknown()));
export const snapshotListChannel = defineInvokeChannel({
  channel: 'snapshot:list',
  request: SnapshotListRequest,
  response: SnapshotListResponse,
});
export type SnapshotListRequest = z.infer<typeof SnapshotListRequest>;
export type SnapshotListResponse = z.infer<typeof SnapshotListResponse>;

const SnapshotRestoreRequest = z.object({ snapshotId: z.string() });
const SnapshotRestoreResponse = z.object({ success: z.boolean() });
export const snapshotRestoreChannel = defineInvokeChannel({
  channel: 'snapshot:restore',
  request: SnapshotRestoreRequest,
  response: SnapshotRestoreResponse,
});
export type SnapshotRestoreRequest = z.infer<typeof SnapshotRestoreRequest>;
export type SnapshotRestoreResponse = z.infer<typeof SnapshotRestoreResponse>;

const SnapshotDeleteRequest = z.object({ snapshotId: z.string() });
const SnapshotDeleteResponse = z.object({ success: z.boolean() });
export const snapshotDeleteChannel = defineInvokeChannel({
  channel: 'snapshot:delete',
  request: SnapshotDeleteRequest,
  response: SnapshotDeleteResponse,
});
export type SnapshotDeleteRequest = z.infer<typeof SnapshotDeleteRequest>;
export type SnapshotDeleteResponse = z.infer<typeof SnapshotDeleteResponse>;

// ─── updater:* (4 invoke; push version of `updater:status` intentionally
// skipped — see collision note at top of this file) ──────────
const UpdaterUpdateInfoShape = z
  .object({
    version: z.string(),
    releaseNotes: z.string().optional(),
    releaseDate: z.string().optional(),
  })
  .passthrough();
const UpdaterStatusShape = z
  .object({
    state: z.enum(['idle', 'checking', 'available', 'downloading', 'downloaded', 'error']),
    progress: z.number().optional(),
    info: UpdaterUpdateInfoShape.optional(),
    error: z.string().optional(),
  })
  .passthrough();

const UpdaterCheckRequest = z.object({}).strict();
const UpdaterCheckResponse = z.void();
export const updaterCheckChannel = defineInvokeChannel({
  channel: 'updater:check',
  request: UpdaterCheckRequest,
  response: UpdaterCheckResponse,
});
export type UpdaterCheckRequest = z.infer<typeof UpdaterCheckRequest>;
export type UpdaterCheckResponse = z.infer<typeof UpdaterCheckResponse>;

const UpdaterDownloadRequest = z.object({}).strict();
const UpdaterDownloadResponse = z.void();
export const updaterDownloadChannel = defineInvokeChannel({
  channel: 'updater:download',
  request: UpdaterDownloadRequest,
  response: UpdaterDownloadResponse,
});
export type UpdaterDownloadRequest = z.infer<typeof UpdaterDownloadRequest>;
export type UpdaterDownloadResponse = z.infer<typeof UpdaterDownloadResponse>;

const UpdaterInstallRequest = z.object({}).strict();
const UpdaterInstallResponse = z.void();
export const updaterInstallChannel = defineInvokeChannel({
  channel: 'updater:install',
  request: UpdaterInstallRequest,
  response: UpdaterInstallResponse,
});
export type UpdaterInstallRequest = z.infer<typeof UpdaterInstallRequest>;
export type UpdaterInstallResponse = z.infer<typeof UpdaterInstallResponse>;

const UpdaterStatusRequest = z.object({}).strict();
const UpdaterStatusResponse = UpdaterStatusShape;
export const updaterStatusChannel = defineInvokeChannel({
  channel: 'updater:status',
  request: UpdaterStatusRequest,
  response: UpdaterStatusResponse,
});
export type UpdaterStatusRequest = z.infer<typeof UpdaterStatusRequest>;
export type UpdaterStatusResponse = z.infer<typeof UpdaterStatusResponse>;

// ─── vision:describeImage ────────────────────────────────────
const VisionDescribeImageRequest = z.object({
  assetHash: z.string(),
  assetType: z.enum(['image', 'video']),
  style: z.enum(['prompt', 'description', 'style-analysis']).optional(),
});
const VisionDescribeImageResponse = z.object({ prompt: z.string() });
export const visionDescribeImageChannel = defineInvokeChannel({
  channel: 'vision:describeImage',
  request: VisionDescribeImageRequest,
  response: VisionDescribeImageResponse,
});
export type VisionDescribeImageRequest = z.infer<typeof VisionDescribeImageRequest>;
export type VisionDescribeImageResponse = z.infer<typeof VisionDescribeImageResponse>;

// ─── Push channels ───────────────────────────────────────────

// app:ready — fire-and-forget; Electron serialises `undefined`.
const AppReadyPayload = z.undefined();
export const appReadyChannel = definePushChannel({
  channel: 'app:ready',
  payload: AppReadyPayload,
});
export type AppReadyPayload = z.infer<typeof AppReadyPayload>;

// app:init-error — String(err).
const AppInitErrorPayload = z.string();
export const appInitErrorChannel = definePushChannel({
  channel: 'app:init-error',
  payload: AppInitErrorPayload,
});
export type AppInitErrorPayload = z.infer<typeof AppInitErrorPayload>;

// clipboard:ai-detected
const ClipboardAiDetectedPayload = z.object({ text: z.string() });
export const clipboardAiDetectedChannel = definePushChannel({
  channel: 'clipboard:ai-detected',
  payload: ClipboardAiDetectedPayload,
});
export type ClipboardAiDetectedPayload = z.infer<typeof ClipboardAiDetectedPayload>;

// logger:entry — same LoggerEntry shape as logger:getRecent response items.
const LoggerEntryPayload = LoggerEntryShape;
export const loggerEntryChannel = definePushChannel({
  channel: 'logger:entry',
  payload: LoggerEntryPayload,
});
export type LoggerEntryPayload = z.infer<typeof LoggerEntryPayload>;

// settings:providerKeyUpdated
const SettingsProviderKeyUpdatedPayload = z
  .object({
    group: z.string(),
    providerId: z.string(),
    hasKey: z.boolean(),
  })
  .passthrough();
export const settingsProviderKeyUpdatedChannel = definePushChannel({
  channel: 'settings:providerKeyUpdated',
  payload: SettingsProviderKeyUpdatedPayload,
});
export type SettingsProviderKeyUpdatedPayload = z.infer<typeof SettingsProviderKeyUpdatedPayload>;

// updater:toast
const UpdaterToastPayload = z
  .object({
    version: z.string(),
  })
  .passthrough();
export const updaterToastChannel = definePushChannel({
  channel: 'updater:toast',
  payload: UpdaterToastPayload,
});
export type UpdaterToastPayload = z.infer<typeof UpdaterToastPayload>;

// updater:progress (push) — separated from the invoke-only updater:status
const UpdaterProgressPayload = UpdaterStatusShape;
export const updaterProgressChannel = definePushChannel({
  channel: 'updater:progress',
  payload: UpdaterProgressPayload,
});
export type UpdaterProgressPayload = z.infer<typeof UpdaterProgressPayload>;

// ─── Per-namespace tuples (invoke) ───────────────────────────
export const appChannels = [appVersionChannel, appRestartChannel] as const;

export const clipboardChannels = [clipboardSetEnabledChannel] as const;

export const ffmpegChannels = [
  ffmpegProbeChannel,
  ffmpegThumbnailChannel,
  ffmpegTranscodeChannel,
] as const;

export const keychainChannels = [
  keychainGetMaskedChannel,
  keychainSetChannel,
  keychainDeleteChannel,
  keychainTestChannel,
  keychainIsConfiguredChannel,
] as const;

export const loggerChannels = [loggerGetRecentChannel] as const;

export const deliveryPackageChannels = [
  deliveryPackageStartChannel,
  deliveryPackageStatusChannel,
  deliveryPackageCancelChannel,
  deliveryPackageRetryChannel,
  deliveryPackageOpenChannel,
] as const;

export const reviewCutChannels = [
  reviewCutStartChannel,
  reviewCutStatusChannel,
  reviewCutCancelChannel,
  reviewCutOpenChannel,
] as const;

export const sessionChannels = [
  sessionListChannel,
  sessionGetChannel,
  sessionUpsertChannel,
  sessionMoveChannel,
  sessionDeleteChannel,
] as const;

export const shellChannels = [shellOpenExternalChannel] as const;

export const snapshotChannels = [
  snapshotCaptureChannel,
  snapshotListChannel,
  snapshotRestoreChannel,
  snapshotDeleteChannel,
] as const;

export const updaterChannels = [
  updaterCheckChannel,
  updaterDownloadChannel,
  updaterInstallChannel,
  updaterStatusChannel,
] as const;

export const visionChannels = [visionDescribeImageChannel] as const;

// ─── Per-namespace tuples (push) ─────────────────────────────
export const appPushChannels = [appReadyChannel, appInitErrorChannel] as const;

export const clipboardPushChannels = [clipboardAiDetectedChannel] as const;

export const loggerPushChannels = [loggerEntryChannel] as const;

export const settingsPushChannels = [settingsProviderKeyUpdatedChannel] as const;

export const updaterPushChannels = [updaterToastChannel, updaterProgressChannel] as const;

// ─── Flat tuple (all of batch 10) ────────────────────────────
export const batch10Channels = [
  // invoke
  ...appChannels,
  ...clipboardChannels,
  ...ffmpegChannels,
  ...keychainChannels,
  ...loggerChannels,
  ...deliveryPackageChannels,
  ...reviewCutChannels,
  ...sessionChannels,
  ...shellChannels,
  ...snapshotChannels,
  ...updaterChannels,
  ...visionChannels,
  // push
  ...appPushChannels,
  ...clipboardPushChannels,
  ...loggerPushChannels,
  ...settingsPushChannels,
  ...updaterPushChannels,
] as const;
