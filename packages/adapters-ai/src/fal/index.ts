import fs from 'node:fs';
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

type FalMediaType = 'image' | 'video';

type FalEndpointConfig = {
  baseUrl: string;
  model: string;
};

type FalJob = {
  requestId: string;
  type: FalMediaType;
  model: string;
  statusUrl: string;
  responseUrl: string;
  cancelUrl: string;
};

const DEFAULT_IMAGE_MODEL = 'fal-ai/flux-2-pro';
const DEFAULT_VIDEO_MODEL = 'minimax/h3/text-to-video';
const DEFAULT_QUEUE_URL = 'https://queue.fal.run';
const MINIMAX_H3_MODEL_PREFIXES = ['minimax/h3', 'minimax/hailuo-03'] as const;
const MINIMAX_H3_CANONICAL_PREFIX = 'minimax/h3';
const MINIMAX_H3_RATIOS = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);

/**
 * Public fal queue API adapter. The queue response URLs are retained per job
 * so polling and cancellation continue to target the exact request endpoint.
 */
export class FalAdapter implements AIProviderAdapter {
  readonly id = 'fal-ai';
  readonly name = 'fal.ai';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 3;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 9, preservesOrder: true },
    firstFrame: true,
    lastFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  getPromptLimits(request: GenerationRequest) {
    if (request.type !== 'video' || !isMiniMaxH3Model(this.endpointConfigs.video.model)) {
      return {
        maxPromptChars: 12_000,
        maxNegativePromptChars: 4_000,
        negativePrompt: 'native' as const,
      };
    }

    const model = resolveFalEndpointConfig(this.endpointConfigs.video, request).model;
    const endpoint = trimSlashes(model).split('/').at(-1);
    return {
      maxPromptChars: endpoint === 'reference-to-video' ? 7_000 : 2_000,
      negativePrompt: 'unsupported' as const,
    };
  }

  private apiKey = '';
  private readonly endpointConfigs: Record<FalMediaType, FalEndpointConfig> = {
    image: { baseUrl: DEFAULT_QUEUE_URL, model: DEFAULT_IMAGE_MODEL },
    video: { baseUrl: DEFAULT_QUEUE_URL, model: DEFAULT_VIDEO_MODEL },
  };
  private pollIntervalMs = 1_000;
  private maxPollAttempts = 120;
  private readonly jobs = new Map<string, FalJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    const generationType: FalMediaType = options?.generationType === 'video' ? 'video' : 'image';
    const config = this.endpointConfigs[generationType];

    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      config.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      config.model = trimSlashes(options.model);
    }
    this.configurePolling(options);
  }

  async validate(): Promise<boolean> {
    const config = this.endpointConfigs.image;
    try {
      const response = await fetch(this.queueEndpoint(config), { headers: this.authHeaders() });
      // Queue endpoints are normally POST-only, so a 404/405 still confirms
      // that the provider endpoint was reached with the configured credential.
      return response.ok || response.status === 404 || response.status === 405;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: this.name, status, error });
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
    const h3Resolution = firstString(req.params?.['resolution'], req.quality)?.toUpperCase();
    if (req.providerId === 'minimax' || isMiniMaxH3Model(this.endpointConfigs.video.model)) {
      return {
        provider: this.id,
        estimatedCost: (req.duration ?? 5) * (h3Resolution === '768P' ? 0.16 : 0.26),
        currency: 'USD',
        unit: 'per second of output video',
      };
    }
    return {
      provider: this.id,
      estimatedCost: req.type === 'video' ? (req.duration ?? 5) * 0.1 : 0.03,
      currency: 'USD',
      unit: req.type === 'video' ? 'per second of output video' : 'per image',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId) ?? this.deriveJob(jobId, 'image');
    const data = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
    return mapFalStatus(readString(data, 'status'), data);
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId) ?? this.deriveJob(jobId, 'image');
    await this.requestJson(job.cancelUrl, {
      method: 'PUT',
      headers: this.authHeaders(),
    });
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const type = assertMediaType(req.type);
    const config = resolveFalEndpointConfig(this.endpointConfigs[type], req);
    const input = buildFalInput(req, config.model);
    const submission = await this.requestJson(this.queueEndpoint(config), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(input),
    });
    const requestId = readString(submission, 'request_id', 'requestId', 'id');
    if (!requestId) {
      throw this.invalidResponse('fal queue submission did not include a request ID');
    }

    const job: FalJob = {
      requestId,
      type,
      model: config.model,
      statusUrl:
        readString(submission, 'status_url', 'statusUrl') ??
        this.deriveRequestUrl(config, requestId, 'status'),
      responseUrl:
        readString(submission, 'response_url', 'responseUrl') ??
        this.deriveRequestUrl(config, requestId, 'response'),
      cancelUrl:
        readString(submission, 'cancel_url', 'cancelUrl') ??
        this.deriveRequestUrl(config, requestId, 'cancel'),
    };
    this.jobs.set(requestId, job);

    callbacks?.onQueueUpdate?.({
      status: 'queued',
      queuePosition: readNumber(submission, 'queue_position', 'queuePosition'),
      currentStep: 'queued',
      jobId: requestId,
    });

    return this.poll(job, req, callbacks);
  }

  private async poll(
    job: FalJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const data = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
      const rawStatus = readString(data, 'status') ?? '';
      const status = mapFalStatus(rawStatus, data);
      this.emitStatus(callbacks, job.requestId, status, data);

      if (status === JobStatusValue.Completed) {
        const response = await this.requestJson(job.responseUrl, { headers: this.authHeaders() });
        const assetPath = extractFalAsset(response, job.type);
        if (!assetPath) {
          throw this.invalidResponse('fal completed without a media URL');
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: job.requestId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: job.requestId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: {
            requestId: job.requestId,
            status: rawStatus,
            model: job.model,
          },
        };
      }

      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.statusFailure(data, `fal request ${job.requestId} ${rawStatus || 'failed'}`);
      }

      if (attempt + 1 < this.maxPollAttempts) {
        await sleep(this.pollIntervalMs);
      }
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `fal request ${job.requestId} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private emitStatus(
    callbacks: SubscribeCallbacks | undefined,
    jobId: string,
    status: JobStatus,
    data: Record<string, unknown>,
  ): void {
    const queuePosition = readNumber(data, 'queue_position', 'queuePosition', 'position');
    const currentStep = readString(data, 'status', 'message') ?? 'processing';
    for (const log of readLogs(data)) callbacks?.onLog?.(log);

    if (status === JobStatusValue.Queued) {
      callbacks?.onQueueUpdate?.({ status: 'queued', queuePosition, currentStep, jobId });
      return;
    }
    if (status === JobStatusValue.Running) {
      callbacks?.onQueueUpdate?.({ status: 'processing', currentStep, jobId });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: 50,
        currentStep,
        queuePosition,
        jobId,
      });
    }
  }

  private deriveJob(jobId: string, type: FalMediaType): FalJob {
    const config = this.endpointConfigs[type];
    return {
      requestId: jobId,
      type,
      model: config.model,
      statusUrl: this.deriveRequestUrl(config, jobId, 'status'),
      responseUrl: this.deriveRequestUrl(config, jobId, 'response'),
      cancelUrl: this.deriveRequestUrl(config, jobId, 'cancel'),
    };
  }

  private queueEndpoint(config: FalEndpointConfig): string {
    return `${trimTrailingSlash(config.baseUrl)}/${trimSlashes(config.model)}`;
  }

  private deriveRequestUrl(
    config: FalEndpointConfig,
    requestId: string,
    operation: 'status' | 'response' | 'cancel',
  ): string {
    const requestUrl = `${this.queueEndpoint(config)}/requests/${encodeURIComponent(requestId)}`;
    return operation === 'response' ? requestUrl : `${requestUrl}/${operation}`;
  }

  private configurePolling(options: AdapterConfigureOptions | undefined): void {
    if (typeof options?.pollIntervalMs === 'number' && Number.isFinite(options.pollIntervalMs)) {
      this.pollIntervalMs = Math.max(0, Math.floor(options.pollIntervalMs));
    }
    if (typeof options?.maxPollAttempts === 'number' && Number.isFinite(options.maxPollAttempts)) {
      this.maxPollAttempts = Math.max(1, Math.floor(options.maxPollAttempts));
    }
  }

  private async requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw adapterErrorToLucidError(this.normalizeError(error));
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw adapterErrorToLucidError(this.normalizeError(payload, response.status));
    }
    if (!isRecord(payload)) {
      throw this.invalidResponse('fal returned a non-object response');
    }
    return payload;
  }

  private statusFailure(data: Record<string, unknown>, fallback: string): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError({ ...data, message: readFailureMessage(data) ?? fallback }, 502),
    );
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Key ${this.apiKey}` };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

