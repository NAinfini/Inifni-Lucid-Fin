import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
  JobStatus,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode } from '@lucid-fin/contracts';
import { toRunwayRequest, parseRunwayResponse } from './mapper.js';

export class RunwayAdapter implements AIProviderAdapter {
  readonly id = 'runway-gen4';
  readonly name = 'Runway Gen-4';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 3;

  private apiKey = '';
  private baseUrl = 'https://api.dev.runwayml.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/tasks`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toRunwayRequest(req);
    const res = await fetch(`${this.baseUrl}/image_to_video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Runway API key');
      if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Runway rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Runway error: ${status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseRunwayResponse(data);

    // Runway is async — return task ID, caller polls via checkStatus
    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { taskId: parsed.taskId, status: parsed.status },
    };
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
    const res = await fetch(`${this.baseUrl}/tasks/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `Runway status check failed: ${res.status}`,
      );
    }

    const data = (await res.json()) as Record<string, unknown>;
    const status = data['status'] as string;

    const statusMap: Record<string, JobStatus> = {
      PENDING: 'queued' as JobStatus,
      RUNNING: 'running' as JobStatus,
      SUCCEEDED: 'completed' as JobStatus,
      FAILED: 'failed' as JobStatus,
      CANCELLED: 'cancelled' as JobStatus,
    };

    return statusMap[status] ?? ('running' as JobStatus);
  }

  async cancel(jobId: string): Promise<void> {
    await fetch(`${this.baseUrl}/tasks/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }
}
