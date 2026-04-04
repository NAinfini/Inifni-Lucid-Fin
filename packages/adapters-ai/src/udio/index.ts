import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';
import { toUdioRequest, parseUdioResponse } from './mapper.js';

export class UdioAdapter implements AIProviderAdapter {
  readonly id = 'udio';
  readonly name = 'Udio Music';
  readonly type: AdapterType = 'music';
  readonly capabilities: Capability[] = ['text-to-music'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://www.udio.com/api';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/me`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toUdioRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Udio API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Udio rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Udio error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseUdioResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { id: parsed.id, status: parsed.status },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 30) * 0.015,
      currency: 'USD',
      unit: 'per track',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/tracks/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Udio status check failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseUdioResponse(data);
    const map: Record<string, JobStatus> = {
      queued: JobStatus.Queued,
      processing: JobStatus.Running,
      complete: JobStatus.Completed,
      error: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/tracks/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Udio cancel failed: ${res.status}`);
  }
}