function buildFalInput(req: GenerationRequest, model: string): Record<string, unknown> {
  if (req.type === 'video' && isMiniMaxH3Model(model)) {
    return buildMiniMaxH3Input(req, model);
  }

  const reference = collectReferences(req);
  const input: Record<string, unknown> = { ...(req.params ?? {}), prompt: req.prompt };
  if (req.negativePrompt) input.negative_prompt = req.negativePrompt;
  if (req.seed != null) input.seed = req.seed;
  if (req.width != null && req.height != null) {
    input.image_size = { width: req.width, height: req.height };
  }
  if (req.type === 'video' && req.duration != null) input.duration = req.duration;
  if (reference.primary) input.image_url = reference.primary;
  return input;
}

function resolveFalEndpointConfig(
  configured: FalEndpointConfig,
  req: GenerationRequest,
): FalEndpointConfig {
  if (req.type !== 'video' || !isMiniMaxH3Model(configured.model)) return { ...configured };

  const hasFrameInput = Boolean(
    normalizeString(req.frameReferenceImages?.first) ||
    normalizeString(req.frameReferenceImages?.last) ||
    normalizeString(req.sourceImagePath),
  );
  const hasReferenceInput =
    nonEmptyStrings(req.referenceImages).length > 0 ||
    readStringArray(req.params, 'reference_image_urls', 'referenceImageUrls').length > 0 ||
    readStringArray(req.params, 'reference_video_urls', 'referenceVideoUrls').length > 0 ||
    readStringArray(req.params, 'reference_audio_urls', 'referenceAudioUrls').length > 0;

  if (hasFrameInput && hasReferenceInput) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'MiniMax H3 on fal cannot combine first/last-frame inputs with reference inputs',
    );
  }

  const endpoint = hasReferenceInput
    ? 'reference-to-video'
    : hasFrameInput
      ? 'image-to-video'
      : 'text-to-video';
  return { ...configured, model: `${MINIMAX_H3_CANONICAL_PREFIX}/${endpoint}` };
}

