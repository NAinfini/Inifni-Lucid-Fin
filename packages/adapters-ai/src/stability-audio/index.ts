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
import { toStabilityAudioRequest, parseStabilityAudioResponse } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class StabilityAudioAdapter implements AIProviderAdapter {
  readonly id = 'stability-audio-v2';
  readonly name = 'Stability Audio';
  readonly type: AdapterType = 'sfx';
  readonly capabilities: Capability[] = ['text-to-sfx'];
  readonly maxConcurrent = 3;

  private apiKey = '';
  private baseUrl = 'https://api.stability.ai/v2beta';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/user/account`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toStabilityAudioRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/audio/stable-audio/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Stability API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'Stability Audio rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Stability Audio error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseStabilityAudioResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { id: parsed.id, status: parsed.status },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 10) * 0.01,
      currency: 'USD',
      unit: 'per clip',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/audio/result/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
    });
    if (res.status === 202) return JobStatus.Running;
    if (!res.ok)
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `Stability Audio status check failed: ${res.status}`,
      );
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // Stability Audio doesn't support cancellation
  }
}
