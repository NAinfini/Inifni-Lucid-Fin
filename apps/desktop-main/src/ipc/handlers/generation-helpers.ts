import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AdapterRegistry,
} from '@lucid-fin/adapters-ai';
import type { CompiledPrompt, PromptMode } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  AssetType,
  Canvas,
  CanvasNode,
  Capability,
  GenerationEntityRef,
  GenerationRequest,
  GenerationType,
  StyleGuide,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import {
  JobStatus,
  resolvePrimaryVideoConditioningImage,
  resolveVideoReferenceImageField,
} from '@lucid-fin/contracts';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import log from '../../logger.js';
import { sanitizePng } from '../../sanitize-png.js';
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
  compiled: CompiledPrompt;
  resolvedEntityRefs: {
    characterRefs?: GenerationEntityRef[];
    equipmentRefs?: GenerationEntityRef[];
    locationRefs?: GenerationEntityRef[];
  };
};

export type GenerationMediaConfig = Pick<GenerationRequest, 'width' | 'height' | 'duration'> & {
  fps?: number;
};

export type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

export type PollOptions = {
  /** Maximum number of poll iterations before timeout (default 120 = ~10 min at 5 s) */
  maxIterations?: number;
  /** Abort signal to cancel polling early */
  signal?: AbortSignal;
  /** Interval between polls in ms (default 5000) */
  intervalMs?: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_IMAGE_SIZE = { width: 1024, height: 1024 };
export const DEFAULT_VIDEO_SIZE = { width: 1280, height: 720 };
export const DEFAULT_VIDEO_DURATION = 5;
export const DEFAULT_AUDIO_DURATION = 5;
export const MAX_VARIANTS = 9;
export const MAX_ACCUMULATED_VARIANTS = 20;

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

/**
 * Extract the first http(s) media URL from free-form LLM output.
 *
 * The old pattern `https?:\/\/\S+\.(png|...)\S*` used `\S+` / `\S*`, which
 * over-matches on locales with no ASCII whitespace (e.g. Chinese "。"
 * directly following a URL is not whitespace, so the trailing `\S*` keeps
 * swallowing it). Restrict to the RFC-3986 unreserved + sub-delims set so
 * a URL ends at the first non-URL character — CJK punctuation, quotes,
 * fences, backticks, parentheses, commas.
 *
 * Returns `null` if no URL is found.
 */
const URL_CHAR = "[A-Za-z0-9\\-._~:/?#\\[\\]@!$&*+;=%]";
const MEDIA_URL_RE = new RegExp(
  `(https?://${URL_CHAR}+\\.(?:png|jpg|jpeg|webp|mp4|mov|webm)(?:${URL_CHAR}*)?)`,
  'i',
);
export function extractMediaUrlFromLLMText(text: string): string | null {
  if (!text) return null;
  const m = text.match(MEDIA_URL_RE);
  return m?.[1] ?? null;
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

export function mergeVariants(
  existing: string[],
  incoming: string[],
): { variants: string[]; selectedVariantIndex: number } {
  const seen = new Set(existing);
  const newHashes = incoming.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
  let merged = [...existing, ...newHashes];
  if (merged.length > MAX_ACCUMULATED_VARIANTS) {
    merged = merged.slice(merged.length - MAX_ACCUMULATED_VARIANTS);
  }
  const firstNewIndex = merged.indexOf(newHashes[0] ?? incoming[0]);
  return {
    variants: merged,
    selectedVariantIndex: firstNewIndex >= 0 ? firstNewIndex : 0,
  };
}

export function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch { /* malformed URL — extension cannot be determined */
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

function mapGenerationTypeToExpectedAssetType(generationType: GenerationType): AssetType {
  if (generationType === 'image') return 'image';
  if (generationType === 'video') return 'video';
  return 'audio';
}

function inferAssetTypeFromMimeType(mimeType: string): AssetType | undefined {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return undefined;
}

function inferAssetTypeFromUrl(url: string): AssetType | undefined {
  const ext = extensionFromUrl(url);
  if (!ext) return undefined;

  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
    case 'bmp':
    case 'tiff':
      return 'image';
    case 'mp4':
    case 'mov':
    case 'webm':
      return 'video';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
    case 'aac':
    case 'm4a':
      return 'audio';
    default:
      return undefined;
  }
}

function assertExpectedResponseMediaType(
  actualType: AssetType,
  expectedType: AssetType,
  sourceLabel: string,
): void {
  if (actualType !== expectedType) {
    throw new Error(`Expected ${expectedType} response payload, received ${actualType} from ${sourceLabel}`);
  }
}

function validateAssetUrlForGeneration(
  assetUrl: string,
  generationType: GenerationType,
  sourceLabel: string,
): string {
  const expectedType = mapGenerationTypeToExpectedAssetType(generationType);
  const actualType = inferAssetTypeFromUrl(assetUrl);
  if (actualType) {
    assertExpectedResponseMediaType(actualType, expectedType, sourceLabel);
  }
  return assetUrl;
}

function validateDataUrlForGeneration(
  dataUrl: string,
  generationType: GenerationType,
  sourceLabel: string,
): string {
  const expectedType = mapGenerationTypeToExpectedAssetType(generationType);
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/i);
  if (!match) {
    return dataUrl;
  }

  const mimeType = match[1].trim().toLowerCase();
  const mimeAssetType = inferAssetTypeFromMimeType(mimeType);
  if (mimeAssetType) {
    assertExpectedResponseMediaType(mimeAssetType, expectedType, sourceLabel);
  }

  if (match[2]) {
    const inspection = inspectBufferMedia(Buffer.from(match[3], 'base64'));
    if (inspection) {
      assertExpectedResponseMediaType(inspection.type, expectedType, sourceLabel);
      return `data:${inspection.mimeType};base64,${match[3]}`;
    }
  }

  return dataUrl;
}

function buildTypedBase64DataUrl(
  base64Value: string,
  generationType: GenerationType,
  sourceLabel: string,
): string {
  const inspection = inspectBufferMedia(Buffer.from(base64Value, 'base64'));
  if (!inspection) {
    throw new Error(`Could not determine media type from ${sourceLabel}`);
  }

  const expectedType = mapGenerationTypeToExpectedAssetType(generationType);
  assertExpectedResponseMediaType(inspection.type, expectedType, sourceLabel);
  return `data:${inspection.mimeType};base64,${base64Value}`;
}

function inspectBufferMedia(buffer: Buffer): { type: AssetType; mimeType: string } | undefined {
  if (buffer.length < 2) {
    return undefined;
  }

  if (hasBinaryPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { type: 'image', mimeType: 'image/png' };
  }
  if (hasBinaryPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return { type: 'image', mimeType: 'image/jpeg' };
  }
  if (hasAsciiPrefix(buffer, 0, 'GIF87a') || hasAsciiPrefix(buffer, 0, 'GIF89a')) {
    return { type: 'image', mimeType: 'image/gif' };
  }
  if (hasAsciiPrefix(buffer, 0, 'BM')) {
    return { type: 'image', mimeType: 'image/bmp' };
  }
  if (
    hasBinaryPrefix(buffer, [0x49, 0x49, 0x2a, 0x00]) ||
    hasBinaryPrefix(buffer, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return { type: 'image', mimeType: 'image/tiff' };
  }
  if (hasAsciiPrefix(buffer, 0, 'RIFF') && hasAsciiPrefix(buffer, 8, 'WEBP')) {
    return { type: 'image', mimeType: 'image/webp' };
  }
  if (hasAsciiPrefix(buffer, 0, 'RIFF') && hasAsciiPrefix(buffer, 8, 'WAVE')) {
    return { type: 'audio', mimeType: 'audio/wav' };
  }
  if (hasAsciiPrefix(buffer, 0, 'fLaC')) {
    return { type: 'audio', mimeType: 'audio/flac' };
  }
  if (hasAsciiPrefix(buffer, 0, 'OggS')) {
    return { type: 'audio', mimeType: 'audio/ogg' };
  }
  if (looksLikeAdtsAac(buffer)) {
    return { type: 'audio', mimeType: 'audio/aac' };
  }
  if (hasAsciiPrefix(buffer, 0, 'ID3') || looksLikeMp3Frame(buffer)) {
    return { type: 'audio', mimeType: 'audio/mpeg' };
  }
  if (looksLikeWebm(buffer)) {
    return { type: 'video', mimeType: 'video/webm' };
  }
  if (buffer.length >= 12 && hasAsciiPrefix(buffer, 4, 'ftyp')) {
    const brand = buffer.toString('ascii', 8, 12);
    if (brand === 'qt  ') {
      return { type: 'video', mimeType: 'video/quicktime' };
    }
    if (brand === 'M4A ' || brand === 'M4B ' || brand === 'M4P ' || brand === 'isma') {
      return { type: 'audio', mimeType: 'audio/mp4' };
    }
    return { type: 'video', mimeType: 'video/mp4' };
  }

  return undefined;
}

function hasBinaryPrefix(buffer: Buffer, prefix: number[]): boolean {
  if (buffer.length < prefix.length) {
    return false;
  }
  return prefix.every((value, index) => buffer[index] === value);
}

function hasAsciiPrefix(buffer: Buffer, start: number, expected: string): boolean {
  return buffer.toString('ascii', start, Math.min(buffer.length, start + expected.length)) === expected;
}

function looksLikeWebm(buffer: Buffer): boolean {
  return hasBinaryPrefix(buffer, [0x1a, 0x45, 0xdf, 0xa3]) &&
    buffer.toString('ascii', 0, Math.min(buffer.length, 64)).toLowerCase().includes('webm');
}

function looksLikeAdtsAac(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
}

function looksLikeMp3Frame(buffer: Buffer): boolean {
  if (buffer.length < 2) {
    return false;
  }
  if (buffer[0] !== 0xff || (buffer[1] & 0xe0) !== 0xe0) {
    return false;
  }
  return ((buffer[1] >> 1) & 0x03) !== 0;
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
  const buffer = sanitizePng(Buffer.from(match[2], 'base64'));
  const tmpPath = path.join(os.tmpdir(), `lucid-fin-gen-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);
  return { filePath: tmpPath, cleanupPath: tmpPath };
}

async function downloadRemoteAsset(url: string): Promise<MaterializedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const ext = inferRemoteExtension(url, response.headers.get('content-type'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-'));
  const filePath = path.join(dir, `generated-${Date.now()}.${ext}`);
  const buffer = sanitizePng(Buffer.from(await response.arrayBuffer()));
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
 * - Resolves frameReferenceImages → local file paths via CAS
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

  const frameReferenceImages = request.frameReferenceImages
    ? {
        first: request.frameReferenceImages.first
          ? resolveImg2ImgSourcePath(request.frameReferenceImages.first, cas)
          : undefined,
        last: request.frameReferenceImages.last
          ? resolveImg2ImgSourcePath(request.frameReferenceImages.last, cas)
          : undefined,
      }
    : undefined;

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

  const hasExtra = Object.keys(extraParams).length > 0;
  return {
    ...request,
    sourceImagePath,
    frameReferenceImages:
      frameReferenceImages?.first || frameReferenceImages?.last
        ? frameReferenceImages
        : undefined,
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
      const firstRef = resolvePrimaryVideoConditioningImage(req);
      if (firstRef) {
        const referenceField = resolveVideoReferenceImageField(id, model) ?? 'image';
        if (firstRef.startsWith('http') || firstRef.startsWith('data:')) {
          body[referenceField] = firstRef;
        } else if (fs.existsSync(firstRef)) {
          const ext = path.extname(firstRef).slice(1).toLowerCase() || 'png';
          const buf = fs.readFileSync(firstRef);
          const mime = ext === 'jpg' ? 'jpeg' : ext;
          body[referenceField] = `data:image/${mime};base64,${buf.toString('base64')}`;
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
    if (dataArr?.[0]?.url) {
      return validateAssetUrlForGeneration(dataArr[0].url, genType, 'data[0].url');
    }
    if (dataArr?.[0]?.b64_json) {
      return buildTypedBase64DataUrl(dataArr[0].b64_json, genType, 'data[0].b64_json');
    }

    const choices = json.choices as Array<{ message?: { content?: string; images?: Array<{ image_url?: { url?: string } }> } }> | undefined;
    const msg = choices?.[0]?.message;
    if (msg?.images?.[0]?.image_url?.url) {
      if (mapGenerationTypeToExpectedAssetType(genType) !== 'image') {
        throw new Error(`Image response field cannot satisfy ${genType} generation`);
      }
      return validateAssetUrlForGeneration(
        msg.images[0].image_url.url,
        genType,
        'choices[0].message.images[0].image_url.url',
      );
    }
    const content = msg?.content ?? '';
    if (content.startsWith('data:')) {
      return validateDataUrlForGeneration(content, genType, 'choices[0].message.content');
    }
    const mediaUrl = extractMediaUrlFromLLMText(content);
    if (mediaUrl) {
      return validateAssetUrlForGeneration(mediaUrl, genType, 'choices[0].message.content');
    }
    if (content.startsWith('http')) {
      return validateAssetUrlForGeneration(content.trim(), genType, 'choices[0].message.content');
    }

    const videoUrl = normalizeOptionalString(json.video_url);
    if (videoUrl) {
      assertExpectedResponseMediaType('video', mapGenerationTypeToExpectedAssetType(genType), 'video_url');
      return validateAssetUrlForGeneration(videoUrl, genType, 'video_url');
    }

    const audioUrl = normalizeOptionalString(json.audio_url);
    if (audioUrl) {
      assertExpectedResponseMediaType('audio', mapGenerationTypeToExpectedAssetType(genType), 'audio_url');
      return validateAssetUrlForGeneration(audioUrl, genType, 'audio_url');
    }

    const directUrl = normalizeOptionalString(json.url);
    if (directUrl) {
      if (directUrl.startsWith('data:')) {
        return validateDataUrlForGeneration(directUrl, genType, 'url');
      }
      return validateAssetUrlForGeneration(directUrl, genType, 'url');
    }

    const outputUrl = normalizeOptionalString(json.output);
    if (outputUrl) {
      if (outputUrl.startsWith('data:')) {
        return validateDataUrlForGeneration(outputUrl, genType, 'output');
      }
      return validateAssetUrlForGeneration(outputUrl, genType, 'output');
    }

    const downloadUrl = normalizeOptionalString(json.download_url);
    if (downloadUrl) {
      return validateAssetUrlForGeneration(downloadUrl, genType, 'download_url');
    }

    return undefined;
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

  async function pollStatus(
    statusUrl: string,
    taskId: string,
    callbacks: SubscribeCallbacks,
    options?: PollOptions,
  ): Promise<import('@lucid-fin/contracts').GenerationResult> {
    const maxIterations = options?.maxIterations ?? 120;
    const signal = options?.signal;
    const intervalMs = options?.intervalMs ?? 5_000;

    for (let iteration = 0; ; iteration++) {
      if (signal?.aborted) {
        throw new Error(`Polling aborted for task ${taskId}: ${signal.reason ?? 'signal aborted'}`);
      }

      if (iteration >= maxIterations) {
        throw new Error(
          `Polling timed out for task ${taskId} after ${iteration} iterations`
          + ` (~${Math.round((iteration * intervalMs) / 1_000)}s)`,
        );
      }

      const res = await fetch(statusUrl, { headers, signal });
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

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
      const json = await submit(req);
      const assetPath = extractAssetPath(json);
      if (assetPath) {
        return { assetHash: '', assetPath, provider: id };
      }

      const asyncSubmission = extractAsyncSubmission(json);
      if (asyncSubmission.taskId) {
        throw new Error(`Generation submitted to provider (task: ${asyncSubmission.taskId}). Video is being generated on the provider's servers -- check your provider dashboard to download the result.`);
      }

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
