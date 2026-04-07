import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { createPrediction, getPrediction, cancelPrediction, toJobStatus } from './client.js';

export class ReplicateAdapter implements AIProviderAdapter {
  readonly id = 'replicate';
  readonly name = 'Replicate';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'text-to-video'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.replicate.com/v1';
  private model = 'black-forest-labs/flux-1.1-pro';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.model) this.model = options.model as string;
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
    const input: Record<string, unknown> = {
      prompt: req.prompt,
    };

    // Add dimensions for image/video
    if (req.width) input.width = req.width;
    if (req.height) input.height = req.height;
    if (req.seed != null) input.seed = req.seed;

    const prediction = await createPrediction(this.apiKey, this.model, input, this.name);

    // Poll for completion
    let status = prediction.status;
    let predictionId = prediction.id;
    let output = prediction.output;

    while (status === 'starting' || status === 'processing') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const updated = await getPrediction(this.apiKey, predictionId, this.name);
      status = updated.status;
      output = updated.output;

      if (updated.error) {
        throw new LucidError(ErrorCode.Unknown, updated.error);
      }
    }

    if (status === 'failed') {
      throw new LucidError(ErrorCode.Unknown, 'Replicate generation failed');
    }

    // Extract URL from output
    let url = '';
    if (typeof output === 'string') {
      url = output;
    } else if (Array.isArray(output) && output.length > 0) {
      url = typeof output[0] === 'string' ? output[0] : '';
    }

    return {
      assetHash: '',
      assetPath: url,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.01, currency: 'USD', unit: 'per generation' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    try {
      const prediction = await getPrediction(this.apiKey, jobId, this.name);
      return toJobStatus(prediction.status);
    } catch {
      return JobStatus.Failed;
    }
  }

  async cancel(jobId: string): Promise<void> {
    await cancelPrediction(this.apiKey, jobId);
  }
}
