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

type KreaMediaType = 'image' | 'video';

type KreaEndpointConfig = {
  baseUrl: string;
  model: string;
};

type KreaJob = {
  id: string;
  type: KreaMediaType;
  model: string;
  baseUrl: string;
};

const DEFAULT_BASE_URL = 'https://api.krea.ai';
const DEFAULT_IMAGE_MODEL = 'image/krea/krea-2/medium';
const DEFAULT_VIDEO_MODEL = 'video/minimax/hailuo-2.3';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const MAX_POLL_INTERVAL_MS = 60_000;
const MAX_POLL_ATTEMPTS = 120;

const KREA_QUEUED_STATUSES = new Set(['BACKLOGGED', 'QUEUED', 'SCHEDULED']);
const KREA_RUNNING_STATUSES = new Set([
  'PROCESSING',
  'SAMPLING',
  'INTERMEDIATE-COMPLETE',
  'INTERMEDIATE_COMPLETE',
]);

/**
 * Krea's public API exposes model paths below a shared generate endpoint.
 * Configuration is retained independently for image and video so selecting a
 * video model cannot silently replace the configured Krea 2 image model.
 */
export class KreaAdapter implements AIProviderAdapter {
  readonly id = 'krea';
  readonly name = 'Krea';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 3;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 1, preservesOrder: true },
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

  private apiKey = '';
  private activeType: KreaMediaType = 'image';
  private readonly endpointConfigs: Record<KreaMediaType, KreaEndpointConfig> = {
    image: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_IMAGE_MODEL },
    video: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_VIDEO_MODEL },
  };
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly jobs = new Map<string, KreaJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    const type: KreaMediaType = options?.generationType === 'video' ? 'video' : 'image';
    this.activeType = type;
    const config = this.endpointConfigs[type];

    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      config.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      config.model = trimSlashes(options.model);
    }
    this.pollIntervalMs = boundedNumber(
      options?.['pollIntervalMs'],
      this.pollIntervalMs,
      0,
      MAX_POLL_INTERVAL_MS,
    );
    this.maxPollAttempts = boundedNumber(
      options?.['maxPollAttempts'],
      this.maxPollAttempts,
      1,
      MAX_POLL_ATTEMPTS,
    );
  }

  async validate(): Promise<boolean> {
    const config = this.endpointConfigs[this.activeType];
    try {
      const response = await fetch(`${config.baseUrl}/jobs/validation-probe`, {
        headers: this.authHeaders(),
      });
      // A nonexistent job proves that the Krea endpoint was reached. Only an
      // explicit auth failure makes the configured key invalid.
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
    return {
      provider: this.id,
      estimatedCost: 0,
      currency: 'USD',
      unit: req.type === 'video' ? 'provider pricing per video' : 'provider pricing per image',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId) ?? this.deriveJob(jobId, this.activeType);
    const data = await this.requestJson(this.jobUrl(job), { headers: this.authHeaders() });
    return mapKreaStatus(readString(data, 'status'));
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId) ?? this.deriveJob(jobId, this.activeType);
    await this.requestJson(this.jobUrl(job), {
      method: 'DELETE',
      headers: this.authHeaders(),
    });
    this.jobs.delete(jobId);
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const type = assertKreaMediaType(req.type);
    const config = this.endpointConfigs[type];
    const body = await toKreaRequest(req);
    const submission = await this.requestJson(this.generateUrl(config), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(body),
    });
    const jobId = readString(submission, 'job_id', 'jobId');
    if (!jobId) {
      throw this.invalidResponse('Krea generation did not return job_id');
    }

    const job: KreaJob = {
      id: jobId,
      type,
      model: config.model,
      baseUrl: config.baseUrl,
    };
    this.jobs.set(jobId, job);
    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId });
    return this.poll(job, req, callbacks);
  }

  private async poll(
    job: KreaJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const data = await this.requestJson(this.jobUrl(job), { headers: this.authHeaders() });
      const rawStatus = readString(data, 'status') ?? '';
      const status = mapKreaStatus(rawStatus);
      this.emitStatus(callbacks, job.id, status, rawStatus, attempt);

      if (status === JobStatusValue.Completed) {
        const assetPath = extractKreaAsset(data);
        if (!assetPath) {
          throw this.invalidResponse('Krea completed without result.urls[0]');
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: job.id,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: job.id,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { jobId: job.id, status: rawStatus, model: job.model },
        };
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.statusFailure(data, job.id, rawStatus);
      }

      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Krea job ${job.id} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private emitStatus(
    callbacks: SubscribeCallbacks | undefined,
    jobId: string,
    status: JobStatus,
    rawStatus: string,
    attempt: number,
  ): void {
    if (status === JobStatusValue.Queued) {
      callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: rawStatus || 'queued', jobId });
      return;
    }
    if (status === JobStatusValue.Running) {
      callbacks?.onQueueUpdate?.({
        status: 'processing',
        currentStep: rawStatus || 'processing',
        jobId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt * 5),
        currentStep: rawStatus || 'processing',
        jobId,
      });
    }
  }

  private deriveJob(jobId: string, type: KreaMediaType): KreaJob {
    const config = this.endpointConfigs[type];
    return { id: jobId, type, model: config.model, baseUrl: config.baseUrl };
  }

  private generateUrl(config: KreaEndpointConfig): string {
    return `${config.baseUrl}/generate/${trimSlashes(config.model)}`;
  }

  private jobUrl(job: KreaJob): string {
    return `${job.baseUrl}/jobs/${encodeURIComponent(job.id)}`;
  }

  private async requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw adapterErrorToLucidError(this.normalizeError(error));
    }

    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw adapterErrorToLucidError(this.normalizeError(payload, response.status));
    }
    if (!isRecord(payload)) {
      throw this.invalidResponse('Krea returned a non-object response');
    }
    return payload;
  }

  private statusFailure(data: Record<string, unknown>, jobId: string, status: string): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError(
        { ...data, message: readFailureMessage(data) ?? `Krea job ${jobId} ${status || 'failed'}` },
        502,
      ),
    );
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

