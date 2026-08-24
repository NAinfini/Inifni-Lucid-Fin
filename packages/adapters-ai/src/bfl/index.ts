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

const DEFAULT_BASE_URL = 'https://api.bfl.ai/v1';
const DEFAULT_MODEL_ENDPOINT = 'flux-2-pro-preview';
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_POLL_ATTEMPTS = 1_200;

export class BFLFluxAdapter implements AIProviderAdapter {
  readonly id = 'bfl-flux';
  readonly name = 'Black Forest Labs FLUX.2';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 6;
  readonly conditioningCapabilities = { firstFrame: true } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private baseUrl = DEFAULT_BASE_URL;
  private modelEndpoint = DEFAULT_MODEL_ENDPOINT;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.modelEndpoint = normalizeEndpoint(options.model);
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
      const res = await fetch(`${this.baseUrl}/credits`, {
        headers: { 'x-key': this.apiKey },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: 'Black Forest Labs', status, error });
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
    return { provider: this.id, estimatedCost: 0.045, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const result = await this.fetchPollingResult(
      `${this.baseUrl}/get_result?id=${encodeURIComponent(jobId)}`,
    );
    return mapBflStatus(firstString(result['status']) ?? '');
  }

  async cancel(_jobId: string): Promise<void> {
    // BFL's public asynchronous image API does not document cancellation.
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'image') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Black Forest Labs FLUX does not support ${req.type} generation`,
      );
    }
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const res = await fetch(`${this.baseUrl}/${this.modelEndpoint}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'x-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toBflRequest(req)),
    });
    if (!res.ok) throw await this.toRequestError(res);

    const submitted = asRecord(await res.json());
    const requestId = firstString(submitted['id']);
    const pollingUrl = firstString(submitted['polling_url']);
    if (!requestId || !pollingUrl) {
      throw new Error('BFL generation did not return id and polling_url');
    }
    validateProviderUrl(pollingUrl);

    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'queued', jobId: requestId });
    return this.poll(requestId, pollingUrl, req, callbacks);
  }

  private async poll(
    requestId: string,
    pollingUrl: string,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.fetchPollingResult(pollingUrl);
      const status = firstString(task['status']) ?? '';
      const jobStatus = mapBflStatus(status);
      const progress = numberInRange(task['progress'], 0, 100);

      if (jobStatus === JobStatusEnum.Completed) {
        const output = asRecord(task['result']);
        const url = firstString(output['sample']);
        if (!url) throw new Error('BFL generation completed without result.sample');
        return {
          assetHash: '',
          assetPath: url,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { requestId, model: this.modelEndpoint, status },
        };
      }
      if (jobStatus === JobStatusEnum.Failed || jobStatus === JobStatusEnum.Cancelled) {
        throw new Error(`BFL generation ${status || 'failed'}`);
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
      `BFL generation ${requestId} did not finish within the polling limit`,
    );
  }

  private async fetchPollingResult(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-key': this.apiKey },
    });
    if (!res.ok) throw await this.toRequestError(res);
    return asRecord(await res.json());
  }

  private async toRequestError(res: Response): Promise<LucidError> {
    const body = await res.json().catch(() => ({}));
    return adapterErrorToLucidError(this.normalizeError(body, res.status));
  }
}

function toBflRequest(req: GenerationRequest): Record<string, unknown> {
  const sourceImage = firstString(req.sourceImagePath, req.frameReferenceImages?.first);
  if (req.frameReferenceImages?.last?.trim()) {
    throw new Error('BFL FLUX image generation does not support a dedicated last frame');
  }
  return {
    prompt: req.prompt,
    ...(req.width != null ? { width: req.width } : {}),
    ...(req.height != null ? { height: req.height } : {}),
    ...(sourceImage ? { input_image: sourceImage } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...optionalOutputFormat(req),
  };
}

function optionalOutputFormat(req: GenerationRequest): Record<string, string> {
  const value = req.params?.['output_format'];
  return typeof value === 'string' && value.trim() ? { output_format: value.trim() } : {};
}

function mapBflStatus(status: string): JobStatus {
  switch (status) {
    case 'Ready':
      return JobStatusEnum.Completed;
    case 'Pending':
      return JobStatusEnum.Queued;
    case 'Error':
    case 'Failed':
    case 'Request Moderated':
    case 'Content Moderated':
    case 'Task not found':
      return JobStatusEnum.Failed;
    default:
      return JobStatusEnum.Running;
  }
}

function normalizeEndpoint(value: string): string {
  const endpoint = value.trim().replace(/^\/+|\/+$/g, '');
  if (!/^[a-zA-Z0-9._-]+$/.test(endpoint)) {
    throw new Error('BFL model endpoint must be a single endpoint path segment');
  }
  return endpoint;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
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
