import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AdapterConfigureOptions,
  AdapterError,
  AdapterType,
  AIProviderAdapter,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { ErrorCode, JobStatus as JobStatusValue, LucidError } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { validateProviderUrl } from '../url-policy.js';

const DEFAULT_BASE_URL = 'https://app-api.pixverse.ai';
const DEFAULT_MODEL = 'v6';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 150;
const V6_QUALITIES = new Set(['360p', '540p', '720p', '1080p']);
const V6_ASPECT_RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9']);

type PixVerseEnvelope = {
  ErrCode?: number | string;
  ErrMsg?: string;
  Resp?: Record<string, unknown>;
};

/** Public PixVerse V6 API adapter for text-to-video and image-to-video. */
export class PixVerseAdapter implements AIProviderAdapter {
  readonly id = 'pixverse';
  readonly name = 'PixVerse';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 1, preservesOrder: true },
    firstFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  getPromptLimits(_request: GenerationRequest) {
    return { maxPromptChars: 5_000, negativePrompt: 'unsupported' as const };
  }

  private apiKey = '';
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey.trim();
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.model = options.model.trim();
    }
    this.pollIntervalMs = boundedNumber(
      options?.['pollIntervalMs'],
      DEFAULT_POLL_INTERVAL_MS,
      0,
      60_000,
    );
    this.maxPollAttempts = boundedNumber(
      options?.['maxPollAttempts'],
      DEFAULT_MAX_POLL_ATTEMPTS,
      1,
      DEFAULT_MAX_POLL_ATTEMPTS,
    );
  }

  async validate(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/openapi/v2/account/balance`, {
        headers: this.headers(),
      });
      if (!response.ok) return false;
      const envelope = asEnvelope(await response.json().catch(() => ({})));
      return readErrCode(envelope) === 0;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    const record = asRecord(error);
    const normalized = record
      ? {
          ...record,
          code: readErrCode(asEnvelope(record)) ?? record['code'],
          message: readString(record, 'ErrMsg', 'message', 'detail') ?? 'PixVerse request failed',
        }
      : error;
    return parseAdapterError({ provider: this.name, status, error: normalized });
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    return this.run(req);
  }

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    return this.run(req, callbacks);
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const quality = resolveQuality(req);
    const creditsPerSecond =
      quality === '1080p'
        ? req.audio
          ? 23
          : 18
        : quality === '720p'
          ? req.audio
            ? 12
            : 9
          : quality === '540p'
            ? req.audio
              ? 9
              : 7
            : req.audio
              ? 7
              : 5;
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * creditsPerSecond,
      currency: 'credits',
      unit: 'per second of output video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const envelope = await this.requestEnvelope(
      `${this.baseUrl}/openapi/v2/video/result/${encodeURIComponent(jobId)}`,
      { headers: this.headers() },
    );
    return mapPixVerseStatus(readNumber(envelope.Resp, 'status'));
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse does not document an API cancellation endpoint',
    );
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'video') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `PixVerse does not support ${req.type} generation`,
      );
    }
    if (!this.apiKey)
      throw new LucidError(ErrorCode.InvalidRequest, 'PixVerse API key is required');
    const submission = await this.buildSubmission(req);

    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });
    const envelope = await this.requestEnvelope(`${this.baseUrl}${submission.endpoint}`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(submission.body),
    });
    const videoId = readId(envelope.Resp, 'video_id', 'videoId', 'id');
    if (!videoId) throw this.invalidResponse('PixVerse submission did not include video_id');

    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: videoId });
    return this.poll(videoId, req, callbacks);
  }

  private async buildSubmission(req: GenerationRequest): Promise<{
    endpoint: '/openapi/v2/video/text/generate' | '/openapi/v2/video/img/generate';
    body: Record<string, unknown>;
  }> {
    const prompt = assertPrompt(req.prompt);
    const duration = resolveDuration(req);
    const quality = resolveQuality(req);
    const sourceImage = resolveSourceImage(req);
    const body = buildCommonBody(req, this.model, prompt, duration, quality);

    if (!sourceImage) {
      return {
        endpoint: '/openapi/v2/video/text/generate',
        body: {
          ...body,
          aspect_ratio: resolveAspectRatio(req),
        },
      };
    }

    const imgId = await this.uploadImage(sourceImage);
    return {
      endpoint: '/openapi/v2/video/img/generate',
      body: { ...body, img_id: imgId },
    };
  }

  private async uploadImage(image: string): Promise<string> {
    const form = new FormData();
    if (/^(?:https?:|data:)/i.test(image)) {
      form.append('image_url', image);
    } else {
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(image);
      } catch (error) {
        throw new LucidError(
          ErrorCode.InvalidRequest,
          `PixVerse source image could not be read: ${error instanceof Error ? error.message : image}`,
        );
      }
      form.append(
        'image',
        new Blob([Uint8Array.from(bytes)], { type: imageMimeType(image) }),
        path.basename(image),
      );
    }
    const envelope = await this.requestEnvelope(`${this.baseUrl}/openapi/v2/image/upload`, {
      method: 'POST',
      headers: this.headers(),
      body: form,
    });
    const imageId = readId(envelope.Resp, 'img_id', 'imgId', 'id');
    if (!imageId) throw this.invalidResponse('PixVerse image upload did not include img_id');
    return imageId;
  }

  private async poll(
    videoId: string,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const envelope = await this.requestEnvelope(
        `${this.baseUrl}/openapi/v2/video/result/${encodeURIComponent(videoId)}`,
        { headers: this.headers() },
      );
      const response = envelope.Resp ?? {};
      const rawStatus = readNumber(response, 'status');
      const status = mapPixVerseStatus(rawStatus);

      if (status === JobStatusValue.Completed) {
        const assetPath = readString(response, 'url');
        if (!assetPath) throw this.invalidResponse('PixVerse completed without a video URL');
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: videoId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: videoId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: {
            videoId,
            model: this.model,
            status: rawStatus ?? 1,
          },
        };
      }
      if (rawStatus === 7) {
        throw new LucidError(
          ErrorCode.ContentModeration,
          readString(response, 'message', 'error') ??
            'PixVerse rejected the request during moderation',
        );
      }
      if (rawStatus === 8) {
        throw adapterErrorToLucidError(
          this.normalizeError(
            {
              code: 'generation_failed',
              message: readString(response, 'message', 'error') ?? 'PixVerse generation failed',
            },
            502,
          ),
        );
      }

      callbacks?.onQueueUpdate?.({
        status: status === JobStatusValue.Queued ? 'queued' : 'processing',
        currentStep: rawStatus === 5 ? 'generating' : 'queued',
        jobId: videoId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt),
        currentStep: rawStatus === 5 ? 'generating' : 'queued',
        jobId: videoId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `PixVerse generation ${videoId} did not finish within the polling limit`,
    );
  }

  private async requestEnvelope(url: string, init: RequestInit): Promise<PixVerseEnvelope> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw adapterErrorToLucidError(this.normalizeError(error));
    }
    const payload = await response.json().catch(() => ({}));
    const envelope = asEnvelope(payload);
    const errCode = readErrCode(envelope);
    if (!response.ok || errCode !== 0) {
      throw adapterErrorToLucidError(this.normalizeError(envelope, response.status));
    }
    return envelope;
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private headers(): Record<string, string> {
    return {
      'API-KEY': this.apiKey,
      'Ai-trace-id': randomUUID(),
    };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.headers(), 'Content-Type': 'application/json' };
  }
}

function buildCommonBody(
  req: GenerationRequest,
  model: string,
  prompt: string,
  duration: number,
  quality: string,
): Record<string, unknown> {
  const audio = booleanParam(req, 'generate_audio_switch', 'generateAudioSwitch') ?? req.audio;
  const multiClip = booleanParam(req, 'generate_multi_clip_switch', 'generateMultiClipSwitch');
  const seed = req.seed ?? numberParam(req, 'seed');
  if (seed != null && (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse seed must be an integer from 0 to 2147483647',
    );
  }
  return {
    model,
    prompt,
    duration,
    quality,
    ...(audio != null ? { generate_audio_switch: audio } : {}),
    ...(multiClip != null ? { generate_multi_clip_switch: multiClip } : {}),
    ...(seed != null ? { seed } : {}),
    ...(stringParam(req, 'motion_mode', 'motionMode')
      ? { motion_mode: stringParam(req, 'motion_mode', 'motionMode') }
      : {}),
    ...(stringParam(req, 'camera_movement', 'cameraMovement')
      ? { camera_movement: stringParam(req, 'camera_movement', 'cameraMovement') }
      : {}),
    ...(numberParam(req, 'template_id', 'templateId') != null
      ? { template_id: numberParam(req, 'template_id', 'templateId') }
      : {}),
  };
}

function resolveSourceImage(req: GenerationRequest): string | undefined {
  if (req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse last-frame generation is not enabled by this adapter; submit a first-frame image only',
    );
  }
  const source = nonEmptyString(req.sourceImagePath);
  const firstFrame = nonEmptyString(req.frameReferenceImages?.first);
  const references = nonEmptyStrings(req.referenceImages);
  if (source && firstFrame) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse cannot combine sourceImagePath with a first-frame image',
    );
  }
  if ((source || firstFrame) && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse accepts one source image and cannot combine it with generic references',
    );
  }
  if (references.length > 1) {
    throw new LucidError(ErrorCode.InvalidRequest, 'PixVerse supports one image input per request');
  }
  return source ?? firstFrame ?? references[0];
}

function resolveDuration(req: GenerationRequest): number {
  const duration = req.duration ?? numberParam(req, 'duration') ?? 5;
  if (!Number.isInteger(duration) || duration < 1 || duration > 15) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse V6 duration must be an integer from 1 to 15 seconds',
    );
  }
  return duration;
}

function resolveQuality(req: GenerationRequest): string {
  const quality = (stringParam(req, 'quality') ?? req.quality ?? '720p').toLowerCase();
  if (!V6_QUALITIES.has(quality)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse V6 quality must be one of 360p, 540p, 720p, or 1080p',
    );
  }
  return quality;
}

function resolveAspectRatio(req: GenerationRequest): string {
  const ratio =
    stringParam(req, 'aspect_ratio', 'aspectRatio') ?? aspectRatioFromSize(req.width, req.height);
  if (!V6_ASPECT_RATIOS.has(ratio)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `PixVerse V6 does not support aspect ratio ${ratio}`,
    );
  }
  return ratio;
}

function assertPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw new LucidError(ErrorCode.InvalidRequest, 'PixVerse prompt is required');
  if (trimmed.length > 5_000) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'PixVerse V6 prompt must not exceed 5000 characters',
    );
  }
  return trimmed;
}

function mapPixVerseStatus(status: number | undefined): JobStatus {
  switch (status) {
    case 1:
      return JobStatusValue.Completed;
    case 7:
    case 8:
      return JobStatusValue.Failed;
    case 5:
      return JobStatusValue.Running;
    default:
      return JobStatusValue.Queued;
  }
}

function asEnvelope(value: unknown): PixVerseEnvelope {
  const record = asRecord(value);
  const errCode = record?.['ErrCode'];
  return {
    ErrCode: typeof errCode === 'number' || typeof errCode === 'string' ? errCode : undefined,
    ErrMsg: readString(record, 'ErrMsg'),
    Resp: asRecord(record?.['Resp']),
  };
}

function readErrCode(envelope: PixVerseEnvelope): number | undefined {
  const value = envelope.ErrCode;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readId(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readNumber(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function stringParam(req: GenerationRequest, ...keys: string[]): string | undefined {
  return readString(req.params, ...keys);
}

function booleanParam(req: GenerationRequest, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = req.params?.[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function numberParam(req: GenerationRequest, ...keys: string[]): number | undefined {
  return readNumber(req.params, ...keys);
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function nonEmptyStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function aspectRatioFromSize(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  const supported = [
    ['21:9', 21 / 9],
    ['16:9', 16 / 9],
    ['3:2', 3 / 2],
    ['4:3', 4 / 3],
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['2:3', 2 / 3],
    ['9:16', 9 / 16],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