async function toKreaRequest(req: GenerationRequest): Promise<Record<string, unknown>> {
  const type = assertKreaMediaType(req.type);
  const prompt = req.prompt.trim();
  if (!prompt) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Krea requires a non-empty prompt');
  }

  return type === 'image' ? toKreaImageRequest(req, prompt) : toKreaVideoRequest(req, prompt);
}

async function toKreaImageRequest(
  req: GenerationRequest,
  prompt: string,
): Promise<Record<string, unknown>> {
  if (req.frameReferenceImages?.first || req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea image generation does not accept video frames',
    );
  }
  const image = await resolveSingleImageInput(req.sourceImagePath, req.referenceImages);
  const body: Record<string, unknown> = {
    ...(req.params ?? {}),
    prompt,
    ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
    ...(image ? { image_url: image } : {}),
    ...(resolveAspectRatio(req) ? { aspect_ratio: resolveAspectRatio(req) } : {}),
    ...(req.seed != null ? { seed: assertInteger(req.seed, 'seed') } : {}),
  };
  return body;
}

async function toKreaVideoRequest(
  req: GenerationRequest,
  prompt: string,
): Promise<Record<string, unknown>> {
  const genericReferences = normalizeReferences(req.referenceImages);
  if (genericReferences.length > 1) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Krea video accepts at most one source image');
  }
  if (req.sourceImagePath && req.frameReferenceImages?.first) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea video cannot combine sourceImagePath with an explicit first frame',
    );
  }
  if ((req.sourceImagePath || req.frameReferenceImages?.first) && genericReferences.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea video cannot combine a source or first frame with generic reference images',
    );
  }

  const startImage = await toImageReference(
    firstNonEmpty(req.frameReferenceImages?.first, req.sourceImagePath, genericReferences[0]),
  );
  const endImage = await toImageReference(req.frameReferenceImages?.last);
  if (endImage && !startImage) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea video requires a source or first frame when an end frame is supplied',
    );
  }

  const duration = req.duration ?? numberParam(req, 'duration');
  if (duration != null && (!Number.isInteger(duration) || duration <= 0)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea video duration must be a positive integer',
    );
  }

  const body: Record<string, unknown> = {
    ...(req.params ?? {}),
    prompt,
    ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
    ...(duration != null ? { duration } : {}),
    ...(resolveAspectRatio(req) ? { aspect_ratio: resolveAspectRatio(req) } : {}),
    ...(stringParam(req, 'resolution') ? { resolution: stringParam(req, 'resolution') } : {}),
    ...(startImage ? { start_image: startImage } : {}),
    ...(endImage ? { end_image: endImage } : {}),
    ...(req.seed != null ? { seed: assertInteger(req.seed, 'seed') } : {}),
  };
  return body;
}

