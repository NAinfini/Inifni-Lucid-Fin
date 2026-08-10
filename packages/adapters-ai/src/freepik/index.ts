import fs from 'node:fs';
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

type FreepikMediaType = 'image' | 'video';

type FreepikEndpointConfig = {
  baseUrl: string;
  model: string;
};

type FreepikJob = {
  taskId: string;
  type: FreepikMediaType;
  endpoint: string;
  model: string;
  baseUrl: string;
};

const DEFAULT_BASE_URL = 'https://api.freepik.com/v1/ai';
const DEFAULT_IMAGE_ENDPOINT = 'text-to-image/flux-2-pro';
const DEFAULT_VIDEO_TEXT_ENDPOINT = 'text-to-video/runway-4-5';
const DEFAULT_VIDEO_IMAGE_ENDPOINT = 'image-to-video/veo-3-1-fast';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const MAX_POLL_INTERVAL_MS = 60_000;
const MAX_POLL_ATTEMPTS = 120;

/**
 * Freepik's public AI API creates asynchronous tasks on model-specific paths.
 * The actual endpoint is stored with each task so it can always be polled
 * through the same model route that accepted the request.
 */
export class FreepikAdapter implements AIProviderAdapter {
  readonly id = 'freepik';
  readonly name = 'Freepik';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 3;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 4, preservesOrder: true },
    firstFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private activeType: FreepikMediaType = 'image';
  private readonly endpointConfigs: Record<FreepikMediaType, FreepikEndpointConfig> = {
    image: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_IMAGE_ENDPOINT },
    video: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_VIDEO_TEXT_ENDPOINT },
  };
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly jobs = new Map<string, FreepikJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    const type: FreepikMediaType = options?.generationType === 'video' ? 'video' : 'image';
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
      const response = await fetch(this.endpointUrl(config.baseUrl, config.model), {
        headers: this.authHeaders(),
      });
      // Several Freepik model routes are POST-only. A non-auth response still
      // confirms the configured endpoint and key route can be reached.
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
    const payload = await this.requestJson(this.taskUrl(job), { headers: this.authHeaders() });
    return mapFreepikStatus(readTaskData(payload).status);
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik does not provide a cancellation endpoint',
    );
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const type = assertFreepikMediaType(req.type);
    const config = this.endpointConfigs[type];
    const endpoint = resolveEndpoint(config.model, req);
    const payload = await this.requestJson(this.endpointUrl(config.baseUrl, endpoint), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(await toFreepikRequest(req, endpoint)),
    });
    const submitted = readTaskData(payload);
    if (!submitted.taskId) {
      throw this.invalidResponse('Freepik generation did not return data.task_id');
    }

    const job: FreepikJob = {
      taskId: submitted.taskId,
      type,
      endpoint,
      model: endpoint,
      baseUrl: config.baseUrl,
    };
    this.jobs.set(job.taskId, job);
    callbacks?.onQueueUpdate?.({
      status: 'queued',
      currentStep: submitted.status ?? 'CREATED',
      jobId: job.taskId,
    });
    return this.poll(job, req, callbacks);
  }

  private async poll(
    job: FreepikJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const payload = await this.requestJson(this.taskUrl(job), { headers: this.authHeaders() });
      const data = readTaskData(payload);
      const status = mapFreepikStatus(data.status);
      this.emitStatus(callbacks, job.taskId, status, data.status, attempt);

      if (status === JobStatusValue.Completed) {
        const assetPath = data.generated?.[0];
        if (!assetPath) {
          throw this.invalidResponse('Freepik completed without data.generated[0]');
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: job.taskId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: job.taskId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: {
            taskId: job.taskId,
            status: data.status,
            model: job.model,
            endpoint: job.endpoint,
          },
        };
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.statusFailure(payload, job.taskId, data.status);
      }

      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Freepik task ${job.taskId} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private emitStatus(
    callbacks: SubscribeCallbacks | undefined,
    jobId: string,
    status: JobStatus,
    rawStatus: string | undefined,
    attempt: number,
  ): void {
    if (status === JobStatusValue.Queued) {
      callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: rawStatus ?? 'CREATED', jobId });
      return;
    }
    if (status === JobStatusValue.Running) {
      callbacks?.onQueueUpdate?.({
        status: 'processing',
        currentStep: rawStatus ?? 'IN_PROGRESS',
        jobId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt * 5),
        currentStep: rawStatus ?? 'IN_PROGRESS',
        jobId,
      });
    }
  }

  private deriveJob(jobId: string, type: FreepikMediaType): FreepikJob {
    const config = this.endpointConfigs[type];
    return {
      taskId: jobId,
      type,
      endpoint: config.model,
      model: config.model,
      baseUrl: config.baseUrl,
    };
  }

  private endpointUrl(baseUrl: string, endpoint: string): string {
    return `${trimTrailingSlash(baseUrl)}/${trimSlashes(endpoint)}`;
  }

  private taskUrl(job: FreepikJob): string {
    return `${this.endpointUrl(job.baseUrl, job.endpoint)}/${encodeURIComponent(job.taskId)}`;
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
      throw this.invalidResponse('Freepik returned a non-object response');
    }
    return payload;
  }

  private statusFailure(
    payload: Record<string, unknown>,
    taskId: string,
    status: string | undefined,
  ): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError(
        {
          ...payload,
          message: readFailureMessage(payload) ?? `Freepik task ${taskId} ${status ?? 'failed'}`,
        },
        502,
      ),
    );
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private authHeaders(): Record<string, string> {
    return { 'x-freepik-api-key': this.apiKey };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

async function toFreepikRequest(
  req: GenerationRequest,
  endpoint: string,
): Promise<Record<string, unknown>> {
  const prompt = req.prompt.trim();
  if (!prompt) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Freepik requires a non-empty prompt');
  }

  if (req.type === 'image') return toFreepikImageRequest(req, prompt);
  if (req.type === 'video') {
    return endpoint.startsWith('image-to-video/')
      ? toFreepikImageVideoRequest(req, prompt)
      : toFreepikTextVideoRequest(req, prompt);
  }
  throw new LucidError(ErrorCode.InvalidRequest, `Freepik does not support ${req.type} generation`);
}

