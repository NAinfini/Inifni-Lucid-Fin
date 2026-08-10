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

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
const DEFAULT_IMAGE_MODEL = 'Kwai-Kolors/Kolors';
const DEFAULT_VIDEO_MODEL = 'Wan-AI/Wan2.2-T2V-A14B';

abstract class SiliconFlowBase {
  protected apiKey = '';
  protected baseUrl = DEFAULT_BASE_URL;
  protected pollIntervalMs = 2_000;
  protected maxPollAttempts = 120;

  protected constructor(protected model: string) {}

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.model = options.model.trim();
    }
    if (typeof options?.pollIntervalMs === 'number' && Number.isFinite(options.pollIntervalMs)) {
      this.pollIntervalMs = Math.max(0, Math.floor(options.pollIntervalMs));
    }
    if (typeof options?.maxPollAttempts === 'number' && Number.isFinite(options.maxPollAttempts)) {
      this.maxPollAttempts = Math.max(1, Math.floor(options.maxPollAttempts));
    }
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, { headers: this.authHeaders() });
      return response.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: 'SiliconFlow', status, error });
  }

  protected async requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
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
    if (!isRecord(payload))
      throw this.invalidResponse('SiliconFlow returned a non-object response');
    return payload;
  }

  protected invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  protected statusFailure(data: Record<string, unknown>, fallback: string): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError({ ...data, message: readFailureMessage(data) ?? fallback }, 502),
    );
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  protected jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

/** Public SiliconFlow image generation API adapter. */
export class SiliconFlowImageAdapter extends SiliconFlowBase implements AIProviderAdapter {
  readonly id = 'siliconflow-image';
  readonly name = 'SiliconFlow Image';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 3;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 3, preservesOrder: true },
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  constructor() {
    super(DEFAULT_IMAGE_MODEL);
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    if (req.type !== 'image') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `SiliconFlow image does not support ${req.type}`,
      );
    }
    const data = await this.requestJson(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(buildSiliconImageInput(req, this.model)),
    });
    const assetPath = extractSiliconImageAsset(data);
    if (!assetPath) {
      throw this.invalidResponse(
        'SiliconFlow image response did not include an image URL or base64 asset',
      );
    }
    return {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: { model: this.model, seed: data['seed'] },
    };
  }

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    callbacks.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });
    const result = await this.generate(req);
    callbacks.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return result;
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.02, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    // The public image endpoint is synchronous: an asset only returns once completed.
    return JobStatusValue.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'SiliconFlow image generation is synchronous and cannot be cancelled',
    );
  }
}

/** Public SiliconFlow asynchronous video generation API adapter. */
export class SiliconFlowVideoAdapter extends SiliconFlowBase implements AIProviderAdapter {
  readonly id = 'siliconflow-video';
  readonly name = 'SiliconFlow Video';
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