function buildMiniMaxH3Input(req: GenerationRequest, model: string): Record<string, unknown> {
  const endpoint = trimSlashes(model).split('/').at(-1);
  const duration = req.duration ?? readFiniteNumber(req.params, 'duration') ?? 5;
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'MiniMax H3 on fal requires an integer duration from 5 to 15 seconds',
    );
  }

  const resolution = firstString(req.params?.['resolution'], req.quality)?.toUpperCase() ?? '2K';
  if (resolution !== '768P' && resolution !== '2K') {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'MiniMax H3 on fal supports only 768P or 2K resolution',
    );
  }

  const input: Record<string, unknown> = {
    prompt: req.prompt,
    duration,
    resolution,
  };

  if (endpoint === 'text-to-video') {
    assertPromptLength(req.prompt, 2_000, 'text-to-video');
    input['aspect_ratio'] = resolveMiniMaxH3AspectRatio(req, false) ?? '16:9';
    return input;
  }

  if (endpoint === 'image-to-video') {
    assertPromptLength(req.prompt, 2_000, 'image-to-video');
    const first = resolveFileReference(
      normalizeString(req.frameReferenceImages?.first) ?? normalizeString(req.sourceImagePath),
      'image',
    );
    const last = resolveFileReference(normalizeString(req.frameReferenceImages?.last), 'image');
    if (!first) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'MiniMax H3 image-to-video on fal requires a public URL, data URI, or readable local first-frame image',
      );
    }
    input['image_url'] = first;
    if (last) input['end_image_url'] = last;
    return input;
  }

  assertPromptLength(req.prompt, 7_000, 'reference-to-video');
  const images = orderedUnique([
    ...nonEmptyStrings(req.referenceImages),
    ...readStringArray(req.params, 'reference_image_urls', 'referenceImageUrls'),
  ]).map((value) => assertFileReference(value, 'image'));
  const videos = orderedUnique(
    readStringArray(req.params, 'reference_video_urls', 'referenceVideoUrls'),
  ).map((value) => assertFileReference(value, 'video'));
  const audios = orderedUnique(
    readStringArray(req.params, 'reference_audio_urls', 'referenceAudioUrls'),
  ).map((value) => assertFileReference(value, 'audio'));

  if (images.length > 9 || videos.length > 3 || audios.length > 3) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'MiniMax H3 accepts at most 9 image, 3 video, and 3 audio references',
    );
  }
  if (images.length + videos.length + audios.length > 12) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'MiniMax H3 accepts at most 12 references total',
    );
  }
  if (audios.length > 0 && images.length + videos.length === 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'MiniMax H3 reference audio requires at least one reference image or video',
    );
  }
  if (images.length > 0) input['reference_image_urls'] = images;
  if (videos.length > 0) input['reference_video_urls'] = videos;
  if (audios.length > 0) input['reference_audio_urls'] = audios;
  input['aspect_ratio'] = resolveMiniMaxH3AspectRatio(req, true) ?? 'adaptive';
  return input;
}