async function resolveSingleImageInput(
  sourceImagePath: string | undefined,
  referenceImages: string[] | undefined,
): Promise<string | undefined> {
  const references = normalizeReferences(referenceImages);
  if (references.length > 1) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Krea 2 accepts at most one reference image');
  }
  if (sourceImagePath && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea 2 cannot combine sourceImagePath with a separate reference image',
    );
  }
  return toImageReference(firstNonEmpty(sourceImagePath, references[0]));
}

async function toImageReference(value: string | undefined): Promise<string | undefined> {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  if (normalized.startsWith('data:image/')) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' || url.protocol === 'http:') return normalized;
  } catch {
    // Treat non-URL inputs as local files that need materialization.
  }
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea image inputs must be public URLs, image data URIs, or readable local files',
    );
  }
  return `data:${imageMimeType(normalized)};base64,${fs.readFileSync(normalized).toString('base64')}`;
}

function resolveAspectRatio(req: GenerationRequest): string | undefined {
  const fromParams = stringParam(req, 'aspect_ratio');
  if (fromParams) return fromParams;
  if (!req.width && !req.height) return undefined;
  if (!req.width || !req.height || req.width <= 0 || req.height <= 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Krea width and height must be positive together',
    );
  }
  const target = req.width / req.height;
  const supported = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
    ['1:1', 1],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - target) < Math.abs(best[1] - target) ? candidate : best,
  )[0];
}

function extractKreaAsset(data: Record<string, unknown>): string | undefined {
  const result = asRecord(data['result']);
  const urls = result?.['urls'];
  return Array.isArray(urls) ? firstNonEmpty(urls[0]) : undefined;
}

function mapKreaStatus(status: string | undefined): JobStatus {
  const normalized = status?.trim().toUpperCase() ?? '';
  if (KREA_QUEUED_STATUSES.has(normalized)) return JobStatusValue.Queued;
  if (KREA_RUNNING_STATUSES.has(normalized)) return JobStatusValue.Running;
  if (normalized === 'COMPLETED') return JobStatusValue.Completed;
  if (normalized === 'FAILED') return JobStatusValue.Failed;
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return JobStatusValue.Cancelled;
  return JobStatusValue.Running;
}

function assertKreaMediaType(type: GenerationRequest['type']): KreaMediaType {
  if (type === 'image' || type === 'video') return type;
  throw new LucidError(ErrorCode.InvalidRequest, `Krea does not support ${type} generation`);
}

function normalizeReferences(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  const value = req.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberParam(req: GenerationRequest, key: string): number | undefined {
  const value = req.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assertInteger(value: number, field: string): number {
  if (!Number.isInteger(value)) {
    throw new LucidError(ErrorCode.InvalidRequest, `Krea ${field} must be an integer`);
  }
  return value;
}

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function readString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  return firstNonEmpty(...keys.map((key) => data[key]));
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readFailureMessage(data: Record<string, unknown>): string | undefined {
  const error = asRecord(data['error']);
  return firstNonEmpty(data['message'], data['detail'], error?.['message'], error?.['detail']);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
