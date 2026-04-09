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

const ASPECT_RATIO_MAP: Record<string, string> = {
  '1024x1024': '1:1',
  '768x1024': '3:4',
  '1024x768': '4:3',
  '576x1024': '9:16',
  '1024x576': '16:9',
};

export class GoogleImagen3Adapter implements AIProviderAdapter {
  readonly id = 'google-imagen3';
  readonly name = 'Google Imagen 4';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private model = 'imagen-4.0-generate-001';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const aspectRatio = this.resolveAspectRatio(req);
    const sampleCount = (req.params?.sampleCount as number) ?? 1;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predict?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: req.prompt }],
        parameters: {
          sampleCount,
          aspectRatio,
          personGeneration: (req.params?.personGeneration as string) ?? 'allow_adult',
        },
      }),
    });

    if (!res.ok) {
      const status = res.status;
      if (status === 401 || status === 403)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Google API key');
      if (status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'Google Imagen rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Google Imagen error: ${status}`);
    }

    const data = (await res.json()) as {
      predictions: Array<{ bytesBase64Encoded: string; mimeType?: string }>;
    };
    const prediction = data.predictions[0];

    return {
      assetHash: '',
      assetPath: `data:${prediction.mimeType ?? 'image/png'};base64,${prediction.bytesBase64Encoded}`,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: 0.04,
      currency: 'USD',
      unit: 'per image',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {
    // Synchronous API — cannot cancel
  }

  private resolveAspectRatio(req: GenerationRequest): string {
    // Explicit aspectRatio param takes priority
    if (req.params?.aspectRatio) return req.params.aspectRatio as string;
    if (req.width && req.height) {
      const key = `${req.width}x${req.height}`;
      if (ASPECT_RATIO_MAP[key]) return ASPECT_RATIO_MAP[key];
    }
    return '1:1';
  }
}
