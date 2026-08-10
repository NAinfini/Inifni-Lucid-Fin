import fs from 'node:fs';
import path from 'node:path';
import {
  type AdapterError,
  type GenerationRequest,
  resolveLastVideoConditioningImage,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export const DEFAULT_MINIMAX_MODEL = 'MiniMax-H3';
export type MiniMaxApiVersion = 'v1' | 'v2';

type MiniMaxModel = 'MiniMax-H3' | 'MiniMax-Hailuo-2.3' | 'MiniMax-Hailuo-2.3-Fast';

const SUPPORTED_MODELS = new Set<MiniMaxModel>([
  'MiniMax-H3',
  'MiniMax-Hailuo-2.3',
  'MiniMax-Hailuo-2.3-Fast',
]);

const H3_RATIOS = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

export function assertSupportedMiniMaxModel(model: string): MiniMaxModel {
  const normalized = model.trim();
  if (!SUPPORTED_MODELS.has(normalized as MiniMaxModel)) {
    throw new Error(
      'MiniMax supports MiniMax-H3, MiniMax-Hailuo-2.3, and MiniMax-Hailuo-2.3-Fast models only',
    );
  }
  return normalized as MiniMaxModel;
}

export function miniMaxApiVersionForModel(model: string): MiniMaxApiVersion {
  return assertSupportedMiniMaxModel(model) === 'MiniMax-H3' ? 'v2' : 'v1';
}

export function toMiniMaxRequest(
  req: GenerationRequest,
  configuredModel = DEFAULT_MINIMAX_MODEL,
): Record<string, unknown> {
  const requestedModel = req.params?.['model'];
  const model = assertSupportedMiniMaxModel(
    typeof requestedModel === 'string' ? requestedModel : configuredModel,
  );
  return model === 'MiniMax-H3' ? toMiniMaxH3Request(req, model) : toMiniMaxV1Request(req, model);
}

export function parseMiniMaxResponse(data: Record<string, unknown>): {
  taskId: string;
  status: string;
  errorMessage?: string;
} {
  return {
    taskId: toNonEmptyString(data['task_id']) ?? '',
    status: toNonEmptyString(data['status']) ?? (hasMiniMaxProviderError(data) ? '' : 'submitted'),
    errorMessage: miniMaxErrorMessage(data),
  };
}

export function parseMiniMaxStatus(data: Record<string, unknown>): {
  status: string;
  fileId: string;
  errorMessage?: string;
} {
  return {
    status: toNonEmptyString(data['status']) ?? '',
    fileId: toNonEmptyString(data['file_id']) ?? '',
    errorMessage: miniMaxErrorMessage(data),
  };
}

export function parseMiniMaxH3Status(data: Record<string, unknown>): {
  status: string;
  downloadUrl: string;
  errorMessage?: string;
} {
  const task = asRecord(data['task']);
  const content = asRecord(task?.['content']);
  const taskError = asRecord(task?.['error']);
  return {
    status: toNonEmptyString(task?.['status']) ?? '',
    downloadUrl: firstString(content?.['url']) ?? '',
    errorMessage: firstString(
      taskError?.['message'],
      task?.['error'],
      task?.['message'],
      miniMaxErrorMessage(data),
    ),
  };
}

export function parseMiniMaxFile(data: Record<string, unknown>): {
  downloadUrl: string;
  errorMessage?: string;
} {
  const file = asRecord(data['file']);
  return {
    downloadUrl: firstString(file?.['download_url'], data['download_url'], data['video_url']) ?? '',
    errorMessage: miniMaxErrorMessage(data),
  };
}

export function hasMiniMaxProviderError(data: Record<string, unknown>): boolean {
  const statusCode = baseResponseStatusCode(data);
  return statusCode != null && statusCode !== 0;
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({
    provider: 'MiniMax',
    status,
    error: normalizeMiniMaxError(data),
  });
}

function toMiniMaxH3Request(req: GenerationRequest, model: MiniMaxModel): Record<string, unknown> {
  if (!req.prompt.trim() || req.prompt.length > 7_000) {
    throw new Error('MiniMax-H3 prompt must contain 1–7000 characters');
  }

  const firstFrameImage = resolveMediaReference(
    normalizeOptionalString(req.frameReferenceImages?.first) ??
      normalizeOptionalString(req.sourceImagePath),
    'image',
  );
  const lastFrameImage = resolveMediaReference(resolveLastVideoConditioningImage(req), 'image');
  const referenceImages = orderedUnique([
    ...readStringArray(req.referenceImages),
    ...readParamsStringArray(req.params, 'reference_image_urls', 'referenceImageUrls'),
  ]).map((value) => requireMediaReference(value, 'image'));
  const referenceVideos = orderedUnique(
    readParamsStringArray(req.params, 'reference_video_urls', 'referenceVideoUrls'),
  ).map((value) => requireMediaReference(value, 'video'));
  const referenceAudios = orderedUnique(
    readParamsStringArray(req.params, 'reference_audio_urls', 'referenceAudioUrls'),
  ).map((value) => requireMediaReference(value, 'audio'));
  const referenceCount = referenceImages.length + referenceVideos.length + referenceAudios.length;

  if (referenceImages.length > 9 || referenceVideos.length > 3 || referenceAudios.length > 3) {
    throw new Error(
      'MiniMax-H3 supports at most 9 reference images, 3 reference videos, and 3 reference audio clips',
    );
  }
  if (referenceCount > 12) {
    throw new Error('MiniMax-H3 supports at most 12 reference files total');
  }
  if (referenceAudios.length > 0 && referenceImages.length + referenceVideos.length === 0) {
    throw new Error('MiniMax-H3 reference audio requires a reference image or video');
  }
  if (referenceCount > 0 && (firstFrameImage || lastFrameImage)) {
    throw new Error('MiniMax-H3 cannot combine references with first- or last-frame images');
  }

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: req.prompt }];
  if (referenceCount > 0) {
    for (const imageUrl of referenceImages) {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl },
        role: 'reference_image',
      });
    }
    for (const videoUrl of referenceVideos) {
      content.push({
        type: 'video_url',
        video_url: { url: videoUrl },
        role: 'reference_video',
      });
    }
    for (const audioUrl of referenceAudios) {
      content.push({
        type: 'audio_url',
        audio_url: { url: audioUrl },
        role: 'reference_audio',
      });
    }
  } else {
    if (firstFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: firstFrameImage },
        role: 'first_frame',
      });
    }
    if (lastFrameImage) {
      content.push({
        type: 'image_url',
        image_url: { url: lastFrameImage },
        role: 'last_frame',
      });
    }
  }

  const ratio = resolveH3Ratio(req);
  const hasFrameInput = Boolean(firstFrameImage || lastFrameImage);
  const isTextToVideo = !hasFrameInput && referenceCount === 0;
  if (isTextToVideo && ratio === 'adaptive') {
    throw new Error('MiniMax-H3 text-to-video requires a concrete ratio');
  }

  const body: Record<string, unknown> = {
    model,
    content,
    duration: resolveH3Duration(req),
    resolution: resolveH3Resolution(req),
  };
  if (isTextToVideo) {
    body['ratio'] = ratio ?? '16:9';
  } else if (referenceCount > 0 && ratio != null) {
    body['ratio'] = ratio;
  }
  return body;
}

