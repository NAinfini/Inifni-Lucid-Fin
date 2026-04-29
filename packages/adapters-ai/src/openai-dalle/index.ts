import type {
  AIProviderAdapter,
  AdapterError,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { adapterErrorToLucidError } from '../error-utils.js';
import { parseError, parseOpenAIResponse, toOpenAIRequest } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class OpenAIDalleAdapter implements AIProviderAdapter {
  readonly id = 'openai-dalle';
  readonly name = 'OpenAI GPT Image';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 5;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
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

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseError(error, status);
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
      throw adapterErrorToLucidError(this.normalizeError(err, res.status));
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

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    callbacks.onQueueUpdate?.({
      status: 'processing',
      currentStep: 'submitting',
    });
    callbacks.onProgress?.({
      type: 'progress',
      percentage: 5,
      currentStep: 'submitting',
    });

    const result = await this.generate(req);

    callbacks.onProgress?.({
      type: 'progress',
      percentage: 100,
      currentStep: 'completed',
    });
    callbacks.onQueueUpdate?.({
      status: 'completed',
      currentStep: 'completed',
    });

    return result;
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
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {}
}
