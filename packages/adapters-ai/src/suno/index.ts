import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { fetchWithRetry as fetchWithTimeout } from '../fetch-utils.js';
import { toSunoRequest, parseSunoResponse } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class SunoAdapter implements AIProviderAdapter {
  readonly id = 'suno-v4';
  readonly name = 'Suno AI Music';
  readonly type: AdapterType = 'music';
  readonly capabilities: Capability[] = ['text-to-music'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://studio-api.suno.ai/api';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/billing/info`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toSunoRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/generate/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Suno API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Suno rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Suno error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseSunoResponse(data);

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
      estimatedCost: (req.duration ?? 30) * 0.02,
      currency: 'USD',
      unit: 'per track',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/feed/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Suno status check failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseSunoResponse(data);
    const map: Record<string, JobStatus> = {
      queued: JobStatus.Queued,
      streaming: JobStatus.Running,
      complete: JobStatus.Completed,
      error: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generate/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Suno cancel failed: ${res.status}`);
  }
}
