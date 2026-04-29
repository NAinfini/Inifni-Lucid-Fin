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

export class LeonardoAdapter implements AIProviderAdapter {
  readonly id = 'leonardo-v2';
  readonly name = 'Leonardo AI';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 3;

  private apiKey = '';
  private baseUrl = 'https://cloud.leonardo.ai/api/rest/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
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
        modelId: (req.params?.modelId as string) ?? null,
      }),
    });
    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Leonardo API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Leonardo rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Leonardo error: ${res.status}`);
    }
    const data = (await res.json()) as { sdGenerationJob: { generationId: string } };
    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { generationId: data.sdGenerationJob.generationId },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.02, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/generations/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Leonardo status failed: ${res.status}`);
    const data = (await res.json()) as { generation?: { status: string } };
    const status = data.generation?.status ?? '';
    const map: Record<string, JobStatus> = {
      PENDING: JobStatus.Queued,
      PROCESSING: JobStatus.Running,
      COMPLETE: JobStatus.Completed,
      FAILED: JobStatus.Failed,
    };
    return map[status] ?? JobStatus.Running;
  }

  async cancel(_jobId: string): Promise<void> {}
}
