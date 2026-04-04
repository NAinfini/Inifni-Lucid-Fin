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
import { toKlingRequest, parseKlingResponse } from './mapper.js';

export class KlingAdapter implements AIProviderAdapter {
  readonly id = 'kling-v1';
  readonly name = 'Kling AI';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://api.klingai.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/videos`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const isImg2Vid = req.referenceImages && req.referenceImages.length > 0;
    const endpoint = isImg2Vid ? '/videos/image2video' : '/videos/text2video';
    const body = toKlingRequest(req);

    const res = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Kling API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Kling rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseKlingResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { taskId: parsed.taskId, status: parsed.status },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * 0.07,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/videos/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `Kling status check failed: ${res.status}`,
      );

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseKlingResponse(data);
    const map: Record<string, JobStatus> = {
      submitted: JobStatus.Queued,
      processing: JobStatus.Running,
      succeed: JobStatus.Completed,
      failed: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/videos/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling cancel failed: ${res.status}`);
  }
}
