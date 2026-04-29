import type {
  AIProviderAdapter,
  AdapterError,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { JobStatus as JobStatusEnum } from '@lucid-fin/contracts';
import { adapterErrorToLucidError } from '../error-utils.js';
import { fetchWithRetry as fetchWithTimeout } from '../fetch-utils.js';
import { parseError, parseRunwayResponse, parseRunwayTask, toRunwayRequest } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class RunwayAdapter implements AIProviderAdapter {
  readonly id = 'runway-gen4';
  readonly name = 'Runway Gen-4.5';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 3;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  private apiKey = '';
  private baseUrl = 'https://api.dev.runwayml.com/v1';
  private pollIntervalMs = 2_000;

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
    if (typeof options?.pollIntervalMs === 'number') {
      this.pollIntervalMs = Math.max(0, options.pollIntervalMs);
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/tasks`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok || res.status === 404;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseError(error, status);
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toRunwayRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/image_to_video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw adapterErrorToLucidError(this.normalizeError(err, res.status));
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseRunwayResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { taskId: parsed.taskId, status: parsed.status },
    };
  }

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const initial = await this.generate(req);
    const taskId = String(initial.metadata?.taskId ?? '');
    if (!taskId) {
      callbacks.onProgress?.({
        type: 'progress',
        percentage: 100,
        currentStep: 'completed',
      });
      callbacks.onQueueUpdate?.({
        status: 'completed',
        currentStep: 'completed',
      });
      return initial;
    }

    callbacks.onQueueUpdate?.({
      status: 'queued',
      currentStep: 'queued',
      jobId: taskId,
    });

    for (;;) {
      const res = await fetchWithTimeout(`${this.baseUrl}/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw adapterErrorToLucidError(this.normalizeError(err, res.status));
      }

      const data = (await res.json()) as Record<string, unknown>;
      const parsed = parseRunwayTask(data);
      const status = mapRunwayStatus(parsed.status);

      if (status === JobStatusEnum.Queued) {
        callbacks.onQueueUpdate?.({
          status: 'queued',
          queuePosition: parsed.queuePosition,
          estimatedWaitTime: parsed.estimatedWaitTime,
          currentStep: parsed.currentStep ?? 'queued',
          jobId: taskId,
        });
      }

      if (status === JobStatusEnum.Running || parsed.percentage != null) {
        callbacks.onQueueUpdate?.({
          status: 'processing',
          currentStep: parsed.currentStep ?? 'processing',
          jobId: taskId,
        });
        callbacks.onProgress?.({
          type: 'progress',
          percentage: parsed.percentage ?? 0,
          currentStep: parsed.currentStep ?? 'processing',
          queuePosition: parsed.queuePosition,
          estimatedWaitTime: parsed.estimatedWaitTime,
          jobId: taskId,
        });
      }

      if (status === JobStatusEnum.Completed) {
        callbacks.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: taskId,
        });
        callbacks.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: taskId,
        });
        return {
          assetHash: '',
          assetPath: parsed.assetUrl ?? '',
          provider: this.id,
          metadata: {
            taskId,
            status: parsed.status,
            ...(parsed.assetUrl ? { url: parsed.assetUrl } : {}),
          },
        };
      }

      if (status === JobStatusEnum.Failed) {
        throw new Error(parsed.failureReason ?? `Runway task ${taskId} failed`);
      }

      if (status === JobStatusEnum.Cancelled) {
        throw new Error(`Runway task ${taskId} was cancelled`);
      }

      await this.sleep(this.pollIntervalMs);
    }
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const duration = req.duration ?? 5;
    const costPerSecond = 0.05;
    return {
      provider: this.id,
      estimatedCost: duration * costPerSecond,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/tasks/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw adapterErrorToLucidError(this.normalizeError(err, res.status));
    }

    const data = (await res.json()) as Record<string, unknown>;
    return mapRunwayStatus(parseRunwayTask(data).status);
  }

  async cancel(jobId: string): Promise<void> {
    await fetchWithTimeout(`${this.baseUrl}/tasks/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function mapRunwayStatus(status: string): JobStatus {
  const statusMap: Record<string, JobStatus> = {
    PENDING: JobStatusEnum.Queued,
    QUEUED: JobStatusEnum.Queued,
    RUNNING: JobStatusEnum.Running,
    PROCESSING: JobStatusEnum.Running,
    SUCCEEDED: JobStatusEnum.Completed,
    COMPLETED: JobStatusEnum.Completed,
    FAILED: JobStatusEnum.Failed,
    CANCELLED: JobStatusEnum.Cancelled,
  };

  return statusMap[status.toUpperCase()] ?? JobStatusEnum.Running;
}