  constructor() {
    super(DEFAULT_VIDEO_MODEL);
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
      estimatedCost: (req.duration ?? 5) * 0.04,
      currency: 'USD',
      unit: 'per second of output video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const data = await this.requestJson(`${this.baseUrl}/video/status`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({ requestId: jobId }),
    });
    return mapSiliconVideoStatus(readString(data, 'status'));
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'SiliconFlow does not expose public video cancellation for submitted requests',
    );
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'video') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `SiliconFlow video does not support ${req.type}`,
      );
    }
    const submission = await this.requestJson(`${this.baseUrl}/video/submit`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(buildSiliconVideoInput(req, this.model)),
    });
    const requestId = readString(submission, 'requestId', 'request_id', 'id');
    if (!requestId)
      throw this.invalidResponse('SiliconFlow video submission did not include requestId');

    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: requestId });
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const data = await this.requestJson(`${this.baseUrl}/video/status`, {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({ requestId }),
      });
      const rawStatus = readString(data, 'status') ?? '';
      const status = mapSiliconVideoStatus(rawStatus);
      this.emitStatus(callbacks, requestId, status, data);

      if (status === JobStatusValue.Completed) {
        const assetPath = firstString(
          asRecord(asRecord(data['results'])?.['videos'])?.['url'],
          firstVideoUrl(data),
        );
        if (!assetPath) {
          throw this.invalidResponse(
            'SiliconFlow completed video response did not include results.videos[0].url',
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
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { requestId, status: rawStatus, model: this.model },
        };
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.statusFailure(
          data,
          `SiliconFlow video request ${requestId} ${rawStatus || 'failed'}`,
        );
      }
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `SiliconFlow video request ${requestId} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private emitStatus(
    callbacks: SubscribeCallbacks | undefined,
    requestId: string,
    status: JobStatus,
    data: Record<string, unknown>,
  ): void {
    const currentStep = readString(data, 'status', 'reason') ?? 'processing';
    if (status === JobStatusValue.Queued) {
      callbacks?.onQueueUpdate?.({ status: 'queued', currentStep, jobId: requestId });
      return;
    }
    if (status === JobStatusValue.Running) {
      callbacks?.onQueueUpdate?.({ status: 'processing', currentStep, jobId: requestId });
      callbacks?.onProgress?.({ type: 'progress', percentage: 50, currentStep, jobId: requestId });
    }
  }
}

function buildSiliconImageInput(req: GenerationRequest, model: string): Record<string, unknown> {
  const references = collectReferences(req, 3);
  const body: Record<string, unknown> = { ...(req.params ?? {}), model, prompt: req.prompt };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.seed != null) body.seed = req.seed;
  body.image_size = `${req.width ?? 1024}x${req.height ?? 1024}`;
  if (references[0]) body.image = references[0];
  if (references[1]) body.image2 = references[1];
  if (references[2]) body.image3 = references[2];
  return body;
}

function buildSiliconVideoInput(req: GenerationRequest, model: string): Record<string, unknown> {
  const references = collectReferences(req, 1);
  const body: Record<string, unknown> = { ...(req.params ?? {}), model, prompt: req.prompt };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.seed != null) body.seed = req.seed;
  body.image_size = `${req.width ?? 1280}x${req.height ?? 720}`;
  if (references[0]) body.image = references[0];
  return body;
}

function collectReferences(req: GenerationRequest, maxReferences: number): string[] {
  const candidates = [
    req.frameReferenceImages?.first,
    req.sourceImagePath,
    ...(req.referenceImages ?? []),
  ];
  const references = unique(candidates.map(publicReference).filter(isDefined));
  if (references.length > maxReferences) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `SiliconFlow accepts at most ${maxReferences} public reference image${maxReferences === 1 ? '' : 's'}`,
    );
  }
  return references;
}

function publicReference(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' || url.protocol === 'http:') return normalized;
  } catch {
    // Fall through to an explicit validation error below.
  }
  throw new LucidError(
    ErrorCode.InvalidRequest,
    'SiliconFlow reference images must be public http(s) URLs or image data URIs',
  );
}

function extractSiliconImageAsset(data: Record<string, unknown>): string | undefined {
  const image = Array.isArray(data['images']) ? asRecord(data['images'][0]) : undefined;
  const entry = Array.isArray(data['data']) ? asRecord(data['data'][0]) : undefined;
  const url = firstString(image?.['url'], entry?.['url'], data['url']);
  if (url) return url;
  const base64 = firstString(image?.['b64_json'], entry?.['b64_json'], data['b64_json']);
  if (!base64) return undefined;
  if (base64.startsWith('data:')) return base64;
  const format =
    firstString(image?.['output_format'], entry?.['output_format'], data['output_format']) ?? 'png';
  const mimeType =
    format.toLowerCase() === 'jpeg' || format.toLowerCase() === 'jpg' ? 'image/jpeg' : 'image/png';
  return `data:${mimeType};base64,${base64}`;
}

function firstVideoUrl(data: Record<string, unknown>): string | undefined {
  const videos = asRecord(data['results'])?.['videos'];
  if (!Array.isArray(videos)) return undefined;
  return firstString(asRecord(videos[0])?.['url']);
}

function mapSiliconVideoStatus(status: string | undefined): JobStatus {
  const normalized = status?.trim().toLowerCase() ?? '';
  if (['inqueue', 'in_queue', 'queued', 'pending'].includes(normalized))
    return JobStatusValue.Queued;
  if (['inprogress', 'in_progress', 'processing', 'running'].includes(normalized)) {
    return JobStatusValue.Running;
  }
  if (['succeed', 'succeeded', 'success', 'completed'].includes(normalized)) {
    return JobStatusValue.Completed;
  }
  if (['failed', 'error'].includes(normalized)) return JobStatusValue.Failed;
  if (['cancelled', 'canceled'].includes(normalized)) return JobStatusValue.Cancelled;
  return JobStatusValue.Running;
}

function readFailureMessage(data: Record<string, unknown>): string | undefined {
  const error = data['error'];
  return firstString(error, asRecord(error)?.['message'], data['reason'], data['message']);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(isDefined))];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
