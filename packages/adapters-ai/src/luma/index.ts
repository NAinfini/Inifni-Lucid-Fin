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
import { toLumaRequest, parseLumaResponse } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class LumaAdapter implements AIProviderAdapter {
  readonly id = 'luma-ray2';
  readonly name = 'Luma Ray 2';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://api.lumalabs.ai/dream-machine/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
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

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { generationId: parsed.generationId, status: parsed.status },
    };
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
    const res = await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Luma status check failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
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
}
