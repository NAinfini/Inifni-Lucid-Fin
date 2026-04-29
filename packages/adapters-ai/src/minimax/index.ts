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
import { toMiniMaxRequest, parseMiniMaxResponse, parseMiniMaxStatus } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class MiniMaxAdapter implements AIProviderAdapter {
  readonly id = 'minimax-video01';
  readonly name = 'MiniMax Video-01';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://api.minimax.chat/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/video_generation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ prompt: 'test', model: 'video-01' }),
      });
      // 401/403 = bad key, anything else (including 400) = key is valid
      return res.status !== 401 && res.status !== 403;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toMiniMaxRequest(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/video_generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid MiniMax API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'MiniMax rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `MiniMax error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseMiniMaxResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { taskId: parsed.taskId, status: parsed.status },
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
    const res = await fetchWithTimeout(`${this.baseUrl}/query/video_generation?task_id=${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok)
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `MiniMax status check failed: ${res.status}`,
      );

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseMiniMaxStatus(data);
    const map: Record<string, JobStatus> = {
      Queueing: JobStatus.Queued,
      Preparing: JobStatus.Queued,
      Processing: JobStatus.Running,
      Success: JobStatus.Completed,
      Fail: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(_jobId: string): Promise<void> {
    // MiniMax API does not expose a cancel endpoint for video generation
  }
}