function collectReferences(req: GenerationRequest): { primary?: string } {
  const raw = [
    req.frameReferenceImages?.first,
    req.sourceImagePath,
    ...(req.referenceImages ?? []),
  ];
  const provided = raw.some((value) => typeof value === 'string' && value.trim().length > 0);
  const primary = raw.map((value) => resolveFileReference(value, 'image')).find(Boolean);
  if (provided && !primary) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'fal reference images must be public http(s) URLs or image data URIs',
    );
  }
  return { primary };
}

function extractFalAsset(data: Record<string, unknown>, type: FalMediaType): string | undefined {
  if (type === 'video') {
    const video = asRecord(data['video']);
    return firstString(video?.['url'], data['video_url']);
  }
  const images = data['images'];
  if (Array.isArray(images)) {
    return firstString(asRecord(images[0])?.['url']);
  }
  return undefined;
}

function mapFalStatus(status: string | undefined, data: Record<string, unknown>): JobStatus {
  const normalized = status?.trim().toUpperCase() ?? '';
  if (normalized === 'COMPLETED' && readFailureMessage(data)) return JobStatusValue.Failed;
  if (['IN_QUEUE', 'QUEUED', 'PENDING', 'WAITING'].includes(normalized))
    return JobStatusValue.Queued;
  if (['IN_PROGRESS', 'PROCESSING', 'RUNNING'].includes(normalized)) return JobStatusValue.Running;
  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS'].includes(normalized)) return JobStatusValue.Completed;
  if (['FAILED', 'ERROR'].includes(normalized)) return JobStatusValue.Failed;
  if (['CANCELLED', 'CANCELED'].includes(normalized)) return JobStatusValue.Cancelled;
  return JobStatusValue.Running;
}

