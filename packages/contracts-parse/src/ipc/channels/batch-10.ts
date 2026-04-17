/**
 * Batch 10 — tail of Phase B-1 IPC migration.
 *
 * Registers the remaining 47 invoke handlers and 9 push channels that were
 * not covered by batches 1-9. Schemas are intentionally permissive at the
 * boundaries of complex media-engine DTOs (NLE project, render segment,
 * subtitle cue) and storage-owned blobs (session row, snapshot row) — the
 * goal is registry coverage, with deeper zodification deferred to a later
 * phase.
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

// ─── ai:chat ─────────────────────────────────────────────────
const AiChatRequest = z.object({
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
});
const AiChatResponse = z.string();
export const aiChatChannel = defineInvokeChannel({
  channel: 'ai:chat',
  request: AiChatRequest,
  response: AiChatResponse,
});
export type AiChatRequest = z.infer<typeof AiChatRequest>;
export type AiChatResponse = z.infer<typeof AiChatResponse>;

// ─── ai:prompt:list ──────────────────────────────────────────
const AiPromptListRequest = z.object({}).strict();
const AiPromptListResponse = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    type: z.string(),
    hasCustom: z.boolean(),
  }),
);
export const aiPromptListChannel = defineInvokeChannel({
  channel: 'ai:prompt:list',
  request: AiPromptListRequest,
  response: AiPromptListResponse,
});
export type AiPromptListRequest = z.infer<typeof AiPromptListRequest>;
export type AiPromptListResponse = z.infer<typeof AiPromptListResponse>;

// ─── ai:prompt:get ───────────────────────────────────────────
const AiPromptGetRequest = z.object({ code: z.string() });
const AiPromptGetResponse = z.object({
  code: z.string(),
  name: z.string(),
  defaultValue: z.string(),
  customValue: z.string().nullable(),
});
export const aiPromptGetChannel = defineInvokeChannel({
  channel: 'ai:prompt:get',
  request: AiPromptGetRequest,
  response: AiPromptGetResponse,
});
export type AiPromptGetRequest = z.infer<typeof AiPromptGetRequest>;
export type AiPromptGetResponse = z.infer<typeof AiPromptGetResponse>;

// ─── ai:prompt:setCustom ─────────────────────────────────────
const AiPromptSetCustomRequest = z.object({
  code: z.string(),
  value: z.string(),
});
const AiPromptSetCustomResponse = z.void();
export const aiPromptSetCustomChannel = defineInvokeChannel({
  channel: 'ai:prompt:setCustom',
  request: AiPromptSetCustomRequest,
  response: AiPromptSetCustomResponse,
});
export type AiPromptSetCustomRequest = z.infer<typeof AiPromptSetCustomRequest>;
export type AiPromptSetCustomResponse = z.infer<
  typeof AiPromptSetCustomResponse
>;

// ─── ai:prompt:clearCustom ───────────────────────────────────
const AiPromptClearCustomRequest = z.object({ code: z.string() });
const AiPromptClearCustomResponse = z.void();
export const aiPromptClearCustomChannel = defineInvokeChannel({
  channel: 'ai:prompt:clearCustom',
  request: AiPromptClearCustomRequest,
  response: AiPromptClearCustomResponse,
});
export type AiPromptClearCustomRequest = z.infer<
  typeof AiPromptClearCustomRequest
>;
export type AiPromptClearCustomResponse = z.infer<
  typeof AiPromptClearCustomResponse
>;

// ─── asset:generateEmbedding ─────────────────────────────────
const AssetGenerateEmbeddingRequest = z.object({ assetHash: z.string() });
const AssetGenerateEmbeddingResponse = z.object({ ok: z.boolean() });
export const assetGenerateEmbeddingChannel = defineInvokeChannel({
  channel: 'asset:generateEmbedding',
  request: AssetGenerateEmbeddingRequest,
  response: AssetGenerateEmbeddingResponse,
});
export type AssetGenerateEmbeddingRequest = z.infer<
  typeof AssetGenerateEmbeddingRequest
>;
export type AssetGenerateEmbeddingResponse = z.infer<
  typeof AssetGenerateEmbeddingResponse
>;

// ─── asset:reindexEmbeddings ─────────────────────────────────
const AssetReindexEmbeddingsRequest = z.object({}).strict();
const AssetReindexEmbeddingsResponse = z.object({
  indexed: z.number(),
  failed: z.number(),
});
export const assetReindexEmbeddingsChannel = defineInvokeChannel({
  channel: 'asset:reindexEmbeddings',
  request: AssetReindexEmbeddingsRequest,
  response: AssetReindexEmbeddingsResponse,
});
export type AssetReindexEmbeddingsRequest = z.infer<
  typeof AssetReindexEmbeddingsRequest
>;
export type AssetReindexEmbeddingsResponse = z.infer<
  typeof AssetReindexEmbeddingsResponse
>;

// ─── asset:searchSemantic ────────────────────────────────────
const AssetSearchSemanticRequest = z.object({
  query: z.string(),
  limit: z.number().optional(),
});
// Storage-owned row shape; kept opaque.
const AssetSearchSemanticResponse = z.array(z.unknown());
export const assetSearchSemanticChannel = defineInvokeChannel({
  channel: 'asset:searchSemantic',
  request: AssetSearchSemanticRequest,
  response: AssetSearchSemanticResponse,
});
export type AssetSearchSemanticRequest = z.infer<
  typeof AssetSearchSemanticRequest
>;
export type AssetSearchSemanticResponse = z.infer<
  typeof AssetSearchSemanticResponse
>;

// ─── clipboard:setEnabled ────────────────────────────────────
const ClipboardSetEnabledRequest = z.object({ enabled: z.boolean() });
const ClipboardSetEnabledResponse = z.void();
export const clipboardSetEnabledChannel = defineInvokeChannel({
  channel: 'clipboard:setEnabled',
  request: ClipboardSetEnabledRequest,
  response: ClipboardSetEnabledResponse,
});
export type ClipboardSetEnabledRequest = z.infer<
  typeof ClipboardSetEnabledRequest
>;
export type ClipboardSetEnabledResponse = z.infer<
  typeof ClipboardSetEnabledResponse
>;

// ─── export:nle ──────────────────────────────────────────────
const ExportNleRequest = z
  .object({
    format: z.enum(['fcpxml', 'edl']),
    project: z.unknown(),
    outputPath: z.string().optional(),
  })
  .passthrough();
const ExportNleResponse = z.union([
  z.null(),
  z.object({
    outputPath: z.string(),
    format: z.enum(['fcpxml', 'edl']),
    fileSize: z.number(),
  }),
]);
export const exportNleChannel = defineInvokeChannel({
  channel: 'export:nle',
  request: ExportNleRequest,
  response: ExportNleResponse,
});
export type ExportNleRequest = z.infer<typeof ExportNleRequest>;
export type ExportNleResponse = z.infer<typeof ExportNleResponse>;

// ─── export:assetBundle ──────────────────────────────────────
const ExportAssetBundleRequest = z.object({
  assetHashes: z.array(z.string()),
  outputPath: z.string().optional(),
});
const ExportAssetBundleResponse = z.union([
  z.null(),
  z.object({
    outputPath: z.string(),
    fileCount: z.number(),
    fileSize: z.number(),
  }),
]);
export const exportAssetBundleChannel = defineInvokeChannel({
  channel: 'export:assetBundle',
  request: ExportAssetBundleRequest,
  response: ExportAssetBundleResponse,
});
export type ExportAssetBundleRequest = z.infer<typeof ExportAssetBundleRequest>;
export type ExportAssetBundleResponse = z.infer<
  typeof ExportAssetBundleResponse
>;

// ─── export:subtitles ────────────────────────────────────────
const ExportSubtitlesRequest = z
  .object({
    format: z.enum(['srt', 'ass']),
    cues: z.array(z.unknown()),
    outputPath: z.string(),
    videoWidth: z.number().optional(),
    videoHeight: z.number().optional(),
  })
  .passthrough();
const ExportSubtitlesResponse = z.void();
export const exportSubtitlesChannel = defineInvokeChannel({
  channel: 'export:subtitles',
  request: ExportSubtitlesRequest,
  response: ExportSubtitlesResponse,
});
export type ExportSubtitlesRequest = z.infer<typeof ExportSubtitlesRequest>;
export type ExportSubtitlesResponse = z.infer<typeof ExportSubtitlesResponse>;

// ─── export:storyboard ───────────────────────────────────────
const ExportStoryboardNodeShape = z
  .object({
    title: z.string(),
    prompt: z.string().optional(),
    assetHash: z.string().optional(),
    type: z.string(),
    sceneNumber: z.string().optional(),
    shotOrder: z.number().optional(),
    annotation: z.string().optional(),
    colorTag: z.string().optional(),
    tags: z.array(z.string()).optional(),
    providerId: z.string().optional(),
    seed: z.number().optional(),
  })
  .passthrough();
const ExportStoryboardRequest = z.object({
  nodes: z.array(ExportStoryboardNodeShape),
  projectTitle: z.string().optional(),
  outputPath: z.string().optional(),
});
const ExportStoryboardResponse = z.union([
  z.null(),
  z.object({
    outputPath: z.string(),
    nodeCount: z.number(),
    fileSize: z.number(),
  }),
]);
export const exportStoryboardChannel = defineInvokeChannel({
  channel: 'export:storyboard',
  request: ExportStoryboardRequest,
  response: ExportStoryboardResponse,
});
export type ExportStoryboardRequest = z.infer<typeof ExportStoryboardRequest>;
export type ExportStoryboardResponse = z.infer<typeof ExportStoryboardResponse>;

// ─── export:metadata ─────────────────────────────────────────
const ExportMetadataNodeShape = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    prompt: z.string().optional(),
    negativePrompt: z.string().optional(),
    providerId: z.string().optional(),
    seed: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    assetHash: z.string().optional(),
    cost: z.number().optional(),
    generationTimeMs: z.number().optional(),
    sceneNumber: z.string().optional(),
    shotOrder: z.number().optional(),
    colorTag: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();
const ExportMetadataRequest = z.object({
  format: z.enum(['csv', 'json']),
  nodes: z.array(ExportMetadataNodeShape),
  projectTitle: z.string().optional(),
  outputPath: z.string().optional(),
});
const ExportMetadataResponse = z.union([
  z.null(),
  z.object({
    outputPath: z.string(),
    format: z.enum(['csv', 'json']),
    nodeCount: z.number(),
    fileSize: z.number(),
  }),
]);
export const exportMetadataChannel = defineInvokeChannel({
  channel: 'export:metadata',
  request: ExportMetadataRequest,
  response: ExportMetadataResponse,
});
export type ExportMetadataRequest = z.infer<typeof ExportMetadataRequest>;
export type ExportMetadataResponse = z.infer<typeof ExportMetadataResponse>;

// ─── export:capcut ───────────────────────────────────────────
const ExportCapcutRequest = z.object({
  nodes: z.array(
    z
      .object({
        title: z.string(),
        assetHash: z.string(),
        type: z.string(),
        durationMs: z.number().optional(),
      })
      .passthrough(),
  ),
  projectTitle: z.string().optional(),
  outputDir: z.string().optional(),
});
const ExportCapcutResponse = z.union([
  z.null(),
  z.object({ draftDir: z.string() }),
]);
export const exportCapcutChannel = defineInvokeChannel({
  channel: 'export:capcut',
  request: ExportCapcutRequest,
  response: ExportCapcutResponse,
});
export type ExportCapcutRequest = z.infer<typeof ExportCapcutRequest>;
export type ExportCapcutResponse = z.infer<typeof ExportCapcutResponse>;

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

// ─── import:srt ──────────────────────────────────────────────
const ImportSrtRequest = z.object({
  canvasId: z.string(),
  filePath: z.string(),
  alignToNodes: z.boolean().optional(),
});
const ImportSrtResponse = z
  .object({
    importedCount: z.number(),
    alignedCount: z.number(),
    noVideoNodes: z.boolean().optional(),
  })
  .passthrough();
export const importSrtChannel = defineInvokeChannel({
  channel: 'import:srt',
  request: ImportSrtRequest,
  response: ImportSrtResponse,
});
export type ImportSrtRequest = z.infer<typeof ImportSrtRequest>;
export type ImportSrtResponse = z.infer<typeof ImportSrtResponse>;

// ─── ipc:ping — INTENTIONALLY UNREGISTERED ───────────────────
// The hand-written infrastructure surface (see `LucidAPIInfrastructure`) owns
// the `ipc` namespace with `cancel/onInvocation/onEvent`. Registering any
// channel with the `ipc:` prefix makes the codegen emit a `LucidAPI_Ipc`
// interface that shadows the infra methods and causes a TS2430 extends
// conflict.
//
// `ipc:ping` is only used by `IpcStatus` for connection health polling; the
// renderer calls it via `ipcRenderer.invoke('ipc:ping')` through the
// infrastructure escape hatch, not through the generated `lucidAPI.ipc.*`
// surface, so leaving it unregistered is safe. If this ever needs to be
// first-class-typed, the channel should be renamed (e.g. `health:ipc-ping`)
// or the codegen adjusted to merge new `ipc:*` methods onto the existing
// infra namespace. Noted in the batch-10 report.

// ─── keychain:* ──────────────────────────────────────────────
const KeychainGetRequest = z.object({ provider: z.string() });
const KeychainGetResponse = z.string().nullable();
export const keychainGetChannel = defineInvokeChannel({
  channel: 'keychain:get',
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
      .enum([
        'openai-compatible',
        'openai-responses',
        'anthropic',
        'gemini',
        'cohere',
      ])
      .optional(),
    authStyle: z
      .enum(['bearer', 'x-api-key', 'x-goog-api-key', 'none'])
      .optional(),
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
export type KeychainIsConfiguredRequest = z.infer<
  typeof KeychainIsConfiguredRequest
>;
export type KeychainIsConfiguredResponse = z.infer<
  typeof KeychainIsConfiguredResponse
>;

// ─── lipsync:* ───────────────────────────────────────────────
const LipsyncCheckAvailabilityRequest = z.object({}).strict();
const LipsyncCheckAvailabilityResponse = z.object({
  available: z.boolean(),
  backend: z.string(),
});
export const lipsyncCheckAvailabilityChannel = defineInvokeChannel({
  channel: 'lipsync:checkAvailability',
  request: LipsyncCheckAvailabilityRequest,
  response: LipsyncCheckAvailabilityResponse,
});
export type LipsyncCheckAvailabilityRequest = z.infer<
  typeof LipsyncCheckAvailabilityRequest
>;
export type LipsyncCheckAvailabilityResponse = z.infer<
  typeof LipsyncCheckAvailabilityResponse
>;

const LipsyncProcessRequest = z.object({
  canvasId: z.string(),
  nodeId: z.string(),
});
const LipsyncProcessResponse = z.void();
export const lipsyncProcessChannel = defineInvokeChannel({
  channel: 'lipsync:process',
  request: LipsyncProcessRequest,
  response: LipsyncProcessResponse,
});
export type LipsyncProcessRequest = z.infer<typeof LipsyncProcessRequest>;
export type LipsyncProcessResponse = z.infer<typeof LipsyncProcessResponse>;

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

// ─── render:* ────────────────────────────────────────────────
const RenderStartRequest = z
  .object({
    sceneId: z.string(),
    segments: z.array(z.unknown()),
    outputFormat: z.enum(['mp4', 'mov', 'webm']),
    resolution: z
      .object({ width: z.number(), height: z.number() })
      .optional(),
    fps: z.number().optional(),
    codec: z.string().optional(),
    quality: z.string().optional(),
    outputPath: z.string().optional(),
  })
  .passthrough();
const RenderStartResponse = z.object({
  jobId: z.string(),
  outputPath: z.string(),
  duration: z.number(),
  format: z.enum(['mp4', 'mov', 'webm']),
});
export const renderStartChannel = defineInvokeChannel({
  channel: 'render:start',
  request: RenderStartRequest,
  response: RenderStartResponse,
});
export type RenderStartRequest = z.infer<typeof RenderStartRequest>;
export type RenderStartResponse = z.infer<typeof RenderStartResponse>;

const RenderCancelRequest = z.object({ jobId: z.string() });
const RenderCancelResponse = z.void();
export const renderCancelChannel = defineInvokeChannel({
  channel: 'render:cancel',
  request: RenderCancelRequest,
  response: RenderCancelResponse,
});
export type RenderCancelRequest = z.infer<typeof RenderCancelRequest>;
export type RenderCancelResponse = z.infer<typeof RenderCancelResponse>;

const RenderStatusRequest = z.object({ jobId: z.string() });
const RenderStatusResponse = z
  .object({
    progress: z.number(),
    stage: z.enum([
      'queued',
      'rendering',
      'completed',
      'failed',
      'cancelled',
      'unknown',
    ]),
    outputPath: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export const renderStatusChannel = defineInvokeChannel({
  channel: 'render:status',
  request: RenderStatusRequest,
  response: RenderStatusResponse,
});
export type RenderStatusRequest = z.infer<typeof RenderStatusRequest>;
export type RenderStatusResponse = z.infer<typeof RenderStatusResponse>;

// ─── session:* (4) ───────────────────────────────────────────
const SessionListRequest = z.object({ limit: z.number().optional() });
const SessionListResponse = z.array(
  z
    .object({
      id: z.string(),
      canvasId: z.string().nullable(),
      title: z.string(),
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
    canvasId: z.string().nullable(),
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
  canvasId: z.string().nullable(),
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
export type ShellOpenExternalResponse = z.infer<
  typeof ShellOpenExternalResponse
>;

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
    state: z.enum([
      'idle',
      'checking',
      'available',
      'downloading',
      'downloaded',
      'error',
    ]),
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

// ─── video:* (3) ─────────────────────────────────────────────
const VideoPickFileRequest = z.object({}).strict();
const VideoPickFileResponse = z.string().nullable();
export const videoPickFileChannel = defineInvokeChannel({
  channel: 'video:pickFile',
  request: VideoPickFileRequest,
  response: VideoPickFileResponse,
});
export type VideoPickFileRequest = z.infer<typeof VideoPickFileRequest>;
export type VideoPickFileResponse = z.infer<typeof VideoPickFileResponse>;

const VideoExtractLastFrameRequest = z.object({
  canvasId: z.string(),
  nodeId: z.string(),
});
const VideoExtractLastFrameResponse = z.void();
export const videoExtractLastFrameChannel = defineInvokeChannel({
  channel: 'video:extractLastFrame',
  request: VideoExtractLastFrameRequest,
  response: VideoExtractLastFrameResponse,
});
export type VideoExtractLastFrameRequest = z.infer<
  typeof VideoExtractLastFrameRequest
>;
export type VideoExtractLastFrameResponse = z.infer<
  typeof VideoExtractLastFrameResponse
>;

const VideoCloneRequest = z.object({
  filePath: z.string(),
  threshold: z.number().optional(),
});
const VideoCloneResponse = z.object({
  canvasId: z.string(),
  nodeCount: z.number(),
});
export const videoCloneChannel = defineInvokeChannel({
  channel: 'video:clone',
  request: VideoCloneRequest,
  response: VideoCloneResponse,
});
export type VideoCloneRequest = z.infer<typeof VideoCloneRequest>;
export type VideoCloneResponse = z.infer<typeof VideoCloneResponse>;

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
export type VisionDescribeImageRequest = z.infer<
  typeof VisionDescribeImageRequest
>;
export type VisionDescribeImageResponse = z.infer<
  typeof VisionDescribeImageResponse
>;

// ─── Push channels ───────────────────────────────────────────

// ai:stream — raw string (delta chunk or error message).
const AiStreamPayload = z.string();
export const aiStreamChannel = definePushChannel({
  channel: 'ai:stream',
  payload: AiStreamPayload,
});
export type AiStreamPayload = z.infer<typeof AiStreamPayload>;

// ai:event — AgentEvent mirror.
const AiEventPayload = z
  .object({
    type: z.enum([
      'tool_call',
      'tool_result',
      'stream_chunk',
      'error',
      'done',
      'tool_confirm',
      'tool_question',
      'thinking',
    ]),
    toolName: z.string().optional(),
    toolCallId: z.string().optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
    result: z.unknown().optional(),
    content: z.string().optional(),
    error: z.string().optional(),
    tier: z.number().optional(),
    question: z.string().optional(),
    options: z
      .array(
        z.object({ label: z.string(), description: z.string().optional() }),
      )
      .optional(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
  })
  .passthrough();
export const aiEventChannel = definePushChannel({
  channel: 'ai:event',
  payload: AiEventPayload,
});
export type AiEventPayload = z.infer<typeof AiEventPayload>;

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
export type ClipboardAiDetectedPayload = z.infer<
  typeof ClipboardAiDetectedPayload
>;

// logger:entry — same LoggerEntry shape as logger:getRecent response items.
const LoggerEntryPayload = LoggerEntryShape;
export const loggerEntryChannel = definePushChannel({
  channel: 'logger:entry',
  payload: LoggerEntryPayload,
});
export type LoggerEntryPayload = z.infer<typeof LoggerEntryPayload>;

// refimage:start
const RefimageStartPayload = z.object({
  jobId: z.string(),
  provider: z.string(),
  width: z.number(),
  height: z.number(),
});
export const refimageStartChannel = definePushChannel({
  channel: 'refimage:start',
  payload: RefimageStartPayload,
});
export type RefimageStartPayload = z.infer<typeof RefimageStartPayload>;

// refimage:complete
const RefimageCompletePayload = z.object({
  jobId: z.string(),
  assetHash: z.string(),
});
export const refimageCompleteChannel = definePushChannel({
  channel: 'refimage:complete',
  payload: RefimageCompletePayload,
});
export type RefimageCompletePayload = z.infer<typeof RefimageCompletePayload>;

// refimage:failed
const RefimageFailedPayload = z.object({
  jobId: z.string(),
  error: z.string(),
});
export const refimageFailedChannel = definePushChannel({
  channel: 'refimage:failed',
  payload: RefimageFailedPayload,
});
export type RefimageFailedPayload = z.infer<typeof RefimageFailedPayload>;

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
export type SettingsProviderKeyUpdatedPayload = z.infer<
  typeof SettingsProviderKeyUpdatedPayload
>;

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

// ─── Per-namespace tuples (invoke) ───────────────────────────
export const appChannels = [appVersionChannel] as const;

export const aiChannels = [
  aiChatChannel,
  aiPromptListChannel,
  aiPromptGetChannel,
  aiPromptSetCustomChannel,
  aiPromptClearCustomChannel,
] as const;

export const assetBatch10Channels = [
  assetGenerateEmbeddingChannel,
  assetReindexEmbeddingsChannel,
  assetSearchSemanticChannel,
] as const;

export const clipboardChannels = [clipboardSetEnabledChannel] as const;

export const exportChannels = [
  exportNleChannel,
  exportAssetBundleChannel,
  exportSubtitlesChannel,
  exportStoryboardChannel,
  exportMetadataChannel,
  exportCapcutChannel,
] as const;

export const ffmpegChannels = [
  ffmpegProbeChannel,
  ffmpegThumbnailChannel,
  ffmpegTranscodeChannel,
] as const;

export const importChannels = [importSrtChannel] as const;

export const keychainChannels = [
  keychainGetChannel,
  keychainSetChannel,
  keychainDeleteChannel,
  keychainTestChannel,
  keychainIsConfiguredChannel,
] as const;

export const lipsyncChannels = [
  lipsyncCheckAvailabilityChannel,
  lipsyncProcessChannel,
] as const;

export const loggerChannels = [loggerGetRecentChannel] as const;

export const renderChannels = [
  renderStartChannel,
  renderCancelChannel,
  renderStatusChannel,
] as const;

export const sessionChannels = [
  sessionListChannel,
  sessionGetChannel,
  sessionUpsertChannel,
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

export const videoChannels = [
  videoPickFileChannel,
  videoExtractLastFrameChannel,
  videoCloneChannel,
] as const;

export const visionChannels = [visionDescribeImageChannel] as const;

// ─── Per-namespace tuples (push) ─────────────────────────────
export const aiPushChannels = [aiStreamChannel, aiEventChannel] as const;

export const appPushChannels = [appReadyChannel, appInitErrorChannel] as const;

export const clipboardPushChannels = [clipboardAiDetectedChannel] as const;

export const loggerPushChannels = [loggerEntryChannel] as const;

export const refimagePushChannels = [
  refimageStartChannel,
  refimageCompleteChannel,
  refimageFailedChannel,
] as const;

export const settingsPushChannels = [settingsProviderKeyUpdatedChannel] as const;

export const updaterPushChannels = [updaterToastChannel] as const;

// ─── Flat tuple (all of batch 10) ────────────────────────────
export const batch10Channels = [
  // invoke
  ...appChannels,
  ...aiChannels,
  ...assetBatch10Channels,
  ...clipboardChannels,
  ...exportChannels,
  ...ffmpegChannels,
  ...importChannels,
  ...keychainChannels,
  ...lipsyncChannels,
  ...loggerChannels,
  ...renderChannels,
  ...sessionChannels,
  ...shellChannels,
  ...snapshotChannels,
  ...updaterChannels,
  ...videoChannels,
  ...visionChannels,
  // push
  ...aiPushChannels,
  ...appPushChannels,
  ...clipboardPushChannels,
  ...loggerPushChannels,
  ...refimagePushChannels,
  ...settingsPushChannels,
  ...updaterPushChannels,
] as const;
