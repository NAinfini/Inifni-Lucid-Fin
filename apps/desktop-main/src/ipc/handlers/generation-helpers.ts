import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AdapterRegistry,
} from '@lucid-fin/adapters-ai';
import type { PromptMode } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CanvasNode,
  Capability,
  GenerationRequest,
  GenerationType,
  StyleGuide,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { JobStatus, resolveVideoReferenceImageField } from '@lucid-fin/contracts';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import log from '../../logger.js';
import type { CanvasStore } from './canvas.handlers.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type CanvasGenerationDeps = {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db: SqliteIndex;
  canvasStore: CanvasStore;
  keychain: Keychain;
};

export type SendTarget = {
  send: (channel: string, payload: unknown) => void;
};

export type RunningCanvasJob = {
  jobId: string;
  canvasId: string;
  nodeId: string;
  adapterId: string;
  providerJobIds: Set<string>;
  cancelled: boolean;
  cancelReason?: string;
};

export type ProviderConfigOverride = { baseUrl: string; model: string; apiKey?: string };

export type GenerateArgs = {
  canvasId: string;
  nodeId: string;
  providerId?: string;
  providerConfig?: ProviderConfigOverride;
  variantCount?: number;
  seed?: number;
};

export type EstimateArgs = {
  canvasId: string;
  nodeId: string;
  providerId: string;
  providerConfig?: ProviderConfigOverride;
};

export type CancelArgs = {
  canvasId: string;
  nodeId: string;
};

export type BuiltGenerationContext = {
  canvas: Canvas;
  node: CanvasNode;
  requestBase: GenerationRequest;
  adapter: AIProviderAdapter;
  nodeType: 'image' | 'video' | 'audio';
  generationType: GenerationType;
  mode: PromptMode;
  variantCount: number;
  baseSeed?: number;
};

export type GenerationMediaConfig = Pick<GenerationRequest, 'width' | 'height' | 'duration'> & {
  fps?: number;
};

export type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_IMAGE_SIZE = { width: 1024, height: 1024 };
export const DEFAULT_VIDEO_SIZE = { width: 1280, height: 720 };
export const DEFAULT_VIDEO_DURATION = 5;
export const DEFAULT_AUDIO_DURATION = 5;
export const MAX_VARIANTS = 9;

export const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};

export const STYLE_GUIDE_LIGHTING_PRESETS: Record<StyleGuide['global']['lighting'], string | undefined> = {
  natural: undefined,
  studio: 'scene:high-key',
  dramatic: 'scene:low-key',
  neon: 'scene:neon-noir',
  custom: undefined,
};

export const LEGACY_CANVAS_PROVIDER_ALIASES: Record<string, string> = {
  // Settings ID → Adapter ID
  'openai-image': 'openai-dalle',
  'google-image': 'google-imagen3',
  'google-video': 'google-veo-2',
  recraft: 'recraft-v3',
  'recraft-v4': 'recraft-v3',
  'elevenlabs': 'elevenlabs-v2',
  'openai-tts': 'openai-tts-1-hd',
  // Legacy shorthand
  runway: 'runway-gen4',
  veo: 'google-veo-2',
  pika: 'pika-v2',
  imagen: 'google-imagen3',
  luma: 'luma-ray2',
  minimax: 'minimax-video01',
  // Chinese video providers
  kling: 'kling-v1',
  wan: 'wan-2.1',
  seedance: 'seedance-2',
  hunyuan: 'hunyuan-video',
  cartesia: 'cartesia-sonic',
  playht: 'playht-3',
  'fish-audio': 'fish-audio-v1',
};

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function normalizePresetLookupValue(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function canonicalizeCanvasProviderId(
  providerId: string | undefined,
  generationType?: GenerationType,
): string | undefined {
  const normalized = normalizeOptionalString(providerId);
  if (!normalized) return undefined;
  if (normalized === 'openai') {
    if (generationType === 'image') return 'openai-dalle';
    if (generationType === 'voice') return 'openai-tts-1-hd';
  }
  return LEGACY_CANVAS_PROVIDER_ALIASES[normalized] ?? normalized;
}

export function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  return fallback;
}