function readLogs(data: Record<string, unknown>): string[] {
  const logs = data['logs'];
  if (!Array.isArray(logs)) return [];
  return logs
    .map((entry) =>
      typeof entry === 'string' ? entry : readString(asRecord(entry) ?? {}, 'message'),
    )
    .filter((entry): entry is string => Boolean(entry));
}

function readFailureMessage(data: Record<string, unknown>): string | undefined {
  const error = data['error'];
  return firstString(
    error,
    asRecord(error)?.['message'],
    data['error_message'],
    data['message'],
    data['reason'],
  );
}

function assertMediaType(type: GenerationRequest['type']): FalMediaType {
  if (type === 'image' || type === 'video') return type;
  throw new LucidError(ErrorCode.InvalidRequest, `fal does not support ${type} generation`);
}

function resolveFileReference(
  value: unknown,
  mediaType: 'image' | 'video' | 'audio',
): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim();
  if (new RegExp(`^data:${mediaType}/[a-z0-9.+-]+;base64,`, 'i').test(normalized)) {
    return normalized;
  }
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' || url.protocol === 'http:') return normalized;
  } catch {
    // Fall through to local-file materialization.
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) return undefined;
  const mime = mediaMimeType(normalized, mediaType);
  return `data:${mime};base64,${fs.readFileSync(normalized).toString('base64')}`;
}

function assertFileReference(value: string, mediaType: 'image' | 'video' | 'audio'): string {
  const resolved = resolveFileReference(value, mediaType);
  if (resolved) return resolved;
  throw new LucidError(
    ErrorCode.InvalidRequest,
    `MiniMax H3 ${mediaType} references must be public URLs, matching data URIs, or readable local files`,
  );
}

function mediaMimeType(filePath: string, mediaType: 'image' | 'video' | 'audio'): string {
  const extension = path.extname(filePath).toLowerCase();
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
  };
  return known[extension] ?? `${mediaType}/octet-stream`;
}

function resolveMiniMaxH3AspectRatio(
  req: GenerationRequest,
  allowAdaptive: boolean,
): string | undefined {
  const explicit = firstString(req.params?.['aspect_ratio'], req.params?.['ratio']);
  const ratio = explicit ?? aspectRatioFromDimensions(req.width, req.height);
  if (!ratio) return undefined;
  const normalized = ratio.toLowerCase() === 'adaptive' ? 'adaptive' : ratio;
  if (!MINIMAX_H3_RATIOS.has(normalized) || (!allowAdaptive && normalized === 'adaptive')) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `MiniMax H3 aspect ratio ${ratio} is not supported for this generation mode`,
    );
  }
  return normalized;
}

function aspectRatioFromDimensions(
  width: number | undefined,
  height: number | undefined,
): string | undefined {
  if (!width || !height) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  const ratio = `${width / divisor}:${height / divisor}`;
  return MINIMAX_H3_RATIOS.has(ratio) ? ratio : undefined;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) [a, b] = [b, a % b];
  return a || 1;
}

function assertPromptLength(prompt: string, maxLength: number, endpoint: string): void {
  if (!prompt.trim() || prompt.length > maxLength) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `MiniMax H3 ${endpoint} prompt must contain 1–${maxLength} characters`,
    );
  }
}

function readStringArray(params: Record<string, unknown> | undefined, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = params?.[key];
    if (Array.isArray(value)) return nonEmptyStrings(value);
  }
  return [];
}

function readFiniteNumber(
  params: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonEmptyStrings(values: readonly unknown[] | undefined): string[] {
  return (values ?? []).map(normalizeString).filter((value): value is string => Boolean(value));
}

function orderedUnique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isMiniMaxH3Model(model: string): boolean {
  const normalized = trimSlashes(model).toLowerCase();
  return MINIMAX_H3_MODEL_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

function readString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  return firstString(...keys.map((key) => data[key]));
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readNumber(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
