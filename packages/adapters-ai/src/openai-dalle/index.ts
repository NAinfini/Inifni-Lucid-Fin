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
import { toOpenAIRequest, parseOpenAIResponse } from './mapper.js';

export class OpenAIDalleAdapter implements AIProviderAdapter {
  readonly id = 'openai-dalle';
  readonly name = 'OpenAI DALL-E 3';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toOpenAIRequest(req);
    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const status = res.status;
      if (status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid API key');
      if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Rate limited');
      if (status === 400)
        throw new LucidError(
          ErrorCode.ContentModeration,
          (err as Record<string, Record<string, string>>).error?.message ?? 'Bad request',
        );
      throw new LucidError(ErrorCode.ServiceUnavailable, `OpenAI error: ${status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseOpenAIResponse(data);

    return {
      assetHash: '',
      assetPath: parsed.url,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const size = `${req.width ?? 1024}x${req.height ?? 1024}`;
    const costMap: Record<string, number> = {
      '1024x1024': 0.04,
      '1024x1792': 0.08,
      '1792x1024': 0.08,
    };
    return {
      provider: this.id,
      estimatedCost: costMap[size] ?? 0.04,
      currency: 'USD',
      unit: 'per image',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    // DALL-E is synchronous — if generate() returned, it's completed
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {
    // DALL-E is synchronous — cannot cancel in-flight
  }
}