export function capitalizeUpdateStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch {
    return undefined;
  }
}

export function inferRemoteExtension(url: string, contentType: string | null): string {
  const byUrl = extensionFromUrl(url);
  if (byUrl) return byUrl;
  const normalized = contentType?.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'video/mp4':
      return 'mp4';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    default:
      return 'bin';
  }
}

// ---------------------------------------------------------------------------
// Argument validators
// ---------------------------------------------------------------------------

export function requireGenerateArgs(value: GenerateArgs | undefined): {
  canvasId: string;
  nodeId: string;
} {
  if (!value) throw new Error('canvas:generate request is required');
  const canvasId = normalizeOptionalString(value.canvasId);
  const nodeId = normalizeOptionalString(value.nodeId);
  if (!canvasId || !nodeId) throw new Error('canvasId and nodeId are required');
  return { canvasId, nodeId };
}

export function requireEstimateArgs(value: EstimateArgs | undefined): {
  canvasId: string;
  nodeId: string;
  providerId: string;
  providerConfig?: ProviderConfigOverride;
} {
  if (!value) throw new Error('canvas:estimateCost request is required');
  const canvasId = normalizeOptionalString(value.canvasId);
  const nodeId = normalizeOptionalString(value.nodeId);
  const providerId = normalizeOptionalString(value.providerId);
  if (!canvasId || !nodeId || !providerId) {
    throw new Error('canvasId, nodeId and providerId are required');
  }
  return { canvasId, nodeId, providerId, providerConfig: value.providerConfig };
}

export function requireCancelArgs(value: CancelArgs | undefined): {
  canvasId: string;
  nodeId: string;
} {
  if (!value) throw new Error('canvas:cancelGeneration request is required');
  const canvasId = normalizeOptionalString(value.canvasId);
  const nodeId = normalizeOptionalString(value.nodeId);
  if (!canvasId || !nodeId) throw new Error('canvasId and nodeId are required');
  return { canvasId, nodeId };
}

// ---------------------------------------------------------------------------
// Asset materialization
// ---------------------------------------------------------------------------

