import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';
import { createPrediction, getPrediction, cancelPrediction, toJobStatus } from '../replicate/client.js';
import { toSeedanceInput } from './mapper.js';

export class SeedanceAdapter implements AIProviderAdapter {
  readonly id = 'seedance-2';
  readonly name = 'Seedance 2';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private model = 'bytedance/seedance-2:latest';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch('https://api.replicate.com/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const input = toSeedanceInput(req);
    const prediction = await createPrediction(this.apiKey, this.model, input, this.name);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { predictionId: prediction.id, status: prediction.status },
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
    const prediction = await getPrediction(this.apiKey, jobId, this.name);
    return toJobStatus(prediction.status);
  }

  async cancel(jobId: string): Promise<void> {
    await cancelPrediction(this.apiKey, jobId);
  }
}
