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

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_IMAGE_MODEL = 'grok-imagine-image-quality';
const DEFAULT_VIDEO_MODEL = 'grok-imagine-video';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const MAX_VIDEO_REFERENCE_IMAGES = 7;

export class XAIImagineAdapter implements AIProviderAdapter {
  readonly id = 'xai-imagine';
  readonly name = 'xAI Grok Imagine';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: MAX_VIDEO_REFERENCE_IMAGES, preservesOrder: true },
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
  private imageBaseUrl = DEFAULT_BASE_URL;
  private videoBaseUrl = DEFAULT_BASE_URL;
  private imageModel = DEFAULT_IMAGE_MODEL;
  private videoModel = DEFAULT_VIDEO_MODEL;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    const generationType = options?.generationType;
    if (generationType === 'image') {
      this.configureImage(options);
    } else if (generationType === 'video') {
      this.configureVideo(options);
    } else {
      this.configureImage(options);
      this.configureVideo(options);
    }
    this.configurePolling(options);
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.imageBaseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: 'xAI Imagine', status, error });
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
      estimatedCost: req.type === 'video' ? (req.duration ?? 5) * 0.08 : 0.05,
      currency: 'USD',
      unit: req.type === 'video' ? 'per video' : 'per image',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const task = await this.getVideoTask(jobId);
    return mapVideoStatus(firstString(task['status']) ?? '');
  }

  async cancel(_jobId: string): Promise<void> {
    // xAI's public Imagine video API exposes no cancellation endpoint.
  }

  private configureImage(options?: AdapterConfigureOptions): void {
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.imageBaseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.imageModel = options.model.trim();
    }
  }

  private configureVideo(options?: AdapterConfigureOptions): void {
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.videoBaseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.videoModel = options.model.trim();
    }
  }

  private configurePolling(options?: AdapterConfigureOptions): void {
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

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const result =
      req.type === 'image'
        ? await this.generateImage(req)
        : req.type === 'video'
          ? await this.generateVideo(req, callbacks)
          : (() => {
              throw new LucidError(
                ErrorCode.InvalidRequest,
                `xAI Imagine does not support ${req.type} generation`,
              );
            })();

    callbacks?.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks?.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return result;
  }

  private async generateImage(req: GenerationRequest): Promise<GenerationResult> {
    const image = resolveImageEditInput(req);
    const endpoint = image ? '/images/edits' : '/images/generations';
    const body: Record<string, unknown> = {
      model: this.imageModel,
      prompt: req.prompt,
      response_format: 'url',
      ...(image ? { image: { url: image, type: 'image_url' } } : { n: 1 }),
    };
    const res = await fetch(`${this.imageBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw await this.toRequestError(res);
    const data = asRecord(await res.json());
    const url = firstString(asRecordArray(data['data'])[0]?.['url']);
    if (!url) throw new Error('xAI Imagine image generation completed without an image URL');

    return {
      assetHash: '',
      assetPath: url,
      provider: this.id,
      cost: extractUsageCost(data),
      metadata: { model: this.imageModel, endpoint },
    };
  }

  private async generateVideo(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const body = toVideoRequest(req, this.videoModel);
    const res = await fetch(`${this.videoBaseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw await this.toRequestError(res);
    const submitted = asRecord(await res.json());
    const requestId = firstString(submitted['request_id']);
    if (!requestId) throw new Error('xAI Imagine video generation did not return request_id');

    callbacks?.onQueueUpdate?.({
      status: 'queued',
      currentStep: 'queued',
      jobId: requestId,
    });
    return this.pollVideo(requestId, req, callbacks);
  }

  private async pollVideo(
    requestId: string,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.getVideoTask(requestId);
      const status = firstString(task['status']) ?? '';
      const jobStatus = mapVideoStatus(status);
      const progress = numberInRange(task['progress'], 0, 100);

      if (jobStatus === JobStatusEnum.Completed) {
        const video = asRecord(task['video']);
        const url = firstString(video['url']);
        if (!url) throw new Error('xAI Imagine video generation completed without a video URL');
        return {
          assetHash: '',
          assetPath: url,
          provider: this.id,
          cost: extractUsageCost(task),
          metadata: { requestId, model: this.videoModel, status },
        };
      }
      if (jobStatus === JobStatusEnum.Failed || jobStatus === JobStatusEnum.Cancelled) {
        throw new Error(`xAI Imagine video generation ${status || 'failed'}`);
      }

      callbacks?.onQueueUpdate?.({
        status: jobStatus === JobStatusEnum.Queued ? 'queued' : 'processing',
        currentStep: status || 'processing',
        jobId: requestId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: progress ?? Math.min(95, 10 + attempt),
        currentStep: status || 'processing',
        jobId: requestId,
      });
      await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `xAI Imagine video generation ${requestId} did not finish within the polling limit`,
    );
  }

  private async getVideoTask(requestId: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.videoBaseUrl}/videos/${encodeURIComponent(requestId)}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) throw await this.toRequestError(res);
    return asRecord(await res.json());
  }

  private async toRequestError(res: Response): Promise<LucidError> {
    const body = await res.json().catch(() => ({}));
    return adapterErrorToLucidError(this.normalizeError(body, res.status));
  }
}

