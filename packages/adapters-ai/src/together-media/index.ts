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

type TogetherMediaType = 'image' | 'video';

type TogetherEndpointConfig = {
  baseUrl: string;
  model: string;
};

type TogetherJob = {
  id: string;
  type: TogetherMediaType;
  model: string;
};

const DEFAULT_BASE_URL = 'https://api.together.ai/v1';
const DEFAULT_IMAGE_MODEL = 'black-forest-labs/FLUX.1-schnell';
const DEFAULT_VIDEO_MODEL = 'minimax/video-01-director';

/** Public Together AI image and asynchronous video adapter. */
export class TogetherMediaAdapter implements AIProviderAdapter {
  readonly id = 'together-ai';
  readonly name = 'Together AI';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 3;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 9, preservesOrder: true },
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
  private readonly endpointConfigs: Record<TogetherMediaType, TogetherEndpointConfig> = {
    image: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_IMAGE_MODEL },
    video: { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_VIDEO_MODEL },
  };
  private pollIntervalMs = 2_000;
  private maxPollAttempts = 120;
  private readonly jobs = new Map<string, TogetherJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    const generationType: TogetherMediaType =
      options?.generationType === 'video' ? 'video' : 'image';
    const config = this.endpointConfigs[generationType];
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      config.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      config.model = options.model.trim();
    }
    this.configurePolling(options);
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpointConfigs.image.baseUrl}/models`, {
        headers: this.authHeaders(),
      });
      return response.ok;
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
      estimatedCost: req.type === 'video' ? (req.duration ?? 5) * 0.08 : 0.03,
      currency: 'USD',
      unit: req.type === 'video' ? 'per second of output video' : 'per image',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const job = this.jobs.get(jobId);
    if (job?.type === 'image') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'Together image generations do not expose job status',
      );
    }
    const config = this.endpointConfigs.video;
    const data = await this.requestJson(`${config.baseUrl}/videos/${encodeURIComponent(jobId)}`, {
      headers: this.authHeaders(),
    });
    return mapTogetherStatus(readString(data, 'status'));
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Together AI video cancellation is not available through the public videos API',
    );
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type === 'image') return this.generateImage(req, callbacks);
    if (req.type === 'video') return this.generateVideo(req, callbacks);
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Together AI does not support ${req.type} generation`,
    );
  }

  private async generateImage(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const config = this.endpointConfigs.image;
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });
    const data = await this.requestJson(`${config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(buildTogetherImageInput(req, config.model)),
    });
    const assetPath = extractTogetherImageAsset(data);
    if (!assetPath)
      throw this.invalidResponse('Together image response did not include a URL or base64 asset');

    callbacks?.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks?.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: { requestId: readString(data, 'id'), model: config.model },
    };
  }

  private async generateVideo(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const config = this.endpointConfigs.video;
    const submission = await this.requestJson(`${config.baseUrl}/videos`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(buildTogetherVideoInput(req, config.model)),
    });
    const jobId = readString(submission, 'id', 'request_id', 'requestId');
    const rawStatus = readString(submission, 'status') ?? 'queued';
    const status = mapTogetherStatus(rawStatus);

    if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
      throw this.statusFailure(submission, `Together video request ${rawStatus}`);
    }
    if (!jobId) {
      throw this.invalidResponse('Together video submission did not include a job ID');
    }

    const job: TogetherJob = { id: jobId, type: 'video', model: config.model };
    this.jobs.set(jobId, job);
    this.emitVideoStatus(callbacks, jobId, status, submission);

    if (status === JobStatusValue.Completed) {
      return this.completedVideoResult(req, job, submission, callbacks);
    }
    return this.pollVideo(req, job, callbacks);
  }

  private async pollVideo(
    req: GenerationRequest,
    job: TogetherJob,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const config = this.endpointConfigs.video;
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const data = await this.requestJson(
        `${config.baseUrl}/videos/${encodeURIComponent(job.id)}`,
        {
          headers: this.authHeaders(),
        },
      );
      const rawStatus = readString(data, 'status') ?? '';
      const status = mapTogetherStatus(rawStatus);
      this.emitVideoStatus(callbacks, job.id, status, data);

      if (status === JobStatusValue.Completed) {
        return this.completedVideoResult(req, job, data, callbacks);
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.statusFailure(data, `Together video request ${job.id} ${rawStatus || 'failed'}`);
      }
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Together video request ${job.id} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private completedVideoResult(
    req: GenerationRequest,
    job: TogetherJob,
    data: Record<string, unknown>,
    callbacks?: SubscribeCallbacks,
  ): GenerationResult {
    const assetPath = firstString(asRecord(data['outputs'])?.['video_url'], data['video_url']);
    if (!assetPath) {
      throw this.invalidResponse(
        'Together completed video response did not include outputs.video_url',
      );
    }
    callbacks?.onProgress?.({
      type: 'progress',
      percentage: 100,
      currentStep: 'completed',
      jobId: job.id,
    });
    callbacks?.onQueueUpdate?.({ status: 'completed', currentStep: 'completed', jobId: job.id });
    return {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost:
        readNumber(asRecord(data['outputs']) ?? {}, 'cost') ?? this.estimateCost(req).estimatedCost,
      metadata: {
        requestId: job.id,
        status: readString(data, 'status') ?? 'completed',
        model: job.model,
      },
    };
  }

  private emitVideoStatus(
    callbacks: SubscribeCallbacks | undefined,
    jobId: string,
    status: JobStatus,
    data: Record<string, unknown>,
  ): void {
    const currentStep = readString(data, 'status', 'message') ?? 'processing';
    if (status === JobStatusValue.Queued) {
      callbacks?.onQueueUpdate?.({ status: 'queued', currentStep, jobId });
      return;
    }
    if (status === JobStatusValue.Running) {
      callbacks?.onQueueUpdate?.({ status: 'processing', currentStep, jobId });
      callbacks?.onProgress?.({ type: 'progress', percentage: 50, currentStep, jobId });
    }
  }

  private configurePolling(options: AdapterConfigureOptions | undefined): void {
    if (typeof options?.pollIntervalMs === 'number' && Number.isFinite(options.pollIntervalMs)) {
      this.pollIntervalMs = Math.max(0, Math.floor(options.pollIntervalMs));
    }
    if (typeof options?.maxPollAttempts === 'number' && Number.isFinite(options.maxPollAttempts)) {
      this.maxPollAttempts = Math.max(1, Math.floor(options.maxPollAttempts));
    }
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
    if (!isRecord(payload))
      throw this.invalidResponse('Together AI returned a non-object response');
    return payload;
  }

  private statusFailure(data: Record<string, unknown>, fallback: string): LucidError {
    return adapterErrorToLucidError(
      this.normalizeError({ ...data, message: readFailureMessage(data) ?? fallback }, 502),
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

function buildTogetherImageInput(req: GenerationRequest, model: string): Record<string, unknown> {
  const references = collectReferences(req);
  const body: Record<string, unknown> = {
    ...(req.params ?? {}),
    model,
    prompt: req.prompt,
    n: 1,
  };
  if (req.width != null) body.width = req.width;
  if (req.height != null) body.height = req.height;
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.seed != null) body.seed = req.seed;
  if (references.all.length > 0) {
    body.reference_images = references.all;
    body.image_url = references.primary;
  }
  return body;
}

function buildTogetherVideoInput(req: GenerationRequest, model: string): Record<string, unknown> {
  const references = collectReferences(req);
  const body: Record<string, unknown> = { ...(req.params ?? {}), model, prompt: req.prompt };
  if (req.width != null) body.width = req.width;
  if (req.height != null) body.height = req.height;
  if (req.duration != null) body.seconds = req.duration;
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
  if (req.seed != null) body.seed = req.seed;

  const media: Record<string, unknown> = {};
  if (references.generic.length > 0) media.reference_images = references.generic;
  const frameImages: Array<Record<string, string>> = [];
  const firstFrame = references.first ?? references.source;
  if (firstFrame) frameImages.push({ input_image: firstFrame, frame: 'first' });
  if (references.last) frameImages.push({ input_image: references.last, frame: 'last' });
  if (frameImages.length > 0) media.frame_images = frameImages;
  if (Object.keys(media).length > 0) body.media = media;
  return body;
}

function collectReferences(req: GenerationRequest): {
  source?: string;
  first?: string;
  last?: string;
  generic: string[];
  primary?: string;
  all: string[];
} {
  const first = publicReference(req.frameReferenceImages?.first);
  const last = publicReference(req.frameReferenceImages?.last);
  const source = publicReference(req.sourceImagePath);
  const generic = (req.referenceImages ?? []).map(publicReference).filter(isDefined);
  const primary = first ?? source ?? generic[0];
  return {
    source,
    first,
    last,
    generic: unique(generic),
    primary,
    all: unique([first, source, ...generic, last]),
  };
}

function publicReference(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim();
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:' || url.protocol === 'http:') return normalized;
  } catch {
    // A provider cannot read a local path. Report it as invalid instead of
    // silently submitting a reference it can never fetch.
  }
  throw new LucidError(
    ErrorCode.InvalidRequest,
    'Together AI reference images must be public http(s) URLs or image data URIs',
  );
}

function extractTogetherImageAsset(data: Record<string, unknown>): string | undefined {
  const entry = Array.isArray(data['data']) ? asRecord(data['data'][0]) : undefined;
  const url = firstString(entry?.['url'], data['url']);
  if (url) return url;
  const base64 = firstString(entry?.['b64_json'], data['b64_json']);
  if (!base64) return undefined;
  if (base64.startsWith('data:')) return base64;
  const outputFormat = firstString(entry?.['output_format'], data['output_format']) ?? 'jpeg';
  const mimeType = outputFormat.toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
  return `data:${mimeType};base64,${base64}`;
}

function mapTogetherStatus(status: string | undefined): JobStatus {
  const normalized = status?.trim().toLowerCase() ?? '';
  if (['queued', 'pending', 'in_queue'].includes(normalized)) return JobStatusValue.Queued;
  if (['in_progress', 'processing', 'running'].includes(normalized)) return JobStatusValue.Running;
  if (['completed', 'succeeded', 'success', 'done'].includes(normalized))
    return JobStatusValue.Completed;
  if (['failed', 'error'].includes(normalized)) return JobStatusValue.Failed;
  if (['cancelled', 'canceled'].includes(normalized)) return JobStatusValue.Cancelled;
  return JobStatusValue.Running;
}

function readFailureMessage(data: Record<string, unknown>): string | undefined {
  const error = data['error'];
  return firstString(error, asRecord(error)?.['message'], data['message'], data['reason']);
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

function readNumber(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
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
