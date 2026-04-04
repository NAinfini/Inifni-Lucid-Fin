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
import { toPikaRequest, parsePikaResponse } from './mapper.js';

export class PikaAdapter implements AIProviderAdapter {
  readonly id = 'pika-v2';
  readonly name = 'Pika 2.0';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 3;

  private apiKey = '';
  private baseUrl = 'https://api.pika.art/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/user`, {
        headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Pika-Version': '2024-12-01' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toPikaRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Pika-Version': '2024-12-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Pika API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Pika rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Pika error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parsePikaResponse(data);

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
      estimatedCost: (req.duration ?? 5) * 0.04,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generation/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Pika-Version': '2024-12-01' },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Pika status check failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parsePikaResponse(data);
    const map: Record<string, JobStatus> = {
      pending: JobStatus.Queued,
      processing: JobStatus.Running,
      complete: JobStatus.Completed,
      error: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generation/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'X-Pika-Version': '2024-12-01' },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Pika cancel failed: ${res.status}`);
  }
}