function toVideoRequest(req: GenerationRequest, model: string): Record<string, unknown> {
  const sourceImage = firstNonEmpty(req.frameReferenceImages?.first, req.sourceImagePath);
  const referenceImages = normalizeImages(req.referenceImages);
  if (referenceImages.length > MAX_VIDEO_REFERENCE_IMAGES) {
    throw new Error(
      `xAI Imagine supports at most ${MAX_VIDEO_REFERENCE_IMAGES} video reference images; received ${referenceImages.length}`,
    );
  }
  if (sourceImage && referenceImages.length > 0) {
    throw new Error('xAI Imagine cannot combine a source image with video reference images');
  }
  if (req.frameReferenceImages?.last?.trim()) {
    throw new Error('xAI Imagine does not support a dedicated last video frame');
  }
  if (referenceImages.length > 0 && (req.duration ?? 5) > 10) {
    throw new Error('xAI Imagine reference-to-video supports a maximum duration of 10 seconds');
  }

  return {
    model,
    prompt: req.prompt,
    ...(req.duration != null ? { duration: req.duration } : {}),
    ...(sourceImage ? { image: { url: sourceImage } } : {}),
    ...(referenceImages.length > 0
      ? { reference_images: referenceImages.map((url) => ({ url })) }
      : {}),
    ...videoFormatOptions(req),
  };
}

function resolveImageEditInput(req: GenerationRequest): string | undefined {
  const references = normalizeImages(req.referenceImages);
  if (references.length > 1) {
    throw new Error('xAI Imagine image editing accepts one source image per request');
  }
  const source = firstNonEmpty(req.sourceImagePath);
  if (source && references.length > 0) {
    throw new Error(
      'xAI Imagine image editing cannot combine sourceImagePath with referenceImages',
    );
  }
  return source ?? references[0];
}

function videoFormatOptions(req: GenerationRequest): Record<string, string> {
  const aspectRatio = stringParam(req, 'aspect_ratio');
  const resolution = stringParam(req, 'resolution');
  return {
    ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
  };
}

function mapVideoStatus(status: string): JobStatus {
  switch (status.toLowerCase()) {
    case 'done':
      return JobStatusEnum.Completed;
    case 'failed':
    case 'expired':
      return JobStatusEnum.Failed;
    case 'cancelled':
    case 'canceled':
      return JobStatusEnum.Cancelled;
    case 'queued':
    case 'pending':
      return JobStatusEnum.Queued;
    default:
      return JobStatusEnum.Running;
  }
}

function extractUsageCost(data: Record<string, unknown>): number | undefined {
  const usage = asRecord(data['usage']);
  const ticks = usage['cost_in_usd_ticks'];
  return typeof ticks === 'number' && Number.isFinite(ticks) ? ticks / 10_000_000_000 : undefined;
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

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return firstString(...values);
}

function normalizeImages(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  const value = req.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberInRange(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
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
