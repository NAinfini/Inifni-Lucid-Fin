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

const DEFAULT_BASE_URL = 'https://api.vidu.com';
const DEFAULT_MODEL = 'viduq3-pro';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;

export class ViduAdapter implements AIProviderAdapter {
  readonly id = 'vidu';
  readonly name = 'Vidu';
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
    cancellation: true,
  } as const;

  private apiKey = '';
  private baseUrl = DEFAULT_BASE_URL;
  private model = DEFAULT_MODEL;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = normalizeBaseUrl(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.model = normalizeModel(options.model);
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
      const res = await fetch(`${this.baseUrl}/ent/v2/tasks`, {
        headers: { Authorization: `Token ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: 'Vidu', status, error });
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
      estimatedCost: (req.duration ?? 5) * 0.06,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const task = await this.getTask(jobId);
    return mapViduStatus(firstString(task['state']) ?? '');
  }

  async cancel(jobId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/ent/v2/tasks/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: jobId }),
    });
    if (!res.ok) throw await this.toRequestError(res);
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'video') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Vidu does not support ${req.type} generation`,
      );
    }
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const submission = toViduRequest(req, this.model);
    const res = await fetch(`${this.baseUrl}${submission.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(submission.body),
    });
    if (!res.ok) throw await this.toRequestError(res);

    const submitted = asRecord(await res.json());
    const taskId = firstString(submitted['task_id'], submitted['id']);
    if (!taskId) throw new Error('Vidu generation did not return task_id');

    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: taskId });
    return this.pollTask(taskId, req, callbacks);
  }

  private async pollTask(
    taskId: string,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.getTask(taskId);
      const state = firstString(task['state']) ?? '';
      const status = mapViduStatus(state);

      if (status === JobStatusEnum.Completed) {
        const creation = asRecordArray(task['creations'])[0] ?? {};
        const url = firstString(creation['url']);
        if (!url) throw new Error('Vidu generation completed without a video URL');
        return {
          assetHash: '',
          assetPath: url,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { taskId, model: this.model, state },
        };
      }
      if (status === JobStatusEnum.Failed || status === JobStatusEnum.Cancelled) {
        throw new Error(`Vidu generation ${state || 'failed'}`);
      }

      callbacks?.onQueueUpdate?.({
        status: status === JobStatusEnum.Queued ? 'queued' : 'processing',
        currentStep: state || 'processing',
        jobId: taskId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt),
        currentStep: state || 'processing',
        jobId: taskId,
      });
      await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Vidu generation ${taskId} did not finish within the polling limit`,
    );
  }

  private async getTask(taskId: string): Promise<Record<string, unknown>> {
    const res = await fetch(
      `${this.baseUrl}/ent/v2/tasks/${encodeURIComponent(taskId)}/creations`,
      { headers: { Authorization: `Token ${this.apiKey}` } },
    );
    if (!res.ok) throw await this.toRequestError(res);
    return asRecord(await res.json());
  }

  private async toRequestError(res: Response): Promise<LucidError> {
    const body = await res.json().catch(() => ({}));
    return adapterErrorToLucidError(this.normalizeError(body, res.status));
  }
}

function toViduRequest(
  req: GenerationRequest,
  model: string,
): {
  endpoint: '/ent/v2/text2video' | '/ent/v2/image2video' | '/ent/v2/start-end2video';
  body: Record<string, unknown>;
} {
  const images = resolveViduImages(req);
  const endpoint =
    images.length === 2
      ? '/ent/v2/start-end2video'
      : images.length === 1
        ? '/ent/v2/image2video'
        : '/ent/v2/text2video';
  return {
    endpoint,
    body: {
      model,
      prompt: req.prompt,
      duration: req.duration ?? 5,
      aspect_ratio: stringParam(req, 'aspect_ratio') ?? aspectRatio(req.width, req.height),
      resolution: stringParam(req, 'resolution') ?? '720p',
      ...(images.length > 0 ? { images } : {}),
      ...(req.seed != null ? { seed: req.seed } : {}),
      ...(req.audio != null ? { audio: req.audio } : {}),
    },
  };
}

function resolveViduImages(req: GenerationRequest): string[] {
  const sourceImage = firstString(req.sourceImagePath);
  const firstFrame = firstString(req.frameReferenceImages?.first);
  const lastFrame = firstString(req.frameReferenceImages?.last);
  const references = normalizeImages(req.referenceImages);
  if (references.length > 2) {
    throw new Error('Vidu supports at most two ordered image references');
  }
  if (sourceImage && firstFrame) {
    throw new Error('Vidu cannot combine sourceImagePath with an explicit first frame');
  }
  if ((sourceImage || firstFrame || lastFrame) && references.length > 0) {
    throw new Error(
      'Vidu cannot combine generic references with source, first-frame, or last-frame images',
    );
  }
  const first = firstFrame ?? sourceImage;
  if (lastFrame && !first) {
    throw new Error('Vidu last frame requires a source image or explicit first frame');
  }
  if (first) return lastFrame ? [first, lastFrame] : [first];
  return references;
}

function mapViduStatus(state: string): JobStatus {
  switch (state.toLowerCase()) {
    case 'success':
      return JobStatusEnum.Completed;
    case 'failed':
    case 'error':
      return JobStatusEnum.Failed;
    case 'cancelled':
    case 'canceled':
      return JobStatusEnum.Cancelled;
    case 'created':
    case 'queueing':
    case 'queued':
      return JobStatusEnum.Queued;
    default:
      return JobStatusEnum.Running;
  }
}

function aspectRatio(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  const supported = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function normalizeModel(value: string): string {
  const model = value.trim();
  return model === 'vidu-q3-pro' ? DEFAULT_MODEL : model;
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? normalized.slice(0, -'/v1'.length) : normalized;
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  const value = req.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