export async function materializeAsset(generated: {
  assetPath?: string;
  metadata?: Record<string, unknown>;
}): Promise<MaterializedAsset> {
  const assetPath = normalizeOptionalString(generated.assetPath);
  if (assetPath) {
    // Handle base64 data URLs (image, video, audio from OpenRouter etc.)
    if (assetPath.startsWith('data:image/') || assetPath.startsWith('data:video/') || assetPath.startsWith('data:audio/')) {
      return decodeBase64DataUrl(assetPath);
    }
    if (isRemoteUrl(assetPath)) {
      return downloadRemoteAsset(assetPath);
    }
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Generated asset path not found: ${assetPath.slice(0, 80)}`);
    }
    return { filePath: assetPath };
  }

  const metadataUrl = normalizeOptionalString(generated.metadata?.url as string | undefined)
    ?? normalizeOptionalString(generated.metadata?.video_url as string | undefined)
    ?? normalizeOptionalString(generated.metadata?.output as string | undefined)
    ?? normalizeOptionalString(generated.metadata?.download_url as string | undefined);
  if (metadataUrl) {
    if (metadataUrl.startsWith('data:image/') || metadataUrl.startsWith('data:video/') || metadataUrl.startsWith('data:audio/')) {
      return decodeBase64DataUrl(metadataUrl);
    }
    return downloadRemoteAsset(metadataUrl);
  }

  throw new Error('Generated asset did not include a usable file path or URL');
}

async function decodeBase64DataUrl(dataUrl: string): Promise<MaterializedAsset> {
  // Parse data:image/png;base64,... or data:video/mp4;base64,...
  const match = dataUrl.match(/^data:(?:image|video|audio)\/(\w+);base64,(.+)$/);
  if (!match) throw new Error('Invalid base64 data URL');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const tmpPath = path.join(os.tmpdir(), `lucid-fin-gen-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return { filePath: tmpPath };
}

async function downloadRemoteAsset(url: string): Promise<MaterializedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const ext = inferRemoteExtension(url, response.headers.get('content-type'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-'));
  const filePath = path.join(dir, `generated-${Date.now()}.${ext}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);
  log.info('[canvas:generation] downloaded remote asset', {
    url,
    statusCode: response.status,
    contentType: response.headers.get('content-type'),
    filePath,
    fileSize: buffer.byteLength,
  });

  return {
    filePath,
    cleanupPath: dir,
    sourceUrl: url,
  };
}

// ---------------------------------------------------------------------------
// Request materialization — resolves asset hashes to file paths for adapters
// ---------------------------------------------------------------------------

/**
 * Resolve an image asset hash from CAS to a local file path.
 * Tries common image extensions in order.
 * Returns undefined if the asset cannot be found.
 */
export function resolveImg2ImgSourcePath(hash: string, cas: CAS): string | undefined {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const filePath = cas.getAssetPath(hash, 'image', ext);
    if (fs.existsSync(filePath)) return filePath;
  }
  return undefined;
}

/**
 * Materialize a GenerationRequest for adapter consumption:
 * - Resolves sourceImageHash → sourceImagePath via CAS
 * - Resolves faceReferenceHashes → referenceImages file paths via CAS
 * - Merges steps / cfgScale / scheduler into params
 */
export function materializeGenerationRequest(
  request: GenerationRequest,
  cas: CAS,
): GenerationRequest {
  const extraParams: Record<string, unknown> = {};

  if (typeof request.steps === 'number') extraParams.steps = request.steps;
  if (typeof request.cfgScale === 'number') extraParams.cfgScale = request.cfgScale;
  if (request.scheduler) extraParams.scheduler = request.scheduler;

  let sourceImagePath: string | undefined;
  if (request.sourceImageHash) {
    sourceImagePath = resolveImg2ImgSourcePath(request.sourceImageHash, cas);
    if (sourceImagePath) {
      extraParams.sourceImagePath = sourceImagePath;
    } else {
      log.warn('[canvas:generation] sourceImageHash could not be resolved to a file', {
        sourceImageHash: request.sourceImageHash,
      });
    }
  }

  let referenceImages: string[] | undefined;

  // Resolve referenceImages hashes → file paths via CAS
  if (request.referenceImages && request.referenceImages.length > 0) {
    const resolved = request.referenceImages
      .map((hash) => resolveImg2ImgSourcePath(hash, cas))
      .filter((p): p is string => p !== undefined);
    referenceImages = resolved.length > 0 ? resolved : undefined;
    if (resolved.length < request.referenceImages.length) {
      log.warn('[canvas:generation] some referenceImage hashes could not be resolved', {
        total: request.referenceImages.length,
        resolved: resolved.length,
      });
    }
  }

  if (request.faceReferenceHashes && request.faceReferenceHashes.length > 0) {
    const resolvedFaceImages = request.faceReferenceHashes
      .map((hash) => resolveImg2ImgSourcePath(hash, cas))
      .filter((p): p is string => p !== undefined);
    if (resolvedFaceImages.length > 0) {
      referenceImages = [...(referenceImages ?? []), ...resolvedFaceImages];
    }
  }

  const hasExtra = Object.keys(extraParams).length > 0;
  return {
    ...request,
    referenceImages,
    params: hasExtra
      ? { ...(request.params ?? {}), ...extraParams }
      : request.params,
  };
}


export async function buildAdhocAdapter(id: string, config: ProviderConfigOverride, keychain: Keychain, genType: GenerationType = 'image', cas?: CAS): Promise<AIProviderAdapter> {
  const { baseUrl, model } = config;
  const apiKey = config.apiKey || await keychain.getKey(id) || '';
  // Send API key in all common header formats — provider ignores the ones it doesn't use
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-API-Key': apiKey,
    'api-key': apiKey,
    'Ocp-Apim-Subscription-Key': apiKey,
  };

  // Detect endpoint type from URL
  const isChatEndpoint = baseUrl.includes('/chat/completions');
  const adapterType = genType === 'video' ? 'video' as const : genType === 'voice' || genType === 'music' || genType === 'sfx' ? 'voice' as const : 'image' as const;
  const capabilities: Capability[] =
    genType === 'video'
      ? ['text-to-video', 'image-to-video']
      : genType === 'image'
        ? ['text-to-image', 'image-to-image']
        : genType === 'voice'
          ? ['text-to-voice']
          : genType === 'music'
            ? ['text-to-music']
            : ['text-to-sfx'];

  function buildBody(req: GenerationRequest): Record<string, unknown> {
    let body: Record<string, unknown>;
    if (isChatEndpoint) {
      body = { messages: [{ role: 'user', content: req.prompt }] };
    } else if (genType === 'image') {
      body = { prompt: req.prompt, n: 1, size: '1024x1024', response_format: 'url' };
    } else if (genType === 'video') {
      body = { prompt: req.prompt, duration: req.duration ?? 5 };
      const firstRef = req.referenceImages?.[0];
      if (firstRef) {
        const referenceField = resolveVideoReferenceImageField(id, model) ?? 'image';
        if (firstRef.startsWith('http') || firstRef.startsWith('data:')) {
          body[referenceField] = firstRef;
        } else if (cas) {
          for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
            const filePath = cas.getAssetPath(firstRef, 'image', ext);
            if (!fs.existsSync(filePath)) continue;
            const buf = fs.readFileSync(filePath);
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            body[referenceField] = `data:image/${mime};base64,${buf.toString('base64')}`;
            break;
          }
        }
      }
    } else {
      body = { prompt: req.prompt };
    }

    if (model) body.model = model;
    return body;
  }

  function extractAssetPath(json: Record<string, unknown>): string | undefined {
    const dataArr = json.data as Array<{ url?: string; b64_json?: string }> | undefined;
    if (dataArr?.[0]?.url) return dataArr[0].url;
    if (dataArr?.[0]?.b64_json) {
      const mime = genType === 'video' ? 'video/mp4' : 'image/png';
      return `data:${mime};base64,${dataArr[0].b64_json}`;
    }

    const choices = json.choices as Array<{ message?: { content?: string; images?: Array<{ image_url?: { url?: string } }> } }> | undefined;
    const msg = choices?.[0]?.message;
    if (msg?.images?.[0]?.image_url?.url) return msg.images[0].image_url.url;
    const content = msg?.content ?? '';
    if (content.startsWith('data:')) return content;
    const mediaUrlMatch = content.match(/(https?:\/\/\S+\.(?:png|jpg|jpeg|webp|mp4|mov|webm)\S*)/i);
    if (mediaUrlMatch?.[1]) return mediaUrlMatch[1];
    if (content.startsWith('http')) return content.trim();

    const directUrl = json.url ?? json.video_url ?? json.audio_url ?? json.output ?? json.download_url;
    return typeof directUrl === 'string' ? directUrl : undefined;
  }

  function extractAsyncSubmission(json: Record<string, unknown>): {
    taskId?: string;
    statusUrl?: string;
    status?: string;
  } {
    return {
      taskId: normalizeOptionalString(json.id ?? json.taskId ?? json.task_id ?? json.generation_id),
      statusUrl: normalizeOptionalString(json.status_url ?? json.statusUrl),
      status: normalizeOptionalString(json.status),
    };
  }

  async function submit(req: GenerationRequest): Promise<Record<string, unknown>> {
    const body = buildBody(req);
    log.info(`Ad-hoc adapter request: ${genType} to ${baseUrl}`, { model, bodyKeys: Object.keys(body) });
    const res = await fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const hint = res.status === 404
        ? ` (endpoint not found - check your base URL is correct for ${genType} generation)`
        : res.status === 500
          ? ` (server error - the model "${model}" may not support ${genType} generation)`
          : '';
      throw new Error(`Provider error ${res.status}${hint}: ${errBody.slice(0, 400)}`);
    }

    const json = await res.json() as Record<string, unknown>;
    log.info(`Ad-hoc adapter response for ${genType}: ${JSON.stringify(json).slice(0, 1000)}`);
    return json;
  }

  async function pollStatus(statusUrl: string, taskId: string, callbacks: SubscribeCallbacks): Promise<import('@lucid-fin/contracts').GenerationResult> {
    for (;;) {
      const res = await fetch(statusUrl, { headers });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Provider status error ${res.status}: ${errBody.slice(0, 400)}`);
      }

      const json = await res.json() as Record<string, unknown>;
      const status = normalizeOptionalString(json.status)?.toLowerCase() ?? 'processing';
      const progress = typeof json.progress === 'number'
        ? Math.round(json.progress <= 1 ? json.progress * 100 : json.progress)
        : undefined;
      const assetPath = extractAssetPath(json);

      if (status === 'queued' || status === 'pending') {
        callbacks.onQueueUpdate?.({ status: 'queued', currentStep: status, jobId: taskId });
      } else {
        callbacks.onQueueUpdate?.({ status: 'processing', currentStep: status, jobId: taskId });
        callbacks.onProgress?.({
          type: 'progress',
          percentage: progress ?? 0,
          currentStep: status,
          jobId: taskId,
        });
      }

      if (status === 'completed' && assetPath) {
        callbacks.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: taskId,
        });
        callbacks.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: taskId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: id,
          metadata: { taskId, status, statusUrl },
        };
      }

      if (status === 'failed' || status === 'error') {
        throw new Error(`Provider task ${taskId} failed`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  return {
    id,
    name: id,
    type: adapterType,
    capabilities,
    maxConcurrent: 1,
    executionCapabilities: {
      subscribe: true,
      queueUpdates: true,
      progressUpdates: true,
      webhook: false,
      cancellation: false,
    },
    configure(key: string) { void key; },
    async validate() { return true; },
    async generate(req: GenerationRequest): Promise<import('@lucid-fin/contracts').GenerationResult> {
      // Build request body based on endpoint type and generation type
      let body: Record<string, unknown>;
      if (isChatEndpoint) {
        body = { messages: [{ role: 'user', content: req.prompt }] };
      } else if (genType === 'image') {
        body = { prompt: req.prompt, n: 1, size: '1024x1024', response_format: 'url' };
      } else if (genType === 'video') {
        body = { prompt: req.prompt, duration: req.duration ?? 5 };
        // Resolve first reference image to a data URL for image-to-video
        const firstRef = req.referenceImages?.[0];
        if (firstRef) {
          if (firstRef.startsWith('http')) {
            body.image = firstRef;
          } else if (firstRef.startsWith('data:')) {
            body.image = firstRef;
          } else if (cas) {
            // Asset hash — read from CAS and convert to base64 data URL
            for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
              const filePath = cas.getAssetPath(firstRef, 'image', ext);
              if (fs.existsSync(filePath)) {
                const buf = fs.readFileSync(filePath);
                const mime = ext === 'jpg' ? 'jpeg' : ext;
                body.image = `data:image/${mime};base64,${buf.toString('base64')}`;
                break;
              }
            }
          }
        }
      } else {
        body = { prompt: req.prompt };
      }
      // Only include model if non-empty
      if (model) body.model = model;
      body = buildBody(req);

      log.info(`Ad-hoc adapter request: ${genType} to ${baseUrl}`, { model, bodyKeys: Object.keys(body) });
      const res = await fetch(baseUrl, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        // Provide helpful context for common errors
        const hint = res.status === 404
          ? ` (endpoint not found -- check your base URL is correct for ${genType} generation)`
          : res.status === 500
            ? ` (server error -- the model "${model}" may not support ${genType} generation)`
            : '';
        throw new Error(`Provider error ${res.status}${hint}: ${errBody.slice(0, 400)}`);
      }
      const json = await res.json() as Record<string, unknown>;
      log.info(`Ad-hoc adapter response for ${genType}: ${JSON.stringify(json).slice(0, 1000)}`);

      // --- Extract asset from response (supports multiple formats) ---

      // Format: { data: [{ url }] } or { data: [{ b64_json }] } -- OpenAI images
      const dataArr = json.data as Array<{ url?: string; b64_json?: string }> | undefined;
      if (dataArr?.[0]?.url) return { assetHash: '', assetPath: dataArr[0].url, provider: id };
      if (dataArr?.[0]?.b64_json) {
        const mime = genType === 'video' ? 'video/mp4' : 'image/png';
        return { assetHash: '', assetPath: `data:${mime};base64,${dataArr[0].b64_json}`, provider: id };
      }

      // Format: { choices: [{ message: { content, images } }] } -- chat completions
      const choices = json.choices as Array<{ message?: { content?: string; images?: Array<{ image_url?: { url?: string } }> } }> | undefined;
      const msg = choices?.[0]?.message;
      if (msg?.images?.[0]?.image_url?.url) return { assetHash: '', assetPath: msg.images[0].image_url.url, provider: id };
      const content = msg?.content ?? '';
      if (content.startsWith('data:')) return { assetHash: '', assetPath: content, provider: id };
      const mediaUrlMatch = content.match(/(https?:\/\/\S+\.(?:png|jpg|jpeg|webp|mp4|mov|webm)\S*)/i);
      if (mediaUrlMatch?.[1]) return { assetHash: '', assetPath: mediaUrlMatch[1], provider: id };
      if (content.startsWith('http')) return { assetHash: '', assetPath: content.trim(), provider: id };

      // Format: { id, status } -- async job (Runway, Luma, Pixazo, etc.)
      const taskId = json.id ?? json.taskId ?? json.task_id ?? json.generation_id;
      if (taskId) {
        const immediateOutput = json.output ?? json.video_url ?? json.url ?? json.download_url;
        if (typeof immediateOutput === 'string' && immediateOutput.startsWith('http')) {
          return { assetHash: '', assetPath: immediateOutput, provider: id };
        }
        throw new Error(`Generation submitted to provider (task: ${taskId}). Video is being generated on the provider's servers -- check your provider dashboard to download the result.`);
      }

      // Format: { url } or { video_url } or { output } -- direct URL
      const directUrl = json.url ?? json.video_url ?? json.audio_url ?? json.output;
      if (typeof directUrl === 'string') return { assetHash: '', assetPath: directUrl, provider: id };

      throw new Error(`Could not extract media from response: ${JSON.stringify(json).slice(0, 500)}`);
    },
    async subscribe(req: GenerationRequest, callbacks: SubscribeCallbacks): Promise<import('@lucid-fin/contracts').GenerationResult> {
      const json = await submit(req);
      const assetPath = extractAssetPath(json);
      if (assetPath) {
        callbacks.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
        });
        callbacks.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
        });
        return { assetHash: '', assetPath, provider: id };
      }

      const asyncSubmission = extractAsyncSubmission(json);
      if (asyncSubmission.taskId && asyncSubmission.statusUrl) {
        callbacks.onQueueUpdate?.({
          status: 'queued',
          currentStep: asyncSubmission.status ?? 'queued',
          jobId: asyncSubmission.taskId,
        });
        return pollStatus(asyncSubmission.statusUrl, asyncSubmission.taskId, callbacks);
      }

      if (asyncSubmission.taskId) {
        throw new Error(`Generation submitted to provider (task: ${asyncSubmission.taskId}). The provider did not return a status URL for subscribe polling.`);
      }

      throw new Error(`Could not extract media from response: ${JSON.stringify(json).slice(0, 500)}`);
    },
    estimateCost(_req: GenerationRequest): import('@lucid-fin/contracts').CostEstimate { return { estimatedCost: 0, currency: 'USD', provider: id, unit: 'image' }; },
    checkStatus(_jobId: string): Promise<JobStatus> { return Promise.resolve(JobStatus.Completed); },
    cancel(_jobId: string): Promise<void> { return Promise.resolve(); },
  };
}