function toMiniMaxV1Request(req: GenerationRequest, model: MiniMaxModel): Record<string, unknown> {
  const firstFrameImage = resolveMediaReference(resolvePrimaryVideoConditioningImage(req), 'image');
  const lastFrameImage = resolveMediaReference(resolveLastVideoConditioningImage(req), 'image');
  const duration = resolveV1Duration(req);
  const resolution = resolveV1Resolution(req);
  const promptOptimizer = req.params?.['prompt_optimizer'];

  if (lastFrameImage && !firstFrameImage) {
    throw new Error('MiniMax last-frame video generation requires a first-frame image');
  }
  if (model === 'MiniMax-Hailuo-2.3-Fast' && !firstFrameImage) {
    throw new Error('MiniMax-Hailuo-2.3-Fast supports image-to-video generation only');
  }
  assertV1DurationResolution(duration, resolution);

  return {
    prompt: req.prompt,
    model,
    duration,
    resolution,
    prompt_optimizer: typeof promptOptimizer === 'boolean' ? promptOptimizer : true,
    ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
    ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}),
  };
}

function resolveH3Duration(req: GenerationRequest): number {
  if (req.duration == null) return 5;
  if (!Number.isInteger(req.duration) || req.duration < 4 || req.duration > 15) {
    throw new Error('MiniMax-H3 duration must be an integer from 4 to 15 seconds');
  }
  return req.duration;
}

function resolveH3Resolution(req: GenerationRequest): string {
  const requestedResolution = req.params?.['resolution'];
  if (requestedResolution != null) {
    if (typeof requestedResolution !== 'string') {
      throw new Error('MiniMax-H3 resolution must be 768P or 2K');
    }
    const normalized = requestedResolution.trim().toUpperCase();
    if (normalized === '768P' || normalized === '2K') return normalized;
    throw new Error('MiniMax-H3 resolution must be 768P or 2K');
  }
  return req.height === 768 ? '768P' : '2K';
}

