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
import { validateProviderUrl } from '../url-policy.js';

export class FluxAdapter implements AIProviderAdapter {
  readonly id = 'flux';
  readonly name = 'Flux (Replicate)';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.replicate.com/v1';
  private model = 'black-forest-labs/flux-schnell';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    // Create prediction
    const res = await fetch(`${this.baseUrl}/models/${this.model}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Prefer: 'wait',
      },
      body: JSON.stringify({
        input: {
          prompt: req.prompt,
          num_outputs: 1,
          width: req.width ?? 1024,
          height: req.height ?? 1024,
          ...(req.seed != null && { seed: req.seed }),
        },
      }),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Replicate API key');
      if (status === 429) throw new LucidError(ErrorCode.RateLimited, 'Replicate rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Replicate error: ${status}`);
    }

    const data = (await res.json()) as { output?: string[]; status: string; error?: string };
    if (data.status === 'failed') {
      throw new LucidError(ErrorCode.Unknown, data.error ?? 'Flux generation failed');
    }

    const url = data.output?.[0] ?? '';
    return {
      assetHash: '',
      assetPath: url,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.003, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetch(`${this.baseUrl}/predictions/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return 'failed' as JobStatus;
    const data = (await res.json()) as { status: string };
    const map: Record<string, string> = {
      starting: 'queued',
      processing: 'running',
      succeeded: 'completed',
      failed: 'failed',
      canceled: 'cancelled',
    };
    return (map[data.status] ?? 'running') as JobStatus;
  }

  async cancel(jobId: string): Promise<void> {
    await fetch(`${this.baseUrl}/predictions/${jobId}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
  }
}
