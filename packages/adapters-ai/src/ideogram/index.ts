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

export class IdeogramAdapter implements AIProviderAdapter {
  readonly id = 'ideogram';
  readonly name = 'Ideogram';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.ideogram.ai';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/describe`, {
        method: 'POST',
        headers: { 'Api-Key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_request: { image_url: 'https://example.com/test.png' } }),
      });
      return res.status !== 401;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const res = await fetch(`${this.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Api-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_request: {
          prompt: req.prompt,
          negative_prompt: req.negativePrompt,
          aspect_ratio: this.getAspectRatio(req.width, req.height),
          model: 'V_3',
          ...(req.seed != null && { seed: req.seed }),
        },
      }),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Ideogram API key');
      if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Ideogram rate limited');
      if (status === 422)
        throw new LucidError(ErrorCode.ContentModeration, 'Content moderation triggered');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Ideogram error: ${status}`);
    }

    const data = (await res.json()) as { data: Array<{ url: string; seed: number }> };
    const url = data.data?.[0]?.url ?? '';
    return {
      assetHash: '',
      assetPath: url,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: { seed: data.data?.[0]?.seed },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.08, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {
    // Ideogram is synchronous
  }

  private getAspectRatio(w?: number, h?: number): string {
    if (!w || !h) return 'ASPECT_1_1';
    const ratio = w / h;
    if (ratio > 1.5) return 'ASPECT_16_9';
    if (ratio < 0.67) return 'ASPECT_9_16';
    if (ratio > 1.2) return 'ASPECT_4_3';
    if (ratio < 0.83) return 'ASPECT_3_4';
    return 'ASPECT_1_1';
  }
}
