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
import { toLumaRequest, parseLumaResponse } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class LumaAdapter implements AIProviderAdapter {
  readonly id = 'luma-ray2';
  readonly name = 'Luma Ray 2';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = { lastFrame: true } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  private apiKey = '';
  private baseUrl = 'https://api.lumalabs.ai/dream-machine/v1';
  private pollIntervalMs = 2_000;
  private maxPollAttempts = 180;

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
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
      const res = await fetchWithTimeout(`${this.baseUrl}/generations`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok || res.status === 404;
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
    const body = toLumaRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Luma API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Luma rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Luma error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseLumaResponse(data);
    if (!parsed.generationId) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        'Luma response did not include a generation ID',
      );
    }
    callbacks?.onQueueUpdate?.({
      status: parsed.status === 'queued' ? 'queued' : 'processing',
      currentStep: parsed.status || 'queued',
      jobId: parsed.generationId,
    });

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const statusResponse =
        attempt === 0 && parsed.status === 'completed'
          ? data
          : await this.fetchGeneration(parsed.generationId);
      const current = parseLumaResponse(statusResponse);
      if (current.status === 'completed') {
        const assetPath = extractLumaVideoUrl(statusResponse);
        if (!assetPath) {
          throw new LucidError(
            ErrorCode.ServiceUnavailable,
            'Luma completed without returning assets.video',
          );
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: parsed.generationId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: parsed.generationId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: {
            generationId: parsed.generationId,
            taskId: parsed.generationId,
            status: current.status,
            url: assetPath,
          },
        };
      }
      if (current.status === 'failed') {
        throw new LucidError(
          ErrorCode.ServiceUnavailable,
          extractLumaFailure(statusResponse) ?? `Luma generation ${parsed.generationId} failed`,
        );
      }
      callbacks?.onQueueUpdate?.({
        status: current.status === 'queued' ? 'queued' : 'processing',
        currentStep: current.status || 'processing',
        jobId: parsed.generationId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 5 + Math.round((attempt / this.maxPollAttempts) * 90)),
        currentStep: current.status || 'processing',
        jobId: parsed.generationId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }
    throw new LucidError(
      ErrorCode.Timeout,
      `Luma generation ${parsed.generationId} did not finish after ${this.maxPollAttempts} checks`,
    );
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
    const data = await this.fetchGeneration(jobId);
    const parsed = parseLumaResponse(data);
    const map: Record<string, JobStatus> = {
      queued: JobStatus.Queued,
      dreaming: JobStatus.Running,
      completed: JobStatus.Completed,
      failed: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  private async fetchGeneration(jobId: string): Promise<Record<string, unknown>> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      throw new LucidError(ErrorCode.ServiceUnavailable, `Luma status check failed: ${res.status}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

function extractLumaVideoUrl(data: Record<string, unknown>): string | undefined {
  const assets = asRecord(data['assets']);
  return firstString(assets?.['video'], assets?.['video_url'], data['video_url'], data['url']);
}

function extractLumaFailure(data: Record<string, unknown>): string | undefined {
  const failure = asRecord(data['failure_reason']);
  return firstString(failure?.['message'], data['failure_reason'], data['error']);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
