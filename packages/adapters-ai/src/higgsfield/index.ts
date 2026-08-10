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

type HiggsfieldMediaType = 'image' | 'video';

type HiggsfieldEndpointConfig = {
  baseUrl: string;
  model: string;
};

type HiggsfieldJob = {
  requestId: string;
  type: HiggsfieldMediaType;
  model: string;
  statusUrl: string;
  cancelUrl: string;
};

const DEFAULT_BASE_URL = 'https://platform.higgsfield.ai';
const DEFAULT_IMAGE_MODEL = 'bytedance/seedream/v4/text-to-image';
const DEFAULT_VIDEO_MODEL = '/v1/image2video/dop';
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 150;

/**
 * Higgsfield's documented V2 request lifecycle.  The configured model is the
 * request path, while the body is sent directly (rather than wrapped in an
 * SDK-specific field), matching the official V2 client.
 */
export class HiggsfieldAdapter implements AIProviderAdapter {
  readonly id = 'higgsfield';
  readonly name = 'Higgsfield';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 1, preservesOrder: true },
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  private credentials = '';
  private readonly endpointConfigs: Record<HiggsfieldMediaType, HiggsfieldEndpointConfig> = {
    image: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_IMAGE_MODEL },
    video: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_VIDEO_MODEL },
  };
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly jobs = new Map<string, HiggsfieldJob>();

  configure(credentials: string, options?: AdapterConfigureOptions): void {
    this.credentials = credentials.trim();
    const type: HiggsfieldMediaType = options?.generationType === 'video' ? 'video' : 'image';
    const config = this.endpointConfigs[type];

    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      config.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      config.model = normalizeEndpoint(options.model);
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
    if (!isCredentialsFormat(this.credentials)) return false;

    // Higgsfield documents request-status polling as a GET endpoint. A probe
    // for an intentionally nonexistent ID is non-mutating; only explicit auth
    // rejection makes a syntactically valid credential invalid here.
    try {
      const response = await fetch(
        `${this.endpointConfigs.image.baseUrl}/requests/lucid-credential-probe/status`,
        { headers: this.authHeaders() },
      );
      return response.status !== 401 && response.status !== 403;
    } catch {
      // Connectivity failures do not prove the credential is invalid.
      return true;
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
      estimatedCost: req.type === 'video' ? (req.duration ?? 5) * 0.05 : 0.04,
      currency: 'USD',
      unit: req.type === 'video' ? 'per video second (estimate)' : 'per image (estimate)',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId) ?? this.deriveJob(jobId, 'image');
    const payload = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
    return mapHiggsfieldStatus(readString(payload, 'status'));
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId) ?? this.deriveJob(jobId, 'image');
    await this.requestJson(job.cancelUrl, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    this.assertCredentials();
    const type = assertMediaType(req.type);
    const config = this.endpointConfigs[type];
    const input = type === 'image' ? buildImageInput(req) : await buildVideoInput(req);

    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const payload = await this.requestJson(this.endpointUrl(config), {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(input),
    });
    const requestId = readString(payload, 'request_id', 'requestId', 'id');
    if (!requestId) {
      throw this.invalidResponse('Higgsfield submission did not include request_id');
    }

    const job: HiggsfieldJob = {
      requestId,
      type,
      model: config.model,
      statusUrl:
        readString(payload, 'status_url', 'statusUrl') ?? this.statusUrl(config.baseUrl, requestId),
      cancelUrl:
        readString(payload, 'cancel_url', 'cancelUrl') ?? this.cancelUrl(config.baseUrl, requestId),
    };
    this.jobs.set(requestId, job);
    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: requestId });

    if (mapHiggsfieldStatus(readString(payload, 'status')) === JobStatusValue.Completed) {
      return this.completedResult(payload, job, req, callbacks);
    }
    return this.poll(job, req, callbacks);
  }

  private async poll(
    job: HiggsfieldJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const payload = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
      const rawStatus = readString(payload, 'status');
      const status = mapHiggsfieldStatus(rawStatus);

      if (status === JobStatusValue.Completed) {
        return this.completedResult(payload, job, req, callbacks);
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.statusFailure(payload, job.requestId, rawStatus);
      }

      this.emitStatus(callbacks, job.requestId, rawStatus, status, attempt);
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Higgsfield request did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private completedResult(
    payload: Record<string, unknown>,
    job: HiggsfieldJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): GenerationResult {
    const assetPath = extractAssetUrl(payload, job.type);
    if (!assetPath) {
      throw this.invalidResponse(`Higgsfield ${job.type} request completed without a media URL`);
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
        status: readString(payload, 'status') ?? 'completed',
        model: job.model,
      },
    };
  }

  private emitStatus(
    callbacks: SubscribeCallbacks | undefined,
    jobId: string,
    rawStatus: string | undefined,
    status: JobStatus,
    attempt: number,
  ): void {
    const currentStep = rawStatus ?? 'in_progress';
    callbacks?.onQueueUpdate?.({
      status: status === JobStatusValue.Queued ? 'queued' : 'processing',
      currentStep,
      jobId,
    });
    callbacks?.onProgress?.({
      type: 'progress',
      percentage: Math.min(95, 10 + attempt),
      currentStep,
      jobId,
    });
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
    if (!isRecord(payload)) throw this.invalidResponse('Higgsfield returned a non-object response');
    return payload;
  }

  private statusFailure(
    payload: Record<string, unknown>,
    requestId: string,
    rawStatus: string | undefined,
  ): LucidError {
    const message =
      readString(payload, 'message', 'detail', 'error') ??
      `Higgsfield request ${requestId} ${rawStatus ?? 'failed'}`;
    if (rawStatus?.toLowerCase() === 'nsfw') {
      return new LucidError(ErrorCode.ContentModeration, message);
    }
    if (rawStatus?.toLowerCase() === 'cancelled') {
      return new LucidError(ErrorCode.Cancelled, message);
    }
    return adapterErrorToLucidError(this.normalizeError({ ...payload, message }, 502));
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private assertCredentials(): void {
    if (!isCredentialsFormat(this.credentials)) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'Higgsfield credentials must use the KEY_ID:KEY_SECRET format',
      );
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Key ${this.credentials}`,
      'User-Agent': 'higgsfield-server-js/2.0',
    };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }

  private endpointUrl(config: HiggsfieldEndpointConfig): string {
    return `${config.baseUrl}/${normalizeEndpoint(config.model)}`;
  }

  private statusUrl(baseUrl: string, jobId: string): string {
    return `${baseUrl}/requests/${encodeURIComponent(jobId)}/status`;
  }

  private cancelUrl(baseUrl: string, jobId: string): string {
    return `${baseUrl}/requests/${encodeURIComponent(jobId)}/cancel`;
  }

  private deriveJob(jobId: string, type: HiggsfieldMediaType): HiggsfieldJob {
    const config = this.endpointConfigs[type];
    return {
      requestId: jobId,
      type,
      model: config.model,
      statusUrl: this.statusUrl(config.baseUrl, jobId),
      cancelUrl: this.cancelUrl(config.baseUrl, jobId),
    };
  }
}

function assertMediaType(type: GenerationRequest['type']): HiggsfieldMediaType {
  if (type === 'image' || type === 'video') return type;
  throw new LucidError(ErrorCode.InvalidRequest, `Higgsfield does not support ${type} generation`);
}

function buildImageInput(req: GenerationRequest): Record<string, unknown> {
  if (
    req.sourceImagePath ||
    req.frameReferenceImages?.first ||
    req.frameReferenceImages?.last ||
    nonEmptyStrings(req.referenceImages).length > 0
  ) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'The configured Higgsfield image model supports text-to-image only',
    );
  }

  const prompt = assertPrompt(req.prompt);
  const resolution = stringParam(req, 'resolution') ?? stringParam(req, 'image_resolution');
  const aspectRatio =
    stringParam(req, 'aspect_ratio', 'aspectRatio') ?? aspectRatioFromSize(req.width, req.height);
  const cameraFixed = booleanParam(req, 'camera_fixed', 'cameraFixed');
  return {
    prompt,
    ...(resolution ? { resolution } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(cameraFixed != null ? { camera_fixed: cameraFixed } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
  };
}

async function buildVideoInput(req: GenerationRequest): Promise<Record<string, unknown>> {
  if (req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Higgsfield DoP does not document a last-frame input',
    );
  }
  const source = resolveVideoImage(req);
  if (!source) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Higgsfield DoP image-to-video requires sourceImagePath or one reference image',
    );
  }
  const imageUrl = await materializeImage(source);
  return {
    model: stringParam(req, 'dop_model', 'dopModel') ?? 'dop-turbo',
    prompt: assertPrompt(req.prompt),
    input_images: [{ type: 'image_url', image_url: imageUrl }],
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(booleanParam(req, 'enhance_prompt', 'enhancePrompt') != null
      ? { enhance_prompt: booleanParam(req, 'enhance_prompt', 'enhancePrompt') }
      : {}),
  };
}

function resolveVideoImage(req: GenerationRequest): string | undefined {
  const source = nonEmptyString(req.sourceImagePath);
  const firstFrame = nonEmptyString(req.frameReferenceImages?.first);
  const references = nonEmptyStrings(req.referenceImages);
  if (source && firstFrame) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Higgsfield DoP cannot combine sourceImagePath with a first-frame image',
    );
  }
  if ((source || firstFrame) && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Higgsfield DoP accepts one source image and cannot combine it with generic references',
    );
  }
  if (references.length > 1) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Higgsfield DoP supports one input image per request',
    );
  }
  return source ?? firstFrame ?? references[0];
}

async function materializeImage(value: string): Promise<string> {
  if (/^(?:https?:|data:)/i.test(value)) return value;
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(value);
  } catch (error) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Higgsfield source image could not be read: ${error instanceof Error ? error.message : value}`,
    );
  }
  return `data:${imageMimeType(value)};base64,${bytes.toString('base64')}`;
}

