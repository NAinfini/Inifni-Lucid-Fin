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

type SegmindMediaType = 'image' | 'video';

type EndpointConfig = {
  baseUrl: string;
  model: string;
};

type SegmindJob = {
  mediaType: SegmindMediaType;
  model: string;
  responseUrl: string;
  statusUrl: string;
};

const DEFAULT_BASE_URL = 'https://api.segmind.com';
const DEFAULT_IMAGE_MODEL = 'seedream-5-pro';
const DEFAULT_VIDEO_MODEL = 'seedance-2.0';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 450;

/** Unified Segmind v2 async image/video gateway adapter. */
export class SegmindAdapter implements AIProviderAdapter {
  readonly id = 'segmind';
  readonly name = 'Segmind';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 5;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 10, preservesOrder: true },
    firstFrame: true,
    lastFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private readonly configs: Record<SegmindMediaType, EndpointConfig> = {
    image: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_IMAGE_MODEL },
    video: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_VIDEO_MODEL },
  };
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly jobs = new Map<string, SegmindJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey.trim();
    const mediaType: SegmindMediaType = options?.generationType === 'video' ? 'video' : 'image';
    const config = this.configs[mediaType];
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      config.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      config.model = normalizeModel(options.model);
    }
    this.pollIntervalMs = boundedInteger(
      options?.['pollIntervalMs'],
      DEFAULT_POLL_INTERVAL_MS,
      0,
      60_000,
    );
    this.maxPollAttempts = boundedInteger(
      options?.['maxPollAttempts'],
      DEFAULT_MAX_POLL_ATTEMPTS,
      1,
      1_000,
    );
  }

  async validate(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(
        `${this.configs.image.baseUrl}/v2/requests/00000000-0000-0000-0000-000000000000/status`,
        { headers: this.authHeaders() },
      );
      return response.status !== 401 && response.status !== 403;
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
    if (req.type === 'video') {
      const resolution = stringParam(req, 'resolution') ?? req.quality ?? '720p';
      const rate =
        resolution.toLowerCase() === '480p'
          ? 0.0703
          : resolution.toLowerCase() === '1080p'
            ? 0.34
            : resolution.toLowerCase() === '4k'
              ? 1.3721
              : 0.1512;
      return {
        provider: this.id,
        estimatedCost: rate * (req.duration ?? 5),
        currency: 'USD',
        unit: 'per second of output video',
      };
    }
    return {
      provider: this.id,
      estimatedCost: 0.1,
      currency: 'USD',
      unit: 'per image (model-dependent estimate)',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId);
    const baseUrl = job ? this.configs[job.mediaType].baseUrl : this.configs.image.baseUrl;
    const statusUrl =
      job?.statusUrl ?? `${baseUrl}/v2/requests/${encodeURIComponent(jobId)}/status`;
    const status = await this.requestJson(statusUrl, { headers: this.authHeaders() });
    return mapSegmindStatus(firstString(status['status']));
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Segmind does not document cancellation for v2 inference requests',
    );
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'image' && req.type !== 'video') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Segmind does not support ${req.type} generation`,
      );
    }
    const config = this.configs[req.type];
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const submission = await this.requestJson(`${config.baseUrl}/v2/${encodeModel(config.model)}`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(
        req.type === 'image' ? buildSegmindImageInput(req) : buildSegmindVideoInput(req),
      ),
    });
    const requestId = firstString(submission['request_id'], submission['id']);
    if (!requestId) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        'Segmind submission did not include a request_id',
      );
    }
    const job: SegmindJob = {
      mediaType: req.type,
      model: config.model,
      statusUrl:
        firstString(submission['status_url']) ??
        `${config.baseUrl}/v2/requests/${encodeURIComponent(requestId)}/status`,
      responseUrl:
        firstString(submission['response_url']) ??
        `${config.baseUrl}/v2/requests/${encodeURIComponent(requestId)}`,
    };
    this.jobs.set(requestId, job);
    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: requestId });
    return this.poll(req, requestId, job, callbacks);
  }

  private async poll(
    req: GenerationRequest,
    requestId: string,
    job: SegmindJob,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const statusBody = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
      const status = mapSegmindStatus(firstString(statusBody['status']));
      if (status === JobStatusValue.Completed) {
        const result = await this.requestJson(job.responseUrl, { headers: this.authHeaders() });
        const assetPath = extractAssetPath(result);
        if (!assetPath) {
          throw new LucidError(
            ErrorCode.ServiceUnavailable,
            'Segmind completed without a usable media URL',
          );
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: requestId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: requestId,
        });
        const actualCost = nestedNumber(result, 'metrics', 'cost');
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: actualCost ?? this.estimateCost(req).estimatedCost,
          metadata: { requestId, model: job.model, metrics: asRecord(result['metrics']) },
        };
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw new LucidError(
          ErrorCode.ServiceUnavailable,
          firstString(statusBody['detail'], statusBody['error']) ?? `Segmind request ${status}`,
        );
      }
      callbacks?.onQueueUpdate?.({
        status: status === JobStatusValue.Queued ? 'queued' : 'processing',
        currentStep: firstString(statusBody['status']) ?? 'processing',
        jobId: requestId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + Math.floor(attempt / 5)),
        currentStep: firstString(statusBody['status']) ?? 'processing',
        jobId: requestId,
      });
      await sleep(this.pollIntervalMs);
    }
    throw new LucidError(
      ErrorCode.Timeout,
      `Segmind request ${requestId} did not finish within the polling limit`,
    );
  }

  private async requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetch(url, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw adapterErrorToLucidError(this.normalizeError(body, response.status));
    }
    return asRecord(body);
  }

  private authHeaders(): Record<string, string> {
    return { 'x-api-key': this.apiKey };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

function buildSegmindImageInput(req: GenerationRequest): Record<string, unknown> {
  const references = resolveImages(req);
  if (references.length > 10) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Segmind Seedream supports at most 10 images');
  }
  const size = stringParam(req, 'size') ?? resolutionTier(req.width, req.height, ['1K', '2K']);
  const outputFormat =
    stringParam(req, 'output_format') ?? stringParam(req, 'outputFormat') ?? 'jpeg';
  return {
    prompt: req.prompt,
    image_input: references.map((reference) => materializeImage(reference)),
    aspect_ratio: stringParam(req, 'aspect_ratio') ?? aspectRatio(req.width, req.height),
    size,
    output_format: outputFormat,
    watermark: booleanParam(req, 'watermark') ?? false,
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...copyExtraParams(req, [
      'prompt',
      'image_input',
      'aspect_ratio',
      'size',
      'output_format',
      'outputFormat',
      'watermark',
      'seed',
    ]),
  };
}

function buildSegmindVideoInput(req: GenerationRequest): Record<string, unknown> {
  const firstFrame = firstString(req.frameReferenceImages?.first, req.sourceImagePath);
  const lastFrame = firstString(req.frameReferenceImages?.last);
  const references = (req.referenceImages ?? []).filter((value) => value.trim());
  if (lastFrame && !firstFrame) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Segmind last frame requires a first frame');
  }
  if (firstFrame && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Segmind first/last frames cannot be combined with generic reference images',
    );
  }
  if (references.length > 9) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Segmind Seedance supports at most 9 images');
  }
  const duration = Math.floor(req.duration ?? 5);
  if (duration < 4 || duration > 15) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Segmind Seedance duration must be 4–15 seconds',
    );
  }
  return {
    prompt: req.prompt,
    duration,
    resolution: stringParam(req, 'resolution') ?? req.quality ?? '720p',
    aspect_ratio: stringParam(req, 'aspect_ratio') ?? aspectRatio(req.width, req.height),
    generate_audio: req.audio ?? booleanParam(req, 'generate_audio') ?? false,
    ...(firstFrame ? { first_frame_url: materializeImage(firstFrame) } : {}),
    ...(lastFrame ? { last_frame_url: materializeImage(lastFrame) } : {}),
    ...(references.length > 0
      ? { reference_images: references.map((reference) => materializeImage(reference)) }
      : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...copyExtraParams(req, [
      'prompt',
      'duration',
      'resolution',
      'aspect_ratio',
      'generate_audio',
      'reference_images',
      'first_frame_url',
      'last_frame_url',
      'seed',
    ]),
  };
}

function resolveImages(req: GenerationRequest): string[] {
  const images = [req.sourceImagePath, ...(req.referenceImages ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(images)];
}

function copyExtraParams(req: GenerationRequest, excluded: string[]): Record<string, unknown> {
  const exclusions = new Set(excluded);
  return Object.fromEntries(
    Object.entries(req.params ?? {}).filter(
      ([key, value]) => !exclusions.has(key) && value != null,
    ),
  );
}

function extractAssetPath(body: Record<string, unknown>): string | undefined {
  const direct = firstString(body['output'], body['url'], body['video_url'], body['image_url']);
  if (direct) return direct;
  for (const key of ['output', 'outputs', 'generated', 'urls', 'images', 'videos']) {
    const values = body[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const url = typeof value === 'string' ? value.trim() : firstString(asRecord(value)['url']);
      if (url) return url;
    }
  }
  const result = asRecord(body['result']);
  return Object.keys(result).length > 0 ? extractAssetPath(result) : undefined;
}

function mapSegmindStatus(status: string | undefined): JobStatus {
  switch (status?.trim().toUpperCase()) {
    case 'COMPLETED':
      return JobStatusValue.Completed;
    case 'FAILED':
      return JobStatusValue.Failed;
    case 'CANCELLED':
    case 'CANCELED':
      return JobStatusValue.Cancelled;
    case 'QUEUED':
      return JobStatusValue.Queued;
    default:
      return JobStatusValue.Running;
  }
}

function materializeImage(value: string): string {
  const normalized = value.trim();
  if (/^(?:https?:|data:image\/)/i.test(normalized)) return normalized;
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Segmind image reference not found: ${normalized}`,
    );
  }
  const extension = path.extname(normalized).toLowerCase();
  const mime =
    extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(normalized).toString('base64')}`;
}

function aspectRatio(width?: number, height?: number): string {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  const supported = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['3:2', 3 / 2],
    ['2:3', 2 / 3],
    ['21:9', 21 / 9],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function resolutionTier(
  width: number | undefined,
  height: number | undefined,
  tiers: readonly string[],
): string {
  const max = Math.max(width ?? 0, height ?? 0);
  if (max > 1024 && tiers.includes('2K')) return '2K';
  return tiers[0] ?? '1K';
}

function nestedNumber(
  body: Record<string, unknown>,
  parent: string,
  child: string,
): number | undefined {
  const value = asRecord(body[parent])[child];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  return firstString(req.params?.[key]);
}

function booleanParam(req: GenerationRequest, key: string): boolean | undefined {
  const value = req.params?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeModel(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/^v2\//, '');
}

function encodeModel(value: string): string {
  return normalizeModel(value)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
