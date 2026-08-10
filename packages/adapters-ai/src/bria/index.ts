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

type BriaJob = {
  requestId: string;
  statusUrl: string;
};

const DEFAULT_BASE_URL = 'https://engine.prod.bria-api.com/v2';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const MAX_POLL_INTERVAL_MS = 60_000;
const MAX_POLL_ATTEMPTS = 120;
const VALID_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
]);

/** Official Bria V2 asynchronous image-generation adapter. */
export class BriaAdapter implements AIProviderAdapter {
  readonly id = 'bria';
  readonly name = 'Bria';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 3;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 1, preservesOrder: true },
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private baseUrl = DEFAULT_BASE_URL;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly jobs = new Map<string, BriaJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = trimTrailingSlash(options.baseUrl);
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
    try {
      const response = await fetch(`${this.baseUrl}/status/00000000-0000-0000-0000-000000000000`, {
        headers: this.authHeaders(),
      });
      // A probe id is expected to be missing. Every non-auth HTTP response
      // still proves that the configured endpoint and token route are usable.
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
      unit: 'provider pricing per image',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId) ?? {
      requestId: jobId,
      statusUrl: this.defaultStatusUrl(jobId),
    };
    const data = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
    return mapBriaStatus(readString(data, 'status'));
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(ErrorCode.InvalidRequest, 'Bria does not provide a cancellation endpoint');
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'image') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Bria does not support ${req.type} generation`,
      );
    }

    const submission = await this.requestJson(`${this.baseUrl}/image/generate`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(await toBriaRequest(req)),
    });
    const requestId = readString(submission, 'request_id', 'requestId');
    if (!requestId) {
      throw this.invalidResponse('Bria image generation did not return request_id');
    }

    const job: BriaJob = {
      requestId,
      statusUrl: resolveStatusUrl(
        readString(submission, 'status_url', 'statusUrl') ?? this.defaultStatusUrl(requestId),
        this.baseUrl,
      ),
    };
    this.jobs.set(requestId, job);
    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: requestId });
    return this.poll(job, req, callbacks);
  }

  private async poll(
    job: BriaJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const data = await this.requestJson(job.statusUrl, { headers: this.authHeaders() });
      const rawStatus = readString(data, 'status') ?? '';
      const status = mapBriaStatus(rawStatus);

      if (status === JobStatusValue.Completed) {
        const assetPath = extractBriaImage(data);
        if (!assetPath) {
          throw this.invalidResponse('Bria completed without result.image_url');
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
            ...(readResultMetadata(data) ?? {}),
          },
        };
      }
      if (status === JobStatusValue.Failed) {
        callbacks?.onQueueUpdate?.({
          status: 'failed',
          currentStep: rawStatus || 'ERROR',
          jobId: job.requestId,
        });
        throw this.statusFailure(data, job.requestId, rawStatus);
      }

      callbacks?.onQueueUpdate?.({
        status: 'processing',
        currentStep: rawStatus || 'IN_PROGRESS',
        jobId: job.requestId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt * 5),
        currentStep: rawStatus || 'IN_PROGRESS',
        jobId: job.requestId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Bria request ${job.requestId} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private defaultStatusUrl(requestId: string): string {
    return `${this.baseUrl}/status/${encodeURIComponent(requestId)}`;
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
      throw this.invalidResponse('Bria returned a non-object response');
    }
    return payload;
  }

  private statusFailure(
    data: Record<string, unknown>,
    requestId: string,
    status: string,
  ): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError(
        {
          ...data,
          message: readFailureMessage(data) ?? `Bria request ${requestId} ${status || 'failed'}`,
        },
        502,
      ),
    );
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private authHeaders(): Record<string, string> {
    return { api_token: this.apiKey };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

async function toBriaRequest(req: GenerationRequest): Promise<Record<string, unknown>> {
  const prompt = req.prompt.trim();
  const image = await resolveBriaImageInput(req.sourceImagePath, req.referenceImages);
  if (!prompt && !image) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Bria requires a prompt or one source image');
  }

  const resolution = resolveResolution(req);
  const outputType = resolveOutputType(req);
  const aspectRatio = resolveAspectRatio(req);

  return {
    ...(req.params ?? {}),
    ...(prompt ? { prompt } : {}),
    ...(image ? { images: [image] } : {}),
    ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    resolution,
    ...(req.seed != null ? { seed: assertInteger(req.seed, 'seed') } : {}),
    output_type: outputType,
    sync: false,
  };
}

async function resolveBriaImageInput(
  sourceImagePath: string | undefined,
  referenceImages: string[] | undefined,
): Promise<string | undefined> {
  const references = [
    ...new Set((referenceImages ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  if (references.length > 1) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Bria accepts at most one reference image');
  }
  if (sourceImagePath && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Bria cannot combine sourceImagePath with a separate reference image',
    );
  }
  const value = sourceImagePath?.trim() || references[0];
  if (!value) return undefined;
  if (value.startsWith('data:image/')) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return value;
  } catch {
    // Non-URL input is a local file that needs a data URI for Bria.
  }
  if (!fs.existsSync(value) || !fs.statSync(value).isFile()) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Bria image inputs must be public URLs, image data URIs, or readable local files',
    );
  }
  return `data:${imageMimeType(value)};base64,${fs.readFileSync(value).toString('base64')}`;
}

function resolveResolution(req: GenerationRequest): '1MP' | '4MP' {
  const raw = stringParam(req, 'resolution') ?? req.quality?.trim() ?? '1MP';
  const resolution = raw.toUpperCase();
  if (resolution !== '1MP' && resolution !== '4MP') {
    throw new LucidError(ErrorCode.InvalidRequest, 'Bria resolution must be 1MP or 4MP');
  }
  return resolution;
}

function resolveOutputType(req: GenerationRequest): 'png' | 'jpeg' {
  const raw = stringParam(req, 'output_type') ?? stringParam(req, 'format') ?? 'png';
  const outputType = raw.toLowerCase();
  if (outputType !== 'png' && outputType !== 'jpeg') {
    throw new LucidError(ErrorCode.InvalidRequest, 'Bria output_type must be png or jpeg');
  }
  return outputType;
}

function resolveAspectRatio(req: GenerationRequest): string | undefined {
  const fromParams = stringParam(req, 'aspect_ratio');
  if (fromParams) {
    if (!VALID_ASPECT_RATIOS.has(fromParams)) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Unsupported Bria aspect ratio: ${fromParams}`,
      );
    }
    return fromParams;
  }
  if (!req.width && !req.height) return undefined;
  if (!req.width || !req.height || req.width <= 0 || req.height <= 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Bria width and height must be positive together',
    );
  }
  const target = req.width / req.height;
  const supported = [
    ['1:1', 1],
    ['2:3', 2 / 3],
    ['3:2', 3 / 2],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - target) < Math.abs(best[1] - target) ? candidate : best,
  )[0];
}

