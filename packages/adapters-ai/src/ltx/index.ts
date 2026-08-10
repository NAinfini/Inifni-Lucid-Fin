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

type LtxEndpoint = 'text-to-video' | 'image-to-video';

type LtxJob = {
  id: string;
  endpoint: LtxEndpoint;
  model: string;
  baseUrl: string;
};

type LtxSubmission = {
  endpoint: LtxEndpoint;
  body: Record<string, unknown>;
};

const DEFAULT_BASE_URL = 'https://api.ltx.io';
const DEFAULT_MODEL = 'ltx-2-3-pro';
const DEFAULT_DURATION_SECONDS = 8;
const DEFAULT_RESOLUTION = '1920x1080';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const MAX_POLL_INTERVAL_MS = 60_000;
const MAX_POLL_ATTEMPTS = 120;
const MAX_IMAGE_DATA_URI_BYTES = 7 * 1024 * 1024;
const LTX_RESOLUTIONS = new Set([
  '1920x1080',
  '1080x1920',
  '2560x1440',
  '1440x2560',
  '3840x2160',
  '2160x3840',
]);

/** Official LTX V2 asynchronous text-to-video and image-to-video adapter. */
export class LtxAdapter implements AIProviderAdapter {
  readonly id = 'ltx';
  readonly name = 'LTX';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
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
  private readonly jobs = new Map<string, LtxJob>();

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
    if (!this.apiKey) return false;
    try {
      const response = await fetch(
        this.jobUrl({
          id: 'lucid-credential-probe',
          endpoint: 'text-to-video',
          model: this.model,
          baseUrl: this.baseUrl,
        }),
        { headers: this.authHeaders() },
      );
      // A missing job is expected to return 404. Any non-auth response proves
      // the configured key reached the documented async job endpoint.
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

  estimateCost(_req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: 0,
      currency: 'USD',
      unit: 'provider pricing per generated second',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId) ?? {
      id: jobId,
      endpoint: 'text-to-video' as const,
      model: this.model,
      baseUrl: this.baseUrl,
    };
    const data = await this.requestJson(this.jobUrl(job), { headers: this.authHeaders() });
    return mapLtxStatus(readString(data, 'status'));
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(ErrorCode.InvalidRequest, 'LTX does not document a cancellation endpoint');
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (!this.apiKey) {
      throw new LucidError(ErrorCode.InvalidRequest, 'LTX API key is required');
    }

    const submission = await toLtxSubmission(req, this.model);
    const data = await this.requestJson(`${this.baseUrl}/v2/${submission.endpoint}`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(submission.body),
    });
    const id = readString(data, 'id');
    if (!id) {
      throw this.invalidResponse('LTX generation did not return id');
    }

    const job: LtxJob = {
      id,
      endpoint: submission.endpoint,
      model: this.model,
      baseUrl: this.baseUrl,
    };
    this.jobs.set(id, job);
    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'pending', jobId: id });
    return this.poll(job, req, callbacks);
  }

  private async poll(
    job: LtxJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const data = await this.requestJson(this.jobUrl(job), { headers: this.authHeaders() });
      const rawStatus = readString(data, 'status') ?? '';
      const status = mapLtxStatus(rawStatus);

      if (status === JobStatusValue.Completed) {
        const assetPath = readString(asRecord(data['result']), 'video_url');
        if (!assetPath) {
          throw this.invalidResponse('LTX completed without result.video_url');
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
          metadata: { jobId: job.id, status: rawStatus, model: job.model, endpoint: job.endpoint },
        };
      }
      if (status === JobStatusValue.Failed) {
        callbacks?.onQueueUpdate?.({
          status: 'failed',
          currentStep: rawStatus || 'failed',
          jobId: job.id,
        });
        throw this.statusFailure(data, job.id, rawStatus);
      }

      this.emitStatus(callbacks, job.id, status, rawStatus, attempt);
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `LTX job ${job.id} did not finish after ${this.maxPollAttempts} polling attempts`,
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
      callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: rawStatus || 'pending', jobId });
      return;
    }
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

  private jobUrl(job: LtxJob): string {
    return `${job.baseUrl}/v2/${job.endpoint}/${encodeURIComponent(job.id)}`;
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
      throw this.invalidResponse('LTX returned a non-object response');
    }
    return payload;
  }

  private statusFailure(data: Record<string, unknown>, jobId: string, status: string): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError(
        {
          ...data,
          message: readFailureMessage(data) ?? `LTX job ${jobId} ${status || 'failed'}`,
        },
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

async function toLtxSubmission(req: GenerationRequest, model: string): Promise<LtxSubmission> {
  if (req.type !== 'video') {
    throw new LucidError(ErrorCode.InvalidRequest, `LTX does not support ${req.type} generation`);
  }
  assertNoAudioToVideoInput(req);

  const prompt = req.prompt.trim();
  if (!prompt) throw new LucidError(ErrorCode.InvalidRequest, 'LTX requires a non-empty prompt');
  if (prompt.length > 5_000) {
    throw new LucidError(ErrorCode.InvalidRequest, 'LTX prompt must not exceed 5000 characters');
  }

  const images = await resolveImageInputs(req);
  const endpoint: LtxEndpoint = images.first ? 'image-to-video' : 'text-to-video';
  const body: Record<string, unknown> = {
    prompt,
    model,
    duration: resolveDuration(req),
    resolution: resolveResolution(req),
    ...(req.audio != null ? { generate_audio: req.audio } : {}),
    ...(resolveFps(req) != null ? { fps: resolveFps(req) } : {}),
    ...(resolveCameraMotion(req) ? { camera_motion: resolveCameraMotion(req) } : {}),
  };
  if (images.first) body['image_uri'] = images.first;
  if (images.last) body['last_frame_uri'] = images.last;
  return { endpoint, body };
}

function assertNoAudioToVideoInput(req: GenerationRequest): void {
  const audioInput = readString(req.params, 'audio_uri', 'audioUri', 'audio_path', 'audioPath');
  if (audioInput) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX audio-to-video is not supported because GenerationRequest has no typed audio input contract',
    );
  }
}