function extractAssetUrl(
  payload: Record<string, unknown>,
  type: HiggsfieldMediaType,
): string | undefined {
  if (type === 'video') return readString(asRecord(payload['video']), 'url');
  const images = Array.isArray(payload['images']) ? payload['images'] : [];
  return readString(asRecord(images[0]), 'url');
}

function mapHiggsfieldStatus(status: string | undefined): JobStatus {
  switch (status?.toLowerCase()) {
    case 'queued':
      return JobStatusValue.Queued;
    case 'completed':
      return JobStatusValue.Completed;
    case 'failed':
    case 'nsfw':
      return JobStatusValue.Failed;
    case 'cancelled':
    case 'canceled':
      return JobStatusValue.Cancelled;
    case 'in_progress':
    default:
      return JobStatusValue.Running;
  }
}

function isCredentialsFormat(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 2 && parts.every((part) => part.trim().length > 0 && !/\s/.test(part));
}

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '');
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function assertPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw new LucidError(ErrorCode.InvalidRequest, 'Higgsfield prompt is required');
  return trimmed;
}

function aspectRatioFromSize(
  width: number | undefined,
  height: number | undefined,
): string | undefined {
  if (!width || !height) return undefined;
  const ratio = width / height;
  const supported = [
    ['21:9', 21 / 9],
    ['16:9', 16 / 9],
    ['4:3', 4 / 3],
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['9:16', 9 / 16],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function stringParam(req: GenerationRequest, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = req.params?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function booleanParam(req: GenerationRequest, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = req.params?.[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function nonEmptyStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
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
    case '.avif':
      return 'image/avif';
    default:
      return 'image/png';
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