function mapBriaStatus(status: string | undefined): JobStatus {
  switch (status?.trim().toUpperCase()) {
    case 'COMPLETED':
      return JobStatusValue.Completed;
    case 'ERROR':
    case 'UNKNOWN':
      return JobStatusValue.Failed;
    case 'IN_PROGRESS':
    default:
      return JobStatusValue.Running;
  }
}

function extractBriaImage(data: Record<string, unknown>): string | undefined {
  return firstNonEmpty(asRecord(data['result'])?.['image_url']);
}

function readResultMetadata(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const result = asRecord(data['result']);
  if (!result) return undefined;
  const metadata: Record<string, unknown> = {};
  for (const key of ['seed', 'prompt', 'refined_prompt', 'structured_prompt']) {
    if (result[key] != null) metadata[key] = result[key];
  }
  return metadata;
}

function resolveStatusUrl(value: string, baseUrl: string): string {
  const url = new URL(value, `${trimTrailingSlash(baseUrl)}/`).toString();
  validateProviderUrl(url);
  return url;
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  const value = req.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function assertInteger(value: number, field: string): number {
  if (!Number.isInteger(value)) {
    throw new LucidError(ErrorCode.InvalidRequest, `Bria ${field} must be an integer`);
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
    default:
      return 'image/png';
  }
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
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
