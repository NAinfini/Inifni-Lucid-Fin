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
import { toVeoRequest, parseVeoResponse } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class VeoAdapter implements AIProviderAdapter {
  readonly id = 'google-veo-2';
  readonly name = 'Google Veo 3';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private model = 'veo-3.0-generate-001';

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
      const res = await fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: { 'x-goog-api-key': this.apiKey },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toVeoRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/models/${this.model}:predictLongRunning`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Google API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Veo rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Veo error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseVeoResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { operationName: parsed.operationName, done: parsed.done },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * 0.35,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/operations/${jobId}`, {
      headers: { 'x-goog-api-key': this.apiKey },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Veo status check failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseVeoResponse(data);
    if (parsed.error) return JobStatus.Failed;
    return parsed.done ? JobStatus.Completed : JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    await fetchWithTimeout(`${this.baseUrl}/operations/${jobId}:cancel`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.apiKey },
    });
  }
}
