import type {
  AIProviderAdapter,
  AdapterConfigureOptions,
  AdapterError,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { ErrorCode, JobStatus as JobStatusEnum, LucidError } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { validateProviderUrl } from '../url-policy.js';

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_IMAGE_MODEL = 'glm-image';
const DEFAULT_VIDEO_MODEL = 'cogvideox-3';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;

abstract class ZhipuMediaAdapterBase {
  protected apiKey = '';
  protected baseUrl = DEFAULT_BASE_URL;
  protected pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  protected maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;

  protected configureBase(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = trimTrailingSlash(options.baseUrl);
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
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: 'Zhipu AI', status, error });
  }

  protected async toRequestError(res: Response): Promise<LucidError> {
    const body = await res.json().catch(() => ({}));
    return adapterErrorToLucidError(this.normalizeError(body, res.status));
  }
}

export class ZhipuImageAdapter extends ZhipuMediaAdapterBase implements AIProviderAdapter {
  readonly id = 'zhipu-image';
  readonly name = 'Zhipu GLM Image';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 3;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private model = DEFAULT_IMAGE_MODEL;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.configureBase(apiKey, options);
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.model = options.model.trim();
    }
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
    return { provider: this.id, estimatedCost: 0.04, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatusEnum.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // The synchronous Zhipu image endpoint has no cancellation operation.
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'image') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Zhipu image does not support ${req.type} generation`,
      );
    }
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: req.prompt,
        size: `${req.width ?? 1280}x${req.height ?? 1280}`,
      }),
    });
    if (!res.ok) throw await this.toRequestError(res);

    const data = asRecord(await res.json());
    const output = asRecordArray(data['data'])[0] ?? {};
    const assetPath = imageAssetPath(output);
    if (!assetPath) throw new Error('Zhipu image generation completed without image data');

    const result: GenerationResult = {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: { model: this.model },
    };
    callbacks?.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks?.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return result;
  }
}

export class ZhipuVideoAdapter extends ZhipuMediaAdapterBase implements AIProviderAdapter {
  readonly id = 'zhipu-video';
  readonly name = 'Zhipu CogVideoX';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 2, preservesOrder: true },
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

  private model = DEFAULT_VIDEO_MODEL;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.configureBase(apiKey, options);
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.model = options.model.trim();
    }
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
      estimatedCost: (req.duration ?? 5) * 0.1,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const task = await this.getAsyncResult(jobId);
    return mapVideoStatus(firstString(task['task_status']) ?? '');
  }

  async cancel(_jobId: string): Promise<void> {
    // The public CogVideo asynchronous API does not document cancellation.
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'video') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Zhipu video does not support ${req.type} generation`,
      );
    }
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const res = await fetch(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toZhipuVideoRequest(req, this.model)),
    });
    if (!res.ok) throw await this.toRequestError(res);

    const submitted = asRecord(await res.json());
    const taskId = firstString(submitted['id']);
    if (!taskId) throw new Error('Zhipu video generation did not return id');

    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: taskId });
    return this.pollVideo(taskId, req, callbacks);
  }

  private async pollVideo(
    taskId: string,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.getAsyncResult(taskId);
      const status = firstString(task['task_status']) ?? '';
      const jobStatus = mapVideoStatus(status);

      if (jobStatus === JobStatusEnum.Completed) {
        const video = asRecordArray(task['video_result'])[0] ?? {};
        const url = firstString(video['url']);
        if (!url) throw new Error('Zhipu video generation completed without a video URL');
        return {
          assetHash: '',
          assetPath: url,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { taskId, model: this.model, status },
        };
      }
      if (jobStatus === JobStatusEnum.Failed || jobStatus === JobStatusEnum.Cancelled) {
        throw new Error(`Zhipu video generation ${status || 'failed'}`);
      }

      callbacks?.onQueueUpdate?.({
        status: jobStatus === JobStatusEnum.Queued ? 'queued' : 'processing',
        currentStep: status || 'processing',
        jobId: taskId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt),
        currentStep: status || 'processing',
        jobId: taskId,
      });
      await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Zhipu video generation ${taskId} did not finish within the polling limit`,
    );
  }

  private async getAsyncResult(taskId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/async-result/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw await this.toRequestError(res);
    return asRecord(await res.json());
  }
}

function toZhipuVideoRequest(req: GenerationRequest, model: string): Record<string, unknown> {
  const imageUrls = resolveVideoImages(req);
  return {
    model,
    prompt: req.prompt,
    quality: req.quality === 'quality' ? 'quality' : 'speed',
    duration: req.duration ?? 5,
    ...(imageUrls.length > 0 ? { image_url: imageUrls } : {}),
    ...(req.audio != null ? { with_audio: req.audio } : {}),
    ...(req.width != null && req.height != null ? { size: `${req.width}x${req.height}` } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
  };
}

function resolveVideoImages(req: GenerationRequest): string[] {
  const explicitFirst = firstString(req.frameReferenceImages?.first, req.sourceImagePath);
  const explicitLast = firstString(req.frameReferenceImages?.last);
  const references = normalizeImages(req.referenceImages);
  if (references.length > 2) {
    throw new Error('Zhipu video supports at most two ordered image references');
  }
  if ((explicitFirst || explicitLast) && references.length > 0) {
    throw new Error(
      'Zhipu video cannot combine generic references with first or last frame images',
    );
  }
  if (explicitLast && !explicitFirst) {
    throw new Error('Zhipu video last frame requires a first frame or source image');
  }
  if (explicitFirst) return explicitLast ? [explicitFirst, explicitLast] : [explicitFirst];
  return references;
}

function imageAssetPath(data: Record<string, unknown>): string | undefined {
  const url = firstString(data['url']);
  if (url) return url;
  const base64 = firstString(data['b64_json'], data['b64'], data['base64']);
  return base64 ? `data:image/png;base64,${base64}` : undefined;
}

function mapVideoStatus(status: string): JobStatus {
  switch (status.toUpperCase()) {
    case 'SUCCESS':
      return JobStatusEnum.Completed;
    case 'FAIL':
    case 'FAILED':
      return JobStatusEnum.Failed;
    case 'CANCELLED':
    case 'CANCELED':
      return JobStatusEnum.Cancelled;
    case 'QUEUED':
    case 'PENDING':
      return JobStatusEnum.Queued;
    default:
      return JobStatusEnum.Running;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeImages(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
