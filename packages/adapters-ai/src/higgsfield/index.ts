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

export class HiggsfieldAdapter implements AIProviderAdapter {
  readonly id = 'higgsfield-v1';
  readonly name = 'Higgsfield AI';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://api.higgsfield.ai/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/account`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch { /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        prompt: req.prompt,
        duration: req.duration ?? 5,
        width: req.width ?? 1280,
        height: req.height ?? 720,
      }),
    });
    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Higgsfield API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'Higgsfield rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Higgsfield error: ${res.status}`);
    }
    const data = (await res.json()) as { id: string; status: string };
    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { id: data.id, status: data.status },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * 0.05,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Higgsfield status failed: ${res.status}`);
    const data = (await res.json()) as { status: string };
    const map: Record<string, JobStatus> = {
      pending: JobStatus.Queued,
      processing: JobStatus.Running,
      completed: JobStatus.Completed,
      failed: JobStatus.Failed,
    };
    return map[data.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Higgsfield cancel failed: ${res.status}`);
  }
}
