import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';
import { validateProviderUrl } from '../url-policy.js';

export class LeonardoAdapter implements AIProviderAdapter {
  readonly id = 'leonardo-v2';
  readonly name = 'Leonardo AI';
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

  private apiKey = '';
  private baseUrl = 'https://cloud.leonardo.ai/api/rest/v1';
  private modelId = '7b592283-e8a7-4c5a-9ba6-d18c31f258b9';
  private pollIntervalMs = 2_000;
  private maxPollAttempts = 120;

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.modelId = options.model.trim();
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
      const res = await fetchWithTimeout(`${this.baseUrl}/me`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
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

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        prompt: req.prompt,
        negative_prompt: req.negativePrompt ?? '',
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        num_images: 1,
        seed: req.seed,
        modelId: (req.params?.modelId as string) ?? this.modelId,
      }),
    });
    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Leonardo API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Leonardo rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Leonardo error: ${res.status}`);
    }
    const data = (await res.json()) as { sdGenerationJob: { generationId: string } };
    const generationId = data.sdGenerationJob?.generationId;
    if (!generationId) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        'Leonardo response did not include a generation ID',
      );
    }
    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'pending', jobId: generationId });

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const generation = await this.fetchGeneration(generationId);
      const status = readLeonardoStatus(generation);
      if (status === 'COMPLETE' || status === 'COMPLETED') {
        const assetPath = readLeonardoImageUrl(generation);
        if (!assetPath) {
          throw new LucidError(
            ErrorCode.ServiceUnavailable,
            'Leonardo completed without returning a generated image URL',
          );
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: generationId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: generationId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { generationId, taskId: generationId, model: this.modelId, url: assetPath },
        };
      }
      if (status === 'FAILED') {
        throw new LucidError(
          ErrorCode.ServiceUnavailable,
          `Leonardo generation ${generationId} failed`,
        );
      }
      callbacks?.onQueueUpdate?.({
        status: status === 'PENDING' ? 'queued' : 'processing',
        currentStep: status || 'processing',
        jobId: generationId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 5 + Math.round((attempt / this.maxPollAttempts) * 90)),
        currentStep: status || 'processing',
        jobId: generationId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }
    throw new LucidError(
      ErrorCode.Timeout,
      `Leonardo generation ${generationId} did not finish after ${this.maxPollAttempts} checks`,
    );
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.02, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const data = await this.fetchGeneration(jobId);
    const status = readLeonardoStatus(data);
    const map: Record<string, JobStatus> = {
      PENDING: JobStatus.Queued,
      PROCESSING: JobStatus.Running,
      COMPLETE: JobStatus.Completed,
      COMPLETED: JobStatus.Completed,
      FAILED: JobStatus.Failed,
    };
    return map[status] ?? JobStatus.Running;
  }

  async cancel(_jobId: string): Promise<void> {}

  private async fetchGeneration(jobId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new LucidError(ErrorCode.ServiceUnavailable, `Leonardo status failed: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

function readLeonardoStatus(data: Record<string, unknown>): string {
  const generation = asRecord(data['generations_by_pk']) ?? asRecord(data['generation']);
  return typeof generation?.['status'] === 'string' ? generation['status'].toUpperCase() : '';
}

function readLeonardoImageUrl(data: Record<string, unknown>): string | undefined {
  const generation = asRecord(data['generations_by_pk']) ?? asRecord(data['generation']);
  const images = Array.isArray(generation?.['generated_images'])
    ? generation['generated_images']
    : [];
  const image = asRecord(images[0]);
  return typeof image?.['url'] === 'string' && image['url'].trim()
    ? image['url'].trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