async function resolveImageInputs(
  req: GenerationRequest,
): Promise<{ first?: string; last?: string }> {
  const references = nonEmptyStrings(req.referenceImages);
  if (references.length > 1) {
    throw new LucidError(ErrorCode.InvalidRequest, 'LTX accepts at most one reference image');
  }

  const source = nonEmptyString(req.sourceImagePath);
  const explicitFirst = nonEmptyString(req.frameReferenceImages?.first);
  const last = nonEmptyString(req.frameReferenceImages?.last);
  if (source && explicitFirst) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX cannot combine sourceImagePath with an explicit first frame',
    );
  }
  if ((source || explicitFirst) && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX cannot combine a source or first frame with generic reference images',
    );
  }

  const first = await materializeImage(source ?? explicitFirst ?? references[0]);
  const materializedLast = await materializeImage(last);
  if (materializedLast && !first) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX requires a first frame when a last frame is supplied',
    );
  }
  return { first, last: materializedLast };
}

async function materializeImage(value: string | undefined): Promise<string | undefined> {
  if (!value?.trim()) return undefined;
  const input = value.trim();
  if (input.startsWith('data:')) {
    assertImageDataUri(input);
    return input;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    const url = new URL(input);
    if (url.protocol !== 'https:') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'LTX image URLs must use HTTPS or be supported image data URIs',
      );
    }
    return input;
  }

  const mimeType = imageMimeType(input);
  if (!mimeType) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX local image inputs must be PNG, JPEG, or WEBP files',
    );
  }
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(input);
  } catch (error) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `LTX source image could not be read: ${error instanceof Error ? error.message : input}`,
    );
  }
  const dataUri = `data:${mimeType};base64,${bytes.toString('base64')}`;
  assertImageDataUri(dataUri);
  return dataUri;
}

function assertImageDataUri(value: string): void {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX image data URIs must contain base64 PNG, JPEG, or WEBP data',
    );
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_IMAGE_DATA_URI_BYTES) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX image data URIs must not exceed the documented 7 MB encoded limit',
    );
  }
}

function resolveDuration(req: GenerationRequest): number {
  const duration = req.duration ?? numberParam(req, 'duration') ?? DEFAULT_DURATION_SECONDS;
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new LucidError(ErrorCode.InvalidRequest, 'LTX duration must be a positive integer');
  }
  return duration;
}

function resolveResolution(req: GenerationRequest): string {
  const configured = stringParam(req.params, 'resolution');
  if (configured) {
    if (!LTX_RESOLUTIONS.has(configured)) {
      throw new LucidError(ErrorCode.InvalidRequest, 'LTX resolution is not supported by LTX-2.3');
    }
    return configured;
  }
  if (!req.width && !req.height) return DEFAULT_RESOLUTION;
  if (!req.width || !req.height || !Number.isInteger(req.width) || !Number.isInteger(req.height)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'LTX width and height must be positive integers together',
    );
  }
  const resolution = `${req.width}x${req.height}`;
  if (!LTX_RESOLUTIONS.has(resolution)) {
    throw new LucidError(ErrorCode.InvalidRequest, 'LTX dimensions are not supported by LTX-2.3');
  }
  return resolution;
}

function resolveFps(req: GenerationRequest): number | undefined {
  const fps = numberParam(req, 'fps');
  if (fps == null) return undefined;
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new LucidError(ErrorCode.InvalidRequest, 'LTX fps must be a positive integer');
  }
  return fps;
}

function resolveCameraMotion(req: GenerationRequest): string | undefined {
  return stringParam(req.params, 'camera_motion', 'cameraMotion');
}

function mapLtxStatus(status: string | undefined): JobStatus {
  switch (status?.trim().toLowerCase()) {
    case 'pending':
      return JobStatusValue.Queued;
    case 'processing':
      return JobStatusValue.Running;
    case 'completed':
      return JobStatusValue.Completed;
    case 'failed':
    default:
      return JobStatusValue.Failed;
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function stringParam(
  values: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!values) return undefined;
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function numberParam(req: GenerationRequest, key: string): number | undefined {
  const value = req.params?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function nonEmptyStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function imageMimeType(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function readString(
  data: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!data) return undefined;
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readFailureMessage(data: Record<string, unknown>): string | undefined {
  const error = asRecord(data['error']);
  return readString(data, 'message', 'detail') ?? readString(error, 'message', 'detail', 'type');
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