async function toFreepikImageRequest(
  req: GenerationRequest,
  prompt: string,
): Promise<Record<string, unknown>> {
  if (req.frameReferenceImages?.first || req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik image generation does not accept video frames',
    );
  }
  const images = await collectImageInputs(req.sourceImagePath, req.referenceImages, 4, false);
  const body: Record<string, unknown> = {
    ...(req.params ?? {}),
    prompt,
    ...(req.seed != null ? { seed: assertSeed(req.seed) } : {}),
    ...(req.width && req.height ? { width: req.width, height: req.height } : {}),
  };
  for (const [index, image] of images.entries()) {
    body[index === 0 ? 'input_image' : `input_image_${index + 1}`] = image;
  }
  return body;
}

async function toFreepikTextVideoRequest(
  req: GenerationRequest,
  prompt: string,
): Promise<Record<string, unknown>> {
  if (hasVideoImageInput(req)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik text-to-video cannot accept source or reference images; choose an image-to-video model',
    );
  }
  return toFreepikVideoParams(req, prompt);
}

async function toFreepikImageVideoRequest(
  req: GenerationRequest,
  prompt: string,
): Promise<Record<string, unknown>> {
  if (req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik Veo image-to-video does not support a separate last frame',
    );
  }
  const genericReferences = normalizeReferences(req.referenceImages);
  if (genericReferences.length > 1) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik image-to-video accepts one source image',
    );
  }
  if (req.sourceImagePath && req.frameReferenceImages?.first) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik image-to-video cannot combine sourceImagePath with an explicit first frame',
    );
  }
  if ((req.sourceImagePath || req.frameReferenceImages?.first) && genericReferences.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik image-to-video cannot combine a source or first frame with generic reference images',
    );
  }
  const image = await toFreepikImageInput(
    firstString(req.frameReferenceImages?.first, req.sourceImagePath, genericReferences[0]),
    true,
  );
  if (!image) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik image-to-video requires a source image',
    );
  }
  return { ...toFreepikVideoParams(req, prompt), image };
}

function toFreepikVideoParams(req: GenerationRequest, prompt: string): Record<string, unknown> {
  const duration = req.duration ?? numberParam(req, 'duration');
  if (duration != null && (!Number.isInteger(duration) || duration <= 0)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik video duration must be a positive integer',
    );
  }
  const resolution = stringParam(req, 'resolution') ?? supportedVideoQuality(req.quality);
  const aspectRatio = stringParam(req, 'aspect_ratio') ?? videoAspectRatio(req.width, req.height);
  return {
    ...(req.params ?? {}),
    prompt,
    ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
    ...(duration != null ? { duration } : {}),
    ...(resolution ? { resolution } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(req.audio != null ? { generate_audio: req.audio } : {}),
    ...(req.seed != null ? { seed: assertSeed(req.seed) } : {}),
  };
}

function resolveEndpoint(model: string, req: GenerationRequest): string {
  const normalized = trimSlashes(model);
  if (req.type !== 'video') return normalized;

  const hasImage = hasVideoImageInput(req);
  if (!hasImage) {
    if (normalized.startsWith('image-to-video/')) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'The selected Freepik image-to-video model requires a source image',
      );
    }
    return normalized;
  }
  if (normalized === DEFAULT_VIDEO_TEXT_ENDPOINT) return DEFAULT_VIDEO_IMAGE_ENDPOINT;
  if (normalized.startsWith('image-to-video/')) return normalized;
  throw new LucidError(
    ErrorCode.InvalidRequest,
    'The selected Freepik text-to-video model cannot accept an image; configure an image-to-video model',
  );
}