function resolveH3Ratio(req: GenerationRequest): string | undefined {
  const value = req.params?.['ratio'] ?? req.params?.['aspect_ratio'];
  if (value == null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('MiniMax-H3 ratio must be a supported aspect ratio');
  }
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase() === 'adaptive' ? 'adaptive' : trimmed;
  if (!H3_RATIOS.has(normalized)) {
    throw new Error('MiniMax-H3 ratio must be adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, or 9:16');
  }
  return normalized;
}

function resolveV1Duration(req: GenerationRequest): number {
  if (req.duration == null) return 6;
  if (!Number.isInteger(req.duration)) {
    throw new Error('MiniMax duration must be an integer number of seconds');
  }
  return req.duration;
}

function resolveV1Resolution(req: GenerationRequest): string {
  const requestedResolution = req.params?.['resolution'];
  if (requestedResolution != null) {
    if (typeof requestedResolution !== 'string') {
      throw new Error('MiniMax resolution must be 768P or 1080P');
    }
    return requestedResolution.trim().toUpperCase();
  }

  if (req.height == null) return '768P';
  if (req.height === 768) return '768P';
  if (req.height === 1080) return '1080P';
  throw new Error('MiniMax resolution must be 768P or 1080P');
}

function assertV1DurationResolution(duration: number, resolution: string): void {
  if (resolution === '768P' && (duration === 6 || duration === 10)) return;
  if (resolution === '1080P' && duration === 6) return;
  throw new Error(
    'MiniMax supports 768P videos for 6 or 10 seconds and 1080P videos for 6 seconds only',
  );
}

function miniMaxErrorMessage(data: Record<string, unknown>): string | undefined {
  const baseResponse = asRecord(data['base_resp']);
  const task = asRecord(data['task']);
  const taskError = asRecord(task?.['error']);
  const directMessage = firstString(
    data['error_message'],
    data['error_msg'],
    data['message'],
    data['error'],
    asRecord(data['error'])?.['message'],
    taskError?.['message'],
    task?.['error'],
    task?.['message'],
  );
  if (directMessage) return directMessage;
  return hasMiniMaxProviderError(data) ? firstString(baseResponse?.['status_msg']) : undefined;
}

function normalizeMiniMaxError(data: unknown): unknown {
  const record = asRecord(data);
  if (!record) return data;

  const statusCode = baseResponseStatusCode(record);
  const message = miniMaxErrorMessage(record);
  const providerCode =
    toNonEmptyString(record['code']) ??
    toNonEmptyString(asRecord(record['error'])?.['type']) ??
    (statusCode != null && statusCode !== 0 ? String(statusCode) : undefined);

  return {
    ...record,
    ...(message ? { message } : {}),
    ...(providerCode ? { code: providerCode } : {}),
  };
}

function baseResponseStatusCode(data: Record<string, unknown>): number | undefined {
  const baseResponse = asRecord(data['base_resp']);
  const value = baseResponse?.['status_code'];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(values: readonly unknown[] | undefined): string[] {
  return (values ?? [])
    .map((value) => (typeof value === 'string' ? normalizeOptionalString(value) : undefined))
    .filter((value): value is string => Boolean(value));
}

function readParamsStringArray(
  params: Record<string, unknown> | undefined,
  ...keys: string[]
): string[] {
  for (const key of keys) {
    const value = params?.[key];
    if (Array.isArray(value)) return readStringArray(value);
  }
  return [];
}

function orderedUnique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function requireMediaReference(value: string, mediaType: 'image' | 'video' | 'audio'): string {
  const resolved = resolveMediaReference(value, mediaType);
  if (resolved) return resolved;
  throw new Error(
    `MiniMax-H3 ${mediaType} references must be public URLs, matching data URIs, or readable local files`,
  );
}

function resolveMediaReference(
  value: string | undefined,
  mediaType: 'image' | 'video' | 'audio',
): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return undefined;
  if (new RegExp(`^data:${mediaType}/[a-z0-9.+-]+;base64,`, 'i').test(normalized)) {
    return normalized;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' || url.protocol === 'http:') return normalized;
  } catch {
    // Fall through to local-file materialization.
  }
  try {
    if (!fs.statSync(normalized).isFile()) return undefined;
    return `data:${mediaMimeType(normalized, mediaType)};base64,${fs
      .readFileSync(normalized)
      .toString('base64')}`;
  } catch {
    return undefined;
  }
}

function mediaMimeType(filePath: string, mediaType: 'image' | 'video' | 'audio'): string {
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
  };
  return known[path.extname(filePath).toLowerCase()] ?? `${mediaType}/octet-stream`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}
