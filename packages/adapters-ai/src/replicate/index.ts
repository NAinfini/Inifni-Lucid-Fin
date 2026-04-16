import type {
  AIProviderAdapter,
  AdapterType,
  AdapterConfigureOptions,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import {
  LucidError,
  ErrorCode,
  JobStatus,
  resolvePrimaryVideoConditioningImage,
  resolveVideoReferenceImageField,
} from '@lucid-fin/contracts';
import { createPrediction, getPrediction, cancelPrediction, toJobStatus } from './client.js';

export class ReplicateAdapter implements AIProviderAdapter {
  readonly id = 'replicate';
  readonly name = 'Replicate';
  readonly type: AdapterType | AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = ['text-to-image', 'text-to-video', 'image-to-video'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.replicate.com/v1';
  private model = 'black-forest-labs/flux-1.1-pro';
  private videoModel = 'minimax/video-01';

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.model) {
      if (options.generationType === 'video') {
        this.videoModel = options.model as string;
      } else {
        this.model = options.model as string;
      }
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch { /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    // Select model based on generation type
    const activeModel = req.type === 'video' ? this.videoModel : this.model;
    const input: Record<string, unknown> = {
      prompt: req.prompt,
    };

    // Add dimensions for image/video
    if (req.width) input.width = req.width;
    if (req.height) input.height = req.height;
    if (req.seed != null) input.seed = req.seed;
    if (req.type === 'video') {
      const referenceImage = resolvePrimaryVideoConditioningImage(req);
      const referenceField = resolveVideoReferenceImageField(this.id, activeModel) ?? 'image';
      if (referenceImage) {
        input[referenceField] = referenceImage;
      }
      if (req.duration != null) {
        input.duration = req.duration;
      }
    }

    const prediction = await createPrediction(
      this.apiKey,
      activeModel,
      input,
      this.name,
      this.baseUrl,
    );

    // Poll for completion
    let status = prediction.status;
    const predictionId = prediction.id;
    let output = prediction.output;

    while (status === 'starting' || status === 'processing') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const updated = await getPrediction(this.apiKey, predictionId, this.name, this.baseUrl);
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
    const url =
      typeof output === 'string'
        ? output
        : Array.isArray(output) && output.length > 0 && typeof output[0] === 'string'
          ? output[0]
          : '';

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
      const prediction = await getPrediction(this.apiKey, jobId, this.name, this.baseUrl);
      return toJobStatus(prediction.status);
    } catch { /* network error — assume job status is unknown, report as failed */
      return JobStatus.Failed;
    }
  }

  async cancel(jobId: string): Promise<void> {
    await cancelPrediction(this.apiKey, jobId, this.baseUrl);
  }
}