function hasVideoImageInput(req: GenerationRequest): boolean {
  return Boolean(
    req.sourceImagePath?.trim() ||
    req.frameReferenceImages?.first?.trim() ||
    req.frameReferenceImages?.last?.trim() ||
    normalizeReferences(req.referenceImages).length > 0,
  );
}

async function collectImageInputs(
  sourceImagePath: string | undefined,
  referenceImages: string[] | undefined,
  maxImages: number,
  allowPublicUrls: boolean,
): Promise<string[]> {
  const candidates = [sourceImagePath, ...normalizeReferences(referenceImages)].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  const unique = [...new Set(candidates.map((value) => value.trim()))];
  if (unique.length > maxImages) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Freepik accepts at most ${maxImages} input images`,
    );
  }
  return Promise.all(unique.map((value) => toFreepikImageInput(value, allowPublicUrls))).then(
    (images) => images.filter((image): image is string => Boolean(image)),
  );
}

async function toFreepikImageInput(
  value: string | undefined,
  allowPublicUrls: boolean,
): Promise<string | undefined> {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  const dataUri = normalized.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  if (dataUri?.[1]) return dataUri[1];
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' && allowPublicUrls) return normalized;
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'This Freepik endpoint accepts base64 image data rather than a public URL',
      );
    }
  } catch (error) {
    if (error instanceof LucidError) throw error;
    // Continue with local file or raw base64 detection.
  }
  if (fs.existsSync(normalized) && fs.statSync(normalized).isFile()) {
    return fs.readFileSync(normalized).toString('base64');
  }
  if (isBase64(normalized)) return normalized;
  throw new LucidError(
    ErrorCode.InvalidRequest,
    'Freepik image inputs must be HTTPS URLs where supported, base64 data, or readable local files',
  );
}

function mapFreepikStatus(status: string | undefined): JobStatus {
  switch (status?.trim().toUpperCase()) {
    case 'COMPLETED':
    case 'SUCCESS':
    case 'SUCCEEDED':
      return JobStatusValue.Completed;
    case 'FAILED':
    case 'ERROR':
    case 'REJECTED':
      return JobStatusValue.Failed;
    case 'CANCELLED':
    case 'CANCELED':
      return JobStatusValue.Cancelled;
    case 'CREATED':
    case 'QUEUED':
    case 'PENDING':
      return JobStatusValue.Queued;
    default:
      return JobStatusValue.Running;
  }
}

function readTaskData(payload: Record<string, unknown>): {
  taskId?: string;
  status?: string;
  generated?: string[];
} {
  const data = asRecord(payload['data']);
  if (!data) {
    throw adapterErrorToLucidError(
      parseAdapterError({
        provider: 'Freepik',
        status: 502,
        error: { message: 'Freepik response did not include a data object' },
      }),
    );
  }
  const generated = Array.isArray(data['generated'])
    ? data['generated'].filter(
        (value): value is string => typeof value === 'string' && Boolean(value.trim()),
      )
    : undefined;
  return {
    taskId: firstString(data['task_id'], data['taskId']),
    status: firstString(data['status']),
    generated,
  };
}

function assertFreepikMediaType(type: GenerationRequest['type']): FreepikMediaType {
  if (type === 'image' || type === 'video') return type;
  throw new LucidError(ErrorCode.InvalidRequest, `Freepik does not support ${type} generation`);
}

function normalizeReferences(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function videoAspectRatio(
  width: number | undefined,
  height: number | undefined,
): '16:9' | '9:16' | undefined {
  if (!width && !height) return undefined;
  if (!width || !height || width <= 0 || height <= 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik width and height must be positive together',
    );
  }
  return width / height >= 1 ? '16:9' : '9:16';
}

function supportedVideoQuality(quality: string | undefined): string | undefined {
  const normalized = quality?.trim().toLowerCase();
  return normalized === '720p' || normalized === '1080p' || normalized === '4k'
    ? normalized
    : undefined;
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  const value = req.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberParam(req: GenerationRequest, key: string): number | undefined {
  const value = req.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assertSeed(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Freepik seed must be an integer from 0 through 4294967295',
    );
  }
  return value;
}

function isBase64(value: string): boolean {
  return value.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readFailureMessage(payload: Record<string, unknown>): string | undefined {
  const data = asRecord(payload['data']);
  const error = asRecord(payload['error']) ?? asRecord(data?.['error']);
  return firstString(
    payload['message'],
    payload['detail'],
    data?.['message'],
    error?.['message'],
    error?.['detail'],
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
