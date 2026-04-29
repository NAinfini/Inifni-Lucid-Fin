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
import { validateProviderUrl } from '../url-policy.js';

export class RecraftAdapter implements AIProviderAdapter {
  readonly id = 'recraft-v3';
  readonly name = 'Recraft V3';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 3;

  private apiKey = '';
  private baseUrl = 'https://external.api.recraft.ai/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/styles`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        prompt: req.prompt,
        n: 1,
        size: `${req.width ?? 1024}x${req.height ?? 1024}`,
        style: (req.params?.style as string) ?? 'realistic_image',
      }),
    });
    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Recraft API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Recraft rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Recraft error: ${res.status}`);
    }
    const data = (await res.json()) as { data: Array<{ url: string }> };
    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { url: data.data[0]?.url },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.04, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }
  async cancel(_jobId: string): Promise<void> {}
}
